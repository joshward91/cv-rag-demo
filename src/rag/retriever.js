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
  /**
   * Hybrid retrieval. When lexical retrieval would escalate, semantic matches
   * at or above this cosine similarity are offered as suggestions instead.
   * Calibrated on the dev set's paraphrases and out-of-scope questions.
   */
  suggestMinSimilarity: 0.45,
  /** Also suggest articles within this distance of the best semantic match. */
  suggestWindow: 0.08,
  maxSuggestions: 3,
  /** Score multiplier when the question's terms are exactly a title's or an alias's (1 = off). */
  exactPhrasingBoost: 1,
};

export function stripMarkdown(md) {
  return md.replace(/\*\*/g, '').replace(/^\s*(?:\d+\.|-)\s+/gm, '');
}

export class Retriever {
  /**
   * @param {Array<object>} articles
   * @param {Partial<typeof DEFAULT_POLICY>} [policy]
   * @param {{ semantic?: import('./semantic.js').SemanticIndex, plain?: boolean, product?: string }} [options]
   *        With a semantic index, retrieval is hybrid (see `retrieve`). `plain`
   *        turns off Harbour CRM's phrase rules, for a sister product's help
   *        centre. With `product`, semantic search only returns that product's
   *        articles (the index may hold several products). `weight(article)`
   *        scales an article's keyword score and semantic similarity, so the
   *        same articles can rank differently for different viewers (see
   *        viewerWeight in suite.js); it changes ranking, never coverage.
   *        `fallback` is a second retriever (the overview pages, for a
   *        signed-in customer) that is consulted only when this one would
   *        hand off. Each keeps its own term statistics, so
   *        adding overview pages can't change how the task help is ranked.
   *        With `fallbackWeight`, the fallback is also consulted when this
   *        one answers, asks or suggests, and its answer wins if its weighted
   *        coverage is higher. The evaluation measures it; nothing ships it.
   */
  constructor(articles, policy = {}, { semantic = null, plain = false, product = null, weight = null, fallback = null, fallbackWeight = null } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.semantic = semantic;
    this.plain = plain;
    this.product = product;
    const docSide = plain ? 'plain' : 'document';
    this.articles = articles;
    this.byId = new Map(articles.map((a) => [a.id, a]));
    this.weightOf = weight ? new Map(articles.map((a) => [a.id, weight(a)])) : null;
    this.fallback = fallback;
    this.fallbackWeight = fallbackWeight;
    // Ids this retriever searches itself; byId also resolves the fallback's.
    this.ownIds = new Set(this.byId.keys());
    for (const [id, a] of fallback?.byId ?? []) this.byId.set(id, a);

    this.docs = articles.map((a) => {
      const fields = {
        title: analyse(a.title, { perspective: docSide }).terms,
        aliases: a.aliases.flatMap((alias) => analyse(alias, { perspective: docSide }).terms),
        body: analyse(stripMarkdown(a.body), { perspective: docSide }).terms,
      };
      const tf = {};
      for (const [field, terms] of Object.entries(fields)) {
        tf[field] = new Map();
        for (const t of terms) tf[field].set(t, (tf[field].get(t) ?? 0) + 1);
      }
      const termSet = new Set(Object.values(fields).flat());
      // Each title and alias as a set of terms, to spot a question that is
      // exactly one of the article's own phrasings.
      const phrasings = [a.title, ...a.aliases].map((x) => [...new Set(analyse(x, { perspective: docSide }).terms)].sort().join(' '));
      return { id: a.id, fields, tf, termSet, phrasings: new Set(phrasings) };
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

  /** The query analysis on its own, so a caller can embed the rewritten question first. */
  analyse(query) {
    return analyse(query, { vocabulary: this.vocabulary, spellCheck: true, perspective: this.plain ? 'plain' : 'query' });
  }

  /**
   * Run retrieval and the decision policy for one query.
   *
   * Hybrid retrieval, when a query vector is given: lexical BM25 decides
   * first, because it is precise about product terms ("client contact
   * number") and its coverage measure knows when a question mentions things
   * the help centre never does. Where it would escalate, semantic similarity
   * gets a say: close paraphrases are offered as suggestions ("Did you mean
   * ...?") rather than answered outright, because embeddings also rate
   * unsupported look-alikes ("import contacts" vs "export contacts") highly.
   *
   * @param {string} query
   * @param {{ queryVector?: number[] | Float32Array }} [options]
   */
  retrieve(query, { queryVector = null } = {}) {
    const started = now();
    const analysis = this.analyse(query);
    const terms = [...new Set(analysis.terms)];

    // A word the help centre never uses (e.g. "import") is evidence that the
    // question is out of scope, but a single unknown word ("system", "wrong")
    // shouldn't outweigh everything else. It counts as much as the most
    // specific word that *was* recognised.
    const known = terms.filter((t) => this.df.has(t));
    const unknownWeight = Math.max(0, ...known.map((t) => this.idf(t)));
    const weightOf = (t) => (this.df.has(t) ? this.idf(t) : unknownWeight);
    const totalIdf = terms.reduce((sum, t) => sum + weightOf(t), 0);
    const phrasing = [...terms].sort().join(' ');

    const ranked = this.docs
      .map((doc) => {
        const { score: raw, matched, coveredIdf } = this.scoreDoc(doc, terms);
        // A question that is exactly one of an article's own phrasings (its
        // title or an "also called" alias) is strong evidence on its own.
        // Off by default: on the task help it cost dev-set answers. The
        // overview pages turn it on (viewerRetriever in suite.js), because
        // they are long prose that repeats the common words, so a page that
        // says "contact" and "add" often outranked the Contacts overview for
        // "how do I add a contact".
        const score = doc.phrasings.has(phrasing) ? raw * this.policy.exactPhrasingBoost : raw;
        return {
          id: doc.id,
          title: this.byId.get(doc.id).title,
          score: score * (this.weightOf?.get(doc.id) ?? 1),
          coverage: totalIdf ? coveredIdf / totalIdf : 0,
          matched,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.id.localeCompare(b.id));

    const unknownTerms = terms.filter((t) => !this.df.has(t));
    let decision = this.decide(terms, ranked);

    let semantic = null;
    if (queryVector && this.semantic) {
      semantic = this.semantic.rank(queryVector, { onlyIds: this.ownIds });
      if (this.weightOf) {
        semantic = semantic.map((s) => ({ ...s, similarity: s.similarity * this.weightOf.get(s.id) })).sort((a, b) => b.similarity - a.similarity);
      }
      const similarityOf = new Map(semantic.map((s) => [s.id, s.similarity]));
      for (const r of ranked) r.similarity = similarityOf.get(r.id) ?? this.semantic.similarityTo(queryVector, r.id) * (this.weightOf?.get(r.id) ?? 1);
      if (decision.type === 'escalate') decision = this.suggest(semantic, decision);
    }

    const own = {
      query,
      analysis: { ...analysis, terms, unknownTerms },
      results: ranked.slice(0, this.policy.topK),
      semantic: semantic?.slice(0, this.policy.topK) ?? null,
      decision,
      elapsedMs: now() - started,
    };
    // Only a hand-off goes to the fallback. A suggestion already points at
    // the task help; letting the overview pages answer instead turned "Can I
    // import contacts from a spreadsheet?" (dev set) into a confident answer
    // from the export overview.
    if (!this.fallback) return own;
    if (this.fallbackWeight === null && decision.type !== 'escalate') return own;
    const other = this.fallback.retrieve(query, { queryVector });
    if (other.decision.type !== 'answer') return own;
    // Blended: each set is scored with its own statistics, so the task help
    // ranks exactly as it would alone. The fallback's answer wins only if its
    // coverage, weighted down, beats the best task article's.
    if (decision.type !== 'escalate') {
      const ownCoverage = ranked[0]?.coverage ?? 0;
      const otherCoverage = other.results.find((r) => r.id === other.decision.articleId).coverage;
      if (otherCoverage * this.fallbackWeight <= ownCoverage) return own;
    }
    return {
      ...own,
      results: [...other.results, ...own.results].slice(0, this.policy.topK),
      semantic: own.semantic && other.semantic ? [...other.semantic, ...own.semantic].slice(0, this.policy.topK) : own.semantic,
      decision: { ...other.decision, reason: `${decision.reason} Fallback: ${other.decision.reason}` },
      elapsedMs: now() - started,
    };
  }

  /**
   * Candidates for a model that makes the decision itself: the top three from
   * keyword search and the top three from semantic search, merged, up to
   * five. Look-alikes stay in, because telling them apart is the model's job.
   */
  candidatesFor(retrieval, max = 5) {
    const ids = [];
    const pools = retrieval.semantic ? [retrieval.results.slice(0, 3), retrieval.semantic.slice(0, 3)] : [retrieval.results.slice(0, max)];
    for (const id of pools.flat().map((x) => x.id)) {
      if (!ids.includes(id) && ids.length < max) ids.push(id);
    }
    return ids;
  }

  /** True when either article declares the other easy to confuse with it. */
  linked(a, b) {
    const x = this.byId.get(a);
    const y = this.byId.get(b);
    return x.notConfusedWith.includes(b) || y.notConfusedWith.includes(a);
  }

  /** Turn a lexical escalation into suggestions when the semantic match is close enough. */
  suggest(semantic, escalation) {
    const p = this.policy;
    const [best] = semantic;
    if (!best || best.similarity < p.suggestMinSimilarity) {
      return { ...escalation, reason: `${escalation.reason} Closest semantic match "${best?.id}" is ${best ? best.similarity.toFixed(2) : 'n/a'}, below ${p.suggestMinSimilarity}.` };
    }
    // As with model context, never offer an article next to one it is declared
    // easy to confuse with: the best match wins and its look-alikes are dropped.
    const options = [];
    for (const s of semantic) {
      if (s.similarity < p.suggestMinSimilarity || s.similarity < best.similarity - p.suggestWindow) break;
      if (options.some((o) => this.linked(o.id, s.id))) continue;
      options.push(s);
      if (options.length === p.maxSuggestions) break;
    }
    return {
      type: 'suggest',
      articleIds: options.map((s) => s.id),
      reason: `${escalation.reason} Semantic search found ${options.length === 1 ? 'a close match' : 'close matches'} (best "${best.id}" at ${best.similarity.toFixed(2)}, via "${best.passage}"), so they are suggested rather than answered.`,
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

    const linked = (a, b) => this.linked(a, b);
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
