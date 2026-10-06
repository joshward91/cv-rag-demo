/**
 * Harbour's other products. The assistant lives inside Harbour CRM, so a
 * question is about the CRM unless it names another product. Sister products
 * have their own help centres and their own vocabulary: none of the CRM's
 * "client" rules apply to them, so each gets its own plain retriever.
 *
 *   - A question that names a product ("in Harbour Mail", "the invoicing app")
 *     is answered from that product's help centre.
 *   - Otherwise the CRM answers as before, and close matches in other
 *     products are offered alongside ("You can also do this in Harbour Mail").
 *   - If the CRM would hand off but another product covers the question, its
 *     articles are suggested, never answered: the user didn't ask about it.
 *
 * Access control: retrievers are only ever given articles whose status is
 * public, and the semantic index is always filtered to a retriever's own
 * articles, so a draft, internal or archived document can sit in the same
 * vector index and still never reach a result, a suggestion or a prompt.
 * eval/suite/ checks that.
 */

export const SISTER_PRODUCTS = [
  { key: 'invoicing', name: 'Harbour Invoicing', pattern: /\b(?:harbour invoicing|(?:the )?invoicing (?:app|product)|in invoicing)\b/g },
  { key: 'mail', name: 'Harbour Mail', pattern: /\b(?:harbour mail|(?:the )?mail (?:app|product)|in mail)\b/g },
  { key: 'desk', name: 'Harbour Desk', pattern: /\b(?:harbour desk|(?:the )?(?:help ?)?desk (?:app|product)|in desk)\b/g },
  { key: 'people', name: 'Harbour People', pattern: /\b(?:harbour people|(?:the )?people (?:app|product)|in people)\b/g },
  { key: 'projects', name: 'Harbour Projects', pattern: /\b(?:harbour projects?|(?:the )?projects? (?:app|product)|in projects)\b/g },
];

export const CRM = { key: 'crm', name: 'Harbour CRM' };

/** Close matches in other products shown next to a CRM answer. */
export const MAX_ALSO_IN = 2;

/**
 * A document's lifecycle status, as a help centre or wiki would store it.
 * New documents start as drafts. Only public ones reach the assistant.
 */
export const DOCUMENT_STATUSES = ['draft', 'public', 'internal', 'archived'];

/**
 * Whether the assistant may use a document. Only an explicit 'public' passes.
 * A missing or unknown status is not an expected state; it is caught by the
 * same rule, as a safety net, rather than guessed at. Status is metadata from
 * the source system, never inferred from a document's length or wording, so
 * a dense public page such as API reference stays public.
 */
export function isPublic(article) {
  return article.status === 'public';
}

/** Why a document is withheld: its status, or the safety net when it has none. */
export function withheldReason(article) {
  if (isPublic(article)) return null;
  if (article.status === undefined || article.status === null || article.status === '') return 'no status';
  return DOCUMENT_STATUSES.includes(article.status) ? article.status : `unknown status "${article.status}"`;
}

/** Splits documents into the ones the assistant may use and the ones it must not. */
export function partition(list) {
  return { visible: list.filter(isPublic), withheld: list.filter((a) => !isPublic(a)) };
}

/** Throws unless every article is public: a retriever must never be given anything else. */
export function assertPublic(list, where) {
  const held = list.filter((a) => !isPublic(a));
  if (held.length) throw new Error(`Non-public documents in the ${where} retriever: ${held.map((a) => `${a.id} (${withheldReason(a)})`).join(', ')}`);
}

export class Suite {
  /**
   * @param {Array<{ key: string, retriever: import('./retriever.js').Retriever }>} products
   *        A retriever per sister product, over that product's public articles.
   */
  constructor(products, { allowInternal = false } = {}) {
    this.products = products.map((p) => ({ ...SISTER_PRODUCTS.find((s) => s.key === p.key), retriever: p.retriever }));
    // allowInternal exists only so the evaluation can measure what the filter prevents.
    for (const p of allowInternal ? [] : this.products) assertPublic(p.retriever.articles, p.name);
  }

  /** The sister product a question names, if any, and the question without the name. */
  named(question) {
    const text = question.toLowerCase();
    for (const p of this.products) {
      p.pattern.lastIndex = 0;
      if (p.pattern.test(text)) {
        p.pattern.lastIndex = 0;
        return { product: p, text: text.replace(p.pattern, ' ').replace(/\s+/g, ' ').trim() };
      }
    }
    return null;
  }

  /** Articles in other products that keyword search would answer with. */
  alsoIn(question) {
    const found = [];
    for (const p of this.products) {
      const { decision, results } = p.retriever.retrieve(question);
      if (decision.type !== 'answer') continue;
      const top = results.find((r) => r.id === decision.articleId);
      found.push({ id: top.id, title: top.title, product: p.name, coverage: top.coverage, score: top.score });
    }
    return found.sort((a, b) => b.coverage - a.coverage || b.score - a.score).slice(0, MAX_ALSO_IN);
  }
}
