/**
 * BERT WordPiece tokenizer for all-MiniLM-L6-v2, driven by the model's own
 * tokenizer.json (lowercasing, accent stripping, punctuation splitting, then
 * greedy longest-match subwords). A test checks it against the reference
 * Hugging Face tokenizer on every article passage and eval question.
 */
const isWhitespace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || /\p{Zs}/u.test(c);
const isControl = (c) => !(c === '\t' || c === '\n' || c === '\r') && /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u.test(c);
const isPunctuation = (c) => {
  const cp = c.codePointAt(0);
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) || /\p{P}/u.test(c);
};
const isCjk = (cp) =>
  (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) || (cp >= 0x2a700 && cp <= 0x2b73f) ||
  (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);

export class WordPieceTokenizer {
  /** @param {object} tokenizerJson the parsed tokenizer.json */
  constructor(tokenizerJson) {
    const { model, truncation } = tokenizerJson;
    this.vocab = new Map(Object.entries(model.vocab));
    this.unk = this.vocab.get(model.unk_token);
    this.prefix = model.continuing_subword_prefix;
    this.maxCharsPerWord = model.max_input_chars_per_word;
    this.maxLength = truncation?.max_length ?? 512;
    this.cls = this.vocab.get('[CLS]');
    this.sep = this.vocab.get('[SEP]');
  }

  normalise(text) {
    let out = '';
    for (const c of text) {
      const cp = c.codePointAt(0);
      if (cp === 0 || cp === 0xfffd || isControl(c)) continue;
      out += isWhitespace(c) ? ' ' : isCjk(cp) ? ` ${c} ` : c;
    }
    return out.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
  }

  /** Split on whitespace, then make every punctuation character its own word. */
  preTokenise(text) {
    const words = [];
    for (const chunk of text.split(' ')) {
      let word = '';
      for (const c of chunk) {
        if (isPunctuation(c)) {
          if (word) words.push(word);
          words.push(c);
          word = '';
        } else word += c;
      }
      if (word) words.push(word);
    }
    return words;
  }

  wordPiece(word) {
    const chars = [...word];
    if (chars.length > this.maxCharsPerWord) return [this.unk];
    const ids = [];
    for (let start = 0; start < chars.length; ) {
      let end = chars.length;
      let id;
      for (; end > start; end--) {
        const piece = (start > 0 ? this.prefix : '') + chars.slice(start, end).join('');
        id = this.vocab.get(piece);
        if (id !== undefined) break;
      }
      if (id === undefined) return [this.unk];
      ids.push(id);
      start = end;
    }
    return ids;
  }

  /** Token ids with [CLS] and [SEP], truncated to the model's maximum length. */
  encode(text) {
    const ids = this.preTokenise(this.normalise(text)).flatMap((w) => this.wordPiece(w));
    return [this.cls, ...ids.slice(0, this.maxLength - 2), this.sep];
  }
}
