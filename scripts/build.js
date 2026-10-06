#!/usr/bin/env node
/**
 * Builds the publishable pages into dist/:
 *
 *   dist/harbour-crm.html   the CRM demo as one self-contained page
 *   dist/report.html        the evaluation report with eval/results.json embedded
 *
 * Both are written as page *content* (title, styles, markup, scripts) without a
 * document skeleton, the format the claude.ai artifact host expects; browsers
 * render them as-is. For local development, serve the repository root instead
 * (`npm run serve`) and open index.html, which loads the ES modules directly.
 *
 * Optional: DEMO_URL and REPORT_URL link the two pages to each other.
 *
 * It also writes a static site for GitHub Pages, as complete HTML documents
 * that link to each other relatively:
 *
 *   docs/index.html    the CRM demo
 *   docs/report.html   the evaluation report
 */
import { build } from 'esbuild';
import { copyFileSync, existsSync, cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { articles as crmArticles } from '../src/kb/articles.js';
import { withheldReason } from '../src/rag/suite.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
mkdirSync(`${root}dist`, { recursive: true });

// Swaps the embedding model loader and article vectors for empty stubs, so the
// lexical-only build doesn't carry them.
const withoutSemantic = {
  name: 'without-semantic',
  setup(b) {
    b.onResolve({ filter: /(?:embedder\.browser|suite\.browser|article-vectors)\.js$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const articleVectors = null; export function createBrowserEmbedder() { throw new Error("Semantic search is not in this build."); } export function loadSuite() { throw new Error("Other products are not in this build."); }',
    }));
  },
};

// CRM demo --------------------------------------------------------------------
async function demoPage(reportUrl, { semantic }) {
  const bundle = await build({
    entryPoints: [`${root}src/ui/main.js`],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    target: 'es2022',
    define: { __REPORT_URL__: JSON.stringify(reportUrl), 'globalThis.__SEMANTIC__': JSON.stringify(semantic) },
    plugins: semantic ? [] : [withoutSemantic],
  });
  const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  return `<meta charset="utf-8" />
<title>Harbour CRM</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" />
<style>${read('src/ui/styles.css')}</style>
<div id="app" class="shell"></div>
<div id="chat"></div>
<script type="module">${script}</script>
`;
}

// Report --------------------------------------------------------------------
function reportPage(demoUrl) {
  return read('report/template.html')
    .replace('__RESULTS__', () => inlineJson(JSON.parse(read('eval/results.json'))))
    .replace('__HISTORY__', () => inlineJson(JSON.parse(read('eval/history.json'))))
    .replace('__SUITE__', () => (existsSync(`${root}eval/suite/results.json`) ? inlineJson(JSON.parse(read('eval/suite/results.json'))) : 'null'))
    .replace('__WITHHELD__', () => inlineJson(JSON.parse(read('eval/suite/withheld-articles.json')).map((a) => ({ id: a.id, product: a.product, category: a.category, title: a.title, body: a.body, status: withheldReason(a) }))))
    .replace('__DOCUMENTS__', () => inlineJson([...crmArticles.map((a) => ({ ...a, product: 'Harbour CRM' })), ...JSON.parse(read('src/kb/suite-articles.json'))].map(({ id, product, category, title, body }) => ({ id, product, category, title, body }))))
    .replace('__SCALE__', () => (existsSync(`${root}eval/scale/results.json`) ? inlineJson(JSON.parse(read('eval/scale/results.json'))) : 'null'))
    .replace('__TIERS__', () => (existsSync(`${root}eval/compare/tiers.json`) ? inlineJson(JSON.parse(read('eval/compare/tiers.json'))) : 'null'))
    .replace('__COMPARISON__', () => (existsSync(`${root}eval/compare/results.json`) ? inlineJson(JSON.parse(read('eval/compare/results.json'))) : 'null'))
    .replace('__DEMO_URL__', () => demoUrl);
}

// The WebAssembly runtime that onnxruntime-web/wasm loads at run time.
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

// Page content -> complete document, for hosts that serve files as-is.
// The content security policy is the browser-enforced version of "grounded,
// no external fetch": the page can only call the Anthropic API (and only when
// a visitor supplies their own key), and loads no third-party scripts.
const CSP = [
  "default-src 'none'",
  // 'self' and 'wasm-unsafe-eval' let the page run the embedding model it hosts.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://api.anthropic.com",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const asDocument = (content) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n<meta name="referrer" content="no-referrer" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n${content.replace('<meta charset="utf-8" />\n', '').replace(/(<style>)/, '</head>\n<body>\n$1')}</body>\n</html>\n`;

// The single-file claude.ai page can't carry the 37 MB model, so it stays lexical.
const demo = await demoPage(process.env.REPORT_URL ?? '', { semantic: false });
const report = reportPage(process.env.DEMO_URL ?? '');
writeFileSync(`${root}dist/harbour-crm.html`, demo);
writeFileSync(`${root}dist/report.html`, report);

mkdirSync(`${root}docs`, { recursive: true });
writeFileSync(`${root}docs/index.html`, asDocument(await demoPage('report.html', { semantic: true })));
// The embedding model and the WebAssembly runtime, served from the site itself.
cpSync(`${root}models/Xenova`, `${root}docs/models/Xenova`, { recursive: true });
mkdirSync(`${root}docs/ort`, { recursive: true });
for (const file of ORT_FILES) copyFileSync(`${root}node_modules/onnxruntime-web/dist/${file}`, `${root}docs/ort/${file}`);
// Harbour's other products: public articles and one HNSW index over every
// public passage (scripts/build-suite.mjs). The withheld documents are
// published deliberately, in separate files, for the retrieval panel's
// labelled "filtered out" section; the assistant's index never holds them.
mkdirSync(`${root}docs/suite`, { recursive: true });
copyFileSync(`${root}src/kb/suite-articles.json`, `${root}docs/suite/articles.json`);
copyFileSync(`${root}eval/suite/withheld-articles.json`, `${root}docs/suite/withheld-articles.json`);
for (const file of ['public.json', 'public.bin', 'public.graph.json', 'withheld.json', 'withheld.bin']) copyFileSync(`${root}eval/suite/index/${file}`, `${root}docs/suite/${file}`);
writeFileSync(`${root}docs/report.html`, asDocument(reportPage('./')));
writeFileSync(`${root}docs/.nojekyll`, '');

// Withheld documents (internal, draft, archived, no status) may only be
// published in their own labelled files.
// Check every other text file in docs/ and dist/ for their ids and titles.
const withheldDocs = JSON.parse(readFileSync(`${root}eval/suite/withheld-articles.json`, 'utf8'));
// An archived article can share its title with the public one that replaced it.
const publicTitles = new Set([...crmArticles, ...JSON.parse(read('src/kb/suite-articles.json'))].map((a) => a.title));
const labelled = new Set([`${root}docs/suite/withheld-articles.json`, `${root}docs/suite/withheld.json`]);
const published = [...walk(`${root}docs`), ...walk(`${root}dist`)].filter((f) => /\.(?:html|js|mjs|json)$/.test(f) && !labelled.has(f));
for (const file of published) {
  // The report's appendix lists the withheld documents in one labelled data block.
  const text = readFileSync(file, 'utf8').replace(/<script type="application\/json" id="withheld-data">[\s\S]*?<\/script>/, '');
  const hit = withheldDocs.find((d) => text.includes(d.id) || (!publicTitles.has(d.title) && text.includes(d.title)));
  if (hit) throw new Error(`Withheld document "${hit.id}" found in ${file}`);
}
console.log(`checked ${published.length} published files: withheld documents only in their labelled files`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
}

console.log(`dist/harbour-crm.html  ${(demo.length / 1024).toFixed(0)} KB`);
console.log(`dist/report.html       ${(report.length / 1024).toFixed(0)} KB`);
console.log('docs/                   static site for GitHub Pages');
