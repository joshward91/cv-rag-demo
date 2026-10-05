/**
 * Input guard. Runs on the raw question before retrieval or any model call.
 *
 * It blocks the obvious prompt-injection shapes: attempts to override the
 * assistant's instructions, change its role, extract its prompt, or smuggle in
 * the tags the prompt uses to separate articles from the question. A blocked
 * question never reaches a model, so the defence is deterministic and free.
 *
 * Pattern matching only catches the obvious cases. The other layers are what
 * make an injection that slips past harmless: the model gets no tools and no
 * web access, the system prompt treats the question as untrusted data, the
 * reply must match a JSON schema that only allows citations of the articles it
 * was given, and an answer that cites none of them, or contains a link, is
 * withheld.
 */

export const MAX_QUESTION_LENGTH = 500;

export const INPUT_RULES = [
  {
    id: 'override-instructions',
    pattern: /\b(?:ignore|disregard|forget|override|bypass|skip)\b[\w\s,'’-]{0,40}?\b(?:instructions?|rules|prompts?|guidelines|directions|directives|guardrails|restrictions|programming|context|system)\b/i,
    reason: 'asks the assistant to ignore its instructions',
  },
  {
    id: 'change-role',
    pattern: /\b(?:you are now|you're now|from now on,? you|act as (?:an?|my)\b|pretend (?:to be|you are|you're)|role-?play as|new persona|switch roles?)\b/i,
    reason: 'asks the assistant to take on a different role',
  },
  {
    id: 'reveal-prompt',
    pattern: /\b(?:system|hidden|initial|original|developer)\s+(?:prompt|instructions?|message)\b|\b(?:reveal|print|show|repeat|output|tell me)\b[\w\s]{0,20}\byour (?:prompt|instructions|rules)\b/i,
    reason: 'asks for the assistant’s instructions',
  },
  {
    id: 'jailbreak',
    pattern: /\b(?:jailbreak|jailbroken|dan mode|developer mode|do anything now|unfiltered mode|no restrictions)\b/i,
    reason: 'uses a known jailbreak phrase',
  },
  {
    id: 'prompt-tags',
    pattern: /<\s*\/?\s*(?:system|question|articles?|interpretation|instructions?)\b/i,
    reason: 'contains the tags the prompt uses to separate articles from the question',
  },
];

/**
 * @param {string} question
 * @returns {{ blocked: false } | { blocked: true, rule: string, reason: string, match?: string }}
 */
export function screenQuestion(question) {
  if (question.length > MAX_QUESTION_LENGTH) {
    return { blocked: true, rule: 'too-long', reason: `is longer than ${MAX_QUESTION_LENGTH} characters` };
  }
  for (const rule of INPUT_RULES) {
    const match = question.match(rule.pattern);
    if (match) return { blocked: true, rule: rule.id, reason: rule.reason, match: match[0] };
  }
  return { blocked: false };
}

/** Links in an answer can only have come from outside the help centre, which contains none. */
export const LINK_PATTERN = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
