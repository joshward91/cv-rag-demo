#!/usr/bin/env node
/**
 * Model comparison, step 3: model-use tiers. Replays the 131 held-out
 * questions using results already recorded, so it needs no new model calls.
 * Confidence is the keyword coverage of search's top article.
 *
 *   1. Full model   the model decides every question (the routed replies
 *                   in eval/compare/replies/).
 *   2. Prose only   at or above the threshold, search's decision stands
 *                   and the model only writes the answer from the article
 *                   search chose. Graded by search's choice; priced as the
 *                   generation prompt (eval/results.json). Below it, the
 *                   model decides.
 *   3. Offline      at or above the threshold, the offline result with no
 *                   model call. Below it, the model decides.
 *
 * Blocked questions never reach a model.
 *
 * The 70% threshold was fixed before this ran (it is Josh's suggested
 * default); the sweep shows sensitivity, it was not used to pick a value.
 *
 *   node eval/compare/tiers.mjs  -> eval/compare/tiers.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MODELS } from '../../src/rag/pricing.js';
import { MODEL_TIERS } from '../../src/rag/pipeline.js';

const dir = new URL('./', import.meta.url);
const shipped = new Map(JSON.parse(readFileSync(new URL('../results.json', dir), 'utf8')).rows.map((r) => [r.id, r]));
const compare = JSON.parse(readFileSync(new URL('results.json', dir), 'utf8'));
const ids = [...new Set(compare.rows.map((r) => r.id))];
const routed = new Map(compare.rows.map((r) => [`${r.model}:${r.id}`, r]));
const routedCost = new Map(compare.models.map((m) => [m.key, m.costPerQuestion]));

const wrongAnswer = (r) => r.outcome === 'answer' && !(r.expect.type === 'answer' && r.citations.includes(r.expect.article));
const confidenceOf = (r) => r.ranked?.[0]?.coverage ?? 0;

/** saving: 'prose' | 'offline' | null; the model call is saved when confidence >= threshold. */
function simulate(modelKey, threshold, saving) {
  const model = compare.models.find((m) => m.key === modelKey).model;
  const t = { decides: 0, prose: 0, offline: 0 };
  let passed = 0;
  let wrong = 0;
  let cost = 0;
  for (const id of ids) {
    const r = shipped.get(id);
    if (r.outcome === 'blocked') {
      t.offline++;
      passed += r.pass ? 1 : 0;
      continue;
    }
    const confident = confidenceOf(r) >= threshold;
    const save = saving !== null && confident;
    if (!save) {
      const m = routed.get(`${modelKey}:${id}`);
      t.decides++;
      cost += routedCost.get(modelKey);
      passed += m.pass ? 1 : 0;
      wrong += m.wrongAnswer ? 1 : 0;
      continue;
    }
    // Search's decision stands. Prose only adds a model call when it answers.
    if (saving === 'prose' && r.outcome === 'answer') {
      t.prose++;
      cost += r.costByModel?.[model] ?? 0;
    } else {
      t.offline++;
    }
    passed += r.pass ? 1 : 0;
    wrong += wrongAnswer(r) ? 1 : 0;
  }
  return { threshold, tiers: t, calls: (t.decides + t.prose) / ids.length, passed, passRate: passed / ids.length, wrongAnswers: wrong, cost, costPer1000Questions: (cost / ids.length) * 1000 };
}

const thresholds = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
const sweep = (key, saving) => thresholds.map((th) => simulate(key, th, saving));
const bands = [[0, 0.55], [0.55, 0.7], [0.7, 1], [1, Infinity]].map(([lo, hi]) => {
  const rows = ids.map((id) => shipped.get(id)).filter((r) => r.outcome !== 'blocked' && confidenceOf(r) >= lo && confidenceOf(r) < hi);
  // Questions the model gets right that search alone gets wrong, per model.
  const rescued = Object.fromEntries(compare.models.map((m) => [m.key, rows.filter((r) => !r.pass && routed.get(`${m.key}:${r.id}`).pass).length]));
  return { from: lo, to: hi === Infinity ? 1 : hi, questions: rows.length, searchPassed: rows.filter((r) => r.pass).length, rescued };
});
const out = {
  questions: ids.length,
  defaultThreshold: MODEL_TIERS.skipModelAtCoverage,
  bands,
  models: compare.models.map((m) => ({
    key: m.key,
    label: m.label,
    full: simulate(m.key, 0, null),
    alwaysModel: { passRate: m.passRate, wrongAnswers: m.wrongAnswers, costPer1000Questions: m.costPer1000Questions },
    prose: sweep(m.key, 'prose'),
    offline: sweep(m.key, 'offline'),
  })),
  noModel: { passRate: compare.baseline.passed / compare.baseline.cases, wrongAnswers: compare.baseline.wrongAnswers, costPer1000Questions: 0 },
};
writeFileSync(new URL('tiers.json', dir), `${JSON.stringify(out, null, 1)}\n`);
const fmt = (s) => `${(s.passRate * 100).toFixed(1)}%  wrong ${s.wrongAnswers}  calls ${(s.calls * 100).toFixed(0)}%  $${s.costPer1000Questions.toFixed(2)}/1000`;
for (const m of out.models) {
  console.log(`${m.label}: full model ${fmt(m.full)} (recorded ${(m.alwaysModel.passRate * 100).toFixed(1)}%)`);
  for (const saving of ['prose', 'offline']) {
    for (const s of m[saving]) console.log(`   ${saving} at ${s.threshold}+: ${fmt(s)}`);
  }
}
console.log('Bands:', JSON.stringify(bands));
console.log(`No model: ${(out.noModel.passRate * 100).toFixed(1)}%, wrong ${out.noModel.wrongAnswers}`);
