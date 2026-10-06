import { readFileSync } from 'node:fs';
import { createEmbedder } from './minilm.js';
import { EMBEDDING_MODEL } from './semantic.js';

/**
 * Embedder for Node (indexing, eval, tests): the same quantised model and
 * tokenizer code the browser uses, loaded from the vendored files in models/.
 * @returns {Promise<(texts: string[]) => Promise<number[][]>>}
 */
export async function createNodeEmbedder() {
  const ort = await import('onnxruntime-node');
  const dir = new URL(`../../models/${EMBEDDING_MODEL}/`, import.meta.url);
  const session = await ort.InferenceSession.create(new URL('onnx/model_quantized.onnx', dir).pathname);
  return createEmbedder(ort, session, JSON.parse(readFileSync(new URL('tokenizer.json', dir), 'utf8')));
}
