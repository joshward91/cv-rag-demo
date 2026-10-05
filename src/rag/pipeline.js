import { buildPrompt } from './prompt.js';
import { costUsd, MODELS } from './pricing.js';
import { stem } from './text.js';

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
 * End-to-end question answering:
 *
 *   rewrite + retrieve  ->  decide (answer / clarify / escalate)
 *     (an escalation about the assistant itself explains its settings instead)
 *     -> generate (answer path only)  ->  validate citations
 *
 * Clarification and escalation are decided before any model call, so they are
 * deterministic and free. The model only sees questions retrieval is confident
 * the help centre covers, and it can still escalate if the articles fall short.
 */
export class HelpDesk {
  /**
   * @param {{ retriever: import('./retriever.js').Retriever, generator: object }} deps
   */
  constructor({ retriever, generator }) {
    this.retriever = retriever;
    this.generator = generator;
  }

  /**
   * @param {string} question
   * @param {{ chosenArticleId?: string }} [options] Set when the user picks a clarification option.
   */
  async ask(question, { chosenArticleId } = {}) {
    const retrieval = this.retriever.retrieve(question);
    let decision = retrieval.decision;

    if (chosenArticleId) {
      decision = {
        type: 'answer',
        articleId: chosenArticleId,
        contextIds: [chosenArticleId],
        reason: `The user chose "${chosenArticleId}" from the clarification options.`,
      };
    }

    const base = { question, retrieval, decision, prompt: null, reply: null, guardrail: null, costUsd: 0 };

    if (decision.type === 'escalate' && !chosenArticleId && isAboutAssistant(retrieval.analysis.terms)) {
      return { ...base, outcome: { type: 'assistant', citations: [] } };
    }

    if (decision.type === 'escalate') {
      return { ...base, outcome: { type: 'escalate', citations: [] } };
    }

    if (decision.type === 'clarify') {
      const options = decision.articleIds.map((id) => this.retriever.byId.get(id));
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

    // Answer path. The decided article always comes first in the context.
    const contextIds = [decision.articleId, ...decision.contextIds.filter((id) => id !== decision.articleId)];
    const articles = contextIds.map((id) => this.retriever.byId.get(id));
    const prompt = buildPrompt(question, articles, retrieval.analysis);
    const started = now();
    const reply = await this.generator.generate({ prompt, articles, analysis: retrieval.analysis });
    const generationMs = now() - started;

    const { outcome, guardrail } = validateReply(reply, prompt.contextIds, this.retriever.byId);
    const pricedModel = MODELS[reply.model] ? reply.model : this.generator.model;
    const cost = reply.usage && pricedModel ? costUsd(pricedModel, reply.usage) : 0;

    return { ...base, prompt, reply, guardrail, outcome, costUsd: cost ?? 0, generationMs };
  }
}

/**
 * Citation guardrail. An answer must cite at least one article, and every
 * citation must be an article that was actually in the prompt. Otherwise the
 * answer is withheld and the user is offered support instead.
 */
export function validateReply(reply, contextIds, articlesById) {
  if (reply.type !== 'answer') {
    return { outcome: { type: 'escalate', citations: [], note: reply.note }, guardrail: null };
  }
  const valid = reply.citations.filter((id) => contextIds.includes(id) && articlesById.has(id));
  const invalid = reply.citations.filter((id) => !valid.includes(id));

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
