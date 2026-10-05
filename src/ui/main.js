import { articles } from '../kb/articles.js';
import { Store } from '../crm/store.js';
import { Retriever } from '../rag/retriever.js';
import { CrmApp } from './app.js';
import { ChatWidget } from './chat.js';

const store = new Store();
const retriever = new Retriever(articles);

const app = new CrmApp({
  root: document.getElementById('app'),
  store,
  articles,
  onDownload: download,
  // Set at build time by scripts/build.js; absent when running from source.
  reportUrl: typeof __REPORT_URL__ !== 'undefined' ? __REPORT_URL__ : '',
});
const chat = new ChatWidget({ root: document.getElementById('chat'), app, retriever, sample: null });

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
