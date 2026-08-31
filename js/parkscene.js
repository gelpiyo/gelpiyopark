/* =========================================================
   parkscene.js — こうえんの 2Dビュー（進捗が そのまま 絵になる）
   ・たてた ゆうぐが 絵として ならぶ（Lvで バッジ・少し大きく）
   ・なかまの ぴよが こうえんを おさんぽ する
   ・ごきげん度で てんき が かわる（晴れ／くもり／ストライキ中は 雨）
   ・フェンスの ペナントは 19区画の しはい状況（＝なわばりの進捗）
   ・絵の ゆうぐを タップすると きょうか画面が ひらく
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const { $ } = U;

  const CW = 640, CH = 300;
  const HORIZON = 100;                 // ここから したが じめん
  const TAU = Math.PI * 2;

  let rafId = 0;
  let last = 0;
  let tm = 0;                          // アニメ用の つうさん時間
  const actors = new Map();            // uid -> ぴよ
  let rects = [];                      // タップ判定 {idx, cx, top, w, h}
  let clouds = [];
  let drops = [];
  const decoRng = U.makeRng(424242);
  let tufts = null;                    // くさ・こいし（固定の かざり）
  let sparkles = [];

  /* ---------------------------------------------------------
     はいち：グリッドの ます目 → 絵の なかの 座標
     --------------------------------------------------------- */
  function slotPos(i) {
    const col = i % 4, row = (i / 4) | 0;
    const jx = Math.sin((i + 1) * 12.9898) * 12;
    const stag = (row % 2) * 76;       // 千鳥はいち：まえの列と かさならない ように
    return {
      x: U.clamp(64 + col * 157 + stag + jx, 58, CW - 58),
      y: 152 + row * 46,               // 接地ライン（ベースライン）
      s: 0.68 + row * 0.1,             // おくは ちいさく
    };
  }

  /* ---------------------------------------------------------
     どうぐ
     --------------------------------------------------------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------------
     ゆうぐの 絵（すべて ベースライン y=0、はば ±55 くらい）
     --------------------------------------------------------- */
  const FAC_DRAW = {
    sunaba(ctx) {
      ctx.fillStyle = '#C9A063'; rr(ctx, -44, -22, 88, 22, 7); ctx.fill();
      ctx.fillStyle = '#E0BC7F'; rr(ctx, -44, -22, 88, 8, 5); ctx.fill();
      ctx.fillStyle = '#F2DFAE';
      ctx.beginPath(); ctx.ellipse(0, -14, 34, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#EAD08F';
      ctx.beginPath(); ctx.moveTo(-13, -14); ctx.quadraticCurveTo(0, -30, 13, -14);
      ctx.closePath(); ctx.fill();
      // スコップ
      ctx.strokeStyle = '#E4614F'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(22, -14); ctx.lineTo(30, -32); ctx.stroke();
      ctx.fillStyle = '#E4614F';
      ctx.beginPath(); ctx.moveTo(17, -16); ctx.lineTo(28, -11); ctx.lineTo(24, -4);
      ctx.lineTo(14, -9); ctx.closePath(); ctx.fill();
    },
    swing(ctx, lv, t) {
      ctx.strokeStyle = '#D96C4F'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-46, 0); ctx.lineTo(-34, -56); ctx.moveTo(-22, 0); ctx.lineTo(-34, -56);
      ctx.moveTo(46, 0); ctx.lineTo(34, -56); ctx.moveTo(22, 0); ctx.lineTo(34, -56);
      ctx.moveTo(-36, -56); ctx.lineTo(36, -56);
      ctx.stroke();
      [[-14, 0], [14, 2.1]].forEach(([ox, ph]) => {
        const a = Math.sin(t * 1.7 + ph) * 0.32;
        ctx.save(); ctx.translate(ox, -54); ctx.rotate(a);
        ctx.strokeStyle = '#8A7969'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, 36);
        ctx.moveTo(6, 0); ctx.lineTo(6, 36); ctx.stroke();
        ctx.fillStyle = '#FFC93C'; rr(ctx, -9, 36, 18, 5, 2.5); ctx.fill();
        ctx.restore();
      });
    },
    fountain(ctx, lv, t) {
      ctx.fillStyle = '#9FB6C4'; rr(ctx, -8, -32, 16, 32, 3); ctx.fill();
      ctx.fillStyle = '#B8CCD9'; rr(ctx, -24, -40, 48, 10, 5); ctx.fill();
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      [-1, 1].forEach((dir) => {
        ctx.strokeStyle = 'rgba(94,196,226,.9)';
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const p = k / 8;
          const x = dir * p * 20;
          const y = -38 - Math.sin(p * Math.PI) * (12 + Math.sin(t * 3) * 2) + p * 12;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
      ctx.fillStyle = 'rgba(127,212,232,.55)';
      ctx.beginPath(); ctx.ellipse(0, -2, 28, 6, 0, 0, TAU); ctx.fill();
    },
    gym(ctx) {
      ctx.lineWidth = 4; ctx.lineCap = 'round';
      ['#E4614F', '#4EA8DE', '#F0A020'].forEach((c, ring) => {
        ctx.strokeStyle = c;
        ctx.beginPath(); ctx.arc(0, 0, 46 - ring * 14, Math.PI, 0); ctx.stroke();
      });
      ctx.strokeStyle = 'rgba(74,58,44,.35)'; ctx.lineWidth = 3;
      [-32, 0, 32].forEach((x) => {
        const h = Math.sqrt(Math.max(0, 46 * 46 - x * x));
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, -h); ctx.stroke();
      });
    },
    candy(ctx) {
      ctx.fillStyle = '#8A6437';
      ctx.fillRect(-38, -56, 5, 30); ctx.fillRect(33, -56, 5, 30);
      ctx.fillStyle = '#B98A50'; rr(ctx, -40, -28, 80, 28, 4); ctx.fill();
      ctx.fillStyle = '#FFF6E6'; rr(ctx, -36, -25, 72, 12, 3); ctx.fill();
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = k % 2 ? '#fff' : '#EF6B6B';
        const x0 = -45 + k * 15;
        ctx.beginPath(); ctx.moveTo(x0, -56); ctx.lineTo(x0 + 15, -56);
        ctx.lineTo(x0 + 15, -46); ctx.quadraticCurveTo(x0 + 7.5, -41, x0, -46);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#BEEAF7'; ctx.beginPath(); ctx.arc(-16, -34, 6.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FF8FA3'; ctx.beginPath(); ctx.arc(16, -34, 5, 0, TAU); ctx.fill();
    },
    slide(ctx) {
      ctx.strokeStyle = '#8A7969'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-40, -54);
      ctx.moveTo(-27, 0); ctx.lineTo(-27, -54); ctx.stroke();
      ctx.lineWidth = 3;
      for (let k = 1; k < 5; k++) {
        ctx.beginPath(); ctx.moveTo(-40, -k * 11); ctx.lineTo(-27, -k * 11); ctx.stroke();
      }
      ctx.fillStyle = '#F0A020'; rr(ctx, -46, -62, 30, 9, 4); ctx.fill();
      ctx.fillStyle = '#EF6B6B';
      ctx.beginPath(); ctx.moveTo(-18, -58); ctx.lineTo(-5, -58);
      ctx.quadraticCurveTo(28, -46, 46, -4); ctx.lineTo(31, 0);
      ctx.quadraticCurveTo(15, -36, -18, -47); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#F58A7A'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-14, -52); ctx.quadraticCurveTo(20, -41, 38, -3); ctx.stroke();
    },
    base(ctx) {
      ctx.fillStyle = '#D2A468'; rr(ctx, -40, -44, 80, 44, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(122,84,51,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-40, -30); ctx.lineTo(40, -30);
      ctx.moveTo(-40, -16); ctx.lineTo(40, -16); ctx.stroke();
      ctx.fillStyle = '#C0925A';
      ctx.beginPath(); ctx.moveTo(-45, -44); ctx.lineTo(0, -64); ctx.lineTo(45, -44);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7A5433';
      ctx.beginPath(); ctx.arc(0, 0, 13, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#8A7969'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(0, -80); ctx.stroke();
      ctx.fillStyle = '#4EA8DE';
      ctx.beginPath(); ctx.moveTo(0, -80); ctx.lineTo(17, -74.5); ctx.lineTo(0, -69);
      ctx.closePath(); ctx.fill();
    },
    house(ctx) {
      ctx.fillStyle = '#FFE9B0'; rr(ctx, -30, -38, 60, 38, 4); ctx.fill();
      ctx.fillStyle = '#E4614F';
      ctx.beginPath(); ctx.moveTo(-36, -38); ctx.lineTo(0, -60); ctx.lineTo(36, -38);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7A5433';
      ctx.beginPath(); ctx.arc(0, 0, 10, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#BEEAF7';
      ctx.beginPath(); ctx.arc(-16, -26, 5.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(16, -26, 5.5, 0, TAU); ctx.fill();
    },
    craft(ctx) {
      ctx.fillStyle = '#8A6437'; ctx.fillRect(-30, -20, 6, 20); ctx.fillRect(24, -20, 6, 20);
      ctx.fillStyle = '#B98A50'; rr(ctx, -36, -27, 72, 9, 3); ctx.fill();
      ctx.fillStyle = '#E4614F'; rr(ctx, -15, -43, 30, 16, 3); ctx.fill();
      ctx.fillStyle = '#B94434'; rr(ctx, -15, -43, 30, 5, 2.5); ctx.fill();
      ctx.strokeStyle = '#4A3A2C'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, -43, 6, Math.PI, 0); ctx.stroke();
      // かなづち
      ctx.strokeStyle = '#A97B45'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(24, -30); ctx.lineTo(34, -44); ctx.stroke();
      ctx.fillStyle = '#8C8C94'; rr(ctx, 28, -50, 12, 8, 2); ctx.fill();
    },
    fort(ctx) {
      ctx.fillStyle = '#EAD08F';
      rr(ctx, -44, -38, 22, 38, 3); ctx.fill();
      rr(ctx, 22, -38, 22, 38, 3); ctx.fill();
      rr(ctx, -24, -26, 48, 26, 2); ctx.fill();
      ctx.fillStyle = '#DDBF79';
      [-44, 22].forEach((bx) => {
        for (let k = 0; k < 3; k++) ctx.fillRect(bx + k * 8, -43, 5, 6);
      });
      ctx.fillStyle = '#C9A063';
      ctx.beginPath(); ctx.arc(0, 0, 9, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#8A7969'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-33, -43); ctx.lineTo(-33, -56); ctx.stroke();
      ctx.fillStyle = '#FFC93C';
      ctx.beginPath(); ctx.moveTo(-33, -56); ctx.lineTo(-21, -52); ctx.lineTo(-33, -48);
      ctx.closePath(); ctx.fill();
    },
    bench(ctx) {
      ctx.fillStyle = '#9E6844';
      ctx.fillRect(-25, -16, 5, 16); ctx.fillRect(20, -16, 5, 16);
      ctx.fillRect(-25, -34, 5, 14); ctx.fillRect(20, -34, 5, 14);
      ctx.fillStyle = '#C9865C';
      rr(ctx, -30, -21, 60, 6, 3); ctx.fill();
      rr(ctx, -30, -37, 60, 5, 2.5); ctx.fill();
    },
    flower(ctx, lv, t) {
      ctx.fillStyle = '#8A6437'; rr(ctx, -32, -13, 64, 13, 4); ctx.fill();
      ctx.fillStyle = '#A97B45'; rr(ctx, -32, -13, 64, 5, 3); ctx.fill();
      const cols = ['#FF8FA3', '#FFC93C', '#8B6FD6', '#EF6B6B'];
      for (let k = 0; k < 4; k++) {
        const fx = -22 + k * 15;
        const sway = Math.sin(t * 1.6 + k * 1.4) * 2;
        ctx.strokeStyle = '#5FA84C'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(fx, -13);
        ctx.quadraticCurveTo(fx + sway * 0.5, -22, fx + sway, -28); ctx.stroke();
        ctx.fillStyle = cols[k];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * TAU;
          ctx.beginPath();
          ctx.arc(fx + sway + Math.cos(a) * 4.4, -28 + Math.sin(a) * 4.4, 3, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#FFF3D0';
        ctx.beginPath(); ctx.arc(fx + sway, -28, 2.6, 0, TAU); ctx.fill();
      }
    },
  };

  /* ---------------------------------------------------------
     てんき（ごきげん度から）
     --------------------------------------------------------- */
  function weatherOf() {
    const st = St.st;
    if (!st) return 'sunny';
    if (St.isStriking()) return 'rain';
    if (st.kigen < 45) return 'cloudy';
    if (st.kigen >= 75) return 'super';
    return 'sunny';
  }

  /* ---------------------------------------------------------
     ぴよ（おさんぽ）
     --------------------------------------------------------- */
  function syncActors() {
    const st = St.st;
    if (!st) return;
    const show = st.units.slice(0, 9);
    const ids = new Set(show.map((u) => u.uid));
    for (const k of actors.keys()) if (!ids.has(k)) actors.delete(k);
    show.forEach((u) => {
      if (actors.has(u.uid)) { actors.get(u.uid).u = u; return; }
      actors.set(u.uid, {
        u,
        x: 60 + U.rnd() * 520,
        y: HORIZON + 30 + U.rnd() * (CH - HORIZON - 44),
        tx: 0, ty: 0, wait: U.rnd() * 2, flip: U.rnd.chance(0.5),
        hop: U.rnd() * TAU,
      });
    });
  }

  function pickTarget(a) {
    const st = St.st;
    const built = st.plots
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p && x.i < St.plotsOpen());
    if (built.length && U.rnd.chance(0.7)) {
      const b = U.rnd.pick(built);
      const pos = slotPos(b.i);
      a.tx = U.clamp(pos.x + (U.rnd() - 0.5) * 90, 24, CW - 24);
      a.ty = U.clamp(pos.y + 8 + U.rnd() * 22, HORIZON + 26, CH - 12);
    } else {
      a.tx = 24 + U.rnd() * (CW - 48);
      a.ty = HORIZON + 26 + U.rnd() * (CH - HORIZON - 38);
    }
  }

  function updateActors(dt) {
    actors.forEach((a) => {
      a.hop += dt * 6;
      if (a.wait > 0) { a.wait -= dt; return; }
      if (!a.tx) pickTarget(a);
      const dx = a.tx - a.x, dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) {
        a.wait = 0.8 + U.rnd() * 2.6;
        a.tx = 0;
        if (U.rnd.chance(0.4)) a.flip = !a.flip;
        return;
      }
      const spd = 26;
      a.x += (dx / d) * spd * dt;
      a.y += (dy / d) * spd * dt;
      a.flip = dx < 0;
    });
  }

  /* ---------------------------------------------------------
     はいけい
     --------------------------------------------------------- */
  function makeTufts() {
    tufts = [];
    for (let i = 0; i < 26; i++) {
      tufts.push({
        x: decoRng() * CW,
        y: HORIZON + 10 + decoRng() * (CH - HORIZON - 16),
        k: decoRng.chance(0.75) ? 'grass' : 'stone',
        r: 0.7 + decoRng() * 0.7,
      });
    }
  }

  function drawBackground(ctx, weather) {
    // そら
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 24);
    if (weather === 'rain') { sky.addColorStop(0, '#9FB2BE'); sky.addColorStop(1, '#C4D2DA'); }
    else if (weather === 'cloudy') { sky.addColorStop(0, '#BFD9E4'); sky.addColorStop(1, '#DCEDF2'); }
    else { sky.addColorStop(0, '#8FDCEF'); sky.addColorStop(1, '#D6F4FB'); }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, CW, HORIZON + 24);

    // たいよう
    if (weather === 'sunny' || weather === 'super') {
      ctx.save();
      ctx.translate(566, 40);
      if (weather === 'super') {
        ctx.strokeStyle = 'rgba(255,196,60,.8)'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU + tm * 0.25;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 25, Math.sin(a) * 25);
          ctx.lineTo(Math.cos(a) * 33, Math.sin(a) * 33);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#FFD24A';
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.arc(-6, -6, 6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // くも
    if (!clouds.length) {
      for (let i = 0; i < 3; i++) clouds.push({ x: i * 230 + 40, y: 26 + i * 14, v: 4 + i * 2, r: 0.8 + i * 0.18 });
    }
    clouds.forEach((c) => {
      c.x += c.v * 0.016 * (weather === 'rain' ? 2.4 : 1);
      if (c.x > CW + 70) c.x = -70;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(c.r, c.r);
      ctx.fillStyle = weather === 'rain' ? 'rgba(112,126,136,.85)'
        : weather === 'cloudy' ? 'rgba(184,199,208,.95)' : 'rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.arc(-20, 4, 13, 0, TAU); ctx.arc(0, -2, 17, 0, TAU); ctx.arc(22, 5, 12, 0, TAU);
      ctx.fill();
      ctx.restore();
    });

    // じめん
    const g = ctx.createLinearGradient(0, HORIZON, 0, CH);
    if (weather === 'rain') { g.addColorStop(0, '#8FBF7E'); g.addColorStop(1, '#6EA25F'); }
    else { g.addColorStop(0, '#B4E39B'); g.addColorStop(1, '#8FCF74'); }
    ctx.fillStyle = g; ctx.fillRect(0, HORIZON, CW, CH - HORIZON);

    // フェンス
    ctx.strokeStyle = '#C99E6B'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let x = 18; x < CW; x += 46) {
      ctx.beginPath(); ctx.moveTo(x, HORIZON + 2); ctx.lineTo(x, HORIZON - 26); ctx.stroke();
    }
    ctx.lineWidth = 3.2;
    [HORIZON - 20, HORIZON - 7].forEach((y) => {
      ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(CW - 6, y); ctx.stroke();
    });

    // ペナント（19区画の しはい状況 ＝ なわばりの 進捗）
    const st = St.st;
    if (st) {
      ctx.strokeStyle = 'rgba(74,58,44,.5)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(14, 40);
      ctx.quadraticCurveTo(CW / 2, 58, CW - 14, 40); ctx.stroke();
      const n = D.TILES.length;
      for (let i = 0; i < n; i++) {
        const p = (i + 0.5) / n;
        // ひもの うえの 点（2次ベジェ）
        const x = (1 - p) * (1 - p) * 14 + 2 * (1 - p) * p * (CW / 2) + p * p * (CW - 14);
        const y = (1 - p) * (1 - p) * 40 + 2 * (1 - p) * p * 58 + p * p * 40;
        const owner = st.tiles[D.TILES[i].id].owner;
        const f = D.FACTIONS[owner];
        const wav = Math.sin(tm * 2.4 + i) * 1.6;
        ctx.fillStyle = owner === 'none' ? 'rgba(190,185,178,.9)' : f.color;
        ctx.beginPath();
        ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.lineTo(x + wav * 0.3, y + 13 + wav);
        ctx.closePath(); ctx.fill();
      }
    }

    // くさ・こいし
    if (!tufts) makeTufts();
    tufts.forEach((t) => {
      ctx.save(); ctx.translate(t.x, t.y); ctx.scale(t.r, t.r);
      if (t.k === 'grass') {
        ctx.strokeStyle = 'rgba(95,168,76,.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-4, 0); ctx.quadraticCurveTo(-5, -6, -7, -8);
        ctx.moveTo(0, 0); ctx.quadraticCurveTo(0, -7, 0, -10);
        ctx.moveTo(4, 0); ctx.quadraticCurveTo(5, -6, 7, -8);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(160,150,138,.5)';
        ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.4, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawWeatherFront(ctx, weather, dt) {
    if (weather === 'rain') {
      if (drops.length < 60) {
        for (let i = 0; i < 4; i++) drops.push({ x: U.rnd() * CW, y: -10 - U.rnd() * 40, v: 300 + U.rnd() * 120 });
      }
      ctx.strokeStyle = 'rgba(120,170,205,.65)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      drops.forEach((d) => {
        d.y += d.v * dt; d.x -= d.v * dt * 0.12;
        if (d.y > CH + 8) { d.y = -10; d.x = U.rnd() * CW; }
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 2.4, d.y - 11); ctx.stroke();
      });
    } else {
      drops.length = 0;
    }
    if (weather === 'super') {
      if (sparkles.length < 7 && U.rnd.chance(0.08)) {
        sparkles.push({ x: 24 + U.rnd() * (CW - 48), y: 20 + U.rnd() * 180, life: 1 });
      }
      sparkles.forEach((s) => {
        s.life -= dt * 1.1;
        const r = 4 * Math.sin(Math.max(0, s.life) * Math.PI);
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.fillStyle = 'rgba(255,220,110,.9)';
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.6); ctx.lineTo(r * 0.45, -r * 0.45); ctx.lineTo(r * 1.6, 0);
        ctx.lineTo(r * 0.45, r * 0.45); ctx.lineTo(0, r * 1.6); ctx.lineTo(-r * 0.45, r * 0.45);
        ctx.lineTo(-r * 1.6, 0); ctx.lineTo(-r * 0.45, -r * 0.45);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      sparkles = sparkles.filter((s) => s.life > 0);
    }
  }

  /** ストライキ中の たてかんばん */
  function drawStrikeSign(ctx) {
    ctx.save();
    ctx.translate(66, HORIZON + 52);
    ctx.rotate(-0.06);
    ctx.strokeStyle = '#8A6437'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -34); ctx.stroke();
    ctx.fillStyle = '#D2A468'; rr(ctx, -44, -62, 88, 30, 5); ctx.fill();
    ctx.strokeStyle = '#A97B45'; ctx.lineWidth = 2; rr(ctx, -44, -62, 88, 30, 5); ctx.stroke();
    ctx.fillStyle = '#B94434';
    ctx.font = '900 12px "Hiragino Maru Gothic ProN","Yu Gothic UI",system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ストライキ中！', 0, -47);
    ctx.restore();
  }

  /* ---------------------------------------------------------
     メイン描画
     --------------------------------------------------------- */
  function draw(ctx, dt) {
    const st = St.st;
    const weather = weatherOf();
    ctx.clearRect(0, 0, CW, CH);
    drawBackground(ctx, weather);

    rects = [];
    const items = [];

    // ゆうぐ
    if (st) {
      const open = St.plotsOpen();
      st.plots.forEach((p, i) => {
        if (i >= open) return;
        const pos = slotPos(i);
        if (!p) {
          items.push({ y: pos.y, draw: (c) => {         // あきち：つちの パッチ
            c.save(); c.translate(pos.x, pos.y); c.scale(pos.s, pos.s);
            c.fillStyle = 'rgba(200,172,120,.4)';
            c.beginPath(); c.ellipse(0, -4, 30, 8, 0, 0, TAU); c.fill();
            c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = 2.5; c.setLineDash([5, 5]);
            c.beginPath(); c.ellipse(0, -4, 30, 8, 0, 0, TAU); c.stroke();
            c.setLineDash([]);
            c.restore();
          } });
          return;
        }
        const f = D.FAC_BY_ID[p.fac];
        if (!f || !FAC_DRAW[p.fac]) return;
        const grow = Math.min(1.24, 1 + (p.lv - 1) * 0.055);
        const s = pos.s * grow;
        rects.push({ idx: i, cx: pos.x, top: pos.y - 92 * s, w: 116 * s, h: 96 * s, y: pos.y });
        items.push({ y: pos.y, draw: (c) => {
          c.save(); c.translate(pos.x, pos.y); c.scale(s, s);
          // かげ
          c.fillStyle = 'rgba(52,88,52,.18)';
          c.beginPath(); c.ellipse(0, 0, 46, 8, 0, 0, TAU); c.fill();
          FAC_DRAW[p.fac](c, p.lv, tm);
          // Lvバッジ
          if (p.lv >= 2) {
            c.fillStyle = '#FF9F43';
            c.beginPath(); c.arc(38, -70, 11, 0, TAU); c.fill();
            c.fillStyle = '#fff';
            c.font = '900 10px system-ui,sans-serif';
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('Lv' + p.lv, 38, -69.5);
          }
          c.restore();
        } });
      });
    }

    // ぴよ
    syncActors();
    updateActors(dt);
    const striking = st && St.isStriking();
    const happy = st && st.kigen >= 75;
    actors.forEach((a) => {
      const depth = 0.66 + ((a.y - (HORIZON + 18)) / (CH - HORIZON - 18)) * 0.5;
      const size = 42 * depth;
      const bob = a.wait > 0 ? Math.abs(Math.sin(a.hop)) * 2 : Math.abs(Math.sin(a.hop * 1.4)) * 4;
      items.push({ y: a.y, draw: (c) => {
        GP.piyo.paint(c, a.x, a.y - size * 0.54 - bob, size, Object.assign(
          {}, GP.piyo.looksOf(a.u, striking ? 'sad' : happy ? 'happy' : 'normal'),
          { flip: a.flip, squash: a.wait > 0 ? 1 : 1 + Math.sin(a.hop * 1.4) * 0.05 }));
      } });
    });

    if (striking) items.push({ y: HORIZON + 52, draw: (c) => drawStrikeSign(c) });

    // おくから じゅんに
    items.sort((a, b) => a.y - b.y).forEach((it) => it.draw(ctx));

    drawWeatherFront(ctx, weather, dt);
  }

  /* ---------------------------------------------------------
     ループ / 入力
     --------------------------------------------------------- */
  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const canvas = $('#park-canvas');
    if (!canvas || canvas.offsetParent === null || document.hidden || !St.st) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    tm += dt;
    const ctx = U.fitCanvas(canvas, CW, CH);
    draw(ctx, dt);
  }

  function onTap(e) {
    const canvas = $('#park-canvas');
    const p = U.canvasPoint(canvas, e, CW, CH);
    // てまえの ものから しらべる
    const hit = rects.slice().sort((a, b) => b.y - a.y).find((r) =>
      p.x >= r.cx - r.w / 2 && p.x <= r.cx + r.w / 2 && p.y >= r.top && p.y <= r.y + 6);
    if (hit) GP.park.openPlot(hit.idx);
  }

  function init() {
    const canvas = $('#park-canvas');
    if (!canvas) return;
    canvas.addEventListener('click', onTap);
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  GP.parkscene = {
    init,
    /** e2e・デバッグ用：いま タップできる ゆうぐの 判定わく */
    debugRects: () => rects.slice(),
  };
})(window.GP);
