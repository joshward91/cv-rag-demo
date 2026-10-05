/**
 * Domain lexicon for Harbour CRM.
 *
 * Two layers:
 *
 * 1. Phrase rules run on normalised text before tokenising. They protect terms
 *    of art ("client contact number") and resolve the product's vocabulary
 *    clash, which depends on who is speaking:
 *
 *      - The help centre is written by the vendor. To the vendor, the client is
 *        the business that pays for Harbour CRM, so "client" in an article
 *        title or body means the account.
 *      - Questions come from that business. To them, a client is one of *their*
 *        customers, so "client" in a question means a contact, unless it is
 *        plainly about their own account ("our client profile").
 *
 *    So a contact is the client's client. Rules marked `side: 'document'` or
 *    `side: 'query'` only run on that side; unmarked rules run on both.
 *    Everything in an article, aliases included, is the vendor's voice.
 *
 * 2. Concepts map stemmed single words to one canonical term, so "update",
 *    "change" and "modify" all become `edit`.
 *
 * Terms of art keep their head noun as a second token ("billingemail email"),
 * so a vague question such as "change the email" still reaches them. The one
 * exception is "client contact number": its head noun would be "number", which
 * means a phone number everywhere else, so it gets no second token. That keeps
 * a contact's phone number and the account's number apart.
 *
 * Every rule has an id so the retrieval panel can show which ones fired.
 */

export const PHRASE_RULES = [
  // Terms of art that must survive the client -> contact rewrite below.
  {
    id: 'term:client-contact-number',
    pattern: /\bclient contact (?:phone )?number\b/g,
    replace: ' clientcontactnumber ',
    note: '"client contact number" is the account-level setting',
  },
  {
    id: 'term:client-phone-number-doc',
    side: 'document',
    pattern: /\bclient (?:phone|telephone) number\b/g,
    replace: ' clientcontactnumber ',
    note: 'in the vendor\'s docs, the client\'s phone number is the account-level setting',
  },
  {
    id: 'term:own-phone-number',
    pattern: /\b(?:our|my) (?:own )?(?:business |account |office |main )?(?:phone|contact|telephone) (?:number|no)\b|\bour (?:own )?client (?:phone|telephone) (?:number|no)\b/g,
    replace: ' clientcontactnumber ',
    note: '"our phone number" refers to the account, not a contact',
  },
  {
    id: 'term:number-on-own-account',
    pattern: /\b(?:phone |contact |telephone )?number (?:on|for|in) (?:our|my) (?:own )?(?:client )?(?:account|profile|settings)\b/g,
    replace: ' clientcontactnumber ',
    note: 'a number on the user\'s own account or profile is the client contact number',
  },
  {
    id: 'term:account-phone-number',
    pattern: /\baccount (?:phone|contact|telephone) number\b/g,
    replace: ' clientcontactnumber ',
    note: 'the account\'s own phone number',
  },
  {
    id: 'term:number-you-call-us-on',
    pattern: /\bnumber (?:that )?(?:harbour crm |harbour |support |billing |you )?(?:use to )?(?:call|ring|contact|reach)(?:es|s)? us\b|\bnumber you have (?:on file )?for us\b/g,
    replace: ' clientcontactnumber ',
    note: 'the number support uses to reach the account',
  },
  {
    id: 'term:business-name',
    pattern: /\b(?:(?:our|my) (?:business|company|trading|account) name|our client name|business name|trading name|account name)\b/g,
    replace: ' businessname name ',
    note: 'the account\'s own business name',
  },
  {
    id: 'term:client-name-doc',
    side: 'document',
    pattern: /\bclient name\b/g,
    replace: ' businessname name ',
    note: 'in the vendor\'s docs, the client name is the account\'s business name',
  },
  {
    id: 'term:billing-email',
    pattern: /\b(?:billing email(?: address)?|(?:our|my) (?:account|accounts|billing) email(?: address)?|accounts email(?: address)?)\b/g,
    replace: ' billingemail email ',
    note: 'the account\'s billing email',
  },
  {
    id: 'term:custom-field',
    pattern: /\b(?:custom|extra|additional|bespoke|own|new|user defined) fields?\b/g,
    replace: ' customfield field ',
    note: 'custom fields',
  },

  // The core vocabulary clash. Same word, two perspectives.
  {
    id: 'domain:vendor-client-means-account',
    side: 'document',
    pattern: /\bclients?\b/g,
    replace: ' account ',
    note: 'the vendor\'s docs say "client" for the business using Harbour CRM: the account',
  },
  {
    id: 'domain:own-client-account',
    side: 'query',
    pattern: /\b(?:(?:our|my) )?client (?:account|profile|settings|portal|subscription|plan)\b|\bas a client\b/g,
    replace: ' account ',
    note: '"our client profile" is about the user\'s own account, not a contact',
  },
  {
    id: 'domain:client-means-contact',
    pattern: /\b(?:clients?|customers?)\b/g,
    replace: ' contact ',
    note: 'users say "client" or "customer" for the people they sell to; Harbour CRM calls them contacts',
  },

  // Multi-word synonyms.
  {
    id: 'phrase:definition-question',
    pattern: /\b(?:difference between|same (?:thing )?as|what (?:does|do|is|are) (?:the word |the term )?\w+ mean|meaning of|definition of|what is an?)\b/g,
    replace: ' mean ',
    note: 'a question about what a term means',
  },
  { id: 'phrase:by-mistake', pattern: /\b(?:by mistake|by accident|accidentally|wrongly|in error)\b/g, replace: ' undo ', note: 'something done by mistake needs undoing' },
  { id: 'phrase:get-rid-of', pattern: /\bget rid of\b/g, replace: ' delete ', note: '"get rid of" means delete' },
  { id: 'phrase:look-up', pattern: /\blook up\b/g, replace: ' search ', note: '"look up" means search' },
  { id: 'phrase:set-up', pattern: /\bset up\b/g, replace: ' create ', note: '"set up" means create' },
  { id: 'phrase:back-up', pattern: /\bback up\b/g, replace: ' export ', note: '"back up" means export' },
  { id: 'phrase:phone-number', pattern: /\b(?:phone|mobile|cell|telephone|contact) (?:number|no)s?\b/g, replace: ' phone ', note: 'phone number' },
  { id: 'phrase:email-address', pattern: /\bemail address(?:es)?\b/g, replace: ' email ', note: 'email address' },
  { id: 'phrase:how-much', pattern: /\bhow much\b/g, replace: ' value ', note: '"how much" refers to value' },
  { id: 'phrase:closed-won', pattern: /\bclosed? (?:as )?won\b/g, replace: ' won ', note: 'closed won' },
  { id: 'phrase:closed-lost', pattern: /\bclosed? (?:as )?lost\b/g, replace: ' lost ', note: 'closed lost' },
  { id: 'phrase:fell-through', pattern: /\bfell through\b|\bdidn t go ahead\b/g, replace: ' lost ', note: 'a deal that fell through is lost' },
];

/** Stemmed surface form -> canonical concept. */
export const CONCEPTS = {
  edit: ['edit', 'updat', 'chang', 'modify', 'modifi', 'amend', 'fix', 'correct', 'alter', 'adjust', 'replac', 'swap'],
  create: ['add', 'creat', 'new', 'make', 'mak', 'insert', 'register'],
  delete: ['delet', 'remov', 'eras', 'trash', 'destroy', 'purg'],
  search: ['search', 'find', 'locat', 'filter', 'lookup'],
  phone: ['phon', 'mobil', 'telephon', 'cell', 'landlin', 'cellphon', 'number'],
  email: ['email', 'mail', 'emailaddres'],
  company: ['company', 'organisation', 'organization', 'org', 'business', 'employer', 'firm'],
  contact: ['contact', 'person', 'peopl', 'individual'],
  deal: ['deal', 'opportunity', 'sale', 'oppty'],
  export: ['export', 'download'],
  csv: ['csv', 'spreadsheet', 'excel', 'sheet'],
  note: ['note', 'comment', 'annotat'],
  mean: ['mean', 'meaning', 'definition', 'defin', 'glossary', 'terminology', 'terminolog'],
  won: ['won', 'win', 'winn'],
  lost: ['lost', 'lose', 'los'],
  stage: ['stag', 'column', 'pipelin', 'phas'],
  value: ['valu', 'amount', 'worth', 'price', 'pric'],
  currency: ['currency', 'currenci', 'dollar', 'aud', 'usd', 'nzd', 'gbp', 'eur', 'euro', 'pound'],
  status: ['status', 'lifecycl'],
  reopen: ['reopen', 'undo', 'unclos', 'revert'],
  renam: ['renam', 'relabel'],
  drag: ['drag', 'drop'],
  reload: ['reload', 'refresh', 'reset'],
};

export const CONCEPT_OF = new Map();
for (const [concept, forms] of Object.entries(CONCEPTS)) {
  for (const form of forms) CONCEPT_OF.set(form, concept);
}

/** Concepts that name an action without saying what it applies to. */
export const ACTION_TERMS = new Set(['edit', 'create', 'delete', 'search', 'export', 'renam', 'reopen']);

/** Tokens produced by phrase rules. They are already canonical. */
export const PROTECTED_TERMS = new Set(['clientcontactnumber', 'businessname', 'billingemail', 'customfield']);
