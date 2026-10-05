import { analyse } from './analyze.js';
import { CONCEPTS, ACTION_TERMS } from './lexicon.js';

/**
 * Field-weighted BM25 (a simplified BM25F) over single-task help articles,
 * followed by an explicit decision policy: answer, clarify or escalate.
 *
 * Scores alone are not comparable across queries, so the policy also uses
 * *coverage*: the IDF-weighted share of query terms that the article contains.
 * A term found only in the body counts for half, because an article's title
 * and aliases say what it is about while its body also mentions neighbours
 * ("to change a contact's number, edit the contact instead").
 * A query term that appears nowhere in the help centre (for example "import")
 * lowers coverage, and low coverage means the docs can't answer the question.
 */

export const FIELD_WEIGHTS = { title: 3, aliases: 2, body: 1 };

export const DEFAULT_POLICY = {
  k1: 1.2,
  b: 0.75,
  /** Below this coverage the help centre doesn't cover the question. */
  minCoverage: 0.55,
  /** Clarify when a declared look-alike scores at least this share of the top score. */
  clarifyRatioLinked: 0.6,
  /** Clarify between any two articles that score this close. */
  clarifyRatioAny: 0.95,
  /** Coverage credit for a term found only in an article's body. */
  bodyOnlyCredit: 0.5,
  maxClarifyOptions: 3,
  topK: 5,
  /** Articles passed to the language model as context. */
  contextK: 3,
};

export function stripMarkdown(md) {
  return md.replace(/\*\*/g, '').replace(/^\s*(?:\d+\.|-)\s+/gm, '');
}

export class Retriever {
  /**
   * @param {Array<object>} articles
   * @param {Partial<typeof DEFAULT_POLICY>} [policy]
   */
  constructor(articles, policy = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.articles = articles;
    this.byId = new Map(articles.map((a) => [a.id, a]));

    this.docs = articles.map((a) => {
      const fields = {
        title: analyse(a.title, { perspective: 'document' }).terms,
        aliases: a.aliases.flatMap((alias) => analyse(alias, { perspective: 'document' }).terms),
        body: analyse(stripMarkdown(a.body), { perspective: 'document' }).terms,
      };
      const tf = {};
      for (const [field, terms] of Object.entries(fields)) {
        tf[field] = new Map();
        for (const t of terms) tf[field].set(t, (tf[field].get(t) ?? 0) + 1);
      }
      const termSet = new Set(Object.values(fields).flat());
      return { id: a.id, fields, tf, termSet };
    });

    this.avgLength = {};
    for (const field of Object.keys(FIELD_WEIGHTS)) {
      this.avgLength[field] = this.docs.reduce((sum, d) => sum + d.fields[field].length, 0) / this.docs.length || 1;
    }

    this.df = new Map();
    for (const d of this.docs) for (const t of d.termSet) this.df.set(t, (this.df.get(t) ?? 0) + 1);

    this.vocabulary = new Set([...this.df.keys(), ...Object.values(CONCEPTS).flat()]);
  }

  idf(term) {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  scoreDoc(doc, terms) {
    const { k1, b } = this.policy;
    let score = 0;
    let coveredIdf = 0;
    const matched = [];
    for (const t of terms) {
      let weightedTf = 0;
      for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        const tf = doc.tf[field].get(t) ?? 0;
        if (!tf) continue;
        const norm = 1 - b + (b * doc.fields[field].length) / this.avgLength[field];
        weightedTf += (weight * tf * (k1 + 1)) / (tf + k1 * norm);
      }
      if (weightedTf > 0) {
        score += this.idf(t) * weightedTf;
        const inHeading = doc.tf.title.has(t) || doc.tf.aliases.has(t);
        coveredIdf += this.idf(t) * (inHeading ? 1 : this.policy.bodyOnlyCredit);
        matched.push(t);
      }
    }
    return { score, matched, coveredIdf };
  }

  /**
   * Run retrieval and the decision policy for one query.
   * @param {string} query
   */
  retrieve(query) {
    const started = now();
    const analysis = analyse(query, { vocabulary: this.vocabulary, spellCheck: true });
    const terms = [...new Set(analysis.terms)];

    // A word the help centre never uses (e.g. "import") is evidence that the
    // question is out of scope, but a single unknown word ("system", "wrong")
    // shouldn't outweigh everything else. It counts as much as the most
    // specific word that *was* recognised.
    const known = terms.filter((t) => this.df.has(t));
    const unknownWeight = Math.max(0, ...known.map((t) => this.idf(t)));
    const weightOf = (t) => (this.df.has(t) ? this.idf(t) : unknownWeight);
    const totalIdf = terms.reduce((sum, t) => sum + weightOf(t), 0);

    const ranked = this.docs
      .map((doc) => {
        const { score, matched, coveredIdf } = this.scoreDoc(doc, terms);
        return {
          id: doc.id,
          title: this.byId.get(doc.id).title,
          score,
          coverage: totalIdf ? coveredIdf / totalIdf : 0,
          matched,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.id.localeCompare(b.id));

    const unknownTerms = terms.filter((t) => !this.df.has(t));
    const decision = this.decide(terms, ranked);

    return {
      query,
      analysis: { ...analysis, terms, unknownTerms },
      results: ranked.slice(0, this.policy.topK),
      decision,
      elapsedMs: now() - started,
    };
  }

  decide(terms, ranked) {
    const p = this.policy;
    if (terms.length === 0) {
      return { type: 'escalate', reason: 'The question has no searchable terms.' };
    }
    const top = ranked[0];
    if (!top) {
      return { type: 'escalate', reason: 'No article contains any of the query terms.' };
    }
    if (top.coverage < p.minCoverage) {
      return {
        type: 'escalate',
        reason: `Best match "${top.id}" covers ${pct(top.coverage)} of the query, below the ${pct(p.minCoverage)} threshold.`,
      };
    }

    // "delete" or "rename" on its own: ask what the user wants to act on.
    if (terms.every((t) => ACTION_TERMS.has(t))) {
      const options = ranked.filter((r) => r.coverage >= p.minCoverage).slice(0, p.maxClarifyOptions);
      if (options.length > 1) {
        return {
          type: 'clarify',
          articleIds: options.map((r) => r.id),
          reason: `The question names an action ("${terms.join(' ')}") but not what it applies to.`,
        };
      }
    }

    const linked = (a, b) => {
      const x = this.byId.get(a);
      const y = this.byId.get(b);
      return x.notConfusedWith.includes(b) || y.notConfusedWith.includes(a);
    };
    // A rival is only a real alternative if its title or aliases mention
    // every query term that the top article's title or aliases mention. If the
    // user named something that only the top article is about ("contact" in
    // "change a contact's email"), there is nothing to clarify.
    const headingTerms = (id) => {
      const doc = this.docs.find((d) => d.id === id);
      return new Set(terms.filter((t) => doc.tf.title.has(t) || doc.tf.aliases.has(t)));
    };
    const topHeading = headingTerms(top.id);
    const rivals = ranked.slice(1).filter((r) => {
      const ratio = r.score / top.score;
      if (r.coverage < p.minCoverage) return false;
      const rivalHeading = headingTerms(r.id);
      if (![...topHeading].every((t) => rivalHeading.has(t))) return false;
      return ratio >= p.clarifyRatioAny || (ratio >= p.clarifyRatioLinked && linked(top.id, r.id));
    });

    if (rivals.length > 0) {
      const options = [top, ...rivals].slice(0, p.maxClarifyOptions).map((r) => r.id);
      return {
        type: 'clarify',
        articleIds: options,
        reason: `"${rivals[0].id}" scores ${pct(rivals[0].score / top.score)} of "${top.id}"${linked(top.id, rivals[0].id) ? ', and the two are marked as easy to confuse' : ''}.`,
      };
    }

    return {
      type: 'answer',
      articleId: top.id,
      // Supporting context for the model: other strong matches, except the
      // articles the docs declare easy to confuse with the answer. Handing the
      // model a look-alike ("client contact number" next to "a contact's
      // phone number") invites it to blend the two.
      contextIds: ranked
        .slice(0, p.contextK)
        .filter((r) => r.id === top.id || (r.coverage >= p.minCoverage && !linked(top.id, r.id)))
        .map((r) => r.id),
      excludedLookAlikes: ranked.slice(1, p.contextK).filter((r) => linked(top.id, r.id)).map((r) => r.id),
      reason: `"${top.id}" covers ${pct(top.coverage)} of the query and leads the next article by ${ranked[1] ? pct(1 - ranked[1].score / top.score) : '100%'}.`,
    };
  }
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
