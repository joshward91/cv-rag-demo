import { articles } from '../kb/articles.js';
import { Store } from '../crm/store.js';
import { overviewArticles } from '../kb/overview-articles.js';
import { viewerRetriever } from '../rag/suite.js';
import { SemanticIndex } from '../rag/semantic.js';
import { articleVectors } from '../kb/article-vectors.js';
import { CrmApp } from './app.js';
import { ChatWidget } from './chat.js';

const store = new Store();
// Hybrid retrieval needs the embedding model files next to the page. The
// static site ships them; the single-file claude.ai build can't, so it is
// built with __SEMANTIC__ false and stays lexical.
const semanticEnabled = globalThis.__SEMANTIC__ ?? true;
const semantic = semanticEnabled ? new SemanticIndex(articleVectors.passages, { graph: articleVectors.graph }) : null;
const helpCentre = [...articles, ...overviewArticles];
const retrievers = {
  signedIn: viewerRetriever(helpCentre, { loggedIn: true }, { semantic }),
  signedOut: viewerRetriever(helpCentre, { loggedIn: false }, { semantic }),
};

const app = new CrmApp({
  root: document.getElementById('app'),
  store,
  articles,
  onDownload: download,
  // Set at build time by scripts/build.js; absent when running from source.
  reportUrl: typeof __REPORT_URL__ !== 'undefined' ? __REPORT_URL__ : '',
});
const chat = new ChatWidget({
  root: document.getElementById('chat'),
  app,
  retrievers,
  sample: null,
  loadEmbedder: semanticEnabled ? () => import('./embedder.browser.js').then((m) => m.createBrowserEmbedder(document.baseURI)) : null,
  loadSuite: semanticEnabled ? () => import('./suite.browser.js').then((m) => m.loadSuite(document.baseURI)) : null,
});

app.start();
chat.render();

// Inside a claude.ai viewer, Claude can write answers through the page runtime.
if (window.claude?.use) {
  window.claude.use('sample').then((sample) => sample && chat.setSample(sample)).catch(() => {});
}

async function download(filename, text) {
  if (window.claude?.use) {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        await downloads.save({ filename, data: text });
        return true;
      }
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
