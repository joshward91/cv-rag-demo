#!/usr/bin/env node
/**
 * Builds the Harbour suite used by the multi-product evaluation: the Harbour
 * CRM help centre plus 1,000 help articles for five sister products, and
 * documents the assistant must never show: 100 internal staff documents, 40
 * drafts, 40 archived articles and 10 legacy documents with no status at all
 * (eval/suite/articles/, written by separate agents).
 *
 *   - Cleans the drafts: drops boilerplate closing sentences the writers
 *     appended to many articles, merges tasks two writers both covered,
 *     checks every field.
 *   - Splits by status: public sister-product articles go to
 *     src/kb/suite-articles.json, everything else (draft, internal, archived,
 *     and no status, caught by the safety net) to
 *     eval/suite/withheld-articles.json. Nothing under src/ ever imports the
 *     withheld file.
 *   - Embeds every passage and writes int8 vectors plus two HNSW graphs to
 *     eval/suite/index/: one over the public passages only, and one that also
 *     holds the withheld documents, as a shared vector database would. The
 *     withheld passages are also saved alone (no graph) for the demo's
 *     labelled "filtered out" panel.
 *
 *   node scripts/build-suite.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { articles as crmArticles } from '../src/kb/articles.js';
import { articleVectors } from '../src/kb/article-vectors.js';
import { articlePassages, quantise, EMBEDDING_MODEL } from '../src/rag/semantic.js';
import { createNodeEmbedder } from '../src/rag/embedder.node.js';
import { HnswIndex } from '../src/rag/hnsw.js';
import { SISTER_PRODUCTS, DOCUMENT_STATUSES, isPublic, withheldReason } from '../src/rag/suite.js';

const root = new URL('../', import.meta.url);
const dir = new URL('eval/suite/articles/', root);
// Status is each document's own metadata, as the help centre or wiki stores
// it. A missing status is kept as missing: the access filter withholds it.
const drafts = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
for (const a of drafts) {
  if (a.status !== undefined && !DOCUMENT_STATUSES.includes(a.status)) throw new Error(`${a.id}: unknown status "${a.status}"`);
}

// Boilerplate closers ("Changes take effect straight away...") that writers
// added to reach a word count. Kept when it is the internal-only warning.
const sentences = (body) => body.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
const closers = new Map();
for (const a of drafts) {
  const last = sentences(a.body).at(-1);
  closers.set(last, (closers.get(last) ?? 0) + 1);
}
const boilerplate = new Set([...closers].filter(([s, n]) => n >= 8 && !/^\d|^select|^do not share/i.test(s)).map(([s]) => s));

const products = new Set(['Harbour CRM', ...SISTER_PRODUCTS.map((p) => p.name), 'Harbour (all products)']);
// Writers sometimes added a description: "Harbour Mail (email and SMS marketing)".
const productName = (name) => (name === 'Harbour (all products)' ? name : name.replace(/\s*\(.*\)$/, ''));
const seen = new Set(crmArticles.map((a) => a.id));
const cleaned = [];
let stripped = 0;
// Two writers per product occasionally wrote the same task. Keep the first;
// record the duplicate's id so test cases that name it still resolve.
const merged = {};
const titleKey = (a) => `${a.status}|${productName(a.product)}|${a.title.toLowerCase().replace(/[^a-z ]/g, '')}`;
const byTitle = new Map();
for (const a of drafts) {
  const twin = byTitle.get(titleKey(a)) ?? (seen.has(a.id) ? cleaned.find((c) => c.id === a.id) : null);
  if (twin) {
    merged[a.id] = twin.id;
    continue;
  }
  if (seen.has(a.id)) throw new Error(`${a.id} clashes with a Harbour CRM article`);
  const id = a.id;
  seen.add(id);
  const parts = sentences(a.body);
  let body = a.body.trim();
  if (parts.length > 1 && boilerplate.has(parts.at(-1))) {
    body = body.slice(0, body.lastIndexOf(parts.at(-1))).trim();
    stripped += 1;
  }
  const product = productName(a.product);
  if (!products.has(product) || (product === 'Harbour (all products)' && isPublic(a))) throw new Error(`${id}: unknown product ${a.product}`);
  if (!a.title || !body || !Array.isArray(a.aliases)) throw new Error(`${id}: missing fields`);
  const article = {
    id,
    product,
    ...(a.status === undefined ? {} : { status: a.status }),
    category: a.category,
    title: a.title,
    aliases: a.aliases,
    body,
    notConfusedWith: a.notConfusedWith ?? [],
  };
  cleaned.push(article);
  byTitle.set(titleKey(a), article);
}
for (const a of cleaned) {
  a.notConfusedWith = [...new Set(a.notConfusedWith.map((x) => merged[x] ?? x))].filter((x) => x !== a.id && cleaned.some((c) => c.id === x));
}
writeFileSync(new URL('eval/suite/merged-ids.json', root), `${JSON.stringify(merged, null, 1)}\n`);
const sister = cleaned.filter(isPublic);
const withheld = cleaned.filter((a) => !isPublic(a));
writeFileSync(new URL('src/kb/suite-articles.json', root), `${JSON.stringify(sister)}\n`);
writeFileSync(new URL('eval/suite/withheld-articles.json', root), `${JSON.stringify(withheld, null, 1)}\n`);

// Passages: the CRM's own (already embedded), then sister products, then withheld.
const embed = await createNodeEmbedder();
const passagesOf = (list) => list.flatMap((a) => articlePassages(a).map((p) => ({ id: a.id, ...p })));
async function vectorsFor(passages) {
  const out = [];
  for (let i = 0; i < passages.length; i += 256) out.push(...(await embed(passages.slice(i, i + 256).map((p) => p.text))));
  return out.map(quantise);
}
const crm = articleVectors.passages.map(({ q, ...p }) => ({ ...p, q }));
const sisterPassages = passagesOf(sister);
const withheldPassages = passagesOf(withheld);
const sisterQ = await vectorsFor(sisterPassages);
const withheldQ = await vectorsFor(withheldPassages);

const out = new URL('eval/suite/index/', root);
mkdirSync(out, { recursive: true });
const pub = [...crm, ...sisterPassages.map((p, i) => ({ ...p, q: sisterQ[i] }))];
const all = [...pub, ...withheldPassages.map((p, i) => ({ ...p, q: withheldQ[i] }))];
const save = (name, passages, { graph: withGraph = true } = {}) => {
  writeFileSync(new URL(`${name}.bin`, out), Int8Array.from(passages.flatMap((p) => p.q)));
  writeFileSync(new URL(`${name}.json`, out), `${JSON.stringify({ model: EMBEDDING_MODEL, dim: passages[0].q.length, passages: passages.map(({ q, ...p }) => p) })}\n`);
  if (!withGraph) return;
  const started = performance.now();
  const graph = HnswIndex.build(passages.map((p) => Float32Array.from(p.q, (x) => x / 127))).toJSON();
  writeFileSync(new URL(`${name}.graph.json`, out), `${JSON.stringify(graph)}\n`);
  console.log(`${name}: ${passages.length} passages, graph built in ${((performance.now() - started) / 1000).toFixed(1)}s`);
};
const reasons = Object.entries(Object.groupBy(withheld, withheldReason)).map(([r, l]) => `${l.length} ${r}`).join(', ');
console.log(`${sister.length} sister-product articles, ${withheld.length} withheld (${reasons}); merged ${Object.keys(merged).length} duplicates; removed a boilerplate closing sentence from ${stripped}.`);
save('public', pub);
save('all', all);
// Withheld passages on their own, for the demo's clearly labelled "filtered
// out" panel. Never loaded into the assistant's index.
save('withheld', withheldPassages.map((p, i) => ({ ...p, q: withheldQ[i] })), { graph: false });
