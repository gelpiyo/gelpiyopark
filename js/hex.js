/* =========================================================
   hex.js — ヘックス（六角マス）の 座標計算
   pointy-top（とがった上）／ axial 座標 (q, r) を つかう
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';

  const SQ3 = Math.sqrt(3);

  /** axial(q,r) → 画面座標。size は 中心から かどまでの ながさ */
  function toPixel(q, r, size, ox, oy) {
    return {
      x: (ox || 0) + size * SQ3 * (q + r / 2),
      y: (oy || 0) + size * 1.5 * r,
    };
  }

  /** 画面座標 → axial（まるめ こみ） */
  function toAxial(x, y, size, ox, oy) {
    const px = x - (ox || 0);
    const py = y - (oy || 0);
    const q = (SQ3 / 3 * px - py / 3) / size;
    const r = (2 / 3 * py) / size;
    return roundAxial(q, r);
  }

  function roundAxial(q, r) {
    const s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
  }

  const DIRS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ];

  function neighbors(q, r) {
    return DIRS.map((d) => ({ q: q + d.q, r: r + d.r }));
  }

  function distance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  }

  /** ヘックスの パスを ctx に つくる（fill/stroke は 呼び出し側） */
  function path(ctx, cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* ---------- offset（行ずらし）グリッド：バトル用 ---------- */
  /** odd-r offset (col,row) → axial */
  function offsetToAxial(col, row) {
    return { q: col - ((row - (row & 1)) >> 1), r: row };
  }
  function axialToOffset(q, r) {
    return { col: q + ((r - (r & 1)) >> 1), row: r };
  }

  /** offset 座標での きょり */
  function offsetDistance(a, b) {
    return distance(offsetToAxial(a.col, a.row), offsetToAxial(b.col, b.row));
  }

  /** offset 座標での 6近傍 */
  function offsetNeighbors(col, row) {
    const ax = offsetToAxial(col, row);
    return neighbors(ax.q, ax.r).map((n) => axialToOffset(n.q, n.r));
  }

  /** offset(col,row) → 画面座標 */
  function offsetPixel(col, row, size, ox, oy) {
    return {
      x: (ox || 0) + size * SQ3 * (col + (row & 1 ? 0.5 : 0)),
      y: (oy || 0) + size * 1.5 * row,
    };
  }

  GP.hex = {
    SQ3, toPixel, toAxial, roundAxial, neighbors, distance, path, DIRS,
    offsetToAxial, axialToOffset, offsetDistance, offsetNeighbors, offsetPixel,
  };
})(window.GP);
