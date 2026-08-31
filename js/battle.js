/* =========================================================
   battle.js — 縄張りバトル（ヘックス / ターン制オート進行）
   1) simulate()  … けっかを さきに ぜんぶ けいさん（決定論）
   2) play()      … イベントを アニメで さいせい
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const UI = GP.ui;
  const H = GP.hex;
  const { $, el } = U;

  // 縦画面に あわせた たてなが の せんじょう
  const COLS = 5, ROWS = 9, HEX = 50;
  const CW = 520, CH = 760;
  const OX = 65, OY = 80;
  const MAX_TURN = 34;

  /* =========================================================
     じめん（しょうがいぶつ）
     ========================================================= */
  const OBST = {
    none:  { block: false, cost: 1, cover: 0 },
    water: { block: false, cost: 2, cover: 0.1, name: 'みずたまり' },
    sand:  { block: false, cost: 2, cover: 0.15, name: 'すなやま' },
    tree:  { block: false, cost: 1, cover: 0.4, name: 'き' },
    gym:   { block: true,  cost: 9, cover: 0.5, name: 'ジャングルジム' },
  };

  function buildField(terrainId, rng) {
    const ter = D.TERRAIN[terrainId] || D.TERRAIN.hiroba;
    const cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) cells.push({ col: c, row: r, ob: 'none' });
    }
    const get = (c, r) => cells[r * COLS + c];
    const kind = ter.obst;
    if (kind !== 'none') {
      const n = kind === 'gym' ? 4 : 8;
      for (let i = 0; i < n; i++) {
        const c = rng.int(0, COLS - 1);
        const r = rng.int(2, ROWS - 3);        // じんちには おかない
        get(c, r).ob = kind;
      }
      // ちらし
      for (let i = 0; i < 4; i++) {
        const c = rng.int(0, COLS - 1);
        const r = rng.int(2, ROWS - 3);
        if (get(c, r).ob === 'none') get(c, r).ob = kind === 'gym' ? 'tree' : kind;
      }
    }
    return { cells, get, ter };
  }

  /* =========================================================
     てき の ぶたい づくり
     ========================================================= */
  const ROLE_WEIGHT = {
    crow: { rush: 3, range: 2, guard: 2, trick: 2, boss: 1, brain: 1 },
    cat:  { rush: 4, trick: 3, range: 1, guard: 1, brain: 1, boss: 1 },
    red:  { rush: 2, range: 3, guard: 2, brain: 1, boss: 2, trick: 1 },
    none: { rush: 2, guard: 2, range: 1, trick: 1, brain: 1, boss: 0 },
  };
  const ENEMY_NAME = {
    crow: ['カラスっ子', 'くろばね', 'つつきや', 'カァ次郎', 'よぞらの みはり'],
    cat:  ['のらタマ', 'とらすけ', 'しっぽふり', 'にゃんきち', 'ひなたねこ'],
    red:  ['あかぴよ', 'まけずぎらい', 'いばりんぼ', 'せんとうたいちょう', 'あかまる'],
    none: ['のらぴよ', 'まいごぴよ', 'ひとりぼっち'],
  };

  function genEnemySquad(facId, power, rng) {
    const w = ROLE_WEIGHT[facId] || ROLE_WEIGHT.none;
    const roles = Object.keys(w);
    const n = U.clamp(Math.round(power / 4.4) + 1, 2, 5);
    const lv = U.clamp(Math.round(power * 0.80), 1, 28);
    const out = [];
    for (let i = 0; i < n; i++) {
      let total = 0; roles.forEach((r) => { total += w[r]; });
      let x = rng() * total; let role = roles[0];
      for (const r of roles) { x -= w[r]; if (x <= 0) { role = r; break; } }
      const b = D.ROLES[role].base;
      const lvM = 1 + 0.115 * (lv - 1);
      const rarM = i === 0 && rng.chance(0.35) ? 1.3 : 1.0;
      out.push({
        name: rng.pick(ENEMY_NAME[facId] || ENEMY_NAME.none) + (i ? '' : 'たいちょう'),
        role, lv,
        hp: Math.round(b.hp * lvM * rarM), atk: Math.round(b.atk * lvM * rarM),
        def: Math.round(b.def * lvM * rarM), rng: b.rng, mov: b.mov, spd: b.spd,
        looks: GP.piyo.factionLooks(facId, role, 'angry'),
      });
    }
    return out;
  }

  /* =========================================================
     シミュレーション
     cfg = { terrain, playerUnits[], enemyFac, enemyPower, tactic, kigen, seed,
             defense:bool, defBonus:number, cheer:bool }
     ========================================================= */
  function simulate(cfg) {
    const rng = U.makeRng(cfg.seed >>> 0);
    const field = buildField(cfg.terrain, rng);
    const tac = D.TACTICS.find((t) => t.id === cfg.tactic) || D.TACTICS[0];
    const events = [];
    const units = [];
    let nid = 0;

    // --- プレイヤー ---
    const kigenMul = 0.72 + (cfg.kigen || 50) / 200;
    const pSlots = deploySlots('p', cfg.playerUnits.length);
    cfg.playerUnits.forEach((u, i) => {
      const s = St.unitStats(u);
      const hp = Math.round(s.hp * (cfg.defense ? 1 + (cfg.defBonus || 0) * 0.04 : 1));
      units.push({
        id: 'p' + (nid++), side: 'p', ref: u.uid,
        name: St.unitName(u), role: s.role, lv: u.lv,
        maxHp: hp, hp,
        atk: s.atk * tac.mod.atk * kigenMul,
        def: s.def * tac.mod.def * (cfg.defense ? 1 + (cfg.defBonus || 0) * 0.05 : 1),
        rng: s.rng, mov: U.clamp(s.mov + (tac.mod.mov || 0), 1, 5),
        spd: s.spd + (tac.mod.spd || 0),
        aura: u.equip === 'whistle', ignoreWater: u.equip === 'boots',
        looks: GP.piyo.looksOf(u, 'normal'),
        col: pSlots[i].col, row: pSlots[i].row, alive: true, buffs: [],
      });
    });
    // おうえん（がいこう）
    if (cfg.cheer) {
      const b = D.ROLES.boss.base;
      const lv = Math.max(4, Math.round((cfg.enemyPower || 6) * 0.6));
      const lvM = 1 + 0.11 * (lv - 1);
      const slot = deploySlots('p', cfg.playerUnits.length + 1)[cfg.playerUnits.length];
      units.push({
        id: 'p' + (nid++), side: 'p', ref: null, cheer: true,
        name: 'おうえんの ゲルぴよ', role: 'boss', lv,
        maxHp: Math.round(b.hp * lvM), hp: Math.round(b.hp * lvM),
        atk: b.atk * lvM * kigenMul, def: b.def * lvM,
        rng: b.rng, mov: b.mov, spd: b.spd,
        looks: GP.piyo.factionLooks('player', 'boss', 'happy'),
        col: slot.col, row: slot.row, alive: true, buffs: [],
      });
    }

    // --- てき ---
    const eSquad = genEnemySquad(cfg.enemyFac, cfg.enemyPower, rng);
    const eSlots = deploySlots('e', eSquad.length);
    eSquad.forEach((e, i) => {
      units.push({
        id: 'e' + (nid++), side: 'e', ref: null,
        name: e.name, role: e.role, lv: e.lv,
        maxHp: e.hp, hp: e.hp, atk: e.atk, def: e.def,
        rng: e.rng, mov: e.mov, spd: e.spd,
        looks: e.looks,
        col: eSlots[i].col, row: eSlots[i].row, alive: true, buffs: [],
      });
    });

    events.push({ t: 'setup', field: field.cells.map((c) => ({ col: c.col, row: c.row, ob: c.ob })),
                  terrain: cfg.terrain,
                  units: units.map(snap) });

    const alive = (side) => units.filter((u) => u.alive && u.side === side);
    const occupied = (col, row, self) =>
      units.some((u) => u.alive && u !== self && u.col === col && u.row === row);
    const cellAt = (col, row) =>
      (col < 0 || row < 0 || col >= COLS || row >= ROWS) ? null : field.get(col, row);

    let winner = null;

    for (let turn = 1; turn <= MAX_TURN && !winner; turn++) {
      events.push({ t: 'turn', n: turn });

      const order = units.filter((u) => u.alive)
        .map((u) => ({ u, k: u.spd + rng() * 3 }))
        .sort((a, b) => b.k - a.k).map((x) => x.u);

      for (const u of order) {
        if (!u.alive || winner) continue;

        // バフの こうか じかん
        u.buffs = u.buffs.filter((b) => --b.turns > 0);

        const foes = alive(u.side === 'p' ? 'e' : 'p');
        if (!foes.length) break;

        // --- しえん やく：かいふく ---
        if (u.role === 'brain') {
          const mates = alive(u.side).filter((m) => m.hp < m.maxHp * 0.72 && m !== u);
          const near = mates.filter((m) => hdist(u, m) <= u.rng + 1)
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (near) {
            const amt = Math.round(8 + u.lv * 1.6);
            near.hp = Math.min(near.maxHp, near.hp + amt);
            events.push({ t: 'heal', id: u.id, target: near.id, amt, hp: near.hp });
            continue;
          }
        }

        // --- ターゲット ---
        const target = pickTarget(u, foes, cfg.tactic);

        // --- こうげき or いどう ---
        if (hdist(u, target) <= u.rng) {
          doAttack(u, target);
        } else {
          const path = findPath(u, target);
          if (path.length > 1) {
            const steps = path.slice(1, 1 + u.mov);
            const last = steps[steps.length - 1];
            if (last) {
              u.col = last.col; u.row = last.row;
              events.push({ t: 'move', id: u.id, path: steps.map((s) => ({ col: s.col, row: s.row })) });
            }
          }
          if (hdist(u, target) <= u.rng) doAttack(u, target);
        }

        if (!alive('e').length) winner = 'p';
        else if (!alive('p').length) winner = 'e';
      }

      if (!winner && turn === MAX_TURN) {
        const ph = alive('p').reduce((a, u) => a + u.hp / u.maxHp, 0);
        const eh = alive('e').reduce((a, u) => a + u.hp / u.maxHp, 0);
        winner = ph >= eh ? 'p' : 'e';
        events.push({ t: 'timeup' });
      }
    }

    events.push({ t: 'end', winner });

    return {
      events, winner,
      survivors: units.filter((u) => u.side === 'p' && u.alive && u.ref).map((u) => u.ref),
      downed: units.filter((u) => u.side === 'p' && !u.alive && u.ref).map((u) => u.ref),
      enemyCount: eSquad.length,
    };

    /* ---------- ないぶ かんすう ---------- */
    function snap(u) {
      return {
        id: u.id, side: u.side, name: u.name, role: u.role, lv: u.lv,
        hp: u.hp, maxHp: u.maxHp, col: u.col, row: u.row, looks: u.looks,
        rng: u.rng,
      };
    }
    function hdist(a, b) {
      return H.offsetDistance({ col: a.col, row: a.row }, { col: b.col, row: b.row });
    }
    function pickTarget(u, foes, tacticId) {
      if (tacticId === 'surround') {
        return foes.slice().sort((a, b) =>
          (a.hp + a.def * 2) - (b.hp + b.def * 2) || hdist(u, a) - hdist(u, b))[0];
      }
      return foes.slice().sort((a, b) => hdist(u, a) - hdist(u, b) || a.hp - b.hp)[0];
    }
    function auraOf(side) {
      let m = 1;
      units.forEach((x) => {
        if (!x.alive || x.side !== side) return;
        if (x.role === 'boss') m += 0.06;
        if (x.aura) m += 0.08;
      });
      return m;
    }
    function doAttack(a, d) {
      const cell = cellAt(d.col, d.row);
      const cover = cell ? OBST[cell.ob].cover : 0;
      const tm = D.typeMult(a.role, d.role);
      const debuff = a.buffs.reduce((m, b) => m * (b.atk || 1), 1);
      let atk = a.atk * tm * auraOf(a.side) * debuff;
      if (a.rng >= 2 && cover > 0) atk *= (1 - cover);
      const dv = d.def * (1 + (d.buffs.reduce((m, b) => m + (b.defUp || 0), 0)));
      let dmg = (atk - dv * 0.55) * (0.9 + rng() * 0.2);
      const crit = rng() < U.clamp(0.04 + (a.spd - d.spd) * 0.012, 0.02, 0.28);
      if (crit) dmg *= 1.55;
      dmg = Math.max(1, Math.round(dmg));
      d.hp = Math.max(0, d.hp - dmg);

      const ev = {
        t: 'attack', id: a.id, target: d.id, dmg, crit,
        eff: tm > 1 ? 'good' : tm < 1 ? 'bad' : '', ranged: a.rng >= 2,
        hp: d.hp, cover: cover > 0 && a.rng >= 2,
      };
      events.push(ev);

      // おじゃま やく：こうげきりょく ダウン
      if (a.role === 'trick' && d.hp > 0) {
        d.buffs.push({ atk: 0.82, turns: 3 });
        events.push({ t: 'debuff', id: d.id, kind: 'atk' });
      }
      if (d.hp <= 0) {
        d.alive = false;
        events.push({ t: 'down', id: d.id });
      }
    }
    function findPath(from, to) {
      // ダイクストラ（マスが すくないので じゅうぶん）
      const key = (c, r) => r * COLS + c;
      const dist = new Array(COLS * ROWS).fill(Infinity);
      const prev = new Array(COLS * ROWS).fill(null);
      const start = key(from.col, from.row);
      dist[start] = 0;
      const q = [{ col: from.col, row: from.row, d: 0 }];
      while (q.length) {
        q.sort((a, b) => a.d - b.d);
        const cur = q.shift();
        const ck = key(cur.col, cur.row);
        if (cur.d > dist[ck]) continue;
        if (cur.col === to.col && cur.row === to.row) break;
        H.offsetNeighbors(cur.col, cur.row).forEach((n) => {
          const cell = cellAt(n.col, n.row);
          if (!cell) return;
          const isGoal = n.col === to.col && n.row === to.row;
          if (OBST[cell.ob].block && !isGoal) return;
          if (occupied(n.col, n.row, from) && !isGoal) return;
          let cost = OBST[cell.ob].cost;
          if (from.ignoreWater && cell.ob === 'water') cost = 1;
          const nk = key(n.col, n.row);
          const nd = cur.d + cost;
          if (nd < dist[nk]) {
            dist[nk] = nd; prev[nk] = { col: cur.col, row: cur.row };
            q.push({ col: n.col, row: n.row, d: nd });
          }
        });
      }
      // ゴールの となりまで
      let best = null, bestD = Infinity;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const k = key(c, r);
          if (dist[k] === Infinity) continue;
          if (occupied(c, r, from)) continue;
          const cell = cellAt(c, r);
          if (OBST[cell.ob].block) continue;
          const gd = H.offsetDistance({ col: c, row: r }, { col: to.col, row: to.row });
          const score = Math.max(0, gd - from.rng) * 100 + dist[k];
          if (score < bestD) { bestD = score; best = { col: c, row: r }; }
        }
      }
      if (!best) return [];
      const path = [];
      let cur = best;
      while (cur) {
        path.unshift(cur);
        const k = key(cur.col, cur.row);
        cur = prev[k];
      }
      return path;
    }
  }

  /** じんち（はいち） */
  function deploySlots(side, n) {
    const rows = side === 'p' ? [ROWS - 1, ROWS - 2] : [0, 1];
    const order = [2, 1, 3, 0, 4];
    const out = [];
    for (let i = 0; i < n; i++) {
      const band = Math.min(1, Math.floor(i / order.length));
      out.push({ col: order[i % order.length], row: rows[band] });
    }
    return out;
  }

  /* =========================================================
     さいせい（アニメーション）
     ========================================================= */
  const view = {
    cells: [], units: {}, order: [],
    fx: [], floats: [], banner: null, terrain: 'hiroba',
    speed: 1, skip: false, playing: false,
  };

  function cellCenter(col, row) {
    return H.offsetPixel(col, row, HEX, OX, OY);
  }

  function draw(ctx) {
    ctx.clearRect(0, 0, CW, CH);

    // じめん
    const ter = D.TERRAIN[view.terrain] || D.TERRAIN.hiroba;
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, '#3B4F45'); g.addColorStop(1, '#26332E');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);

    // マス
    view.cells.forEach((c) => {
      const p = cellCenter(c.col, c.row);
      H.path(ctx, p.x, p.y, HEX - 2);
      ctx.fillStyle = c.row <= 1 ? shade(ter.fill, -0.30)
        : c.row >= ROWS - 2 ? shade(ter.fill, -0.06) : shade(ter.fill, -0.17);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1.5; ctx.stroke();
      drawObstacle(ctx, c.ob, p.x, p.y);
    });

    // じんちの めじるし
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#4EA8DE';
    for (let c = 0; c < COLS; c++) {
      const p = cellCenter(c, ROWS - 1); H.path(ctx, p.x, p.y, HEX - 2); ctx.fill();
      const p2 = cellCenter(c, ROWS - 2); H.path(ctx, p2.x, p2.y, HEX - 2); ctx.fill();
    }
    ctx.fillStyle = '#E4614F';
    for (let c = 0; c < COLS; c++) {
      const p = cellCenter(c, 0); H.path(ctx, p.x, p.y, HEX - 2); ctx.fill();
      const p2 = cellCenter(c, 1); H.path(ctx, p2.x, p2.y, HEX - 2); ctx.fill();
    }
    ctx.restore();

    // ユニット（うしろの ぎょうから）
    const list = Object.keys(view.units).map((k) => view.units[k])
      .filter((u) => u.alive || u.deathT > 0)
      .sort((a, b) => a.py - b.py);

    list.forEach((u) => {
      const alpha = u.alive ? 1 : Math.max(0, u.deathT);
      ctx.save();
      ctx.globalAlpha = alpha;
      const bob = u.alive ? Math.sin((performance.now() / 420) + u.bob) * 2.5 : 0;
      const size = 62;
      GP.piyo.paint(ctx, u.px, u.py + bob - 6, size, Object.assign({}, u.looks, {
        flip: u.side === 'e',
        mood: u.alive ? (u.hp / u.maxHp < 0.35 ? 'sad' : u.looks.mood) : 'ko',
        squash: u.squash || 1,
      }));
      // HPバー
      const w = 40, h = 5, bx = u.px - w / 2, by = u.py + 20;
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      roundRect(ctx, bx - 1, by - 1, w + 2, h + 2, 3); ctx.fill();
      ctx.fillStyle = u.side === 'p' ? '#63C6E0' : '#F0844A';
      roundRect(ctx, bx, by, w * U.clamp(u.hp / u.maxHp, 0, 1), h, 2.5); ctx.fill();
      // やくわり バッジ
      const role = D.ROLES[u.role];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = role.color;
      ctx.beginPath(); ctx.arc(u.px + 20, u.py - 22, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '900 11px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(role.short, u.px + 20, u.py - 21);
      ctx.restore();
    });

    // エフェクト
    view.fx.forEach((f) => drawFx(ctx, f));
    view.floats.forEach((f) => {
      ctx.save();
      ctx.globalAlpha = U.clamp(f.life, 0, 1);
      ctx.font = '900 ' + (f.crit ? 30 : 23) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });
  }

  function drawObstacle(ctx, ob, x, y) {
    if (ob === 'none') return;
    ctx.save();
    if (ob === 'water') {
      ctx.fillStyle = 'rgba(56,150,200,.85)';
      ctx.beginPath(); ctx.ellipse(x, y + 7, 28, 15, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(x, y + 7, 28, 15, 0, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x - 6, y + 3, 11, 5, 0, 0, 7); ctx.stroke();
    } else if (ob === 'sand') {
      ctx.fillStyle = '#E5C98F';
      ctx.beginPath(); ctx.moveTo(x - 26, y + 16); ctx.quadraticCurveTo(x, y - 16, x + 26, y + 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#CBAE74';
      ctx.beginPath(); ctx.moveTo(x - 12, y + 16); ctx.quadraticCurveTo(x + 2, y - 4, x + 16, y + 16);
      ctx.closePath(); ctx.fill();
    } else if (ob === 'tree') {
      ctx.fillStyle = '#7A5433';
      ctx.fillRect(x - 3.5, y + 2, 7, 16);
      ctx.fillStyle = '#5FA84C';
      ctx.beginPath(); ctx.arc(x, y - 6, 17, 0, 7); ctx.fill();
      ctx.fillStyle = '#79C463';
      ctx.beginPath(); ctx.arc(x - 6, y - 11, 10, 0, 7); ctx.fill();
    } else if (ob === 'gym') {
      ctx.strokeStyle = '#D96C4F'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 18, y + 16); ctx.lineTo(x - 18, y - 14);
      ctx.moveTo(x + 18, y + 16); ctx.lineTo(x + 18, y - 14);
      ctx.moveTo(x - 18, y - 14); ctx.lineTo(x + 18, y - 14);
      ctx.moveTo(x - 18, y + 1); ctx.lineTo(x + 18, y + 1);
      ctx.moveTo(x - 18, y - 14); ctx.lineTo(x + 18, y + 1);
      ctx.moveTo(x + 18, y - 14); ctx.lineTo(x - 18, y + 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFx(ctx, f) {
    const t = 1 - f.life;
    ctx.save();
    if (f.kind === 'shot') {
      const x = U.lerp(f.x0, f.x1, t), y = U.lerp(f.y0, f.y1, t) - Math.sin(t * Math.PI) * 26;
      ctx.fillStyle = '#8FD3F4';
      ctx.beginPath(); ctx.ellipse(x, y, 7, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.arc(x - 2, y - 2, 2.6, 0, 7); ctx.fill();
    } else if (f.kind === 'bonk') {
      const s = 1 + t * 0.9;
      ctx.globalAlpha = U.clamp(f.life * 1.4, 0, 1);
      ctx.translate(f.x, f.y); ctx.scale(s, s);
      ctx.fillStyle = '#FFD166';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
        const rr = i % 2 ? 9 : 21;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#E4614F'; ctx.lineWidth = 3; ctx.stroke();
    } else if (f.kind === 'heal') {
      ctx.globalAlpha = U.clamp(f.life, 0, 1);
      ctx.fillStyle = '#9BE7A5';
      const y = f.y - t * 26;
      ctx.font = '900 22px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('♥', f.x, y);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const c = hex.replace('#', '');
    const n = parseInt(c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r + 255 * amt), 0, 255);
    g = U.clamp(Math.round(g + 255 * amt), 0, 255);
    b = U.clamp(Math.round(b + 255 * amt), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  /* ---------- さいせい ループ ---------- */
  let rafId = 0, ctx = null;

  function startLoop() {
    const canvas = $('#battle-canvas');
    ctx = U.fitCanvas(canvas, CW, CH);
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      view.fx.forEach((f) => { f.life -= dt / f.dur; });
      view.fx = view.fx.filter((f) => f.life > 0);
      view.floats.forEach((f) => { f.life -= dt / 0.9; f.y -= dt * 40; });
      view.floats = view.floats.filter((f) => f.life > 0);
      Object.keys(view.units).forEach((k) => {
        const u = view.units[k];
        if (!u.alive && u.deathT > 0) u.deathT -= dt * 1.6;
        if (u.squash && u.squash !== 1) u.squash += (1 - u.squash) * Math.min(1, dt * 8);
      });
      ctx = U.fitCanvas(canvas, CW, CH);
      draw(ctx);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function pushLog(html, cls) {
    const box = $('#battle-log');
    const d = el('div', { class: cls || '', html });
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 60) box.firstElementChild.remove();
  }

  function refreshHpBars() {
    let ph = 0, pm = 0, eh = 0, em = 0;
    Object.keys(view.units).forEach((k) => {
      const u = view.units[k];
      if (u.side === 'p') { ph += Math.max(0, u.hp); pm += u.maxHp; }
      else { eh += Math.max(0, u.hp); em += u.maxHp; }
    });
    $('#battle-hp-p').style.width = (pm ? (ph / pm) * 100 : 0) + '%';
    $('#battle-hp-e').style.width = (em ? (eh / em) * 100 : 0) + '%';
  }

  async function play(sim, cfg) {
    view.speed = 1; view.skip = false; view.playing = true;
    view.fx = []; view.floats = []; view.units = {};
    $('#battle-log').innerHTML = '';
    $('#battle-banner').hidden = true;
    $('#btn-battle-speed').textContent = '×1';
    $('#btn-battle-skip').disabled = false;

    const wait = (ms) => new Promise((res) => {
      if (view.skip) return res();
      setTimeout(res, ms / view.speed);
    });

    for (const ev of sim.events) {
      if (ev.t === 'setup') {
        view.cells = ev.field;
        view.terrain = ev.terrain;
        ev.units.forEach((u) => {
          const p = cellCenter(u.col, u.row);
          view.units[u.id] = Object.assign({}, u, {
            px: p.x, py: p.y, alive: true, deathT: 1, squash: 1,
            bob: Math.random() * 6,
          });
        });
        refreshHpBars();
        if (!view.skip) await wait(320);
        continue;
      }
      if (view.skip && ev.t !== 'end') {
        applyInstant(ev);
        continue;
      }
      switch (ev.t) {
        case 'turn':
          if (ev.n > 1) pushLog(`— ターン ${ev.n} —`);
          await wait(120);
          break;
        case 'move': {
          const u = view.units[ev.id];
          for (const step of ev.path) {
            const p = cellCenter(step.col, step.row);
            await tweenTo(u, p.x, p.y, 170);
          }
          u.col = ev.path[ev.path.length - 1].col;
          u.row = ev.path[ev.path.length - 1].row;
          break;
        }
        case 'attack': {
          const a = view.units[ev.id], d = view.units[ev.target];
          a.squash = 1.16;
          if (ev.ranged) {
            view.fx.push({ kind: 'shot', x0: a.px, y0: a.py - 6, x1: d.px, y1: d.py - 6, life: 1, dur: 0.34 / view.speed });
            await wait(300);
          } else {
            const dx = (d.px - a.px) * 0.32, dy = (d.py - a.py) * 0.32;
            await tweenBy(a, dx, dy, 110);
            await tweenBy(a, -dx, -dy, 110);
          }
          d.hp = ev.hp; d.squash = 0.84;
          view.fx.push({ kind: 'bonk', x: d.px, y: d.py - 6, life: 1, dur: 0.34 });
          view.floats.push({
            text: (ev.crit ? '★' : '') + ev.dmg, x: d.px + 12, y: d.py - 26, life: 1,
            crit: ev.crit, color: ev.eff === 'good' ? '#FFD166' : ev.eff === 'bad' ? '#B9C4CC' : '#fff',
          });
          const effTxt = ev.eff === 'good' ? '<span class="hit">こうかは ばつぐん！</span>'
            : ev.eff === 'bad' ? '<span>こうかは いまひとつ…</span>' : '';
          pushLog(`${a.name} の こうげき → ${d.name} に <b>${ev.dmg}</b>${ev.crit ? '（かいしん！）' : ''} ${effTxt}${ev.cover ? '<span>（きに さえぎられた）</span>' : ''}`, 'hit');
          refreshHpBars();
          await wait(170);
          break;
        }
        case 'heal': {
          const a = view.units[ev.id], d = view.units[ev.target];
          d.hp = ev.hp;
          view.fx.push({ kind: 'heal', x: d.px, y: d.py - 20, life: 1, dur: 0.7 });
          pushLog(`${a.name} が ${d.name} を おうえん！ ❤+${ev.amt}`, 'heal');
          refreshHpBars();
          await wait(260);
          break;
        }
        case 'debuff': {
          const d = view.units[ev.id];
          view.floats.push({ text: '⚔↓', x: d.px - 14, y: d.py - 30, life: 1, color: '#C8A2F0' });
          await wait(120);
          break;
        }
        case 'down': {
          const d = view.units[ev.id];
          d.alive = false; d.deathT = 1;
          pushLog(`${d.name} は おうちに かえった…`, 'down');
          refreshHpBars();
          await wait(240);
          break;
        }
        case 'timeup':
          pushLog('じかん ぎれ！ のこった げんきで はんてい！');
          await wait(400);
          break;
        case 'end':
          break;
      }
    }

    // けっか えんしゅつ
    const win = sim.winner === 'p';
    const b = $('#battle-banner');
    b.textContent = win ? 'かった！' : 'まけちゃった…';
    b.className = 'battle-banner' + (win ? ' win' : '');
    b.hidden = false;
    $('#btn-battle-skip').disabled = true;
    refreshHpBars();
    await new Promise((r) => setTimeout(r, 900));
    view.playing = false;
  }

  function applyInstant(ev) {
    if (ev.t === 'move') {
      const u = view.units[ev.id];
      const last = ev.path[ev.path.length - 1];
      const p = cellCenter(last.col, last.row);
      u.px = p.x; u.py = p.y; u.col = last.col; u.row = last.row;
    } else if (ev.t === 'attack' || ev.t === 'heal') {
      view.units[ev.target].hp = ev.hp;
    } else if (ev.t === 'down') {
      const u = view.units[ev.id]; u.alive = false; u.deathT = 0;
    }
  }

  function tweenTo(u, x, y, ms) {
    return new Promise((res) => {
      const sx = u.px, sy = u.py, t0 = performance.now(), dur = ms / view.speed;
      const step = (now) => {
        const t = U.clamp((now - t0) / dur, 0, 1);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        u.px = U.lerp(sx, x, e); u.py = U.lerp(sy, y, e);
        u.squash = 1 + Math.sin(t * Math.PI) * 0.1;
        if (t < 1 && !view.skip) requestAnimationFrame(step);
        else { u.px = x; u.py = y; u.squash = 1; res(); }
      };
      requestAnimationFrame(step);
    });
  }
  function tweenBy(u, dx, dy, ms) {
    return tweenTo(u, u.px + dx, u.py + dy, ms);
  }

  /* =========================================================
     がいぶ API
     ========================================================= */
  async function run(cfg) {
    const screen = $('#battle-screen');
    $('#battle-name-p').textContent = cfg.pName || 'ぴよ団';
    $('#battle-name-e').textContent = cfg.eName || 'ライバル';
    screen.hidden = false;
    startLoop();
    const sim = simulate(cfg);
    await play(sim, cfg);
    stopLoop();
    screen.hidden = true;
    return sim;
  }

  function init() {
    $('#btn-battle-speed').addEventListener('click', () => {
      view.speed = view.speed === 1 ? 2 : view.speed === 2 ? 4 : 1;
      $('#btn-battle-speed').textContent = '×' + view.speed;
    });
    $('#btn-battle-skip').addEventListener('click', () => {
      view.skip = true;
      $('#btn-battle-skip').disabled = true;
    });
  }

  GP.battle = { init, run, simulate, genEnemySquad, COLS, ROWS };
})(window.GP);
