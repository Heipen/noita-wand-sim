// End-to-end check for the simulator UI (Microsoft Edge headless + CDP).
//
// Verifies:
//  1. bundled data loads with zero setup (422 spells)
//  2. the engine worker simulates the default trigger wand and renders the cast tree
//  3. clicking a spell fills a wand slot and updates the result
//  4. dividing preset produces the known 800 projectiles
//  5. hovering a spell shows the in-game style tooltip (type / mana / cast delay / unlock / tier)
//  6. i18n toggle
//
// Usage: npm run e2e   (needs `vite preview` on :4173 and Edge with --remote-debugging-port=9222)

import { writeFileSync } from 'node:fs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
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

const APP_BASE = APP_URL.replace(/\?.*$/, '');

/** Load a wand through the share URL (built-in presets have been removed from the app). */
async function loadWand(spells, opts = {}) {
  const params = new URLSearchParams({
    a: String(opts.actionsPerRound ?? 1),
    l: String(opts.capacity ?? spells.length),
    r: String(opts.rechargeFrames ?? 40),
    d: String(opts.castDelayFrames ?? 0),
    c: String(opts.manaMax ?? 20000),
    m: String(opts.manaChargeSpeed ?? 2000),
    q: '0',
    v: '1',
    x: '0',
    s: spells.join(','),
  });
  await send('Page.navigate', { url: `${APP_BASE}?${params.toString()}` });
  await sleep(600);
  await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'wand page reload');
  await waitFor("!!document.querySelector('.shot-card')", 60000, 'wand shot after reload');
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
  "({ href: [...document.querySelectorAll('.app-footer a')].find((a) => a.href.includes('github.com/Heipen/noita-wand-sim'))?.href || '', mail: document.querySelector('.header-feedback')?.href || '', icon: document.querySelector('link[rel=icon]')?.href || '', visitors: [...document.querySelectorAll('.footer-visitors img')].map((img) => img.src), text: document.querySelector('.app-footer')?.innerText || '' })",
);
if (!footerInfo.href.includes('github.com/Heipen/noita-wand-sim')) throw new Error('footer repo link missing: ' + JSON.stringify(footerInfo));
if (footerInfo.mail !== 'mailto:heipen111@foxmail.com') throw new Error('header feedback mail link missing: ' + JSON.stringify(footerInfo));
if (footerInfo.visitors.length !== 2 || !footerInfo.visitors.every((src) => src.includes('api.visitorbadge.io'))) {
  throw new Error('footer should show today+total visitor counters: ' + JSON.stringify(footerInfo));
}
if (!footerInfo.visitors.some((src) => src.includes('today-'))) throw new Error('daily visitor counter missing: ' + JSON.stringify(footerInfo));
if (!footerInfo.text.includes('DSH') || !footerInfo.text.includes('Star')) throw new Error('footer attribution/star note missing: ' + footerInfo.text);
if (!footerInfo.icon.endsWith('/favicon.png')) throw new Error('digger favicon missing: ' + JSON.stringify(footerInfo));

// 1b) community aliases are searchable
const setSearch = `(value) => {
  const input = document.querySelector('.toolbar .search');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}`;
await evaluate(`(${setSearch})('遁入虚空'); true`);
await waitFor("document.querySelectorAll('.spell-card').length === 1 && document.querySelector('.spell-card')?.dataset.spellId === 'CESSATION'", 10000, 'alias search');
await evaluate(`(${setSearch})('红拳'); true`);
await waitFor("document.querySelector('.spell-card')?.dataset.spellId === 'DAMAGE'", 10000, 'community alias search');
await evaluate(`(${setSearch})(''); true`);
await waitFor("document.querySelectorAll('.spell-card').length > 400", 10000, 'alias search cleared');
console.log('✓ community aliases are searchable');

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

// 3a) desktop has no tap-to-place logic; mobile UA gets the tap flow for both slot types
const desktopUA = await evaluate('navigator.userAgent');
if ((await evaluate("document.querySelectorAll('.always-cast-tap-hint').length")) !== 0) {
  throw new Error('desktop should not show the mobile tap hint');
}
await evaluate("document.querySelector('.always-slot:not(.filled)').click(); true");
await sleep(200);
if ((await evaluate("document.querySelectorAll('.picker-target-hint, .always-slot.targeted').length")) !== 0) {
  throw new Error('desktop should not enter tap-to-place targeting');
}
const mobileUA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
await send('Emulation.setUserAgentOverride', { userAgent: mobileUA, platform: 'Android' });
await send('Page.reload');
await sleep(700);
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'mobile UA reload');
// ordinary wand slot: tap -> search visible -> choose spell
await evaluate("document.querySelector('.wand-slot[data-slot=\"2\"]').click(); true");
await waitFor("!!document.querySelector('.wand-slot[data-slot=\"2\"].targeted')", 10000, 'wand slot targeting');
const targetedStyle = await evaluate(`(() => {
  const el = document.querySelector('.wand-slot[data-slot="2"].targeted');
  const style = getComputedStyle(el);
  return { outline: style.outlineStyle, shadow: style.boxShadow };
})()`);
if (targetedStyle.outline === 'none' && targetedStyle.shadow === 'none') {
  throw new Error('selected spell slot needs a visible highlight: ' + JSON.stringify(targetedStyle));
}
await sleep(350);
const mobileSearch = await evaluate(`(() => {
  const input = document.querySelector('.toolbar .search');
  const sticky = document.querySelector('.wand-sticky').getBoundingClientRect();
  const rect = input.getBoundingClientRect();
  return { focused: document.activeElement === input, top: rect.top, stickyBottom: sticky.bottom };
})()`);
if (mobileSearch.focused) throw new Error('search field must not be focused (mobile keyboard): ' + JSON.stringify(mobileSearch));
if (mobileSearch.top < mobileSearch.stickyBottom - 1) throw new Error('search field should be scrolled below the sticky wand: ' + JSON.stringify(mobileSearch));
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="DAMAGE"]'); el.click(); return true; })()`);
await waitFor("!!document.querySelector('.wand-slot[data-slot=\"2\"].filled')", 10000, 'wand slot target filled');
// Always Cast slot: same tap flow, and the four slots stay on one row
await evaluate("document.querySelector('.always-slot:not(.filled)').click(); true");
await waitFor("!!document.querySelector('.always-slot.targeted')", 10000, 'always cast targeting');
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="DAMAGE"]'); el.click(); return true; })()`);
await waitFor("document.querySelectorAll('.always-slot.filled').length === 1", 10000, 'always cast filled');
const alwaysRows = await evaluate(
  "[...document.querySelectorAll('.always-slot')].map((el) => Math.round(el.getBoundingClientRect().top))",
);
if (new Set(alwaysRows).size !== 1) throw new Error('always cast slots must stay on one row: ' + JSON.stringify(alwaysRows));
// tapping elsewhere cancels targeting, with no reminder banner to dismiss
await evaluate("document.querySelector('.wand-slot[data-slot=\"2\"]').click(); true");
await waitFor("!!document.querySelector('.wand-slot[data-slot=\"2\"].targeted')", 10000, 'wand slot retarget');
await evaluate("document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
await waitFor("document.querySelectorAll('.wand-slot.targeted').length === 0", 10000, 'out-of-picker target cancelled');
await evaluate("document.querySelector('.always-slot:not(.filled)').click(); true");
await waitFor("!!document.querySelector('.always-slot.targeted')", 10000, 'always slot retarget');
await evaluate("document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
await waitFor("document.querySelectorAll('.always-slot.targeted').length === 0", 10000, 'out-of-picker always target cancelled');
if ((await evaluate("document.querySelectorAll('.picker-target-hint, .always-cast-tap-hint').length")) !== 0) {
  throw new Error('target reminder UI should be removed');
}
console.log('✓ mobile tap-to-target works for wand and Always Cast slots');
await send('Emulation.setUserAgentOverride', { userAgent: desktopUA, platform: 'Win32' });
await send('Page.reload');
await sleep(700);
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'desktop UA restore');
await waitFor("!!document.querySelector('.shot-card')", 60000, 'desktop shot after UA restore');

// 3b) modifier summary (icons + tooltips) + casting steps; stat-change chips hidden until toggled on
await loadWand(['DAMAGE', 'LIGHT_BULLET', 'LIGHT_BULLET'], {
  actionsPerRound: 2,
  capacity: 4,
  castDelayFrames: 20,
  rechargeFrames: 45,
  manaMax: 300,
  manaChargeSpeed: 150,
});
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
if (!summaryChips.some((text) => text.includes('投射物伤害 +10'))) {
  throw new Error('Damage Plus should display +10, not the raw internal 0.4: ' + JSON.stringify(summaryChips));
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

// clicking a tree step should show that step's deck/hand/discard state
await loadWand(['LIGHT_BULLET', 'LIGHT_BULLET', 'BOMB'], { capacity: 3 });
await waitFor("document.querySelectorAll('.tree-node[data-event-index]').length > 0", 60000, 'clickable tree steps');
const pilesBefore = await evaluate("document.querySelector('.piles-grid')?.innerText || ''");
await evaluate("document.querySelector('.tree-node[data-event-index] > .tree-line').click(); true");
await waitFor("!!document.querySelector('.tree-node[data-selected=\"true\"]')", 10000, 'selected tree step');
const pilesAfter = await evaluate("document.querySelector('.piles-grid')?.innerText || ''");
if (!pilesAfter || pilesAfter === pilesBefore) throw new Error('selecting a tree step should change the displayed piles');
if (!(await evaluate("document.body.innerText.includes('回到施法结束')"))) throw new Error('selected pile state should offer a reset action');
await evaluate("document.querySelector('.piles-reset')?.click(); true");
await waitFor("!document.querySelector('.tree-node[data-selected=\"true\"]')", 10000, 'pile selection reset');
const pilesReset = await evaluate("document.querySelector('.piles-grid')?.innerText || ''");
if (pilesReset !== pilesBefore) throw new Error('reset should restore the end-of-cast piles');
console.log('✓ tree step click shows per-step piles and resets');

// count only real projectiles (the wand ghost's image emitter is a visual effect), and show
// drawing utility spells among a projectile's modifiers
await loadWand(['SUMMON_WANDGHOST']);
const summonSummary = await waitFor("document.querySelector('.spell-summary')?.innerText || ''", 60000, 'summon wand summary');
if (!summonSummary.includes('共 1 个投射物')) throw new Error('summon wand should count 1 projectile: ' + summonSummary);
const summonTree = await evaluate("document.querySelector('.shot-tree')?.innerText || ''");
if (!summonTree.includes('共 1 发')) throw new Error('summon wand tree total should be 1: ' + summonTree);
await loadWand(['CASTER_CAST', 'LIGHT_BULLET']);
await waitFor(
  "[...document.querySelectorAll('.summary-mod')].some((el) => (el.title || '').includes('随心法术'))",
  60000,
  'utility spell shown as modifier',
);
console.log('✓ visual effects excluded; drawing utility spells listed as modifiers');

await loadWand(['BLOOD_TO_POWER', 'LIGHT_BULLET']);
await waitFor(
  "[...document.querySelectorAll('.summary-state-chip')].some((el) => el.innerText.includes('44%'))",
  60000,
  'blood to power formula chip',
);
const bloodChips = await evaluate("[...document.querySelectorAll('.summary-state-chip')].map((el) => el.innerText)");
if (bloodChips.some((text) => /投射物伤害 \+44(?!%)/.test(text))) {
  throw new Error('Blood to Power should not show a fake fixed +44 damage: ' + JSON.stringify(bloodChips));
}
console.log('✓ Blood/Gold to Power use formula notes instead of fixed player stats');

// 4) divide-by-10 chain => 800 projectiles
await loadWand(['DIVIDE_10', 'DIVIDE_10', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'], {
  capacity: 5,
  rechargeFrames: 80,
});
const huge = await waitFor(
  "document.querySelector('.spell-summary')?.innerText.includes('800 个投射物') && document.querySelector('.spell-summary').innerText",
  60000,
  'divide summary',
);
if (!huge.includes('800 个投射物')) throw new Error('expected 800 projectiles, got: ' + huge);
const treeTotal = await evaluate("document.querySelector('.tree-total')?.innerText || ''");
if (!treeTotal.includes('800')) throw new Error('tree header should show the projectile total: ' + treeTotal);
const query = await evaluate('location.search');
if (!query.includes('DIVIDE_10')) throw new Error('share URL missing DIVIDE_10: ' + query);

console.log('✓ divide-by-10 chain:', huge.replace(/\n/g, ' | '));

// 4b) wiki example: D10 + DAMAGE + LIGHT_BULLET => 11 damage modifiers, one don't-draw copy
await loadWand(['DIVIDE_10', 'DAMAGE', 'LIGHT_BULLET'], { capacity: 3 });
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
await loadWand(['TAU', 'DIVIDE_2', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'], { capacity: 5 });
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
  // let React commit the draft before blurring; NumberField clamps its draft on blur
  setTimeout(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    input.blur();
  }, 30);
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
// huge capacities must not make the sticky wand cover a small screen
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(200);
await evaluate(`(${setNumberInput})(1, 100); true`);
await waitFor("document.querySelectorAll('.wand-slots .wand-slot').length === 100", 10000, 'capacity 100 slots');
const mobileWand = await evaluate(`(() => {
  const sticky = document.querySelector('.wand-sticky');
  const slots = document.querySelector('.wand-slots');
  return {
    height: sticky.getBoundingClientRect().height,
    viewport: window.innerHeight,
    scrollWidth: slots.scrollWidth,
    clientWidth: slots.clientWidth,
    scrollHeight: slots.scrollHeight,
    clientHeight: slots.clientHeight,
    wrap: getComputedStyle(slots).flexWrap,
  };
})()`);
if (mobileWand.height > mobileWand.viewport * 0.6) throw new Error('sticky wand is too tall on mobile: ' + JSON.stringify(mobileWand));
if (mobileWand.wrap !== 'wrap') throw new Error('wand slots should wrap instead of horizontal scrolling: ' + JSON.stringify(mobileWand));
if (mobileWand.scrollWidth > mobileWand.clientWidth + 1) throw new Error('wand slots should not overflow horizontally: ' + JSON.stringify(mobileWand));
if (mobileWand.scrollHeight <= mobileWand.clientHeight) throw new Error('100 slots should be capped to a scrollable 3-row area: ' + JSON.stringify(mobileWand));
await evaluate(`(${setNumberInput})(1, 40); true`);
await waitFor("document.querySelectorAll('.wand-slots .wand-slot').length === 40", 10000, 'capacity back to 40');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(250);
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
await evaluate(`(() => {
  const input = document.querySelectorAll('.wand-stats input[type=number]')[1];
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  input.blur();
  return true;
})()`);
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
if ((await evaluate("document.querySelector('.wand-name').value")) !== '') throw new Error('clearing should also clear the wand name');

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
if ((await evaluate("document.querySelector('.wand-name').value")) !== '') throw new Error('saving a preset should clear the wand name');
const presetOptions = await evaluate("[...document.querySelectorAll('.preset-select option')].map((o) => o.textContent)");
if (!presetOptions.some((text) => text.includes('测试预设'))) throw new Error('saved preset missing: ' + JSON.stringify(presetOptions));
await send('Page.reload');
await sleep(700);
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'reload after preset save');
const presetOptionsAfterReload = await evaluate("[...document.querySelectorAll('.preset-select option')].map((o) => o.textContent)");
if (!presetOptionsAfterReload.some((text) => text.includes('测试预设'))) throw new Error('saved preset did not persist: ' + JSON.stringify(presetOptionsAfterReload));
console.log('✓ capacity >26, clear keeps stats, named preset saved and persisted');

// restore the default wand for the remaining checks
await send('Page.navigate', { url: APP_BASE });
await sleep(600);
await waitFor("document.querySelector('.count')?.innerText.includes('422')", 60000, 'default wand reload');
await waitFor("!!document.querySelector('.shot-card')", 60000, 'default wand shot');

// 5) in-game style tooltip on hover
await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="COLOUR_RAINBOW"]'); el.scrollIntoView({ block: 'center' }); return true; })()`);
await sleep(300);
const box = await evaluate(`(() => { const el = document.querySelector('.spell-card[data-spell-id="COLOUR_RAINBOW"]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
await waitFor("document.querySelector('.spell-tooltip')?.innerText.includes('修正效果')", 10000, 'tooltip effects');
const tooltip = await waitFor("document.querySelector('.spell-tooltip')?.innerText || ''", 10000, 'tooltip');
const expected = ['彩虹闪光', '投射修正', '法力消耗', '0', '施放延迟', '-0.13', '找到实验性魔杖', '法术等级', '对应等级生成权重', '修正效果'];
for (const needle of expected) {
  if (!tooltip.includes(needle)) throw new Error(`tooltip missing "${needle}": ${tooltip.replace(/\n/g, ' | ')}`);
}
const tierRows = await evaluate(
  "[...document.querySelectorAll('.tt-tier-table tr')].map((row) => [...row.querySelectorAll('td')].map((el) => el.innerText))",
);
if (JSON.stringify(tierRows) !== JSON.stringify([['2', '3', '4', '10'], ['0.1', '0.1', '0.1', '0.2']])) {
  throw new Error('tooltip tier/weight rows mismatch: ' + JSON.stringify(tierRows));
}
const tierColumnsAligned = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.tt-tier-table tr')].map((row) => [...row.querySelectorAll('td')].map((el) => Math.round(el.getBoundingClientRect().left)));
  return { rows, aligned: rows.length === 2 && rows[0].every((left, index) => Math.abs(left - rows[1][index]) <= 1) };
})()`);
if (!tierColumnsAligned.aligned) throw new Error('tooltip tier/weight columns should align vertically: ' + JSON.stringify(tierColumnsAligned));
console.log('✓ tooltip matches the game card:', tooltip.replace(/\n/g, ' | ').slice(0, 140) + '…');

// 7) i18n toggle
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
await loadWand(['DIVIDE_10', 'DAMAGE', 'LIGHT_BULLET'], { capacity: 3 });
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
