// Quick UI inspection helper (dev only).
import { writeFileSync } from 'node:fs';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const PRESET = process.env.PRESET ?? 'tau-divide-chain';
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
    if (Date.now() - start > timeoutMs) throw new Error('timeout ' + url);
    await sleep(300);
  }
}

await waitForJson(`${CDP}/json/version`);
const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
};
const send = (method, params = {}) => {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
};
const evaluate = async (expression, awaitPromise = false) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception?.description));
  return result.result.value;
};
const waitFor = async (expression, timeoutMs, label) => {
  const start = Date.now();
  for (;;) {
    const value = await evaluate(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout ' + label);
    await sleep(300);
  }
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
await waitFor("document.readyState === 'complete' && location.href !== 'about:blank'", 60000, 'nav');
await evaluate("new Promise((r)=>{const q=indexedDB.deleteDatabase('noita-wand-sim');q.onsuccess=q.onerror=q.onblocked=()=>r(true)})", true);
await evaluate('localStorage.clear(); true');
await send('Page.reload');
await sleep(1000);
await waitFor("(document.querySelector('.stats-bar')?.innerText || '').includes('422')", 60000, 'data');
await waitFor("document.querySelectorAll('.spell-card').length > 100", 60000, 'spell cards');
await evaluate(`(() => { const s = document.querySelector('.preset-select'); s.value = ${JSON.stringify(PRESET)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await waitFor("(document.querySelector('.spell-summary')?.innerText || '').includes('×32')", 60000, 'tau summary');
await sleep(600);

const info = await evaluate(`(() => {
  const text = (sel) => document.querySelector(sel)?.innerText || '';
  const tree = text('.shot-tree');
  const story = text('.step-list');
  const piles = text('.piles');
  return {
    summary: text('.spell-summary'),
    treeDiscards: (tree.match(/弃牌「[^」]+」/g) || []),
    treeTail: tree.split('\\n').slice(-14),
    storyDiscards: (story.match(/弃掉「[^」]+」/g) || []),
    storyHasNoCopies: story.includes('没有可复制'),
    storyTail: story.split('\\n').slice(-12),
    piles,
  };
})()`);
console.log(JSON.stringify(info, null, 2));

await evaluate("document.querySelector('.cast-result').scrollIntoView({block:'start'}); true");
await sleep(300);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.env.SHOT_PATH ?? './inspect.png', Buffer.from(shot.data, 'base64'));

await evaluate("document.querySelector('.step-list .step-discard')?.scrollIntoView({block:'center'}); true");
await sleep(300);
const discardShot = await send('Page.captureScreenshot', { format: 'png' });
const base = process.env.SHOT_PATH ?? './inspect.png';
writeFileSync(base.replace(/\.png$/, '-discard.png'), Buffer.from(discardShot.data, 'base64'));

await evaluate("document.querySelector('.piles')?.scrollIntoView({block:'center'}); true");
await sleep(300);
const pilesShot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(base.replace(/\.png$/, '-piles.png'), Buffer.from(pilesShot.data, 'base64'));

await fetch(`${CDP}/json/close/${target.id}`);
ws.close();
