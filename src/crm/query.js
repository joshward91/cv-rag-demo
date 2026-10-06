import { OPEN_STAGES, STAGES, STATUSES, INDUSTRIES } from './seed.js';

/**
 * Answers questions about the account's own records ("show me Priya's phone
 * number", "open deals worth more than 10k", "contacts at Kestrel") straight
 * from the store, without the help centre or a model.
 *
 * It is deliberately a small, deterministic parser rather than a model with
 * tools: record data never goes into a prompt, so a Contact's notes can't
 * carry a prompt injection, and every answer can show exactly how the
 * question was read. Anything it doesn't recognise returns null and goes to
 * the help assistant as before. How-to questions ("how do I change Priya's
 * phone number") are help questions; they only pick up an "Open" link to the
 * record they mention.
 *
 * In production this would be a read-only API call made with the signed-in
 * user's permissions, so it could never see more than they can.
 */

const HOW_TO = /\b(?:how (?:do|can|would|should|to)|where (?:do|can)|where is (?:the|my|a|an|it|this|that)\b|can (?:i|we)|can you (?!give|show|tell|find|get|pull|look|list|open)|is it possible|why)\b|^(?:please )?(?:change|update|edit|delete|remove|add|create|merge|export|import|move|mark|link|rename|reset|set|fix|correct)\b/;
const SHOW = /\b(?:show|list|give|get|find|what(?:'s| is| are)|whats|which|who|tell|display|pull up|look up|lookup|open)\b/;
// A list needs an explicit request ("show", "which", "open deals"), so "we won
// the deal!" or "get rid of a deal" stays a help question.
const LIST = /\b(?:show|list|display|pull up|give me|which|what are|how many|see all|who works)\b|\b(?:what|any) (?:\w+ )?(?:deals|contacts|companies)\b|\b(?:biggest|largest|highest|most valuable|most profitable|smallest) deals?\b|^(?:my |our |all |the )?(?:open|won|lost|closed|active|new|qualified|biggest|largest|top \w+)?\s*(?:deals|contacts|leads|customers|companies)\b|^\w+ companies\??$/;
// Reports of a problem are help questions, even when they name a record.
const PROBLEM = /\b(?:can't|cannot|can not|won't|doesn't|isn't|not showing|missing|disappeared|by mistake|wrong)\b/;
// "Priya has a new phone number" reports a change: a help question unless it also asks to see something.
const STATEMENT = /\b(?:has|have|had|got|moved|changed|new|left|joined|now)\b/;
// Fields the CRM doesn't keep. "Kestrel's ABN number" mustn't return the phone number.
const UNKNOWN_FIELD = /\b(?:abn|acn|tax|gst|vat|birthday|linkedin|fax|custom field)\b/;
// Words that look like names after "with", "at" or "for" but are filters or record types.
const NOT_NAMES = new Set([
  ...STAGES.flatMap((st) => [st.value, ...st.label.toLowerCase().split(' ')]),
  ...STATUSES.map((st) => st.value),
  ...INDUSTRIES.map((i) => i.toLowerCase().split(' ')[0]),
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow', 'q1', 'q2', 'q3', 'q4',
  'contact', 'contacts', 'company', 'companies', 'deal', 'deals', 'client', 'clients', 'customer', 'customers', 'lead', 'leads',
  'what', 'who', 'where', 'when', 'how', 'it', 'that', 'there', 'here', 'let', 'he', 'she', 'my', 'our', 'your', 'the', 'harbour', 'i',
]);
const isName = (text) => !NOT_NAMES.has(text.toLowerCase().split(/\s+/)[0]);

const FIELDS = [
  { key: 'phone', label: 'phone number', pattern: /\b(?:phone|mobile|cell|number|ring|call)\b/ },
  { key: 'email', label: 'email address', pattern: /\b(?:e-?mail)\b/ },
  { key: 'website', label: 'website', pattern: /\b(?:website|site|url|web address)\b/ },
  { key: 'address', label: 'address', pattern: /\b(?:address|located|based)\b/ },
  { key: 'jobTitle', label: 'job title', pattern: /\b(?:job title|title|role|position|job)\b/ },
  { key: 'company', label: 'Company', pattern: /\b(?:company|work(?:s)? (?:for|at)|employer|business)\b/ },
  { key: 'status', label: 'status', pattern: /\bstatus\b/ },
];

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Edit distance, for small typos in names ("Priya Ramen"). */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

const words = (text) => text.toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9&$.,\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/^[.,]+|[.,]+$/g, '') || w).filter(Boolean);
const close = (word, name) => word === name || (name.length >= 5 && distance(word, name) <= 1);

export class RecordQuery {
  /** @param {import('./store.js').Store} store */
  constructor(store, { today = () => new Date() } = {}) {
    this.store = store;
    this.today = today;
  }

  get #money() {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: this.store.state.account.currency, maximumFractionDigits: 0 });
  }

  /** Contacts and Companies named in the question, best match first. */
  mentions(question, { all = false } = {}) {
    const ws = words(question);
    const has = (name) => {
      const parts = words(name).filter((p) => p.length > 1 && !['co', 'co.', '&', 'and', 'the'].includes(p));
      const hits = parts.filter((p) => ws.some((w) => close(w, p)));
      return { all: hits.length === parts.length, any: hits.length };
    };
    const found = [];
    for (const c of this.store.state.contacts) {
      const full = has(`${c.firstName} ${c.lastName}`);
      if (full.any) found.push({ kind: 'contact', record: c, strength: full.all ? 2 : 1 });
    }
    for (const co of this.store.state.companies) {
      // A Company is named by its distinctive first word ("Kestrel") or its full name.
      const first = words(co.name)[0];
      if (has(co.name).all || ws.some((w) => close(w, first))) found.push({ kind: 'company', record: co, strength: 2 });
    }
    if (all) return found;
    const best = Math.max(0, ...found.map((f) => f.strength));
    return found.filter((f) => f.strength === best);
  }

  /**
   * @returns {null | { kind: 'record'|'list'|'clarify'|'none', text: string, items: Array<{ href: string, label: string, detail?: string }>, read: string }}
   *          null when the question isn't about the account's records.
   */
  answer(question) {
    // Phones and Macs type curly apostrophes; the guards below expect straight ones.
    const result = this.#answer(question.replace(/[’‘]/g, "'"));
    return result && { ...result, read: result.read.replace(/\.\.$/, '.') };
  }

  /**
   * The question with record names replaced by their type, for help search:
   * "how do I change Priya's phone number" searches as "how do I change
   * contact's phone number". Unknown words such as a name otherwise lower
   * keyword coverage, and the help centre can't know who Priya is.
   */
  withRecordTypes(question) {
    let text = question;
    for (const f of this.#capitalised(question)) {
      const type = f.kind === 'contact' ? 'contact' : 'company';
      const name = f.kind === 'contact' ? `${f.record.firstName} ${f.record.lastName}` : f.record.name;
      const parts = name.split(/\s+/).map((p) => p.replace(/\.$/, '')).filter((p) => p.length > 1).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = new RegExp(`\\b(?:${parts.join('|')})(?:(?:\\s*&\\s*|\\s+and\\s+|\\s+)(?:${parts.join('|')}))*\\b`);
      text = text.replace(pattern, type);
    }
    return text;
  }

  /** Open links for the records a help question names ("how do I change Priya's phone number"). */
  linksFor(question) {
    const named = new Set(this.#capitalised(question).map((f) => f.record.id));
    return this.mentions(question).filter((f) => named.has(f.record.id)).map((f) => this.#item(f.kind, f.record)).slice(0, 3);
  }

  /**
   * Records named with a capital, as names are written ("Grace", not the
   * "grace" in "grace period"), for rewriting help questions and linking.
   */
  #capitalised(question) {
    return this.mentions(question, { all: true }).filter((f) => {
      const name = f.kind === 'contact' ? `${f.record.firstName} ${f.record.lastName}` : f.record.name;
      return name.split(/\s+/).some((part) => part.length > 2 && new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(question));
    });
  }

  #answer(question) {
    const q = question.toLowerCase().trim();
    if (HOW_TO.test(q) || PROBLEM.test(q)) return null;
    // "What is a deal?" is a help question about the term, not a list.
    if (/\bwhat(?:'s| is| are) (?:an? )?(?:deals?|pipeline|opportunit(?:y|ies)|leads?|contacts?|compan(?:y|ies)|customers?|clients?)\s*\??$/.test(q)) return null;
    // Questions about the screens or the stages themselves are help, not data.
    if (/\b(?:page|screen|tab|button|stages)\b|\bstage means\b|\bgoes through\b/.test(q)) return null;
    if (UNKNOWN_FIELD.test(q)) return null;
    // Settings questions ("show deal values in euros") are help, not data.
    if (/\b(?:currency|euros?|dollars|pounds|symbol|format)\b/.test(q)) return null;
    if (/\bdeals?\b|\bpipeline\b|\bopportunit/.test(q)) return LIST.test(q) ? this.#deals(q, question) : null;
    if (/\b(?:contacts|people|leads|customers|everyone|who works)\b/.test(q) && LIST.test(q)) {
      const list = this.#contacts(q, question);
      if (list) return list;
    }
    if (/\b(?:companies|organisations|organizations|businesses)\b/.test(q) && LIST.test(q)) return this.#companies(q);
    return this.#lookup(q, question);
  }

  // One field of one record -------------------------------------------------
  #lookup(q, question) {
    const field = FIELDS.find((f) => f.pattern.test(q));
    const found = this.mentions(question);
    if (!found.length) {
      // "Bob's phone number": a possessive name that matches nobody.
      // "What's" and "Who's" are contractions, not names.
      const who = [...question.matchAll(/\b(\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?)'s\b/gu)].find((m) => !['what', 'who', 'where', 'when', 'how', 'it', 'that', 'there', 'here', 'let', 'he', 'she'].includes(m[1].toLowerCase()));
      // "my Client's phone number" is the help centre's question, not a missing record.
      if (who && !isName(who[1])) return null;
      if (field && who && SHOW.test(q)) return { kind: 'none', text: `There’s no Contact or Company called ${who[1]} in this account.`, items: [], read: `Looked up the ${field.label} of "${who[1]}": no match.` };
      return null;
    }
    if (!field && !/\b(?:show|open|pull up|find|look up|lookup|details|info|card)\b/.test(q)) return null;
    if (STATEMENT.test(q) && !SHOW.test(q)) return null;
    // A Contact and their Company both named ("Tom at Kestrel"): the Contact is the subject.
    const named = this.mentions(question, { all: true });
    const atCompany = named.filter((f) => f.kind === 'contact' && named.some((g) => g.kind === 'company' && g.record.id === f.record.companyId));
    const contacts = atCompany.length ? atCompany : found.filter((f) => f.kind === 'contact');
    const subjects = contacts.length ? contacts : found;
    if (subjects.length > 1) {
      return {
        kind: 'clarify',
        text: `More than one record matches. Which did you mean?`,
        items: subjects.map((f) => this.#item(f.kind, f.record)),
        read: `Looked up ${field ? `the ${field.label}` : 'a record'}; "${question}" matches ${subjects.length} records.`,
      };
    }
    const { kind, record } = subjects[0];
    const item = this.#item(kind, record);
    if (!field) return { kind: 'record', text: `Here’s ${item.label}.`, items: [item], read: `Opened ${kind === 'contact' ? 'the Contact' : 'the Company'} ${item.label}.` };
    const value = this.#field(kind, record, field.key);
    const name = item.label;
    const possessive = name.endsWith('s') ? `${name}’` : `${name}’s`;
    const text = value ? `${possessive} ${field.label} is ${value}.` : `${name} has no ${field.label} recorded${kind === 'company' && ['email', 'jobTitle', 'status'].includes(field.key) ? ' (Companies don’t have one)' : ''}.`;
    return { kind: 'record', text, items: [item], field: field.key, value, read: `Looked up the ${field.label} of the ${kind === 'contact' ? 'Contact' : 'Company'} ${name}.` };
  }

  #field(kind, r, key) {
    if (key === 'company') return kind === 'contact' ? this.store.company(r.companyId)?.name ?? null : r.name;
    if (key === 'status') return kind === 'contact' ? STATUSES.find((s) => s.value === r.status)?.label ?? null : null;
    if (key === 'jobTitle' && kind === 'contact') return r.jobTitle || null;
    if (key === 'address' && kind === 'contact') return null;
    return r[key] || null;
  }

  // Lists -------------------------------------------------------------------
  /** "deals with Bluegum Bakery" names a record this account doesn't have: say so rather than list everything. */
  #unknownName(question) {
    if (this.mentions(question).length) return null;
    const named = [...question.matchAll(/\b(?:with|at|from|for)\s+(\p{Lu}[\p{L}\p{N}&'’-]*(?:\s+\p{Lu}[\p{L}\p{N}&'’-]*)*)/gu)].find((m) => isName(m[1]));
    return named ? { kind: 'none', text: `I couldn’t match “${named[1]}” to a Contact or Company in this account, so I haven’t listed anything.`, items: [], read: `Looked for records linked to "${named[1]}": no match.` } : null;
  }

  #deals(q, question) {
    const unknown = this.#unknownName(question);
    if (unknown) return unknown;
    let deals = [...this.store.state.deals];
    const read = [];
    const stage = STAGES.find((s) => new RegExp(`\\b${s.value}\\b`).test(q) || q.includes(s.label.toLowerCase()));
    if (stage && OPEN_STAGES.some((st) => st.value === stage.value)) {
      deals = deals.filter((d) => d.stage === stage.value);
      read.push(`stage ${stage.label}`);
    } else if (/\b(?:open|active|live|in progress)\b/.test(q)) {
      deals = deals.filter((d) => OPEN_STAGES.some((s) => s.value === d.stage));
      read.push('open');
    } else if (/\bclosed\b/.test(q)) {
      deals = deals.filter((d) => d.stage === 'won' || d.stage === 'lost');
      read.push('won or lost');
    } else if (stage) {
      deals = deals.filter((d) => d.stage === stage.value);
      read.push(`stage ${stage.label}`);
    }
    for (const f of this.mentions(question)) {
      deals = deals.filter((d) => (f.kind === 'company' ? d.companyId === f.record.id : d.contactId === f.record.id));
      read.push(`${f.kind === 'company' ? 'Company' : 'Contact'} ${this.#item(f.kind, f.record).label}`);
    }
    const closing = q.match(/\bclos(?:e|es|ing)\s+(soon|this month|next month|this week|next week)\b/);
    if (closing) {
      const days = { soon: 30, 'this month': 31, 'next month': 62, 'this week': 7, 'next week': 14 }[closing[1]];
      const from = this.today();
      // "This month" and "next month" end on the calendar month's last day.
      const monthEnd = { 'this month': 1, 'next month': 2 }[closing[1]];
      const end = monthEnd ? new Date(from.getFullYear(), from.getMonth() + monthEnd, 0, 12) : new Date(from.getTime() + days * 864e5);
      const until = end.toISOString().slice(0, 10);
      deals = deals.filter((d) => OPEN_STAGES.some((s) => s.value === d.stage) && d.closeDate && d.closeDate >= from.toISOString().slice(0, 10) && d.closeDate <= until);
      read.push(`open, expected to close by ${until}`);
    }
    const amount = (m) => Number(m[1].replace(/,/g, '')) * ({ k: 1e3, thousand: 1e3, m: 1e6, million: 1e6 }[m[2]] ?? 1);
    const over = q.match(/\b(?:over|above|more than|greater than|bigger than|at least|exceeding)\s+\$?\s*(\d[\d,.]*)\s*(k|thousand|m|million)?\b/);
    const under = q.match(/\b(?:under|below|less than|smaller than|at most)\s+\$?\s*(\d[\d,.]*)\s*(k|thousand|m|million)?\b/);
    if (over) {
      deals = deals.filter((d) => d.value > amount(over));
      read.push(`value over ${this.#money.format(amount(over))}`);
    }
    if (under) {
      deals = deals.filter((d) => d.value < amount(under));
      read.push(`value under ${this.#money.format(amount(under))}`);
    }
    const top = q.match(/\btop\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    const largest = /\b(?:top|biggest|largest|highest|most valuable|most profitable|best|richest)\b/.test(q);
    const smallest = /\b(?:smallest|lowest|least valuable)\b/.test(q);
    let note = '';
    if (largest || smallest) {
      deals.sort((a, b) => (smallest ? a.value - b.value : b.value - a.value));
      read.push(`sorted by value, ${smallest ? 'lowest' : 'highest'} first`);
      if (/profit/.test(q)) note = ' Harbour CRM records each Deal’s value, not its profit, so these are ranked by value.';
    } else {
      deals.sort((a, b) => b.value - a.value);
    }
    // "the biggest deal", singular, is one Deal.
    const limit = top ? Number(top[1]) || NUMBER_WORDS[top[1]] : (largest || smallest) && /\bdeal\b/.test(q) ? 1 : null;
    if (limit) {
      deals = deals.slice(0, limit);
      read.push(`top ${limit}`);
    }
    const total = deals.reduce((s, d) => s + d.value, 0);
    const text = deals.length
      ? `${deals.length} Deal${deals.length === 1 ? '' : 's'}, worth ${this.#money.format(total)} in total.${note}`
      : `No Deals match.${note}`;
    return {
      kind: deals.length ? 'list' : 'none',
      text,
      items: deals.map((d) => ({ id: d.id, href: `#/deals/${d.id}`, label: d.name, detail: `${this.#money.format(d.value)} · ${STAGES.find((s) => s.value === d.stage)?.label}` })),
      read: `Deals${read.length ? `: ${read.join(', ')}` : ': all'}.`,
    };
  }

  #contacts(q, question) {
    const unknown = this.#unknownName(question);
    if (unknown) return unknown;
    let contacts = [...this.store.state.contacts];
    const read = [];
    const companies = this.mentions(question).filter((f) => f.kind === 'company');
    if (companies.length) {
      contacts = contacts.filter((c) => companies.some((f) => f.record.id === c.companyId));
      read.push(`at ${companies.map((f) => f.record.name).join(' or ')}`);
    }
    // "Which customers are inactive?": the plural is the subject, the other status the filter.
    const statuses = STATUSES.filter((s) => new RegExp(`\\b${s.value}s?\\b`).test(q));
    const status = statuses.find((s) => !new RegExp(`\\b${s.value}s\\b`).test(q)) ?? statuses[0];
    if (status) {
      contacts = contacts.filter((c) => c.status === status.value);
      read.push(`status ${status.label}`);
    }
    // "show me Priya" is a lookup, not a list.
    if (!read.length && !/\b(?:all|every|list)\b/.test(q) && !/^(?:please )?(?:show|display)(?: me)?(?: my| our| the)? contacts\??$/.test(q)) return null;
    return {
      kind: contacts.length ? 'list' : 'none',
      text: contacts.length ? `${contacts.length} Contact${contacts.length === 1 ? '' : 's'}.` : 'No Contacts match.',
      items: contacts.map((c) => ({ ...this.#item('contact', c), detail: [c.jobTitle, this.store.company(c.companyId)?.name].filter(Boolean).join(', ') })),
      read: `Contacts${read.length ? `: ${read.join(', ')}` : ': all'}.`,
    };
  }

  #companies(q) {
    let companies = [...this.store.state.companies];
    const industry = INDUSTRIES.find((i) => i !== 'Other' && q.includes(i.toLowerCase()));
    if (industry) companies = companies.filter((c) => c.industry === industry);
    return {
      kind: companies.length ? 'list' : 'none',
      text: companies.length ? `${companies.length} Compan${companies.length === 1 ? 'y' : 'ies'}.` : 'No Companies match.',
      items: companies.map((c) => ({ ...this.#item('company', c), detail: c.industry })),
      read: `Companies${industry ? `: industry ${industry}` : ': all'}.`,
    };
  }

  #item(kind, r) {
    return kind === 'contact'
      ? { id: r.id, href: `#/contacts/${r.id}`, label: `${r.firstName} ${r.lastName}` }
      : { id: r.id, href: `#/companies/${r.id}`, label: r.name };
  }
}
