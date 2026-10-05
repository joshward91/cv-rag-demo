import { STOPWORDS, normalise, stem, editDistance } from './text.js';
import { PHRASE_RULES, CONCEPT_OF, PROTECTED_TERMS } from './lexicon.js';

/**
 * Filler words that carry no task meaning. Kept separate from STOPWORDS so the
 * list can grow from eval failures without touching the core stopword set.
 * Unknown words that are *not* filler count against retrieval confidence,
 * which is how "import" or "password" lead to an escalation.
 */
const FILLER = new Set(
  `quickly quick easily easy actually really basically currently already still again now today later soon
   thanks thank cheers hi hello hey ok okay sorry guys mate there's here's best right correct properly simply
   one ones some many much more most other another same different thing things stuff bit little lot via using use
   inside within across over under up down out off about after before while only exactly sure maybe possible
   possibly anyway somehow someone somebody person's whole entire kind sort type certain particular specific
   go going went gone got getting see seen look looking said say says does doing done put setting
   record records entry entries item items harbour crm system no longer anymore`
    .split(/\s+/)
    .filter(Boolean),
);

function isNoise(word) {
  return word.length < 2 || STOPWORDS.has(word) || FILLER.has(word);
}

/**
 * Turn raw text into canonical terms.
 *
 * Returns the terms plus a trace of every transformation, which the
 * "show retrieval" panel renders so a reviewer can see why a query matched.
 *
 * `perspective` says who wrote the text: 'query' for a user's question,
 * 'document' for anything in a help article, which the vendor wrote. See the
 * lexicon for why "client" differs.
 *
 * @param {string} text
 * @param {{ vocabulary?: Set<string>, spellCheck?: boolean, perspective?: 'query' | 'document' }} [options]
 */
export function analyse(text, { vocabulary = null, spellCheck = false, perspective = 'query' } = {}) {
  const trace = [];
  let working = ` ${normalise(text)} `;

  for (const rule of PHRASE_RULES) {
    if (rule.side && rule.side !== perspective) continue;
    working = working.replace(rule.pattern, (match) => {
      trace.push({ kind: 'phrase', rule: rule.id, from: match.trim(), to: rule.replace.trim(), note: rule.note });
      return rule.replace;
    });
  }
  const rewrittenText = working.replace(/\s+/g, ' ').trim();

  const terms = [];
  for (const word of rewrittenText.split(' ')) {
    if (!word || isNoise(word)) continue;
    if (PROTECTED_TERMS.has(word)) {
      terms.push(word);
      continue;
    }
    let stemmed = stem(word);

    if (spellCheck && vocabulary && !vocabulary.has(stemmed) && !CONCEPT_OF.has(stemmed) && word.length >= 5) {
      const corrected = closestTerm(stemmed, vocabulary);
      if (corrected) {
        trace.push({ kind: 'spelling', rule: 'spelling:edit-distance', from: word, to: corrected.term, note: `${corrected.distance} edit${corrected.distance === 1 ? '' : 's'} away` });
        stemmed = corrected.term;
      }
    }

    const concept = CONCEPT_OF.get(stemmed);
    if (concept && concept !== stemmed) {
      trace.push({ kind: 'synonym', rule: `concept:${concept}`, from: word, to: concept });
      terms.push(concept);
    } else {
      terms.push(concept ?? stemmed);
    }
  }

  return { normalised: normalise(text), rewrittenText, terms, trace };
}

/**
 * Allowed typos: one edit, or two for words of nine letters or more. Seven or
 * eight letters with two edits turned real words into wrong ones
 * ("connect" -> "contact"). Words under five letters are never corrected: too
 * many real words sit one edit from the vocabulary ("mode" -> "move",
 * "dead" -> "lead").
 */
function closestTerm(word, vocabulary) {
  const allowed = word.length >= 9 ? 2 : 1;
  let best = null;
  for (const candidate of vocabulary) {
    if (Math.abs(candidate.length - word.length) > allowed) continue;
    const distance = editDistance(word, candidate);
    if (distance <= allowed && (!best || distance < best.distance)) best = { term: candidate, distance };
  }
  return best;
}
