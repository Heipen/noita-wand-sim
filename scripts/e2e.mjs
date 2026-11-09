// End-to-end check for the simulator UI (Microsoft Edge headless + CDP).
//
// Verifies:
//  1. bundled data loads with zero setup (422 spells)
//  2. the engine worker simulates the default trigger wand and renders the cast tree
//  3. clicking a spell fills a wand slot and updates the result
//  4. dividing preset produces the known 800 projectiles
//  5. hovering a spell shows the in-game style tooltip (type / mana / cast delay / unlock / tier)
//  6. local data.wak import still works and the engine picks up its scripts
//  7. i18n toggle
//
// Usage: npm run e2e   (needs `vite preview` on :4173 and Edge with --remote-debugging-port=9222)

import { writeFileSync } from 'node:fs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const NOITA_DIR = process.env.NOITA_DIR ?? 'C:/Program Files/Steam/steamapps/common/Noita';
const WAK = `${NOITA_DIR}/data/data.wak`;
const CSV = `${NOITA_DIR}/data/translations/common.csv`;
const SHOT = process.env.SHOT_PATH ?? './e2e-m2.png';

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

const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })).json();
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
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (result.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(result.exceptionDetails.exception?.description));
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

// 0) clean state, reload into the bundled data pack
await waitFor("document.readyState === 'complete' && location.href !== 'about:blank'", 60000, 'page navigation');
await evaluate(
  "new Promise((resolve) => { const req = indexedDB.deleteDatabase('noita-wand-sim'); req.onsuccess = req.onerror = req.onblocked = () => resolve(true); })",
  true,
);
await evaluate('localStorage.clear(); true');
await send('Page.reload');
await sleep(700);

// 1) bundled data
const stats = await waitFor("document.querySelector('.stats-bar')?.innerText || ''", 60000, 'stats bar');
console.log('✓ bundled data:', stats.replace(/\n/g, ' | '));
if (!/422/.test(stats)) throw new Error('expected 422 spells');

// 2) default trigger wand -> cast tree (worker engine)
const shotText = await waitFor("document.querySelector('.shot-card')?.innerText || ''", 60000, 'first shot');
console.log('✓ cast tree:', (await evaluate("document.querySelector('.shot-tree')?.innerText")).replace(/\n/g, ' | '));
if (!shotText.includes('第 1 次施法')) throw new Error('missing shot header');
const summaryText = await evaluate("document.querySelector('.spell-summary')?.innerText || ''");
if (!summaryText.includes('共 2 个投射物')) throw new Error('expected summary with 2 projectiles, got: ' + summaryText);
const treeText = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
for (const needle of ['抽到「触发火花弹」', '开启命中触发', '抽到「炸弹」', '生成投射物', '弃牌']) {
  if (!treeText.includes(needle)) throw new Error(`cast tree missing ${needle}: ${treeText}`);
}

// 3) click a spell to fill the next empty slot
const filledBefore = await evaluate("document.querySelectorAll('.wand-slot.filled').length");
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="DAMAGE"]'); el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
await waitFor(`document.querySelectorAll('.wand-slot.filled').length === ${filledBefore + 1}`, 15000, 'slot filled');
console.log('✓ click-to-add works, filled slots:', await evaluate("document.querySelectorAll('.wand-slot.filled').length"));

// 3b) modifier summary + casting steps; stat-change chips are hidden until toggled on
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'double-damage'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const summary = await waitFor(
  "document.querySelector('.spell-summary')?.innerText.includes('伤害增强') && document.querySelector('.spell-summary').innerText",
  60000,
  'modifier summary',
);
if (!summary.includes('携带修正') || !summary.includes('伤害增强 ×1')) throw new Error('missing modifier summary: ' + summary);
const stepsText = await evaluate("document.querySelector('.step-list')?.innerText || ''");
if (!stepsText.includes('抽取')) throw new Error('missing human steps: ' + stepsText);
if (!stepsText.includes('执行「伤害增强」')) throw new Error('missing action explanation: ' + stepsText);
if (stepsText.includes('投射物伤害')) throw new Error('stat changes should be hidden by default: ' + stepsText);
await evaluate("document.querySelector('.deltas-toggle input').click(); true");
await sleep(300);
const stepsWithDeltas = await evaluate("document.querySelector('.step-list')?.innerText || ''");
if (!stepsWithDeltas.includes('投射物伤害')) throw new Error('toggle should reveal modifier deltas: ' + stepsWithDeltas);
await evaluate("document.querySelector('.deltas-toggle input').click(); true");
console.log('✓ modifier summary + steps, stat changes toggle works');

// 4) divide-by-10 preset => 800 projectiles
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'divide-ten'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const huge = await waitFor(
  "document.querySelector('.spell-summary')?.innerText.includes('800 个投射物') && document.querySelector('.spell-summary').innerText",
  60000,
  'divide summary',
);
if (!huge.includes('800 个投射物')) throw new Error('expected 800 projectiles, got: ' + huge);
const query = await evaluate('location.search');
if (!query.includes('DIVIDE_10')) throw new Error('share URL missing DIVIDE_10: ' + query);
console.log('✓ divide-by-10 chain:', huge.replace(/\n/g, ' | '));

// 4b) wiki example: D10 + DAMAGE + LIGHT_BULLET => 11 damage modifiers, one don't-draw copy
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'divide-ten-damage'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor("(document.querySelector('.spell-summary')?.innerText || '').includes('伤害增强 ×11')", 60000, 'wiki example modifiers');
const wikiTree = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
if (!wikiTree.includes('禁抽')) throw new Error('tree missing the don\'t-draw copy: ' + wikiTree.slice(0, 400));
const wikiStory = await evaluate("document.querySelector('.step-list')?.innerText || ''");
if (!wikiStory.includes('牌库已空')) throw new Error('story missing empty-deck draws: ' + wikiStory.slice(0, 400));
if (!wikiStory.includes('禁抽')) throw new Error('story missing the don\'t-draw explanation: ' + wikiStory.slice(0, 400));
if (!wikiStory.includes('弃掉')) throw new Error('story missing discard steps: ' + wikiStory.slice(0, 400));
console.log('✓ wiki preload example rendered: 11× 伤害增强, 禁抽 explanation, discard steps');

// 5) in-game style tooltip on hover
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="COLOUR_RAINBOW"]'); el.scrollIntoView({ block: 'center' }); return true; })()`);
await sleep(300);
const box = await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="COLOUR_RAINBOW"]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
const tooltip = await waitFor("document.querySelector('.spell-tooltip')?.innerText || ''", 10000, 'tooltip');
const expected = ['彩虹闪光', '投射修正', '法力消耗', '0', '施放延迟', '-0.13', '找到实验性魔杖', '2,3,4,10', '0.1,0.1,0.1,0.2'];
for (const needle of expected) {
  if (!tooltip.includes(needle)) throw new Error(`tooltip missing "${needle}": ${tooltip.replace(/\n/g, ' | ')}`);
}
console.log('✓ tooltip matches the game card:', tooltip.replace(/\n/g, ' | ').slice(0, 140) + '…');

// 6) local data.wak import still works (engine receives the scripts)
await evaluate("document.querySelector('.use-local').click()");
await waitFor("!!document.querySelector('.import-panel input[type=file]')", 30000, 'import panel');
const doc = await send('DOM.getDocument', { depth: -1 });
const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
if (!input.nodeId) throw new Error('file input not found');
await send('DOM.setFileInputFiles', { files: [WAK, CSV], nodeId: input.nodeId });
const localStats = await waitFor(
  "(document.querySelector('.stats-bar')?.innerText || '').includes('data.wak') && document.querySelector('.stats-bar').innerText",
  180000,
  'local import',
);
await waitFor("!!document.querySelector('.shot-card')", 60000, 'simulation after local import');
console.log('✓ local import + engine restart:', localStats.replace(/\n/g, ' | '));

// 7) back to bundled + i18n toggle
await evaluate("document.querySelector('.use-bundled').click()");
await waitFor("(document.querySelector('.stats-bar')?.innerText || '').includes('内置')", 30000, 'back to bundled');
await evaluate("document.querySelector('.lang-switch').click()");
await sleep(300);
const titleEn = await evaluate("document.querySelector('h1').innerText");
if (titleEn !== 'Noita Wand Simulator') throw new Error('lang switch failed: ' + titleEn);
await evaluate("document.querySelector('.lang-switch').click()");
await sleep(300);
console.log('✓ i18n toggle works');

// 8) screenshots: the wiki preload example — tree view and the narrative below it
// reload first so the hover tooltip from step 5 cannot linger in the screenshots
await send('Page.reload', {});
await waitFor("(document.querySelector('.stats-bar')?.innerText || '').includes('422')", 60000, 'reload before screenshots');
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'divide-ten-damage'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor("(document.querySelector('.spell-summary')?.innerText || '').includes('伤害增强 ×11')", 60000, 'wiki example preset');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
await sleep(300);
const topShot = await send('Page.captureScreenshot', { format: 'png' });
const topPath = SHOT.replace(/\.png$/, '-top.png');
writeFileSync(topPath, Buffer.from(topShot.data, 'base64'));
console.log('✓ screenshot (layout):', topPath);
await evaluate("document.querySelector('.cast-result').scrollIntoView({ block: 'start' }); true");
await sleep(400);
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(screenshot.data, 'base64'));
console.log('✓ screenshot:', SHOT);

await evaluate("document.querySelector('.shot-steps')?.scrollIntoView({ block: 'start' }); true");
await sleep(400);
const stepsShot = await send('Page.captureScreenshot', { format: 'png' });
const stepsPath = SHOT.replace(/\.png$/, '-steps.png');
writeFileSync(stepsPath, Buffer.from(stepsShot.data, 'base64'));
console.log('✓ screenshot (narrative):', stepsPath);

if (consoleErrors.length > 0) console.warn('browser errors:', consoleErrors.slice(0, 10));
else console.log('✓ no browser console errors');

await fetch(`${CDP}/json/close/${target.id}`);
ws.close();
console.log('E2E_OK');
