// End-to-end check for M0 in a real browser (Microsoft Edge headless + CDP).
//
// What it verifies:
//  1. the production build loads in a real browser (fengari bundled, no module crash)
//  2. the fallback file-input import works with the real data.wak + common.csv
//  3. the game's gun_actions.lua is executed in the browser and 422 spells render
//  4. IndexedDB cache restore works after a reload
//  5. i18n toggle works
//
// Usage: node scripts/e2e-m0.mjs  (needs `vite preview` on :4173 and Edge on :9222)

import { writeFileSync } from 'node:fs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const NOITA_DIR = process.env.NOITA_DIR ?? 'C:/Program Files/Steam/steamapps/common/Noita';
const WAK = `${NOITA_DIR}/data/data.wak`;
const CSV = `${NOITA_DIR}/data/translations/common.csv`;
const SHOT = process.env.SHOT_PATH ?? './e2e-m0.png';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + url);
    await sleep(300);
  }
}

const version = await waitForJson(`${CDP}/json/version`);
console.log('browser:', version.Browser);

const target = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
    else entry.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('exception: ' + (message.params.exceptionDetails?.exception?.description ?? 'unknown'));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push('console.error: ' + message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails.exception?.description));
  }
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await evaluate(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(300);
  }
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

// 0) start from a clean browser profile: drop the cached IndexedDB import
await waitFor(
  "document.readyState === 'complete' && location.href !== 'about:blank'",
  60000,
  'page navigation',
);
await evaluate(
  "new Promise((resolve) => { const req = indexedDB.deleteDatabase('noita-wand-sim'); req.onsuccess = req.onerror = req.onblocked = () => resolve(true); })",
  true,
);
await send('Page.reload');
await sleep(800);

// 1) page loads and shows the import panel
await waitFor("!!document.querySelector('.import-panel')", 30000, 'import panel');
console.log('✓ app loaded');

// 2) import via the fallback file input (CDP can set files programmatically)
const doc = await send('DOM.getDocument', { depth: -1 });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
if (!input.nodeId) throw new Error('file input not found');
await send('DOM.setFileInputFiles', { files: [WAK, CSV], nodeId: input.nodeId });
console.log('✓ file input set, importing…');

const statsText = await waitFor("document.querySelector('.stats-bar')?.innerText || ''", 180000, 'stats bar');
const cards = await evaluate("document.querySelectorAll('.spell-card').length");
console.log('✓ import finished');
console.log('  stats:', statsText.replace(/\n/g, ' | '));
console.log('  spell cards:', cards);
if (!/422/.test(statsText)) throw new Error('expected 422 spells, stats: ' + statsText);
if (cards < 400) throw new Error('expected >= 400 cards, got ' + cards);

// check a couple of localized names in the UI
const gamma = await evaluate(
  "Array.from(document.querySelectorAll('.spell-card')).find(el => el.innerText.includes('伽马'))?.innerText || ''",
);
if (!gamma.includes('伽马')) throw new Error('gamma card not found');
console.log('✓ localized cards:', gamma.replace(/\n/g, ' | '));

// 3) i18n toggle
await evaluate("document.querySelector('.lang-switch').click()");
await sleep(300);
const titleEn = await evaluate("document.querySelector('h1').innerText");
if (titleEn !== 'Noita Wand Simulator') throw new Error('lang switch failed: ' + titleEn);
await evaluate("document.querySelector('.lang-switch').click()");
await sleep(300);
console.log('✓ i18n toggle works');

// 4) reload: data should be restored from IndexedDB
await send('Page.reload');
await sleep(1000);
const restored = await waitFor("document.querySelector('.stats-bar')?.innerText || ''", 60000, 'cached stats after reload');
console.log('✓ IndexedDB restore after reload:', restored.replace(/\n/g, ' | '));

// 5) screenshot
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
console.log('✓ screenshot:', SHOT);

if (consoleErrors.length > 0) {
  console.warn('browser errors:', consoleErrors.slice(0, 10));
} else {
  console.log('✓ no browser console errors');
}

await fetch(`${CDP}/json/close/${target.id}`);
ws.close();
console.log('E2E_OK');
