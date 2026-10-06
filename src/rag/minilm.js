import { WordPieceTokenizer } from './wordpiece.js';

/**
 * Sentence embeddings from all-MiniLM-L6-v2: tokenise, run the ONNX model,
 * mean-pool the token vectors and L2-normalise. Shared by Node (indexing,
 * eval, tests) and the browser, which pass in their own ONNX Runtime build.
 *
 * @param {object} ort onnxruntime-node or onnxruntime-web
 * @param {object} session an ort.InferenceSession for the model
 * @param {object} tokenizerJson the model's parsed tokenizer.json
 * @returns {(texts: string[]) => Promise<number[][]>}
 */
export function createEmbedder(ort, session, tokenizerJson) {
  const tokenizer = new WordPieceTokenizer(tokenizerJson);
  const embedOne = async (text) => {
    const ids = tokenizer.encode(text);
    const shape = [1, ids.length];
    const tensor = (values) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), shape);
    const feeds = {
      input_ids: tensor(ids),
      attention_mask: tensor(ids.map(() => 1)),
      token_type_ids: tensor(ids.map(() => 0)),
    };
    const { last_hidden_state: hidden } = await session.run(feeds);
    const [, tokens, dims] = hidden.dims;
    const vector = new Array(dims).fill(0);
    for (let t = 0; t < tokens; t++) for (let d = 0; d < dims; d++) vector[d] += hidden.data[t * dims + d] / tokens;
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  };
  return async (texts) => {
    const out = [];
    for (const text of texts) out.push(await embedOne(text));
    return out;
  };
}
