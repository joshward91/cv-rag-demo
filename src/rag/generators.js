import { promptAsText } from './prompt.js';
import { MODELS, estimateTokens } from './pricing.js';

/**
 * Generators turn a prompt plus retrieved articles into a reply of the shape
 *   { type: 'answer' | 'escalate', answer: string, citations: string[],
 *     usage?: { inputTokens, outputTokens, measured: boolean }, model?: string, note?: string }
 *
 * All three share that contract, so the pipeline, guardrails and eval treat
 * them the same way.
 */

const TASK_VERBS = /^(Add|Update|Change|Link|Delete|Find|Export|Edit|Create|Move|Mark|Reopen|Fill|Rename)\b/;

/**
 * Deterministic, offline generator: returns the cited article's own steps.
 * It can't hallucinate, costs nothing and needs no API key, which makes it the
 * baseline the eval runs against.
 */
export class ExtractiveGenerator {
  name = 'extractive';
  label = 'Offline (extractive)';

  async generate({ prompt, articles, analysis }) {
    const article = articles[0];
    const intro = TASK_VERBS.test(article.title)
      ? `Here's how to ${article.title[0].toLowerCase()}${article.title.slice(1)}:`
      : `From "${article.title}":`;

    const clientRewrite = analysis?.trace?.some((t) => t.rule === 'domain:client-means-contact');
    const note =
      clientRewrite && article.id !== 'glossary-clients-contacts'
        ? '\n\nIn Harbour CRM, the people your business deals with are called **contacts**.'
        : '';

    return {
      type: 'answer',
      answer: `${intro}\n\n${article.body}${note}`,
      citations: [article.id],
      model: null,
      usage: { inputTokens: estimateTokens(prompt.system + prompt.user), outputTokens: 0, measured: false },
    };
  }
}

/**
 * Claude API via the official SDK. The client is injected so the browser can
 * pass an SDK instance loaded from a CDN and Node can pass the npm package.
 */
export class AnthropicGenerator {
  name = 'anthropic';

  constructor({ client, model }) {
    this.client = client;
    this.model = model;
    this.label = `Claude API (${MODELS[model]?.label ?? model})`;
  }

  async generate({ prompt }) {
    const isHaiku = this.model.startsWith('claude-haiku');
    // Deliberately no `tools`, `tool_choice` or `mcp_servers`: the model can't
    // fetch anything, browse the web or call out. It sees only the articles.
    const request = {
      model: this.model,
      max_tokens: 4000,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      output_config: isHaiku
        ? { format: { type: 'json_schema', schema: prompt.schema } }
        : { effort: 'low', format: { type: 'json_schema', schema: prompt.schema } },
    };

    // Opus 5.5 and Sonnet 5.5 can decline a request on safety grounds; the
    // server-side fallback re-runs it on a suitable model inside the same call.
    const response = isHaiku
      ? await this.client.messages.create(request)
      : await this.client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      measured: true,
    };

    if (response.stop_reason === 'refusal') {
      return { type: 'escalate', answer: '', citations: [], usage, model: response.model, note: 'The model declined to answer.' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { type: 'escalate', answer: '', citations: [], usage, model: response.model, note: 'The reply was cut off before it finished.' };
    }

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ...parseReply(text), usage, model: response.model };
  }
}

/**
 * Claude through the claude.ai artifact runtime (`sample` capability). Used
 * when the demo is opened as a published artifact, where direct API calls are
 * blocked. The runtime takes a single prompt and reports no token usage.
 */
export class ClaudeAiGenerator {
  name = 'claude-ai';
  label = 'Claude (claude.ai runtime)';

  constructor({ sample }) {
    this.sample = sample;
  }

  async generate({ prompt }) {
    const text = `${promptAsText(prompt)}\n\nReply with only the JSON object.`;
    const reply = await this.sample.json(text, { modelTier: 'quick' });
    return {
      ...normaliseReply(reply),
      model: 'claude.ai runtime',
      usage: { inputTokens: estimateTokens(text), outputTokens: estimateTokens(JSON.stringify(reply)), measured: false },
    };
  }
}

export function parseReply(text) {
  try {
    return normaliseReply(JSON.parse(text));
  } catch {
    return { type: 'escalate', answer: '', citations: [], note: 'The reply was not valid JSON.' };
  }
}

function normaliseReply(reply) {
  return {
    type: reply?.type === 'answer' ? 'answer' : 'escalate',
    answer: typeof reply?.answer === 'string' ? reply.answer : '',
    citations: Array.isArray(reply?.citations) ? reply.citations.filter((c) => typeof c === 'string') : [],
  };
}
