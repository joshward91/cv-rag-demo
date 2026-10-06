#!/usr/bin/env node
/**
 * Model comparison, answer quality. Pools every "answer" reply from every
 * model, shuffles them and strips the model name, so the judge can't tell
 * whose answer it is grading.
 *
 *   node eval/compare/judging.mjs prepare  -> judging/items/*.json + judging/key.json
 *   node eval/compare/judging.mjs merge    -> judgements/<model>.json from judging/grades/*.json
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { articles } from '../../src/kb/articles.js';
import { cases } from '../cases.js';

const dir = new URL('./', import.meta.url);
const MODELS = ['haiku', 'sonnet', 'opus'];
const byId = new Map(articles.map((a) => [a.id, a]));
const caseById = new Map(cases.map((c) => [c.id, c]));

// Deterministic shuffle, so a re-run produces the same anonymous ids.
function shuffle(items, seed = 20261006) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

if (process.argv[2] === 'prepare') {
  const pool = [];
  for (const model of MODELS) {
    const replyDir = new URL(`replies/${model}/`, dir);
    for (const file of readdirSync(replyDir)) {
      const reply = JSON.parse(readFileSync(new URL(file, replyDir), 'utf8'));
      if (reply.type !== 'answer' || !reply.citations?.length) continue;
      pool.push({ model, caseId: file.replace(/\.json$/, ''), reply });
    }
  }
  rmSync(new URL('judging/', dir), { recursive: true, force: true });
  mkdirSync(new URL('judging/items/', dir), { recursive: true });
  mkdirSync(new URL('judging/grades/', dir), { recursive: true });
  const key = {};
  shuffle(pool).forEach((p, i) => {
    const id = `j-${String(i + 1).padStart(3, '0')}`;
    key[id] = { model: p.model, caseId: p.caseId };
    const item = {
      id,
      question: caseById.get(p.caseId).query,
      articles: p.reply.citations.filter((a) => byId.has(a)).map((a) => ({ id: a, title: byId.get(a).title, body: byId.get(a).body })),
      answer: p.reply.answer,
    };
    writeFileSync(new URL(`judging/items/${id}.json`, dir), `${JSON.stringify(item, null, 1)}\n`);
  });
  writeFileSync(new URL('judging/key.json', dir), `${JSON.stringify(key, null, 1)}\n`);
  console.log(`${pool.length} answers to judge.`);
} else if (process.argv[2] === 'merge') {
  const key = JSON.parse(readFileSync(new URL('judging/key.json', dir), 'utf8'));
  const out = Object.fromEntries(MODELS.map((m) => [m, {}]));
  let missing = 0;
  for (const [id, { model, caseId }] of Object.entries(key)) {
    const file = new URL(`judging/grades/${id}.json`, dir);
    if (!existsSync(file)) { missing++; continue; }
    const g = JSON.parse(readFileSync(file, 'utf8'));
    out[model][caseId] = { faithful: Boolean(g.faithful), complete: Boolean(g.complete), note: g.note ?? '' };
  }
  mkdirSync(new URL('judgements/', dir), { recursive: true });
  for (const m of MODELS) writeFileSync(new URL(`judgements/${m}.json`, dir), `${JSON.stringify(out[m], null, 1)}\n`);
  console.log(`Merged ${Object.keys(key).length - missing} grades, ${missing} missing.`);
}
