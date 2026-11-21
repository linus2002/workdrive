// Browser checks driven through the real app (headless Edge or Chrome via playwright-core).
//   npm run test:e2e                 – run everything against BASE_URL (default http://localhost:5173)
//   node tests/e2e/run.mjs a11y,phone – run only checks whose name contains one of these words
// Env: BASE_URL, BROWSER_PATH (an Edge/Chrome/Chromium executable), HEADED=1 to watch it.
// Needs the dev server running (`npm run dev`). Exit code 1 when any check fails.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ITEMS } from '../../src/data/mockData.js';

const BASE = (process.env.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? process.argv[2].toLowerCase().split(',') : null;
const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/* ---------------- browser ---------------- */
function findBrowser() {
  if (process.env.BROWSER_PATH) {
    if (fs.existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
    throw new Error(`BROWSER_PATH does not exist: ${process.env.BROWSER_PATH}`);
  }
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = {
    win32: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
      path.join(local, 'Chromium/Application/chrome.exe'),
    ],
    darwin: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    ],
    linux: [
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge',
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    ],
  }[process.platform] || [];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`No Edge or Chrome found. Set BROWSER_PATH to a Chromium-based browser. Looked in:\n  ${candidates.join('\n  ')}`);
  return hit;
}

/* ---------------- harness ---------------- */
const results = [];
const errors = [];
const a11yNotes = [];
function watch(page, tag) {
  page.on('pageerror', (e) => { if (!/boom-e2e/.test(e.message)) errors.push(`[${tag}] pageerror: ${e.message}`); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|Failed to load resource.*404|\[ErrorBoundary/.test(t)) return;
    if (/^The above error occurred|boom-e2e/.test(t)) return; // React's log for the deliberate crash checks
    errors.push(`[${tag}] console: ${t.slice(0, 300)}`);
  });
}
async function test(name, fn) {
  if (only && !only.some((o) => name.toLowerCase().includes(o))) return;
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0, e.message.split('\n').slice(0, 6).join('\n        ')]); }
}
const expect = (c, msg) => { if (!c) throw new Error(msg); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).catch(() => {});

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.getByRole('button', { name: 'Use demo account' }).click();
  await page.locator('button.login-submit').click();
  await page.waitForURL(/\/folders/, { timeout: 15000 });
  await page.waitForSelector('.file-row, .file-card, .folder-tile, [role="row"]', { timeout: 15000 }).catch(() => {});
}
async function openContextMenuFor(page, name) {
  const target = page.locator('main').getByText(name, { exact: true }).locator('visible=true').first();
  await target.waitFor({ timeout: 10000 });
  await target.click({ button: 'right' });
  await page.locator('.context-menu').waitFor({ timeout: 5000 });
}
async function openShare(page, name) {
  await openContextMenuFor(page, name);
  await page.locator('.context-menu').getByText('Share', { exact: true }).click();
  const share = page.locator('.modal').filter({ hasText: 'Link sharing' });
  await share.waitFor({ timeout: 8000 });
  return share;
}
const toastText = (page) => page.locator('.toast').allInnerTexts().then((t) => t.join(' | '));

/**
 * Run axe-core on the page. Serious/critical violations fail the check; moderate/minor are only printed.
 * `include` limits the scan to part of the page (e.g. an open dialog).
 */
async function axeCheck(page, label, { include } = {}) {
  await page.waitForTimeout(400); // let entry animations settle (contrast is measured on the final colours)
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE_SOURCE });
  const violations = await page.evaluate(async (inc) => {
    const ctx = inc ? { include: [[inc]] } : document;
    const r = await window.axe.run(ctx, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, target: v.nodes[0]?.target?.join(' ') || '' }));
  }, include || null);
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of violations.filter((x) => !bad.includes(x))) a11yNotes.push(`[${label}] ${v.impact} ${v.id} ×${v.count} — ${v.help} (first: ${v.target})`);
  if (bad.length) {
    await shot(page, `a11y-${label.replace(/\W+/g, '-').toLowerCase()}.png`);
    throw new Error(`${bad.length} serious/critical axe violation(s):\n${bad.map((v) => `${v.impact} ${v.id} ×${v.count} — ${v.help} (first: ${v.target})`).join('\n')}`);
  }
}

/** Serve a module that throws while rendering in place of a real one, to exercise the crash screens. */
const CRASH_MODULE = "export default function Crash() { throw new Error('boom-e2e: deliberate test crash'); }\n";
async function crashModule(ctx, file) {
  await ctx.route((url) => url.pathname.endsWith(file), (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: CRASH_MODULE }));
}

/* ---------------- run ---------------- */
try {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`The app isn't reachable at ${BASE} (${e.message}). Start it with \`npm run dev\` or set BASE_URL.`);
  process.exit(1);
}

const executablePath = findBrowser();
console.log(`browser: ${executablePath}\napp: ${BASE}\n`);
const browser = await chromium.launch({ executablePath, headless: !process.env.HEADED });
try {
  // ---------------- desktop ----------------
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');

  await test('sign in and land on My Folders', async () => {
    await signIn(page);
    expect(page.url().includes('/folders'), `url is ${page.url()}`);
    await shot(page, '01-folders.png');
  });

  await test('lazy-loaded screens open (admin, signatures, settings, search, team folders, tasks)', async () => {
    for (const [url, text] of [['/admin/users', 'Admin Console'], ['/signatures', 'Signatures'], ['/settings', 'Settings'], ['/search?q=budget', 'budget'], ['/team-folders', 'Team'], ['/tasks', 'Tasks'], ['/admin/guests', 'External collaborators']]) {
      await page.goto(BASE + url);
      await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
    }
  });

  await test('branding: Preview opens in a dialog, Escape closes it', async () => {
    await page.goto(`${BASE}/admin/branding`);
    await page.getByRole('button', { name: 'Preview' }).first().click();
    await page.getByText('Preview public pages').waitFor({ timeout: 8000 });
    await shot(page, '02-branding-preview.png');
    await page.keyboard.press('Escape');
    await page.getByText('Preview public pages').waitFor({ state: 'hidden', timeout: 5000 });
    expect(!(await page.locator('.branding-side').count()), 'old side preview still rendered');
  });

  await test('dialog stack: QR opens over Share, Escape returns to Share', async () => {
    await page.goto(`${BASE}/folders`);
    const share = await openShare(page, 'Company Overview.pptx');
    await page.getByPlaceholder(/Add people or email/i).fill('priya');
    await page.getByRole('button', { name: /QR code/ }).first().click();
    await page.getByText('QR code & embed').waitFor({ timeout: 8000 });
    expect(await page.locator('.modal').count() >= 2, 'QR did not stack on top of Share');
    await shot(page, '03-qr-over-share.png');
    await page.keyboard.press('Escape');
    await page.getByText('QR code & embed').waitFor({ state: 'hidden', timeout: 5000 });
    await share.waitFor({ timeout: 3000 });
    const typed = await page.getByPlaceholder(/Add people or email/i).inputValue().catch(() => '');
    expect(typed === 'priya', `Share dialog lost its state (input = "${typed}")`);
  });

  await test('focus stays inside the open dialog when tabbing', async () => {
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.modal'));
    expect(inside, `focus escaped to ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`);
    await page.keyboard.press('Escape'); // closes Share (may ask about the pending invite)
    if (await page.getByRole('button', { name: /^Discard/ }).count()) await page.getByRole('button', { name: /^Discard/ }).first().click().catch(() => {});
  });

  await test('view-only: deleting a Design Studio file is refused', async () => {
    await page.goto(`${BASE}/team-folders`);
    await page.getByText('Design Studio', { exact: true }).first().click();
    await page.waitForURL(/team-folders\/.+/, { timeout: 10000 });
    const row = page.locator('[role="row"], .file-row').filter({ hasText: /\.(png|jpg|docx|svg|pdf)/ }).first();
    await row.waitFor({ timeout: 10000 });
    const name = (await row.innerText()).split('\n').find((l) => /\.\w{2,4}$/.test(l.trim()))?.trim();
    await row.click();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(600);
    const t = await toastText(page);
    expect(/view-only|can't be deleted|can.t delete|only view/i.test(t), `no refusal toast (toasts: "${t}")`);
    await page.getByRole('button', { name: /^Move to Trash$/ }).first().click({ timeout: 1500 }).catch(() => {}); // a confirm should not appear
    await page.goto(`${BASE}/trash`);
    await page.waitForTimeout(500);
    expect(!(await page.getByText(name, { exact: true }).count()), `"${name}" ended up in Trash`);
  });

  await test('unsaved edit: browser Back asks before discarding', async () => {
    await page.goto(`${BASE}/folders`);
    await page.getByText('Projects', { exact: true }).first().dblclick();
    await page.getByText('Client Portal', { exact: true }).first().dblclick();
    await page.getByText('README.txt', { exact: true }).first().dblclick();
    await page.locator('.preview-overlay').first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /^Edit/ }).first().click();
    const ta = page.locator('textarea').first();
    await ta.click(); await ta.press('End'); await ta.type(' unsaved change');
    await page.goBack();
    await page.waitForTimeout(700);
    const prompt = page.locator('.modal').filter({ hasText: /unsaved|discard/i });
    expect(await prompt.count(), 'no "discard unsaved changes" prompt after Back');
    await shot(page, '04-back-guard.png');
    await page.getByRole('button', { name: /Keep editing/ }).click();
    await page.waitForTimeout(300);
    expect((await ta.inputValue()).includes('unsaved change'), 'edit was lost after choosing Keep editing');
    // leave cleanly: cancel the edit and confirm discarding it
    await page.getByRole('button', { name: /^Cancel/ }).first().click().catch(() => {});
    await page.getByRole('button', { name: /Discard/ }).first().click({ timeout: 2000 }).catch(() => {});
  });

  await test('two tabs: changes in one tab reach the other and are not overwritten', async () => {
    const pageB = await ctx.newPage(); watch(pageB, 'tabB');
    const folder = `Two Tab Check ${Date.now() % 100000}`;
    await pageB.goto(`${BASE}/folders`);
    await page.goto(`${BASE}/folders`);
    await pageB.getByRole('button', { name: /^New$/ }).first().click();
    await pageB.getByText(/^New folder$|^Folder$/).first().click();
    const input = pageB.locator('.modal input').first();
    await input.fill(folder);
    await input.press('Enter');
    await pageB.getByText(folder, { exact: true }).first().waitFor({ timeout: 8000 });
    // Tab A should pick it up without a reload
    await page.getByText(folder, { exact: true }).locator('visible=true').first().waitFor({ timeout: 8000 });
    // Tab A makes a change (favourite something) — this must not wipe B's folder
    await openContextMenuFor(page, 'Reports');
    await page.locator('.context-menu').getByText(/Add to Favorites|Remove from Favorites/).click();
    await page.waitForTimeout(800);
    await pageB.reload();
    await pageB.getByText(folder, { exact: true }).first().waitFor({ timeout: 8000 });
    await pageB.close();
  });

  await test('signature request opens and the signing page renders the PDF', async () => {
    await page.goto(`${BASE}/signatures`);
    await page.getByRole('button', { name: /Sign now/ }).first().click();
    await page.locator('.pdf-page canvas, canvas').first().waitFor({ timeout: 20000 });
    await shot(page, '05-signing.png');
    await page.keyboard.press('Escape');
  });

  // ---------------- accessibility (axe-core) ----------------
  await test('a11y: My Folders', async () => {
    await page.goto(`${BASE}/folders`);
    await page.locator('main').getByText('Company Overview.pptx', { exact: true }).first().waitFor({ timeout: 10000 });
    await axeCheck(page, 'my-folders');
  });
  await test('a11y: Share dialog open', async () => {
    await page.goto(`${BASE}/folders`);
    await openShare(page, 'Company Overview.pptx');
    await axeCheck(page, 'share-dialog', { include: '.modal' });
    await page.keyboard.press('Escape');
  });
  await test('a11y: Settings', async () => {
    await page.goto(`${BASE}/settings`);
    await page.getByText('Settings').first().waitFor({ timeout: 10000 });
    await axeCheck(page, 'settings');
  });
  await test('a11y: Admin branding', async () => {
    await page.goto(`${BASE}/admin/branding`);
    await page.getByRole('button', { name: 'Preview' }).first().waitFor({ timeout: 10000 });
    await axeCheck(page, 'admin-branding');
  });
  await test('a11y: public link page (as a guest)', async () => {
    const linked = ITEMS.find((i) => i.name === 'Company Overview.pptx');
    expect(linked, 'sample file "Company Overview.pptx" not found');
    await page.goto(`${BASE}/link/${linked.id}?as=guest`);
    await page.locator('body *').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
    await shot(page, '08-public-link.png');
    await axeCheck(page, 'public-link');
  });
  await ctx.close();

  // ---------------- crash screens (a module is swapped for one that throws while rendering) ----------------
  await test('crash: a failing screen shows the error screen and the app frame stays', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const p = await c.newPage(); watch(p, 'crash');
    await crashModule(c, '/src/views/SettingsView.jsx');
    await signIn(p);
    await p.goto(`${BASE}/settings`);
    await p.getByText('Something went wrong on this screen').waitFor({ timeout: 10000 });
    expect(await p.locator('.sidebar, nav').count(), 'sidebar disappeared');
    await shot(p, '09-crash-screen.png');
    await p.getByRole('button', { name: 'Go to My Folders' }).click();
    await p.waitForURL(/\/folders/, { timeout: 8000 });
    await p.locator('main').getByText('Company Overview.pptx', { exact: true }).first().waitFor({ timeout: 10000 });
    expect(!(await p.getByText('Something went wrong on this screen').count()), 'error screen still shown after leaving');
    await c.close();
  });
  await test('crash: a failing dialog becomes a small error dialog with Close', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const p = await c.newPage(); watch(p, 'crash');
    await crashModule(c, '/src/components/dialogs/ShareDialog.jsx');
    await signIn(p);
    await openContextMenuFor(p, 'Company Overview.pptx');
    await p.locator('.context-menu').getByText('Share', { exact: true }).click();
    const modal = p.locator('.modal').filter({ hasText: 'Something went wrong' });
    await modal.waitFor({ timeout: 10000 });
    await shot(p, '10-crash-dialog.png');
    await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    await p.locator('main').getByText('Company Overview.pptx', { exact: true }).first().waitFor({ timeout: 5000 });
    await c.close();
  });
  await test('crash: a failing preview offers Close preview', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const p = await c.newPage(); watch(p, 'crash');
    await crashModule(c, '/src/components/preview/FilePreview.jsx');
    await signIn(p);
    // Opened from the URL (one history entry), so closing must drop ?preview= rather than step back.
    await p.goto(`${BASE}/folders?preview=${ITEMS.find((i) => i.name === 'Company Overview.pptx').id}`);
    await p.getByText('This file couldn’t be shown').waitFor({ timeout: 10000 });
    expect(await p.locator('.sidebar, nav').count(), 'the app behind the preview disappeared');
    await shot(p, '11-crash-preview.png');
    await p.getByRole('button', { name: 'Close preview' }).click();
    await p.getByText('This file couldn’t be shown').waitFor({ state: 'hidden', timeout: 5000 });
    expect(!/[?&]preview=/.test(p.url()), `preview still in the URL: ${p.url()}`);
    await c.close();
  });

  // ---------------- phone ----------------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await m.newPage(); watch(mp, 'phone');
  await test('phone: no sideways scrolling on main screens', async () => {
    await signIn(mp);
    for (const url of ['/folders', '/team-folders', '/signatures', '/admin/branding', '/admin/guests', '/settings']) {
      await mp.goto(BASE + url); await mp.waitForTimeout(700);
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 2) { await shot(mp, `phone-overflow${url.replace(/\//g, '_')}.png`); throw new Error(`${url} is ${over}px wider than the screen`); }
    }
  });
  await test('a11y: phone-width My Folders', async () => {
    await mp.goto(`${BASE}/folders`);
    const rows = mp.locator('.file-row:not(.file-head), .file-card, .folder-tile, .login-submit').locator('visible=true').first();
    await rows.waitFor({ timeout: 15000 });
    if (await mp.locator('.login-submit').count()) await signIn(mp); // when run on its own
    await mp.locator('.file-row:not(.file-head), .file-card, .folder-tile').locator('visible=true').first().waitFor({ timeout: 10000 });
    await mp.waitForTimeout(500);
    await axeCheck(mp, 'phone-my-folders');
  });
  await test('phone: "New" menu fits on screen', async () => {
    await mp.goto(`${BASE}/folders`);
    await mp.getByRole('button', { name: /^New$/ }).first().click();
    const box = await mp.locator('.popover').first().boundingBox();
    await shot(mp, '06-phone-new-menu.png');
    expect(box && box.x >= 0 && box.x + box.width <= 391, `menu at x=${box?.x} w=${box?.width}`);
    await mp.keyboard.press('Escape');
  });
  await test('phone: tapping a folder in grid view opens it', async () => {
    await mp.goto(`${BASE}/folders`);
    const grid = mp.getByRole('radio', { name: /grid/i });
    if (await grid.count()) await grid.first().tap().catch(() => grid.first().click());
    await mp.waitForTimeout(400);
    await mp.getByText('Projects', { exact: true }).locator('visible=true').first().tap();
    await mp.waitForURL(/\/folders\/.+/, { timeout: 6000 });
  });
  await test('phone: PDF preview renders pages (not a blank iframe)', async () => {
    await mp.goto(`${BASE}/folders`);
    await mp.getByText('Reports', { exact: true }).locator('visible=true').first().tap();
    await mp.waitForURL(/\/folders\/.+/, { timeout: 6000 });
    await mp.getByText('Q3 Business Review.pdf', { exact: true }).locator('visible=true').first().tap();
    // Sample PDFs render as text pages, uploaded ones on canvas; either way nothing may be cut off or blank.
    await mp.locator('canvas, .paper').first().waitFor({ timeout: 20000 });
    await shot(mp, '07-phone-pdf.png');
    const box = await mp.locator('canvas, .paper').first().boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 391, `page is cut off (x=${box?.x}, w=${box?.width})`);
    const iframes = await mp.locator('iframe').count();
    expect(!iframes, `${iframes} iframe(s) used for the PDF on a phone`);
  });
  await m.close();
} finally {
  await browser.close();
}

/* ---------------- report ---------------- */
for (const r of results) console.log(`${r[0]}  ${r[1]}  (${r[2]}ms)${r[3] ? `\n      → ${r[3]}` : ''}`);
if (a11yNotes.length) {
  console.log(`\naxe moderate/minor findings (not failures):`);
  [...new Set(a11yNotes)].forEach((n) => console.log('  ' + n));
}
const uniq = [...new Set(errors)];
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed · ${uniq.length} browser error(s)`);
uniq.slice(0, 25).forEach((e) => console.log('  ' + e));
console.log(`screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
