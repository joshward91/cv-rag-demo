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

const OVERRIDE_VERBS = String.raw`ignore|disregard|forget|override|bypass|abandon|ignorez|ignorer|ignora|ignorar|ignoriere|vergiss|oublie|olvida`;
const OVERRIDE_TARGETS = String.raw`instructions?|instrucciones|instructions|anweisungen|consignes|istruzioni|rules|reglas|regeln|prompts?|guidelines|directions|directives|guardrails|restrictions|programming|context|system|above|everything|all that|help cent(?:re|er)|articles|previous|precedentes|anteriores`;

export const INPUT_RULES = [
  {
    id: 'override-instructions',
    pattern: new RegExp(String.raw`\b(?:${OVERRIDE_VERBS})\b[^.?!\n]{0,40}?\b(?:${OVERRIDE_TARGETS})\b`, 'i'),
    reason: 'asks the assistant to ignore its instructions',
  },
  {
    id: 'new-instructions',
    pattern: /\b(?:new|updated|real|actual|additional|revised) (?:instructions?|rules|task|system prompt)\b|(?:^|\n)\s*(?:system|assistant|developer|admin)\s*:|#{2,}\s*(?:instruction|system|response|input)|\[\/?(?:system|inst)\]|<\|/i,
    reason: 'tries to give the assistant new instructions',
  },
  {
    id: 'change-role',
    pattern: /\b(?:you are now|you're now|you are dan|from now on,? (?:you|respond|reply|answer|only|always|never)|you must now|act as (?:an?|my|if)\b|pretend (?:to be|you are|you're)|role-?play|new persona|switch roles?|let'?s play a game|you have no rules|no rules|respond only with|only respond with|answer only with)\b/i,
    reason: 'asks the assistant to take on a different role or behaviour',
  },
  {
    id: 'reveal-prompt',
    pattern: /\b(?:system|hidden|initial|original|developer)\s+(?:prompt|instructions?|message)\b|\bwhat (?:were|have) you (?:been )?(?:told|instructed|given|programmed)\b|\b(?:repeat|translate|summari[sz]e|list|print|output|show|reveal|tell me|what are|recite|dump)\b[^.?!\n]{0,25}\byour (?:full |entire |original |initial |exact )?(?:instructions|rules|prompt|configuration|guidelines|setup)\b|\b(?:words|text) above\b|\bfull prompt\b|\bprompt you (?:were|have been|'ve been) given\b|\byour configuration\b/i,
    reason: 'asks for the assistant’s instructions',
  },
  {
    id: 'jailbreak',
    pattern: /\b(?:jailbreak|jailbroken|dan mode|developer mode|debug mode|god mode|admin mode|sudo mode|do anything now|unfiltered|no restrictions|without restrictions|unrestricted)\b/i,
    reason: 'uses a known jailbreak phrase',
  },
  {
    id: 'reply-format',
    pattern: /\bcitations?\b|"(?:type|answer)"\s*:/i,
    reason: 'tries to dictate the assistant’s reply format',
  },
  {
    id: 'prompt-tags',
    pattern: /<\s*\/?\s*(?:system|question|articles?|interpretation|instructions?)\b/i,
    reason: 'contains the tags the prompt uses to separate articles from the question',
  },
  {
    id: 'encoded-text',
    pattern: /[A-Za-z0-9+/]{24,}={0,2}/,
    reason: 'contains a long encoded string',
  },
];

/**
 * Undo the cheapest obfuscations before matching: accents ("précédentes"),
 * digits standing in for letters ("ign0re"), and letters spaced out
 * ("i g n o r e").
 */
export function normaliseForScreening(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(?:\b\w[ .\-_]){3,}\w\b/g, (m) => m.replace(/[ .\-_]/g, ''))
    .replace(/[0134578@$]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' })[c]);
}

/**
 * @param {string} question
 * @returns {{ blocked: false } | { blocked: true, rule: string, reason: string, match?: string }}
 */
export function screenQuestion(question) {
  if (question.length > MAX_QUESTION_LENGTH) {
    return { blocked: true, rule: 'too-long', reason: `is longer than ${MAX_QUESTION_LENGTH} characters` };
  }
  const normalised = normaliseForScreening(question);
  for (const rule of INPUT_RULES) {
    const match = question.match(rule.pattern) ?? (rule.id === 'encoded-text' ? null : normalised.match(rule.pattern));
    if (match) return { blocked: true, rule: rule.id, reason: rule.reason, match: match[0] };
  }
  return { blocked: false };
}

/** Links in an answer can only have come from outside the help centre, which contains none. */
export const LINK_PATTERN = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
