#!/usr/bin/env node
/**
 * Vector index at scale: flat scan vs the HNSW graph (src/rag/hnsw.js) as the
 * number of passages grows. The help centre has only 292 passages, so larger
 * corpora add synthetic ones, vectors with no text behind them, shaped like
 * the real set: synthetic "articles" of 10 passages each, centred on a mix of
 * three real passages. The noise levels were chosen so a passage's nearest
 * neighbour is about as similar as in the real set (median 0.76 vs 0.74), and
 * the nearest passage from another article a little less (0.58 vs 0.68), so
 * the synthetic set is, if anything, slightly easier than real data. The
 * queries are the 304 real evaluation questions, embedded by the same model.
 *
 * For each size it records recall@10 (the share of the exact top 10 passages
 * the graph found) and, closer to what the retriever needs, whether the graph
 * gives the same top article and top three articles as the flat scan. Also
 * time per query, build time and graph size. Seeded, so reruns match.
 *
 *   node eval/scale/bench.mjs   -> eval/scale/results.json   (about ten minutes)
 */
import { writeFileSync } from 'node:fs';
import { articles } from '../../src/kb/articles.js';
import { articleVectors } from '../../src/kb/article-vectors.js';
import { Retriever } from '../../src/rag/retriever.js';
import { queryText, INDEX_CANDIDATES } from '../../src/rag/semantic.js';
import { createNodeEmbedder } from '../../src/rag/embedder.node.js';
import { HnswIndex, HNSW_DEFAULTS } from '../../src/rag/hnsw.js';
import { cases } from '../cases.js';

const SIZES = (process.env.SIZES ?? "292,10000,100000").split(",").map(Number);
const EF_SEARCH = [16, 32, 64, 128, 256];
const K = 10;
const TOPIC_NOISE = 0.3;
const PASSAGE_NOISE = 0.6;
const PER_ARTICLE = 10;

let seed = 7;
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gaussian = () => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random());
const normalise = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

const real = articleVectors.passages.map((p) => Float32Array.from(p.q, (x) => x / 127));
const dim = real[0].length;

const realArticle = articleVectors.passages.map((p) => p.id);

/** The real passages, then synthetic articles of PER_ARTICLE passages each. */
function corpus(n) {
  if (n <= real.length) return { vectors: real.slice(0, n), article: realArticle.slice(0, n) };
  const vectors = [...real];
  const article = [...realArticle];
  let centre = null;
  for (let i = 0; vectors.length < n; i += 1) {
    if (i % PER_ARTICLE === 0) {
      const mix = [0, 1, 2].map(() => [real[Math.floor(random() * real.length)], random()]);
      centre = normalise(Float32Array.from({ length: dim }, (_, d) => mix.reduce((sum, [v, w]) => sum + w * v[d], 0) + (TOPIC_NOISE / Math.sqrt(dim)) * gaussian()));
    }
    vectors.push(normalise(Float32Array.from(centre, (x) => x + (PASSAGE_NOISE / Math.sqrt(dim)) * gaussian())));
    article.push(`synthetic-${Math.floor(i / PER_ARTICLE)}`);
  }
  return { vectors, article };
}

/** Articles ranked by their best passage, as SemanticIndex#rank does. */
function articlesOf(passageIds, scoreOf, article) {
  const best = new Map();
  for (const id of passageIds) {
    const a = article[id];
    const s = scoreOf(id);
    if (!best.has(a) || s > best.get(a)) best.set(a, s);
  }
  return [...best].sort((x, y) => y[1] - x[1]).map(([a]) => a);
}

const analyser = new Retriever(articles);
const embed = await createNodeEmbedder();
const queries = await embed(cases.map((c) => queryText(analyser.analyse(c.query))));

const results = [];
for (const size of SIZES) {
  const { vectors, article } = corpus(size);
  const flat = new Float32Array(size * dim);
  vectors.forEach((v, i) => flat.set(v, i * dim));

  // Exact search: one tight loop over every vector, keeping the best K.
  const exact = (q) => {
    const top = [];
    for (let i = 0; i < size; i += 1) {
      let dot = 0;
      for (let j = 0, o = i * dim; j < dim; j += 1) dot += q[j] * flat[o + j];
      if (top.length < K || dot > top[top.length - 1][0]) {
        top.push([dot, i]);
        top.sort((x, y) => y[0] - x[0]);
        if (top.length > K) top.pop();
      }
    }
    return top.map(([, i]) => i);
  };
  let started = performance.now();
  const truth = queries.map(exact);
  const flatUs = ((performance.now() - started) / queries.length) * 1000;
  // Exact article ranking, from every passage (not timed).
  const dot = (q, i) => {
    let d = 0;
    for (let j = 0, o = i * dim; j < dim; j += 1) d += q[j] * flat[o + j];
    return d;
  };
  const exactArticles = queries.map((q) => articlesOf(Array.from({ length: size }, (_, i) => i), (i) => dot(q, i), article).slice(0, 3).join());

  started = performance.now();
  const index = HnswIndex.build(vectors);
  const buildMs = performance.now() - started;
  const links = index.links.reduce((sum, layers) => sum + layers.reduce((s, l) => s + l.length, 0), 0);

  const sweep = EF_SEARCH.map((ef) => {
    queries.forEach((q) => index.search(q, K, ef)); // warm up
    const t0 = performance.now();
    const found = queries.map((q) => index.search(q, K, ef).map((r) => r.id));
    const us = ((performance.now() - t0) / queries.length) * 1000;
    const hits = found.reduce((sum, ids, i) => sum + ids.filter((id) => truth[i].includes(id)).length, 0);
    // What the retriever reads: the top INDEX_CANDIDATES passages, grouped by article.
    let sameTop1 = 0;
    let sameTop3 = 0;
    queries.forEach((q, i) => {
      const got = articlesOf(index.search(q, INDEX_CANDIDATES, ef).map((r) => r.id), (id) => dot(q, id), article).slice(0, 3);
      const want = exactArticles[i].split(',');
      sameTop1 += got[0] === want[0] ? 1 : 0;
      sameTop3 += got.join() === want.join() ? 1 : 0;
    });
    return { efSearch: ef, recallAt10: hits / (queries.length * K), sameTopArticle: sameTop1 / queries.length, sameTop3Articles: sameTop3 / queries.length, microsecondsPerQuery: Math.round(us) };
  });
  const row = {
    passages: size,
    synthetic: size > real.length,
    flatMicrosecondsPerQuery: Math.round(flatUs),
    buildSeconds: Math.round(buildMs / 100) / 10,
    // As shipped: int8 vectors, plus 4-byte neighbour ids for the graph.
    vectorBytes: size * dim,
    graphBytes: links * 4,
    sweep,
  };
  results.push(row);
  const at = sweep.find((s) => s.efSearch === HNSW_DEFAULTS.efSearch);
  console.log(`${size} passages: flat ${row.flatMicrosecondsPerQuery} µs, HNSW ${at.microsecondsPerQuery} µs at recall@10 ${(at.recallAt10 * 100).toFixed(1)}%, same top article ${(at.sameTopArticle * 100).toFixed(1)}%, same top 3 ${(at.sameTop3Articles * 100).toFixed(1)}%, build ${row.buildSeconds}s, graph ${(row.graphBytes / 1e6).toFixed(1)} MB`);
}

writeFileSync(
  new URL('results.json', import.meta.url),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), queries: queries.length, k: K, candidates: INDEX_CANDIDATES, noise: { topic: TOPIC_NOISE, passage: PASSAGE_NOISE }, perArticle: PER_ARTICLE, params: HNSW_DEFAULTS, node: process.version, results }, null, 1)}\n`,
);
