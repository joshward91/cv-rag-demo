/**
 * Text normalisation shared by indexing and querying. Both sides must run the
 * exact same pipeline, otherwise query terms silently stop matching documents.
 */

export const STOPWORDS = new Set(
  `a an and are as at be been but by can could do does did for from has have how i i'd i'm if in into is it its
   me my of on or our ours please so that the their them then there these they this to us was we were what when
   where which who why will with would you your yours want wanted need needs trying try tried help get go should
   just way someone something anyone also any all am able let lets know tell show`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lower-case, unify apostrophes, split off possessives, drop punctuation. */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    // Keep possessives as a separate "s" token so phrase rules can tell
    // "a client's contact number" (a contact) from "client contact number"
    // (the account setting). Single-letter tokens are dropped later.
    .replace(/'s\b/g, ' s')
    .replace(/s'(?=\s|$)/g, 's s')
    .replace(/e-mail/g, 'email')
    .replace(/[^a-z0-9+&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A deliberately small, predictable suffix stripper. It only needs to make
 * "contacts"/"contact" and "updating"/"update" collide; it does not need to be
 * linguistically correct because the same function runs on both sides.
 */
export function stem(word) {
  if (word.length <= 3 || /\d/.test(word)) return word;
  let w = word;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

export function words(text) {
  const n = normalise(text);
  return n ? n.split(' ') : [];
}

/**
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions,
 * so "contcat" is one edit away from "contact".
 */
export function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
