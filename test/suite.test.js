import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articles } from '../src/kb/articles.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../src/rag/generators.js';
import { SemanticIndex } from '../src/rag/semantic.js';
import { Suite, partition, withheldReason, viewerRetriever } from '../src/rag/suite.js';
import { overviewArticles } from '../src/kb/overview-articles.js';

// A tiny sister product and one internal document, so routing is tested
// without the generated suite.
const people = [
  {
    id: 'people-edit-phone',
    product: 'Harbour People',
    status: 'public',
    category: 'Employee profiles',
    title: "Update an employee's phone number",
    aliases: ["change an employee's mobile number", "edit a staff member's phone"],
    body: '1. Go to **People** and open the employee.\n2. Select **Edit profile**.\n3. Change **Mobile**.\n4. Select **Save**.',
    notConfusedWith: [],
  },
  {
    id: 'people-request-leave',
    product: 'Harbour People',
    status: 'public',
    category: 'Leave',
    title: 'Request annual leave',
    aliases: ['book a holiday', 'apply for time off'],
    body: '1. Go to **Leave**.\n2. Select **New request**.\n3. Choose the dates and select **Submit**.',
    notConfusedWith: [],
  },
];
const internalDoc = {
  id: 'internal-people-phone-training',
  product: 'Harbour People',
  status: 'internal',
  category: 'Support training',
  title: "Support training: updating an employee's phone number for a customer",
  aliases: ['agent script employee phone'],
  body: 'Internal. Do not share with customers. Use the admin console to edit the employee phone number.',
  notConfusedWith: [],
};

const suiteWith = (list) => new Suite([{ key: 'people', retriever: new Retriever(list, {}, { plain: true }) }]);
const desk = (generator = new ExtractiveGenerator()) => new HelpDesk({ retriever: new Retriever(articles), generator, suite: suiteWith(people) });

test('a question that names a sister product is answered from its help centre', async () => {
  const result = await desk().ask("how do I update an employee's phone number in Harbour People");
  assert.equal(result.product, 'Harbour People');
  assert.equal(result.outcome.type, 'answer');
  assert.deepEqual(result.outcome.citations, ['people-edit-phone']);
});

test('a CRM question still gets the CRM answer, with the sister article offered alongside', async () => {
  const result = await desk().ask("How do I update a client's phone number?");
  assert.equal(result.product, 'Harbour CRM');
  assert.deepEqual(result.outcome.citations, ['contact-edit-phone']);
  assert.deepEqual(result.alsoIn.map((a) => [a.product, a.id]), [['Harbour People', 'people-edit-phone']]);
});

test('a question only a sister product covers is suggested, not answered', async () => {
  const result = await desk().ask('how do I request annual leave');
  assert.equal(result.outcome.type, 'suggest');
  assert.deepEqual(result.outcome.options.map((o) => [o.product, o.id]), [['Harbour People', 'people-request-leave']]);
  assert.deepEqual(result.outcome.citations, []);
});

test("a sister product's prompt drops the CRM's client terminology", async () => {
  const calls = [];
  const generator = { name: 'fake', model: 'claude-sonnet-5-5', async generate({ prompt }) { calls.push(prompt); return { type: 'answer', answer: 'Steps.', citations: [prompt.contextIds[0]], usage: { inputTokens: 1, outputTokens: 1, measured: true }, model: 'claude-sonnet-5-5' }; } };
  await desk(generator).ask("how do I update an employee's phone number in Harbour People");
  assert.match(calls[0].system, /answering a question about Harbour People/);
  assert.doesNotMatch(calls[0].system, /Terminology:/);
});

test('a retriever holding an internal document is refused', () => {
  assert.throws(() => suiteWith([...people, internalDoc]), /Non-public documents in the Harbour People retriever/);
});

test('only a public status reaches the assistant: draft, archived and a missing status are withheld', () => {
  const as = (status) => ({ ...people[1], id: `people-${status ?? 'untagged'}`, status });
  assert.deepEqual(['draft', 'public', 'internal', 'archived', undefined, 'live'].map((st) => withheldReason(as(st))), ['draft', null, 'internal', 'archived', 'no status', 'unknown status "live"']);
  const { visible, withheld } = partition([...people, as('draft'), as('archived'), as(undefined)]);
  assert.deepEqual(visible.map((a) => a.id), people.map((a) => a.id));
  assert.equal(withheld.length, 3);
  for (const doc of [as('draft'), as('archived')]) assert.throws(() => suiteWith([...people, doc]), /Non-public documents/);
  const untagged = as(undefined);
  assert.throws(() => suiteWith([...people, untagged]), /people-untagged \(no status\)/);
  assert.throws(() => new HelpDesk({ retriever: new Retriever([...articles, untagged]), generator: new ExtractiveGenerator() }), /Non-public documents in the Harbour CRM retriever/);
});

test('semantic search over an index that holds internal documents never returns them', () => {
  const unit = (seed) => {
    const v = Array.from({ length: 8 }, (_, i) => Math.sin(seed * 7 + i));
    const n = Math.hypot(...v);
    return v.map((x) => Math.round((x / n) * 127));
  };
  // The internal passage is the exact match for the query vector.
  const passages = [
    { id: 'people-edit-phone', text: 'phone', body: false, q: unit(1) },
    { id: 'people-request-leave', text: 'leave', body: false, q: unit(2) },
    { id: internalDoc.id, text: 'training', body: false, q: unit(3) },
  ];
  const index = new SemanticIndex(passages);
  const query = Float32Array.from(unit(3), (x) => x / 127);
  assert.equal(index.rank(query)[0].id, internalDoc.id);
  const publicIds = new Map(people.map((a) => [a.id, a]));
  assert.ok(index.rank(query, { onlyIds: publicIds }).every((r) => publicIds.has(r.id)));
});

test('a visitor gets the overview page; signed in, the task help wins and the overview is only a fallback', async () => {
  const helpCentre = [...articles, ...overviewArticles];
  const ask = (loggedIn, q) => new HelpDesk({ retriever: viewerRetriever(helpCentre, { loggedIn }), generator: new ExtractiveGenerator() }).ask(q);
  assert.deepEqual((await ask(false, 'how do I add a contact')).outcome.citations, ['overview-contacts']);
  assert.deepEqual((await ask(true, 'how do I add a contact')).outcome.citations, ['contact-create']);
  const visitor = viewerRetriever(helpCentre, { loggedIn: false });
  assert.ok(visitor.articles.every((a) => a.audience === 'everyone'));
});
