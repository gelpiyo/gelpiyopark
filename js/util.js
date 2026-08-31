/* =========================================================
   util.js — 共通ユーティリティ / 名前空間
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';

  /* ---------- DOM ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 数値 ---------- */
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const round = (v, d) => { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; };

  function fmt(n) {
    n = Math.floor(n);
    if (n >= 1000000) return round(n / 1000000, 1) + 'M';
    if (n >= 10000) return round(n / 1000, 1) + 'k';
    return String(n);
  }

  /* ---------- 乱数（シード付き mulberry32）---------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    f.shuffle = (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    };
    return f;
  }

  // グローバル乱数（演出など、再現性が不要なもの）
  const rnd = makeRng((Date.now() ^ 0x9e3779b9) >>> 0);

  /* ---------- 保存 ---------- */
  const SAVE_KEY = 'gelpiyo-park-save-v1';

  function save(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('load failed', e);
      return null;
    }
  }
  function wipe() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
  }
  function hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  /* ---------- その他 ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function uid(prefix) {
    uid._n = (uid._n || 0) + 1;
    return (prefix || 'id') + '_' + uid._n.toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  /** 高DPI対応で canvas の実解像度を CSS サイズに合わせる */
  function fitCanvas(canvas, logicalW, logicalH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.round(logicalW * dpr);
    const h = Math.round(logicalH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** canvas 上のポインタ座標を論理座標へ変換 */
  function canvasPoint(canvas, evt, logicalW, logicalH) {
    const r = canvas.getBoundingClientRect();
    const src = evt.touches && evt.touches[0] ? evt.touches[0] : evt;
    return {
      x: ((src.clientX - r.left) / r.width) * logicalW,
      y: ((src.clientY - r.top) / r.height) * logicalH,
    };
  }

  GP.util = {
    $, $$, el, esc, clamp, lerp, round, fmt,
    makeRng, rnd, sleep, uid,
    save, load, wipe, hasSave, SAVE_KEY,
    fitCanvas, canvasPoint,
  };
})(window.GP);
