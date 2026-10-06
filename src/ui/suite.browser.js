import { Retriever } from '../rag/retriever.js';
import { SemanticIndex } from '../rag/semantic.js';
import { Suite, SISTER_PRODUCTS, partition, canSee } from '../rag/suite.js';

/**
 * Loads the help centres of Harbour's other products, served next to the
 * page (scripts/build.js copies them to docs/suite/): 969 public articles and
 * one HNSW index over their passages and the CRM's.
 *
 * The withheld documents (internal, draft, archived, and legacy ones with no
 * status) are published too, deliberately and separately, so a reviewer can
 * see what access control keeps from the assistant. They load into their own
 * retriever, which only the retrieval panel reads.
 */
export async function loadSuite(baseUrl) {
  const get = async (name, as = 'json') => {
    const response = await fetch(new URL(`suite/${name}`, baseUrl));
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return as === 'json' ? response.json() : response.arrayBuffer();
  };
  const [articles, meta, bin, graph, internalArticles, internalMeta, internalBin] = await Promise.all([
    get('articles.json'), get('public.json'), get('public.bin', 'binary'), get('public.graph.json'),
    get('withheld-articles.json'), get('withheld.json'), get('withheld.bin', 'binary'),
  ]);
  const passagesOf = (m, buffer) => {
    const vectors = new Int8Array(buffer);
    return m.passages.map((p, i) => ({ ...p, q: vectors.subarray(i * m.dim, (i + 1) * m.dim) }));
  };
  // The build only publishes public articles here; filtering again means a
  // mislabelled file still can't put anything else in front of the assistant.
  const { visible } = partition(articles);
  const semantic = new SemanticIndex(passagesOf(meta, bin), { graph });
  // A suite per viewer. The sister products' help is for signed-in customers,
  // so a visitor's suite still recognises "in Harbour People" but has nothing
  // to answer from: the question is handed off, not answered from the CRM.
  const suiteFor = (viewer) =>
    new Suite(SISTER_PRODUCTS.map((p) => ({ key: p.key, retriever: new Retriever(visible.filter((a) => a.product === p.name && canSee(a, viewer)), {}, { semantic, plain: true }) })));
  const suites = { signedIn: suiteFor({ loggedIn: true }), signedOut: suiteFor({ loggedIn: false }) };
  // Withheld documents, loaded only for the retrieval panel's clearly labelled
  // "filtered out" section. Nothing here is given to the assistant.
  const internal = {
    articles: internalArticles,
    retriever: new Retriever(internalArticles, {}, { plain: true }),
    semantic: new SemanticIndex(passagesOf(internalMeta, internalBin)),
  };
  return { suites, semantic, articles: visible, internal };
}
