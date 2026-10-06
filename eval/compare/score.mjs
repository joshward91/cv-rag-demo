#!/usr/bin/env node
/**
 * Model comparison, step 2: grade each model's replies to the model-routed
 * prompts and price them. Writes eval/compare/results.json for the report.
 *
 *   node eval/compare/score.mjs
 *
 * Replies live in eval/compare/replies/<model>/<case id>.json. Optional answer
 * quality grades from a separate judge live in eval/compare/judgements/<model>.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cases } from '../cases.js';
import { MODELS, estimateTokens, costUsd } from '../../src/rag/pricing.js';
import { loadCounts, loadMeasured } from '../token-counts.js';

// Exact token counts from eval/count-tokens.mjs, when it has been run.
const counted = loadCounts();
const measured = loadMeasured();

const dir = new URL('./', import.meta.url);
const { prompts, splits } = JSON.parse(readFileSync(new URL('prompts.json', dir), 'utf8'));
const byId = new Map(cases.map((c) => [c.id, c]));

// Which model id each run stands in for.
const RUNS = [
  { key: 'haiku', model: 'claude-haiku-4-5' },
  { key: 'sonnet', model: 'claude-sonnet-5-5' },
  { key: 'opus', model: 'claude-opus-5-5' },
];

function gradeReply(c, prompt, reply) {
  const expect = c.expect;
  const cited = reply.citations ?? [];
  const neverCited = (expect.never ?? []).some((id) => cited.includes(id));
  let pass = false;
  if (expect.type === 'answer') pass = reply.type === 'answer' && cited.includes(expect.article);
  // Only the look-alikes the model was actually shown can be asked about.
  else if (expect.type === 'clarify') pass = reply.type === 'clarify' && expect.mustInclude.filter((id) => prompt.candidates.includes(id)).every((id) => cited.includes(id));
  else pass = reply.type === 'escalate';
  // A wrong answer is the costly failure: an answer to an out-of-scope or
  // ambiguous question, or one from the wrong article. Asking or escalating
  // when an answer existed is a safe miss.
  const wrongAnswer = reply.type === 'answer' && !(expect.type === 'answer' && cited.includes(expect.article));
  return { pass: pass && !neverCited, neverCited, wrongAnswer };
}

// Answer questions whose article search never put in front of the model: no model can pass these.
const unreachable = prompts.filter((p) => { const c = byId.get(p.id); return c.expect.type === 'answer' && !p.candidates.includes(c.expect.article); }).map((p) => p.id);
const results = { unreachable, countedAt: counted?.countedAt ?? null, measuredAt: null, generatedAt: new Date().toISOString(), splits, questions: prompts.length, models: [], rows: [] };

// Baseline: the shipped pipeline (keyword + semantic, no model in the decision).
const shipped = JSON.parse(readFileSync(new URL('../results.json', dir), 'utf8')).rows.filter((r) => prompts.some((p) => p.id === r.id));
results.baseline = {
  label: 'No model in the decision (shipped pipeline)',
  cases: shipped.length,
  passed: shipped.filter((r) => r.pass).length,
  useful: shipped.filter((r) => r.pass || (r.outcome === 'suggest' && r.options.includes(r.expect.article))).length,
  wrongAnswers: shipped.filter((r) => r.outcome === 'answer' && !(r.expect.type === 'answer' && r.citations.includes(r.expect.article))).length,
};

for (const run of RUNS) {
  const judgementsFile = new URL(`judgements/${run.key}.json`, dir);
  const judgements = existsSync(judgementsFile) ? JSON.parse(readFileSync(judgementsFile, 'utf8')) : null;
  let inputTokens = 0;
  let outputTokens = 0;
  let uncountedReplies = 0;
  let unmeasuredReplies = 0;
  const rows = [];
  for (const prompt of prompts) {
    const file = new URL(`replies/${run.key}/${prompt.id}.json`, dir);
    if (!existsSync(file)) continue;
    let reply;
    const replyText = readFileSync(file, 'utf8').trim();
    try {
      reply = JSON.parse(replyText);
    } catch {
      reply = { type: 'invalid', answer: '', citations: [] };
    }
    const valid = prompt.schema.properties.type.enum.includes(reply.type) && (reply.citations ?? []).every((id) => prompt.candidates.includes(id));
    if (!valid) reply = { type: 'invalid', answer: reply.answer ?? '', citations: [] };
    const c = byId.get(prompt.id);
    const g = gradeReply(c, prompt, reply);
    const judged = judgements?.[prompt.id] ?? null;
    // An answer the judge found unfaithful to its article is not a pass.
    const pass = g.pass && (reply.type !== 'answer' || !judged || judged.faithful);
    // Real usage from eval/measure-usage.mjs first (thinking included), then exact counts, then the estimate.
    const real = measured?.usage(run.model, prompt);
    const exact = { inputTokens: counted?.input(run.model, prompt), outputTokens: counted?.output(run.model, replyText) };
    const tokens = real ?? (exact.inputTokens != null && exact.outputTokens != null
      ? exact
      : { inputTokens: estimateTokens(prompt.system + prompt.user + JSON.stringify(prompt.schema)), outputTokens: estimateTokens(JSON.stringify(reply)) });
    if (!real && tokens !== exact) uncountedReplies += 1;
    if (!real) unmeasuredReplies += 1;
    inputTokens += tokens.inputTokens;
    outputTokens += tokens.outputTokens;
    rows.push({ id: prompt.id, split: c.split, query: c.query, expect: c.expect, type: reply.type, citations: reply.citations, answer: reply.answer, valid, pass, wrongAnswer: g.wrongAnswer, neverCited: g.neverCited, judged });
    results.rows.push({ model: run.key, ...rows.at(-1) });
  }
  if (!rows.length) continue;
  const cost = costUsd(run.model, { inputTokens, outputTokens });
  const passed = rows.filter((r) => r.pass).length;
  const answers = rows.filter((r) => r.type === 'answer');
  const judgedAnswers = answers.filter((r) => r.judged);
  results.models.push({
    key: run.key,
    model: run.model,
    label: MODELS[run.model].label,
    price: { input: MODELS[run.model].input, output: MODELS[run.model].output },
    cases: rows.length,
    passed,
    passRate: passed / rows.length,
    passRateReachable: passed / rows.filter((r) => !unreachable.includes(r.id)).length,
    bySplit: Object.fromEntries(splits.map((s) => { const r = rows.filter((x) => x.split === s); return [s, { cases: r.length, passed: r.filter((x) => x.pass).length }]; })),
    byExpected: Object.fromEntries(['answer', 'clarify', 'escalate'].map((t) => { const r = rows.filter((x) => x.expect.type === t); return [t, { cases: r.length, passed: r.filter((x) => x.pass).length }]; })),
    wrongAnswers: rows.filter((r) => r.wrongAnswer).length,
    neverCited: rows.filter((r) => r.neverCited).length,
    invalid: rows.filter((r) => !r.valid).length,
    faithfulness: judgedAnswers.length ? { judged: judgedAnswers.length, faithful: judgedAnswers.filter((r) => r.judged.faithful).length, complete: judgedAnswers.filter((r) => r.judged.complete).length } : null,
    tokens: { input: inputTokens, output: outputTokens, counted: uncountedReplies === 0, measured: unmeasuredReplies === 0 },
    cost,
    costPerQuestion: cost / rows.length,
    costPerCorrect: passed ? cost / passed : null,
    costPer1000Questions: (cost / rows.length) * 1000,
  });
}

// Measured only when every model's replies were.
results.measuredAt = results.models.length && results.models.every((m) => m.tokens.measured) ? measured.measuredAt : null;
writeFileSync(new URL('results.json', dir), `${JSON.stringify(results, null, 1)}\n`);
console.log(`Baseline: ${results.baseline.passed}/${results.baseline.cases} pass, ${results.baseline.useful} useful, ${results.baseline.wrongAnswers} wrong answers`);
for (const m of results.models) {
  console.log(`${m.label.padEnd(18)} ${m.passed}/${m.cases} (${(m.passRate * 100).toFixed(1)}%)  wrong answers ${m.wrongAnswers}  invalid ${m.invalid}  $${m.cost.toFixed(4)}  per correct $${m.costPerCorrect?.toFixed(5)}  per 1000 q $${m.costPer1000Questions.toFixed(2)}  ${JSON.stringify(m.byExpected)} ${m.faithfulness ? JSON.stringify(m.faithfulness) : ''}`);
}
