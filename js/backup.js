/* =========================================================
   backup.js — セーブの ひかえを 窓口へ じどうで おくる
   ・かわってから 30びょう／裏へ 回る とき（よぶのは main.js）
   ・中身が おなじなら おくらない／おくれなければ 60びょうごとに おくりなおす
   ・よみもどすのは ひきつぎの ときだけ（restore）
   （Godot版 godot/scripts/net/save_bundle.gd・save_backup.gd と おなじ ふるまい）
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const St = GP.state;
  const Net = GP.net;
  const { isObject, asList } = U;

  const FORMAT = 1;
  // 窓口の SAVE_MAX と 同じ
  const MAX_BYTES = 512 * Net.BYTES_PER_KIB;
  const SEND_DELAY_MS = 30000;
  const RETRY_MS = 60000;
  const HASH = 'SHA-256';
  const HEX_RADIX = 16;
  const HEX_WIDTH = 2;
  const REPLACED_KEY = 'gelpiyo-park-replaced-v1';
  const STATUS_TEXT = {
    failed: 'さいごの おくりは しっぱい しました。60びょうごとに おくりなおします。',
    too_big: 'ひかえが おおきすぎて おくれません。',
    no_save: 'まだ セーブが ありません。',
  };

  // status: idle / ok / failed / too_big / no_save / off（窓口に つながない）/ bad_key（別の端末で 引き継がれた）
  const state = { status: 'idle', rejectedKey: '', timer: null, sending: null };

  function parse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function settle(status, result) {
    state.status = status;
    return result;
  }

  /* =========================================================
     ひかえの かたち（Godot版と おなじ JSON。アカウントは 入れない）
     ========================================================= */
  /** セーブと せいせきを ひとつの 文字列に。セーブが オブジェクトで なければ '' */
  function pack(save, history) {
    return isObject(save) ? JSON.stringify({ format: FORMAT, save, history: asList(history) }) : '';
  }

  /** うけとった ひかえを ひらく → {save, history}。かたちが ちがえば null */
  function unpack(text) {
    const bundle = parse(text);
    if (!isObject(bundle) || bundle.format !== FORMAT || !isObject(bundle.save)) return null;
    return { save: bundle.save, history: asList(bundle.history) };
  }

  // lastSeen は 自動保存の たびに かわるので のぞく
  const withoutLastSeen = (save) =>
    (isObject(save) ? Object.fromEntries(Object.entries(save).filter(([k]) => k !== 'lastSeen')) : save);

  const toHex = (byte) => byte.toString(HEX_RADIX).padStart(HEX_WIDTH, '0');

  /** 中身が おなじかを この端末の 中で くらべる 印。つくれない 環境では ''（＝ 毎回 おくる） */
  async function digest(save, history) {
    const text = JSON.stringify([withoutLastSeen(save), asList(history)]);
    try {
      const hash = await crypto.subtle.digest(HASH, new TextEncoder().encode(text));
      return Array.from(new Uint8Array(hash), toHex).join('');
    } catch (e) {
      return '';
    }
  }

  /* =========================================================
     おくる
     ========================================================= */
  function startTimer(delay_ms) {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => { state.timer = null; sendNow(); }, delay_ms);
  }

  // 20びょうごとの 自動保存で 先のばしに ならない よう、うごいて いる あいだは かけなおさない
  function markDirty() {
    if (state.timer === null) startTimer(SEND_DELAY_MS);
  }

  function canSend(acc) {
    if (!Net.enabled() || !acc) return settle('off', false);
    if (!U.hasSave()) return settle('no_save', false);
    return acc.deviceKey !== state.rejectedKey;
  }

  // 返事を 待つ あいだに 引き継ぎで アカウントが かわって いたら 書かない
  function afterPut(res, key, mark) {
    const acc = Net.account();
    if (!acc || acc.deviceKey !== key) return;
    if (res.ok) {
      Net.saveAccount({ ...acc, backupAt: Date.now(), backupDigest: mark });
      state.status = 'ok';
    } else if (res.error === 'bad_key') {
      state.rejectedKey = key;
      state.status = 'bad_key';
    } else if (res.error === 'too_large') {
      state.status = 'too_big';
    } else {
      state.status = 'failed';
      startTimer(RETRY_MS);
    }
  }

  async function trySend(acc, keepalive) {
    const save = U.load();
    const history = U.loadHistory();
    const mark = await digest(save, history);
    if (mark !== '' && mark === acc.backupDigest) return settle('ok', true);
    const data = pack(save, history);
    if (data === '') return settle('failed', false);
    if (Net.byteLength(data) > MAX_BYTES) return settle('too_big', false);
    const res = await Net.putBackup(acc.deviceKey, data, { keepalive });
    afterPut(res, acc.deviceKey, mark);
    return res.ok;
  }

  async function sendOnce(acc, keepalive) {
    try {
      return await trySend(acc, keepalive);
    } catch (e) {
      console.warn('backup send failed: /v1/save', e && e.name);
      return settle('failed', false);
    }
  }

  /** 窓口が いまの 中身を もっていれば true（おなじ 中身で おくらなかった ときも true） */
  async function sendNow(opt) {
    // 二重に 送らない：送って いる 最中の 呼び出しは 終わるのを 待つ
    while (state.sending) await state.sending;
    const acc = Net.account();
    if (!canSend(acc)) return false;
    state.sending = sendOnce(acc, !!opt && opt.keepalive === true);
    try {
      return await state.sending;
    } finally {
      state.sending = null;
    }
  }

  const status = () => state.status;
  const statusText = () =>
    (state.status === 'bad_key' ? Net.explain({ error: 'bad_key' }) : STATUS_TEXT[state.status] || '');

  /* =========================================================
     ひきつぎ：うけとった ひかえで セーブと せいせきを おきかえる
     ========================================================= */
  // ひかえは 窓口から とどく（他人が 書ける）。画面は セーブの 値を innerHTML に 入れるので、HTML に なりうる 字（U.esc が かえる 字）は 通さない
  function isInert(v) {
    if (typeof v === 'string') return U.esc(v) === v;
    if (Array.isArray(v)) return v.every((x) => isInert(x));
    return !isObject(v) || Object.entries(v).every(([k, x]) => isInert(k) && isInert(x));
  }

  function isInertBundle(bundle) {
    try {
      return isInert(bundle.save) && isInert(bundle.history);
    } catch (e) {
      console.warn('backup check failed: 入れ子が 深すぎる ひかえ', e && e.name);
      return false;
    }
  }

  // storage イベントは ほかの タブにだけ とどく。あとに 何も のこさない よう、書いて すぐ 消す
  function announceReplaced() {
    try {
      localStorage.setItem(REPLACED_KEY, String(Date.now()));
      localStorage.removeItem(REPLACED_KEY);
    } catch (e) {
      console.warn('replace notice failed: ' + REPLACED_KEY, e && e.name);
    }
  }

  /** bundle は unpack() の かえり値。よめない・あぶない セーブなら 何も 書かずに false */
  function restore(bundle) {
    if (!bundle || !St.isLoadable(bundle.save) || !isInertBundle(bundle)) return false;
    if (!U.save(bundle.save)) return false;
    // ほかの タブが ひらいた ままの 古い ゲームで 上書き されない ように
    announceReplaced();
    // 自動保存で 上書き されない ように いまの ゲームを 閉じる（つづきは タイトルの「つづきから」）
    St.unload();
    return U.saveHistory(asList(bundle.history));
  }

  GP.backup = {
    pack, unpack, digest, markDirty, sendNow, status, statusText, restore,
    FORMAT, MAX_BYTES, SEND_DELAY_MS, RETRY_MS, REPLACED_KEY,
  };
})(window.GP);
