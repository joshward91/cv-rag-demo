import { createEmbedder } from '../rag/minilm.js';
import { EMBEDDING_MODEL } from '../rag/semantic.js';

/**
 * Embedder for the browser: the same quantised model the eval uses, served
 * from this site (models/ and ort/), never from a third-party CDN. Runs on
 * WebAssembly on the visitor's machine, so no question leaves the page and
 * offline mode stays free.
 *
 * @param {string} base URL the site is served from
 * @returns {Promise<(texts: string[]) => Promise<number[][]>>}
 */
export async function createBrowserEmbedder(base) {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.wasmPaths = new URL('ort/', base).href;
  // GitHub Pages can't send the headers multi-threaded WebAssembly needs.
  ort.env.wasm.numThreads = 1;
  const dir = new URL(`models/${EMBEDDING_MODEL}/`, base);
  const [model, tokenizerJson] = await Promise.all([
    fetch(new URL('onnx/model_quantized.onnx', dir)).then((r) => r.arrayBuffer()),
    fetch(new URL('tokenizer.json', dir)).then((r) => r.json()),
  ]);
  const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  return createEmbedder(ort, session, tokenizerJson);
}
