#!/usr/bin/env node
/**
 * Signed in vs signed out. Harbour CRM's help centre has two audiences:
 * 29 task articles for signed-in customers, and 15 overview pages for
 * everyone (src/kb/overview-articles.js). Signed out, the assistant only
 * sees the overview pages. Signed in, it sees both, with the task help first
 * (viewerRetriever in src/rag/suite.js).
 *
 * Configurations, so each change reads as a before and after:
 *   before        task articles only (the help centre before overview pages)
 *   in-unweighted signed in, both sets, no weighting
 *   in-weighted   signed in, both sets, overview pages' scores halved
 *   in-blended    signed in, each set scored on its own, an overview answer wins
 *                 when its coverage × 0.5 beats the best task article's
 *   in-tiered     signed in, task help first, overview pages as a fallback (shipped)
 *   out           signed out, overview pages only (shipped)
 *
 * The 48 questions in eval/viewer/cases.json were written by a separate agent
 * that read only the articles, and were scored once. The original 304
 * questions are re-run signed in, to show what adding the overview pages
 * changed for customers.
 *
 *   node eval/viewer/run.mjs  -> eval/viewer/results.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { articles } from '../../src/kb/articles.js';
import { overviewArticles } from '../../src/kb/overview-articles.js';
import { articleVectors } from '../../src/kb/article-vectors.js';
import { Retriever } from '../../src/rag/retriever.js';
import { HelpDesk } from '../../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../../src/rag/generators.js';
import { SemanticIndex } from '../../src/rag/semantic.js';
import { canSee, viewerWeight, viewerRetriever, OVERVIEW_POLICY } from '../../src/rag/suite.js';
import { createNodeEmbedder } from '../../src/rag/embedder.node.js';
import { cases as originalCases } from '../cases.js';
import { grade, summarise } from '../metrics.js';
import { interpretationNotes } from '../../src/rag/prompt.js';

const here = new URL('./', import.meta.url);
const viewerCases = JSON.parse(readFileSync(new URL('cases.json', here), 'utf8'));
const all = [...articles, ...overviewArticles];
const semantic = new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph });
const embedder = await createNodeEmbedder();

/** The help centre a viewer gets: what they may see, ranked for them. */
const CONFIGS = {
  before: () => new Retriever(articles, {}, { semantic }),
  'in-unweighted': () => new Retriever(all.filter((a) => canSee(a, { loggedIn: true })), {}, { semantic }),
  'in-weighted': () => new Retriever(all.filter((a) => canSee(a, { loggedIn: true })), {}, { semantic, weight: viewerWeight({ loggedIn: true }) }),
  'in-blended': () => new Retriever(articles, {}, { semantic, fallback: new Retriever(overviewArticles, OVERVIEW_POLICY, { semantic }), fallbackWeight: 0.5 }),
  'in-tiered': () => viewerRetriever(all, { loggedIn: true }, { semantic }),
  out: () => viewerRetriever(all, { loggedIn: false }, { semantic }),
};

async function run(config, cases) {
  const desk = new HelpDesk({ retriever: CONFIGS[config](), generator: new ExtractiveGenerator(), embedder });
  const rows = [];
  for (const c of cases) {
    const result = await desk.ask(c.query);
    const row = {
      id: c.id,
      split: c.split,
      tags: c.tags,
      loggedIn: c.loggedIn,
      query: c.query,
      expect: c.expect,
      outcome: result.outcome.type,
      options: result.outcome.options?.map((o) => o.id) ?? [],
      citations: result.outcome.citations ?? [],
      contextIds: result.prompt?.contextIds ?? [],
      rawCitations: result.reply?.citations ?? [],
      rank: result.retrieval.results.map((r) => r.id),
      interpretation: result.prompt ? interpretationNotes(result.retrieval.analysis) : [],
      guardrail: result.guardrail,
    };
    Object.assign(row, grade(row));
    rows.push(row);
  }
  return rows;
}

const kbIds = new Set(all.map((a) => a.id));
const signedIn = viewerCases.filter((c) => c.loggedIn);
const signedOut = viewerCases.filter((c) => !c.loggedIn);
const brief = (rows) => rows.map(({ id, loggedIn, tags, query, expect, outcome, citations, options, pass }) => ({ id, loggedIn, tags, query, expect, outcome, citations, options, pass }));
// Useful: passed, or the expected article was offered as an option.
const useful = (r) => r.pass || (r.expect.article && r.options.includes(r.expect.article));
const score = (rows) => ({ cases: rows.length, passed: rows.filter((r) => r.pass).length, useful: rows.filter(useful).length });

const out = { generatedAt: new Date().toISOString(), articles: { tasks: articles.length, overview: overviewArticles.length }, configs: {} };
const baseline = await run('before', originalCases);
for (const config of Object.keys(CONFIGS)) {
  const viewer = await run(config, config === 'out' ? signedOut : signedIn);
  const entry = { viewer: { ...score(viewer), rows: brief(viewer) } };
  // Signed out has no task articles, so the original questions don't apply.
  if (config !== 'out') {
    const original = config === 'before' ? baseline : await run(config, originalCases);
    const changed = original.filter((r, i) => r.outcome !== baseline[i].outcome || r.citations.join() !== baseline[i].citations.join() || r.options.join() !== baseline[i].options.join());
    const s = summarise(original, kbIds);
    entry.original = {
      cases: s.cases,
      passRate: s.passRate,
      usefulRate: s.suggestions.usefulRate,
      overviewCited: original.filter((r) => r.citations.some((id) => id.startsWith('overview-'))).length,
      changed: changed.map((r) => ({ id: r.id, query: r.query, before: `${baseline.find((b) => b.id === r.id).outcome} ${baseline.find((b) => b.id === r.id).citations.join(' ')}`.trim(), after: `${r.outcome} ${[...r.citations, ...r.options].join(' ')}`.trim(), pass: r.pass })),
    };
  }
  out.configs[config] = entry;
  const o = entry.original;
  console.log(`${config.padEnd(14)} viewer ${entry.viewer.passed}/${entry.viewer.cases} (useful ${entry.viewer.useful})${o ? `  original ${(o.passRate * 100).toFixed(1)}% (changed ${o.changed.length}, overview cited ${o.overviewCited})` : ''}`);
}
writeFileSync(new URL('results.json', here), `${JSON.stringify(out, null, 1)}\n`);
