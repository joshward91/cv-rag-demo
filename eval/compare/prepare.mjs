#!/usr/bin/env node
/**
 * Model comparison, step 1: build the model-routed prompt for every question
 * in the comparison sets and write them in batches for the models to answer.
 * Each prompt carries up to five candidates: the top three from keyword search
 * and the top three from semantic search, with look-alikes kept in so the
 * model has to tell them apart.
 *
 *   node eval/compare/prepare.mjs   -> eval/compare/prompts.json, eval/compare/batches/*.json
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { articles } from '../../src/kb/articles.js';
import { articleVectors } from '../../src/kb/article-vectors.js';
import { cases } from '../cases.js';
import { Retriever } from '../../src/rag/retriever.js';
import { SemanticIndex, queryText } from '../../src/rag/semantic.js';
import { createNodeEmbedder } from '../../src/rag/embedder.node.js';
import { buildRoutingPrompt } from '../../src/rag/prompt.js';

export const COMPARISON_SPLITS = ['voice', 'holdout3', 'holdout', 'perspective'];
const BATCH_SIZE = 33;
const MAX_CANDIDATES = 5;

const retriever = new Retriever(articles, {}, { semantic: new SemanticIndex(articleVectors.passages) });
const embed = await createNodeEmbedder();
const selected = cases.filter((c) => COMPARISON_SPLITS.includes(c.split) && !['blocked', 'assistant'].includes(c.expect.type));

const prompts = [];
for (const c of selected) {
  const analysis = retriever.analyse(c.query);
  const [queryVector] = await embed([queryText(analysis)]);
  const r = retriever.retrieve(c.query, { queryVector });
  const ids = retriever.candidatesFor(r, MAX_CANDIDATES);
  const prompt = buildRoutingPrompt(c.query, ids.map((id) => retriever.byId.get(id)), r.analysis);
  prompts.push({ id: c.id, split: c.split, candidates: ids, system: prompt.system, user: prompt.user, schema: prompt.schema });
}

const dir = new URL('./', import.meta.url);
writeFileSync(new URL('prompts.json', dir), `${JSON.stringify({ splits: COMPARISON_SPLITS, maxCandidates: MAX_CANDIDATES, prompts }, null, 1)}\n`);
rmSync(new URL('batches/', dir), { recursive: true, force: true });
mkdirSync(new URL('batches/', dir), { recursive: true });
writeFileSync(new URL('batches/system.txt', dir), prompts[0].system);
// One file per question, so each is read and answered on its own.
for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
  const batch = new URL(`batches/batch-${String(i / BATCH_SIZE + 1).padStart(2, '0')}/`, dir);
  mkdirSync(batch);
  for (const { id, user, schema } of prompts.slice(i, i + BATCH_SIZE)) {
    writeFileSync(new URL(`${id}.json`, batch), `${JSON.stringify({ id, allowedTypes: schema.properties.type.enum, allowedCitations: schema.properties.citations.items.enum, user }, null, 1)}\n`);
  }
}
const recall = prompts.filter((p) => { const c = selected.find((x) => x.id === p.id); return c.expect.type !== 'answer' || p.candidates.includes(c.expect.article); }).length;
console.log(`${prompts.length} prompts in ${Math.ceil(prompts.length / BATCH_SIZE)} batches. Expected article among candidates (or not an answer case): ${recall}/${prompts.length}.`);
