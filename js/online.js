/* =========================================================
   online.js — ランキング / アカウントの 画面
   ・startRanking(rec, done)：全制圧クリアの「さいしょから」で ランキングへ おくる
   ・openAccount(onReplaced)：ひきつぎコード / セーブの ひかえ / べつの 端末からの ひきつぎ
   返事を 待つ あいだの 窓は とじられない（UI.modal の lock）
   （ながれ・文言は Godot版 godot/scripts/ui/ranking_flow.gd・account_flow.gd と おなじ）
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const UI = GP.ui;
  const St = GP.state;
  const Net = GP.net;
  const Backup = GP.backup;
  const { el, isObject } = U;

  const MS_PER_SEC = 1000;
  const FOCUS_DELAY_MS = 60;
  // maxlength は UTF-16 で 数える。絵文字の ような 2 つぶんの 字でも きまりの 文字数まで 入る ように
  const UTF16_UNITS_PER_CHAR = 2;
  const CLIENT_ERROR = { ok: false, error: 'client', message: 'がめんの しょりで エラーが おきました' };

  /* =========================================================
     ぶひん
     ========================================================= */
  const isPresent = (v) => v !== null && v !== undefined;
  const thousands = (v) => (Number(v) || 0).toLocaleString('ja-JP');

  const para = (text, cls) => el('p', { class: 'hint' + (cls ? ' ' + cls : ''), text });
  const lead = (text) => el('p', { class: 'online-lead', text });
  const sectionTitle = (text) => el('h3', { class: 'panel-title online-section', text });
  const errorLine = (text) => el('p', { class: 'form-error', text });
  // UI.kv は 値を innerHTML で 入れる。名前・番号は 人や 窓口が 書ける 文字列なので かならず エスケープ
  const kvText = (k, v) => UI.kv(k, U.esc(v));
  const wideButton = (label, onclick) => el('button', { class: 'btn btn-ghost btn-block', type: 'button', onclick }, label);
  const smallButton = (label, onclick) => el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick }, label);

  function textInput(value, maxChars, placeholder) {
    return el('input', {
      class: 'text-input', type: 'text', value, placeholder, maxlength: String(maxChars * UTF16_UNITS_PER_CHAR),
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    });
  }

  const focusLater = (input) => setTimeout(() => input.focus(), FOCUS_DELAY_MS);

  // 思わぬ 例外で とじられない 窓が のこらない ように、かならず つぎの 窓（onError）へ にがす
  async function guarded(label, work, onError) {
    try {
      await work();
    } catch (e) {
      console.warn(label + ' failed', e && e.name);
      onError(CLIENT_ERROR);
    }
  }

  // 返事を 待つ あいだに 書きかわった ぶん（ひかえの 時刻など）を けさない ように、いまの 中身へ 足す
  function patchAccount(acc, patch) {
    const now = Net.account();
    const next = { ...(now && now.deviceKey === acc.deviceKey ? now : acc), ...patch };
    Net.saveAccount(next);
    return next;
  }

  /* =========================================================
     ランキング
     ========================================================= */
  // 札は 端末の 鍵が ないと もらえないので、はじめては 登録 → 札、登録ずみは 札 → 名前の 確認の 順
  const RANK_TITLE = ':trophy: ランキング';
  const NAME_MIN = 1;
  const NAME_MAX = 20;
  const DEFAULT_MIN_SEC = 3;
  const WAIT_MARGIN_SEC = 0.5;
  const DETAIL_KEYS = ['levelTotal', 'daysUsed', 'dayLimit', 'unitAvgLv', 'defenseTotal'];
  // Web版は このあと「あたらしく はじめる？」の たしかめへ すすむ（Godot版の「タイトルへ」に あたる）
  const RANK_NEXT_LABEL = 'つぎへ';

  // 窓口と おなじく コードポイントで 数える
  const isNameOk = (name) => Array.from(name).length >= NAME_MIN && Array.from(name).length <= NAME_MAX;

  const rankModal = (body, buttons) => UI.modal({ title: RANK_TITLE, body, buttons, lock: true });
  const rankBusy = (text) => rankModal(para(text, 'hint-ink'));

  // つぎの 窓を done が ひらいても とじられない ように、ボタンには false を かえす
  function rankClose(flow) {
    if (flow.closed) return false;
    flow.closed = true;
    UI.closeModal();
    flow.done();
    return false;
  }

  const rankNextButton = (flow) => ({ label: RANK_NEXT_LABEL, cls: 'btn-primary', onClick: () => rankClose(flow) });

  function rankFail(flow, res) {
    const body = el('div', {}, [
      para('ランキングに おくれませんでした。せいせきは この 端末に のこっています。', 'hint-ink'),
      para(Net.explain(res)),
    ]);
    rankModal(body, [rankNextButton(flow)]);
  }

  const rankRun = (flow, work) => guarded('ranking flow: ' + Net.board, work, (res) => rankFail(flow, res));

  async function takeTicket(flow, acc) {
    const res = await Net.startRun(acc.deviceKey);
    if (!res.ok) { rankFail(flow, res); return false; }
    flow.runId = typeof res.data.runId === 'string' ? res.data.runId : '';
    flow.runStarted_ms = performance.now();
    return true;
  }

  async function rankBegin(flow) {
    rankBusy('じゅんび しています…');
    const rules = await Net.boardRules();
    if (!rules.ok) { rankFail(flow, rules); return; }
    const minSec = Number(rules.data.minSec);
    flow.minSec = Number.isFinite(minSec) && minSec >= 0 ? minSec : DEFAULT_MIN_SEC;
    const acc = Net.account();
    if (!acc) {
      rankAskName(flow, '', `ランキングに のせる 名前を きめてね（${NAME_MIN}〜${NAME_MAX}文字）。`);
    } else if (await takeTicket(flow, acc)) {
      rankAskName(flow, String(acc.name || ''), 'この 名前で ランキングに のせます。かえる ことも できます。');
    }
  }

  function rankOnSubmit(flow, name, err) {
    if (!isNameOk(name)) {
      err.textContent = `名前は ${NAME_MIN}〜${NAME_MAX}文字に してね。`;
      return false;
    }
    rankRun(flow, () => rankSubmit(flow, name));
    return false;
  }

  function rankAskName(flow, prefill, hint) {
    const input = textInput(prefill, NAME_MAX, 'なまえ');
    const err = errorLine('');
    rankModal(el('div', {}, [para(hint, 'hint-ink'), input, err]), [
      { label: 'おくらない', cls: 'btn-ghost', onClick: () => rankClose(flow) },
      { label: 'おくる', cls: 'btn-accent', onClick: () => rankOnSubmit(flow, input.value.trim(), err) },
    ]);
    // 名前が 入って いる ときは そのまま「おくる」を おせる ように、キーボードを 出さない
    if (prefill === '') focusLater(input);
  }

  async function rankRegister(flow, name) {
    const res = await Net.register(name);
    if (!res.ok) { rankFail(flow, res); return null; }
    Net.saveAccount(res.data);
    flow.registered = true;
    return res.data;
  }

  async function rankRename(flow, acc, name) {
    const res = await Net.rename(acc.deviceKey, name);
    if (!res.ok) { rankFail(flow, res); return null; }
    return patchAccount(acc, { name });
  }

  // おくるのに つかう アカウント。だめなら null（失敗の 窓は 出しずみ）
  async function rankAccountFor(flow, name) {
    const acc = Net.account();
    if (!acc) {
      const fresh = await rankRegister(flow, name);
      return fresh && (await takeTicket(flow, fresh)) ? fresh : null;
    }
    return name === acc.name ? acc : rankRename(flow, acc, name);
  }

  async function waitMinSec(flow) {
    const need_ms = (flow.minSec + WAIT_MARGIN_SEC) * MS_PER_SEC - (performance.now() - flow.runStarted_ms);
    if (need_ms > 0) await U.sleep(need_ms);
  }

  // 点は 0 以上の 整数（窓口の 決まり）。内訳は 後から 見比べる ため おくる
  function rankPayload(flow) {
    const detail = Object.fromEntries(DETAIL_KEYS.map((k) => [k, isPresent(flow.rec[k]) ? flow.rec[k] : null]));
    return {
      value: Math.max(0, Math.floor(Number(flow.rec.score) || 0)), cleared: true,
      play_ms: Math.round(performance.now() - flow.runStarted_ms), detail,
    };
  }

  async function rankSubmit(flow, name) {
    rankBusy('おくっています…');
    const acc = await rankAccountFor(flow, name);
    if (!acc) return;
    await waitMinSec(flow);
    const res = await Net.finishRun(acc.deviceKey, flow.runId, rankPayload(flow));
    if (!res.ok) { rankFail(flow, res); return; }
    rankShowResult(flow, res.data, String(acc.name || name));
  }

  function rankRows(flow, data, name) {
    const rows = [['なまえ', name], ['こんかいの スコア', thousands(flow.rec.score)]];
    if (isPresent(data.best)) rows.push(['じこベスト', thousands(data.best)]);
    if (isPresent(data.rank)) {
      rows.push(['じゅんい', `${Math.floor(Number(data.rank) || 0)} い（${Math.floor(Number(data.participants) || 0)} にん中）`]);
    }
    return rows;
  }

  function rankShowResult(flow, data, name) {
    const body = el('div', {}, [
      lead('ランキングに おくりました！' + (data.improved === true ? '　じこベスト こうしん！' : '')),
      ...rankRows(flow, data, name).map(([k, v]) => kvText(k, v)),
    ]);
    if (flow.registered) {
      body.appendChild(para('ひきつぎコードは メニューの「アカウント・ひきつぎ」で 見られます。メモして おいてね。', 'hint-ink'));
    }
    rankModal(body, [rankNextButton(flow)]);
  }

  /** rec: St.resultRecord() の かえり値。done: どの 終わり方でも ちょうど 1 回 よぶ */
  function startRanking(rec, done) {
    // オフライン（1 ファイル版・自動の 検査）では 流れを 出さず、毎回 失敗の 窓を 出さない
    if (!Net.enabled()) { done(); return; }
    const flow = { rec, done, closed: false, runId: '', runStarted_ms: 0, minSec: DEFAULT_MIN_SEC, registered: false };
    rankRun(flow, () => rankBegin(flow));
  }

  /* =========================================================
     アカウント（ひきつぎコード / セーブの ひかえ / べつの 端末からの ひきつぎ）
     ========================================================= */
  // つぎの 窓を ひらく ボタンは false を かえす（もとの 窓の onClose を はしらせない）
  const ACC_TITLE = ':save: アカウント';
  const CODE_INPUT_MAX = 20;
  const RESTORE_TEXT = {
    replaced: 'セーブと せいせきを サーバーの ひかえから もどしました。タイトルの「つづきから」で あそべます。',
    none: 'サーバーに ひかえが なかったので、この 端末の データは そのままです。',
    broken: 'ひかえを よみこめなかったので、この 端末の データは そのままです。',
  };

  const accBusy = (text) => UI.modal({ title: ACC_TITLE, body: para(text, 'hint-ink'), lock: true });

  function accFail(flow, leadText, res) {
    UI.modal({
      title: ACC_TITLE, onClose: () => accShowHome(flow),
      body: el('div', {}, [para(leadText, 'hint-ink'), para(Net.explain(res))]),
      buttons: [{ label: 'もどる', cls: 'btn-primary' }],
    });
  }

  const accRun = (flow, work) =>
    guarded('account flow', work, (res) => accFail(flow, 'しょりを つづけられませんでした。', res));

  async function accCopy(code) {
    try {
      await navigator.clipboard.writeText(code);
      UI.toast('ひきつぎコードを コピーしました', 'good');
    } catch (e) {
      UI.toast('コピー できませんでした。コードを メモしてね', 'bad');
    }
  }

  function accCodeCard(flow, code) {
    return el('div', { class: 'code-card' }, [
      el('div', { class: 'code-text', text: code || '—' }),
      el('div', { class: 'code-actions' }, [
        smallButton('コピー', () => accCopy(code)),
        smallButton('だしなおす', () => accConfirmReissue(flow)),
      ]),
    ]);
  }

  function accBackupLines(acc) {
    const sentAt = Number.isFinite(acc.backupAt) ? U.formatDateTime(acc.backupAt) : 'まだ';
    const sendDelay_sec = Backup.SEND_DELAY_MS / MS_PER_SEC;
    return [
      'さいごに おくった じかん：' + sentAt,
      Backup.statusText(),
      `ふだんは じどうで おくります（かわってから ${sendDelay_sec}びょう・ブラウザを とじた とき）。`,
    ].filter((line) => line !== '');
  }

  function accAccountParts(flow, acc) {
    return [
      kvText('なまえ', String(acc.name || '')),
      kvText('ばんごう', String(acc.playerId || '')),
      sectionTitle('ひきつぎコード'),
      accCodeCard(flow, String(acc.recoveryCode || '')),
      para('きしゅへんこうや ブラウザの データを けした ときに つかいます。メモして、だれにも 見せないでね。'
        + 'ブラウザの データを けすと、この コードでしか もどせません。'),
      sectionTitle('セーブの ひかえ'),
      ...accBackupLines(acc).map((line) => para(line, 'hint-ink')),
      wideButton('いま ひかえを おくる', () => accRun(flow, () => accSendBackupNow(flow))),
    ];
  }

  function accShowHome(flow) {
    const acc = Net.account();
    const body = el('div', {}, [
      ...(acc ? accAccountParts(flow, acc)
        : [para('まだ アカウントが ありません。ぜん制圧で クリアして ランキングに おくると つくられます。', 'hint-ink')]),
      sectionTitle('べつの 端末から ひきつぐ'),
      para('きしゅへんこうの ときは、あたらしい 端末で まえの 端末の ひきつぎコードを いれてね。'),
      wideButton('ひきつぎコードを いれる', () => accAskCode(flow, '')),
    ]);
    UI.modal({ title: ACC_TITLE, body, buttons: [{ label: 'とじる', cls: 'btn-primary' }] });
  }

  async function accSendBackupNow(flow) {
    accBusy('ひかえを おくっています…');
    if (St.st) St.persist();
    const ok = await Backup.sendNow();
    UI.toast(ok ? 'ひかえを おくりました' : 'ひかえを おくれませんでした', ok ? 'good' : 'bad');
    accShowHome(flow);
  }

  /* ---------- コードの 出し直し ---------- */
  function accConfirmReissue(flow) {
    UI.modal({
      title: ACC_TITLE, onClose: () => accShowHome(flow),
      body: para('あたらしい コードを だすと、いまの コードは つかえなく なります。', 'hint-ink'),
      buttons: [
        { label: 'やめる', cls: 'btn-ghost' },
        { label: 'あたらしく だす', cls: 'btn-danger', onClick: () => { accRun(flow, () => accReissue(flow)); return false; } },
      ],
    });
  }

  async function accReissue(flow) {
    accBusy('あたらしい コードを だしています…');
    const acc = Net.account();
    const res = await Net.reissueCode(acc ? acc.deviceKey : '');
    const code = res.ok && typeof res.data.recoveryCode === 'string' ? res.data.recoveryCode : '';
    if (!acc || code === '') {
      accFail(flow, 'コードを だしなおせませんでした。', res.ok ? { error: 'bad_reply', message: '窓口の 返事に コードが ありません' } : res);
      return;
    }
    patchAccount(acc, { recoveryCode: code });
    UI.toast('あたらしい コードを だしました。メモしてね', 'good');
    accShowHome(flow);
  }

  /* ---------- べつの 端末からの ひきつぎ ---------- */
  function accOnCodeEntered(flow, raw, err) {
    const code = Net.code.normalized(raw);
    if (!Net.code.isValid(code)) {
      err.textContent = `${Net.code.LENGTH}もじの コードを いれてね（0・O・1・I は つかわれて いません）。`;
      return false;
    }
    accRun(flow, () => accRecover(flow, Net.code.formatted(code)));
    return false;
  }

  function accAskCode(flow, errorText) {
    const input = textInput('', CODE_INPUT_MAX, 'XXXX-XXXX-XXXX');
    const err = errorLine(errorText);
    const body = el('div', {}, [
      para(`まえの 端末で メモした ひきつぎコード（${Net.code.LENGTH}もじ）を いれてね。`, 'hint-ink'),
      para('この 端末の セーブ・せいせき・アカウントは、サーバーの ひかえに おきかわります。まえの 端末では つかえなく なります。', 'hint-ng'),
      input, err,
    ]);
    UI.modal({
      title: ACC_TITLE, body, onClose: () => accShowHome(flow),
      buttons: [
        { label: 'やめる', cls: 'btn-ghost' },
        { label: 'ひきつぐ', cls: 'btn-accent', onClick: () => accOnCodeEntered(flow, input.value, err) },
      ],
    });
    focusLater(input);
  }

  // アカウントを 書く まえに よぶ（新しい 鍵で この端末の ふるい データが 先に おくられない ように）
  function accRestore(save) {
    if (!isObject(save)) return 'none';
    const bundle = Backup.unpack(typeof save.data === 'string' ? save.data : '');
    return bundle && Backup.restore(bundle) ? 'replaced' : 'broken';
  }

  async function accRecover(flow, code) {
    accBusy('ひきついでいます…');
    const res = await Net.recover(code);
    if (!res.ok) { accAskCode(flow, Net.explain(res)); return; }
    const restored = accRestore(res.data.save);
    Net.saveAccount(Net.accountFromRecover(res.data, code));
    if (restored === 'replaced' && flow.onReplaced) flow.onReplaced();
    accShowRecovered(flow, String(res.data.name || ''), restored);
  }

  function accShowRecovered(flow, name, restored) {
    const body = el('div', {}, [
      lead('ひきつぎ できました！'),
      kvText('なまえ', name),
      para(RESTORE_TEXT[restored], 'hint-ink'),
      para('まえの 端末では、もう ランキングや ひかえが つかえません。'),
    ]);
    UI.modal({ title: ACC_TITLE, body, onClose: () => accShowHome(flow), buttons: [{ label: 'OK', cls: 'btn-primary' }] });
  }

  /** onReplaced: ひきつぎで この端末の データを おきかえた ときに よぶ（いまの ゲーム画面を とじて タイトルへ） */
  function openAccount(onReplaced) {
    if (!Net.enabled()) return;
    accShowHome({ onReplaced });
  }

  GP.online = { startRanking, openAccount, NAME_MAX };
})(window.GP);
