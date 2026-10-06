#!/usr/bin/env node
/**
 * Measures what the cost figures actually cost, by sending the real prompts to
 * the Claude API and recording the usage each response reports. Unlike
 * eval/count-tokens.mjs, this includes thinking tokens, and the answers are
 * what each model really writes. It spends money, so it stops at a budget.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node eval/measure-usage.mjs --budget 12
 *   npm run eval && node eval/compare/score.mjs && node eval/compare/tiers.mjs && npm run build
 *
 * It measures, for each of Haiku 4.5, Sonnet 5.5 and Opus 5.5:
 *   1. the cost per question: each evaluation question that would reach a
 *      model, sent with the exact prompt the pipeline builds;
 *   2. the model comparison: each routing prompt in eval/compare/prompts.json.
 * Requests are made exactly as the demo makes them (AnthropicGenerator in
 * src/rag/generators.js: structured output, effort low, no tools).
 *
 * Usage is saved by prompt hash in eval/measured-usage.json, with the replies
 * in eval/compare/replies-live/ for reference. The replies are not graded:
 * the pass rates in the report still come from the original runs. A re-run
 * skips what is already measured, so an interrupted run can resume.
 *
 * The budget is in US dollars at list prices, counted from measured usage, and
 * is checked before every request. Work runs most important first, so if the money
 * runs out, what is missing matters least:
 *   1. Sonnet 5.5, the recommended model: the comparison, then the evaluation;
 *   2. Haiku 4.5 and Opus 5.5 on the comparison, completing the model table;
 *   3. Haiku 4.5 and Opus 5.5 on the evaluation's cost table.
 * Results are saved after every request. A model's measured figures are used
 * only once its whole part (comparison or evaluation) is measured, so no table
 * mixes measured and counted tokens for one model.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { articles } from '../src/kb/articles.js';
import { articleVectors } from '../src/kb/article-vectors.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator, AnthropicGenerator } from '../src/rag/generators.js';
import { SemanticIndex } from '../src/rag/semantic.js';
import { createNodeEmbedder } from '../src/rag/embedder.node.js';
import { RecordQuery } from '../src/crm/query.js';
import { Store } from '../src/crm/store.js';
import { costUsd } from '../src/rag/pricing.js';
import { cases } from './cases.js';
import { MEASURED_FILE, promptKey } from './token-counts.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const budget = Number(arg('budget', '24'));
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-4-5';
const OPUS = 'claude-opus-5-5';
const models = (arg('models', [SONNET, HAIKU, OPUS].join(','))).split(',');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY. It is read from the environment only and never saved.');
  process.exit(1);
}
if (!(budget > 0)) {
  console.error('--budget must be a positive number of US dollars.');
  process.exit(1);
}

// Retries are handled below, so a rate limit waits instead of failing the run.
const client = new Anthropic({ maxRetries: 0 });
const saved = existsSync(MEASURED_FILE) ? JSON.parse(readFileSync(MEASURED_FILE, 'utf8')) : {};
const usage = saved.usage ?? {}; // usage[model][promptKey] = { input, output }
const liveDir = new URL('./compare/replies-live/', import.meta.url);

// 1. The evaluation's prompts, built exactly as eval/run.js builds them.
const semantic = new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph });
const desk = new HelpDesk({ retriever: new Retriever(articles, {}, { semantic }), generator: new ExtractiveGenerator(), embedder: await createNodeEmbedder(), records: new RecordQuery(new Store()) });
const evalPrompts = [];
for (const c of cases) {
  const result = await desk.ask(c.query);
  if (result.prompt) evalPrompts.push({ id: c.id, prompt: result.prompt });
}
// 2. The model comparison's routing prompts.
const { prompts: routing } = JSON.parse(readFileSync(new URL('./compare/prompts.json', import.meta.url), 'utf8'));

// Most important first (see the top of this file).
const ORDER = [[SONNET, 'compare'], [SONNET, 'eval'], [HAIKU, 'compare'], [OPUS, 'compare'], [HAIKU, 'eval'], [OPUS, 'eval']];
const parts = { eval: evalPrompts, compare: routing.map((prompt) => ({ id: prompt.id, prompt })) };
const jobs = [];
for (const [model, part] of ORDER.filter(([m]) => models.includes(m))) {
  for (const { id, prompt } of parts[part]) jobs.push({ model, id, prompt, part });
}
const seen = new Set();
const todo = jobs.filter((j) => {
  const key = `${j.model}/${promptKey(j.prompt)}`;
  if (usage[j.model]?.[promptKey(j.prompt)] || seen.has(key)) return false;
  seen.add(key);
  return true;
});

let spent = Object.entries(usage).reduce((sum, [model, byKey]) => sum + Object.values(byKey).reduce((s, u) => s + costUsd(model, { inputTokens: u.input, outputTokens: u.output }), 0), 0);
console.log(`${todo.length} requests to make. Already measured: $${spent.toFixed(2)} of the $${budget.toFixed(2)} budget.`);

function save(stopped = null) {
  const totals = Object.fromEntries(Object.entries(usage).map(([model, byKey]) => {
    const all = Object.values(byKey);
    return [model, { calls: all.length, input: all.reduce((s, u) => s + u.input, 0), output: all.reduce((s, u) => s + u.output, 0) }];
  }));
  // Which parts are fully measured for each model; only those are used.
  const complete = {};
  for (const [model, part] of ORDER) (complete[model] ??= {})[part] = parts[part].every(({ prompt }) => Boolean(usage[model]?.[promptKey(prompt)]));
  writeFileSync(MEASURED_FILE, `${JSON.stringify({ measuredAt: new Date().toISOString(), method: 'Messages API usage (input_tokens, output_tokens including thinking), requests as AnthropicGenerator makes them', spentUsd: Number(spent.toFixed(4)), stopped, complete, totals, usage }, null, 1)}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pausedUntil = 0;
async function withRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError || error?.status === 529;
      if (!retryable || attempt > 20) throw error;
      const seconds = Number(error.headers?.get?.('retry-after')) || Math.min(60, 5 * attempt);
      if (Date.now() + seconds * 1000 > pausedUntil) {
        pausedUntil = Date.now() + seconds * 1000;
        console.log(`Rate limited; waiting ${seconds}s and carrying on.`);
      }
    }
  }
}

// The most one request could cost, so the budget is never overshot.
const worstCase = (model, prompt) => costUsd(model, { inputTokens: Math.ceil(JSON.stringify(prompt).length / 2), outputTokens: 4000 });

let done = 0;
let stopped = null;
let reserved = 0;
const generators = Object.fromEntries(models.map((m) => [m, new AnthropicGenerator({ client, model: m })]));
const queue = [...todo];
async function worker() {
  while (queue.length && !stopped) {
    const job = queue.shift();
    // Requests still in flight hold their worst case, so parallel workers can't overshoot together.
    const hold = worstCase(job.model, job.prompt);
    if (spent + reserved + hold > budget) {
      stopped = `stopped before ${job.model} ${job.id} with $${spent.toFixed(2)} spent`;
      break;
    }
    reserved += hold;
    let reply;
    try {
      reply = await withRetry(() => generators[job.model].generate({ prompt: job.prompt }));
    } finally {
      reserved -= hold;
    }
    const u = { input: reply.usage.inputTokens, output: reply.usage.outputTokens };
    (usage[job.model] ??= {})[promptKey(job.prompt)] = u;
    spent += costUsd(job.model, { inputTokens: u.input, outputTokens: u.output });
    if (job.part === 'compare') {
      const dir = new URL(`${job.model}/`, liveDir);
      mkdirSync(dir, { recursive: true });
      const { usage: _usage, ...rest } = reply;
      writeFileSync(new URL(`${job.id}.json`, dir), `${JSON.stringify(rest)}\n`);
    }
    done += 1;
    save();
    if (done % 20 === 0) console.log(`${done} of ${todo.length}, $${spent.toFixed(2)} spent`);
  }
}
try {
  await Promise.all(Array.from({ length: 3 }, worker));
} catch (error) {
  save(`error: ${error.message}`);
  if (error instanceof Anthropic.AuthenticationError) console.error('The API key was rejected.');
  else if (error instanceof Anthropic.PermissionDeniedError) console.error(`Not allowed: ${error.message}`);
  else if (/credit|billing|limit/i.test(error.message)) console.error(`The account stopped the run: ${error.message}`);
  else console.error(error);
  console.error(`Saved what was measured ($${spent.toFixed(2)}). Run it again to resume.`);
  process.exit(1);
}
save(stopped);
console.log(stopped ? `Stopped at the budget, ${stopped}. Raise --budget to continue.` : `Done: ${done} requests, $${spent.toFixed(2)} at list prices.`);
console.log('Now run: npm run eval && node eval/compare/score.mjs && node eval/compare/tiers.mjs && npm run build');
