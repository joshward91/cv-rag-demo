/**
 * Claude API list prices in USD per million tokens (first-party API).
 * Source: Anthropic model pricing, checked 2026-10-03.
 */
export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', input: 4, output: 20 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', input: 2, output: 10 },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', input: 1, output: 5 },
};

// Sonnet matched Opus on the model comparison (eval/compare) at half the price.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/**
 * Rough token estimate (about four characters per token for English prose).
 * Only used when no measured usage is available; reports label it as an estimate.
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function costUsd(model, { inputTokens, outputTokens }) {
  const price = MODELS[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function formatUsd(amount) {
  if (amount === null || amount === undefined) return 'n/a';
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  return `$${amount.toFixed(4)}`;
}
