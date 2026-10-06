#!/usr/bin/env node
/**
 * Replaces the cost estimates with exact token counts from Anthropic's
 * token-counting endpoint (POST /v1/messages/count_tokens), for:
 *
 *   1. the evaluation's cost per question: the exact prompt each of the 304
 *      questions would send, and the stand-in answer (the article's own text)
 *      priced as output, counted for each model in src/rag/pricing.js;
 *   2. the model comparison: the routing prompt each model was given and the
 *      reply it actually wrote (eval/compare/prompts.json and replies/).
 *
 * Counting tokens doesn't run a model, so it doesn't generate anything.
 * Anthropic documents it as free to use (rate limits apply). It still needs an
 * API key, read from the environment and never written anywhere:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node eval/count-tokens.mjs
 *   npm run eval && node eval/compare/score.mjs && npm run build
 *
 * Counts are saved by hash in eval/token-counts.json, so the file holds no
 * prompt text and a re-run only counts what changed.
 *
 * What it can't count: thinking tokens. Sonnet and Opus think before they
 * answer, and those tokens are billed as output but never appear in a reply.
 * Only a live run (npm run eval -- --live) measures them.
 *
 * Output tokens are counted by sending the reply text as a message and
 * subtracting the count for a one-character message, so each is within a
 * token or two of what the model was billed for writing it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { articles } from '../src/kb/articles.js';
import { articleVectors } from '../src/kb/article-vectors.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../src/rag/generators.js';
import { SemanticIndex } from '../src/rag/semantic.js';
import { createNodeEmbedder } from '../src/rag/embedder.node.js';
import { RecordQuery } from '../src/crm/query.js';
import { Store } from '../src/crm/store.js';
import { MODELS } from '../src/rag/pricing.js';
import { cases } from './cases.js';
import { COUNTS_FILE, hashText, promptKey } from './token-counts.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY to count tokens. It is read from the environment only and never saved.');
  process.exit(1);
}
// Retries are handled below, so a rate limit waits instead of failing the run.
const client = new Anthropic({ maxRetries: 0 });

const saved = existsSync(COUNTS_FILE) ? JSON.parse(readFileSync(COUNTS_FILE, 'utf8')) : {};
const counts = { input: saved.input ?? {}, output: saved.output ?? {} };
let schemaIncluded = saved.method?.schemaIncluded ?? true;

// 1. The evaluation's prompts, built exactly as eval/run.js builds them.
const semantic = new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph });
const retriever = new Retriever(articles, {}, { semantic });
const desk = new HelpDesk({ retriever, generator: new ExtractiveGenerator(), embedder: await createNodeEmbedder(), records: new RecordQuery(new Store()) });
const jobs = []; // { model, kind: 'input'|'output', key, prompt?, text? }
const want = (model, kind, key, payload) => {
  if (counts[kind][model]?.[key] === undefined) jobs.push({ model, kind, key, ...payload });
};
for (const c of cases) {
  const result = await desk.ask(c.query);
  if (!result.prompt) continue;
  // The same stand-in answer eval/run.js prices: the first article's text.
  const id = result.prompt.contextIds[0];
  const answer = JSON.stringify({ type: 'answer', answer: retriever.byId.get(id).body, citations: [id] });
  for (const model of Object.keys(MODELS)) {
    want(model, 'input', promptKey(result.prompt), { prompt: result.prompt });
    want(model, 'output', hashText(answer), { text: answer });
  }
}

// 2. The model comparison's prompts and the replies each model wrote.
const compare = new URL('./compare/', import.meta.url);
const { prompts } = JSON.parse(readFileSync(new URL('prompts.json', compare), 'utf8'));
for (const [key, model] of [['haiku', 'claude-haiku-4-5'], ['sonnet', 'claude-sonnet-5-5'], ['opus', 'claude-opus-5-5']]) {
  for (const prompt of prompts) {
    const file = new URL(`replies/${key}/${prompt.id}.json`, compare);
    if (!existsSync(file)) continue;
    want(model, 'input', promptKey(prompt), { prompt });
    const text = readFileSync(file, 'utf8').trim();
    want(model, 'output', hashText(text), { text });
  }
}
// Several questions share a prompt or an answer: count each once.
const unique = [...new Map(jobs.map((j) => [`${j.model}/${j.kind}/${j.key}`, j])).values()];
console.log(`${unique.length} counts to make (${Object.values(counts.input).reduce((n, m) => n + Object.keys(m).length, 0)} input and ${Object.values(counts.output).reduce((n, m) => n + Object.keys(m).length, 0)} output already saved).`);

const baseline = {};
async function countInput(model, prompt) {
  const request = { model, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] };
  if (schemaIncluded) {
    try {
      return (await client.messages.countTokens({ ...request, output_config: { format: { type: 'json_schema', schema: prompt.schema } } })).input_tokens;
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      // The endpoint may not take a response format. Count the schema as text
      // instead, which is close but not exactly how the API adds it.
      console.warn(`The token counter didn't accept the response schema (${error.message}). Counting it as text instead.`);
      schemaIncluded = false;
    }
  }
  return (await client.messages.countTokens({ ...request, messages: [{ role: 'user', content: `${prompt.user}\n\n${JSON.stringify(prompt.schema)}` }] })).input_tokens;
}
async function countOutput(model, text) {
  baseline[model] ??= (await withRetry(() => client.messages.countTokens({ model, messages: [{ role: 'user', content: '.' }] }))).input_tokens - 1;
  return (await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] })).input_tokens - baseline[model];
}

function save() {
  const method = {
    endpoint: 'POST /v1/messages/count_tokens',
    schemaIncluded,
    outputMethod: 'reply text counted as a message, minus a one-character message',
    thinking: 'not counted',
  };
  writeFileSync(COUNTS_FILE, `${JSON.stringify({ countedAt: new Date().toISOString(), method, input: counts.input, output: counts.output }, null, 1)}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pausedUntil = 0;

/** Runs a count, waiting out rate limits (new accounts allow few requests a minute). */
async function withRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    const wait = pausedUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError;
      if (!retryable || attempt > 20) throw error;
      const seconds = Number(error.headers?.get?.('retry-after')) || Math.min(60, 5 * attempt);
      if (Date.now() + seconds * 1000 > pausedUntil) {
        pausedUntil = Date.now() + seconds * 1000;
        console.log(`Rate limited after ${done} counts; waiting ${seconds}s and carrying on.`);
      }
    }
  }
}

// A few at a time, saving as it goes so an interrupted run can resume.
let done = 0;
const queue = [...unique];
async function worker() {
  while (queue.length) {
    const job = queue.shift();
    const n = await withRetry(() => (job.kind === 'input' ? countInput(job.model, job.prompt) : countOutput(job.model, job.text)));
    (counts[job.kind][job.model] ??= {})[job.key] = n;
    done += 1;
    if (done % 50 === 0) {
      save();
      console.log(`${done} of ${unique.length}`);
    }
  }
}
try {
  await Promise.all(Array.from({ length: 4 }, worker));
} catch (error) {
  save();
  if (error instanceof Anthropic.AuthenticationError) console.error('The API key was rejected.');
  else if (error instanceof Anthropic.PermissionDeniedError) console.error(`The key isn't allowed to count tokens: ${error.message}`);
  else if (error instanceof Anthropic.RateLimitError) console.error('Still rate limited after 20 tries. Run it again later; saved counts are kept.');
  else console.error(error);
  process.exit(1);
}
save();
console.log(`Done: ${done} counted. Now run: npm run eval && node eval/compare/score.mjs && npm run build`);
