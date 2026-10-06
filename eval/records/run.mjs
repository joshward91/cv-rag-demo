#!/usr/bin/env node
/**
 * Record lookups. Signed in, questions about the account's own data ("show me
 * Priya's phone number", "open Deals worth more than 10k") are answered from
 * the records by RecordQuery (src/crm/query.js), with no model call. Every
 * other question must fall through to the help search untouched.
 *
 * The 40 questions in eval/records/cases.json were written by a separate agent
 * that read only the seed data (src/crm/seed.js), with expected ids and values
 * computed from it. Scored once, blind: 29/40 (kept in results.blind.json).
 * The parser was then widened for phrasings the failures showed it missed
 * ("can you give me", "where is X located", "what deals do we have with X",
 * "who works at X"), so the set is no longer blind. Expect types:
 *   field  one record's field: right record and value
 *   list   a list of records: same ids (and order, when ordered)
 *   none   a record the account has, a field it doesn't: "not recorded", no list
 *   help   not a data question: the input guard blocks it or answer() is null
 *
 * "Today" is pinned to 2026-10-06, the date the cases were written, so the
 * "closing soon" cases stay reproducible.
 *
 *   node eval/records/run.mjs  -> eval/records/results.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RecordQuery } from '../../src/crm/query.js';
import { Store } from '../../src/crm/store.js';
import { screenQuestion } from '../../src/rag/guard.js';
import { cases as helpCases } from '../cases.js';

const here = new URL('./', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', here), 'utf8'));
const records = new RecordQuery(new Store(), { today: () => new Date('2026-10-06T09:00:00') });

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function grade(c, data) {
  const e = c.expect;
  if (e.type === 'help') return data === null;
  if (!data) return false;
  if (e.type === 'field') return data.kind === 'record' && data.items?.[0]?.id === e.record && data.field === e.field && data.value === e.value;
  if (e.type === 'none') return data.kind === 'none' || (data.kind === 'record' && data.value == null);
  if (e.type === 'list') {
    const ids = (data.items ?? []).map((i) => i.id);
    if (data.kind !== 'list' && !(data.kind === 'record' && e.ids.length === 1)) return false;
    return e.ordered ? same(ids, e.ids) : same([...ids].sort(), [...e.ids].sort());
  }
  return false;
}

const rows = cases.map((c) => {
  const screen = screenQuestion(c.query);
  const data = screen.blocked ? null : records.answer(c.query);
  const got = data ? { kind: data.kind, field: data.field, value: data.value, ids: (data.items ?? []).map((i) => i.id), text: data.text } : { kind: screen.blocked ? 'blocked' : 'help' };
  return { id: c.id, tags: c.tags, query: c.query, expect: c.expect, got, pass: grade(c, data) };
});

const byType = {};
for (const r of rows) {
  const t = (byType[r.expect.type] ??= { cases: 0, passed: 0 });
  t.cases += 1;
  t.passed += r.pass ? 1 : 0;
}
const passed = rows.filter((r) => r.pass).length;
// Every help, viewer and suite question must still reach help search.
const help = [...helpCases, ...JSON.parse(readFileSync(new URL('../viewer/cases.json', here), 'utf8')), ...JSON.parse(readFileSync(new URL('../suite/cases.json', here), 'utf8'))];
const intercepted = help.filter((c) => !screenQuestion(c.query).blocked && records.answer(c.query)).map((c) => ({ id: c.id, query: c.query }));
writeFileSync(new URL('results.json', here), `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: rows.length, passed, byType, helpQuestions: help.length, intercepted, rows }, null, 1)}\n`);
console.log(`help questions answered as data: ${intercepted.length} of ${help.length}`);
console.log(`records ${passed}/${rows.length}`, Object.entries(byType).map(([t, s]) => `${t} ${s.passed}/${s.cases}`).join('  '));
for (const r of rows.filter((x) => !x.pass)) console.log(`  FAIL ${r.id} ${r.query} -> ${JSON.stringify(r.got).slice(0, 160)}`);
