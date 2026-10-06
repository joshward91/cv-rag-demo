/**
 * Exact token counts from Anthropic's token-counting endpoint, saved by
 * eval/count-tokens.mjs in eval/token-counts.json. The evaluation and the
 * model comparison use them when present, and fall back to the four
 * characters per token estimate (estimateTokens) when not.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export const COUNTS_FILE = new URL('./token-counts.json', import.meta.url);

/** A short, stable key for a piece of text, so the counts file holds no prompt text. */
export const hashText = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);

/** The key for a prompt: everything the request sends (system, question and articles, response schema). */
export const promptKey = (prompt) => hashText(JSON.stringify([prompt.system, prompt.user, prompt.schema]));

/** The counts file as lookups, or null when it hasn't been made. */
export function loadCounts() {
  if (!existsSync(COUNTS_FILE)) return null;
  const file = JSON.parse(readFileSync(COUNTS_FILE, 'utf8'));
  return {
    method: file.method,
    countedAt: file.countedAt,
    /** Input tokens for this prompt on this model, or null if it wasn't counted. */
    input: (model, prompt) => file.input?.[model]?.[promptKey(prompt)] ?? null,
    /** Tokens in this reply text on this model, or null if it wasn't counted. */
    output: (model, text) => file.output?.[model]?.[hashText(text)] ?? null,
  };
}
