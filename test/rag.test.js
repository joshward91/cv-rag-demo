import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articles } from '../src/kb/articles.js';
import { analyse } from '../src/rag/analyze.js';
import { stem, editDistance } from '../src/rag/text.js';
import { Retriever } from '../src/rag/retriever.js';
import { HelpDesk, validateReply } from '../src/rag/pipeline.js';
import { ExtractiveGenerator, AnthropicGenerator, parseReply } from '../src/rag/generators.js';

const retriever = new Retriever(articles);
const byId = retriever.byId;

test('stemming makes plural and verb forms collide', () => {
  assert.equal(stem('contacts'), stem('contact'));
  assert.equal(stem('updating'), stem('update'));
  assert.equal(stem('companies'), 'company');
});

test('edit distance counts a transposition as one edit', () => {
  assert.equal(editDistance('contcat', 'contact'), 1);
  assert.equal(editDistance('connect', 'contact'), 2);
});

test("a client's phone number is rewritten to a contact's phone", () => {
  const { terms, trace } = analyse("How do I update a client's phone number?");
  assert.deepEqual(terms, ['edit', 'contact', 'phone']);
  assert.ok(trace.some((t) => t.rule === 'domain:client-means-contact'));
});

test('"client contact number" is protected as the account setting', () => {
  const { terms } = analyse('change our client contact number');
  assert.ok(terms.includes('clientcontactnumber'));
  assert.ok(!terms.includes('contact'));
  assert.ok(!terms.includes('phone'));
});

test('"client" means the account in articles and a contact in questions', () => {
  assert.deepEqual(analyse('Update your client profile', { perspective: 'document' }).terms, ['edit', 'account', 'profil']);
  assert.ok(articles.find((a) => a.id === 'account-client-contact-number').body.includes('**Client profile**'));
  assert.ok(analyse('update a client', { perspective: 'query' }).terms.includes('contact'));
  assert.ok(analyse('update our client profile', { perspective: 'query' }).terms.includes('account'));
  assert.ok(analyse('Change your client phone number', { perspective: 'document' }).terms.includes('clientcontactnumber'));
  assert.ok(!analyse('change a client phone number', { perspective: 'query' }).terms.includes('clientcontactnumber'));
});

test('the prompt tells the model which "client" the user meant', async () => {
  const desk = new HelpDesk({ retriever, generator: new ExtractiveGenerator() });
  const contact = await desk.ask("How do I update a client's phone number?");
  assert.match(contact.prompt.user, /<interpretation>[\s\S]*"client" means a contact/);
  const own = await desk.ask('How do I change our client contact number?');
  assert.match(own.prompt.user, /the user's own client contact number/);
  assert.match(contact.prompt.system, /in them "client" always means the user's own business/);
});

test('core example retrieves the contact phone article and keeps the account one out of the prompt', () => {
  const result = retriever.retrieve("How do I update a client's phone number?");
  assert.equal(result.decision.type, 'answer');
  assert.equal(result.decision.articleId, 'contact-edit-phone');
  assert.ok(!result.decision.contextIds.includes('account-client-contact-number'));
});

test('an unsupported task escalates instead of answering with a near miss', () => {
  const result = retriever.retrieve('Can I import contacts from a spreadsheet?');
  assert.equal(result.decision.type, 'escalate');
  assert.equal(result.results[0].id, 'contact-export');
});

test('two equally likely articles trigger a clarifying question', () => {
  const result = retriever.retrieve('How do I change the phone number?');
  assert.equal(result.decision.type, 'clarify');
  assert.ok(result.decision.articleIds.includes('contact-edit-phone'));
  assert.ok(result.decision.articleIds.includes('company-edit-details'));
});

test('naming the object removes the ambiguity', () => {
  const result = retriever.retrieve("change a customer's email");
  assert.equal(result.decision.type, 'answer');
  assert.equal(result.decision.articleId, 'contact-edit-email');
});

test('choosing a clarification option answers from that article', async () => {
  const desk = new HelpDesk({ retriever, generator: new ExtractiveGenerator() });
  const result = await desk.ask('How do I change the phone number?', { chosenArticleId: 'company-edit-details' });
  assert.equal(result.outcome.type, 'answer');
  assert.deepEqual(result.outcome.citations, ['company-edit-details']);
});

test('guardrail withholds an answer that cites an article it was not given', () => {
  const reply = { type: 'answer', answer: 'Do this.', citations: ['deal-delete'] };
  const { outcome, guardrail } = validateReply(reply, ['contact-edit-phone'], byId);
  assert.equal(outcome.type, 'escalate');
  assert.equal(guardrail.action, 'withheld');
});

test('guardrail withholds an uncited answer', () => {
  const { outcome } = validateReply({ type: 'answer', answer: 'Trust me.', citations: [] }, ['contact-edit-phone'], byId);
  assert.equal(outcome.type, 'escalate');
});

test('guardrail drops an invented citation but keeps a valid one', () => {
  const reply = { type: 'answer', answer: 'Steps.', citations: ['contact-edit-phone', 'made-up-article'] };
  const { outcome, guardrail } = validateReply(reply, ['contact-edit-phone'], byId);
  assert.deepEqual(outcome.citations, ['contact-edit-phone']);
  assert.equal(guardrail.action, 'dropped');
});

test('malformed model output is treated as an escalation', () => {
  assert.equal(parseReply('not json').type, 'escalate');
});

test('Claude API generator sends a schema-constrained request and reports usage', async () => {
  let sent;
  const fakeClient = {
    beta: {
      messages: {
        create: async (request) => {
          sent = request;
          return {
            model: 'claude-opus-5-5',
            stop_reason: 'end_turn',
            usage: { input_tokens: 812, output_tokens: 143 },
            content: [{ type: 'text', text: JSON.stringify({ type: 'answer', answer: '1. Open the contact.', citations: ['contact-edit-phone'] }) }],
          };
        },
      },
    },
  };
  const desk = new HelpDesk({ retriever, generator: new AnthropicGenerator({ client: fakeClient, model: 'claude-opus-5-5' }) });
  const result = await desk.ask("How do I update a client's phone number?");

  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.output_config.effort, 'low');
  assert.deepEqual(sent.output_config.format.schema.properties.citations.items.enum, result.prompt.contextIds);
  assert.equal(result.outcome.type, 'answer');
  assert.deepEqual(result.outcome.citations, ['contact-edit-phone']);
  assert.equal(result.costUsd, (812 * 4 + 143 * 20) / 1_000_000);
});

test('a refusal from the model becomes an escalation', async () => {
  const fakeClient = {
    beta: { messages: { create: async () => ({ model: 'claude-opus-5-5', stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 }, content: [] }) } },
  };
  const desk = new HelpDesk({ retriever, generator: new AnthropicGenerator({ client: fakeClient, model: 'claude-opus-5-5' }) });
  const result = await desk.ask("How do I update a client's phone number?");
  assert.equal(result.outcome.type, 'escalate');
});

test('every "not to be confused with" link points at a real article', () => {
  for (const a of articles) for (const id of a.notConfusedWith) assert.ok(byId.has(id), `${a.id} -> ${id}`);
});
