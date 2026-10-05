#!/usr/bin/env node
/**
 * Evaluation runner.
 *
 *   node eval/run.js                 offline, extractive generator (deterministic, free)
 *   node eval/run.js --split dev     only the tuning set (also: test, holdout)
 *   node eval/run.js --live          Claude API generation; needs ANTHROPIC_API_KEY
 *   node eval/run.js --live --model claude-sonnet-5-5
 *
 * Writes eval/results.json (or --out <file>), which scripts/build.js embeds in
 * the report page.
 * Exits non-zero if the forbidden article in the client/contact trap is ever
 * ranked first, offered, put in the prompt or cited, so it can gate CI.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { articles } from '../src/kb/articles.js';
import { Retriever, DEFAULT_POLICY } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator, AnthropicGenerator } from '../src/rag/generators.js';
import { promptAsText, interpretationNotes } from '../src/rag/prompt.js';
import { MODELS, DEFAULT_MODEL, estimateTokens, costUsd } from '../src/rag/pricing.js';
import { cases } from './cases.js';
import { grade, summarise } from './metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const split = option('split', 'all');
const live = flag('live');
const model = option('model', DEFAULT_MODEL);

let generator = new ExtractiveGenerator();
if (live) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('--live needs ANTHROPIC_API_KEY to be set.');
    process.exit(2);
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  generator = new AnthropicGenerator({ client: new Anthropic(), model });
}

const selected = cases.filter((c) => split === 'all' || c.split === split);
const rows = await runCases(articles, selected);

async function runCases(knowledgeBase, selectedCases) {
  const retriever = new Retriever(knowledgeBase);
  const desk = new HelpDesk({ retriever, generator });
  const rows = [];
  for (const testCase of selectedCases) {
    const result = await desk.ask(testCase.query);
    const ranked = result.retrieval.results.map((r) => r.id);

    // Cost model: the prompt the pipeline would send, priced for each model.
    // Questions decided as clarify or escalate never reach a model and cost $0.
    let tokens = { inputTokens: 0, outputTokens: 0, measured: false };
    if (result.prompt) {
      if (result.reply?.usage?.measured) {
        tokens = result.reply.usage;
      } else {
        const expectedAnswer = retriever.byId.get(result.prompt.contextIds[0]).body;
        tokens = {
          inputTokens: estimateTokens(promptAsText(result.prompt)),
          outputTokens: estimateTokens(JSON.stringify({ type: 'answer', answer: expectedAnswer, citations: [result.prompt.contextIds[0]] })),
          measured: false,
        };
      }
    }

    const row = {
      id: testCase.id,
      split: testCase.split,
      tags: testCase.tags,
      query: testCase.query,
      expect: testCase.expect,
      rewritten: result.retrieval.analysis.terms.join(' '),
      trace: result.retrieval.analysis.trace.map((t) => `${t.from} → ${t.to}`),
      ranked: result.retrieval.results.map((r) => ({ id: r.id, score: round(r.score), coverage: round(r.coverage) })),
      decision: result.decision.type,
      decisionReason: result.decision.reason,
      outcome: result.outcome.type,
      options: result.outcome.options?.map((o) => o.id) ?? [],
      rawCitations: result.reply?.citations ?? [],
      citations: result.outcome.citations ?? [],
      contextIds: result.prompt?.contextIds ?? [],
    interpretation: result.prompt ? interpretationNotes(result.retrieval.analysis) : [],
      guardrail: result.guardrail,
      retrievalMs: result.retrieval.elapsedMs,
      tokens,
      costByModel: Object.fromEntries(Object.keys(MODELS).map((m) => [m, tokens.inputTokens ? costUsd(m, tokens) : 0])),
      rank: ranked,
    };
    Object.assign(row, grade(row));
    rows.push(row);
  }
  return rows;
}

// The help centre is fixed content. Retrieval failures are fixed in the
// pipeline, not by editing articles, so flag any run against changed articles.
const fingerprint = createHash('sha256').update(JSON.stringify(articles)).digest('hex').slice(0, 12);
const history = JSON.parse(readFileSync(join(here, 'history.json'), 'utf8'));
if (history.knowledgeBaseFingerprint && history.knowledgeBaseFingerprint !== fingerprint) {
  console.warn(`Note: the help articles changed since they were frozen (${history.knowledgeBaseFingerprint} -> ${fingerprint}). Record why in eval/history.json.`);
}

const kbIds = new Set(articles.map((a) => a.id));
const report = {
  generatedAt: new Date().toISOString(),
  mode: live ? { generator: 'anthropic', model, measuredUsage: true } : { generator: 'extractive', model: null, measuredUsage: false },
  knowledgeBase: { articles: articles.length, fingerprint },
  policy: DEFAULT_POLICY,
  pricing: MODELS,
  summary: {
    all: summarise(rows, kbIds),
    dev: summarise(rows.filter((r) => r.split === 'dev'), kbIds),
    test: summarise(rows.filter((r) => r.split === 'test'), kbIds),
    holdout: summarise(rows.filter((r) => r.split === 'holdout'), kbIds),
    perspective: summarise(rows.filter((r) => r.split === 'perspective'), kbIds),
  },
  rows: rows.map(({ rank, ...rest }) => rest),
};

const out = option('out', join(here, 'results.json'));
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
printSummary(report);

const violations = rows.filter((r) => r.neverViolated);
if (violations.length) console.error(`\nForbidden-article violations: ${violations.map((r) => r.id).join(', ')}`);
process.exitCode = violations.length ? 1 : 0;

function printSummary({ summary }) {
  const pctOf = (x) => (x === null ? '  n/a' : `${(x * 100).toFixed(1).padStart(5)}%`);
  for (const [name, s] of Object.entries(summary)) {
    if (!s.cases) continue;
    console.log(`\n${name.toUpperCase()}  (${s.cases} cases)`);
    console.log(`  Overall pass rate            ${pctOf(s.passRate)}`);
    console.log(`  Retrieval hit@1 / hit@3      ${pctOf(s.retrieval.hitAt1)} / ${pctOf(s.retrieval.hitAt3)}`);
    console.log(`  Citation validity            ${pctOf(s.citations.validity)}   correct article cited ${pctOf(s.citations.correctness)}`);
    console.log(`  Refusal recall / precision   ${pctOf(s.refusal.recall)} / ${pctOf(s.refusal.precision)}   false refusals ${pctOf(s.refusal.falseRefusalRate)}`);
    console.log(`  Clarification accuracy      ${pctOf(s.clarify.accuracy)}   unnecessary ${pctOf(s.clarify.unnecessaryRate)}`);
    console.log(`  Core example                 ${s.core.passed}/${s.core.total} passed, ${s.core.neverViolations} forbidden-article violations`);
  }
  const failed = rows.filter((r) => !r.pass);
  if (failed.length) {
    console.log(`\nFailures (${failed.length}):`);
    for (const r of failed) {
      const got = r.outcome === 'answer' ? `answer ${r.citations.join(',')}` : r.outcome === 'clarify' ? `clarify ${r.options.join(',')}` : 'escalate';
      const want = r.expect.type === 'answer' ? `answer ${r.expect.article}` : r.expect.type === 'clarify' ? `clarify ${r.expect.mustInclude.join(',')}` : 'escalate';
      console.log(`  [${r.split}] ${r.id}  "${r.query}"\n      want ${want}\n      got  ${got}   terms: ${r.rewritten}   top: ${r.rank.slice(0, 3).join(', ')}`);
    }
  }
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}
