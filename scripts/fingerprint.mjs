import { createHash } from 'node:crypto';

/** Short hash of the help centre, used to detect edited articles and stale vectors. */
export function fingerprintArticles(articles) {
  return createHash('sha256').update(JSON.stringify(articles)).digest('hex').slice(0, 12);
}
