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
import { copyFileSync, existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const inlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
mkdirSync(`${root}dist`, { recursive: true });

// Swaps the embedding model loader and article vectors for empty stubs, so the
// lexical-only build doesn't carry them.
const withoutSemantic = {
  name: 'without-semantic',
  setup(b) {
    b.onResolve({ filter: /(?:embedder\.browser|article-vectors)\.js$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const articleVectors = null; export function createBrowserEmbedder() { throw new Error("Semantic search is not in this build."); }',
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
writeFileSync(`${root}docs/report.html`, asDocument(reportPage('./')));
writeFileSync(`${root}docs/.nojekyll`, '');

console.log(`dist/harbour-crm.html  ${(demo.length / 1024).toFixed(0)} KB`);
console.log(`dist/report.html       ${(report.length / 1024).toFixed(0)} KB`);
console.log('docs/                   static site for GitHub Pages');
