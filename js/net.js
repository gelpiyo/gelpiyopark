/* =========================================================
   net.js — αTEST の 窓口との やりとり / アカウント / ひきつぎコード
   かえり値は すべて {ok: true, data} か {ok: false, error, message}
   （入口・項目名・断りの 名前は Godot版 godot/scripts/net/ranking_api.gd と おなじ）
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const { isObject, asList } = GP.util;

  const CONFIG = GP.netConfig || { baseUrl: '', board: '' };
  const TIMEOUT_MS = 15000;
  const HTTP_OK_MIN = 200;
  const HTTP_OK_MAX = 299;
  const BYTES_PER_KIB = 1024;
  // Chromium は keepalive の 本文が 64KiB を こえると 何も 送らずに 失敗する
  const KEEPALIVE_MAX_BYTES = 60 * BYTES_PER_KIB;
  const APP_VERSION = 'web';
  const ACCOUNT_KEY = 'gelpiyo-park-account-v1';
  const WEB_PROTOCOLS = ['http:', 'https:'];
  const TEST_PROTOCOL = 'http:';
  const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
  const HEADLESS_UA = /HeadlessChrome/;
  const ERROR_TEXT = {
    network: 'つうしん できませんでした。でんぱの よい ところで もういちど ためしてね。',
    offline: '窓口に つながない せっていで うごいています。',
    bad_key: 'この端末の登録が使えなくなっています（別の端末で引き継いだ可能性）',
    code_not_found: 'その ひきつぎコードは みつかりませんでした。',
    bad_code: 'ひきつぎコードの かたちが ちがいます。',
    too_many: 'ためしすぎです。10分ほど まってから もういちど ためしてね。',
    too_large: 'セーブの ひかえが おおきすぎて おくれません。',
  };

  const byteLength = (text) => new TextEncoder().encode(text).length;
  const fail = (error, message) => ({ ok: false, error, message });

  // 中身（鍵が 入りうる）を ログに 出さない ため、よめない 理由は すてる
  function parseObject(text) {
    try {
      const parsed = JSON.parse(text);
      return isObject(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  /* =========================================================
     つなぐか どうか
     ========================================================= */
  let testUrl = '';

  // headless chrome は --remote-debugging-port だけでは webdriver が true に ならないので UA も 見る
  const automated = () => navigator.webdriver === true || HEADLESS_UA.test(navigator.userAgent || '');
  // 自動の 検査の 結果を 本番の 記録に 書かない
  const configuredUrl = () => (automated() ? '' : CONFIG.baseUrl || '');

  /** いまの 接続先。'' なら オフライン（窓口へ 1 回も 通信しない） */
  function baseUrl() {
    return WEB_PROTOCOLS.includes(location.protocol) ? (testUrl || configuredUrl()) : '';
  }
  const enabled = () => baseUrl() !== '';

  /** テスト用：にせ窓口へ つなぐ。この端末の 中（ループバックの http）しか うけない */
  function useTestServer(url) {
    const u = new URL(url);
    if (u.protocol !== TEST_PROTOCOL || !LOOPBACK_HOSTS.includes(u.hostname)) {
      throw new Error('useTestServer: うけるのは ループバックの http だけ（' + LOOPBACK_HOSTS.join(' / ') + '）');
    }
    testUrl = u.origin;
  }

  /* =========================================================
     通信
     ========================================================= */
  // 事前確認（CORS）で 止まらない よう、ヘッダーは この 2 つ いがい 付けない
  function requestInit(method, body, key, keepalive) {
    const hasBody = body !== undefined;
    const text = hasBody ? JSON.stringify(body) : '';
    const headers = {};
    if (hasBody) headers['Content-Type'] = 'application/json';
    if (key) headers.Authorization = 'Bearer ' + key;
    const init = { method, headers };
    if (hasBody) init.body = text;
    if (keepalive === true && byteLength(text) <= KEEPALIVE_MAX_BYTES) init.keepalive = true;
    return init;
  }

  function toResult(status, data, path) {
    if (status >= HTTP_OK_MIN && status <= HTTP_OK_MAX) return { ok: true, data };
    const error = typeof data.error === 'string' && data.error ? data.error : 'http_' + status;
    const message = typeof data.message === 'string' ? data.message : `${path} で エラー（${status}）`;
    return fail(error, message);
  }

  async function send(method, path, body, key, keepalive) {
    const base = baseUrl();
    if (!base) return fail('offline', `窓口の URL が ありません（${path}）`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(base + path, { ...requestInit(method, body, key, keepalive), signal: ctl.signal });
      return toResult(res.status, parseObject(await res.text()), path);
    } catch (e) {
      return fail('network', `つうしん できませんでした（${path}${ctl.signal.aborted ? ' / じかんぎれ' : ''}）`);
    } finally {
      clearTimeout(timer);
    }
  }

  /* =========================================================
     入口
     ========================================================= */
  const boardPath = () => '/v1/challenge/' + encodeURIComponent(CONFIG.board);

  const register = (name) => send('POST', '/v1/players', { name });
  const rename = (key, name) => send('PATCH', '/v1/me', { name }, key);
  /** → {recoveryCode}。前の コードは 使えなくなる */
  const reissueCode = (key) => send('POST', '/v1/me/code', {}, key);
  /** → {playerId, name, deviceKey, save: {data, ...} か null}。前の端末の 鍵は すべて 消える */
  const recover = (code) => send('POST', '/v1/recover', { code });
  const startRun = (key) => send('POST', boardPath() + '/runs', {}, key);
  const finishRun = (key, runId, payload) =>
    send('POST', `${boardPath()}/runs/${encodeURIComponent(runId)}/finish`, payload, key);

  /** data は JSON の 文字列（512KiB まで）→ {ok, size, updatedAt} */
  function putBackup(key, data, opt) {
    const body = { data, appVersion: APP_VERSION, savedAt: new Date().toISOString() };
    return send('PUT', '/v1/save', body, key, !!opt && opt.keepalive === true);
  }

  /** この板の 受け付けの 決まり（minSec など）。開催の 外なら ok: false（not_open） */
  async function boardRules() {
    const res = await send('GET', '/v1/challenge/events');
    if (!res.ok) return res;
    const boards = asList(res.data.events)
      .filter((ev) => isObject(ev) && ev.active)
      .flatMap((ev) => asList(ev.boards));
    const hit = boards.find((b) => isObject(b) && b.board === CONFIG.board);
    return hit ? { ok: true, data: hit } : fail('not_open', 'いまは ランキングの 開催期間では ありません');
  }

  function explain(res) {
    const error = (res && res.error) || '';
    // constructor の ような どの オブジェクトにも ある 名前を、文言の 表の 項目と 取りちがえない
    const known = Object.prototype.hasOwnProperty.call(ERROR_TEXT, error) ? ERROR_TEXT[error] : '';
    return known || `${(res && res.message) || ''}（${error}）`;
  }

  /* =========================================================
     アカウント（セーブとは べつの キー）
     ========================================================= */
  function readStoredAccount() {
    try {
      return parseObject(localStorage.getItem(ACCOUNT_KEY) || '');
    } catch (e) {
      console.warn('account load failed: ' + ACCOUNT_KEY, e);
      return {};
    }
  }

  /** この端末の アカウント。無い・いまの 接続先で 発行した ものでは ない → null */
  function account() {
    const base = baseUrl();
    const acc = readStoredAccount();
    const hasKey = typeof acc.deviceKey === 'string' && acc.deviceKey !== '';
    // にせ窓口の 鍵を 本物へ、本物の 鍵を にせ窓口へ 送らない
    return base && hasKey && acc.server === base ? acc : null;
  }

  /** いまの 接続先を server に きざんで 保存する。オフライン・保存できない ときは false */
  function saveAccount(acc) {
    const base = baseUrl();
    if (!base || !isObject(acc)) return false;
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...acc, server: base }));
      return true;
    } catch (e) {
      console.warn('account save failed: ' + ACCOUNT_KEY, e);
      return false;
    }
  }

  /** 引き継ぎの 返事から この端末の アカウントを つくる（引き継いでも コードは かわらない） */
  const accountFromRecover = (data, code) =>
    ({ playerId: data.playerId || '', name: data.name || '', deviceKey: data.deviceKey || '', recoveryCode: code });

  /* =========================================================
     ひきつぎコード（英数 12 文字・XXXX-XXXX-XXXX。0・O・1・I は 使われない）
     ========================================================= */
  const CODE_LENGTH = 12;
  const CODE_GROUP = 4;
  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const FULLWIDTH_FIRST = 0xFF01;
  const FULLWIDTH_LAST = 0xFF5E;
  const FULLWIDTH_OFFSET = 0xFEE0;
  const CODE_CHAR = /^[0-9A-Z]$/;

  // 窓口は 全角を すてて 読んで しまうので、ここで 半角に そろえる
  function halfWidth(c) {
    const cp = c.codePointAt(0);
    return cp >= FULLWIDTH_FIRST && cp <= FULLWIDTH_LAST ? String.fromCodePoint(cp - FULLWIDTH_OFFSET) : c;
  }

  // 1 文字ずつ 大文字に する（ß のように 2 文字に ふえる 字を コードの 一部に しない）
  const normalized = (raw) =>
    Array.from(String(raw), (c) => halfWidth(c).toUpperCase()).filter((c) => CODE_CHAR.test(c)).join('');

  const isValid = (code) =>
    typeof code === 'string' && code.length === CODE_LENGTH && Array.from(code).every((c) => CODE_ALPHABET.includes(c));

  const formatted = (code) =>
    Array.from({ length: Math.ceil(code.length / CODE_GROUP) }, (_, i) => code.slice(i * CODE_GROUP, (i + 1) * CODE_GROUP)).join('-');

  GP.net = {
    enabled, baseUrl, useTestServer,
    get board() { return CONFIG.board || ''; },
    register, rename, reissueCode, recover, putBackup, startRun, finishRun, boardRules, explain,
    account, saveAccount, accountFromRecover, ACCOUNT_KEY,
    code: { normalized, isValid, formatted, LENGTH: CODE_LENGTH },
    byteLength, BYTES_PER_KIB, TIMEOUT_MS, KEEPALIVE_MAX_BYTES,
  };
})(window.GP);
