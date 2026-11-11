/* =========================================================
   tools/online-test.mjs — 窓口との やりとりの テスト（画面なし・node だけで うごく）

   js/net.js・js/backup.js などを vm で よみ、にせの localStorage・navigator・location・
   タイマーを わたして、にせ窓口（tools/mock-ranking-server.mjs を じぶんで きどう）へ
   ほんものの HTTP で つなぐ。本物の 窓口へは つながない（127.0.0.1 いがいへの fetch は 止めて 数える）。

   つかいかた: node tools/online-test.mjs
   ========================================================= */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { startMock, toFullWidth } from './test-helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_FILES = ['js/util.js', 'js/data.js', 'js/hex.js', 'js/state.js'];
const NET_CONFIG_FILE = 'js/netconfig.js';
const NET_FILES = ['js/net.js', 'js/backup.js'];
const EMPTY_CONFIG = "window.GP = window.GP || {}; GP.netConfig = Object.freeze({ baseUrl: '', board: '' });";
const GODOT_API = 'godot/scripts/net/ranking_api.gd';
const GODOT_BACKUP = 'godot/scripts/net/save_backup.gd';
const PAGE_FILE = 'index.html';
const SW_FILE = 'sw.js';
const BUILD_FILE = 'tools/build.mjs';
const EXPORT_NET = 'tools/export-net.mjs';
const PAGE_SCRIPT = /<script src="(js\/[^"]+)"><\/script>/g;
const SW_SCRIPT = /'\.\/(js\/[^']+)'/g;
const BUILD_LIST = /const JS = \[([\s\S]*?)\];/;
const BUILD_SCRIPT = /'(js\/[^']+)'|NET_CONFIG/g;
const BUILD_EMPTY_CONFIG = /const OFFLINE_NET_CONFIG = "[^"]*baseUrl: ''[^"]*";/;
const BUILD_ONLINE_SCRIPT = 'const onlineScript = scriptWith(read(NET_CONFIG));';
const BUILD_OFFLINE_SCRIPT = 'const offlineScript = scriptWith(OFFLINE_NET_CONFIG);';
const BUILD_STANDALONE_USES_ONLINE = /const standalone = `[^`]*\$\{onlineScript\}[^`]*`;/;
const BUILD_ARTIFACT_USES_OFFLINE = /const inlined = `[^`]*\$\{offlineScript\}[^`]*`;/;
const LOOPBACK = '127.0.0.1';
const HUMAN_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const HEADLESS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36';
const PAGE_ORIGIN = 'http://localhost:8123';
const OTHER_ORIGIN = 'http://localhost:8124';
const JSON_TYPE = 'application/json; charset=utf-8';
const ACAO = 'access-control-allow-origin';
const NODE_AUTO_HEADERS = ['date', 'connection', 'keep-alive', 'transfer-encoding', 'content-length'];
const ACCOUNT_KEY = 'gelpiyo-park-account-v1';
const REPLACED_KEY = 'gelpiyo-park-replaced-v1';
// 画面を こわす しかけ。ひかえの 中に あれば 読まない
const MARKUP = '<img src onerror=X>';
const DEEP_NEST = 20000;
const INHERITED_NAMES = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];
const REAL_HISTORY = [{ at: 1700000000000, score: 12345, levelTotal: 14, daysUsed: 7, dayLimit: 50, unitAvgLv: 3.5, defenseTotal: 100 }];
const KIB = 1024;
const SPEC = { timeout_ms: 15000, sendDelay_ms: 30000, retry_ms: 60000, maxBytes: 512 * KIB, keepaliveBytes: 60 * KIB, codeLength: 12 };
const RECOVER_LIMIT = 10;
const UNKNOWN_CODE = '2222-2222-2222';
const SMALL_DATA = '{"a":1}';
const HEX64 = /^[0-9a-f]{64}$/;
const FINISH_MARGIN_MS = 300;
// 時間切れが こわれた とき、node の fetch の 既定（5 分）まで 待たずに NG に する
const ABORT_GRACE_MS = 2000;
const MS_PER_SEC = 1000;
const RUN_PAYLOAD = {
  value: 1234, cleared: true, play_ms: 3500,
  detail: { levelTotal: 14, daysUsed: 7, dayLimit: 50, unitAvgLv: 3.5, defenseTotal: 100 },
};

/* ---------- けっかの あつめ ---------- */
const results = [];
const guard = { loopback: 0, blocked: 0 };
const check = (name, cond) => {
  results.push(!!cond);
  console.log(`  ${cond ? 'ok' : 'NG'}  ${name}`);
};
const section = (title) => console.log(`\n--- ${title} ---`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn) => {
  try { fn(); return false; } catch (e) { return true; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const giveUpAfter = async (ms) => {
  await wait(ms);
  return { ok: false, error: '(時間切れが きかない)', message: '' };
};

/* ---------- にせの ブラウザ ---------- */
function makeTimers() {
  const list = [];
  let seq = 0;
  const take = (ms) => {
    const i = list.findIndex((t) => t.ms === ms);
    return i < 0 ? null : list.splice(i, 1)[0];
  };
  return {
    list,
    setTimeout: (fn, ms) => { seq += 1; list.push({ id: seq, fn, ms }); return seq; },
    clearTimeout: (id) => { const i = list.findIndex((t) => t.id === id); if (i >= 0) list.splice(i, 1); },
    count: (ms) => list.filter((t) => t.ms === ms).length,
    fire: (ms) => { const t = take(ms); if (t) t.fn(); return !!t; },
  };
}

function makeStorage(map, broken, writes) {
  const guarded = (fn) => (...args) => {
    if (broken) throw new Error('SecurityError (test)');
    return fn(...args);
  };
  return {
    getItem: guarded((k) => (map.has(k) ? map.get(k) : null)),
    setItem: guarded((k, v) => { writes.push(k); map.set(k, String(v)); }),
    removeItem: guarded((k) => { map.delete(k); }),
  };
}

const callRecord = (url, init) => ({
  path: new URL(url).pathname, method: init.method, headers: Object.keys(init.headers || {}).sort(),
  auth: (init.headers || {}).Authorization, hasBody: 'body' in init, keepalive: init.keepalive === true,
  hasCredentials: 'credentials' in init,
});

// 127.0.0.1 いがいへは 出さない（本物の 窓口へ つながない ための 安全ネット）
function makeFetch(log) {
  return async (url, init = {}) => {
    log.calls.push(callRecord(url, init));
    if (new URL(url).hostname !== LOOPBACK) { guard.blocked += 1; throw new TypeError('blocked (test)'); }
    guard.loopback += 1;
    if (log.failNext) { log.failNext = false; throw new TypeError('fetch failed (test)'); }
    if (log.fake) { const f = log.fake; log.fake = null; return new Response(JSON.stringify(f.body), { status: f.status }); }
    const res = await fetch(url, init);
    if (log.afterResponse) log.afterResponse();
    return res;
  };
}

function loadScripts(ctx, config, modules) {
  const run = (file) => runInContext(readFileSync(join(ROOT, file), 'utf8'), ctx, { filename: file });
  CORE_FILES.forEach(run);
  if (config === 'real') run(NET_CONFIG_FILE);
  if (config === 'empty') runInContext(EMPTY_CONFIG, ctx, { filename: 'empty-config' });
  if (modules) NET_FILES.forEach(run);
}

/** にせの ページを ひとつ つくる（＝ 端末 1 台ぶん） */
function makeWorld(opt = {}) {
  const { protocol = 'http:', webdriver = false, userAgent = HUMAN_UA, config = 'real', subtle = true, brokenStorage = false, modules = true } = opt;
  const store = opt.store || new Map();
  const timers = makeTimers();
  const net = { calls: [], failNext: false, fake: null, afterResponse: null };
  const warns = [];
  const writes = [];
  const ctx = createContext({
    console: { ...console, warn: (...args) => warns.push(args.map(String).join(' ')) },
    localStorage: makeStorage(store, brokenStorage, writes), fetch: makeFetch(net),
    navigator: { webdriver, userAgent }, location: { protocol }, crypto: subtle ? globalThis.crypto : {},
    TextEncoder, AbortController, URL, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
  });
  ctx.window = ctx;
  loadScripts(ctx, config, modules);
  return { GP: ctx.GP, store, timers, net, warns, writes };
}

// webdriver: true に して おく ＝ もし useTestServer が きかなくても 本物の 設定は 使われない
function onlineWorld(url, opt = {}) {
  const w = makeWorld({ webdriver: true, ...opt });
  w.GP.net.useTestServer(url);
  return w;
}

async function deviceWithAccount(url, name, opt = {}) {
  const w = onlineWorld(url, opt);
  const reg = await w.GP.net.register(name);
  w.GP.net.saveAccount(reg.data);
  return w;
}

const sampleSave = (extra = {}) => ({ v: 1, day: 3, res: { coin: 10 }, units: [], note: 'あいう', lastSeen: 1000, ...extra });
const sampleHistory = () => [{ at: 1, score: 123 }];
const writeSave = (w, save, history = sampleHistory()) => { w.GP.util.save(save); w.GP.util.saveHistory(history); };
const savePuts = (w) => w.net.calls.filter((c) => c.path === '/v1/save').length;
const lastCall = (w) => w.net.calls[w.net.calls.length - 1];

/* ---------- へんな 窓口 ---------- */
// /v1/players は JSON で ない 断り、events は 開催の 外、ほかは 返事を しない（時間切れの 確かめ用）
function startOddServer(board) {
  const server = createServer((req, res) => {
    if (req.url === '/v1/players') { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('oops'); }
    if (req.url === '/v1/challenge/events') {
      res.writeHead(200, { 'Content-Type': JSON_TYPE });
      res.end(JSON.stringify({ events: [{ active: false, boards: [{ board, minSec: 3 }] }, 'x', null] }));
    }
  });
  const stop = () => { server.closeAllConnections(); server.close(); };
  return new Promise((resolve) => {
    server.listen(0, LOOPBACK, () => resolve({ url: `http://${LOOPBACK}:${server.address().port}`, stop }));
  });
}

async function closedUrl() {
  const server = createServer(() => {});
  await new Promise((r) => { server.listen(0, LOOPBACK, r); });
  const url = `http://${LOOPBACK}:${server.address().port}`;
  await new Promise((r) => { server.close(r); });
  return url;
}

function rawRequest(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => reject(new Error(`${method} ${new URL(url).pathname}: ${e.message}`)));
    req.end(body);
  });
}

const mockState = async (url) => JSON.parse((await rawRequest(url + '/_test/state')).text);

/** Godot版の 文言の 表（const NAME := { "key": "text", ... }）。godot/ が 無い 環境では null */
function godotTexts(file, constName) {
  if (!existsSync(join(ROOT, file))) return null;
  const src = readFileSync(join(ROOT, file), 'utf8');
  const block = new RegExp(`const ${constName} := \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!block) return null;
  return Object.fromEntries(Array.from(block[1].matchAll(/"(\w+)":\s*"([^"]*)"/g), (m) => [m[1], m[2]]));
}

/* =========================================================
   つなぐか どうか
   ========================================================= */
function testEnabled() {
  section('つなぐか どうか（enabled の 3 条件）');
  const real = makeWorld().GP.net;
  check('設定あり・http・人の 操作 → つなぐ（https の 接続先）', real.enabled() && real.baseUrl().startsWith('https://') && !real.baseUrl().endsWith('/'));
  check('https の ページでも つなぐ', makeWorld({ protocol: 'https:' }).GP.net.enabled());
  check('file: は つながない', !makeWorld({ protocol: 'file:' }).GP.net.enabled());
  check('自動の 検査（navigator.webdriver）は つながない', !makeWorld({ webdriver: true }).GP.net.enabled());
  check('headless chrome（UA）は webdriver が false でも つながない', !makeWorld({ userAgent: HEADLESS_UA }).GP.net.enabled());
  check('UA が 読めなくても 落ちない', makeWorld({ userAgent: null }).GP.net.enabled());
  check('設定が 空（1ファイル版）は つながない', !makeWorld({ config: 'empty' }).GP.net.enabled());
  check('設定ファイルが 無くても 落ちずに つながない', !makeWorld({ config: 'none' }).GP.net.enabled());
  check('板の 名前は 設定から', real.board !== '' && makeWorld({ config: 'empty' }).GP.net.board === '');
}

async function testOffline() {
  section('オフライン');
  const w = makeWorld({ webdriver: true });
  const res = await w.GP.net.register('ぴよ');
  check('入口は {ok:false, error:"offline", message}', res.ok === false && res.error === 'offline' && typeof res.message === 'string');
  check('boardRules も offline', (await w.GP.net.boardRules()).error === 'offline');
  check('アカウントは 無い・保存も しない', w.GP.net.account() === null && w.GP.net.saveAccount({ deviceKey: 'k' }) === false && w.store.size === 0);
  writeSave(w, sampleSave());
  check('ひかえは off', (await w.GP.backup.sendNow()) === false && w.GP.backup.status() === 'off' && w.GP.backup.statusText() === '');
  check('1 回も 通信しない', w.net.calls.length === 0);
}

const BAD_TEST_URLS = [
  'https://127.0.0.1:9', 'http://example.com', 'http://127.0.0.1.example.com', 'http://localhost@example.com',
  'http://192.168.0.2:9', 'http://[::2]:9', 'ftp://localhost', 'localhost:9', '',
];

function testUseTestServer(mockUrl) {
  section('useTestServer');
  const port = new URL(mockUrl).port;
  const net = makeWorld({ webdriver: true }).GP.net;
  check('ループバック以外・http 以外は 例外', BAD_TEST_URLS.every((u) => throws(() => net.useTestServer(u))));
  check('例外の あとも つながない', !net.enabled());
  const accepted = ['127.0.0.1', 'localhost', '[::1]'].every((host) => {
    net.useTestServer(`http://${host}:${port}/x?y=1`);
    return net.baseUrl() === `http://${host}:${port}`;
  });
  check('127.0.0.1・localhost・[::1] は うける（パスと クエリは すてる）', accepted);
  check('よんだ あとは 自動の 検査でも つなぐ', net.enabled());
  const fileNet = makeWorld({ protocol: 'file:' }).GP.net;
  fileNet.useTestServer(mockUrl);
  check('file: では よんでも つながない', !fileNet.enabled());
}

/* =========================================================
   通信
   ========================================================= */
async function testHeaders(mockUrl) {
  section('ヘッダー');
  const w = onlineWorld(mockUrl);
  const reg = await w.GP.net.register('ヘッダー');
  await w.GP.net.rename(reg.data.deviceKey, 'ヘッダー2');
  await w.GP.net.boardRules();
  const [post, patch, get] = w.net.calls;
  check('本文あり・鍵なし → Content-Type だけ', same(post.headers, ['Content-Type']) && post.method === 'POST' && post.hasBody);
  check('本文あり・鍵あり → Authorization と Content-Type だけ', same(patch.headers, ['Authorization', 'Content-Type']) && patch.method === 'PATCH');
  check('Authorization は Bearer <鍵>', patch.auth === 'Bearer ' + reg.data.deviceKey);
  check('GET は ヘッダーなし・本文なし', same(get.headers, []) && get.method === 'GET' && !get.hasBody);
  check('credentials・keepalive を 付けない', w.net.calls.every((c) => !c.hasCredentials && !c.keepalive));
}

async function testResults(mockUrl) {
  section('成功の 返り値');
  const net = onlineWorld(mockUrl).GP.net;
  const reg = await net.register('かたち');
  check('register → {ok:true, data:{playerId,name,deviceKey,recoveryCode}}',
    reg.ok === true && ['playerId', 'name', 'deviceKey', 'recoveryCode'].every((k) => typeof reg.data[k] === 'string' && reg.data[k] !== ''));
  const key = reg.data.deviceKey;
  check('rename → 名前が かわる', (await net.rename(key, 'かたち2')).data.name === 'かたち2');
  const code = await net.reissueCode(key);
  check('reissueCode → あたらしい コード', code.ok && code.data.recoveryCode !== reg.data.recoveryCode && net.code.isValid(net.code.normalized(code.data.recoveryCode)));
  const rules = await net.boardRules();
  check('boardRules → 板の 決まり（minSec）', rules.ok && rules.data.board === net.board && rules.data.minSec > 0);
  const put = await net.putBackup(key, SMALL_DATA);
  check('putBackup → {ok,size,updatedAt}', put.ok && put.data.ok === true && put.data.size === SMALL_DATA.length && typeof put.data.updatedAt === 'string');
  const saved = (await mockState(mockUrl)).saves[reg.data.playerId];
  check('窓口が 受けた data は その まま', saved.data === SMALL_DATA && saved.puts === 1);
}

const refusalName = async (promise) => {
  const res = await promise;
  return res.ok === false && typeof res.message === 'string' ? res.error : '(断りの 形で ない)';
};

async function testRefusals(mockUrl) {
  section('断りの 返り値（{ok:false, error, message}）');
  const net = onlineWorld(mockUrl).GP.net;
  const key = (await net.register('ことわり')).data.deviceKey;
  const run = await net.startRun(key);
  const cases = [
    ['bad_name', net.register('')], ['no_key', net.rename('', 'a')], ['bad_key', net.rename('x', 'a')],
    ['bad_code', net.recover('ABC')], ['code_not_found', net.recover(UNKNOWN_CODE)],
    ['bad_data', net.putBackup(key, 'not json')], ['too_large', net.putBackup(key, JSON.stringify('x'.repeat(SPEC.maxBytes)))],
    ['too_short', net.finishRun(key, run.data.runId, RUN_PAYLOAD)], ['no_run', net.finishRun(key, 'r_none', RUN_PAYLOAD)],
  ];
  const got = await Promise.all(cases.map(([, promise]) => refusalName(promise)));
  cases.forEach(([name], i) => check(`断り ${name}`, got[i] === name));
}

async function testTooMany(mockUrl) {
  const net = onlineWorld(mockUrl).GP.net;
  const tries = Array.from({ length: RECOVER_LIMIT + 1 });
  const errors = await tries.reduce(async (acc) => [...(await acc), (await net.recover(UNKNOWN_CODE)).error], Promise.resolve([]));
  check('断り too_many（10 回 ためした あと）', errors.slice(0, RECOVER_LIMIT).every((e) => e === 'code_not_found') && errors[RECOVER_LIMIT] === 'too_many');
}

async function testNetworkFailures(mockUrl, oddUrl) {
  section('通信不能・時間切れ');
  const w = onlineWorld(mockUrl);
  w.net.failNext = true;
  const down = await w.GP.net.register('x');
  check('通信不能 → network（パスつきの message）', down.ok === false && down.error === 'network' && down.message.includes('/v1/players'));
  check('終わったら 時間切れの タイマーを 残さない', w.timers.list.length === 0);
  const refused = await onlineWorld(await closedUrl()).GP.net.register('x');
  check('つながらない ポート → network', refused.ok === false && refused.error === 'network');
  const odd = onlineWorld(oddUrl);
  check('JSON で ない 断り → http_503', (await refusalName(odd.GP.net.register('x'))) === 'http_503');
  check('開催の 外 → not_open', (await refusalName(odd.GP.net.boardRules())) === 'not_open');
  const pending = odd.GP.net.rename('k', 'x');
  check('時間切れは 15 秒', odd.GP.net.TIMEOUT_MS === SPEC.timeout_ms && odd.timers.count(SPEC.timeout_ms) === 1);
  odd.timers.fire(SPEC.timeout_ms);
  const late = await Promise.race([pending, giveUpAfter(ABORT_GRACE_MS)]);
  check('時間切れ → network', late.ok === false && late.error === 'network' && late.message.includes('じかんぎれ'));
}

function testExplain() {
  section('explain');
  const net = makeWorld().GP.net;
  const known = ['network', 'offline', 'bad_key', 'code_not_found', 'bad_code', 'too_many', 'too_large'];
  check('知って いる 断りは きまった 文言', known.every((e) => !net.explain({ error: e, message: 'm' }).includes(`（${e}）`)));
  check('知らない 断りは「説明（名前）」', net.explain({ error: 'zzz', message: 'せつめい' }) === 'せつめい（zzz）');
  check('constructor など どの オブジェクトにも ある 名前の 断りも「説明（名前）」', INHERITED_NAMES.every((e) => net.explain({ error: e, message: 'm' }) === `m（${e}）`));
  const godot = godotTexts(GODOT_API, 'ERROR_TEXT');
  if (godot) check('Godot版の ERROR_TEXT と 同じ 文言', known.length === Object.keys(godot).length && known.every((e) => net.explain({ error: e }) === godot[e]));
}

/* =========================================================
   アカウント・ひきつぎコード
   ========================================================= */
async function testAccount(mockUrl, otherUrl) {
  section('アカウント');
  const w = onlineWorld(mockUrl);
  const net = w.GP.net;
  check('はじめは 無い（null）', net.account() === null);
  const reg = await net.register('アカウント');
  check('保存できる', net.saveAccount(reg.data) === true);
  const acc = net.account();
  check('読める・server は いまの 接続先', !!acc && acc.deviceKey === reg.data.deviceKey && acc.recoveryCode === reg.data.recoveryCode && acc.server === mockUrl);
  check('セーブとは べつの キー', net.ACCOUNT_KEY === ACCOUNT_KEY && same(Array.from(w.store.keys()), [ACCOUNT_KEY]));
  net.useTestServer(otherUrl);
  check('接続先が ちがえば 無い あつかい', net.account() === null);
  const real = makeWorld({ store: w.store });
  check('にせ窓口の アカウントは 本物の 接続先でも 無い あつかい', real.GP.net.enabled() && real.GP.net.account() === null && real.net.calls.length === 0);
}

function testAccountEdges(mockUrl) {
  const w = onlineWorld(mockUrl);
  const net = w.GP.net;
  const stored = (text) => { w.store.set(ACCOUNT_KEY, text); return net.account(); };
  check('deviceKey が 空なら 無い', stored(JSON.stringify({ deviceKey: '', server: mockUrl })) === null);
  check('server が 無ければ 無い', stored(JSON.stringify({ deviceKey: 'k' })) === null);
  check('こわれた JSON でも 落ちずに 無い', stored('{こわれた') === null && stored('[]') === null);
  check('オブジェクトで ない ものは 保存しない', net.saveAccount(null) === false && net.saveAccount('x') === false);
  const broken = onlineWorld(mockUrl, { brokenStorage: true });
  check('localStorage が 使えない → 無い・保存は false（例外なし）', broken.GP.net.account() === null && broken.GP.net.saveAccount({ deviceKey: 'k' }) === false);
  check('その とき キー名つきで console.warn', broken.warns.length === 2 && broken.warns.every((t) => t.includes(ACCOUNT_KEY)));
  const made = net.accountFromRecover({ playerId: 'p', name: 'n', deviceKey: 'k', save: null }, 'C');
  check('accountFromRecover → {playerId,name,deviceKey,recoveryCode}', same(made, { playerId: 'p', name: 'n', deviceKey: 'k', recoveryCode: 'C' }));
}

function testCode() {
  section('ひきつぎコードの 道具');
  const code = makeWorld().GP.net.code;
  const want = 'ABCDEFGH2345';
  const inputs = ['ABCD-EFGH-2345', 'abcd-efgh-2345', 'abcdefgh2345', toFullWidth('ABCD-EFGH-2345'), toFullWidth('abcdefgh2345'), ' abcd　efgh 2345\n'];
  check('normalized: 小文字・全角・ハイフンなし・空白まじり', inputs.every((s) => code.normalized(s) === want));
  check('normalized: 大文字に すると 2 文字に なる 字は すてる', code.normalized('ßABCD') === 'ABCD');
  check('isValid: 12 文字の 正しい コード', code.isValid(want) && code.LENGTH === SPEC.codeLength);
  check('isValid: 0・O・1・I は だめ', ['0', 'O', '1', 'I'].every((c) => !code.isValid(want.slice(1) + c)));
  check('isValid: 長さが ちがえば だめ', !code.isValid(want.slice(1)) && !code.isValid(want + '2') && !code.isValid('') && !code.isValid(null));
  check('formatted: 4 文字ごとに -', code.formatted(want) === 'ABCD-EFGH-2345' && code.formatted('') === '');
}

/* =========================================================
   ひかえの かたち・印
   ========================================================= */
function testBundle() {
  section('pack・unpack');
  const { backup, net } = makeWorld().GP;
  const text = backup.pack(sampleSave(), sampleHistory());
  check('pack → {format:1, save, history}', same(JSON.parse(text), { format: 1, save: sampleSave(), history: sampleHistory() }));
  check('pack: セーブが オブジェクトで なければ 空', [null, undefined, 'x', 1, []].every((v) => backup.pack(v, []) === ''));
  check('pack: せいせきが 配列で なければ 空の 配列', same(JSON.parse(backup.pack({ v: 1 }, null)).history, []));
  check('unpack: もとに もどる', same(backup.unpack(text), { save: sampleSave(), history: sampleHistory() }));
  check('unpack: Godot版の 書き方（1.0）も 読める', same(backup.unpack('{"format":1.0,"history":[],"save":{"v":1.0}}'), { save: { v: 1 }, history: [] }));
  const bad = ['', 'x', '[]', 'null', '{"format":2,"save":{}}', '{"format":1,"save":[]}', '{"format":1,"save":"x"}', '{"save":{}}'];
  check('unpack: かたちが ちがえば null', bad.every((t) => backup.unpack(t) === null));
  check('unpack: history が 配列で なければ 空の 配列', same(backup.unpack('{"format":1,"save":{},"history":"x"}').history, []));
  check('上限は 512KiB（UTF-8 の バイト数）', backup.MAX_BYTES === SPEC.maxBytes && net.byteLength('あa') === 4);
}

async function testDigest() {
  section('digest');
  const { backup } = makeWorld().GP;
  const base = await backup.digest(sampleSave(), sampleHistory());
  check('64 文字の 16 進', HEX64.test(base));
  check('lastSeen を 無視', base === await backup.digest(sampleSave({ lastSeen: 999999 }), sampleHistory()));
  check('中身が かわれば かわる', base !== await backup.digest(sampleSave({ day: 4 }), sampleHistory()));
  check('せいせきが かわれば かわる', base !== await backup.digest(sampleSave(), []));
  check('crypto.subtle が 無ければ 空（毎回 送る）', (await makeWorld({ subtle: false }).GP.backup.digest(sampleSave(), [])) === '');
}

/* =========================================================
   ひかえを 送る
   ========================================================= */
async function testSendBasics(mockUrl) {
  section('sendNow');
  const blank = onlineWorld(mockUrl);
  writeSave(blank, sampleSave());
  check('アカウントなし → off', (await blank.GP.backup.sendNow()) === false && blank.GP.backup.status() === 'off' && blank.net.calls.length === 0);
  const w = await deviceWithAccount(mockUrl, 'ひかえ');
  const backup = w.GP.backup;
  check('はじめは idle', backup.status() === 'idle' && backup.statusText() === '');
  check('セーブなし → no_save（送らない）', (await backup.sendNow()) === false && backup.status() === 'no_save' && savePuts(w) === 0 && backup.statusText() !== '');
  writeSave(w, sampleSave());
  check('送る → ok', (await backup.sendNow()) === true && backup.status() === 'ok' && savePuts(w) === 1 && backup.statusText() === '');
  const acc = w.GP.net.account();
  check('アカウントに backupAt と backupDigest', typeof acc.backupAt === 'number' && HEX64.test(acc.backupDigest) && acc.server === mockUrl);
  const got = (await mockState(mockUrl)).saves[acc.playerId];
  check('窓口が 受けた 中身 = pack(セーブ, せいせき)', got.puts === 1 && got.data === backup.pack(sampleSave(), sampleHistory()));
  return w;
}

async function testSendSkips(w) {
  const backup = w.GP.backup;
  check('同じ 中身は 送らない（true・ok）', (await backup.sendNow()) === true && backup.status() === 'ok' && savePuts(w) === 1);
  writeSave(w, sampleSave({ lastSeen: 777 }));
  check('lastSeen だけ ちがっても 送らない', (await backup.sendNow()) === true && savePuts(w) === 1);
  writeSave(w, sampleSave({ day: 9 }));
  check('中身が かわれば 送る', (await backup.sendNow()) === true && savePuts(w) === 2);
  writeSave(w, sampleSave({ day: 10 }));
  const all = await Promise.all([backup.sendNow(), backup.sendNow(), backup.sendNow()]);
  check('同時に よんでも 送るのは 1 回', all.every(Boolean) && savePuts(w) === 3);
}

async function testKeepalive(w) {
  const backup = w.GP.backup;
  writeSave(w, sampleSave({ day: 20 }));
  await backup.sendNow({ keepalive: true });
  check('小さい ひかえ＋keepalive → 付ける', lastCall(w).path === '/v1/save' && lastCall(w).keepalive === true);
  writeSave(w, sampleSave({ day: 21 }));
  await backup.sendNow();
  check('指定なし → 付けない', lastCall(w).keepalive === false);
  writeSave(w, sampleSave({ pad: 'x'.repeat(SPEC.keepaliveBytes) }));
  check('60KiB を こえる ひかえ → keepalive なしで 送る', (await backup.sendNow({ keepalive: true })) === true && lastCall(w).keepalive === false);
  check('さかいめは 60KiB', w.GP.net.KEEPALIVE_MAX_BYTES === SPEC.keepaliveBytes);
}

async function testTooBig(w) {
  const backup = w.GP.backup;
  const before = savePuts(w);
  writeSave(w, sampleSave({ pad: 'x'.repeat(SPEC.maxBytes) }));
  check('512KiB を こえる → too_big（送らない）', (await backup.sendNow()) === false && backup.status() === 'too_big' && savePuts(w) === before && backup.statusText() !== '');
  check('too_big では 送り直しを 予約しない', w.timers.count(SPEC.retry_ms) === 0);
  w.store.set(w.GP.util.SAVE_KEY, '{こわれた');
  check('セーブが 読めない → failed（送らない）', (await backup.sendNow()) === false && backup.status() === 'failed' && savePuts(w) === before);
}

async function testNoDigest(mockUrl) {
  const w = await deviceWithAccount(mockUrl, 'しるしなし', { subtle: false });
  writeSave(w, sampleSave());
  const first = await w.GP.backup.sendNow();
  const second = await w.GP.backup.sendNow();
  check('印を 作れない 環境では 毎回 送る', first && second && savePuts(w) === 2 && w.GP.net.account().backupDigest === '');
}

async function testRetry(mockUrl) {
  section('送り直し・タイマー');
  const w = await deviceWithAccount(mockUrl, 'おくりなおし');
  const backup = w.GP.backup;
  writeSave(w, sampleSave());
  w.net.failNext = true;
  check('通信不能 → failed', (await backup.sendNow()) === false && backup.status() === 'failed' && backup.statusText() !== '');
  check('60 秒後の 送り直しを 予約（1 つ）', backup.RETRY_MS === SPEC.retry_ms && w.timers.count(SPEC.retry_ms) === 1 && w.timers.list.length === 1);
  check('しっぱいでは 印を 書かない', w.GP.net.account().backupDigest === undefined);
  w.timers.fire(SPEC.retry_ms);
  const delivered = (await backup.sendNow()) === true && backup.status() === 'ok';
  const puts = (await mockState(mockUrl)).saves[w.GP.net.account().playerId].puts;
  check('送り直しで 届く（窓口には 1 回）', delivered && savePuts(w) === 2 && puts === 1 && w.timers.list.length === 0);
  w.net.fake = { status: 413, body: { error: 'too_large' } };
  writeSave(w, sampleSave({ day: 5 }));
  check('窓口が too_large → too_big（予約しない）', (await backup.sendNow()) === false && backup.status() === 'too_big' && w.timers.list.length === 0);
}

async function testMarkDirty(mockUrl) {
  const w = await deviceWithAccount(mockUrl, 'タイマー');
  const backup = w.GP.backup;
  writeSave(w, sampleSave());
  backup.markDirty();
  const firstTimer = w.timers.list[0];
  backup.markDirty();
  check('markDirty: 30 秒の タイマーを 1 つだけ', backup.SEND_DELAY_MS === SPEC.sendDelay_ms && w.timers.count(SPEC.sendDelay_ms) === 1 && w.timers.list.length === 1);
  check('markDirty: うごいて いる タイマーは かけ直さない（自動保存の たびに 先のばしに しない）', w.timers.list[0] === firstTimer);
  check('タイマーが 鳴るまでは 送らない', savePuts(w) === 0);
  w.timers.fire(SPEC.sendDelay_ms);
  await backup.sendNow();
  check('タイマーで 送る（1 回だけ）', savePuts(w) === 1 && backup.status() === 'ok');
  backup.markDirty();
  check('鳴った あとは また 予約できる', w.timers.count(SPEC.sendDelay_ms) === 1);
}

function testPersistHook() {
  const w = makeWorld({ webdriver: true });
  w.GP.state.S.data = sampleSave();
  w.GP.state.persist();
  check('St.persist → markDirty', w.store.has(w.GP.util.SAVE_KEY) && w.timers.count(SPEC.sendDelay_ms) === 1);
  const bare = makeWorld({ modules: false });
  bare.GP.state.S.data = sampleSave();
  check('GP.backup が 無い 環境（sim・golden）でも persist は 動く', !throws(() => bare.GP.state.persist()) && bare.GP.backup === undefined && bare.store.has(bare.GP.util.SAVE_KEY));
}

async function testBadKey(mockUrl) {
  section('bad_key・アカウントの 入れかわり');
  const a = await deviceWithAccount(mockUrl, 'たんまつA');
  const backup = a.GP.backup;
  writeSave(a, sampleSave());
  await backup.sendNow();
  await onlineWorld(mockUrl).GP.net.recover(a.GP.net.account().recoveryCode);
  writeSave(a, sampleSave({ day: 2 }));
  check('別の 端末で 引き継がれた → bad_key', (await backup.sendNow()) === false && backup.status() === 'bad_key' && backup.statusText() === a.GP.net.explain({ error: 'bad_key' }));
  const calls = a.net.calls.length;
  check('その 鍵では もう 送らない', (await backup.sendNow()) === false && a.net.calls.length === calls && backup.status() === 'bad_key');
  check('送り直しも 予約しない', a.timers.list.length === 0);
  a.GP.net.saveAccount((await a.GP.net.register('たんまつA2')).data);
  check('あたらしい 鍵なら また 送る', (await backup.sendNow()) === true && backup.status() === 'ok');
}

async function testAccountSwitched(mockUrl) {
  const w = await deviceWithAccount(mockUrl, 'まちあい');
  const net = w.GP.net;
  const next = (await net.register('まちあい2')).data;
  writeSave(w, sampleSave());
  w.net.afterResponse = () => { w.net.afterResponse = null; net.saveAccount(next); };
  const sent = await w.GP.backup.sendNow();
  const acc = net.account();
  check('待つ あいだに アカウントが かわった → 印を 書かない', sent === true && acc.deviceKey === next.deviceKey && acc.backupAt === undefined && acc.backupDigest === undefined);
  check('その ときは status も かえない', w.GP.backup.status() === 'idle');
}

/* =========================================================
   ひきつぎ（restore）
   ========================================================= */
async function testHandover(mockUrl) {
  section('ひきつぎ（recover → unpack → restore → saveAccount）');
  const a = await deviceWithAccount(mockUrl, 'ひきつぎ');
  writeSave(a, sampleSave({ day: 42 }));
  await a.GP.backup.sendNow();
  const accA = a.GP.net.account();
  const b = onlineWorld(mockUrl);
  const { net, backup, state, util, net: { code } } = b.GP;
  writeSave(b, sampleSave({ day: 1 }), []);
  state.S.data = sampleSave({ day: 1 });
  const typed = toFullWidth(accA.recoveryCode.replace(/-/g, '').toLowerCase());
  check('全角・小文字・ハイフンなしの 入力が 同じ コードに なる', code.isValid(code.normalized(typed)) && code.formatted(code.normalized(typed)) === accA.recoveryCode);
  const res = await net.recover(code.formatted(code.normalized(typed)));
  check('recover → {playerId,name,deviceKey,save:{data}}', res.ok && res.data.playerId === accA.playerId && res.data.deviceKey !== accA.deviceKey && typeof res.data.save.data === 'string');
  check('restore → true・セーブと せいせきが 一致', backup.restore(backup.unpack(res.data.save.data)) === true && same(util.load(), sampleSave({ day: 42 })) && same(util.loadHistory(), sampleHistory()));
  check('restore: いまの ゲームを 閉じる', state.st === null);
  check('restore: ほかの タブへ 知らせる（しるしを 書いて すぐ 消す）', backup.REPLACED_KEY === REPLACED_KEY && b.writes.includes(REPLACED_KEY) && !b.store.has(REPLACED_KEY));
  return { a, b, res, code: accA.recoveryCode };
}

async function testAfterHandover(mockUrl, { a, b, res, code }) {
  const { net, backup } = b.GP;
  check('引き継いだ アカウントを 保存', net.saveAccount(net.accountFromRecover(res.data, code)) && net.account().recoveryCode === code);
  check('引き継いだ 鍵で ひかえを 送れる', (await backup.sendNow()) === true && backup.status() === 'ok');
  writeSave(a, sampleSave({ day: 43 }));
  check('前の 端末の 鍵は 使えない（bad_key）', (await a.GP.backup.sendNow()) === false && a.GP.backup.status() === 'bad_key');
  const fresh = await deviceWithAccount(mockUrl, 'ひかえなし');
  const none = await onlineWorld(mockUrl).GP.net.recover(fresh.GP.net.account().recoveryCode);
  check('ひかえが 無い アカウント → save は null', none.ok && none.data.save === null);
}

// セーブの 値・キー・せいせきの どこに あっても 読まない
const markupBundles = () => [
  { save: sampleSave({ units: [{ lv: '6' + MARKUP }] }), history: [] },
  { save: sampleSave({ [MARKUP]: 1 }), history: [] },
  { save: sampleSave(), history: [{ at: 1, score: 1, levelTotal: MARKUP }] },
  ...['<', '>', '&', '"', "'"].map((c) => ({ save: sampleSave({ note: 'a' + c + 'b' }), history: [] })),
];

const deepBundle = () => ({ save: sampleSave({ deep: Array.from({ length: DEEP_NEST }).reduce((inner) => [inner], 0) }), history: [] });

/** Godot版の JSON.stringify(…, sort_keys, full_precision) の 書き方：キーを ならべかえ、整数も 3.0 と 書く */
function godotJson(v) {
  if (Array.isArray(v)) return '[' + v.map(godotJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + godotJson(v[k])).join(',') + '}';
  return Number.isInteger(v) ? v + '.0' : JSON.stringify(v);
}

function testRestoreMarkup() {
  const w = makeWorld({ webdriver: true });
  const { backup, state, util } = w.GP;
  writeSave(w, sampleSave({ day: 1 }));
  state.S.data = sampleSave({ day: 1 });
  check('HTML に なりうる 字（< > & " \'）を ふくむ ひかえは 読まない', markupBundles().every((x) => backup.restore(x) === false));
  check('入れ子が 深すぎる ひかえも 落ちずに 読まない', !throws(() => backup.restore(deepBundle())) && backup.restore(deepBundle()) === false);
  check('…何も 書かず、ゲームも 閉じず、ほかの タブへも 知らせない', same(util.load(), sampleSave({ day: 1 })) && same(util.loadHistory(), sampleHistory())
    && state.st !== null && !w.writes.includes(REPLACED_KEY));
}

function testGodotBundle() {
  section('Godot版が 書いた ひかえ（本物の 大きさの セーブ）');
  const a = makeWorld({ webdriver: true });
  a.GP.state.newGame();
  a.GP.state.log('「すなば」を てにいれた！（なかよし +3）…', 'good');
  const save = JSON.parse(JSON.stringify(a.GP.state.st));
  a.GP.util.save(save);
  const b = makeWorld({ webdriver: true });
  const { backup, state, util } = b.GP;
  const text = godotJson({ format: 1.0, save, history: REAL_HISTORY });
  check('キーを ならべかえ・整数を 3.0 と 書いた ひかえを 引き継げる', text !== backup.pack(save, REAL_HISTORY) && backup.restore(backup.unpack(text)) === true);
  check('「つづきから」で ひらいた 中身が もとの セーブと 同じ', godotJson(state.restore()) === godotJson(a.GP.state.restore()) && state.st.units.length > 0);
  check('せいせきも 同じ', godotJson(util.loadHistory()) === godotJson(REAL_HISTORY) && util.loadHistory().length === REAL_HISTORY.length);
}

function testRestoreEdges() {
  section('restore の 断り・St の 口');
  const w = makeWorld({ webdriver: true });
  const { backup, state, util } = w.GP;
  writeSave(w, sampleSave({ day: 1 }));
  state.S.data = sampleSave({ day: 1 });
  const bad = [null, undefined, {}, { save: null, history: [] }, { save: 'x', history: [] }, { save: { v: 2 }, history: [] },
    { save: { day: 3 }, history: [] }, backup.unpack('{"format":1,"save":{"v":"1"},"history":[]}')];
  check('v が 1 で ない もの・形が ちがう ものは false', bad.every((x) => backup.restore(x) === false));
  check('…何も 書かず、ゲームも 閉じない', same(util.load(), sampleSave({ day: 1 })) && same(util.loadHistory(), sampleHistory()) && state.st !== null);
  check('St.isLoadable は v が 1 の ときだけ', state.isLoadable({ v: 1 }) && [null, undefined, {}, { v: 2 }, { v: '1' }, 'x'].every((d) => !state.isLoadable(d)));
  w.store.set(util.SAVE_KEY, JSON.stringify({ v: 2 }));
  check('St.restore も 同じ 条件（v が 2 → null）', state.restore() === null);
  writeSave(w, sampleSave({ day: 6 }));
  check('St.restore: v が 1 なら 読める', state.restore().day === 6 && state.st.day === 6);
  state.unload();
  state.persist();
  check('St.unload の あとは persist しても 上書きしない', state.st === null && same(util.load(), sampleSave({ day: 6 })));
}

/* =========================================================
   にせ窓口の CORS
   ========================================================= */
const noCors = (r) => Object.keys(r.headers).every((h) => !h.startsWith('access-control-') && h !== 'vary');
const ownHeaders = (r) => Object.keys(r.headers).filter((h) => !NODE_AUTO_HEADERS.includes(h));
const preflight = (url, origin) => rawRequest(url, {
  method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
});

async function testCorsOff(url) {
  section('にせ窓口の CORS（CORS_ALLOW_ORIGINS なし ＝ 今まで どおり）');
  const plain = await rawRequest(url + '/v1/challenge/events');
  check('Origin なし → 200・ヘッダーは Content-Type だけ', plain.status === 200 && same(ownHeaders(plain), ['content-type']) && plain.headers['content-type'] === JSON_TYPE);
  const refused = await rawRequest(url + '/v1/me');
  check('Origin なしの 断り → 401 no_key・ヘッダーは Content-Type だけ', refused.status === 401 && JSON.parse(refused.text).error === 'no_key' && same(ownHeaders(refused), ['content-type']));
  const withOrigin = await rawRequest(url + '/v1/challenge/events', { headers: { Origin: PAGE_ORIGIN } });
  check('Origin が あっても 付けない', withOrigin.status === 200 && noCors(withOrigin));
  const pre = await preflight(url + '/v1/save', PAGE_ORIGIN);
  check('事前確認は 404 not_found の まま', pre.status === 404 && JSON.parse(pre.text).error === 'not_found' && noCors(pre));
}

async function testCorsPreflight(url) {
  section('にせ窓口の CORS（許可オリジンあり）');
  const pre = await preflight(url + '/v1/save', PAGE_ORIGIN);
  check('許可オリジンの 事前確認 → 204・本文なし', pre.status === 204 && pre.text === '');
  check('…allow-origin と vary: Origin', pre.headers[ACAO] === PAGE_ORIGIN && pre.headers.vary === 'Origin');
  check('…allow-methods は GET, POST, PATCH, PUT', pre.headers['access-control-allow-methods'] === 'GET, POST, PATCH, PUT');
  check('…allow-headers は authorization, content-type', pre.headers['access-control-allow-headers'] === 'authorization, content-type');
  check('…max-age あり・Allow-Credentials なし', Number(pre.headers['access-control-max-age']) > 0 && !('access-control-allow-credentials' in pre.headers));
  const others = await Promise.all([OTHER_ORIGIN, PAGE_ORIGIN + '/', PAGE_ORIGIN.toUpperCase(), 'null'].map((o) => preflight(url + '/v1/save', o)));
  check('ほかの オリジンの 事前確認は 404 の まま（完全一致）', others.every((r) => r.status === 404 && noCors(r)));
}

async function testCorsResponses(url) {
  const ok = await rawRequest(url + '/v1/challenge/events', { headers: { Origin: PAGE_ORIGIN } });
  check('許可オリジンの 返事 → allow-origin と vary', ok.status === 200 && ok.headers[ACAO] === PAGE_ORIGIN && ok.headers.vary === 'Origin' && ok.headers['content-type'] === JSON_TYPE);
  const refused = await rawRequest(url + '/v1/me', { method: 'PATCH', headers: { Origin: PAGE_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
  check('断りの 返事にも 付く（ページが 理由を 読める）', refused.status === 401 && refused.headers[ACAO] === PAGE_ORIGIN);
  const other = await rawRequest(url + '/v1/challenge/events', { headers: { Origin: OTHER_ORIGIN } });
  check('ほかの オリジンには 付けない', other.status === 200 && noCors(other));
  const plain = await rawRequest(url + '/v1/challenge/events');
  check('Origin なしの 返事は 今まで どおり', plain.status === 200 && same(ownHeaders(plain), ['content-type']));
}

/* =========================================================
   ランキングの 札（板の 最短秒を 本当に 待つ）
   ========================================================= */
async function beginRun(mockUrl) {
  const net = onlineWorld(mockUrl).GP.net;
  const reg = await net.register('ランキング');
  const rules = await net.boardRules();
  const run = await net.startRun(reg.data.deviceKey);
  return { net, key: reg.data.deviceKey, runId: run.data.runId, startedAt_ms: Date.now(), minSec: rules.data.minSec, started: run.ok && typeof run.data.runId === 'string' };
}

async function testFinishRun(mockUrl, run) {
  section('ランキングの 札');
  check('startRun → {runId}', run.started);
  await wait(Math.max(0, run.minSec * MS_PER_SEC + FINISH_MARGIN_MS - (Date.now() - run.startedAt_ms)));
  const res = await run.net.finishRun(run.key, run.runId, RUN_PAYLOAD);
  check('finishRun → {improved,best,rank,participants}', res.ok && res.data.improved === true && res.data.best === RUN_PAYLOAD.value && res.data.rank >= 1 && res.data.participants >= 1);
  check('おなじ 札を もういちど → already_done', (await refusalName(run.net.finishRun(run.key, run.runId, RUN_PAYLOAD))) === 'already_done');
  const got = (await mockState(mockUrl)).finishes.find((f) => f.name === 'ランキング');
  check('窓口が 受けた 中身 = 送った payload', !!got && same(got.body, RUN_PAYLOAD));
}

/* =========================================================
   とおし
   ========================================================= */
async function runNetTests({ mock, corsMock, odd, other }) {
  testEnabled();
  await testOffline();
  testUseTestServer(mock.url);
  await testHeaders(mock.url);
  await testResults(mock.url);
  await testRefusals(mock.url);
  await testTooMany(corsMock.url);
  await testNetworkFailures(mock.url, odd.url);
  testExplain();
  await testAccount(mock.url, other);
  testAccountEdges(mock.url);
  testCode();
}

async function runBackupTests(mockUrl) {
  testBundle();
  await testDigest();
  const w = await testSendBasics(mockUrl);
  await testSendSkips(w);
  await testKeepalive(w);
  await testTooBig(w);
  await testNoDigest(mockUrl);
  await testRetry(mockUrl);
  await testMarkDirty(mockUrl);
  testPersistHook();
  await testBadKey(mockUrl);
  await testAccountSwitched(mockUrl);
  await testAfterHandover(mockUrl, await testHandover(mockUrl));
  testGodotBundle();
  testRestoreEdges();
  testRestoreMarkup();
  const texts = godotTexts(GODOT_BACKUP, 'STATUS_TEXT');
  if (texts) check('Godot版の STATUS_TEXT と 同じ 文言', await statusTextsMatch(mockUrl, texts));
}

// failed と too_big は 上で 見た。ここでは 文言だけを Godot版と 見くらべる
async function statusTextsMatch(mockUrl, texts) {
  const w = await deviceWithAccount(mockUrl, 'もんごん');
  const backup = w.GP.backup;
  await backup.sendNow();
  const noSave = backup.statusText() === texts.no_save;
  writeSave(w, sampleSave());
  w.net.failNext = true;
  await backup.sendNow();
  const failed = backup.statusText() === texts.failed;
  writeSave(w, sampleSave({ pad: 'x'.repeat(SPEC.maxBytes) }));
  await backup.sendNow();
  return noSave && failed && backup.statusText() === texts.too_big && Object.keys(texts).length === 3;
}

/* =========================================================
   ファイルの 一覧・接続先の 設定（ほかの テストが 読まない ファイル）
   ========================================================= */
function testFileLists() {
  section('ファイルの 一覧・接続先の 設定');
  const read = (file) => readFileSync(join(ROOT, file), 'utf8');
  const pageScripts = Array.from(read(PAGE_FILE).matchAll(PAGE_SCRIPT), (m) => m[1]);
  const build = read(BUILD_FILE);
  const buildScripts = Array.from((BUILD_LIST.exec(build) || ['', ''])[1].matchAll(BUILD_SCRIPT), (m) => m[1] || NET_CONFIG_FILE);
  check(`${PAGE_FILE} の <script> に 通信の 4 ファイルが ある`, [NET_CONFIG_FILE, ...NET_FILES, 'js/online.js'].every((f) => pageScripts.includes(f)));
  check(`${SW_FILE} の ASSETS の JS が ${PAGE_FILE} と 同じ 並び`, same(Array.from(read(SW_FILE).matchAll(SW_SCRIPT), (m) => m[1]), pageScripts));
  check(`${BUILD_FILE} の JS も 同じ 並び`, same(buildScripts, pageScripts));
  check(`スタンドアロンの 1 ファイル版には ${NET_CONFIG_FILE} を そのまま 入れる`, build.includes(BUILD_ONLINE_SCRIPT) && BUILD_STANDALONE_USES_ONLINE.test(build));
  check('Artifact 用に 入れるのは 空の 設定（窓口の URL を 入れない）', BUILD_EMPTY_CONFIG.test(build) && build.includes(BUILD_OFFLINE_SCRIPT) && BUILD_ARTIFACT_USES_OFFLINE.test(build));
  const synced = spawnSync(process.execPath, [join(ROOT, EXPORT_NET), '--check'], { stdio: 'ignore' });
  check(`${NET_CONFIG_FILE} が godot/data/ranking.json と そろって いる（${EXPORT_NET} --check）`, synced.status === 0);
}

async function runAll(servers) {
  const run = await beginRun(servers.mock.url);
  await runNetTests(servers);
  await runBackupTests(servers.mock.url);
  await testCorsOff(servers.mock.url);
  await testCorsPreflight(servers.corsMock.url);
  await testCorsResponses(servers.corsMock.url);
  await testFinishRun(servers.mock.url, run);
  testFileLists();
  section('安全ネット');
  check('本物の 窓口へは 1 回も 通信して いない（127.0.0.1 いがいへの fetch は 0 回）', guard.blocked === 0 && guard.loopback > 0);
}

function report() {
  const failed = results.filter((ok) => !ok).length;
  console.log('\n--- けっか ---');
  console.log('  かくにん :', results.length);
  console.log('  NG       :', failed);
  if (!failed) console.log('  ぜんぶ ok ✓');
  process.exitCode = failed ? 1 : 0;
}

async function main() {
  console.log('=== 窓口との やりとりの テスト（にせ窓口） ===');
  const board = makeWorld().GP.net.board;
  const [mock, corsMock, odd, other] = await Promise.all([startMock(''), startMock(PAGE_ORIGIN), startOddServer(board), closedUrl()]);
  try {
    await runAll({ mock, corsMock, odd, other });
  } finally {
    [mock, corsMock, odd].forEach((s) => s.stop());
  }
  report();
}

await main();
