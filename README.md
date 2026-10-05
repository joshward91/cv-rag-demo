# Harbour CRM help assistant

A grounded retrieval-augmented help-desk assistant, built around a small CRM that exists only to give it something real to be accurate about.

- **The CRM** is a static web app with contacts, companies, deals, custom fields and a client profile (the account's own settings). It loads sample data on every page load, so a reload resets it.
- **The help centre** is 29 single-task articles. Each has an id, title, aliases ("also called"), a body and "not to be confused with" links. Every article describes a screen you can click through, and a browser check verifies that every bold UI label in the docs exists in the app.
- **The assistant** answers only from those articles, cites the article it used, asks a clarifying question when two articles are equally likely, and offers "Contact support" when nothing matches. Every reply has a **Show retrieval** panel with the rewritten query, scored articles, the decision and the exact prompt.
- **The evaluation suite** has 205 realistic phrasings across four sets, and the report shows retrieval hit rate, citation validity, refusal correctness and cost per question.

**Live demo:** https://joshward91.github.io/cv-rag-demo/ · **Evaluation report:** https://joshward91.github.io/cv-rag-demo/report.html

The hosted demo runs in offline mode, so it never spends anyone's tokens. Visitors can switch the assistant to Claude with their own API key, which stays in the browser tab and is billed to them.

The interesting part is not calling a model. It is everything around the call that decides whether an answer can be trusted.

## Running it

Requires Node 20 or later. There is no backend.

```bash
npm install
npm test                 # unit tests: retrieval, guardrail, generator contract, grading
npm run eval             # runs all 205 cases offline, writes eval/results.json
npm run check:docs       # browser check: docs labels exist in the UI, plus five walkthroughs
npm run build            # self-contained pages in dist/, plus the GitHub Pages site in docs/
npm run serve            # then open http://localhost:8080 to run from source
```

`npm run eval -- --live` generates answers with the Claude API instead of the offline generator and records measured token usage. It needs `ANTHROPIC_API_KEY`; `--model claude-sonnet-5-5` picks another model.

## How an answer is produced

```
question
  -> rewrite      normalise, phrase rules, synonyms, spelling        src/rag/analyze.js, lexicon.js
  -> retrieve     field-weighted BM25 over title, aliases, body       src/rag/retriever.js
  -> decide       answer / clarify / escalate                         src/rag/retriever.js
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

### Generate

The prompt (`src/rag/prompt.js`) gives the model the decided article and any close neighbours that aren't declared look-alikes. The system prompt explains that "client" in the articles means the user's own business. An `<interpretation>` block then carries what the query rewriter decided for this question, for example *"client" means a contact: one of the user's own customers, not the user's client profile*. The model doesn't have to resolve the clash again on its own.

All generators share one contract and are interchangeable:

| Generator | Where | What it does |
|---|---|---|
| `ExtractiveGenerator` | default, eval | Returns the cited article's own steps. Can't hallucinate, needs no key. |
| `AnthropicGenerator` | local, `--live` eval | Claude API via the official SDK, with the client injected. Defaults to Claude Opus 5.5 at low effort. The response is constrained by a JSON schema whose `citations` enum lists only the article ids in the prompt. Server-side refusal fallback is enabled. |
| `ClaudeAiGenerator` | published artifact | Claude through the claude.ai page runtime, which is used when direct API calls are blocked. |

### Verify

The output guardrail in `validateReply` runs on every model reply. An answer that cites nothing, cites only articles that weren't in the prompt, or contains a link is withheld and the user is offered support. Invented citations alongside a valid one are dropped. With the schema enum in place this should never fire on the API path; it exists for the runtime path, which has no schema, and as defence in depth.

### Grounding and prompt injection

The assistant is a SaaS help bot, so it must only ever explain Harbour CRM from its own help centre. Several independent layers enforce that:

1. **Input guard** (`src/rag/guard.js`). Before anything else, the raw question is screened for obvious injection: instruction overrides ("ignore previous instructions", including French and Spanish), fake system messages, role changes ("you are now", "act as"), requests for the prompt, jailbreak phrases, attempts to dictate the reply format, the prompt's own tags, long encoded strings, and questions over 500 characters. Spaced letters, leetspeak and accents are normalised first. A blocked question never reaches a model.
2. **Retrieval gate.** Off-topic requests ("find me a recipe for cake") don't cover enough of any article, so they are escalated before generation.
3. **No external access.** The model call sends no tools, tool choice or MCP servers, so the model cannot browse or fetch anything. It sees only the articles retrieval chose. A unit test asserts this.
4. **Hardened prompt.** The system prompt marks the question as untrusted and says to escalate anything other than Harbour CRM help. The question is escaped, so it can't close its `<question>` tag or inject new ones.
5. **Output guardrail.** The reply must match a JSON schema whose citations can only be the articles provided. An answer that cites none of them, or contains a link, is withheld.

6. **Browser policy.** The built site sets a content security policy that only allows network calls to `api.anthropic.com` and loads no third-party scripts. The Anthropic SDK is bundled into the page rather than fetched from a CDN. All rendered text, including model answers and CRM data, is HTML-escaped.

The guard is pattern-based and only catches the obvious cases. The later layers make an injection that slips past it harmless.

**Pen test.** The `redteam` set holds 38 probes: overrides, fake system messages, prompt extraction, role play, jailbreaks, obfuscated variants, harmful and off-topic asks, and XSS payloads. All pass, and a browser run of the XSS payloads through the chat and CRM forms triggers no script.

## Evaluation

`eval/cases.js` holds 205 questions with an expected outcome: answer from a given article, clarify between given articles, escalate, block as prompt injection, or explain the assistant's own settings. Cases are tagged (core example, terminology, synonym, paraphrase, typo, ambiguity, out of scope, near miss, prompt injection) and split five ways:

| Set | Cases | Role |
|---|---|---|
| dev | 52 | Tuned on from the start. |
| test | 49 | Written with dev. Scored blind once after round 1, then used for tuning in round 2. |
| holdout | 38 | Written after round 1 and before round 2 changed anything. Never tuned on. |
| redteam | 38 | A cursory pen test, added in round 8. |
| perspective | 12 | "Client" from both sides. Written after round 3, scored blind once, then one failure was tuned on in round 4. |

| Round | Dev | Test | Hold-out | Perspective |
|---|---|---|---|---|
| Baseline | 80.8% (blind) | | | |
| Round 1 | 98.1% | 73.5% (blind) | | |
| Round 2 | 100% | 95.9% | **84.2% (blind)** | |
| Round 3 | 100% | 95.9% | 84.2% (not tuned on) | **75.0% (blind)** |
| Round 4 | 100% | 95.9% | 84.2% (not tuned on) | 83.3% |
| Round 5 | 100% | 95.9% | 84.2% (not tuned on) | 91.7% |
| Round 6 | 100% | 95.9% | 84.2% (not tuned on) | 91.7% |
| Round 7 | 100% | 95.9% | 84.2% (not tuned on) | 91.7% |
| Round 8 | 100% | 95.9% | 84.2% (not tuned on) | 91.7% |

Round 5 switched the shipped help centre to the vendor's voice and added the prompt check, without changing any retrieval rule. Round 6 fixed a user-reported wrong answer: "change mode to online" got the deal stage article because spelling correction turned "mode" into "move". Short words are no longer corrected, and questions about the assistant itself now explain its answer modes. Round 7 added the prompt-injection defences above, with twelve cases, two of which check that ordinary questions are not blocked.

The hold-out figure is the honest estimate. Five of its six failures are questions escalated to support that the help centre could have answered; none got a wrong article. The core client/contact example passed 11 of 12 phrasings, and the forbidden article was never ranked first, offered, put in a prompt or cited. `npm run eval` exits non-zero if that ever changes, so it can gate CI.

**Articles are not edited to pass.** The help centre is written the way the vendor would write it, with "client" meaning the user's own business (**Settings > Client profile**). Retrieval problems are fixed in the query rewriting, the decision policy or the prompt. `eval/run.js` fingerprints the articles and flags any run against changed ones.

**The prompt is checked too.** For every client/contact question that reaches the model, the prompt's `<interpretation>` block must say which "client" the user meant ("'client' means a contact: one of the user's own customers"). A right article with a missing or wrong note fails the case.

Metrics are defined in `eval/metrics.js`:

- **Retrieval hit rate**: expected article ranked first (and in the top three) for answerable questions.
- **Citation validity**: answers whose citations all exist and were in the prompt, measured before the guardrail. It is trivially 100% offline and becomes meaningful with `--live`.
- **Refusal correctness**: recall on out-of-scope questions, precision of escalations, and the false-refusal rate on answerable ones.
- **Cost per question**: averaged over all questions, including the free clarifications and escalations. Offline runs estimate tokens from the exact prompt at four characters per token and leave out adaptive thinking tokens; `--live` replaces this with measured usage.

The history and known issues are in `eval/history.json`, and the report page renders both.

## Known limitations

- Unknown but harmless words ("typo", "keep", "paying") lower coverage and cause false refusals. This is the main hold-out failure mode, and it fails safe.
- Lexical retrieval can't tell "send an invoice to a contact" (unsupported) from "where invoices are sent" (billing email). In Claude mode the model is instructed to escalate when the article doesn't answer the question.
- "We have a new office number" gets the company article. Without "our" or "account", nothing marks the number as the user's own.
- Retrieval is lexical only. The next step would be hybrid retrieval with embeddings fused by reciprocal rank, measured against the same hold-out set, followed by a fresh hold-out set.
- At 29 short articles the whole help centre would fit in one cached prompt. Retrieval is still the right design here because it scales, makes every decision inspectable and keeps clarification and escalation deterministic and free.

## Layout

```
src/kb/articles.js        the help centre
src/crm/                  sample data and the in-memory store
src/rag/                  rewrite, retrieval, decision policy, prompt, generators, guardrail, pricing
src/ui/                   CRM screens, chat widget, retrieval panel, styles
eval/                     cases, runner, metrics, tuning history, results
report/template.html      the evaluation report page
scripts/build.js          single-file builds for publishing
docs/                     the built GitHub Pages site (regenerate with npm run eval && npm run build)
scripts/check-docs.mjs    browser check that the docs match the app
test/                     unit tests
```
