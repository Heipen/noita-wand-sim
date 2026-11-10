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
const stats = await waitFor("document.querySelector('.count')?.innerText || ''", 60000, 'bundled spell count');
console.log('✓ bundled data:', stats.replace(/\n/g, ' | '));
if (!/422/.test(stats)) throw new Error('expected 422 spells');
const footerInfo = await evaluate(
  "({ href: document.querySelector('.app-footer a')?.href || '', text: document.querySelector('.app-footer')?.innerText || '' })",
);
if (!footerInfo.href.includes('github.com/Heipen/noita-wand-sim')) throw new Error('footer repo link missing: ' + JSON.stringify(footerInfo));
if (!footerInfo.text.includes('DSH') || !footerInfo.text.includes('Star')) throw new Error('footer attribution/star note missing: ' + footerInfo.text);

// 2) default trigger wand -> cast tree (worker engine)
const shotText = await waitFor("document.querySelector('.shot-card')?.innerText || ''", 60000, 'first shot');
console.log('✓ cast tree:', (await evaluate("document.querySelector('.shot-tree')?.innerText")).replace(/\n/g, ' | '));
if (!shotText.includes('第 1 次施法')) throw new Error('missing shot header');
const summaryText = await evaluate("document.querySelector('.spell-summary')?.innerText || ''");
if (!summaryText.includes('共 2 个投射物')) throw new Error('expected summary with 2 projectiles, got: ' + summaryText);
const treeText = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
for (const needle of ['抽到并执行「触发火花弹」', '开启命中触发', '抽到并执行「炸弹」', '弃牌']) {
  if (!treeText.includes(needle)) throw new Error(`cast tree missing ${needle}: ${treeText}`);
}
if (treeText.includes('生成投射物')) throw new Error('tree should not have a separate projectile line: ' + treeText);

// 3) click a spell to fill the next empty slot
const filledBefore = await evaluate("document.querySelectorAll('.wand-slot.filled').length");
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="DAMAGE"]'); el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
await waitFor(`document.querySelectorAll('.wand-slot.filled').length === ${filledBefore + 1}`, 15000, 'slot filled');
console.log('✓ click-to-add works, filled slots:', await evaluate("document.querySelectorAll('.wand-slot.filled').length"));

// 3b) modifier summary (icons + tooltips) + casting steps; stat-change chips hidden until toggled on
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'double-damage'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor(
  "[...document.querySelectorAll('.summary-mod')].some((el) => (el.title || '').includes('伤害增强'))",
  60000,
  'modifier summary',
);
const summaryTitles = await evaluate(
  "({ proj: document.querySelector('.summary-proj')?.title || '', mods: [...document.querySelectorAll('.summary-mod')].map((el) => el.title) })",
);
if (summaryTitles.proj.includes('火花弹') === false) throw new Error('summary projectile tooltip missing name: ' + JSON.stringify(summaryTitles));
if (!summaryTitles.mods.some((title) => title.includes('伤害增强') && title.includes('×1')))
  throw new Error('summary modifier tooltip missing name/count: ' + JSON.stringify(summaryTitles));
const summaryChips = await evaluate(
  "[...document.querySelectorAll('.summary-state-chip')].map((el) => el.innerText)",
);
if (!summaryChips.some((text) => text.includes('伤害'))) {
  throw new Error('summary projectile card should include shot-state values: ' + JSON.stringify(summaryChips));
}
if ((await evaluate("document.querySelector('.state-list')?.innerText || ''")) !== '') {
  throw new Error('the separate shot-state panel should be gone');
}
const treeSlots = await evaluate("document.querySelectorAll('.tree-slot').length");
if (treeSlots === 0) throw new Error('tree should label spells with wand slot numbers');
const treeDeltasBefore = await evaluate("document.querySelectorAll('.tree-delta').length");
if (treeDeltasBefore !== 0) throw new Error('stat changes should be hidden by default in the tree');
await evaluate("document.querySelector('input[data-toggle=deltas]').click(); true");
await sleep(300);
if ((await evaluate("document.querySelectorAll('.tree-delta').length")) === 0) throw new Error('toggle should reveal stat deltas in the tree');
await evaluate("document.querySelector('input[data-toggle=deltas]').click(); true");
console.log('✓ modifier summary icons + tree slot numbers + stat toggle');

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
await waitFor(
  "[...document.querySelectorAll('.summary-mod')].some((el) => (el.title || '').includes('伤害增强') && (el.title || '').includes('×11'))",
  60000,
  'wiki example modifiers',
);
const wikiTree = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
if (!wikiTree.includes('禁抽')) throw new Error('tree missing the don\'t-draw copy: ' + wikiTree.slice(0, 400));
const repeatBadge = await evaluate("(document.querySelector('.tree-repeat')?.innerText || '')");
if (!/×\d+/.test(repeatBadge)) throw new Error('tree should fold repeated siblings, got badge: ' + repeatBadge);
console.log('✓ wiki preload example rendered: 11× 伤害增强, 禁抽, repeat folding');

// 4c) Tau + divide chain: the first copied divide wipes the deck, the second copies nothing
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'tau-divide-chain'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const tauSummary = await waitFor(
  "[...document.querySelectorAll('.summary-proj')].some((el) => (el.title || '').includes('火花弹') && el.innerText.includes('×32')) && 'tau ok'",
  60000,
  'tau divide chain summary',
);
if (tauSummary !== 'tau ok') throw new Error('tau chain should make 32 spark bolts');
const tauTree = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
if (!tauTree.includes('未复制任何法术')) throw new Error('tree should mark the empty copied divide: ' + tauTree.slice(0, 600));
const tauPiles = await evaluate("document.querySelector('.piles')?.innerText || ''");
if (!tauPiles.includes('本次施法弃牌') || !tauPiles.includes('充能后会回到牌库')) {
  throw new Error('piles should list the cards discarded during the cast: ' + tauPiles);
}
console.log('✓ Tau + divide chain: 32 spark bolts, deck wiped, second copy empty');

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
await sleep(250);
await evaluate(`(() => {
  document.querySelector('.cast-result').scrollIntoView({ block: 'start' });
  const sticky = document.querySelector('.wand-sticky');
  window.scrollBy(0, -((sticky?.offsetHeight || 0) + 16));
  return true;
})()`);
await sleep(350);
const tauShot = await send('Page.captureScreenshot', { format: 'png' });
const tauPath = SHOT.replace(/\.png$/, '-tau.png');
writeFileSync(tauPath, Buffer.from(tauShot.data, 'base64'));
console.log('✓ screenshot (tau chain):', tauPath);

await evaluate(`(() => {
  const badges = [...document.querySelectorAll('.tree-badge')];
  const empty = badges.find((el) => el.textContent.includes('未复制任何法术'));
  empty?.scrollIntoView({ block: 'center' });
  return true;
})()`);
await sleep(350);
const tauEmptyShot = await send('Page.captureScreenshot', { format: 'png' });
const tauEmptyPath = SHOT.replace(/\.png$/, '-tau-empty.png');
writeFileSync(tauEmptyPath, Buffer.from(tauEmptyShot.data, 'base64'));
console.log('✓ screenshot (empty copied divide):', tauEmptyPath);

// 4c) fold toggle + whole-tree collapse
const foldedNodes = await evaluate("document.querySelectorAll('.tree-action').length");
await evaluate("document.querySelector('input[data-toggle=fold]').click(); true");
await sleep(300);
const unfoldedNodes = await evaluate("document.querySelectorAll('.tree-action').length");
if (unfoldedNodes <= foldedNodes) throw new Error('unfolding repeats should show more nodes');
if ((await evaluate("document.querySelectorAll('.tree-repeat').length")) !== 0) throw new Error('repeat badges should disappear when unfolded');
await evaluate("document.querySelector('input[data-toggle=fold]').click(); true");
await sleep(300);
await evaluate("document.querySelector('.section-toggle').click(); true");
await sleep(200);
if ((await evaluate("document.querySelectorAll('.tree-root').length")) !== 0) throw new Error('tree should collapse entirely');
await evaluate("document.querySelector('.section-toggle').click(); true");
await sleep(200);
if ((await evaluate("document.querySelectorAll('.tree-root').length")) === 0) throw new Error('tree should expand again');
console.log('✓ repeat folding toggle and whole-tree collapse work');

// 4c2) clicking the repeat count expands that folded group (tree), and story counts are clickable too
const repeatBefore = await evaluate("document.querySelectorAll('.tree-action').length");
await evaluate("document.querySelector('.tree-repeat').click(); true");
await sleep(250);
const repeatExpanded = await evaluate("document.querySelectorAll('.tree-action').length");
if (repeatExpanded <= repeatBefore) throw new Error('clicking ×N should expand the repeated tree group');
await evaluate("document.querySelector('.tree-repeat').click(); true");
await sleep(250);
const repeatCollapsed = await evaluate("document.querySelectorAll('.tree-action').length");
if (repeatCollapsed !== repeatBefore) throw new Error('clicking ×N again should collapse it');
console.log('✓ repeat counts expand and collapse groups in the tree');

// 4d) compact picker without inner scroll, sticky spell bar
const layoutInfo = await evaluate(`(() => {
  const grid = document.querySelector('.picker-grid');
  const stickyBar = document.querySelector('.wand-sticky');
  const editor = document.querySelector('.wand-editor');
  return {
    pickerOverflow: grid ? getComputedStyle(grid).overflowY : 'missing',
    stickyPosition: stickyBar ? getComputedStyle(stickyBar).position : 'missing',
    editorPosition: editor ? getComputedStyle(editor).position : 'missing',
    englishSubtitles: document.querySelectorAll('.spell-card-compact .spell-subtitle').length,
    compactBadges: document.querySelectorAll('.spell-card-compact .badge').length,
    slotNumbers: document.querySelectorAll('.wand-slot .slot-number').length,
    summaryZones: document.querySelectorAll('.summary-projectile-zone, .summary-modifier-zone').length,
    pileTexts: [...document.querySelectorAll('.pile-chip')].filter((el) => el.innerText.trim().length > 0).length,
  };
})()`);
if (layoutInfo.pickerOverflow !== 'visible') throw new Error('picker should not have an inner scroll: ' + JSON.stringify(layoutInfo));
if (layoutInfo.stickyPosition !== 'sticky') throw new Error('only the wand spells bar should be sticky: ' + JSON.stringify(layoutInfo));
if (layoutInfo.editorPosition === 'sticky') throw new Error('the whole wand editor should no longer be sticky: ' + JSON.stringify(layoutInfo));
if (layoutInfo.englishSubtitles !== 0) throw new Error('compact spell cards should hide the English subtitle');
if (layoutInfo.compactBadges !== 0) throw new Error('compact spell cards should hide mana/type badges');
if (layoutInfo.slotNumbers === 0) throw new Error('wand slots should be numbered');
if (layoutInfo.summaryZones === 0) throw new Error('summary should separate projectile/modifier zones');
if (layoutInfo.pileTexts !== 0) throw new Error('pile chips should be icons only');
console.log('✓ compact picker, sticky spell bar, icon piles, summary zones');

// 4e) capacity above 26, clearing keeps wand stats, saving a named preset
const setNumberInput = `(index, value) => {
  const input = document.querySelectorAll('.wand-stats input[type=number]')[index];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
}`;
await evaluate(`(${setNumberInput})(1, 26); true`);
await waitFor("document.querySelectorAll('.wand-slots .wand-slot').length === 26", 10000, 'capacity 26 slots');
const slotRows = await evaluate(`(() => {
  const tops = [...document.querySelectorAll('.wand-slots .wand-slot')].map((el) => Math.round(el.getBoundingClientRect().top));
  return new Set(tops).size;
})()`);
if (slotRows !== 1) throw new Error('26 wand slots should fit in one row, got rows: ' + slotRows);
await evaluate(`(${setNumberInput})(1, 40); true`);
await waitFor("document.querySelectorAll('.wand-slots .wand-slot').length === 40", 10000, 'capacity 40 slots');
// numeric inputs must allow being fully cleared while editing, then restore/clamp on blur
const clearedDraft = await evaluate(`(() => {
  const input = document.querySelectorAll('.wand-stats input[type=number]')[1];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  input.focus();
  setter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`);
if (clearedDraft !== '') throw new Error('number input should allow an empty draft while focused');
await evaluate("document.querySelectorAll('.wand-stats input[type=number]')[1].blur(); true");
await sleep(200);
const restoredDraft = await evaluate("document.querySelectorAll('.wand-stats input[type=number]')[1].value");
if (restoredDraft !== '40') throw new Error('empty draft should be restored/clamped on blur, got: ' + restoredDraft);
const statsBefore = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('.wand-stats input[type=number]')];
  return inputs.map((input) => input.value);
})()`);
const clearButtons = await evaluate(
  "[...document.querySelectorAll('.wand-toolbar button')].findIndex((el) => el.innerText.includes('清空魔杖'))",
);
await evaluate(`document.querySelectorAll('.wand-toolbar button')[${clearButtons}].click(); true`);
await sleep(300);
const statsAfter = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('.wand-stats input[type=number]')];
  return inputs.map((input) => input.value);
})()`);
if (JSON.stringify(statsBefore) !== JSON.stringify(statsAfter)) throw new Error('clearing must keep wand stats: ' + JSON.stringify({ statsBefore, statsAfter }));
if ((await evaluate("document.querySelectorAll('.wand-slots .wand-slot.filled').length")) !== 0) throw new Error('clearing should empty the wand slots');
if (statsAfter[1] !== '40') throw new Error('capacity should stay 40 after clearing');

await evaluate(`(() => {
  const input = document.querySelector('.wand-name');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '测试预设');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const saveIndex = await evaluate(
  "[...document.querySelectorAll('.wand-toolbar button')].findIndex((el) => el.innerText.includes('保存为预设'))",
);
await evaluate(`document.querySelectorAll('.wand-toolbar button')[${saveIndex}].click(); true`);
await sleep(400);
const presetOptions = await evaluate("[...document.querySelectorAll('.preset-select option')].map((o) => o.textContent)");
if (!presetOptions.some((text) => text.includes('测试预设'))) throw new Error('saved preset missing: ' + JSON.stringify(presetOptions));
await send('Page.reload');
await sleep(700);
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'reload after preset save');
const presetOptionsAfterReload = await evaluate("[...document.querySelectorAll('.preset-select option')].map((o) => o.textContent)");
if (!presetOptionsAfterReload.some((text) => text.includes('测试预设'))) throw new Error('saved preset did not persist: ' + JSON.stringify(presetOptionsAfterReload));
console.log('✓ capacity >26, clear keeps stats, named preset saved and persisted');

// restore a wand with spells for the remaining checks
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'trigger-bomb'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor("!!document.querySelector('.shot-card')", 60000, 'wand restored after reload');

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
  "!!document.querySelector('.use-bundled') && (document.querySelector('.count')?.innerText || '')",
  180000,
  'local import',
);
await waitFor("!!document.querySelector('.shot-card')", 60000, 'simulation after local import');
console.log('✓ local import + engine restart:', localStats.replace(/\n/g, ' | '));

// 7) back to bundled + i18n toggle
await evaluate("document.querySelector('.use-bundled').click()");
await waitFor("!!document.querySelector('.use-local')", 30000, 'back to bundled');
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
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'reload before screenshots');
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = 'divide-ten-damage'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor(
  "[...document.querySelectorAll('.summary-mod')].some((el) => (el.title || '').includes('伤害增强') && (el.title || '').includes('×11'))",
  60000,
  'wiki example preset',
);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
await sleep(300);
const topShot = await send('Page.captureScreenshot', { format: 'png' });
const topPath = SHOT.replace(/\.png$/, '-top.png');
writeFileSync(topPath, Buffer.from(topShot.data, 'base64'));
console.log('✓ screenshot (layout):', topPath);
await evaluate(`(() => {
  document.querySelector('.cast-result').scrollIntoView({ block: 'start' });
  const sticky = document.querySelector('.wand-sticky');
  window.scrollBy(0, -((sticky?.offsetHeight || 0) + 16));
  return true;
})()`);
await sleep(400);
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(SHOT, Buffer.from(screenshot.data, 'base64'));
console.log('✓ screenshot:', SHOT);

if (consoleErrors.length > 0) console.warn('browser errors:', consoleErrors.slice(0, 10));
else console.log('✓ no browser console errors');

await fetch(`${CDP}/json/close/${target.id}`);
ws.close();
console.log('E2E_OK');
