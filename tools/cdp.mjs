/* =========================================================
   tools/cdp.mjs — headless chrome との つなぎ（CDP）
   tools/e2e.mjs・tools/e2e-online.mjs が つかう。

   まえもって headless chrome を --remote-debugging-port=9222 で
   きどう しておくこと（ポートは 環境変数 CDP_PORT で かえられる）。
   ========================================================= */
const DEFAULT_PORT = 9222;
const MOBILE_METRICS = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const STEP_WAIT_MS = 700;
const STEP_NAME_WIDTH = 34;
// ブラウザ拡張きのうの メッセージングノイズは ページの エラーではないので むしする
const NOISE = /Receiving end does not exist|message channel closed before a response/;

const isNoise = (text) => NOISE.test(text || '');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage(port) {
  const listUrl = `http://127.0.0.1:${port}/json/list`;
  try {
    const page = (await (await fetch(listUrl)).json()).find((x) => x.type === 'page');
    if (!page) throw new Error('page が ひとつも ない');
    return page;
  } catch (e) {
    throw new Error(`headless chrome に つなげない（${listUrl}）: ${e.message}`);
  }
}

function collectError(m, errs) {
  if (m.method === 'Runtime.exceptionThrown') {
    const text = m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '';
    if (!isNoise(text)) errs.push('EXC ' + text);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    if (!isNoise(m.params.entry.text)) errs.push('ERR ' + m.params.entry.text);
  }
}

function openSocket(wsUrl, errs) {
  const ws = new WebSocket(wsUrl);
  const pend = new Map();
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else collectError(m, errs);
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}

async function setUpPage(send) {
  // Log.enable は たまって いた ログも 送って くる。前の テストが のこした エラー（わざと 出した 401 など）を 数えない
  await send('Log.clear');
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', MOBILE_METRICS);
  // navigator.webdriver を true に する（テストの ページが 本物の 窓口へ つながない ように。js/net.js の enabled）
  await send('Emulation.setAutomationOverride', { enabled: true });
}

const makeEval = (send, errs) => async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    errs.push('EVAL ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return null;
  }
  return r.result?.result?.value;
};

const makeStep = (evalJs, errs, steps) => async (name, expr, wait = STEP_WAIT_MS) => {
  const before = errs.length;
  const v = await evalJs(expr);
  await sleep(wait);
  steps.push({ name, value: v, newErrors: errs.length - before });
  console.log(`  ${errs.length > before ? 'NG' : 'ok'}  ${name.padEnd(STEP_NAME_WIDTH)} ${JSON.stringify(v)}`);
};

/** → { send, evalJs, step, steps, errs, close }。スマホの 画面サイズで ひらく */
export async function connect(port = process.env.CDP_PORT || DEFAULT_PORT) {
  const page = await findPage(port);
  const errs = [];
  const steps = [];
  const { ws, send } = openSocket(page.webSocketDebuggerUrl, errs);
  await new Promise((r) => { ws.onopen = r; });
  await setUpPage(send);
  const evalJs = makeEval(send, errs);
  return { send, evalJs, step: makeStep(evalJs, errs, steps), steps, errs, close: () => ws.close() };
}
