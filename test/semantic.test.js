import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articles } from '../src/kb/articles.js';
import { articleVectors } from '../src/kb/article-vectors.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk } from '../src/rag/pipeline.js';
import { ExtractiveGenerator } from '../src/rag/generators.js';
import { SemanticIndex, EMBEDDING_MODEL } from '../src/rag/semantic.js';
import { createNodeEmbedder } from '../src/rag/embedder.node.js';
import { fingerprintArticles } from '../scripts/fingerprint.mjs';

const retriever = new Retriever(articles, {}, { semantic: new SemanticIndex(articleVectors.passages) });
const embedder = await createNodeEmbedder();
const desk = new HelpDesk({ retriever, generator: new ExtractiveGenerator(), embedder });

test('precomputed article vectors match the current articles and model', () => {
  assert.equal(articleVectors.model, EMBEDDING_MODEL);
  assert.equal(articleVectors.fingerprint, fingerprintArticles(articles),
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
