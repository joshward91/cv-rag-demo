import { html, raw, markdown, mount, escapeHtml, formData, $ } from './dom.js';
import { STATUSES, OPEN_STAGES, STAGES, LOST_REASONS, INDUSTRIES, CURRENCIES, FIELD_TYPES, APPLIES_TO } from '../crm/seed.js';

/**
 * The CRM screens. Every label here is referenced by a help article, so any
 * change to copy must be mirrored in src/kb/articles.js.
 */
export class CrmApp {
  constructor({ root, store, articles, onDownload, reportUrl = '' }) {
    this.reportUrl = reportUrl;
    this.root = root;
    this.store = store;
    this.articles = articles;
    this.articleById = new Map(articles.map((a) => [a.id, a]));
    this.onDownload = onDownload;
    this.route = '#/contacts';
    this.contactFilters = { q: '', company: '', status: '' };
    this.listeners = new Set();

    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('submit', (e) => this.#onSubmit(e));
    root.addEventListener('change', (e) => this.#onChange(e));
    root.addEventListener('input', (e) => this.#onInput(e));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('.modal', this.root)) this.closeModal();
    });
    window.addEventListener('hashchange', () => {
      if (location.hash && location.hash !== this.route) this.navigate(location.hash, { fromHash: true });
    });
  }

  start() {
    const initial = location.hash && location.hash.startsWith('#/') ? location.hash : '#/contacts';
    this.navigate(initial);
  }

  /** Subscribe to route changes (used by the chat widget to stay in sync). */
  onNavigate(fn) {
    this.listeners.add(fn);
  }

  navigate(route, { fromHash = false } = {}) {
    this.route = route;
    if (!fromHash) {
      try {
        if (location.hash !== route) history.pushState(null, '', route);
      } catch {
        // Some embedded viewers block history changes; in-page routing still works.
      }
    }
    this.render();
    const main = $('#main', this.root);
    if (main) main.scrollTop = 0;
    window.scrollTo?.(0, 0);
    for (const fn of this.listeners) fn(route);
  }

  render() {
    const view = this.#view();
    mount(
      this.root,
      html`
        <a class="skip" href="#main">Skip to content</a>
        <aside class="sidebar">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true">${raw(LOGO)}</span>
            <span class="brand-name">Harbour CRM</span>
          </div>
          <nav aria-label="Main">
            ${NAV.map(
              (item) => html`<a href="${item.route}" data-link class="${this.route.startsWith(item.match) ? 'active' : ''}">${item.label}</a>`,
            )}
          </nav>
          <div class="demo-note">
            <p>Demo account. Changes reset when you reload.</p>
            ${this.reportUrl ? html`<a href="${this.reportUrl}" target="_blank" rel="noopener">Evaluation report ↗</a>` : ''}
            <a href="https://github.com/joshward91/cv-rag-demo" target="_blank" rel="noopener">Source code on GitHub ↗</a>
          </div>
        </aside>
        <div class="workspace">
          <header class="topbar">
            <span class="account-name" title="Client name">${this.store.state.account.businessName}</span>
            <span class="topbar-meta">Sample data</span>
          </header>
          <main id="main" tabindex="-1">${view}</main>
        </div>
        <div id="modal-root"></div>
        <div id="toast" role="status" aria-live="polite"></div>
      `,
    );
  }

  // ------------------------------------------------------------------ Views
  #view() {
    const parts = this.route.replace(/^#\//, '').split('/');
    const [section, a, b] = parts;
    switch (section) {
      case 'contacts':
        if (a === 'new') return this.#contactForm(null);
        if (a && b === 'edit') return this.#contactForm(this.store.contact(a));
        if (a) return this.#contactPage(this.store.contact(a));
        return this.#contactList();
      case 'companies':
        if (a === 'new') return this.#companyForm(null);
        if (a && b === 'edit') return this.#companyForm(this.store.company(a));
        if (a) return this.#companyPage(this.store.company(a));
        return this.#companyList();
      case 'deals':
        if (a === 'new') return this.#dealForm(null);
        if (a && b === 'edit') return this.#dealForm(this.store.deal(a));
        if (a) return this.#dealPage(this.store.deal(a));
        return this.#dealBoard();
      case 'settings':
        if (a === 'custom-fields' && b === 'new') return this.#fieldForm(null);
        if (a === 'custom-fields' && b) return this.#fieldForm(this.store.customField(b));
        if (a === 'custom-fields') return this.#fieldList();
        return this.#accountSettings();
      case 'help':
        if (a) return this.#articlePage(this.articleById.get(a));
        return this.#helpCentre();
      default:
        return this.#contactList();
    }
  }

  // Contacts --------------------------------------------------------------
  #filteredContacts() {
    const { q, company, status } = this.contactFilters;
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return this.store.state.contacts.filter((c) => {
      if (company && (c.companyId ?? 'none') !== company) return false;
      if (status && c.status !== status) return false;
      if (!needle) return true;
      const haystack = `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase();
      return haystack.includes(needle) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits));
    });
  }

  #contactList() {
    const { q, company, status } = this.contactFilters;
    const rows = this.#filteredContacts();
    return html`
      <div class="page-head">
        <h1>Contacts</h1>
        <div class="actions">
          <button type="button" class="btn" data-action="export-contacts">Export CSV</button>
          <a class="btn primary" href="#/contacts/new" data-link>New contact</a>
        </div>
      </div>
      <div class="filters" role="search">
        <label class="visually-hidden" for="contact-search">Search contacts</label>
        <input id="contact-search" type="search" name="q" value="${q}" placeholder="Search by name, email or phone" data-filter="q" autocomplete="off" />
        <span class="filter-group">
          <label class="inline-label" for="contact-company-filter">Company</label>
          <select id="contact-company-filter" data-filter="company">
            <option value="">All companies</option>
            <option value="none" ${company === 'none' ? 'selected' : ''}>No company</option>
            ${this.store.state.companies.map((co) => html`<option value="${co.id}" ${company === co.id ? raw('selected') : ''}>${co.name}</option>`)}
          </select>
        </span>
        <span class="filter-group">
          <label class="inline-label" for="contact-status-filter">Status</label>
          <select id="contact-status-filter" data-filter="status">
            <option value="">All statuses</option>
            ${STATUSES.map((s) => html`<option value="${s.value}" ${status === s.value ? raw('selected') : ''}>${s.label}</option>`)}
          </select>
        </span>
        <button type="button" class="btn ghost" data-action="clear-filters">Clear filters</button>
      </div>
      <div id="contact-results">${this.#contactTable(rows)}</div>
    `;
  }

  #contactTable(rows) {
    if (!rows.length) return html`<p class="empty">No contacts match these filters.</p>`;
    return html`
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map(
              (c) => html`<tr>
                <td><a href="#/contacts/${c.id}" data-link class="row-link">${c.firstName} ${c.lastName}</a></td>
                <td>${this.store.company(c.companyId)?.name ?? html`<span class="muted">No company</span>`}</td>
                <td>${c.email}</td>
                <td class="num">${c.phone}</td>
                <td>${statusChip(c.status)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p class="table-foot">${rows.length} of ${this.store.state.contacts.length} contacts</p>
    `;
  }

  #contactPage(c) {
    if (!c) return notFound('contact', '#/contacts');
    const company = this.store.company(c.companyId);
    const deals = this.store.state.deals.filter((d) => d.contactId === c.id);
    const notes = this.store.notesFor(c.id);
    return html`
      ${crumbs([['Contacts', '#/contacts']])}
      <div class="page-head">
        <h1>${c.firstName} ${c.lastName}</h1>
        <div class="actions">
          <a class="btn" href="#/contacts/${c.id}/edit" data-link>Edit</a>
          <button type="button" class="btn danger" data-action="confirm-delete" data-kind="contact" data-id="${c.id}">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h2>Details</h2>
          <dl class="facts">
            ${fact('Email', c.email)}
            ${fact('Phone', c.phone)}
            ${fact('Job title', c.jobTitle)}
            ${fact('Company', company ? html`<a href="#/companies/${company.id}" data-link>${company.name}</a>` : 'No company')}
            ${fact('Status', statusChip(c.status))}
            ${this.store.fieldsFor('contacts').map((f) => fact(f.label, c.custom[f.id]))}
          </dl>
        </section>
        <section class="panel">
          <h2>Notes</h2>
          <form data-form="note" data-id="${c.id}" class="note-form">
            <label for="note-text">Add a note</label>
            <textarea id="note-text" name="text" rows="3" required></textarea>
            <button type="submit" class="btn primary">Save note</button>
          </form>
          <ul class="notes">
            ${notes.length ? notes.map((n) => html`<li><time datetime="${n.createdAt}">${formatDate(n.createdAt)}</time><p>${n.text}</p></li>`) : html`<li class="muted">No notes yet.</li>`}
          </ul>
        </section>
        <section class="panel">
          <h2>Deals</h2>
          ${deals.length
            ? html`<ul class="link-list">${deals.map((d) => html`<li><a href="#/deals/${d.id}" data-link>${d.name}</a> <span class="muted">${stageLabel(d.stage)} · ${this.#money(d.value)}</span></li>`)}</ul>`
            : html`<p class="muted">No deals linked to this contact.</p>`}
        </section>
      </div>
    `;
  }

  #contactForm(c) {
    if (c === null && !this.route.endsWith('/new')) return notFound('contact', '#/contacts');
    const editing = Boolean(c);
    const v = c ?? { firstName: '', lastName: '', email: '', phone: '', jobTitle: '', companyId: null, status: 'lead', custom: {} };
    return html`
      ${crumbs([['Contacts', '#/contacts'], ...(editing ? [[`${v.firstName} ${v.lastName}`, `#/contacts/${v.id}`]] : [])])}
      <h1>${editing ? `Edit ${v.firstName} ${v.lastName}` : 'New contact'}</h1>
      <form class="form" data-form="contact" data-id="${v.id ?? ''}" novalidate>
        <div class="field-grid">
          ${input('First name', 'firstName', v.firstName, { required: true })}
          ${input('Last name', 'lastName', v.lastName)}
          ${input('Email', 'email', v.email, { type: 'email' })}
          ${input('Phone', 'phone', v.phone, { type: 'tel' })}
          ${input('Job title', 'jobTitle', v.jobTitle)}
          ${select('Company', 'companyId', v.companyId ?? '', [{ value: '', label: 'No company' }, ...this.store.state.companies.map((co) => ({ value: co.id, label: co.name }))])}
          ${select('Status', 'status', v.status, STATUSES)}
        </div>
        ${this.#customFieldInputs('contacts', v.custom)}
        <div class="form-actions">
          <button type="submit" class="btn primary">Save contact</button>
          <a class="btn ghost" href="${editing ? `#/contacts/${v.id}` : '#/contacts'}" data-link>Cancel</a>
        </div>
      </form>
    `;
  }

  // Companies -------------------------------------------------------------
  #companyList() {
    const companies = this.store.state.companies;
    return html`
      <div class="page-head">
        <h1>Companies</h1>
        <div class="actions"><a class="btn primary" href="#/companies/new" data-link>New company</a></div>
      </div>
      ${companies.length
        ? html`<div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Industry</th><th>Phone</th><th>Website</th><th class="num">Contacts</th></tr></thead>
            <tbody>${companies.map(
              (co) => html`<tr>
                <td><a href="#/companies/${co.id}" data-link class="row-link">${co.name}</a></td>
                <td>${co.industry}</td>
                <td class="num">${co.phone}</td>
                <td>${co.website}</td>
                <td class="num">${this.store.state.contacts.filter((c) => c.companyId === co.id).length}</td>
              </tr>`,
            )}</tbody></table></div>`
        : html`<p class="empty">No companies yet. Select <strong>New company</strong> to add one.</p>`}
    `;
  }

  #companyPage(co) {
    if (!co) return notFound('company', '#/companies');
    const contacts = this.store.state.contacts.filter((c) => c.companyId === co.id);
    const deals = this.store.state.deals.filter((d) => d.companyId === co.id);
    return html`
      ${crumbs([['Companies', '#/companies']])}
      <div class="page-head">
        <h1>${co.name}</h1>
        <div class="actions">
          <a class="btn" href="#/companies/${co.id}/edit" data-link>Edit</a>
          <button type="button" class="btn danger" data-action="confirm-delete" data-kind="company" data-id="${co.id}">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h2>Details</h2>
          <dl class="facts">
            ${fact('Industry', co.industry)}
            ${fact('Phone', co.phone)}
            ${fact('Website', co.website)}
            ${fact('Address', co.address)}
            ${this.store.fieldsFor('companies').map((f) => fact(f.label, co.custom[f.id]))}
          </dl>
        </section>
        <section class="panel">
          <h2>Contacts at this company</h2>
          ${contacts.length
            ? html`<ul class="link-list">${contacts.map((c) => html`<li><a href="#/contacts/${c.id}" data-link>${c.firstName} ${c.lastName}</a> <span class="muted">${c.jobTitle}</span></li>`)}</ul>`
            : html`<p class="muted">No contacts linked to this company.</p>`}
        </section>
        <section class="panel">
          <h2>Deals</h2>
          ${deals.length
            ? html`<ul class="link-list">${deals.map((d) => html`<li><a href="#/deals/${d.id}" data-link>${d.name}</a> <span class="muted">${stageLabel(d.stage)} · ${this.#money(d.value)}</span></li>`)}</ul>`
            : html`<p class="muted">No deals linked to this company.</p>`}
        </section>
      </div>
    `;
  }

  #companyForm(co) {
    if (co === null && !this.route.endsWith('/new')) return notFound('company', '#/companies');
    const editing = Boolean(co);
    const v = co ?? { name: '', industry: '', phone: '', website: '', address: '', custom: {} };
    return html`
      ${crumbs([['Companies', '#/companies'], ...(editing ? [[v.name, `#/companies/${v.id}`]] : [])])}
      <h1>${editing ? `Edit ${v.name}` : 'New company'}</h1>
      <form class="form" data-form="company" data-id="${v.id ?? ''}" novalidate>
        <div class="field-grid">
          ${input('Company name', 'name', v.name, { required: true })}
          ${select('Industry', 'industry', v.industry, [{ value: '', label: 'Not set' }, ...INDUSTRIES.map((i) => ({ value: i, label: i }))])}
          ${input('Phone', 'phone', v.phone, { type: 'tel' })}
          ${input('Website', 'website', v.website)}
          ${input('Address', 'address', v.address, { wide: true })}
        </div>
        ${this.#customFieldInputs('companies', v.custom)}
        <div class="form-actions">
          <button type="submit" class="btn primary">Save company</button>
          <a class="btn ghost" href="${editing ? `#/companies/${v.id}` : '#/companies'}" data-link>Cancel</a>
        </div>
      </form>
    `;
  }

  // Deals -----------------------------------------------------------------
  #dealBoard() {
    const deals = this.store.state.deals;
    return html`
      <div class="page-head">
        <h1>Deals</h1>
        <div class="actions"><a class="btn primary" href="#/deals/new" data-link>New deal</a></div>
      </div>
      <div class="board" role="list">
        ${STAGES.map((stage) => {
          const inStage = deals.filter((d) => d.stage === stage.value);
          const total = inStage.reduce((sum, d) => sum + Number(d.value || 0), 0);
          return html`<section class="column stage-${stage.value}" role="listitem" aria-label="${stage.label}">
            <header><h2>${stage.label}</h2><span class="column-total">${this.#money(total)}</span></header>
            ${inStage.length
              ? inStage.map(
                  (d) => html`<a class="deal-card" href="#/deals/${d.id}" data-link>
                    <span class="deal-name">${d.name}</span>
                    <span class="deal-meta">${this.store.company(d.companyId)?.name ?? 'No company'}</span>
                    <span class="deal-value">${this.#money(d.value)}</span>
                  </a>`,
                )
              : html`<p class="column-empty">No deals</p>`}
          </section>`;
        })}
      </div>
    `;
  }

  #dealPage(d) {
    if (!d) return notFound('deal', '#/deals');
    const company = this.store.company(d.companyId);
    const contact = this.store.contact(d.contactId);
    const closed = d.stage === 'won' || d.stage === 'lost';
    return html`
      ${crumbs([['Deals', '#/deals']])}
      <div class="page-head">
        <h1>${d.name}</h1>
        <div class="actions">
          <a class="btn" href="#/deals/${d.id}/edit" data-link>Edit</a>
          <button type="button" class="btn danger" data-action="confirm-delete" data-kind="deal" data-id="${d.id}">Delete</button>
        </div>
      </div>
      <div class="detail-grid">
        <section class="panel">
          <h2>Stage</h2>
          ${closed
            ? html`<p class="closed-state ${d.stage}">${d.stage === 'won' ? 'Won' : 'Lost'}${d.closeDate ? ` on ${formatDate(d.closeDate)}` : ''}${d.lostReason ? ` · Lost reason: ${d.lostReason}` : ''}</p>
                <button type="button" class="btn" data-action="reopen" data-id="${d.id}">Reopen deal</button>`
            : html`<label for="deal-stage">Stage</label>
                <select id="deal-stage" data-stage-for="${d.id}">
                  ${OPEN_STAGES.map((s) => html`<option value="${s.value}" ${d.stage === s.value ? raw('selected') : ''}>${s.label}</option>`)}
                </select>
                <div class="close-actions">
                  <button type="button" class="btn won" data-action="mark-won" data-id="${d.id}">Mark as won</button>
                  <button type="button" class="btn lost" data-action="mark-lost" data-id="${d.id}">Mark as lost</button>
                </div>`}
        </section>
        <section class="panel">
          <h2>Details</h2>
          <dl class="facts">
            ${fact('Value', this.#money(d.value))}
            ${fact('Company', company ? html`<a href="#/companies/${company.id}" data-link>${company.name}</a>` : 'No company')}
            ${fact('Contact', contact ? html`<a href="#/contacts/${contact.id}" data-link>${contact.firstName} ${contact.lastName}</a>` : 'No contact')}
            ${fact(closed ? 'Close date' : 'Expected close date', d.closeDate ? formatDate(d.closeDate) : '')}
            ${this.store.fieldsFor('deals').map((f) => fact(f.label, d.custom[f.id]))}
          </dl>
        </section>
      </div>
    `;
  }

  #dealForm(d) {
    if (d === null && !this.route.endsWith('/new')) return notFound('deal', '#/deals');
    const editing = Boolean(d);
    const v = d ?? { name: '', value: '', companyId: null, contactId: null, stage: 'new', closeDate: '', custom: {} };
    const closed = v.stage === 'won' || v.stage === 'lost';
    return html`
      ${crumbs([['Deals', '#/deals'], ...(editing ? [[v.name, `#/deals/${v.id}`]] : [])])}
      <h1>${editing ? `Edit ${v.name}` : 'New deal'}</h1>
      <form class="form" data-form="deal" data-id="${v.id ?? ''}" novalidate>
        <div class="field-grid">
          ${input('Deal name', 'name', v.name, { required: true })}
          ${input('Value', 'value', v.value, { required: true, inputmode: 'decimal', hint: `In ${this.store.state.account.currency}. Numbers only, without a currency symbol.` })}
          ${select('Company', 'companyId', v.companyId ?? '', [{ value: '', label: 'No company' }, ...this.store.state.companies.map((co) => ({ value: co.id, label: co.name }))])}
          ${select('Contact', 'contactId', v.contactId ?? '', [{ value: '', label: 'No contact' }, ...this.store.state.contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))])}
          ${closed
            ? html`<div class="field"><span class="label">Stage</span><p class="static">${stageLabel(v.stage)}. Use <strong>Reopen deal</strong> on the deal page to change it.</p></div>`
            : select('Stage', 'stage', v.stage, OPEN_STAGES)}
          ${input(closed ? 'Close date' : 'Expected close date', 'closeDate', v.closeDate ?? '', { type: 'date' })}
        </div>
        ${this.#customFieldInputs('deals', v.custom)}
        <div class="form-actions">
          <button type="submit" class="btn primary">Save deal</button>
          <a class="btn ghost" href="${editing ? `#/deals/${v.id}` : '#/deals'}" data-link>Cancel</a>
        </div>
      </form>
    `;
  }

  // Settings --------------------------------------------------------------
  #settingsTabs() {
    return html`<div class="tabs" role="tablist">
      <a role="tab" href="#/settings/account" data-link aria-selected="${this.route === '#/settings/account' || this.route === '#/settings'}">Client profile</a>
      <a role="tab" href="#/settings/custom-fields" data-link aria-selected="${this.route.startsWith('#/settings/custom-fields')}">Custom fields</a>
    </div>`;
  }

  #accountSettings() {
    const acc = this.store.state.account;
    return html`
      <h1>Settings</h1>
      ${this.#settingsTabs()}
      <form class="form" data-form="account" novalidate>
        <div class="field-grid">
          ${input('Client name', 'businessName', acc.businessName, { required: true, hint: 'Shown at the top of every page.' })}
          ${input('Client contact number', 'clientContactNumber', acc.clientContactNumber, {
            type: 'tel',
            required: true,
            hint: 'The number Harbour CRM support and billing use to reach you.',
          })}
          ${input('Billing email', 'billingEmail', acc.billingEmail, { type: 'email', required: true, hint: 'Where we send your subscription receipts.' })}
          ${select('Currency', 'currency', acc.currency, CURRENCIES.map((c) => ({ value: c, label: c })), { hint: 'Changes the symbol on deal values. Existing values are not converted.' })}
          ${select('Time zone', 'timeZone', acc.timeZone, ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland'].map((z) => ({ value: z, label: z })))}
        </div>
        <div class="form-actions"><button type="submit" class="btn primary">Save client profile</button></div>
      </form>
    `;
  }

  #fieldList() {
    const fields = this.store.state.customFields;
    return html`
      <div class="page-head">
        <h1>Settings</h1>
        <div class="actions"><a class="btn primary" href="#/settings/custom-fields/new" data-link>Add custom field</a></div>
      </div>
      ${this.#settingsTabs()}
      ${fields.length
        ? html`<div class="table-wrap"><table>
            <thead><tr><th>Label</th><th>Applies to</th><th>Type</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
            <tbody>${fields.map(
              (f) => html`<tr>
                <td>${f.label}</td>
                <td>${APPLIES_TO.find((x) => x.value === f.appliesTo).label}</td>
                <td>${FIELD_TYPES.find((x) => x.value === f.type).label}${f.type === 'dropdown' ? html` <span class="muted">(${f.options.length} options)</span>` : ''}</td>
                <td class="row-actions">
                  <a class="btn small" href="#/settings/custom-fields/${f.id}" data-link>Edit</a>
                  <button type="button" class="btn small danger" data-action="confirm-delete" data-kind="field" data-id="${f.id}">Delete</button>
                </td>
              </tr>`,
            )}</tbody></table></div>`
        : html`<p class="empty">No custom fields yet.</p>`}
    `;
  }

  #fieldForm(f) {
    if (f === null && !this.route.endsWith('/new')) return notFound('custom field', '#/settings/custom-fields');
    const editing = Boolean(f);
    const v = f ?? { label: '', appliesTo: 'contacts', type: 'text', options: [] };
    return html`
      <h1>${editing ? `Edit ${v.label}` : 'Add custom field'}</h1>
      ${this.#settingsTabs()}
      <form class="form" data-form="field" data-id="${v.id ?? ''}" novalidate>
        <div class="field-grid">
          ${input('Label', 'label', v.label, { required: true })}
          ${select('Applies to', 'appliesTo', v.appliesTo, APPLIES_TO, { disabled: editing })}
          ${select('Type', 'type', v.type, FIELD_TYPES, { disabled: editing, hint: editing ? "You can't change Type or Applies to after a field is created." : '' })}
          <div class="field wide" id="options-field" ${v.type === 'dropdown' ? '' : raw('hidden')}>
            <label for="f-options">Options</label>
            <textarea id="f-options" name="options" rows="4">${v.options.join('\n')}</textarea>
            <span class="hint">One option per line.</span>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn primary">Save field</button>
          <a class="btn ghost" href="#/settings/custom-fields" data-link>Cancel</a>
        </div>
      </form>
    `;
  }

  #customFieldInputs(appliesTo, values) {
    const fields = this.store.fieldsFor(appliesTo);
    if (!fields.length) return '';
    return html`<fieldset class="custom-fields">
      <legend>Custom fields</legend>
      <div class="field-grid">
        ${fields.map((f) =>
          f.type === 'dropdown'
            ? select(f.label, `custom.${f.id}`, values[f.id] ?? '', [{ value: '', label: 'Not set' }, ...f.options.map((o) => ({ value: o, label: o }))])
            : input(f.label, `custom.${f.id}`, values[f.id] ?? '', { type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text' }),
        )}
      </div>
    </fieldset>`;
  }

  // Help centre -----------------------------------------------------------
  #helpCentre() {
    const categories = [...new Set(this.articles.map((a) => a.category))];
    return html`
      <h1>Help centre</h1>
      <p class="lede">Every how-to article describes a screen in this demo, so you can check each answer the help assistant gives against the app itself.</p>
      <div class="help-grid">
        ${categories.map(
          (cat) => html`<section class="panel">
            <h2>${cat}</h2>
            <ul class="link-list">${this.articles.filter((a) => a.category === cat).map((a) => html`<li><a href="#/help/${a.id}" data-link>${a.title}</a></li>`)}</ul>
          </section>`,
        )}
      </div>
    `;
  }

  #articlePage(a) {
    if (!a) return notFound('article', '#/help');
    return html`${crumbs([['Help centre', '#/help']])}${articleView(a, this.articleById)}`;
  }

  // Events ----------------------------------------------------------------
  #onClick(e) {
    const link = e.target.closest('a[data-link]');
    if (link) {
      e.preventDefault();
      this.navigate(link.getAttribute('href'));
      return;
    }
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const { action, id, kind } = button.dataset;

    if (action === 'export-contacts') this.#exportContacts();
    if (action === 'clear-filters') {
      this.contactFilters = { q: '', company: '', status: '' };
      this.render();
    }
    if (action === 'confirm-delete') this.#confirmDelete(kind, id);
    if (action === 'mark-won') {
      this.store.markWon(id, today());
      this.render();
      this.toast('Deal marked as won');
    }
    if (action === 'mark-lost') this.#lostDialog(id);
    if (action === 'reopen') {
      this.store.reopen(id);
      this.render();
      this.toast('Deal reopened');
    }
    if (action === 'close-modal') this.closeModal();
  }

  #onInput(e) {
    const key = e.target.dataset?.filter;
    if (key === 'q') {
      this.contactFilters.q = e.target.value;
      mount($('#contact-results', this.root), this.#contactTable(this.#filteredContacts()));
    }
  }

  #onChange(e) {
    const key = e.target.dataset?.filter;
    if (key === 'company' || key === 'status') {
      this.contactFilters[key] = e.target.value;
      mount($('#contact-results', this.root), this.#contactTable(this.#filteredContacts()));
    }
    if (e.target.dataset?.stageFor) {
      this.store.setStage(e.target.dataset.stageFor, e.target.value);
      this.toast('Stage updated');
    }
    if (e.target.name === 'type' && e.target.closest('[data-form="field"]')) {
      $('#options-field', this.root).hidden = e.target.value !== 'dropdown';
    }
  }

  #onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const id = form.dataset.id || undefined;
    const data = formData(form);
    const custom = {};
    for (const [k, v] of Object.entries(data)) if (k.startsWith('custom.') && v !== '') custom[k.slice(7)] = v;

    const errors = {};
    const required = (name, message) => {
      if (!String(data[name] ?? '').trim()) errors[name] = message;
    };

    if (kind === 'contact') {
      required('firstName', 'Enter a first name');
      if (data.email && !EMAIL.test(data.email)) errors.email = 'Enter a valid email address';
      if (data.phone && !PHONE.test(data.phone)) errors.phone = 'Use digits, spaces, brackets and a leading +';
      if (showErrors(form, errors)) return;
      const saved = this.store.saveContact({
        id, firstName: data.firstName.trim(), lastName: data.lastName.trim(), email: data.email.trim(), phone: data.phone.trim(),
        jobTitle: data.jobTitle.trim(), companyId: data.companyId || null, status: data.status, custom,
      });
      this.navigate(`#/contacts/${saved.id}`);
      this.toast(id ? 'Contact saved' : 'Contact added');
    }

    if (kind === 'company') {
      required('name', 'Enter a company name');
      if (data.phone && !PHONE.test(data.phone)) errors.phone = 'Use digits, spaces, brackets and a leading +';
      if (showErrors(form, errors)) return;
      const saved = this.store.saveCompany({
        id, name: data.name.trim(), industry: data.industry, phone: data.phone.trim(), website: data.website.trim(), address: data.address.trim(), custom,
      });
      this.navigate(`#/companies/${saved.id}`);
      this.toast(id ? 'Company saved' : 'Company added');
    }

    if (kind === 'deal') {
      required('name', 'Enter a deal name');
      if (!/^\d+(\.\d{1,2})?$/.test(String(data.value ?? '').trim())) errors.value = 'Enter the value as a number, without a currency symbol';
      if (showErrors(form, errors)) return;
      const existing = id ? this.store.deal(id) : null;
      const saved = this.store.saveDeal({
        id, name: data.name.trim(), value: Number(data.value), companyId: data.companyId || null, contactId: data.contactId || null,
        stage: data.stage ?? existing?.stage ?? 'new', closeDate: data.closeDate || null, lostReason: existing?.lostReason ?? null, custom,
      });
      this.navigate(`#/deals/${saved.id}`);
      this.toast(id ? 'Deal saved' : 'Deal created');
    }

    if (kind === 'note') {
      if (!data.text.trim()) return;
      this.store.addNote(form.dataset.id, data.text.trim());
      this.render();
      this.toast('Note saved');
    }

    if (kind === 'account') {
      required('businessName', 'Enter a business name');
      if (!PHONE.test(data.clientContactNumber ?? '')) errors.clientContactNumber = 'Enter a phone number using digits, spaces, brackets and a leading +';
      if (!EMAIL.test(data.billingEmail ?? '')) errors.billingEmail = 'Enter a valid email address';
      if (showErrors(form, errors)) return;
      this.store.saveAccount({
        businessName: data.businessName.trim(), clientContactNumber: data.clientContactNumber.trim(), billingEmail: data.billingEmail.trim(),
        currency: data.currency, timeZone: data.timeZone,
      });
      this.render();
      this.toast('Client profile saved');
    }

    if (kind === 'field') {
      required('label', 'Enter a label');
      const options = String(data.options ?? '').split('\n').map((o) => o.trim()).filter(Boolean);
      const type = id ? this.store.customField(id).type : data.type;
      if (type === 'dropdown' && options.length === 0) errors.options = 'Enter at least one option';
      if (showErrors(form, errors)) return;
      this.store.saveCustomField(id ? { id, label: data.label.trim(), options } : { label: data.label.trim(), appliesTo: data.appliesTo, type, options: type === 'dropdown' ? options : [] });
      this.navigate('#/settings/custom-fields');
      this.toast('Field saved');
    }
  }

  // Dialogs ---------------------------------------------------------------
  #confirmDelete(kind, id) {
    const copy = {
      contact: ['Delete contact?', 'This deletes the contact and their notes. Linked deals are kept and show No contact. This can’t be undone.', 'Delete contact'],
      company: ['Delete company?', 'Contacts and deals linked to this company are kept and change to No company. This can’t be undone.', 'Delete company'],
      deal: ['Delete deal?', 'This can’t be undone. If the deal fell through, Mark as lost keeps it in your history.', 'Delete deal'],
      field: ['Delete field?', 'Deleting a field removes its values from every record. This can’t be undone.', 'Delete field'],
    }[kind];
    this.openModal(
      html`<h2 id="modal-title">${copy[0]}</h2><p>${copy[1]}</p>
        <div class="form-actions">
          <button type="button" class="btn danger" id="modal-confirm">${copy[2]}</button>
          <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        </div>`,
      () => {
        if (kind === 'contact') this.store.deleteContact(id);
        if (kind === 'company') this.store.deleteCompany(id);
        if (kind === 'deal') this.store.deleteDeal(id);
        if (kind === 'field') this.store.deleteCustomField(id);
        const back = { contact: '#/contacts', company: '#/companies', deal: '#/deals', field: '#/settings/custom-fields' }[kind];
        this.closeModal();
        this.navigate(back);
        this.toast(`${copy[2].replace('Delete ', '').replace(/^./, (c) => c.toUpperCase())} deleted`);
      },
    );
  }

  #lostDialog(id) {
    this.openModal(
      html`<h2 id="modal-title">Mark as lost</h2>
        <div class="field"><label for="lost-reason">Lost reason</label>
          <select id="lost-reason">${LOST_REASONS.map((r) => html`<option>${r}</option>`)}</select></div>
        <div class="form-actions">
          <button type="button" class="btn primary" id="modal-confirm">Confirm</button>
          <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        </div>`,
      () => {
        this.store.markLost(id, $('#lost-reason', this.root).value, today());
        this.closeModal();
        this.render();
        this.toast('Deal marked as lost');
      },
    );
  }

  openModal(content, onConfirm) {
    const root = $('#modal-root', this.root);
    mount(root, html`<div class="modal-backdrop" data-action="close-modal"></div><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">${content}</div>`);
    const confirm = $('#modal-confirm', root);
    confirm?.addEventListener('click', onConfirm);
    (confirm ?? $('.modal', root)).focus();
  }

  closeModal() {
    mount($('#modal-root', this.root), '');
  }

  toast(message) {
    const el = $('#toast', this.root);
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async #exportContacts() {
    const fields = this.store.fieldsFor('contacts');
    const header = ['First name', 'Last name', 'Email', 'Phone', 'Job title', 'Company', 'Status', ...fields.map((f) => f.label)];
    const rows = this.#filteredContacts().map((c) => [
      c.firstName, c.lastName, c.email, c.phone, c.jobTitle, this.store.company(c.companyId)?.name ?? '',
      STATUSES.find((s) => s.value === c.status).label, ...fields.map((f) => c.custom[f.id] ?? ''),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const ok = await this.onDownload('contacts.csv', csv);
    this.toast(ok ? `Exported ${rows.length} contacts` : 'Your browser blocked the download');
  }

  #money(value) {
    try {
      return new Intl.NumberFormat('en-AU', { style: 'currency', currency: this.store.state.account.currency, maximumFractionDigits: 0 }).format(Number(value || 0));
    } catch {
      return `${this.store.state.account.currency} ${value}`;
    }
  }
}

/** Article body plus "also called" and "not to be confused with". Shared with the chat drawer. */
export function articleView(a, articleById, { linkTarget = 'page' } = {}) {
  const lookAlikes = a.notConfusedWith.map((id) => articleById.get(id)).filter(Boolean);
  const link = (x) =>
    linkTarget === 'page'
      ? html`<a href="#/help/${x.id}" data-link>${x.title}</a>`
      : html`<button type="button" class="link-button" data-open-article="${x.id}">${x.title}</button>`;
  return html`<article class="help-article">
    <p class="eyebrow">${a.product ? `${a.product} · ` : ''}${a.category} · <code>${a.id}</code></p>
    <h1 class="article-title">${a.title}</h1>
    ${a.aliases.length ? html`<p class="aliases"><span>Also called</span> ${a.aliases.join(' · ')}</p>` : ''}
    <div class="article-body">${markdown(a.body)}</div>
    ${lookAlikes.length ? html`<div class="look-alikes"><h2>Not to be confused with</h2><ul>${lookAlikes.map((x) => html`<li>${link(x)}</li>`)}</ul></div>` : ''}
    ${a.screen && a.screen !== '#/help' ? html`<p class="open-screen"><a href="${a.screen}" data-link data-close-drawer>Open this screen</a></p>` : ''}
  </article>`;
}

// ------------------------------------------------------------------ Helpers
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()]{6,}$/;

const NAV = [
  { label: 'Contacts', route: '#/contacts', match: '#/contacts' },
  { label: 'Companies', route: '#/companies', match: '#/companies' },
  { label: 'Deals', route: '#/deals', match: '#/deals' },
  { label: 'Help centre', route: '#/help', match: '#/help' },
  { label: 'Settings', route: '#/settings/account', match: '#/settings' },
];

const LOGO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 15c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2"/><path d="M3 19c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 3-2"/><path d="M12 3v9M8 7l4-4 4 4"/></svg>';

function crumbs(items) {
  return html`<nav class="crumbs" aria-label="Breadcrumb">${items.map(([label, href]) => html`<a href="${href}" data-link>${label}</a><span aria-hidden="true">/</span>`)}</nav>`;
}

function fact(label, value) {
  return html`<div><dt>${label}</dt><dd>${value === '' || value === null || value === undefined ? html`<span class="muted">Not set</span>` : value}</dd></div>`;
}

function input(label, name, value, { type = 'text', required = false, hint = '', wide = false, inputmode = '', id = '' } = {}) {
  const fieldId = id || `f-${name.replace(/\W/g, '-')}`;
  return html`<div class="field ${wide ? 'wide' : ''}" data-field="${name}">
    <label for="${fieldId}">${label}${required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
    <input id="${fieldId}" name="${name}" type="${type}" value="${value ?? ''}" ${required ? raw('required') : ''} ${inputmode ? raw(`inputmode="${escapeHtml(inputmode)}"`) : ''} />
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
    <span class="error" aria-live="polite"></span>
  </div>`;
}

function select(label, name, value, options, { disabled = false, hint = '' } = {}) {
  const fieldId = `f-${name.replace(/\W/g, '-')}`;
  return html`<div class="field" data-field="${name}">
    <label for="${fieldId}">${label}</label>
    <select id="${fieldId}" name="${name}" ${disabled ? raw('disabled') : ''}>
      ${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${hint ? html`<span class="hint">${hint}</span>` : ''}
  </div>`;
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('.field')) {
    el.classList.remove('invalid');
    const slot = el.querySelector('.error');
    if (slot) slot.textContent = '';
  }
  for (const [name, message] of Object.entries(errors)) {
    const field = form.querySelector(`[data-field="${name}"]`) ?? form.querySelector(`[name="${name}"]`)?.closest('.field');
    if (!field) continue;
    field.classList.add('invalid');
    field.querySelector('.error').textContent = message;
  }
  const first = Object.keys(errors)[0];
  if (first) form.querySelector(`[name="${first}"]`)?.focus();
  return Boolean(first);
}

function statusChip(status) {
  const s = STATUSES.find((x) => x.value === status);
  return html`<span class="chip status-${status}">${s?.label ?? status}</span>`;
}

function stageLabel(stage) {
  return STAGES.find((s) => s.value === stage)?.label ?? stage;
}

function notFound(kind, back) {
  return html`<div class="empty"><h1>This ${kind} doesn't exist</h1><p>It may have been deleted, or the demo data was reset when the page reloaded.</p><a class="btn" href="${back}" data-link>Go back</a></div>`;
}

function formatDate(iso) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
