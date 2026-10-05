import { html, raw, markdown, mount, $ } from './dom.js';
import { articleView } from './app.js';
import { HelpDesk } from '../rag/pipeline.js';
import { ExtractiveGenerator, AnthropicGenerator, ClaudeAiGenerator } from '../rag/generators.js';
import { promptAsText } from '../rag/prompt.js';
import { MODELS, DEFAULT_MODEL, formatUsd } from '../rag/pricing.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

const SUGGESTIONS = [
  "How do I update a client's phone number?",
  'How do I change the phone number?',
  'Can I import contacts from a spreadsheet?',
  'mark a deal as lost',
];

const SUPPORT_EMAIL = 'support@harbourcrm.example';

/**
 * The embedded help assistant: launcher, conversation, citation drawer and the
 * per-answer "show retrieval" panel.
 */
export class ChatWidget {
  constructor({ root, app, retriever, sample }) {
    this.root = root;
    this.app = app;
    this.retriever = retriever;
    this.sample = sample; // claude.ai runtime, or null
    this.inArtifact = typeof window !== 'undefined' && Boolean(window.claude);
    this.messages = [];
    this.open = false;
    this.mode = 'extractive';
    this.apiKey = '';
    this.model = DEFAULT_MODEL;
    this.drawerArticle = null;
    this.settingsOpen = false;
    this.busy = false;
    this.openPanels = new Set();

    root.addEventListener('click', (e) => this.#onClick(e));
    // Remember which "show retrieval" panels are open across re-renders.
    root.addEventListener(
      'toggle',
      (e) => {
        const index = e.target.dataset?.panelFor;
        if (index === undefined) return;
        if (e.target.open) this.openPanels.add(index);
        else this.openPanels.delete(index);
      },
      true,
    );
    root.addEventListener('submit', (e) => this.#onSubmit(e));
    root.addEventListener('change', (e) => this.#onChange(e));
  }

  setSample(sample) {
    this.sample = sample;
    this.render();
  }

  modes() {
    return [
      { id: 'extractive', label: 'Offline', detail: 'Answers with the cited article’s own steps. Deterministic, free, no API key.', available: true },
      { id: 'claude-ai', label: 'Claude (claude.ai)', detail: 'Claude writes the answer through your claude.ai session. Uses your Claude usage.', available: Boolean(this.sample) },
      { id: 'api', label: 'Claude API', detail: 'Claude writes the answer using your own API key. The key stays in this tab’s memory.', available: !this.inArtifact },
    ].filter((m) => m.available);
  }

  render() {
    mount(
      this.root,
      html`
        <button type="button" class="chat-launcher" data-chat="toggle" aria-expanded="${this.open}" aria-controls="chat-panel">
          ${raw(CHAT_ICON)}<span>${this.open ? 'Close help' : 'Ask Harbour Help'}</span>
        </button>
        <section id="chat-panel" class="chat-panel" ${this.open ? '' : raw('hidden')} aria-label="Harbour Help assistant">
          <header class="chat-head">
            <div>
              <h2>Harbour Help</h2>
              <p class="chat-sub">Answers only from the help centre, with sources.</p>
            </div>
            <button type="button" class="icon-btn" data-chat="settings" aria-expanded="${this.settingsOpen}" title="Answer mode">${raw(GEAR_ICON)}<span class="visually-hidden">Answer mode</span></button>
          </header>
          ${this.settingsOpen ? this.#settings() : ''}
          <div class="chat-log" id="chat-log" aria-live="polite">
            ${this.messages.length ? this.messages.map((m, i) => this.#message(m, i)) : this.#welcome()}
          </div>
          <form class="chat-input" data-chat-form>
            <label class="visually-hidden" for="chat-question">Ask a question</label>
            <input id="chat-question" name="q" autocomplete="off" placeholder="Ask how to do something in Harbour CRM" ${this.busy ? raw('disabled') : ''} />
            <button type="submit" class="btn primary" ${this.busy ? raw('disabled') : ''}>Ask</button>
          </form>
          <p class="chat-mode-line">Mode: ${this.modes().find((m) => m.id === this.mode)?.label}${this.mode === 'api' ? ` · ${MODELS[this.model].label}` : ''} · <button type="button" class="link-button" data-chat="settings">Change</button></p>
          ${this.drawerArticle ? this.#drawer() : ''}
        </section>
      `,
    );
    const log = $('#chat-log', this.root);
    if (log) log.scrollTop = log.scrollHeight;
  }

  #welcome() {
    return html`<div class="chat-welcome">
      <p>Ask how to do something in Harbour CRM. Every answer cites the help article it came from, and <strong>Show retrieval</strong> reveals how it was found.</p>
      <p class="suggest-label">Try one of these:</p>
      <div class="suggestions">${SUGGESTIONS.map((s) => html`<button type="button" class="suggestion" data-ask="${s}">${s}</button>`)}</div>
    </div>`;
  }

  #settings() {
    return html`<div class="chat-settings">
      <fieldset>
        <legend>Answer mode</legend>
        ${this.modes().map(
          (m) => html`<label class="mode-option">
            <input type="radio" name="mode" value="${m.id}" ${this.mode === m.id ? raw('checked') : ''} />
            <span><strong>${m.label}</strong><span class="hint">${m.detail}</span></span>
          </label>`,
        )}
      </fieldset>
      ${this.mode === 'api'
        ? html`<div class="field"><label for="api-key">Anthropic API key</label><input id="api-key" type="password" autocomplete="off" value="${this.apiKey}" placeholder="sk-ant-..." /></div>
          <div class="field"><label for="api-model">Model</label><select id="api-model">${Object.entries(MODELS).map(([id, m]) => html`<option value="${id}" ${id === this.model ? raw('selected') : ''}>${m.label} ($${m.input} / $${m.output} per MTok)</option>`)}</select></div>`
        : ''}
      ${this.inArtifact && !this.sample ? html`<p class="hint">Claude modes need the demo to be opened from claude.ai, or run locally with an API key.</p>` : ''}
      <button type="button" class="btn small" data-chat="settings">Done</button>
    </div>`;
  }

  #message(m, index) {
    if (m.role === 'user') return html`<div class="msg user"><p>${m.text}</p></div>`;
    if (m.pending) return html`<div class="msg bot pending"><p>${m.pending}</p></div>`;
    if (m.error) return html`<div class="msg bot error"><p>${m.error}</p>${m.result ? this.#retrievalPanel(m.result, index) : ''}</div>`;

    const { outcome } = m.result;
    let body;
    if (outcome.type === 'answer') {
      body = html`<div class="answer">${markdown(outcome.text)}</div>
        <div class="sources"><span class="sources-label">Source${outcome.citations.length > 1 ? 's' : ''}</span>
          ${outcome.citations.map((id, i) => html`<button type="button" class="citation" data-open-article="${id}"><span class="cite-num">${i + 1}</span>${this.retriever.byId.get(id).title}</button>`)}
        </div>`;
    } else if (outcome.type === 'clarify') {
      body = html`<p>${outcome.question}</p>
        <div class="options">${outcome.options.map((o) => html`<button type="button" class="option" data-choose="${o.id}" data-for="${index}">${o.title}</button>`)}</div>`;
    } else if (outcome.type === 'assistant') {
      body = html`<p>I answer questions about Harbour CRM using its help centre, so I can’t change my own settings from a message. You can change how I write answers in <strong>Answer mode</strong>:</p>
        <ul><li><strong>Offline</strong> answers with the help article’s own steps. It’s free and needs no key.</li><li><strong>Claude</strong> writes the answer with a model, from the same articles.</li></ul>
        <button type="button" class="btn small" data-chat="settings">Open answer mode</button>`;
    } else {
      body = html`<p>I couldn’t find a help article that answers this, so I won’t guess.${m.result.guardrail?.action === 'withheld' ? ' I drafted an answer but couldn’t match it to a source, so I held it back.' : ''}</p>
        <button type="button" class="btn small" data-support="${index}">Contact support</button>`;
    }
    return html`<div class="msg bot">${body}${this.#retrievalPanel(m.result, index)}</div>`;
  }

  #retrievalPanel(result, index) {
    const { retrieval, decision, prompt, reply, guardrail } = result;
    const { analysis } = retrieval;
    const contextIds = prompt?.contextIds ?? [];
    const statusOf = (id) => {
      if (decision.type === 'answer' && id === decision.articleId) return ['answer', 'Answer'];
      if (decision.type === 'clarify' && decision.articleIds.includes(id)) return ['clarify', 'Offered'];
      if (contextIds.includes(id)) return ['context', 'In prompt'];
      if (decision.excludedLookAlikes?.includes(id)) return ['excluded', 'Look-alike, kept out'];
      return ['below', ''];
    };

    let promptBlock;
    if (prompt && reply?.model === null) {
      promptBlock = html`<p class="panel-note">Not sent: offline mode answers with the article text. This is the prompt the Claude modes send for this question.</p><pre>${promptAsText(prompt)}</pre>`;
    } else if (prompt) {
      promptBlock = html`<p class="panel-note">Sent to ${reply?.model ?? 'Claude'}.</p><pre>${promptAsText(prompt)}</pre>`;
    } else {
      promptBlock = html`<p class="panel-note">No model call. The retrieval policy decided to ${decision.type === 'clarify' ? 'ask a clarifying question' : 'escalate'} before generation, which costs nothing.</p>`;
    }

    return html`<details class="retrieval" data-panel-for="${index}" ${this.openPanels.has(String(index)) ? raw('open') : ''}>
      <summary>Show retrieval</summary>
      <div class="retrieval-body">
        <h3>Rewritten query</h3>
        <p class="terms">${analysis.terms.length ? analysis.terms.map((t) => html`<code class="${analysis.unknownTerms.includes(t) ? 'unknown' : ''}">${t}</code>`) : html`<span class="muted">No searchable terms</span>`}</p>
        ${analysis.unknownTerms.length ? html`<p class="panel-note">Highlighted terms don’t appear anywhere in the help centre.</p>` : ''}
        ${analysis.trace.length
          ? html`<ul class="trace">${analysis.trace.map((t) => html`<li><code>${t.from}</code> → <code>${t.to}</code> <span class="muted">${t.note ?? t.rule}</span></li>`)}</ul>`
          : ''}

        <h3>Decision: ${decision.type}</h3>
        <p class="panel-note">${decision.reason}</p>

        <h3>Articles retrieved</h3>
        <div class="table-wrap"><table class="scores">
          <thead><tr><th>#</th><th>Article</th><th class="num">BM25</th><th class="num">Coverage</th><th>Use</th></tr></thead>
          <tbody>${retrieval.results.map((r, i) => {
            const [cls, label] = statusOf(r.id);
            return html`<tr class="${cls}"><td class="num">${i + 1}</td><td><button type="button" class="link-button" data-open-article="${r.id}">${r.id}</button><span class="matched">${r.matched.join(' ')}</span></td><td class="num">${r.score.toFixed(2)}</td><td class="num">${Math.round(r.coverage * 100)}%</td><td>${label}</td></tr>`;
          })}</tbody>
        </table></div>
        ${retrieval.results.length ? '' : html`<p class="muted">No article matched.</p>`}

        <h3>Prompt</h3>
        ${promptBlock}

        <h3>Cost and timing</h3>
        <p class="panel-note">Retrieval ${retrieval.elapsedMs.toFixed(1)} ms${result.generationMs !== undefined ? ` · generation ${Math.round(result.generationMs)} ms` : ''} · ${costLine(result)}</p>
        ${guardrail ? html`<p class="guardrail">Citation guardrail: ${guardrail.reason}</p>` : ''}
      </div>
    </details>`;
  }

  #drawer() {
    const a = this.retriever.byId.get(this.drawerArticle);
    return html`<div class="drawer" role="dialog" aria-label="Help article">
      <button type="button" class="btn small ghost drawer-back" data-chat="close-drawer">← Back to chat</button>
      ${articleView(a, this.retriever.byId, { linkTarget: 'drawer' })}
    </div>`;
  }

  async ask(question, { chosenArticleId } = {}) {
    if (this.busy) return;
    const generator = await this.#generator();
    if (!generator) return;
    this.busy = true;
    if (!chosenArticleId) this.messages.push({ role: 'user', text: question });
    const pending = { role: 'bot', pending: this.mode === 'extractive' ? 'Searching the help centre…' : 'Searching the help centre and asking Claude…' };
    this.messages.push(pending);
    this.render();

    const desk = new HelpDesk({ retriever: this.retriever, generator });
    let message;
    try {
      const result = await desk.ask(question, { chosenArticleId });
      message = { role: 'bot', result };
    } catch (error) {
      // Show what retrieval found even when generation fails.
      const result = await new HelpDesk({ retriever: this.retriever, generator: new ExtractiveGenerator() }).ask(question, { chosenArticleId });
      message = { role: 'bot', result, error: `Claude couldn’t answer (${describeError(error)}). Switch to Offline mode in the settings to keep going.` };
    }
    this.messages.splice(this.messages.indexOf(pending), 1, message);
    this.busy = false;
    this.render();
    $('#chat-question', this.root)?.focus();
  }

  async #generator() {
    if (this.mode === 'extractive') return new ExtractiveGenerator();
    if (this.mode === 'claude-ai') return new ClaudeAiGenerator({ sample: this.sample });
    if (!this.apiKey.startsWith('sk-')) {
      this.settingsOpen = true;
      this.render();
      $('#api-key', this.root)?.focus();
      return null;
    }
    const { default: Anthropic } = await import(/* @vite-ignore */ SDK_URL);
    const client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
    return new AnthropicGenerator({ client, model: this.model });
  }

  #onClick(e) {
    const el = e.target.closest('button, a');
    if (!el) return;
    if (el.dataset.chat === 'toggle') {
      this.open = !this.open;
      this.render();
      if (this.open) $('#chat-question', this.root)?.focus();
    } else if (el.dataset.chat === 'settings') {
      this.settingsOpen = !this.settingsOpen;
      this.render();
    } else if (el.dataset.chat === 'close-drawer') {
      this.drawerArticle = null;
      this.render();
    } else if (el.dataset.openArticle) {
      this.drawerArticle = el.dataset.openArticle;
      this.render();
      $('.drawer', this.root)?.focus();
    } else if (el.dataset.ask) {
      this.ask(el.dataset.ask);
    } else if (el.dataset.choose) {
      const source = this.messages[Number(el.dataset.for)];
      const title = this.retriever.byId.get(el.dataset.choose).title;
      this.messages.push({ role: 'user', text: title });
      this.ask(source.result.question, { chosenArticleId: el.dataset.choose });
    } else if (el.dataset.support !== undefined) {
      this.#supportDialog(this.messages[Number(el.dataset.support)].result.question);
    } else if (el.matches('a[data-link]')) {
      e.preventDefault();
      if (el.hasAttribute('data-close-drawer')) this.drawerArticle = null;
      this.render();
      this.app.navigate(el.getAttribute('href'));
    }
  }

  #onSubmit(e) {
    if (!e.target.matches('[data-chat-form]')) return;
    e.preventDefault();
    const input = $('#chat-question', this.root);
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    this.ask(q);
  }

  #onChange(e) {
    if (e.target.name === 'mode') {
      this.mode = e.target.value;
      this.render();
    }
    if (e.target.id === 'api-key') this.apiKey = e.target.value.trim();
    if (e.target.id === 'api-model') this.model = e.target.value;
  }

  #supportDialog(question) {
    const text = `Hi Harbour CRM support,\n\nI asked the help assistant: "${question}"\nIt couldn't find a help article that answers this. Could you help?\n\nClient name: ${this.app.store.state.account.businessName}\nClient contact number: ${this.app.store.state.account.clientContactNumber}`;
    this.app.openModal(
      html`<h2 id="modal-title">Contact support</h2>
        <p>Email our support team at <strong class="selectable">${SUPPORT_EMAIL}</strong> and we’ll reply within one business day. Here’s a message you can paste:</p>
        <textarea id="support-text" rows="8" readonly>${text}</textarea>
        <div class="form-actions">
          <button type="button" class="btn primary" id="modal-confirm">Copy message</button>
          <button type="button" class="btn ghost" data-action="close-modal">Close</button>
        </div>
        <p class="hint">This is a demo, so nothing is sent.</p>`,
      async () => {
        const area = $('#support-text');
        try {
          await navigator.clipboard.writeText(area.value);
          this.app.toast('Message copied');
        } catch {
          area.select();
          this.app.toast('Press Ctrl+C or Cmd+C to copy');
        }
      },
    );
  }
}

function costLine({ prompt, reply, costUsd }) {
  if (!prompt) return 'no model call, $0';
  const { inputTokens, outputTokens, measured } = reply.usage;
  if (measured) return `${inputTokens} input + ${outputTokens} output tokens, ${formatUsd(costUsd)}`;
  if (reply.model === null) {
    const estimate = (inputTokens * MODELS[DEFAULT_MODEL].input) / 1e6;
    return `$0 offline. Sending this prompt would use about ${inputTokens} input tokens (${formatUsd(estimate)} of input on ${MODELS[DEFAULT_MODEL].label})`;
  }
  return `about ${inputTokens} input + ${outputTokens} output tokens (estimated; the claude.ai runtime doesn’t report usage)`;
}

function describeError(error) {
  if (error?.status === 401) return 'the API key was rejected';
  if (error?.status === 429) return 'rate limited, try again shortly';
  if (error?.code === 'not_granted') return 'permission was declined';
  return error?.message ?? 'unknown error';
}

const CHAT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h6"/></svg>';
const GEAR_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>';
