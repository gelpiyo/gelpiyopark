/* =========================================================
   tools/e2e-online.mjs — オンライン機能の ブラウザ とおしテスト（CDP）
   ランキング / アカウント・ひきつぎ / セーブの ひかえ を、じっさいに タップして たしかめる。

   ・にせ窓口（tools/mock-ranking-server.mjs）を じぶんで きどうして、ページを そこへ つなぐ。
     本物の 窓口へは つながない：さいしょに 接続先が にせ窓口で ある ことを たしかめ、
     ちがえば 何も せず 失敗で おわる（にせ窓口 いがいへの fetch は ページの 中でも 止める）。
   ・おわったら この オリジンの localStorage（セーブ・せいせき・アカウント）を もとに もどす。
   ・NG が 1 つでも あれば 終了コード 1。

   まえもって node tools/serve.mjs と headless chrome（--remote-debugging-port=9222。
   ポートは 環境変数 CDP_PORT で かえられる）を きどう しておくこと。

   つかいかた: node tools/e2e-online.mjs [http://localhost:8123]
   ========================================================= */
import { connect, sleep } from './cdp.mjs';
import { startMock, toFullWidth } from './test-helpers.mjs';

const BASE = process.argv[2] || 'http://localhost:8123';
// ?dev を 付けると Service Worker を 登録しない（テストの あとに キャッシュを のこさない）
const PAGE_URL = BASE + '/?dev=park';
const BLANK_URL = 'about:blank';
const LOAD_TRIES = 80;
const POLL_MS = 100;
const WAIT_TIMEOUT_MS = 10000;
const SETTLE_MS = 350;
const LOG_SETTLE_MS = 250;
const BACKDROP_POINT = { x: 195, y: 30 };
const ESCAPE_KEY = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
const MIN_INPUT_WIDTH_PX = 200;
const ERRORS_SHOWN = 12;
const ERROR_CHARS_SHOWN = 220;
const MS_PER_SEC = 1000;
// にせ窓口の 板の minSec（3 秒）
const BOARD_MIN_MS = 3000;
const NAME_MAX = 20;
// 入力らんの maxlength は UTF-16 で 数える（絵文字 20 文字が 入る ように 文字数の 2 倍）
const UTF16_UNITS_PER_CHAR = 2;
// 20 文字いないで 画面を こわせる 名前。字として 出なければ <img> が でき、onerror で X が よまれる
const XSS_NAME = '<img src onerror=X>';
// コードポイントで ちょうど 20 文字（UTF-16 では 21）
const RENAMED = XSS_NAME + '🐣';
const TOO_LONG_NAME = 'あ'.repeat(NAME_MAX + 1);
const CODE_SHAPE = /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$/;
const UNKNOWN_CODE = '2222-2222-2222';
const SHORT_CODE = 'abc';
const NO_BACKUP_NAME = 'ひかえなし';
const BROKEN_NAME = 'よめない ひかえ';
const CRAFTED_NAME = 'しかけ入りの ひかえ';
const UNREADABLE_BACKUP = JSON.stringify({ format: 1, save: { v: 2 }, history: [] });
const WRONG_KEY = 'wrong-key-for-test';
const FOREIGN_ACCOUNT = {
  playerId: 'p-foreign', name: 'よその ひと', deviceKey: 'foreign-key-for-test', recoveryCode: 'ABCD-EFGH-JKLM',
  server: 'https://ranking.invalid',
};
const CODE_GROUP = 4;
const RECOVER_TRIES = 7;
const REPLACED_KEY = 'gelpiyo-park-replaced-v1';
const OTHER_TAB_SAVE = JSON.stringify({ v: 1, day: 77, from: 'other-tab' });
const BACKUP_AT_WHILE_WAITING_MS = 1700000000000;
const FRESH_UNITS = 3;
const LOOPBACK_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const BAD_KEY_TEXT = 'この端末の登録が使えなくなっています';
const HOME = 'セーブの ひかえ';
const CODE_ASK = 'まえの 端末で メモした ひきつぎコード';
const RECOVERED = 'ひきつぎ できました';
const RANK_SENT = 'ランキングに おくりました';
const RANK_FAILED = 'ランキングに おくれませんでした';
const RANK_CONFIRM = 'この 名前で ランキングに のせます';
const RESTART_ASK = 'あたらしく はじめる？';
const RESTORE_TEXT = {
  replaced: 'サーバーの ひかえから もどしました',
  none: 'サーバーに ひかえが なかった',
  broken: 'ひかえを よみこめなかった',
};
const EMPTY_STORAGE = { save: null, history: null, account: null };

const { send, evalJs, errs, close } = await connect();
const results = [];
const fetchLog = [];
let mock = null;

/* =========================================================
   どうぐ（node がわ）
   ========================================================= */
const section = (title) => console.log(`\n--- ${title} ---`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, cond, info = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? 'ok' : 'NG'}  ${name}${info === '' ? '' : '  ' + info}`);
};

class Abort extends Error {}

/** ページの 中で fn を うごかす（fn は 文字列に して 送るので、外の 変数は 引数で わたす） */
const run = (fn, ...args) => evalJs(`(${fn})(...${JSON.stringify(args)})`);

async function waitFor(what, fn, ...args) {
  const until = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < until) {
    const value = await run(fn, ...args);
    if (value) return value;
    await sleep(POLL_MS);
  }
  check(`${what}（${WAIT_TIMEOUT_MS / MS_PER_SEC} 秒 待っても ならない）`, false);
  return null;
}

// lastSeen は 20 秒ごとの 自動保存で かわるので、くらべる ときは のぞく
function saveCore(saveText) {
  const save = JSON.parse(saveText || 'null');
  return save ? JSON.stringify({ ...save, lastSeen: 0 }) : '';
}
const sameData = (a, b) => saveCore(a.save) === saveCore(b.save) && a.history === b.history;

/* ---------- にせ窓口 ---------- */
async function mockState() {
  const path = '/_test/state';
  try {
    return await (await fetch(mock.url + path)).json();
  } catch (e) {
    throw new Error(`にせ窓口の ${path} を よめない: ${e.message}`);
  }
}

const putsOf = (state, playerId) => (state.saves[playerId] ? state.saves[playerId].puts : 0);
const rawBackupOf = (state, playerId) => (state.saves[playerId] ? state.saves[playerId].data : '');
/** にせ窓口が もって いる ひかえ → localStorage と くらべられる 形（セーブと せいせきの 文字列） */
function backupOf(state, playerId) {
  const bundle = JSON.parse(rawBackupOf(state, playerId) || '{}');
  const history = Array.isArray(bundle.history) ? bundle.history : [];
  return { format: bundle.format, save: JSON.stringify(bundle.save || null), history: JSON.stringify(history), historyCount: history.length };
}

/* =========================================================
   どうぐ（ページがわ。window.__t に おく）
   ========================================================= */
function installFetchSpy(allowedOrigin) {
  const calls = [];
  const gate = { wait: null, open: null, failNext: false };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, location.href);
    calls.push({ origin: u.origin, path: u.pathname, method: init.method || 'GET', keepalive: init.keepalive === true });
    if (u.origin !== allowedOrigin) throw new TypeError('blocked (test)');
    if (gate.wait) await gate.wait;
    if (gate.failNext) { gate.failNext = false; throw new TypeError('fetch failed (test)'); }
    return nativeFetch(url, init);
  };
  window.__t = {
    calls,
    hold: () => { gate.wait = new Promise((open) => { gate.open = open; }); },
    release: () => { const open = gate.open; gate.wait = null; gate.open = null; if (open) open(); },
    failNext: () => { gate.failNext = true; },
    count: (method, path) => calls.filter((c) => c.method === method && c.path === path).length,
  };
}

function installModalReader() {
  const q = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const textOf = (s) => (q(s) ? q(s).textContent : '');
  const input = () => q('#modal-body input');
  Object.assign(window.__t, {
    modal: () => ({
      open: !q('#modal-root').hidden, title: q('#modal-title').textContent.trim(), text: q('#modal-body').innerText,
      buttons: all('#modal-foot .btn').map((b) => b.textContent), closeHidden: q('#modal-close').hidden,
      imgs: all('#modal-body img').length, input: input() ? input().value : null,
      inputMax: input() ? input().maxLength : null, inputFocused: !!input() && document.activeElement === input(),
      error: textOf('#modal-body .form-error'), code: textOf('#modal-body .code-text'),
      backInert: q('#app').inert || q('#title-screen').inert,
    }),
    toasts: () => all('#toast-root .toast').map((n) => n.textContent),
    clearToasts: () => { q('#toast-root').innerHTML = ''; },
  });
}

function installLayoutTools(minInputWidth) {
  const q = (s) => document.querySelector(s);
  const inView = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  };
  const inputFits = (n) => !n || (inView(n) && n.getBoundingClientRect().width >= minInputWidth);
  window.__t.fits = () => inView(q('#modal-card')) && Array.from(document.querySelectorAll('#modal-root .btn')).every(inView)
    && q('#modal-body').scrollWidth <= q('#modal-body').clientWidth && inputFits(q('#modal-body input'));
}

function installTapTools() {
  const buttons = () => Array.from(document.querySelectorAll('#modal-root button')).filter((n) => n.getClientRects().length > 0);
  const find = (label) => buttons().find((n) => n.textContent.trim() === label) || buttons().find((n) => n.textContent.includes(label));
  // 30 秒後の 自動送信は 止める（数える 送信の 回数が 時間で ぶれない ように。タイマーは online-test.mjs が たしかめる）
  GP.backup.markDirty = () => {};
  Object.assign(window.__t, {
    click: (label) => { const b = find(label); if (b) b.click(); return !!b; },
    type: (text) => { document.querySelector('#modal-body input').value = text; return true; },
    done: 0,
    startRanking: () => GP.online.startRanking(GP.state.resultRecord(Date.now()), () => { window.__t.done += 1; }),
    // つぎの 1 回だけ 例外を 投げる（思わぬ エラーの かわり）
    breakOnce: (owner, name) => {
      const original = owner[name];
      owner[name] = () => { owner[name] = original; throw new Error('broken on purpose (test)'); };
      return true;
    },
  });
}

function installXssTrap() {
  window.__t.xss = 0;
  Object.defineProperty(window, 'X', { configurable: true, get: () => { window.__t.xss += 1; return 0; } });
}

/* =========================================================
   ページを ひらく / 接続先の たしかめ / localStorage
   ========================================================= */
async function loadPage(url) {
  // まえの ページを 新しい ページと 見まちがえない ための しるし
  await evalJs('window.__stale = true');
  await send('Page.navigate', { url });
  for (let i = 0; i < LOAD_TRIES; i++) {
    await sleep(POLL_MS);
    if (await evalJs('!window.__stale && document.readyState === "complete" && !!window.GP && !!GP.state && !!GP.state.st')) return;
  }
  throw new Abort('ページを ひらけない: ' + url);
}

// まえの 実行が とちゅうで 止まって いると、タブに その ページと 通信の 記録が のこって いる。この 実行の ものと まぜない
async function leaveOldPage() {
  await send('Page.navigate', { url: BLANK_URL });
  const left = await waitFor('まえの ページを はなれる', (url) => location.href === url, BLANK_URL);
  if (!left) throw new Abort('まえの ページを はなれられない');
  await sleep(LOG_SETTLE_MS);
  errs.length = 0;
}

async function harvestFetchLog() {
  const calls = await evalJs('window.__t ? window.__t.calls.splice(0) : []');
  fetchLog.push(...(calls || []));
}

async function openPage() {
  await harvestFetchLog();
  await loadPage(PAGE_URL);
  await run(installFetchSpy, mock.url);
  await run(installModalReader);
  await run(installLayoutTools, MIN_INPUT_WIDTH_PX);
  await run(installTapTools);
  await run(installXssTrap);
  // 自動の 検査の ページは 接続先なしで はじまる はず。ちがえば 何も さわらずに やめる
  if ((await evalJs('GP.net.baseUrl()')) !== '') throw new Abort('自動の 検査なのに 窓口へ つなぐ 設定に なって いる。何も せずに おわります');
}

async function openOnline() {
  await openPage();
  const base = await run((url) => { GP.net.useTestServer(url); return GP.net.baseUrl(); }, mock.url);
  if (base !== mock.url) throw new Abort('接続先が にせ窓口では ない。何も せずに おわります');
}

const readStorage = () => run(() => ({
  save: localStorage.getItem(GP.util.SAVE_KEY), history: localStorage.getItem(GP.util.HISTORY_KEY),
  account: localStorage.getItem(GP.net.ACCOUNT_KEY),
}));

// いまの ゲームを とじてから 書く（ページを はなれる ときの 自動保存で 上書き されない ように）
const writeStorage = (snapshot) => run((snap) => {
  const put = (key, value) => (value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
  GP.state.unload();
  put(GP.util.SAVE_KEY, snap.save);
  put(GP.util.HISTORY_KEY, snap.history);
  put(GP.net.ACCOUNT_KEY, snap.account);
  return true;
}, snapshot);

async function restoreStorage(snapshot) {
  if (await writeStorage(snapshot)) return true;
  await loadPage(PAGE_URL);
  return !!(await writeStorage(snapshot));
}

const readAccount = () => run(() => JSON.parse(localStorage.getItem(GP.net.ACCOUNT_KEY) || 'null'));
const setDeviceKey = (deviceKey) => run((key) => {
  const acc = JSON.parse(localStorage.getItem(GP.net.ACCOUNT_KEY));
  localStorage.setItem(GP.net.ACCOUNT_KEY, JSON.stringify({ ...acc, deviceKey: key }));
  return true;
}, deviceKey);

/* =========================================================
   そうさ（タップ・入力・窓の たしかめ）
   ========================================================= */
const modalNow = () => run(() => window.__t.modal());
const modalWith = (pattern) => waitFor(`窓「${pattern}」が 出る`, (src) => {
  const m = window.__t.modal();
  return m.open && new RegExp(src).test(m.title + '\n' + m.text) ? m : null;
}, pattern);
const modalClosed = () => waitFor('窓が とじる', () => !window.__t.modal().open);
const toastWith = (text) => waitFor(`トースト「${text}」が 出る`, (t) => window.__t.toasts().some((x) => x.includes(t)), text);
const hasToast = (text) => run((t) => window.__t.toasts().some((x) => x.includes(t)), text);
const countCalls = (method, path) => run((m, p) => window.__t.count(m, p), method, path);
const hold = () => run(() => { window.__t.hold(); return true; });
const release = () => run(() => { window.__t.release(); return true; });
const type = (text) => run((t) => window.__t.type(t), text);
const doneCount = () => run(() => window.__t.done);
const showAccount = () => run(() => { GP.main.showAccount(); return true; });
const startRanking = () => run(() => { window.__t.startRanking(); return true; });
const screenNow = () => run(() => ({
  title: !document.getElementById('title-screen').hidden, app: !document.getElementById('app').hidden, game: !!GP.state.st,
}));

async function tap(label) {
  const hit = await run((l) => window.__t.click(l), label);
  if (!hit) check(`ボタン「${label}」を おせる`, false);
  return hit;
}

async function tapBackdrop() {
  const point = { ...BACKDROP_POINT, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
  await sleep(SETTLE_MS);
}

async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...ESCAPE_KEY });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...ESCAPE_KEY });
  await sleep(SETTLE_MS);
}

/** ✕・背景タップ・Esc の どれでも とじない こと（うしろの 画面も さわれない こと） */
async function checkLocked(name) {
  const before = await modalNow();
  await tapBackdrop();
  await pressEscape();
  await run(() => { document.getElementById('modal-close').click(); return true; });
  const after = await modalNow();
  const inert = await run(() => document.getElementById('app').inert && document.getElementById('title-screen').inert);
  check(`${name}：✕・背景タップ・Esc で とじない`, !!before && !!after && after.open && after.closeHidden && after.text === before.text && inert);
}

const checkFits = async (name) => check(`${name}：スマホ幅に おさまる`, !!(await waitFor(`${name}が おさまる`, () => window.__t.fits())));

/** わざと 断らせる 手順。窓口の 断りを Chrome が コンソールに 出す ぶん（statuses）だけ エラーから のぞく */
async function refusing(statuses, work) {
  const before = errs.length;
  const out = await work();
  await sleep(LOG_SETTLE_MS);
  const expected = (e) => statuses.some((s) => e.startsWith(`ERR Failed to load resource: the server responded with a status of ${s}`));
  const fresh = errs.splice(before);
  errs.push(...fresh.filter((e) => !expected(e)));
  return out;
}

const showConquestEnding = () => run(() => {
  const st = GP.state.st;
  Object.keys(st.tiles).forEach((id) => { st.tiles[id].owner = 'player'; });
  st.ended = 'win'; st.endedBy = 'conquest'; st.endedDay = st.day;
  GP.main.showEnding();
  return GP.state.resultRecord(0);
});

const changeSave = () => run(() => { GP.state.st.res.danbo += 1; return true; });

/* =========================================================
   1. 自動の 検査では 既定で オフライン
   ========================================================= */
async function checkOfflineSwitch() {
  const off = await run(() => ({ enabled: GP.net.enabled(), base: GP.net.baseUrl(), account: GP.net.account() }));
  check('既定で オフライン（enabled が false・接続先なし）', off.enabled === false && off.base === '' && off.account === null);
}

async function checkOfflineEnding() {
  await showConquestEnding();
  await tap('さいしょから');
  const next = await modalWith(RESTART_ASK);
  check('オフライン：全制圧クリアの「さいしょから」は ランキングを 出さずに すすむ', !!next && !/ランキング/.test(next.title));
  await tap('やめる');
  await modalClosed();
}

async function checkOfflineUi() {
  const ui = await run(async () => {
    GP.main.showMenu();
    const menuItem = window.__t.click('アカウント・ひきつぎ');
    GP.ui.closeModal();
    GP.online.openAccount(() => {});
    const opened = window.__t.modal().open;
    const sent = await GP.backup.sendNow();
    GP.main.showTitle();
    return { menuItem, opened, sent, status: GP.backup.status(), titleButton: !document.getElementById('btn-account').hidden };
  });
  check('オフライン：メニューに「アカウント・ひきつぎ」が ない', ui.menuItem === false);
  check('オフライン：タイトルに ボタンが ない・アカウントの 窓も ひらかない', ui.titleButton === false && ui.opened === false);
  check('オフライン：ひかえを おくらない（off）', ui.sent === false && ui.status === 'off');
  check('オフライン：fetch が 0 回', (await run(() => window.__t.calls.length)) === 0);
}

/* =========================================================
   2. ランキング（はじめて）
   ========================================================= */
/** よその 窓口で 発行された アカウントは「無い」あつかい（その 鍵を にせ窓口へ おくらない） */
async function checkForeignAccount() {
  const seen = await run((acc) => {
    localStorage.setItem(GP.net.ACCOUNT_KEY, JSON.stringify(acc));
    return GP.net.account();
  }, FOREIGN_ACCOUNT);
  check('よその 窓口の アカウントは 無い あつかい', seen === null);
}

/** 全制圧クリア いがいの 決着では ランキングを はじめない */
async function checkTimeUpEnding() {
  const before = await countCalls('GET', '/v1/challenge/events');
  await run(() => {
    const st = GP.state.st;
    st.ended = 'timeup'; st.endedBy = 'time'; st.endedDay = st.day;
    GP.main.showEnding();
    return true;
  });
  await tap('さいしょから');
  const next = await modalWith(RESTART_ASK);
  check('タイムリミットの 決着では ランキングへ おくらない', !!next && (await countCalls('GET', '/v1/challenge/events')) === before);
  await tap('やめる');
  await modalClosed();
}

async function firstRankingToName() {
  const rec = await showConquestEnding();
  await hold();
  await tap('さいしょから');
  const busy = await modalWith('じゅんび しています');
  check('はじめて：じゅんびの 窓（ボタンなし）', !!busy && busy.buttons.length === 0 && /ランキング/.test(busy.title));
  await checkLocked('じゅんびの 窓');
  await release();
  const ask = await modalWith('名前を きめてね');
  check('はじめて：名前を きく（空の 入力らん・おくらない／おくる）', !!ask && ask.input === '' && same(ask.buttons, ['おくらない', 'おくる']));
  check('名前の 入力らん：絵文字でも 20 文字 入る 長さ（maxlength）', !!ask && ask.inputMax === NAME_MAX * UTF16_UNITS_PER_CHAR);
  await checkLocked('名前の 窓');
  await checkFits('名前の 窓');
  return rec;
}

async function checkNameRules() {
  await tap('おくる');
  const empty = await modalNow();
  await type(TOO_LONG_NAME);
  await tap('おくる');
  const long = await modalNow();
  const refused = (m) => /1〜20文字に してね/.test(m.error) && /名前を きめてね/.test(m.text);
  check('名前：空と 21 文字は おくらずに ことわる', refused(empty) && refused(long) && (await countCalls('POST', '/v1/players')) === 0);
}

async function firstRankingSend() {
  await type(XSS_NAME);
  await hold();
  await tap('おくる');
  const busy = await modalWith('おくっています');
  check('はじめて：おくって いる 窓（ボタンなし）', !!busy && busy.buttons.length === 0);
  await checkLocked('おくって いる 窓');
  await release();
  return modalWith(RANK_SENT);
}

async function checkFirstResult(rec, result) {
  check('はじめて：結果（じこベスト こうしん・じゅんい・スコア）', !!result && /じこベスト こうしん/.test(result.text)
    && /1 い（1 にん中）/.test(result.text) && result.text.includes(rec.score.toLocaleString('ja-JP')) && same(result.buttons, ['つぎへ']));
  check('はじめて：ひきつぎコードの あんないを 出す', !!result && /ひきつぎコードは メニューの「アカウント・ひきつぎ」/.test(result.text));
  check('名前（<img onerror> 入り）が 字として 出る：結果の 窓', !!result && result.text.includes(XSS_NAME) && result.imgs === 0);
  await checkLocked('結果の 窓');
  await checkFits('結果の 窓');
}

async function checkFirstRecords(rec) {
  const acc = await readAccount();
  const state = await mockState();
  const f = state.finishes[0] || { body: {} };
  const detail = { levelTotal: rec.levelTotal, daysUsed: rec.daysUsed, dayLimit: rec.dayLimit, unitAvgLv: rec.unitAvgLv, defenseTotal: rec.defenseTotal };
  check('はじめて：アカウントを 保存（鍵・番号・コード・接続先）', !!acc && acc.name === XSS_NAME && !!acc.deviceKey && !!acc.playerId
    && CODE_SHAPE.test(acc.recoveryCode) && acc.server === mock.url);
  check('にせ窓口：名前と 点・内訳を うけた', state.finishes.length === 1 && f.name === XSS_NAME && rec.score > 0
    && f.body.value === rec.score && f.body.cleared === true && same(f.body.detail, detail));
  check('板の 最短秒を あけて おくる', f.elapsedMs >= BOARD_MIN_MS && f.body.play_ms >= BOARD_MIN_MS, `${f.elapsedMs}ms`);
}

async function finishFirstRanking() {
  await tap('つぎへ');
  const next = await modalWith(RESTART_ASK);
  check('はじめて：とじると 今までの「さいしょから」の つづきへ', !!next);
  await tap('やめる');
  await modalClosed();
}

async function firstRanking() {
  const rec = await firstRankingToName();
  await checkNameRules();
  const result = await firstRankingSend();
  await checkFirstResult(rec, result);
  await checkFirstRecords(rec);
  await finishFirstRanking();
}

/* =========================================================
   3. ランキング（2 回目・名前がえ・おくらない・失敗）— done は ちょうど 1 回
   ========================================================= */
async function closeAndCountDone(label, expected) {
  const before = await doneCount();
  await tap(label);
  await sleep(SETTLE_MS);
  const m = await modalNow();
  return before === expected - 1 && (await doneCount()) === expected && !m.open && !m.backInert;
}

async function secondRanking() {
  await startRanking();
  const ask = await modalWith(RANK_CONFIRM);
  check('2 回目：名前を 入れた まま たしかめる', !!ask && ask.input === XSS_NAME);
  await sleep(SETTLE_MS);
  check('2 回目：入力らんに カーソルを 入れない（キーボードで ボタンを かくさない）', (await modalNow()).inputFocused === false);
  await tap('おくる');
  const result = await modalWith(RANK_SENT);
  check('2 回目：おなじ 点は じこベスト こうしん なし・コードの あんない なし', !!result
    && !/じこベスト こうしん/.test(result.text) && !/ひきつぎコード/.test(result.text) && result.imgs === 0);
  check('2 回目：done は とじた ときに 1 回', await closeAndCountDone('つぎへ', 1));
  const state = await mockState();
  check('2 回目：名前がえを おくらない', state.finishes.length === 2 && same(state.names, [XSS_NAME]) && (await countCalls('PATCH', '/v1/me')) === 0);
}

/** 返事を 待つ あいだに ひかえの 自動送信が 時刻を 書いた、という 場面を つくる */
const writeBackupAt = (at_ms) => run((at) => {
  const acc = JSON.parse(localStorage.getItem(GP.net.ACCOUNT_KEY));
  localStorage.setItem(GP.net.ACCOUNT_KEY, JSON.stringify({ ...acc, backupAt: at }));
  return true;
}, at_ms);

async function renamedRanking() {
  await startRanking();
  await modalWith(RANK_CONFIRM);
  await type(RENAMED);
  await hold();
  await tap('おくる');
  await modalWith('おくっています');
  await writeBackupAt(BACKUP_AT_WHILE_WAITING_MS);
  await release();
  const result = await modalWith(RANK_SENT);
  check('名前がえ：コードポイントで 20 文字の 名前が 通り、結果に 字として 出る', !!result && result.text.includes(RENAMED) && result.imgs === 0);
  check('名前がえ：done は 1 回', await closeAndCountDone('つぎへ', 2));
  const state = await mockState();
  const acc = await readAccount();
  check('名前がえ：窓口と 端末の 名前が かわる', same(state.names, [RENAMED]) && state.finishes.length === 3
    && state.finishes[2].name === RENAMED && acc.name === RENAMED);
  check('名前がえ：返事を 待つ あいだに 書かれた ひかえの 時刻を けさない', acc.backupAt === BACKUP_AT_WHILE_WAITING_MS);
}

async function declinedRanking() {
  await startRanking();
  await modalWith(RANK_CONFIRM);
  check('おくらない：done は 1 回', await closeAndCountDone('おくらない', 3));
  check('おくらない：結果は とどかない', (await mockState()).finishes.length === 3);
}

async function refusedRanking() {
  const acc = await readAccount();
  await setDeviceKey(WRONG_KEY);
  const fail = await refusing([401], async () => {
    await startRanking();
    return modalWith(RANK_FAILED);
  });
  check('失敗（鍵が つかえない）：わけを 出す', !!fail && fail.text.includes(BAD_KEY_TEXT) && same(fail.buttons, ['つぎへ']));
  await checkLocked('失敗の 窓');
  check('失敗（鍵が つかえない）：done は 1 回', await closeAndCountDone('つぎへ', 4));
  await setDeviceKey(acc.deviceKey);
}

async function unreachableRanking() {
  await run(() => { window.__t.failNext(); return true; });
  await startRanking();
  const fail = await modalWith(RANK_FAILED);
  check('失敗（つうしん できない）：わけを 出す', !!fail && /つうしん できませんでした/.test(fail.text));
  check('失敗（つうしん できない）：done は 1 回', await closeAndCountDone('つぎへ', 5));
  check('失敗しても 結果は ふえない', (await mockState()).finishes.length === 3);
  check('画面を こわす 名前の しかけが うごいて いない（ランキング）', (await run(() => window.__t.xss)) === 0);
}

async function crashedRanking() {
  await run(() => window.__t.breakOnce(GP.net, 'boardRules'));
  await startRanking();
  const fail = await modalWith(RANK_FAILED);
  check('思わぬ 例外（ランキング）：待ちの 窓を のこさず 失敗の 窓へ', !!fail && fail.text.includes('（client）') && same(fail.buttons, ['つぎへ']));
  check('思わぬ 例外（ランキング）：done は 1 回', await closeAndCountDone('つぎへ', 6));
}

/** 本物の リザルトから もう一度（main.js の つなぎを 通る）→「おくらない」→「はじめる」で 新しい ゲームへ */
async function restartAfterRanking() {
  await showConquestEnding();
  await tap('さいしょから');
  await modalWith(RANK_CONFIRM);
  await tap('おくらない');
  await modalWith(RESTART_ASK);
  await tap('はじめる');
  const fresh = await waitFor('新しい ゲーム', (units) => {
    const st = GP.state.st;
    return !!st && st.ended === null && st.units.length === units && !document.getElementById('app').hidden;
  }, FRESH_UNITS);
  check('ランキングの あと「はじめる」で 新しい ゲームへ すすめる', !!fresh);
  await sleep(SETTLE_MS);
  await run(() => { GP.ui.closeModal(); return true; });
}

/* =========================================================
   4. アカウント（ホーム・コピー・出し直し）
   ========================================================= */
async function openAccountFromMenu() {
  await run(() => { document.getElementById('btn-menu').click(); return true; });
  await modalWith('メニュー');
  await tap('アカウント・ひきつぎ');
  return modalWith(HOME);
}

async function checkAccountHome(home, acc) {
  check('ホーム：なまえ（<img onerror> 入り）・ばんごう・コードが 字として 出る', !!home && home.text.includes(RENAMED)
    && home.text.includes(acc.playerId) && home.code === acc.recoveryCode && home.imgs === 0);
  check('ホーム：ブラウザむけの 言いかえ', !!home && /ブラウザの データを けすと/.test(home.text) && !/アプリ/.test(home.text));
  await checkFits('アカウントの ホーム');
}

/** いま 出て いる ふつうの 窓（ホーム）は ✕ が 出て、背景タップ・Esc で とじる */
async function checkPlainModalCloses(name) {
  const plain = await modalNow();
  await tapBackdrop();
  const byBackdrop = !(await modalNow()).open;
  await showAccount();
  await pressEscape();
  const byEscape = !(await modalNow()).open;
  check(name, !plain.closeHidden && !plain.backInert && byBackdrop && byEscape);
  await showAccount();
  await modalWith(HOME);
}

async function checkAccountCrash() {
  await run(() => window.__t.breakOnce(GP.backup, 'sendNow'));
  await tap('いま ひかえを おくる');
  const fail = await modalWith('しょりを つづけられませんでした');
  check('思わぬ 例外（アカウント）：待ちの 窓を のこさず、とじられる 窓へ', !!fail && same(fail.buttons, ['もどる']) && !fail.closeHidden && !fail.backInert);
  await tap('もどる');
  check('思わぬ 例外（アカウント）：「もどる」で ホームへ', !!(await modalWith(HOME)));
}

const stubClipboard = (works) => run((ok) => {
  window.__t.copied = null;
  const writeText = async (text) => { if (!ok) throw new Error('denied (test)'); window.__t.copied = text; };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return true;
}, works);

async function checkCopy(code) {
  await stubClipboard(true);
  await tap('コピー');
  const good = await toastWith('ひきつぎコードを コピーしました');
  check('コピー：コードを クリップボードへ', !!good && (await run(() => window.__t.copied)) === code);
  await stubClipboard(false);
  await tap('コピー');
  check('コピー：できない ときは 落ちずに つたえる', !!(await toastWith('コピー できませんでした')));
}

async function checkReissueCancel(oldCode) {
  await tap('だしなおす');
  await modalWith('いまの コードは つかえなく なります');
  await tap('やめる');
  const back = await modalWith(HOME);
  check('出し直し：やめると ホームへ もどり、コードは そのまま', !!back && back.code === oldCode && (await countCalls('POST', '/v1/me/code')) === 0);
}

async function checkReissue(oldCode) {
  await tap('だしなおす');
  await modalWith('いまの コードは つかえなく なります');
  await hold();
  await tap('あたらしく だす');
  await modalWith('あたらしい コードを だしています');
  await checkLocked('出し直しを 待つ 窓');
  await release();
  const home = await waitFor('あたらしい コードの ホーム', (old) => { const m = window.__t.modal(); return m.code !== '' && m.code !== old ? m : null; }, oldCode);
  const acc = await readAccount();
  check('出し直し：あたらしい コードを 出して 保存', !!home && CODE_SHAPE.test(home.code) && acc.recoveryCode === home.code
    && (await hasToast('あたらしい コードを だしました')));
}

/* =========================================================
   5. セーブの ひかえ
   ========================================================= */
/** 「いま ひかえを おくる」を おして、ホームへ もどるまで 待つ → その トーストが 出たか */
async function sendBackupByTap(toast) {
  await run(() => { window.__t.clearToasts(); return true; });
  await tap('いま ひかえを おくる');
  await modalWith(HOME);
  return hasToast(toast);
}

async function checkFirstBackup(acc, puts0) {
  await changeSave();
  await hold();
  await tap('いま ひかえを おくる');
  await modalWith('ひかえを おくっています');
  await checkLocked('ひかえを おくる 窓');
  await release();
  const home = await modalWith('さいごに おくった じかん：\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}');
  const state = await mockState();
  const backup = backupOf(state, acc.playerId);
  check('ひかえ：おくると 時刻が 出る', !!home && (await hasToast('ひかえを おくりました')));
  check('にせ窓口：うけた ひかえが この 端末の セーブ・せいせきと おなじ', putsOf(state, acc.playerId) === puts0 + 1 && backup.format === 1
    && sameData(backup, await readStorage()));
  const raw = rawBackupOf(state, acc.playerId);
  check('ひかえに アカウント（鍵・コード）を 入れない', raw !== '' && !raw.includes(acc.deviceKey) && !raw.includes(acc.recoveryCode));
}

async function checkBackupDedupe(acc, puts0) {
  const before = await countCalls('PUT', '/v1/save');
  const again = await sendBackupByTap('ひかえを おくりました');
  check('ひかえ：中身が おなじなら おくらない', again && (await countCalls('PUT', '/v1/save')) === before
    && putsOf(await mockState(), acc.playerId) === puts0 + 1);
  await changeSave();
  const changed = await sendBackupByTap('ひかえを おくりました');
  check('ひかえ：中身が かわれば おくる', changed && putsOf(await mockState(), acc.playerId) === puts0 + 2);
}

async function checkBackupBadKey(acc, puts0) {
  await setDeviceKey(WRONG_KEY);
  await changeSave();
  const before = await countCalls('PUT', '/v1/save');
  const refused = await refusing([401], () => sendBackupByTap('ひかえを おくれませんでした'));
  const home = await modalNow();
  const afterFirst = await countCalls('PUT', '/v1/save');
  const stopped = await sendBackupByTap('ひかえを おくれませんでした');
  check('ひかえ：鍵が ことわられたら わけを 出す', refused && afterFirst === before + 1 && home.text.includes(BAD_KEY_TEXT));
  check('ひかえ：ことわられた 鍵では もう おくらない', stopped && (await countCalls('PUT', '/v1/save')) === afterFirst
    && putsOf(await mockState(), acc.playerId) === puts0 + 2);
  await setDeviceKey(acc.deviceKey);
  check('ひかえ：鍵が もどれば また おくる', (await sendBackupByTap('ひかえを おくりました')) && putsOf(await mockState(), acc.playerId) === puts0 + 3);
}

async function checkBackupOnHide(acc, puts0) {
  await tap('とじる');
  await changeSave();
  await run(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
    return true;
  });
  const sent = await waitFor('裏へ 回った ときの 送信', () => window.__t.calls.filter((c) => c.path === '/v1/save').pop().keepalive === true);
  await sleep(SETTLE_MS);
  const state = await mockState();
  check('ひかえ：裏へ 回る とき、セーブしてから keepalive つきで おくる', !!sent && putsOf(state, acc.playerId) === puts0 + 4
    && sameData(backupOf(state, acc.playerId), await readStorage()));
  check('画面を こわす 名前の しかけが うごいて いない（アカウント）', (await run(() => window.__t.xss)) === 0);
}

async function checkBackupOnPageHide(acc, puts0) {
  await changeSave();
  const before = await countCalls('PUT', '/v1/save');
  await run(() => { window.dispatchEvent(new Event('pagehide')); return true; });
  const sent = await waitFor('ページを はなれる ときの 送信', (n) => window.__t.count('PUT', '/v1/save') > n
    && window.__t.calls.filter((c) => c.path === '/v1/save').pop().keepalive === true, before);
  await sleep(SETTLE_MS);
  const state = await mockState();
  check('ひかえ：ページを はなれる とき（pagehide）も、セーブしてから keepalive つきで おくる', !!sent && putsOf(state, acc.playerId) === puts0 + 5
    && sameData(backupOf(state, acc.playerId), await readStorage()));
}

/* =========================================================
   6. べつの 端末からの ひきつぎ
   ========================================================= */
/** 小文字・全角・ハイフンなしを まぜた 書き方 */
function messyCode(code) {
  const plain = code.replace(/-/g, '');
  return plain.slice(0, CODE_GROUP).toLowerCase() + toFullWidth(plain.slice(CODE_GROUP, CODE_GROUP * 2)) + ' ' + plain.slice(CODE_GROUP * 2);
}

/** まえの 端末：いまの セーブを ひかえに おくってから、端末の データを ぜんぶ けす → 窓口に ある ひかえ */
async function prepareOldDevice() {
  await showAccount();
  await modalWith(HOME);
  await changeSave();
  await sendBackupByTap('ひかえを おくりました');
  const acc = await readAccount();
  const backup = backupOf(await mockState(), acc.playerId);
  const day = await run(() => GP.state.st.day);
  check('ひきつぎの じゅんび：窓口の ひかえが いまの セーブ・せいせき', sameData(backup, await readStorage()) && backup.historyCount > 0);
  await writeStorage(EMPTY_STORAGE);
  return { acc, backup, day };
}

async function openCodeInputFromTitle() {
  const title = await run(() => {
    // あたらしい 端末の タイトルには ひらいた ゲームが ない
    GP.state.unload();
    GP.main.showTitle();
    const state = { continueHidden: document.getElementById('btn-continue').hidden, accountShown: !document.getElementById('btn-account').hidden };
    document.getElementById('btn-account').click();
    return state;
  });
  const home = await modalWith('まだ アカウントが ありません');
  check('あたらしい 端末：タイトルの ボタンから ひらける（セーブなし）', title.continueHidden && title.accountShown && !!home && home.code === '');
  await tap('ひきつぎコードを いれる');
  const ask = await modalWith(CODE_ASK);
  check('コード入力：おきかわる 注意と 入力らん', !!ask && ask.input === '' && /サーバーの ひかえに おきかわります/.test(ask.text));
  await checkFits('コード入力の 窓');
  check('コード入力：入力らんに カーソルが 入る', !!(await waitFor('入力らんの フォーカス', () => document.activeElement === document.querySelector('#modal-body input'))));
}

/** みつからない コードを 入れて、ことわりの 知らせが 出た 入力の 窓まで 待つ */
const tryUnknownCode = (code) => refusing([404], async () => {
  const before = await countCalls('POST', '/v1/recover');
  await type(code);
  await tap('ひきつぐ');
  return waitFor('みつからない の 知らせ', (n) => {
    const m = window.__t.modal();
    return window.__t.count('POST', '/v1/recover') > n && /みつかりませんでした/.test(m.error) ? m : null;
  }, before);
});

async function checkWrongCodes(reissuedAwayCode) {
  await type(SHORT_CODE);
  await tap('ひきつぐ');
  const short = await modalNow();
  check('まちがった コード：かたちが ちがえば おくらない', /12もじの コードを いれてね/.test(short.error) && (await countCalls('POST', '/v1/recover')) === 0);
  const unknown = await tryUnknownCode(UNKNOWN_CODE);
  check('まちがった コード：みつからない と つたえて 入力へ もどる', !!unknown && unknown.input === '' && unknown.text.includes(CODE_ASK));
  check('出し直す 前の コードは つかえない', !!(await tryUnknownCode(reissuedAwayCode)));
  check('まちがった コードでは 端末の データを かえない', same(await readStorage(), EMPTY_STORAGE));
}

async function recoverWithMessyCode(old) {
  await type(messyCode(old.acc.recoveryCode));
  await hold();
  await tap('ひきつぐ');
  await modalWith('ひきついでいます');
  await checkLocked('ひきつぎを 待つ 窓');
  await release();
  const done = await modalWith(RECOVERED);
  check('ひきつぎ：小文字・全角・ハイフンなしの コードで できる', !!done && done.text.includes(RESTORE_TEXT.replaced));
  check('名前（<img onerror> 入り）が 字として 出る：ひきつぎの 窓', !!done && done.text.includes(RENAMED) && done.imgs === 0);
  await checkFits('ひきつぎの 結果の 窓');
}

async function checkRecovered(old) {
  const now = await readStorage();
  const acc = await readAccount();
  check('ひきつぎ：セーブと せいせきが 窓口の ひかえと おなじ', now.save === old.backup.save && now.history === old.backup.history);
  check('ひきつぎ：アカウントは おなじ 番号・コードで、鍵だけ あたらしい', acc.playerId === old.acc.playerId && acc.name === RENAMED
    && acc.recoveryCode === old.acc.recoveryCode && !!acc.deviceKey && acc.deviceKey !== old.acc.deviceKey && acc.server === mock.url);
  const dead = await refusing([401], () => run((key) => GP.net.startRun(key), old.acc.deviceKey));
  check('ひきつぎ：まえの 端末の 鍵は つかえなく なる', !!dead && dead.ok === false && dead.error === 'bad_key');
}

async function continueAfterRecover(old) {
  await tap('OK');
  const home = await modalWith(HOME);
  check('ひきつぎ：OK で ホームへ（うけとった アカウント・ひかえは まだ）', !!home && home.code === old.acc.recoveryCode
    && /さいごに おくった じかん：まだ/.test(home.text) && home.imgs === 0);
  await tap('とじる');
  await modalClosed();
  await run(() => { document.getElementById('btn-continue').click(); return true; });
  const day = await waitFor('つづきから で ゲームへ', () => (GP.state.st && !document.getElementById('app').hidden ? GP.state.st.day : null));
  check('ひきつぎ：「つづきから」で うけとった セーブを あそべる', day === old.day);
  await run(() => { GP.ui.closeModal(); return true; });
}

async function enterCodeInGame(code) {
  await showAccount();
  await modalWith(HOME);
  await tap('ひきつぎコードを いれる');
  await modalWith(CODE_ASK);
  await type(code);
  await tap('ひきつぐ');
  return modalWith(RECOVERED);
}

/** べつの プレイヤー（ひかえなし／よめない ひかえ）を ひきつぐ → この 端末の データと ゲームは そのまま */
async function recoverOther(name, backup, expectedText) {
  const before = await readStorage();
  const code = await run(async (n, data) => {
    const res = await GP.net.register(n);
    if (data) await GP.net.putBackup(res.data.deviceKey, data);
    return res.data.recoveryCode;
  }, name, backup);
  const done = await enterCodeInGame(code);
  const screen = await screenNow();
  const acc = await readAccount();
  return !!done && done.text.includes(expectedText) && done.text.includes(name) && screen.game && screen.app && !screen.title
    && acc.name === name && sameData(await readStorage(), before);
}

/** いまの セーブと せいせきに しかけ（<img onerror>）を まぜた ひかえ。読んで しまうと「なかま」「せいせき」の 画面で うごく */
async function craftedBackup() {
  const now = await readStorage();
  const save = JSON.parse(now.save);
  save.units[0].lv = '6' + XSS_NAME;
  const history = [{ ...JSON.parse(now.history)[0], levelTotal: XSS_NAME }];
  return JSON.stringify({ format: 1, save, history });
}

/** せいせきの 窓は 記録の 値を 字として 出す（記録は 引き継ぎで 外からも とどく） */
async function checkHistoryIsText() {
  const before = await readStorage();
  const shown = await run((markup) => {
    const first = GP.util.loadHistory()[0];
    GP.util.saveHistory([{ ...first, levelTotal: markup, daysUsed: markup, dayLimit: markup, defenseTotal: markup }]);
    GP.main.showHistory();
    return window.__t.modal();
  }, XSS_NAME);
  check('せいせきの 窓：記録の 中の <img onerror> も 字として 出る', shown.text.includes(XSS_NAME) && shown.imgs === 0);
  await run((history) => { localStorage.setItem(GP.util.HISTORY_KEY, history); GP.ui.closeModal(); return true; }, before.history);
  await sleep(SETTLE_MS);
}

async function recoverInGame(old) {
  const done = await enterCodeInGame(old.acc.recoveryCode);
  const screen = await screenNow();
  const now = await readStorage();
  check('ゲーム中の ひきつぎ：データを おきかえたら ゲームを とじて タイトルへ', !!done && done.text.includes(RESTORE_TEXT.replaced)
    && screen.title && !screen.app && !screen.game && now.save === old.backup.save && now.history === old.backup.history);
  await sleep(SETTLE_MS);
  const shown = await run(() => !document.getElementById('btn-continue').hidden && !document.getElementById('btn-account').hidden);
  check('ゲーム中の ひきつぎ：タイトルに「つづきから」が 出る', shown);
}

/* =========================================================
   7. べつの タブが 引き継ぎで セーブを おきかえた とき（storage イベント）
   ========================================================= */
const otherTabReplaces = () => run((key, other) => {
  window.__beforeReload = true;
  localStorage.setItem(GP.util.SAVE_KEY, other);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: String(Date.now()) }));
  const closed = GP.state.st === null;
  // この あとに 自動保存が 来た、という 場面
  GP.state.persist();
  return closed;
}, REPLACED_KEY, OTHER_TAB_SAVE);

async function otherTabChecks() {
  section('べつの タブが 引き継ぎで セーブを おきかえた とき');
  await openOnline();
  const closed = await otherTabReplaces();
  const reloaded = await waitFor('ページの 読みなおし', () => !window.__beforeReload && document.readyState === 'complete' && !!window.GP && !!GP.main);
  check('べつの タブの 引き継ぎ：この タブの ゲームを 閉じて 読みなおす', closed === true && !!reloaded);
  check('べつの タブの 引き継ぎ：うけとった セーブを この タブの 古い ゲームで 上書きしない', (await evalJs('localStorage.getItem(GP.util.SAVE_KEY)')) === OTHER_TAB_SAVE);
}

/* =========================================================
   とおし
   ========================================================= */
async function offlineChecks() {
  section('自動の 検査では 既定で オフライン');
  await openPage();
  await checkOfflineSwitch();
  await checkOfflineEnding();
  await checkOfflineUi();
}

async function rankingChecks() {
  section('ランキング（はじめて）');
  await openOnline();
  await checkForeignAccount();
  await firstRanking();
  await checkTimeUpEnding();
  section('ランキング（2 回目・名前がえ・おくらない・失敗）');
  await secondRanking();
  await renamedRanking();
  await declinedRanking();
  await refusedRanking();
  await unreachableRanking();
  await crashedRanking();
  await restartAfterRanking();
}

async function accountChecks() {
  section('アカウント（ホーム・コピー・出し直し）');
  await openOnline();
  const acc = await readAccount();
  await checkAccountHome(await openAccountFromMenu(), acc);
  await checkPlainModalCloses('ふつうの 窓は 背景タップ・Esc で とじる（とじない たしかめが 空ぶりで ない）');
  await checkCopy(acc.recoveryCode);
  await checkReissueCancel(acc.recoveryCode);
  await checkReissue(acc.recoveryCode);
  await checkPlainModalCloses('待ちの 窓の あとの ふつうの 窓は また とじられる（✕・背景タップ・Esc）');
  await checkAccountCrash();
  return acc.recoveryCode;
}

async function backupChecks() {
  section('セーブの ひかえ');
  const acc = await readAccount();
  const puts0 = putsOf(await mockState(), acc.playerId);
  await checkFirstBackup(acc, puts0);
  await checkBackupDedupe(acc, puts0);
  await checkBackupBadKey(acc, puts0);
  await checkBackupOnHide(acc, puts0);
  await checkBackupOnPageHide(acc, puts0);
}

async function recoverChecks(reissuedAwayCode) {
  section('べつの 端末からの ひきつぎ');
  const old = await prepareOldDevice();
  await openOnline();
  await openCodeInputFromTitle();
  await checkWrongCodes(reissuedAwayCode);
  await recoverWithMessyCode(old);
  await checkRecovered(old);
  await continueAfterRecover(old);
  check('ひかえなし：この 端末の データと ゲームは そのまま（none）', await recoverOther(NO_BACKUP_NAME, '', RESTORE_TEXT.none));
  check('よめない ひかえ：この 端末の データと ゲームは そのまま（broken）', await recoverOther(BROKEN_NAME, UNREADABLE_BACKUP, RESTORE_TEXT.broken));
  check('しかけ入りの ひかえ：読まずに、この 端末の データと ゲームは そのまま（broken）', await recoverOther(CRAFTED_NAME, await craftedBackup(), RESTORE_TEXT.broken));
  await checkHistoryIsText();
  await recoverInGame(old);
  check('画面を こわす 名前の しかけが うごいて いない（ひきつぎ）', (await run(() => window.__t.xss)) === 0);
  check(`にせ窓口：ひきつぎの 試しは ${RECOVER_TRIES} 回`, (await mockState()).recoverTries === RECOVER_TRIES);
}

// 本物の 窓口の URL は ログに 出さない
const originLabel = (origin) => (LOOPBACK_ORIGIN.test(origin) ? origin : 'この端末の 外');

async function allChecks() {
  await offlineChecks();
  await rankingChecks();
  const reissuedAwayCode = await accountChecks();
  await backupChecks();
  await recoverChecks(reissuedAwayCode);
  await otherTabChecks();
  await harvestFetchLog();
  const outside = fetchLog.filter((c) => c.origin !== mock.url).map((c) => originLabel(c.origin));
  const where = outside.length ? '：' + Array.from(new Set(outside)).join('・') : '';
  check('fetch は にせ窓口だけ（ほかへは 0 回）', fetchLog.length > 0 && outside.length === 0, `にせ窓口へ ${fetchLog.length - outside.length} 回 / ほかへ ${outside.length} 回${where}`);
}

function report() {
  const ng = results.filter((ok) => !ok).length;
  console.log('\n--- けっか ---');
  console.log('  たしかめ   :', results.length, `（NG ${ng}）`);
  console.log('  エラー     :', errs.length);
  errs.slice(0, ERRORS_SHOWN).forEach((e) => console.log('   ', e.slice(0, ERROR_CHARS_SHOWN)));
  if (results.length && !ng && !errs.length) console.log('  ぜんぶ ok ✓');
  return results.length > 0 && ng === 0 && errs.length === 0;
}

/* ---------- はじめに 接続先が にせ窓口で ある ことを たしかめる。ちがえば 何も せず おわる ---------- */
console.log('=== オンライン機能 とおしテスト ===');
let failed = false;
let snapshot = null;
try {
  mock = await startMock(new URL(BASE).origin);
  await leaveOldPage();
  await openOnline();
  console.log('  ok  接続先は にせ窓口（この端末の 中）');
  snapshot = await readStorage();
  if (!snapshot || !(await writeStorage(EMPTY_STORAGE))) throw new Abort('localStorage を よみ書き できない');
  await allChecks();
} catch (e) {
  failed = true;
  console.log(`\n  NG  ${e instanceof Abort ? 'ちゅうし' : 'とちゅうで エラー'}: ${e.message}`);
} finally {
  if (snapshot) {
    const restored = await restoreStorage(snapshot);
    console.log(restored ? '\n  localStorage を もとに もどしました' : '\n  NG  localStorage を もとに もどせませんでした');
    failed = failed || !restored;
    await send('Page.navigate', { url: BLANK_URL });
  }
  if (mock) mock.stop();
}
const passed = report() && !failed;
close();
process.exit(passed ? 0 : 1);
