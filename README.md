# Harbour CRM help assistant

A grounded retrieval-augmented help-desk assistant, built around a small CRM that exists only to give it something real to be accurate about.

It answers only from the CRM's own help centre, never from the model's general knowledge or the web, and cites the article behind every answer. Retrieval is hybrid: **keyword search** (BM25F with a coverage-based decision policy) plus **semantic search** (all-MiniLM-L6-v2 sentence embeddings, run in the visitor's browser). A deterministic policy then answers, asks a clarifying question, suggests close matches or hands over to support, before any model is called.

- **The CRM** is a static web app with Contacts, Companies, Deals, custom fields and a Client profile (the account's own settings). It loads sample data on every page load, so a reload resets it.
- **The help centre** is 29 short articles for signed-in customers (27 single-task how-tos, a glossary and a note about the demo data) and 15 overview pages for visitors. Each has an id, title, aliases ("also called"), a body and "not to be confused with" links. Every how-to describes a screen you can click through, and a browser check verifies that every bold UI label in the docs exists in the app.
- **The assistant** answers only from those articles, cites the article it used, asks a clarifying question when two articles are equally likely, suggests the closest articles when keyword search can't decide but the meaning matches, and offers "Contact support" when nothing matches. Every help reply has a **Show retrieval** panel with the rewritten query, scored articles, the decision and the exact prompt; record answers show how the question was read.
- **Record lookups** answer questions about the account's own data when signed in ("show me Priya's phone number", "open Deals worth more than 10k") straight from the records, using a small deterministic parser with no model call.
- **The demo page** has a "How to use this demo" panel with questions to try, including known fails and why they fail.
- **The evaluation suite** has 304 realistic phrasings across seven sets. Four are held out from the code they test, and three of those have never been tuned on. The report shows retrieval hit rate, citation validity, refusal correctness, keyword vs hybrid retrieval, and cost per question. It also compares Claude Haiku, Sonnet and Opus on cost per correct answer.

**Live demo:** https://joshward91.github.io/cv-rag-demo/ · **Evaluation report:** https://joshward91.github.io/cv-rag-demo/report.html

The hosted demo runs in offline mode, so it never spends anyone's tokens. Visitors can switch the assistant to Claude with their own API key, which stays in the browser tab and is billed to them.

The interesting part is not calling a model. It is everything around the call that decides whether an answer can be trusted.

## Running it

Requires Node 20 or later. There is no backend.

```bash
npm install              # add --ignore-scripts if onnxruntime-node's postinstall can't download; its CPU binaries ship in the package
npm test                 # unit tests: retrieval, semantic search, tokenizer parity, guardrail, generator contract
npm run eval             # runs all 304 cases offline, keyword-only and hybrid, writes eval/results.json
npm run check:docs       # browser check: docs labels exist in the UI, plus five walkthroughs
npm run build            # self-contained pages in dist/, plus the GitHub Pages site in docs/
npm run serve            # open http://localhost:8080 to run from source (keyword search only;
                         # for semantic search, build and serve docs/)
```

`node scripts/embed-articles.mjs` re-embeds the help centre after an article changes; `npm test` fails while the vectors are stale.

`npm run eval -- --live` generates answers with the Claude API instead of the offline generator and records measured token usage. It needs `ANTHROPIC_API_KEY`; the default model is Claude Sonnet 5.5, and `--model claude-opus-5-5` picks another.

## How an answer is produced

```
question
  -> rewrite      normalise, phrase rules, synonyms, spelling        src/rag/analyze.js, lexicon.js
  -> retrieve     field-weighted BM25 over title, aliases, body       src/rag/retriever.js
                  + sentence embeddings, in the browser               src/rag/semantic.js
  -> decide       answer / clarify / suggest / escalate               src/rag/retriever.js
  -> generate     offline extractive, or Claude                       src/rag/generators.js, prompt.js
  -> verify       citation guardrail                                  src/rag/pipeline.js
```

### Rewrite

The vocabulary problem in this product is deliberate: in Harbour CRM the **Client** is the business using the CRM, and a **Contact** is the Client's customer. Users don't talk like that. "How do I update a client's phone number" means a Contact's phone number, and it must never retrieve the article about the account's own *Client contact number*.

The articles use the vendor's terms: **Client** is the user's own business and **Contact** is one of its customers. The word means different things depending on who wrote it. The help centre is written by the vendor, for whom the client is the business paying for Harbour CRM. Questions come from that business, for whom a client is one of their own customers. A Contact is the Client's client. So the rewrite stage is perspective-aware: everything in an article (title, aliases and body) is analysed as the vendor's voice, and questions as the user's.

1. Terms of art are protected first on both sides. "client contact number", "our phone number", "the number on our account" and "the number support calls us on" become one token, `clientcontactnumber`.
2. In articles, "client" becomes `account`, and "client phone number" or "client name" become the account's own settings.
3. In questions, "client" and "customer" become "contact", unless the phrase is plainly about the user's own account ("our client profile", "as a client"). Possessives are kept as a separate token, so "a client's contact number" is not mistaken for the term of art.
4. Synonyms collapse to concepts (update, change, modify → `edit`), and spelling is corrected by edit distance against the help centre's vocabulary.

Every rule that fires is recorded and shown in the retrieval panel.

### Retrieve and decide

Retrieval is a simplified BM25F: title, aliases and body are scored separately and weighted 3 : 2 : 1. Raw BM25 scores aren't comparable across queries, so the decision policy uses **coverage** as well: the IDF-weighted share of the question's terms that an article explains. Terms found only in the body count for half, because bodies mention neighbouring tasks ("to change a Contact's number, edit the Contact instead").

- **Escalate** when the best article covers less than 55% of the question. A word the help centre never uses ("import", "password") counts against coverage, capped at the weight of the most specific recognised word.
- **Clarify** when a rival article scores close to the top one (60% if the docs declare the two as easy to confuse, 95% otherwise) *and* the rival's title or aliases cover every term the top article's do. A question that names only an action ("delete") also gets a clarifying question.
- **Answer** otherwise. The prompt gets the answer article plus up to two other strong matches, but never an article the docs list under "not to be confused with". Handing the model a look-alike invites it to blend the two.

Clarification and escalation happen before any model call, so they are deterministic and free.

### Semantic suggestions (hybrid retrieval)

Keyword search fails on paraphrases that share no words with an article: "they signed the contract" is about marking a Deal as won. So a small sentence-embedding model (all-MiniLM-L6-v2, 384 dimensions, 8-bit quantised) runs alongside BM25.

- **Offline indexing.** `scripts/embed-articles.mjs` embeds every article as separate passages: the title, each alias and each body sentence. For the 29 articles and 15 overview pages that produces 575 vectors, stored as int8 in `src/kb/article-vectors.js` (about 350 KB with the index graph) with a fingerprint of the articles they came from.
- **In the browser.** Only the question is embedded, on the visitor's machine via ONNX Runtime Web (WebAssembly). Tokenisation is a small WordPiece implementation (`src/rag/wordpiece.js`), and a unit test checks it matches the reference Hugging Face tokenizer on every passage and eval question. Node and the browser share the same model, tokenizer and pooling code (`src/rag/minilm.js`). Only the runtime differs (native ONNX Runtime in Node, single-threaded WebAssembly in the browser), so similarities can differ in the low decimal places. The model and runtime are served from this site, not a CDN, so the question never leaves the page and offline mode stays free. The first chat open downloads about 37 MB once. The question is embedded after the rewrite step, so "client" has already become "contact" and the perspective rules still apply.
- **Keyword search decides first.** Semantic search only acts when keyword search would escalate. If the best match is at least 0.45 similar (cosine similarity, with body sentences weighted ×0.9), the user is offered up to three articles within 0.08 of the best, and declared look-alikes are never offered together. A suggestion makes no model call.

**Why it only suggests.** On dev data, raw similarity couldn't separate right matches from near misses: "import contacts" (unsupported) scores 0.78 against the export article, higher than many correct paraphrases. Answering on similarity alone would have meant confident wrong answers. Suggesting means a wrong match costs the user one click to Contact support.

**Vector index (HNSW).** The passages are searched through an HNSW graph (`src/rag/hnsw.js`), the approximate nearest-neighbour index that pgvector, Qdrant and Pinecone use, written in plain JavaScript so Node builds it and the browser queries it. `scripts/embed-articles.mjs` builds it once (M 16, efConstruction 200, seeded so the build is reproducible) and ships it as data, so GitHub Pages only serves files. The browser reads the 48 nearest passages and groups them by article; an article keyword search ranks but the graph didn't reach is scored exactly. A hosted vector database isn't an option on Pages: the browser would have to hold its key.

At 575 passages the graph is honestly overhead. Run against the flat scan on all 304 questions, it gives the same top article, top three and outcome for every question, in about the same time (0.52 ms per question against 0.54 ms). `eval/scale/bench.mjs` shows where it pays off. It grows the corpus with synthetic vectors (synthetic articles of ten passages each, centred on a mix of three real passages, with noise tuned so nearest-neighbour similarities match the real set) and queries it with the real eval questions. The synthetic items are vectors with no text behind them, so they measure the index's speed and recall, not answer quality:

| Passages | Flat scan | HNSW (efSearch 64) | Recall@10 | Same top article | Same top 3 | Build | Graph |
|---|---|---|---|---|---|---|---|
| 292 (real, before the overview pages) | 0.37 ms | 0.39 ms | 100% | 100% | 100% | 0.4 s | 28 KB |
| 10,000 | 6.7 ms | 1.0 ms | 97.8% | 98.4% | 96.4% | 44 s | 1.1 MB |
| 100,000 | 63.8 ms | 1.4 ms | 89.6% | 91.1% | 82.9% | 10 min | 10.7 MB |

efSearch trades speed for recall at query time. At 100,000 passages, efSearch 256 finds 98.0% of the true top 10 and the same top article 99.0% of the time, in 4.5 ms, still 14 times faster than the flat scan. The report has the full sweep.

In production I would put the index in the database instead, as pgvector's HNSW index next to the articles in Postgres behind the PHP API, with the same contract: nearest passages in, articles out, keyword search deciding first.

The model weights are the original Xenova/all-MiniLM-L6-v2 q8 ONNX export, vendored in `models/` with a SHA-256 in `models/CHECKSUM.json`. Node and the browser both load these vendored files directly, so nothing is fetched from a model hub.

### Generate

The prompt (`src/rag/prompt.js`) gives the model the decided article and any close neighbours that aren't declared look-alikes. The system prompt explains that "client" in the articles means the user's own business. An `<interpretation>` block then carries what the query rewriter decided for this question, for example *"client" means a contact: one of the user's own customers, not the user's client profile*. The model doesn't have to resolve the clash again on its own.

All generators share one contract and are interchangeable:

| Generator | Where | What it does |
|---|---|---|
| `ExtractiveGenerator` | default, eval | Returns the cited article's own steps. Can't hallucinate, needs no key. |
| `AnthropicGenerator` | local, `--live` eval | Claude API via the official SDK, with the client injected. Defaults to Claude Sonnet 5.5, the model the comparison below favours. Low effort is a separate cost choice that the comparison didn't measure. The response is constrained by a JSON schema whose `citations` enum lists only the article ids in the prompt. Server-side refusal fallback is enabled. |
| `ClaudeAiGenerator` | published artifact | Claude through the claude.ai page runtime, which is used when direct API calls are blocked. |

With a model available, it is used in one of three ways (`MODEL_USE` in `src/rag/pipeline.js`, the "Model use" setting in the chat). The default, **full model**, sends every question to the model with up to five candidate articles (`buildRoutingPrompt`), and the model decides whether to answer, ask which one, or hand off. **Prose only** and **offline** let keyword search's decision stand when its top article covers at least 70% of the question, and have the model only write the answer or skip it altogether. They exist for evaluation; [the tiers comparison](#model-use-tiers) explains why full model is recommended. Every prompt ends with the user's question verbatim, after the articles and the interpretation, so the model can recover any meaning the rewriter lost. It is escaped, and it only arrives after the input guard has passed it.

### Verify

The output guardrail in `validateReply` runs on every model reply. An answer that cites nothing, cites only articles that weren't in the prompt, or contains a link is withheld and the user is offered support. Invented citations alongside a valid one are dropped. With the schema enum in place, the invented-citation check should never fire on the API path. The empty-citation and link checks still can, because the schema doesn't enforce them, and the runtime path has no schema at all.

### Grounding and prompt injection

The assistant is a SaaS help bot, so it must only ever explain Harbour CRM from its own help centre. Several independent layers enforce that:

1. **Input guard** (`src/rag/guard.js`). Before retrieval or any model call, the raw question is screened for obvious injection: instruction overrides ("ignore previous instructions", including French and Spanish), fake system messages, role changes ("you are now", "act as"), requests for the prompt, jailbreak phrases, attempts to dictate the reply format, the prompt's own tags, long encoded strings, and questions over 500 characters. Spaced letters, leetspeak and accents are normalised first. A blocked question never reaches a model.
2. **Retrieval gate.** Off-topic requests ("find me a recipe for cake") don't cover enough of any article, so they are escalated before generation.
3. **No external access.** The model call sends no tools, tool choice or MCP servers, so the model cannot browse or fetch anything. It sees only the articles retrieval chose. A unit test asserts this.
4. **Hardened prompt.** The system prompt marks the question as untrusted and says to escalate anything other than Harbour CRM help. The verbatim question comes last, below the articles, and is escaped, so it can't close its `<question>` tag or inject new ones.
5. **Output guardrail.** The reply must match a JSON schema whose citations can only be the articles provided. An answer that cites none of them, or contains a link, is withheld.

6. **Browser policy.** The built site sets a content security policy. Apart from the site itself and Google Fonts, its only allowed network calls are to `api.anthropic.com`, and it loads no third-party scripts. The Anthropic SDK is bundled into the page rather than fetched from a CDN. All rendered text, including model answers and CRM data, is HTML-escaped.

The guard is pattern-based and only catches the obvious cases. The later layers make an injection that slips past it harmless.

**Pen test.** The `redteam` set holds 38 probes: overrides, fake system messages, prompt extraction, role play, jailbreaks, obfuscated variants, harmful and off-topic asks, and XSS payloads. All pass. A one-off manual browser run of the XSS payloads through the chat and CRM forms triggered no script; that check is not automated.

## Harbour suite: other products and withheld documents

The CRM help centre alone (29 articles) is too small to put retrieval under pressure, so the evaluation adds the rest of a plausible Harbour suite. Separate writer agents produced 969 help articles for five sister products (Invoicing, Mail, Desk, People and Projects), and 190 documents the assistant must never show, all deliberately about the same tasks customers ask about: 100 internal staff documents (support training, runbooks, policies and sales playbooks), 40 unpublished drafts, 40 archived articles for the old interface, and 10 legacy documents with no status at all. The sister products share the CRM's vocabulary ("contact", "client", "phone number"), so they are realistic traps. `scripts/build-suite.mjs` cleans the drafts (boilerplate closing sentences stripped, 31 tasks two writers both covered merged) and embeds all 12,875 passages into one HNSW index, as a shared vector database would hold them.

- **Product routing.** A question is about the CRM unless it names another product ("in Harbour People", "the invoicing app"). Then that product's help centre answers it, without the CRM's "client" rules, and the prompt names that product.
- **Also in.** A CRM answer lists close matches in other products: "How do I change a contact's phone number?" gets the CRM article plus "Also in Harbour People". With "in the People app" added, the People article is the answer.
- **Suggest, never answer, across products.** If the CRM would hand off but another product covers the question ("how do I request annual leave"), its articles are suggested with a product label.

**Access control.** Every document has a status, as a help centre or wiki would store it: draft (the default for new documents), public, internal or archived. Only public documents reach the assistant. The status is metadata from where the document is managed, never inferred from its length or wording, so dense public pages such as API reference stay public. The rules:

- `isPublic` (`src/rag/suite.js`) passes only `status: 'public'`. A missing or unknown status is withheld by the same rule. That is a safety net, not an expected state; in the evaluation one untagged legacy note alone was enough to turn "How do I update a client's phone number?" from an answer into a clarifying question.
- Every retriever, the CRM's included, throws if it is given anything else.
- The shared vector index is searched with an allow-list of the retriever's own ids, applied during the HNSW walk rather than afterwards, so withheld passages can sit in the same index and never come back. In production this would be a `WHERE` clause or row-level security in pgvector.
- The build fails if a withheld document's id or title appears in any published file other than the labelled ones.

The demo and report do show the withheld documents, on purpose and clearly labelled, so a reviewer can check that the filter works: the chat's retrieval panel has a "Filtered out: documents not published to customers (shown for evaluation only)" section, and the report has its own appendix for them.

| Configuration | Passages | Pass rate (304 CRM questions) | Changed vs CRM only | Questions surfacing a withheld document |
|---|---|---|---|---|
| CRM only, flat scan | 575 | 73.7% | | 0 |
| CRM only, HNSW | 575 | 73.7% | 0 | 0 |
| Suite, flat scan | 10,414 | 73.7% | 9 | 0 |
| Suite, HNSW | 10,414 | 73.7% | 9 | 0 |
| Suite + withheld docs, filtered | 12,875 | 73.7% | 9 | 0 |
| Suite + withheld docs, filter off | 12,875 | 12.8% | 135 | 265 |

(The pass rate here is keyword retrieval with semantic suggestions and no model, the offline mode.) Adding 969 articles changed 9 outcomes, all hand-offs that became suggestions from another product. Most are reasonable, but "reset my password" now suggests the Invoicing and People password articles, which is a known weakness. With the filter off, withheld documents change 135 outcomes: 113 different ones surface (60 internal, 24 draft, 24 archived, 5 with no status). Internal documents are longer and denser in keywords than single-task help articles, and drafts and archived articles cover the very same tasks, so they rank as strong matches. Ranking them lower would not be safe; they have to be filtered out before ranking.

**Blind suite set.** 64 new questions (`eval/suite/cases.json`) were written by a separate agent that saw only the documents, never the code, and were scored once without tuning. 32 passed. The answer or the right article was offered for 13 of 16 that named another product, 5 of 12 that only another product covers, 15 of 16 CRM questions with an "also in" match, 13 of 14 written to bait internal documents, and 5 of 6 CRM-only questions. No withheld document surfaced with the filter on; with it off, one surfaced for 53 of the 64. Those questions predate the draft, archived and untagged documents; adding them changed no result with the filter on. The weak spots are sister-product questions (no synonym lexicon of their own yet) and other-product-only questions, which keyword search alone finds poorly.

## Signed in or visitor

A help centre usually serves two audiences, so each public document also has an `audience`, separate from its status: `everyone` (overview pages: what a feature is for and why it is useful) or `customers` (the task help). A missing audience counts as customers, the narrower one. A writer agent added 15 overview pages for Harbour CRM (`src/kb/overview-articles.js`). The chat header has a **Signed in** / **Visitor** switch.

- **Visitor:** only the overview pages are searched. "How do I add a contact" gets the Contacts overview. Sister products' help is for customers, so "in Harbour People" is handed off rather than answered from the CRM.
- **Signed in:** the task help is searched exactly as before, and the overview pages are a separate fallback, consulted only when the task help would hand off (`viewerRetriever` in `src/rag/suite.js`).

The first design weighted the overview pages down inside one shared index. `eval/viewer/run.mjs` shows why it was dropped. Mixing the two sets changes the term statistics every article is scored against, so halving the overview pages' scores still changed 21 of the original 304 answers, and with no weighting 65 changed. With the fallback, none change. A blended weight that scores each set on its own and lets an overview answer win when its coverage × 0.5 beats the task article's was also measured. It changed only 2 original answers, but both were hold-out suggestions that became confident wrong answers, and it gained one new question. Coverage can't tell a "why" question from a "how" question, so it wasn't shipped.

48 new questions (`eval/viewer/cases.json`), half asked as a visitor and half signed in, were written by a separate agent that read only the articles. Signed in, 10 of 24 pass (15 useful). Visitors pass 13 of 24 (21 useful): the right overview page is usually offered, but often as a suggestion, because the coverage threshold was set for short task articles. Signed-in "what is it for" questions still get the task help, because nothing yet tells a "why" question from a "how" question. Two changes followed the first scoring, so this set is no longer blind: overview answers no longer replace suggestions (a dev-set failure), and on the overview pages an exact title or alias match counts for more (the example this feature was designed around, "how do I add a contact" as a visitor, picked the custom fields overview without it).

## Record lookups

Signed in, people also ask about their own data: "show me Priya's phone number", "show me open Deals worth more than 10k", "the top 5 most profitable Deals", "all Contacts from Kestrel". `src/crm/query.js` answers these straight from the CRM's records, after the input guard and before help search. It is a small deterministic parser, not a model with tools: it recognises a field of a named Contact or Company (allowing a one-letter typo), and lists of Deals, Contacts or Companies filtered by stage, value, Company, Contact, industry or close date, sorted or cut to a top N. Each answer links to the records and shows how the question was read.

- Record data never goes into a prompt, so a Contact's notes can't carry a prompt injection, and every answer is free and repeatable. In production this would be a read-only API call made with the signed-in user's permissions.
- Anything the parser doesn't recognise goes to the help assistant as before. How-to questions that name a record ("how do I change Priya's phone number") get the help answer plus an **Open** link to the record, and names are replaced by their record type for help search.
- "Most profitable" is ranked by value, and the answer says so: the CRM records a Deal's value, not its profit.
- Visitors are told to sign in.

40 questions (`eval/records/cases.json`) were written by a separate agent that read only the seed data, with expected records and values computed from it. Scored once, blind: 29 of 40 (`eval/records/results.blind.json`). The parser was then widened for phrasings the failures showed it missed ("can you give me…", "where is X located", "what deals do we have with X", "who works at X"), and a list for a Company the account doesn't have, which the widening made list every Deal, now says it couldn't match the name: 37 of 40, tuned. None of the 416 help, viewer and suite questions is answered as data (`node eval/records/run.mjs` checks both). Replacing names with record types for help search changed 2 of the original 304 outcomes, both from a hand-off to a suggestion, so strict pass rates are unchanged.

## Evaluation

`eval/cases.js` holds 304 questions with an expected outcome: answer from a given article, clarify between given articles, escalate, block as prompt injection, or explain the assistant's own settings. Cases are tagged (core example, terminology, synonym, paraphrase, typo, ambiguity, out of scope, near miss, prompt injection, everyday voice, long) and split seven ways:

| Set | Cases | Role |
|---|---|---|
| dev | 83 | Tuned on from the start. Round 9 added 15 paraphrases to calibrate semantic suggestions. |
| test | 49 | Written with dev. Scored blind once after round 1, then used for tuning in round 2. |
| holdout | 38 | Written after round 1 and before round 2 changed anything. Never tuned on. |
| redteam | 38 | A cursory pen test, added in round 8. |
| perspective | 12 | "Client" from both sides. Written after round 3, scored blind once, then one failure was tuned on in round 4. |
| voice (everyday voice) | 48 | Rambling, non-expert and deliberately ambiguous questions, written by a separate agent that saw only the articles. Scored blind in round 10, never tuned on. |
| holdout3 (hard hold-out) | 36 | Paraphrases that avoid the articles' wording. Committed before any semantic code was written, scored blind in round 9, never tuned on. |

| Round | Dev | Test | Hold-out | Perspective | Hard hold-out | Everyday voice |
|---|---|---|---|---|---|---|
| Baseline | 80.8% (blind) | | | | | |
| Round 1 | 98.1% | 73.5% (blind) | | | | |
| Round 2 | 100% | 95.9% | **84.2% (blind)** | | | |
| Round 3 | 100% | 95.9% | 84.2% | **75.0% (blind)** | | |
| Round 4 | 100% | 95.9% | 84.2% | 83.3% | | |
| Rounds 5–8 | 100% | 95.9% | 84.2% | 91.7% | | |
| Round 9 | 85.5%\* | 95.9% | 84.2% | 91.7% | **33.3% (blind)** | |
| Round 10 | 85.5% | 95.9% | 84.2% | 91.7% | 33.3% | **27.1% (blind)** |

The hold-out, hard hold-out and everyday voice sets have never been tuned on.

\* Dev gained 15 hard paraphrases in round 9; the original 68 dev cases still all pass.

Round 9 added semantic suggestions. The strict pass rate doesn't move, because a suggestion is not counted as an answer. The **useful rate** does. It is measured over answerable questions only: answered correctly, or offered the right article.

| Set | Keyword only | Keyword + semantic |
|---|---|---|
| Everyday voice (30 answerable, blind) | 6.7% | **76.7%** |
| Hard hold-out (30 answerable, blind) | 20.0% | **70.0%** |
| Hold-out (28 answerable) | 82.1% | 100% |
| All answerable (192) | 63.5% | 88.0% |

These are the Round 9 figures. Since Round 13, record names in a question are replaced by their record type before help search ("Grace now works at…" searches as "contact now works at…"), which raised the hard hold-out to 73.3% and all answerable questions to 89.1%.

The cost: suggestions also appear for 20 of 49 out-of-scope questions, where the right action is Contact support, which sits under the suggestions.

Round 5 switched the shipped help centre to the vendor's voice and added the prompt check, without changing any retrieval rule. Round 6 fixed a user-reported wrong answer: "change mode to online" got the deal stage article because spelling correction turned "mode" into "move". Short words are no longer corrected, and questions about the assistant itself now explain its answer modes. Round 7 added the prompt-injection defences above, with twelve cases, two of which check that ordinary questions are not blocked. Round 8 was a cursory pen test (the `redteam` set). Round 9 added semantic suggestions, scored on a hard hold-out written before the code. Round 10 added the everyday voice set and changed no code.

**The never-tuned sets are the honest estimate, and they show where the design stops.** The original hold-out passes 84.2%. Five of its six failures now get the right article as a suggestion rather than an answer. The sixth, "change an address", is answered from the company article when it should ask which address is meant. On the hard hold-out (33.3% strict) and the everyday voice set (27.1% strict), keyword search ranks the right article first 70% and 83% of the time, but paraphrases and conversational filler pull coverage under the answer threshold. Semantic suggestions recover most of these (70.0% and 76.7% of answerable questions are answered or offered the right article), and a model making the decision recovers most of them as answers (see the model comparison below).

The core client/contact example passed 15 of 24 phrasings. All but one of the failures fail safe, with a suggestion or a clarifying question instead of an answer. The exception, a perspective phrasing, is answered from the company article, a wrong article but not the forbidden one. The forbidden article was never ranked first, offered, put in a prompt or cited. `npm run eval` exits non-zero if that ever changes, so it can gate CI.

**Articles are not edited to pass.** The help centre is written the way the vendor would write it, with "client" meaning the user's own business (**Settings > Client profile**). Retrieval problems are fixed in the query rewriting, the decision policy or the prompt. `eval/run.js` fingerprints the articles and flags any run against changed ones.

**The prompt is checked too.** For every client/contact question that reaches the model, the prompt's `<interpretation>` block must say which "client" the user meant ("'client' means a contact: one of the user's own customers"). A right article with a missing or wrong note fails the case.

Metrics are defined in `eval/metrics.js`:

- **Retrieval hit rate**: expected article ranked first (and in the top three) for answerable questions.
- **Citation validity**: answers whose citations all exist and were in the prompt, measured before the guardrail. It is trivially 100% offline and becomes meaningful with `--live`.
- **Refusal correctness**: recall on out-of-scope questions, precision of hand-offs, and the false-refusal rate on answerable ones. A suggestion counts as not answering, since it asserts nothing and offers Contact support.
- **Cost per question**[^cost]: averaged over all questions, including the free clarifications and escalations. It is what sending every question to Claude would cost. Token counts are exact for the exact prompt each question would send. The evaluation's answers come from the offline generator, so each answer is priced as its article's own text, a stand-in for what the model would write. Adaptive thinking tokens are left out. Without `eval/token-counts.json`, the evaluation falls back to an estimate of four characters per token. `ANTHROPIC_API_KEY=... npm run count:tokens` makes the exact counts from Anthropic's free token-counting endpoint, for this evaluation and for the model comparison's prompts and replies (`eval/token-counts.json`, saved by hash, so it holds no prompt text; then re-run `npm run eval`, `node eval/compare/score.mjs` and `npm run build`). Thinking still can't be counted that way. `ANTHROPIC_API_KEY=... npm run measure:usage -- --budget 12` goes further: it sends each of those prompts to each model as the demo would and saves the usage the API reports, thinking included (`eval/measured-usage.json`, also by hash). The evaluation and the comparison prefer measured usage over counts. It spends real credit, so it stops before a request could take it past the budget (US dollars at list prices), and a re-run resumes where it stopped.

The history and known issues are in `eval/history.json`, and the report page renders both.

## Which model is most cost-effective?

`eval/compare/` asks a different question: what if the model makes the answer / clarify / escalate decision itself? Every question from the four held-out sets (hold-out, perspective, hard hold-out and everyday voice; 131 after blocked and assistant questions are removed) gets up to five candidates, the top three from each search merged, look-alikes included. The prompt is `ROUTING_PROMPT` in `src/rag/prompt.js`.

| | No model (shipped) | Haiku 4.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|
| Pass rate | 49.6% | 86.3% | **91.6%** | 90.8% |
| Pass rate where search found the article | | 91.1% | **96.8%** | 96.0% |
| Everyday voice questions | | 36/46 | 38/46 | **39/46** |
| Wrong answers | 6 | 5 | 4 | 4 |
| Answers not faithful to the article (judged) | | 4 of 95 | 1 of 97 | 2 of 97 |
| Cost per 1,000 questions[^cost] | $0 | $1.55 | $4.16 | $8.41 |
| Cost per correct answer | $0 | **$0.0018** | $0.0045 | $0.0093 |

**Sonnet is the pick for this job.** Overall it matches Opus at half the price; Opus is one question better on the everyday voice set. Haiku has the lowest cost per correct answer, but it gets there with nearly twice as many bad answers (wrong article or invented detail). A bad answer costs a support ticket, which is worth far more than the $2.61 per thousand questions saved. Every model beats the shipped keyword policy, which is the case for putting a model in the decision once there is a budget for it. The baseline is graded slightly more leniently: a suggestion counts as a clarification or a hand-off, while a model must return exactly that decision.

How it was run, without API credits: each model ran as a Claude Code subagent, given the routing prompt and one question per file (`eval/compare/batches/`), and wrote one JSON reply per question (`eval/compare/replies/`). The decisions are real model output. Token counts for every prompt and every reply are exact, from Anthropic's token-counting endpoint (`npm run count:tokens`, saved in `eval/token-counts.json`), and priced at API list prices. The exact counts came out about 20% higher than the first estimate (four characters per token) for Haiku, and about 55% higher for Sonnet and Opus, which count the same prompts as about 28% more tokens than Haiku does. Thinking tokens can't be counted without running the model, so they are left out: the real cost of Sonnet and Opus, which both think by default, is higher than shown, while Haiku's is not. A separate Opus judge graded all 289 answers against their cited articles, pooled and shuffled with model names removed (`eval/compare/judging.mjs`). Opus grading Opus could favour it slightly, and Sonnet still came out ahead.

```bash
node eval/compare/prepare.mjs          # build prompts and batches
# ...each model writes eval/compare/replies/<model>/<case>.json
node eval/compare/judging.mjs prepare  # anonymise answers for the judge
node eval/compare/judging.mjs merge    # after grading
node eval/compare/score.mjs            # writes eval/compare/results.json for the report
node eval/compare/tiers.mjs            # replays the replies under each model-use tier
```

### Model use tiers

Can the model be skipped when keyword search is already confident? `eval/compare/tiers.mjs` replays the same 131 questions under each tier with Sonnet's recorded replies, so no new model calls are needed. Confidence is the coverage of search's top article. The 70% threshold was fixed before measuring.

| Policy (Sonnet 5.5) | Pass rate | Wrong answers | Calls a model | Cost per 1,000[^cost] |
|---|---|---|---|---|
| No model (offline mode) | 49.6% | 6 | 0% | $0.00 |
| 1. Full model (default) | 91.6% | 4 | 99% | $4.13 |
| 2. Prose only when search is ≥70%, else the model decides | 89.3% | 6 | 96% | $3.83 |
| 3. Offline when search is ≥70%, else the model decides | 89.3% | 6 | 73% | $3.05 |

**Full model is recommended; tiers 2 and 3 are included for evaluation.** Tier 3 is 26% cheaper per question, but it resolves 2.3 points fewer questions, about 23 more per 1,000 that end in a wrong answer or a hand-off, so it will likely raise the number of support tickets. That saves $1.08 per 1,000 questions, less than handling one ticket. Tier 2 saves only 7%, because writing prose costs nearly as much as deciding. Most of the model's value is where search is unsure: 52 of the 56 questions Sonnet rescues sit below the 55% hand-off line, which every tier still sends to the model.

The 70% figure is not meaningful on its own. Coverage is keyword overlap, not a calibrated probability, and the questions are bimodal: 78 sit below 55%, 29 at exactly 100%, and only 5 between 70% and 100%. Any threshold from 55% to 100% gives the same 89.3% pass rate and only changes cost ($2.48 to $3.21). The extra wrong answers are short, ambiguous questions such as "how do I change the status", which search covers 100%. Catching them would need an ambiguity signal, such as the gap to the second article, tested on fresh questions.

## Known limitations

- Unknown but harmless words ("typo", "keep", "paying") lower coverage. Long, conversational questions have many of them, so keyword search alone rarely answers them even when it ranks the right article first. Semantic suggestions turn most of these into suggestions instead of hand-offs, and in the model comparison a model making the decision passes 78 to 85% of the everyday voice questions.
- Lexical retrieval can't tell "send an invoice to a contact" (unsupported) from "where invoices are sent" (billing email). In Claude mode the model is instructed to escalate when the article doesn't answer the question.
- "We have a new office number" gets the company article. Without "our" or "account", nothing marks the number as the user's own.
- Semantic suggestions appear for some out-of-scope questions (20 of 49), because similarity can't tell a near miss from a match. They are suggestions, never answers, with Contact support underneath.
- At 29 short articles the whole help centre would fit in one cached prompt. Retrieval is still the right design here because it scales, makes every decision inspectable and keeps clarification and escalation deterministic and free.

## Layout

```
src/kb/articles.js        the help centre
src/crm/                  sample data, the in-memory store and record lookups (query.js)
src/kb/article-vectors.js precomputed article embeddings (generated)
src/rag/                  rewrite, retrieval, semantic index and HNSW graph, decision policy, prompt, generators, guardrail, pricing
models/                   vendored embedding model (q8 ONNX) with checksum
src/ui/                   CRM screens, demo guide, chat widget, retrieval panel, styles
eval/                     cases, runner, metrics, tuning history, results
eval/compare/             model comparison: prompts, replies, anonymised judging, scoring, model-use tiers
eval/scale/               vector index benchmark: flat scan vs HNSW up to 100,000 passages
eval/suite/               sister-product and withheld documents, blind suite questions, access-control runner
src/kb/suite-articles.json sister-product help articles (generated by scripts/build-suite.mjs)
src/kb/overview-articles.js overview pages for visitors (audience: everyone)
eval/viewer/              signed-in vs visitor questions and runner
eval/records/             record lookup questions and runner
scripts/build-suite.mjs   cleans the suite drafts and builds its vector index
scripts/embed-articles.mjs re-embeds the help centre into src/kb/article-vectors.js
report/template.html      the evaluation report page
scripts/build.js          single-file builds for publishing
docs/                     the built GitHub Pages site (regenerate with npm run eval && npm run build)
scripts/check-docs.mjs    browser check that the docs match the app
test/                     unit tests
```

[^cost]: Cost figures: token counts are exact as of 6 October 2026, from Anthropic's token-counting endpoint, and leave out thinking tokens. Prices are Anthropic's published API list prices in US dollars, checked 3 October 2026 (`src/rag/pricing.js`), before any tax or currency conversion. Prices and tokenizers change, so treat these figures as a snapshot rather than a quote.
