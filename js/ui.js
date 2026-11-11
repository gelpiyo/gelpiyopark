/* =========================================================
   ui.js — HUD / タブ / モーダル / トースト などの 共通UI
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const { $, el, esc } = U;

  const screens = {};       // 各画面の { render } を 登録する
  let current = 'park';
  let modalOnClose = null;
  let modalLocked = false;

  /* =========================================================
     トースト
     ========================================================= */
  /** 文字列の なかの :name: を アイコン(SVG)に する。ほかの 文字は エスケープ */
  function rich(str) {
    const esc = String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return esc.replace(/:([A-Za-z][A-Za-z0-9]*):/g, (m, n) => (GP.icons.has(n) ? GP.icons.svg(n) : m));
  }

  function toast(text, kind) {
    const root = $('#toast-root');
    const t = el('div', { class: 'toast ' + (kind || ''), html: rich(text) });
    root.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, kind === 'bad' ? 2400 : 1800);
    while (root.children.length > 3) root.firstElementChild.remove();
  }

  /* =========================================================
     モーダル
     ========================================================= */
  // 返事を 待つ あいだは うしろの 画面も さわれなく する（Tab キーで 別の 画面へ 行かせない）
  function setModalLock(on) {
    modalLocked = on;
    U.$$('body > :not(#modal-root):not(#toast-root):not(script)').forEach((n) => { n.inert = on; });
  }

  /** cfg.lock: true なら ✕・背景タップ・Esc の どれでも とじない（ボタンと closeModal() だけ） */
  function modal(cfg) {
    const root = $('#modal-root');
    $('#modal-title').innerHTML = rich(cfg.title || '');
    const body = $('#modal-body');
    body.innerHTML = '';
    if (typeof cfg.body === 'string') body.innerHTML = cfg.body;
    else if (cfg.body) body.appendChild(cfg.body);

    const foot = $('#modal-foot');
    foot.innerHTML = '';
    (cfg.buttons || []).forEach((b) => {
      const btn = el('button', {
        class: 'btn ' + (b.cls || 'btn-ghost'),
        type: 'button',
        disabled: b.disabled ? true : null,
      }, b.label);
      btn.addEventListener('click', () => {
        if (b.onClick && b.onClick() === false) return;
        if (b.keepOpen !== true) closeModal();
      });
      foot.appendChild(btn);
    });
    foot.hidden = !(cfg.buttons && cfg.buttons.length);

    setModalLock(cfg.lock === true);
    $('#modal-close').hidden = cfg.noClose === true || modalLocked;
    modalOnClose = cfg.onClose || null;
    root.hidden = false;
    body.scrollTop = 0;
    return { body, foot };
  }

  function closeModal() {
    const root = $('#modal-root');
    if (root.hidden) return;
    root.hidden = true;
    setModalLock(false);
    const cb = modalOnClose;
    modalOnClose = null;
    if (cb) cb();
  }
  function dismissModal() { if (!modalLocked) closeModal(); }
  function isModalOpen() { return !$('#modal-root').hidden; }

  /* =========================================================
     HUD
     ========================================================= */
  const KIGEN_FACE = [
    [0, 'face0'], [26, 'face1'], [40, 'face2'], [58, 'face3'], [78, 'face4'], [92, 'face5'],
  ];
  function kigenFace(v) {
    let f = 'face3';
    KIGEN_FACE.forEach((k) => { if (v >= k[0]) f = k[1]; });
    return f;
  }

  const lastRes = {};
  function refreshHud() {
    const st = St.st;
    if (!st) return;
    $('#hud-day').textContent = st.day;
    D.RES_ORDER.forEach((k) => {
      const node = $('#res-' + k);
      if (!node) return;
      const v = Math.floor(st.res[k] || 0);
      if (lastRes[k] !== undefined && lastRes[k] !== v) {
        const chip = node.closest('.res');
        chip.classList.remove('is-bump');
        void chip.offsetWidth;
        chip.classList.add('is-bump');
      }
      lastRes[k] = v;
      node.textContent = U.fmt(v);
    });
    $('#res-genki').textContent = st.genki + '/' + D.RULES.genkiMax;

    const k = st.kigen;
    $('#kigen-val').textContent = k;
    $('#kigen-face').innerHTML = GP.icons.svg(kigenFace(k));
    const fill = $('#kigen-fill');
    fill.style.width = k + '%';
    fill.classList.toggle('is-low', St.isStriking());

    // バッジ
    const badgeG = $('#badge-gacha');
    const freeReady = st.freeScoutDay !== st.day;
    badgeG.hidden = !freeReady;
    if (freeReady) badgeG.textContent = '1';

    const cap = St.teamCap();
    const badgeS = $('#badge-squad');
    const empty = cap - st.team.length;
    const canFill = st.units.length > st.team.length && empty > 0;
    badgeS.hidden = !canFill;
    if (canFill) badgeS.textContent = String(empty);
  }

  /* =========================================================
     タブ
     ========================================================= */
  function tab(name, opts) {
    if (!screens[name]) return;
    current = name;
    U.$$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    U.$$('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.tab === name));
    const sc = $('#screen-' + name + ' .screen-scroll');
    if (sc && !(opts && opts.keepScroll)) sc.scrollTop = 0;
    screens[name].render();
    refreshHud();
  }
  function rerender() {
    if (screens[current]) screens[current].render();
    refreshHud();
  }
  function register(name, obj) { screens[name] = obj; }

  /* =========================================================
     ぶひん
     ========================================================= */
  function piyoEl(unit, mood, style) {
    const wrap = el('span', { class: 'piyo-holder' });
    wrap.innerHTML = GP.piyo.svg(GP.piyo.looksOf(unit, mood));
    const s = wrap.firstElementChild;
    if (style) s.setAttribute('style', style);
    return s;
  }

  function costRow(cost) {
    const row = el('div', { class: 'cost-row' });
    Object.keys(cost).forEach((k) => {
      const lack = (St.st.res[k] || 0) < cost[k];
      row.appendChild(el('span', { class: 'cost' + (lack ? ' lack' : ''),
        html: GP.icons.res(k) + ' ' + cost[k] }));
    });
    return row;
  }

  function costText(cost) {
    return Object.keys(cost).map((k) => {
      const lack = (St.st.res[k] || 0) < cost[k];
      return `<span class="${lack ? 'lack' : ''}">${GP.icons.res(k)}${cost[k]}</span>`;
    }).join('');
  }

  /** やくわり バッジ。絵文字は 端末で 出かたが かわるので かんじ1文字で しめす */
  function roleChip(roleId) {
    const r = D.ROLES[roleId];
    return `<span class="slot-role" style="background:${r.color}">${r.short} ${r.name}</span>`;
  }

  /** ステータスの みじかい 表記（絵文字に たよらない） */
  function statLine(s) {
    return `体${s.hp}　攻${s.atk}　守${s.def}`;
  }

  function kv(k, v) {
    return el('div', { class: 'kv' }, [
      el('span', { text: k }), el('b', { html: v }),
    ]);
  }

  function yieldText(y) {
    const keys = Object.keys(y).filter((k) => y[k] > 0);
    if (!keys.length) return 'なし';
    return keys.map((k) => GP.icons.res(k) + '+' + U.round(y[k], 1)).join(' ');
  }

  /* =========================================================
     しょきか
     ========================================================= */
  function init() {
    U.$$('.tab').forEach((b) => {
      b.addEventListener('click', () => tab(b.dataset.tab));
    });
    $('#modal-close').addEventListener('click', dismissModal);
    $('#modal-backdrop').addEventListener('click', dismissModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dismissModal();
    });
  }

  GP.ui = {
    toast, modal, closeModal, isModalOpen,
    refreshHud, tab, rerender, register, init,
    piyoEl, costRow, costText, roleChip, statLine, kv, yieldText, kigenFace, rich,
    get current() { return current; },
  };
})(window.GP);
