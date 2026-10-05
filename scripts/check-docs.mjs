#!/usr/bin/env node
/**
 * Checks that the help articles match the app.
 *
 * 1. Every **bold** UI label in every article must appear somewhere in the
 *    rendered CRM (page text, form labels, options, buttons, dialogs).
 * 2. A few articles are followed step by step in a real browser.
 *
 *   npm run check:docs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { articles } from '../src/kb/articles.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path === '/' || path === '\\' ? 'index.html' : path;
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
const failures = [];

// ------------------------------------------------------------ 1. Label check
const corpus = [];
const collect = async () => {
  corpus.push(
    await page.evaluate(() =>
      [
        document.body.innerText,
        ...[...document.querySelectorAll('option')].map((o) => o.textContent),
        ...[...document.querySelectorAll('[placeholder]')].map((i) => i.placeholder),
      ].join('\n'),
    ),
  );
};
const go = async (route) => {
  await page.goto(base + route);
  await page.waitForSelector('main');
  await collect();
};

for (const route of [
  '#/contacts', '#/contacts/new', '#/contacts/ct_1', '#/contacts/ct_1/edit',
  '#/companies', '#/companies/new', '#/companies/co_1', '#/companies/co_1/edit',
  '#/deals', '#/deals/new', '#/deals/dl_1', '#/deals/dl_4', '#/deals/dl_1/edit',
  '#/settings/account', '#/settings/custom-fields', '#/settings/custom-fields/new', '#/settings/custom-fields/cf_pref',
]) {
  await go(route);
}
// Dialogs
for (const [route, button] of [
  ['#/contacts/ct_1', 'Delete'],
  ['#/companies/co_1', 'Delete'],
  ['#/deals/dl_1', 'Delete'],
  ['#/deals/dl_1', 'Mark as lost'],
  ['#/settings/custom-fields', 'Delete'],
]) {
  await page.goto(base + route);
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await page.waitForSelector('.modal');
  await collect();
  await page.keyboard.press('Escape');
}
// Validation messages only appear after an invalid submit.
await page.goto(`${base}#/contacts/ct_1/edit`);
await page.getByLabel('Email').fill('not-an-email');
await page.getByRole('button', { name: 'Save contact' }).click();
await collect();
// The "Dropdown" type reveals the Options field.
await page.goto(`${base}#/settings/custom-fields/new`);
await page.selectOption('#f-type', 'dropdown');
await collect();

const text = corpus.join('\n').toLowerCase();
let labels = 0;
for (const article of articles) {
  for (const [, label] of article.body.matchAll(/\*\*(.+?)\*\*/g)) {
    labels += 1;
    if (!text.includes(label.toLowerCase())) failures.push(`${article.id}: label "${label}" not found in the UI`);
  }
}
console.log(`Checked ${labels} bold labels across ${articles.length} articles.`);

// ------------------------------------------------------------- 2. Walkthroughs
async function walk(name, steps) {
  try {
    await steps();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message.split('\n')[0]}`);
  }
}
const click = (name) =>
  page
    .getByRole('link', { name, exact: true })
    .or(page.getByRole('button', { name, exact: true }))
    .or(page.getByRole('tab', { name, exact: true }))
    .first()
    .click({ timeout: 5000 });
const expectText = async (value) => {
  if (!(await page.locator('main').innerText()).includes(value)) throw new Error(`expected to see "${value}"`);
};

await walk("contact-edit-phone: Update a contact's phone number", async () => {
  await page.goto(`${base}#/contacts`);
  await click('Contacts');
  await click('Priya Raman');
  await click('Edit');
  await page.getByLabel('Phone').fill('+61 491 570 006');
  await click('Save contact');
  await expectText('+61 491 570 006');
});

await walk('account-client-contact-number: Change your client contact number', async () => {
  await page.goto(`${base}#/contacts`);
  await click('Settings');
  await click('Client profile');
  await page.getByLabel('Client contact number').fill('02 5550 9999');
  await click('Save client profile');
  if ((await page.getByLabel('Client contact number').inputValue()) !== '02 5550 9999') throw new Error('number was not saved');
});

await walk('deal-mark-lost: Mark a deal as lost', async () => {
  await page.goto(`${base}#/deals`);
  await page.getByText('Fernhill brand refresh').click();
  await click('Mark as lost');
  await page.getByLabel('Lost reason').selectOption('Timing');
  await click('Confirm');
  await expectText('Lost reason: Timing');
  await click('Reopen deal');
  await expectText('Mark as won');
});

await walk('custom-field-create: Create a custom field', async () => {
  await page.goto(`${base}#/contacts`);
  await click('Settings');
  await click('Custom fields');
  await click('Add custom field');
  await page.getByLabel('Label').fill('Birthday');
  await page.getByLabel('Applies to').selectOption({ label: 'Contacts' });
  await page.getByLabel('Type').selectOption({ label: 'Date' });
  await click('Save field');
  await click('Contacts');
  await click('Priya Raman');
  await click('Edit');
  await page.getByLabel('Birthday').fill('1990-04-12');
  await click('Save contact');
  await expectText('Birthday');
});

await walk('contact-delete: Delete a contact', async () => {
  await page.goto(`${base}#/contacts/ct_7`);
  await click('Delete');
  await click('Delete contact');
  await expectText('of 7 contacts');
});

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('\nThe help centre matches the app.');
}
