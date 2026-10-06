import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articles } from '../src/kb/articles.js';
import { overviewArticles } from '../src/kb/overview-articles.js';
import { articleVectors } from '../src/kb/article-vectors.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../src/rag/generators.js';
import { SemanticIndex, EMBEDDING_MODEL, queryText } from '../src/rag/semantic.js';
import { HnswIndex } from '../src/rag/hnsw.js';
import { cases } from '../eval/cases.js';
import { createNodeEmbedder } from '../src/rag/embedder.node.js';
import { fingerprintArticles } from '../scripts/fingerprint.mjs';

// As shipped: passages searched through the HNSW graph.
const retriever = new Retriever(articles, {}, { semantic: new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph }) });
const flat = new SemanticIndex(articleVectors.passages);
const embedder = await createNodeEmbedder();
const desk = new HelpDesk({ retriever, generator: new ExtractiveGenerator(), embedder });

test('precomputed article vectors match the current articles and model', () => {
  assert.equal(articleVectors.model, EMBEDDING_MODEL);
  assert.equal(articleVectors.fingerprint, fingerprintArticles([...articles, ...overviewArticles]),
    'Articles changed since the vectors were built: run node scripts/embed-articles.mjs');
});

test('a paraphrase keyword search misses is offered as a suggestion, never answered', async () => {
  const { outcome: out } = await desk.ask('they signed the contract');
  assert.equal(out.type, 'suggest');
  assert.ok(out.options.some((o) => o.id === 'deal-mark-won'));
  assert.deepEqual(out.citations, []);
});

test('semantic search does not change a confident keyword answer', async () => {
  const { outcome: out } = await desk.ask("How do I update a client's phone number?");
  assert.equal(out.type, 'answer');
  assert.deepEqual(out.citations, ['contact-edit-phone']);
});

test('an off-topic question stays escalated', async () => {
  const { outcome: out } = await desk.ask("What's the weather in Sydney?");
  assert.equal(out.type, 'escalate');
});

test('suggestions never sit next to a declared look-alike', () => {
  const semantic = [
    { id: 'contact-edit-phone', similarity: 0.6 },
    { id: 'account-client-contact-number', similarity: 0.59 },
    { id: 'contact-create', similarity: 0.57 },
  ];
  const decision = retriever.suggest(semantic, { type: 'escalate', reason: 'No match.' });
  assert.equal(decision.type, 'suggest');
  assert.deepEqual(decision.articleIds, ['contact-edit-phone', 'contact-create']);
});

test('suggestions need a close enough semantic match', () => {
  const decision = retriever.suggest([{ id: 'contact-create', similarity: 0.3 }], { type: 'escalate', reason: 'No match.' });
  assert.equal(decision.type, 'escalate');
});

test('the WordPiece tokenizer matches the reference Hugging Face tokenizer', async () => {
  const { readFileSync } = await import('node:fs');
  const { WordPieceTokenizer } = await import('../src/rag/wordpiece.js');
  const { cases } = await import('../eval/cases.js');
  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.localModelPath = new URL('../models/', import.meta.url).pathname;
  const reference = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL);
  const mine = new WordPieceTokenizer(JSON.parse(readFileSync(new URL(`../models/${EMBEDDING_MODEL}/tokenizer.json`, import.meta.url), 'utf8')));
  const texts = [...articleVectors.passages.map((p) => p.text), ...cases.map((c) => c.query), 'Café naïve — “quotes” 中文\tand tabs'];
  for (const text of texts) assert.deepEqual(mine.encode(text), reference.encode(text), text);
});

test('the shipped HNSW graph is what the shipped vectors build', () => {
  const vectors = articleVectors.passages.map((p) => Float32Array.from(p.q, (x) => x / 127));
  assert.deepEqual(HnswIndex.build(vectors).toJSON(), articleVectors.graph,
    'The graph is stale: run node scripts/embed-articles.mjs');
});

test('the HNSW graph ranks the same top three articles as a flat scan for every eval question', async () => {
  const vectors = await embedder(cases.map((c) => queryText(retriever.analyse(c.query))));
  const top3 = (index, v) => index.rank(v).slice(0, 3).map((r) => r.id);
  const differ = cases.filter((c, i) => top3(retriever.semantic, vectors[i]).join() !== top3(flat, vectors[i]).join());
  assert.deepEqual(differ.map((c) => c.id), []);
});

test('HNSW finds nearly all true nearest neighbours in a larger clustered set, and round-trips through JSON', () => {
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const centres = Array.from({ length: 40 }, () => unit(Float32Array.from({ length: 32 }, () => random() - 0.5)));
  const vectors = Array.from({ length: 2000 }, (_, i) => unit(Float32Array.from(centres[i % 40], (x) => x + (random() - 0.5) * 0.3)));
  const index = HnswIndex.build(vectors, { efConstruction: 100 });
  const restored = HnswIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())), vectors);
  let hits = 0;
  for (const q of vectors.slice(0, 100)) {
    const exact = vectors.map((v, i) => [v.reduce((s, x, j) => s + x * q[j], 0), i]).sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, i]) => i);
    const found = restored.search(q, 10).map((r) => r.id);
    assert.deepEqual(found, index.search(q, 10).map((r) => r.id));
    hits += found.filter((id) => exact.includes(id)).length;
  }
  assert.ok(hits / 1000 >= 0.95, `recall@10 ${hits / 1000}`);
});

test('an article the graph did not reach still gets an exact similarity for the panel', () => {
  const v = flat.passages[0].v;
  const id = flat.passages.at(-1).id;
  assert.equal(retriever.semantic.similarityTo(v, id), flat.rank(v).find((r) => r.id === id).similarity);
});
