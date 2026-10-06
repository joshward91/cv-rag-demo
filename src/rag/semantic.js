import { stripMarkdown } from './retriever.js';

/**
 * Semantic side of hybrid retrieval: sentence embeddings compared by cosine
 * similarity. It catches paraphrases that share no words with an article
 * ("they signed the contract" -> "Mark a deal as won"), which lexical BM25
 * can't. BM25 stays in charge of exact product terms such as "client contact
 * number"; see Retriever for how the two are combined.
 *
 * Article vectors are computed once at build time (scripts/embed-articles.mjs)
 * so the browser only ever embeds the question. With 29 articles a flat
 * in-memory index is exact and instant; a vector database would only start to
 * pay off at many thousands of documents.
 */

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * The passages an article is embedded as: its title, each alias, and each
 * sentence or step of its body. A short question is compared with short
 * passages, which this small model does far better than question-to-whole-
 * article. An article's similarity is its best passage's.
 */
export function articlePassages(article) {
  const body = stripMarkdown(article.body)
    .split(/\n+|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return [
    ...[article.title, ...article.aliases].map((text) => ({ text, body: false })),
    ...body.map((text) => ({ text, body: true })),
  ];
}

/** Body sentences also mention neighbouring tasks, so they count for a little less. */
export const BODY_PASSAGE_WEIGHT = 0.9;

// Phrase-rule tokens back into words the embedding model understands.
const READABLE = {
  clientcontactnumber: 'client contact number',
  businessname: 'client name',
  billingemail: 'billing email',
  customfield: 'custom field',
};

/**
 * The question as the embedding model should see it: after the phrase rules,
 * so "a client's phone" has already become "a contact s phone". Embedding the
 * raw question would let the vendor's "client" articles pull in contact
 * questions, the exact trap the lexicon exists to prevent.
 */
export function queryText(analysis) {
  return analysis.rewrittenText.replace(/\b(clientcontactnumber|businessname|billingemail|customfield)\b/g, (t) => READABLE[t]);
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot; // vectors are L2-normalised when created
}

/** Vectors are stored as int8 (value * 127) to keep the page small. */
export function quantise(vector) {
  return vector.map((x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
}

export class SemanticIndex {
  /**
   * @param {Array<{ id: string, text: string, body: boolean, q: number[] }>} passages
   *        int8-quantised, L2-normalised passage embeddings
   */
  constructor(passages) {
    this.passages = passages.map((p) => ({ ...p, v: Float32Array.from(p.q, (x) => x / 127) }));
  }

  /** Every article, most similar first, with the passage that matched best. */
  rank(queryVector) {
    const best = new Map();
    for (const p of this.passages) {
      const similarity = cosine(queryVector, p.v) * (p.body ? BODY_PASSAGE_WEIGHT : 1);
      if (!best.has(p.id) || similarity > best.get(p.id).similarity) best.set(p.id, { id: p.id, similarity, passage: p.text });
    }
    return [...best.values()].sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  }
}
