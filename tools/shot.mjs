/* =========================================================
   tools/shot.mjs — 画面のスクリーンショットを とる（CDP）
   さきに Chrome を デバッグポートつきで きどうしておく:
     chrome --headless=new --remote-debugging-port=9222 about:blank

   node tools/shot.mjs <out.png> <url> <幅> <高さ> [待ちms] [手順...]
     手順は  CSSセレクタ（クリック）/ "EVAL:式" / "WAIT:ms"
   れい:
     node tools/shot.mjs park.png "http://localhost:8123/?dev=park" 390 844
   ========================================================= */
import { writeFileSync } from 'node:fs';

const [, , out, url, wArg, hArg, waitArg, ...clicks] = process.argv;
const W = +wArg || 390, H = +hArg || 844, WAIT = +waitArg || 900;

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) {
  page = await (await fetch('http://127.0.0.1:9222/json/new?about:blank')).json();
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
await new Promise((r) => { ws.onopen = r; });

const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 2, mobile: true,
});
const nav = await send('Page.navigate', { url });
console.error('navigate ->', JSON.stringify(nav.result || nav.error));
for (let i = 0; i < 40; i++) {
  await sleep(150);
  const r = await send('Runtime.evaluate', { expression: 'location.href + "|" + document.readyState', returnByValue: true });
  const v = r.result?.result?.value || '';
  if (v.startsWith('http') && v.endsWith('complete')) { console.error('loaded:', v); break; }
  if (i === 39) console.error('load timeout, last:', v);
}
await sleep(WAIT);

for (const c of clicks) {
  if (c.startsWith('WAIT:')) { await sleep(+c.slice(5)); continue; }
  const expr = c.startsWith('EVAL:')
    ? c.slice(5)
    : `(()=>{const e=document.querySelector(${JSON.stringify(c)});if(!e)return 'NOTFOUND';e.click();return 'OK';})()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  console.error('step', c.slice(0, 60), '->', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text));
  await sleep(600);
}

const errs = await send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__errs||[])', returnByValue: true,
});
const dbg = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({href:location.href,title:document.getElementById("title-screen").hidden,app:document.getElementById("app").hidden,piyos:document.getElementById("title-piyos").children.length,tab:window.GP&&GP.ui&&GP.ui.current})',
  returnByValue: true });
console.error('state:', dbg.result?.result?.value);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out, 'errors:', errs.result?.result?.value);
ws.close();
process.exit(0);
