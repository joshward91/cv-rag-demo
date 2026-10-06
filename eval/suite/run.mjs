#!/usr/bin/env node
/**
 * Multi-product evaluation. Runs the original 304 questions and the blind
 * suite set (eval/suite/cases.json) against the Harbour CRM help centre on its
 * own and against the whole Harbour suite: 1,000 sister-product articles plus
 * the documents it must never show (internal, draft, archived, and legacy ones
 * with no status) in the same vector index (scripts/build-suite.mjs).
 *
 * Configurations, so each change can be read as a before and after:
 *   crm-flat      CRM only, every passage scanned (the old shipped setup)
 *   crm-hnsw      CRM only, HNSW graph (the current shipped setup)
 *   suite-flat    whole suite, public index, flat scan
 *   suite-hnsw    whole suite, public index, HNSW graph
 *   suite-acl     whole suite, withheld documents in the index too, filtered
 *   suite-no-acl  the same without the filter: what would leak without it
 *
 * Every row records every article id it surfaced anywhere (ranked results,
 * semantic matches, options, prompt context, citations, "also in" links), so
 * a withheld document showing up anywhere is counted as a leak. Published
 * results name a leaked document only by its status, so the report never
 * carries their ids outside its labelled appendix.
 *
 *   node eval/suite/run.mjs  -> eval/suite/results.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { articles } from '../../src/kb/articles.js';
import { Retriever } from '../../src/rag/retriever.js';
import { HelpDesk } from '../../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../../src/rag/generators.js';
import { SemanticIndex } from '../../src/rag/semantic.js';
import { Suite, SISTER_PRODUCTS, withheldReason } from '../../src/rag/suite.js';
import { createNodeEmbedder } from '../../src/rag/embedder.node.js';
import { articleVectors } from '../../src/kb/article-vectors.js';
import { cases as originalCases } from '../cases.js';
import { grade, summarise } from '../metrics.js';
import { interpretationNotes } from '../../src/rag/prompt.js';

const here = new URL('./', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, here), 'utf8'));
const sister = read('../../src/kb/suite-articles.json');
const withheld = read('withheld-articles.json');
// Ids of duplicate drafts merged by build-suite resolve to the article kept.
const merged = read('merged-ids.json');
const resolve = (id) => merged[id] ?? id;
const suiteCases = read('cases.json').map((c) => ({
  ...c,
  expect: {
    ...c.expect,
    ...(c.expect.article ? { article: resolve(c.expect.article) } : {}),
    ...(c.expect.mustInclude ? { mustInclude: c.expect.mustInclude.map(resolve) } : {}),
    ...(c.expect.alsoIn ? { alsoIn: c.expect.alsoIn.map(resolve) } : {}),
  },
}));
const withheldById = new Map(withheld.map((a) => [a.id, a]));
/** A withheld id as published: its status only. */
const redact = (id) => (withheldById.has(id) ? `(${withheldReason(withheldById.get(id))} document)` : id);
const countBy = (ids) => Object.fromEntries(Object.entries(Object.groupBy(ids, (id) => withheldReason(withheldById.get(id)))).map(([k, v]) => [k, v.length]));

function loadIndex(name, { graph }) {
  const meta = read(`index/${name}.json`);
  const bin = new Int8Array(readFileSync(new URL(`index/${name}.bin`, here)));
  const passages = meta.passages.map((p, i) => ({ ...p, q: bin.subarray(i * meta.dim, (i + 1) * meta.dim) }));
  return new SemanticIndex(passages, { graph: graph ? read(`index/${name}.graph.json`) : null });
}

const indexes = {
  'crm-flat': new SemanticIndex(articleVectors.passages),
  'crm-hnsw': new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph }),
  'suite-flat': loadIndex('public', { graph: false }),
  'suite-hnsw': loadIndex('public', { graph: true }),
  'suite-acl': loadIndex('all', { graph: true }),
};
indexes['suite-no-acl'] = indexes['suite-acl'];

const embedder = await createNodeEmbedder();
const productOf = (name) => (a) => a.product === name;

/** A help desk for one configuration. Without the filter, withheld documents join their product's retriever. */
function desk(config) {
  const semantic = indexes[config];
  const leaky = config === 'suite-no-acl';
  const withInternal = (list, name) => (leaky ? [...list, ...withheld.filter((a) => a.product === name || (name === 'Harbour CRM' && a.product === 'Harbour (all products)'))] : list);
  const crm = new Retriever(withInternal(articles, 'Harbour CRM'), {}, { semantic });
  if (config.startsWith('crm')) return new HelpDesk({ retriever: crm, generator: new ExtractiveGenerator(), embedder });
  const products = SISTER_PRODUCTS.map((p) => ({
    key: p.key,
    retriever: new Retriever(withInternal(sister.filter(productOf(p.name)), p.name), {}, { semantic, plain: true }),
  }));
  return new HelpDesk({ retriever: crm, generator: new ExtractiveGenerator(), embedder, suite: new Suite(products, { allowInternal: leaky }), allowInternal: leaky });
}

async function run(config, cases) {
  const helpDesk = desk(config);
  const rows = [];
  let semanticMs = 0;
  for (const c of cases) {
    const started = performance.now();
    const result = await helpDesk.ask(c.query);
    semanticMs += performance.now() - started;
    const surfaced = new Set([
      ...result.retrieval.results.map((r) => r.id),
      ...(result.retrieval.semantic ?? []).map((r) => r.id),
      ...(result.outcome.options ?? []).map((o) => o.id),
      ...(result.prompt?.contextIds ?? []),
      ...(result.outcome.citations ?? []),
      ...(result.alsoIn ?? []).map((a) => a.id),
    ]);
    const row = {
      id: c.id,
      split: c.split,
      tags: c.tags,
      query: c.query,
      expect: c.expect,
      product: result.product ?? null,
      outcome: result.outcome.type,
      options: result.outcome.options?.map((o) => o.id) ?? [],
      citations: result.outcome.citations ?? [],
      contextIds: result.prompt?.contextIds ?? [],
      rawCitations: result.reply?.citations ?? [],
      alsoIn: (result.alsoIn ?? []).map((a) => a.id),
      rank: result.retrieval.results.map((r) => r.id),
      interpretation: result.prompt ? interpretationNotes(result.retrieval.analysis) : [],
      guardrail: result.guardrail,
      leaked: [...surfaced].filter((id) => withheldById.has(id)),
    };
    Object.assign(row, grade(row));
    if (row.leaked.length) row.pass = false;
    if (c.expect.alsoIn) row.alsoInHit = c.expect.alsoIn.some((id) => row.alsoIn.includes(id));
    rows.push(row);
  }
  return { rows, msPerQuestion: semanticMs / cases.length };
}

const kbIds = new Set([...articles, ...sister].map((a) => a.id));
const configs = ['crm-flat', 'crm-hnsw', 'suite-flat', 'suite-hnsw', 'suite-acl', 'suite-no-acl'];
const out = { generatedAt: new Date().toISOString(), articles: { crm: articles.length, sister: sister.length, withheld: withheld.length, withheldByStatus: countBy(withheld.map((a) => a.id)) }, passages: Object.fromEntries(Object.entries(indexes).map(([k, v]) => [k, v.passages.length])), configs: {} };
const baseline = (await run('crm-flat', originalCases)).rows;
for (const config of configs) {
  const original = config === 'crm-flat' ? { rows: baseline, msPerQuestion: null } : await run(config, originalCases);
  const suite = config.startsWith('suite') ? await run(config, suiteCases) : null;
  const changed = original.rows.filter((r, i) => r.outcome !== baseline[i].outcome || r.citations.join() !== baseline[i].citations.join() || r.options.join() !== baseline[i].options.join());
  const bySuiteTag = suite && Object.fromEntries(['named', 'other-only', 'crm-also', 'internal-bait', 'crm-only'].map((t) => {
    const rs = suite.rows.filter((r) => r.tags.includes(t));
    // Useful: passed, or the expected article was offered as an option.
    const offered = (r) => [r.expect.article, ...(r.expect.mustInclude ?? [])].some((id) => id && r.options.includes(id)) && !r.leaked.length;
    return [t, { cases: rs.length, passed: rs.filter((r) => r.pass).length, useful: rs.filter((r) => r.pass || offered(r)).length }];
  }));
  out.configs[config] = {
    original: { ...summarise(original.rows, kbIds), changedFromBefore: changed.map((r) => ({ id: r.id, query: r.query, before: `${baseline.find((b) => b.id === r.id).outcome}`, after: r.outcome, options: r.options.map(redact) })), leaks: original.rows.filter((r) => r.leaked.length).length, leaksByStatus: countBy([...new Set(original.rows.flatMap((r) => r.leaked))]), msPerQuestion: original.msPerQuestion },
    suite: suite && {
      cases: suite.rows.length,
      passed: suite.rows.filter((r) => r.pass).length,
      byTag: bySuiteTag,
      alsoIn: { cases: suite.rows.filter((r) => r.expect.alsoIn).length, hit: suite.rows.filter((r) => r.alsoInHit).length },
      leaks: suite.rows.filter((r) => r.leaked.length).length,
      leaksByStatus: countBy([...new Set(suite.rows.flatMap((r) => r.leaked))]),
      rows: config === 'suite-acl' ? suite.rows.map(({ id, tags, query, expect: { bait, ...expect }, product, outcome, options, citations, alsoIn, pass }) => ({ id, tags, query, expect, product, outcome, options, citations, alsoIn, pass })) : undefined,
    },
  };
  const o = out.configs[config];
  console.log(`${config.padEnd(13)} original ${(o.original.passRate * 100).toFixed(1)}% (changed ${o.original.changedFromBefore.length}, leaks ${o.original.leaks})${o.suite ? `  suite ${o.suite.passed}/${o.suite.cases}, also-in ${o.suite.alsoIn.hit}/${o.suite.alsoIn.cases}, leaks ${o.suite.leaks}` : ''}`);
}
writeFileSync(new URL('results.json', here), `${JSON.stringify(out, null, 1)}\n`);
