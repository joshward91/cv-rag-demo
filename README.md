# Harbour CRM help assistant

A grounded retrieval-augmented help-desk assistant, built around a small CRM that exists only to give it something real to be accurate about.

It answers only from the CRM's own help centre, never from the model's general knowledge or the web, and cites the article behind every answer. Retrieval is hybrid: **keyword search** (BM25F with a coverage-based decision policy) plus **semantic search** (all-MiniLM-L6-v2 sentence embeddings, run in the visitor's browser). A deterministic policy then answers, asks a clarifying question, suggests close matches or hands over to support, before any model is called.

- **The CRM** is a static web app with contacts, companies, deals, custom fields and a client profile (the account's own settings). It loads sample data on every page load, so a reload resets it.
- **The help centre** is 29 short articles: 27 single-task how-tos, a glossary and a note about the demo data. Each has an id, title, aliases ("also called"), a body and "not to be confused with" links. Every how-to describes a screen you can click through, and a browser check verifies that every bold UI label in the docs exists in the app.
- **The assistant** answers only from those articles, cites the article it used, asks a clarifying question when two articles are equally likely, suggests the closest articles when keyword search can't decide but the meaning matches, and offers "Contact support" when nothing matches. Every reply has a **Show retrieval** panel with the rewritten query, scored articles, the decision and the exact prompt.
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

The vocabulary problem in this product is deliberate: in Harbour CRM the **client** is the business using the CRM, and a **contact** is the client's customer. Users don't talk like that. "How do I update a client's phone number" means a contact's phone number, and it must never retrieve the article about the account's own *client contact number*.

The articles use the vendor's terms: **client** is the user's own business and **contact** is one of its customers. The word means different things depending on who wrote it. The help centre is written by the vendor, for whom the client is the business paying for Harbour CRM. Questions come from that business, for whom a client is one of their own customers. A contact is the client's client. So the rewrite stage is perspective-aware: everything in an article (title, aliases and body) is analysed as the vendor's voice, and questions as the user's.

1. Terms of art are protected first on both sides. "client contact number", "our phone number", "the number on our account" and "the number support calls us on" become one token, `clientcontactnumber`.
2. In articles, "client" becomes `account`, and "client phone number" or "client name" become the account's own settings.
3. In questions, "client" and "customer" become "contact", unless the phrase is plainly about the user's own account ("our client profile", "as a client"). Possessives are kept as a separate token, so "a client's contact number" is not mistaken for the term of art.
4. Synonyms collapse to concepts (update, change, modify → `edit`), and spelling is corrected by edit distance against the help centre's vocabulary.

Every rule that fires is recorded and shown in the retrieval panel.

### Retrieve and decide

Retrieval is a simplified BM25F: title, aliases and body are scored separately and weighted 3 : 2 : 1. Raw BM25 scores aren't comparable across queries, so the decision policy uses **coverage** as well: the IDF-weighted share of the question's terms that an article explains. Terms found only in the body count for half, because bodies mention neighbouring tasks ("to change a contact's number, edit the contact instead").

- **Escalate** when the best article covers less than 55% of the question. A word the help centre never uses ("import", "password") counts against coverage, capped at the weight of the most specific recognised word.
- **Clarify** when a rival article scores close to the top one (60% if the docs declare the two as easy to confuse, 95% otherwise) *and* the rival's title or aliases cover every term the top article's do. A question that names only an action ("delete") also gets a clarifying question.
- **Answer** otherwise. The prompt gets the answer article plus up to two other strong matches, but never an article the docs list under "not to be confused with". Handing the model a look-alike invites it to blend the two.

Clarification and escalation happen before any model call, so they are deterministic and free.

### Semantic suggestions (hybrid retrieval)

Keyword search fails on paraphrases that share no words with an article: "they signed the contract" is about marking a deal as won. So a small sentence-embedding model (all-MiniLM-L6-v2, 384 dimensions, 8-bit quantised) runs alongside BM25.

- **Offline indexing.** `scripts/embed-articles.mjs` embeds every article as separate passages: the title, each alias and each body sentence. That produces 292 vectors, stored as int8 in `src/kb/article-vectors.js` (about 320 KB) with a fingerprint of the articles they came from.
- **In the browser.** Only the question is embedded, on the visitor's machine via ONNX Runtime Web (WebAssembly). Tokenisation is a small WordPiece implementation (`src/rag/wordpiece.js`), and a unit test checks it matches the reference Hugging Face tokenizer on every passage and eval question. Node and the browser share the same model, tokenizer and pooling code (`src/rag/minilm.js`). Only the runtime differs (native ONNX Runtime in Node, single-threaded WebAssembly in the browser), so similarities can differ in the low decimal places. The model and runtime are served from this site, not a CDN, so the question never leaves the page and offline mode stays free. The first chat open downloads about 37 MB once. The question is embedded after the rewrite step, so "client" has already become "contact" and the perspective rules still apply.
- **Keyword search decides first.** Semantic search only acts when keyword search would escalate. If the best match is at least 0.45 similar (cosine similarity, with body sentences weighted ×0.9), the user is offered up to three articles within 0.08 of the best, and declared look-alikes are never offered together. A suggestion makes no model call.

**Why it only suggests.** On dev data, raw similarity couldn't separate right matches from near misses: "import contacts" (unsupported) scores 0.78 against the export article, higher than many correct paraphrases. Answering on similarity alone would have meant confident wrong answers. Suggesting means a wrong match costs the user one click to Contact support.

**Why no vector database.** 292 vectors take under a millisecond to search with a dot product in memory. At hundreds of thousands of passages I would move them to pgvector next to the articles and keep the same decide-first policy.

The model weights are the original Xenova/all-MiniLM-L6-v2 q8 ONNX export, vendored in `models/` with a SHA-256 in `models/CHECKSUM.json`. Node and the browser both load these vendored files directly, so nothing is fetched from a model hub.

### Generate

The prompt (`src/rag/prompt.js`) gives the model the decided article and any close neighbours that aren't declared look-alikes. The system prompt explains that "client" in the articles means the user's own business. An `<interpretation>` block then carries what the query rewriter decided for this question, for example *"client" means a contact: one of the user's own customers, not the user's client profile*. The model doesn't have to resolve the clash again on its own.

All generators share one contract and are interchangeable:

| Generator | Where | What it does |
|---|---|---|
| `ExtractiveGenerator` | default, eval | Returns the cited article's own steps. Can't hallucinate, needs no key. |
| `AnthropicGenerator` | local, `--live` eval | Claude API via the official SDK, with the client injected. Defaults to Claude Sonnet 5.5, the model the comparison below favours. Low effort is a separate cost choice that the comparison didn't measure. The response is constrained by a JSON schema whose `citations` enum lists only the article ids in the prompt. Server-side refusal fallback is enabled. |
| `ClaudeAiGenerator` | published artifact | Claude through the claude.ai page runtime, which is used when direct API calls are blocked. |

### Verify

The output guardrail in `validateReply` runs on every model reply. An answer that cites nothing, cites only articles that weren't in the prompt, or contains a link is withheld and the user is offered support. Invented citations alongside a valid one are dropped. With the schema enum in place, the invented-citation check should never fire on the API path. The empty-citation and link checks still can, because the schema doesn't enforce them, and the runtime path has no schema at all.

### Grounding and prompt injection

The assistant is a SaaS help bot, so it must only ever explain Harbour CRM from its own help centre. Several independent layers enforce that:

1. **Input guard** (`src/rag/guard.js`). Before retrieval or any model call, the raw question is screened for obvious injection: instruction overrides ("ignore previous instructions", including French and Spanish), fake system messages, role changes ("you are now", "act as"), requests for the prompt, jailbreak phrases, attempts to dictate the reply format, the prompt's own tags, long encoded strings, and questions over 500 characters. Spaced letters, leetspeak and accents are normalised first. A blocked question never reaches a model.
2. **Retrieval gate.** Off-topic requests ("find me a recipe for cake") don't cover enough of any article, so they are escalated before generation.
3. **No external access.** The model call sends no tools, tool choice or MCP servers, so the model cannot browse or fetch anything. It sees only the articles retrieval chose. A unit test asserts this.
4. **Hardened prompt.** The system prompt marks the question as untrusted and says to escalate anything other than Harbour CRM help. The question is escaped, so it can't close its `<question>` tag or inject new ones.
5. **Output guardrail.** The reply must match a JSON schema whose citations can only be the articles provided. An answer that cites none of them, or contains a link, is withheld.

6. **Browser policy.** The built site sets a content security policy. Apart from the site itself and Google Fonts, its only allowed network calls are to `api.anthropic.com`, and it loads no third-party scripts. The Anthropic SDK is bundled into the page rather than fetched from a CDN. All rendered text, including model answers and CRM data, is HTML-escaped.

The guard is pattern-based and only catches the obvious cases. The later layers make an injection that slips past it harmless.

**Pen test.** The `redteam` set holds 38 probes: overrides, fake system messages, prompt extraction, role play, jailbreaks, obfuscated variants, harmful and off-topic asks, and XSS payloads. All pass. A one-off manual browser run of the XSS payloads through the chat and CRM forms triggered no script; that check is not automated.

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
- **Cost per question**: averaged over all questions, including the free clarifications and escalations. Offline runs estimate tokens from the exact prompt at four characters per token and leave out adaptive thinking tokens; `--live` replaces this with measured usage.

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
| Cost per 1,000 questions | $0 | $1.29 | $2.68 | $5.41 |
| Cost per correct answer | $0 | **$0.0015** | $0.0029 | $0.0060 |

**Sonnet is the pick for this job.** Overall it matches Opus at half the price; Opus is one question better on the everyday voice set. Haiku has the lowest cost per correct answer, but it gets there with nearly twice as many bad answers (wrong article or invented detail). A bad answer costs a support ticket, which is worth far more than the $1.39 per thousand questions saved. Every model beats the shipped keyword policy, which is the case for putting a model in the decision once there is a budget for it. The baseline is graded slightly more leniently: a suggestion counts as a clarification or a hand-off, while a model must return exactly that decision.

How it was run, without API credits: each model ran as a Claude Code subagent, given the routing prompt and one question per file (`eval/compare/batches/`), and wrote one JSON reply per question (`eval/compare/replies/`). The decisions are real model output. Tokens are estimated from the prompt and reply text and priced at API list prices, so thinking tokens are left out: the real cost of Sonnet and Opus, which both think by default, is higher than shown, while Haiku's is not. A separate Opus judge graded all 289 answers against their cited articles, pooled and shuffled with model names removed (`eval/compare/judging.mjs`). Opus grading Opus could favour it slightly, and Sonnet still came out ahead.

```bash
node eval/compare/prepare.mjs          # build prompts and batches
# ...each model writes eval/compare/replies/<model>/<case>.json
node eval/compare/judging.mjs prepare  # anonymise answers for the judge
node eval/compare/judging.mjs merge    # after grading
node eval/compare/score.mjs            # writes eval/compare/results.json for the report
```

## Known limitations

- Unknown but harmless words ("typo", "keep", "paying") lower coverage. Long, conversational questions have many of them, so keyword search alone rarely answers them even when it ranks the right article first. Semantic suggestions turn most of these into suggestions instead of hand-offs, and in the model comparison a model making the decision passes 78 to 85% of the everyday voice questions.
- Lexical retrieval can't tell "send an invoice to a contact" (unsupported) from "where invoices are sent" (billing email). In Claude mode the model is instructed to escalate when the article doesn't answer the question.
- "We have a new office number" gets the company article. Without "our" or "account", nothing marks the number as the user's own.
- Semantic suggestions appear for some out-of-scope questions (20 of 49), because similarity can't tell a near miss from a match. They are suggestions, never answers, with Contact support underneath.
- At 29 short articles the whole help centre would fit in one cached prompt. Retrieval is still the right design here because it scales, makes every decision inspectable and keeps clarification and escalation deterministic and free.

## Layout

```
src/kb/articles.js        the help centre
src/crm/                  sample data and the in-memory store
src/kb/article-vectors.js precomputed article embeddings (generated)
src/rag/                  rewrite, retrieval, semantic index, decision policy, prompt, generators, guardrail, pricing
models/                   vendored embedding model (q8 ONNX) with checksum
src/ui/                   CRM screens, chat widget, retrieval panel, styles
eval/                     cases, runner, metrics, tuning history, results
eval/compare/             model comparison: prompts, replies, anonymised judging, scoring
scripts/embed-articles.mjs re-embeds the help centre into src/kb/article-vectors.js
report/template.html      the evaluation report page
scripts/build.js          single-file builds for publishing
docs/                     the built GitHub Pages site (regenerate with npm run eval && npm run build)
scripts/check-docs.mjs    browser check that the docs match the app
test/                     unit tests
```
