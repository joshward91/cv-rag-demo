import { seed } from './seed.js';

/**
 * In-memory data store. State is cloned from the seed on construction, so a
 * page reload always starts from the same sample data and nothing persists.
 */
export class Store {
  constructor(initial = seed) {
    this.state = structuredClone(initial);
    this.sequence = 100;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  // Contacts --------------------------------------------------------------
  contact(id) {
    return this.state.contacts.find((c) => c.id === id) ?? null;
  }

  saveContact(input) {
    return this.#upsert('contacts', 'ct', input);
  }

  deleteContact(id) {
    this.state.contacts = this.state.contacts.filter((c) => c.id !== id);
    this.state.notes = this.state.notes.filter((n) => n.contactId !== id);
    for (const deal of this.state.deals) if (deal.contactId === id) deal.contactId = null;
  }

  notesFor(contactId) {
    return this.state.notes
      .filter((n) => n.contactId === contactId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  addNote(contactId, text) {
    const note = { id: this.nextId('nt'), contactId, createdAt: new Date().toISOString(), text };
    this.state.notes.push(note);
    return note;
  }

  // Companies -------------------------------------------------------------
  company(id) {
    return this.state.companies.find((c) => c.id === id) ?? null;
  }

  saveCompany(input) {
    return this.#upsert('companies', 'co', input);
  }

  deleteCompany(id) {
    this.state.companies = this.state.companies.filter((c) => c.id !== id);
    for (const contact of this.state.contacts) if (contact.companyId === id) contact.companyId = null;
    for (const deal of this.state.deals) if (deal.companyId === id) deal.companyId = null;
  }

  // Deals -----------------------------------------------------------------
  deal(id) {
    return this.state.deals.find((d) => d.id === id) ?? null;
  }

  saveDeal(input) {
    return this.#upsert('deals', 'dl', input);
  }

  deleteDeal(id) {
    this.state.deals = this.state.deals.filter((d) => d.id !== id);
  }

  setStage(id, stage) {
    const deal = this.deal(id);
    deal.stage = stage;
  }

  markWon(id, today) {
    Object.assign(this.deal(id), { stage: 'won', closeDate: today, lostReason: null });
  }

  markLost(id, reason, today) {
    Object.assign(this.deal(id), { stage: 'lost', closeDate: today, lostReason: reason });
  }

  reopen(id) {
    Object.assign(this.deal(id), { stage: 'negotiation', closeDate: null, lostReason: null });
  }

  // Custom fields ---------------------------------------------------------
  fieldsFor(appliesTo) {
    return this.state.customFields.filter((f) => f.appliesTo === appliesTo);
  }

  customField(id) {
    return this.state.customFields.find((f) => f.id === id) ?? null;
  }

  saveCustomField(input) {
    if (input.id) {
      // Type and "Applies to" are fixed once a field exists.
      const field = this.customField(input.id);
      field.label = input.label;
      field.options = input.options;
      return field;
    }
    return this.#upsert('customFields', 'cf', input);
  }

  deleteCustomField(id) {
    const field = this.customField(id);
    this.state.customFields = this.state.customFields.filter((f) => f.id !== id);
    for (const record of this.state[field.appliesTo]) delete record.custom[id];
  }

  // Account ---------------------------------------------------------------
  saveAccount(input) {
    Object.assign(this.state.account, input);
  }

  #upsert(collection, prefix, input) {
    const list = this.state[collection];
    if (input.id) {
      const existing = list.find((r) => r.id === input.id);
      Object.assign(existing, input);
      return existing;
    }
    const record = { ...input, id: this.nextId(prefix) };
    list.push(record);
    return record;
  }
}
