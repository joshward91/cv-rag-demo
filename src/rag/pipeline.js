import { buildPrompt, buildRoutingPrompt } from './prompt.js';
import { CRM, assertPublic } from './suite.js';
import { ExtractiveGenerator } from './generators.js';
import { costUsd, MODELS } from './pricing.js';
import { stem } from './text.js';
import { screenQuestion, LINK_PATTERN } from './guard.js';
import { queryText } from './semantic.js';

/**
 * Words that point at the assistant itself rather than at Harbour CRM. The
 * help centre documents the CRM, not this chat panel, so when such a question
 * would otherwise be escalated the assistant explains its own settings instead
 * of sending the user to support.
 */
const ASSISTANT_TERMS = new Set(
  ['mode', 'online', 'offline', 'claude', 'api', 'chatbot', 'bot', 'assistant', 'model', 'ai', 'llm', 'gpt'].map(stem),
);

export function isAboutAssistant(terms) {
  return terms.some((t) => ASSISTANT_TERMS.has(t));
}

/**
 * When a model is available, how much of the work it does. Confidence is the
 * keyword coverage of search's top article (the share of the question's
 * weighted terms it matches), not a calibrated probability.
 *   'decides' (full model, the default): the model gets up to five candidates
 *       and decides whether to answer, ask which one or hand off, for every
 *       question. Fewest wrong answers.
 *   'prose': when search is at least skipModelAtCoverage confident, search's
 *       decision stands and the model only writes the answer from the article
 *       search chose. Below that, the model decides.
 *   'offline': when search is that confident, the offline answer (the
 *       article's own steps) is returned with no model call. Below that, the
 *       model decides.
 * Full model is recommended; the other two are kept for evaluation.
 * eval/compare/tiers.mjs has the numbers.
 */
export const MODEL_TIERS = { skipModelAtCoverage: 0.7 };

export const MODEL_USE = ['decides', 'prose', 'offline'];
export const DEFAULT_MODEL_USE = 'decides';

/**
 * End-to-end question answering:
 *
 *   screen input  ->  rewrite + retrieve  ->  decide (answer / clarify / escalate)
 *     (an escalation about the assistant itself explains its settings instead)
 *     -> generate (answer path only)  ->  validate citations
 *
 * Clarification and escalation are decided before any model call, so they are
 * deterministic and free. The model only sees questions retrieval is confident
 * the help centre covers, and it can still escalate if the articles fall short.
 */
export class HelpDesk {
  /**
   * @param {{ retriever: import('./retriever.js').Retriever, generator: object, embedder?: (texts: string[]) => Promise<number[][]> }} deps
   *        With an embedder and a retriever that has a semantic index, retrieval is hybrid.
   */
  constructor({ retriever, generator, embedder = null, modelUse = DEFAULT_MODEL_USE, tiers = MODEL_TIERS, suite = null, allowInternal = false }) {
    // allowInternal exists only so the evaluation can measure what the filter prevents.
    if (!allowInternal) assertPublic(retriever.articles, CRM.name);
    this.retriever = retriever;
    this.suite = suite;
    this.generator = generator;
    this.embedder = embedder;
    this.modelUse = modelUse;
    this.tiers = tiers;
  }

  /**
   * @param {string} question
   * @param {{ chosenArticleId?: string }} [options] Set when the user picks a clarification option.
   */
  async ask(question, { chosenArticleId } = {}) {
    // Input guard first: obvious prompt injection is never retrieved for,
    // embedded or sent to a model. Only the rewrite runs, for the panel.
    const screen = screenQuestion(question);
    if (screen.blocked) {
      const decision = { type: 'blocked', rule: screen.rule, reason: `Blocked by the input guard: the question ${screen.reason}${screen.match ? ` ("${screen.match}")` : ''}.` };
      const analysis = this.retriever.analyse(question);
      const unknownTerms = analysis.terms.filter((t) => !this.retriever.df.has(t));
      const retrieval = { query: question, analysis: { ...analysis, unknownTerms }, results: [], semantic: null, decision, elapsedMs: 0 };
      return { question, retrieval, decision, prompt: null, reply: null, guardrail: null, costUsd: 0, outcome: { type: 'blocked', citations: [] } };
    }

    // A question that names another Harbour product is answered from that
    // product's help centre; anything else is about the CRM (see suite.js).
    const named = chosenArticleId ? this.#productOf(chosenArticleId) : this.suite?.named(question);
    if (named) {
      const result = await this.#ask(question, named.text ?? question, named.product.retriever, named.product.name, { chosenArticleId });
      return result;
    }
    const result = await this.#ask(question, question, this.retriever, CRM.name, { chosenArticleId });
    if (!this.suite || chosenArticleId || ['blocked', 'assistant'].includes(result.outcome.type)) return result;

    // Other products that cover the same task. Next to a CRM answer they are
    // "also in" links; if the CRM would hand off, they become suggestions.
    const alsoIn = this.suite.alsoIn(question);
    if (result.outcome.type === 'escalate' && alsoIn.length) {
      return { ...result, alsoIn: [], outcome: { type: 'suggest', options: alsoIn.map(({ id, title, product }) => ({ id, title, product })), citations: [], otherProducts: true } };
    }
    return { ...result, alsoIn };
  }

  /** The product whose help centre holds an article, for a clarification choice. */
  #productOf(articleId) {
    const product = this.suite?.products.find((p) => p.retriever.byId.has(articleId));
    return product ? { product } : null;
  }

  /** The pipeline for one product: retrieve, decide, then generate. */
  async #ask(question, searchText, r, product, { chosenArticleId }) {
    let queryVector = null;
    if (this.embedder && r.semantic) {
      [queryVector] = await this.embedder([queryText(r.analyse(searchText))]);
    }
    const retrieval = r.retrieve(searchText, { queryVector });
    let decision = retrieval.decision;

    if (chosenArticleId) {
      decision = {
        type: 'answer',
        articleId: chosenArticleId,
        contextIds: [chosenArticleId],
        reason: `The user chose "${chosenArticleId}" from the clarification options.`,
      };
    }

    const base = { question, product, retrieval, decision, prompt: null, reply: null, guardrail: null, costUsd: 0 };

    if ((decision.type === 'escalate' || decision.type === 'suggest') && !chosenArticleId && isAboutAssistant(retrieval.analysis.terms)) {
      return { ...base, outcome: { type: 'assistant', citations: [] } };
    }

    // With a model available, decide which tier this question gets.
    const usesModel = this.generator.name !== 'extractive' && !chosenArticleId;
    if (usesModel) {
      const confidence = retrieval.results[0]?.coverage ?? 0;
      const threshold = this.tiers.skipModelAtCoverage;
      const pctOf = (x) => `${Math.round(x * 100)}%`;
      if (this.modelUse === 'decides') {
        return this.#modelDecides(r, question, retrieval, base, 'Full model: the model makes every decision.');
      }
      if (confidence < threshold) {
        return this.#modelDecides(r, question, retrieval, base, `Search is ${pctOf(confidence)} confident, below ${pctOf(threshold)}, so the model decides.`);
      }
      if (decision.type === 'answer' && this.modelUse === 'prose') {
        base.tier = { name: 'prose', reason: `Search is ${pctOf(confidence)} confident (at least ${pctOf(threshold)}), so its decision stands and the model only writes the answer.` };
      } else {
        const tier = { name: 'no-model', reason: `Search is ${pctOf(confidence)} confident (at least ${pctOf(threshold)}), so the offline result is returned without a model call.` };
        if (decision.type === 'answer') return this.#answer(r, question, retrieval, decision, { ...base, tier }, new ExtractiveGenerator());
        base.tier = tier;
      }
    }

    if (decision.type === 'escalate') {
      return { ...base, outcome: { type: 'escalate', citations: [] } };
    }

    if (decision.type === 'suggest') {
      return {
        ...base,
        outcome: {
          type: 'suggest',
          options: decision.articleIds.map((id) => ({ id, title: r.byId.get(id).title })),
          citations: [],
        },
      };
    }

    if (decision.type === 'clarify') {
      const options = decision.articleIds.map((id) => r.byId.get(id));
      return {
        ...base,
        outcome: {
          type: 'clarify',
          question: 'I found more than one article that could help. Which of these do you mean?',
          options: options.map((a) => ({ id: a.id, title: a.title })),
          citations: [],
        },
      };
    }

    return this.#answer(r, question, retrieval, decision, base, this.generator);
  }

  /** Answer path. The decided article always comes first in the context. */
  async #answer(r, question, retrieval, decision, base, generator) {
    const contextIds = [decision.articleId, ...decision.contextIds.filter((id) => id !== decision.articleId)];
    const articles = contextIds.map((id) => r.byId.get(id));
    const prompt = buildPrompt(question, articles, retrieval.analysis, { product: base.product });
    return this.#generate(r, prompt, articles, retrieval, base, generator);
  }

  /** The model gets the candidates and decides: answer, ask which one, or hand off. */
  async #modelDecides(r, question, retrieval, base, reason) {
    const articles = r.candidatesFor(retrieval).map((id) => r.byId.get(id));
    if (!articles.length) {
      return { ...base, tier: { name: 'no-model', reason: 'Search found no candidates, so there is nothing for a model to read.' }, outcome: { type: 'escalate', citations: [] } };
    }
    const prompt = buildRoutingPrompt(question, articles, retrieval.analysis, { product: base.product });
    return this.#generate(r, prompt, articles, retrieval, { ...base, tier: { name: 'model-decides', reason } }, this.generator);
  }

  async #generate(r, prompt, articles, retrieval, base, generator) {
    const started = now();
    const reply = await generator.generate({ prompt, articles, analysis: retrieval.analysis });
    const generationMs = now() - started;

    const { outcome, guardrail } = validateReply(reply, prompt.contextIds, r.byId);
    const pricedModel = MODELS[reply.model] ? reply.model : generator.model;
    const cost = reply.usage && pricedModel ? costUsd(pricedModel, reply.usage) : 0;

    return { ...base, prompt, reply, guardrail, outcome, costUsd: cost ?? 0, generationMs };
  }
}

/**
 * Output guardrail. An answer must cite at least one article, every citation
 * must be an article that was actually in the prompt, and it must not contain
 * a link. Otherwise the answer is withheld and the user is offered support.
 */
export function validateReply(reply, contextIds, articlesById) {
  if (reply.type !== 'answer' && reply.type !== 'clarify') {
    return { outcome: { type: 'escalate', citations: [], note: reply.note }, guardrail: null };
  }
  // The help centre contains no links, so a link in an answer came from outside it.
  if (LINK_PATTERN.test(reply.answer)) {
    return { outcome: { type: 'escalate', citations: [] }, guardrail: { action: 'withheld', reason: 'The answer contained a link, which no help article has.' } };
  }
  const valid = reply.citations.filter((id) => contextIds.includes(id) && articlesById.has(id));
  const invalid = reply.citations.filter((id) => !valid.includes(id));

  // A clarifying question from the model: the options are the articles it named.
  if (reply.type === 'clarify') {
    const options = [...new Set(valid)];
    if (options.length < 2) {
      return { outcome: { type: 'escalate', citations: [] }, guardrail: { action: 'withheld', reason: 'The model asked a clarifying question but named fewer than two articles that were provided.' } };
    }
    return {
      outcome: {
        type: 'clarify',
        question: reply.answer || 'I found more than one article that could help. Which of these do you mean?',
        options: options.map((id) => ({ id, title: articlesById.get(id).title })),
        citations: [],
      },
      guardrail: invalid.length ? { action: 'dropped', reason: `Removed options that were not provided: ${invalid.join(', ')}` } : null,
    };
  }

  if (valid.length === 0) {
    return {
      outcome: { type: 'escalate', citations: [] },
      guardrail: { action: 'withheld', reason: invalid.length ? `Cited articles that were not provided: ${invalid.join(', ')}` : 'The answer cited no article.' },
    };
  }
  return {
    outcome: { type: 'answer', text: reply.answer, citations: [...new Set(valid)] },
    guardrail: invalid.length ? { action: 'dropped', reason: `Removed citations that were not provided: ${invalid.join(', ')}` } : null,
  };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
