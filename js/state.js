/* =========================================================
   state.js — ゲーム状態 / けいさん（DOMに いっさい さわらない）
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const D = GP.data;
  const U = GP.util;
  const H = GP.hex;
  const R = D.RULES;

  const S = { data: null };

  /* =========================================================
     しんき ゲーム
     ========================================================= */
  function newGame() {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const st = {
      v: 1,
      seed,
      day: 1,
      res: Object.assign({}, R.startRes),
      genki: R.genkiMax,
      kigenMod: 0,
      kigen: R.startKigen,
      plots: new Array(R.plotsTotal).fill(null),
      units: [],
      equips: { straw: 1, net: 1 },
      team: [],
      tactic: 'charge',
      tiles: {},
      factions: {},
      freeScoutDay: 0,
      pendingScout: null,   // かくてい前の スカウト結果（とじても きえないように）
      log: [],
      stats: { battles: 0, wins: 0, scouts: 0, built: 0, captured: 0, lost: 0 },
      lastSeen: Date.now(),
      ended: null,
      seen: {},
    };

    D.TILES.forEach((t) => {
      st.tiles[t.id] = { owner: t.owner, def: t.def, days: 0 };
    });
    D.RIVALS.forEach((f) => {
      st.factions[f] = { fav: D.DIPLO.start, pact: 0, cheer: 0 };
    });

    // はじめの なかま 3ぴよ
    ['kopiyo', 'mizupiyo', 'sunapiyo'].forEach((sp) => {
      const u = makeUnit(sp, 1);
      st.units.push(u);
      st.team.push(u.uid);
      st.seen[sp] = true;
    });
    // はじめの ゆうぐ
    st.plots[0] = { fac: 'sunaba', lv: 1 };
    st.plots[1] = { fac: 'bench', lv: 1 };

    st.log.push({ day: 1, text: 'ゲルぴよ公園大作戦、スタート！ まずは ゆうぐを たてよう。', kind: 'good' });
    S.data = st;
    return st;
  }

  /* =========================================================
     ぴよ 個体
     ========================================================= */
  function makeUnit(spId, lv) {
    return {
      uid: U.uid('u'),
      sp: spId,
      lv: lv || 1,
      xp: 0,
      equip: null,
      evo: null,
      wins: 0,
    };
  }

  function unitName(u) {
    const sp = D.SPECIES_BY_ID[u.sp];
    if (!sp) return 'ゲルぴよ';
    if (!u.evo) return sp.name;
    const e = D.EVOLUTIONS.find((x) => x.id === u.evo);
    if (!e) return sp.name;
    if (e.id === 'onii' || e.id === 'onee') return sp.name + '（' + e.name + '）';
    return e.name + sp.name;
  }

  function unitStats(u) {
    const sp = D.SPECIES_BY_ID[u.sp];
    const role = D.ROLES[sp.role];
    const b = role.base;
    const rarM = D.RARITY[sp.rar].mult;
    const lvM = 1 + 0.12 * (u.lv - 1);
    const evo = u.evo ? D.EVOLUTIONS.find((x) => x.id === u.evo) : null;
    const evoM = evo ? evo.mult : 1;
    const em = (evo && evo.mod) || {};
    const eq = u.equip ? D.EQUIP_BY_ID[u.equip] : null;
    const qm = (eq && eq.mod) || {};

    const st = {
      hp:  Math.round(b.hp  * rarM * lvM * evoM) + (em.hp  || 0) + (qm.hp  || 0),
      atk: Math.round(b.atk * rarM * lvM * evoM) + (em.atk || 0) + (qm.atk || 0),
      def: Math.round(b.def * rarM * lvM * evoM) + (em.def || 0) + (qm.def || 0),
      rng: b.rng + (em.rng || 0) + (qm.rng || 0),
      mov: b.mov + (em.mov || 0) + (qm.mov || 0),
      spd: b.spd + (em.spd || 0) + (qm.spd || 0),
      role: sp.role,
      rar: sp.rar,
    };
    if (eq && eq.special === 'rangeUp' && sp.role === 'range') st.rng += 1;
    st.hp = Math.max(1, st.hp);
    st.atk = Math.max(1, st.atk);
    st.def = Math.max(0, st.def);
    st.mov = U.clamp(st.mov, 1, 6);
    st.spd = Math.max(1, st.spd);
    return st;
  }

  function unitPower(u) {
    const s = unitStats(u);
    return Math.round(s.hp * 0.45 + s.atk * 3.2 + s.def * 2.1 + s.spd * 0.7 + s.rng * 4);
  }

  function xpNeed(lv) { return R.xpTable(lv); }

  /** けいけんちを あたえる。レベルアップ / しんか を list で かえす */
  function giveXp(u, amount) {
    const events = [];
    u.xp += amount;
    while (u.lv < R.lvMax && u.xp >= xpNeed(u.lv)) {
      u.xp -= xpNeed(u.lv);
      u.lv += 1;
      events.push({ type: 'lv', lv: u.lv });
      if (D.EVO_LEVELS.indexOf(u.lv) >= 0 && !isMaxEvo(u)) {
        const e = rollEvolution(u);
        if (e) {
          u.evo = e.id;
          events.push({ type: 'evo', evo: e });
        }
      }
    }
    if (u.lv >= R.lvMax) u.xp = Math.min(u.xp, xpNeed(R.lvMax) - 1);
    return events;
  }

  function isMaxEvo(u) { return u.evo === 'legend'; }

  function rollEvolution(u) {
    const rng = U.rnd;
    // おやつを たくさん もっていると でんせつ が でやすい
    const lucky = S.data && S.data.res.snack >= 60 ? 2.2 : 1;
    const pool = D.EVOLUTIONS.filter((e) => e.id !== u.evo);
    let total = 0;
    pool.forEach((e) => { total += e.w * (e.kind === 'rare' ? lucky : 1); });
    let x = rng() * total;
    for (const e of pool) {
      x -= e.w * (e.kind === 'rare' ? lucky : 1);
      if (x <= 0) return e;
    }
    return pool[0];
  }

  /* =========================================================
     しせつ / けいざい
     ========================================================= */
  function plotsOpen() {
    const st = S.data;
    return Math.min(R.plotsTotal, R.plotsBase + ownedTileIds().length * R.plotPerTile);
  }

  function facilityAgg() {
    const st = S.data;
    let kigen = 0, cap = 0, teamCap = 0, roster = 0, def = 0;
    const yieldSum = {};
    st.plots.forEach((p) => {
      if (!p) return;
      const f = D.FAC_BY_ID[p.fac];
      if (!f) return;
      kigen += D.facKigen(p.fac, p.lv);
      cap += D.facCap(p.fac, p.lv);
      const y = D.facYield(p.fac, p.lv);
      for (const k in y) yieldSum[k] = (yieldSum[k] || 0) + y[k];
      if (f.bonus) {
        teamCap += (f.bonus.teamCap || 0) * p.lv;
        roster += (f.bonus.roster || 0) * p.lv;
        def += (f.bonus.def || 0) * p.lv;
      }
    });
    return { kigen, cap, teamCap, roster, def, yieldSum };
  }

  function ownedTileIds() {
    const st = S.data;
    return Object.keys(st.tiles).filter((id) => st.tiles[id].owner === 'player');
  }

  function tileYield() {
    const st = S.data;
    const out = {};
    ownedTileIds().forEach((id) => {
      const t = D.TILES.find((x) => x.id === id);
      const y = D.TERRAIN[t.ter].yield;
      for (const k in y) out[k] = (out[k] || 0) + y[k];
    });
    return out;
  }

  function teamCap() {
    return R.teamCapBase + facilityAgg().teamCap;
  }
  function rosterCap() {
    return R.rosterBase + facilityAgg().roster;
  }

  /** ごきげん度の めやす（目標値） */
  function kigenTarget() {
    const st = S.data;
    const agg = facilityAgg();
    const tiles = ownedTileIds().length;
    // 区画が ふえると さいしょは うれしいが、ひろげすぎると 目が とどかなくなる
    // ゆうぐの こうかは ていげん（おなじ ものばかり たてても のびない）
    const facPart = R.kigenCapFac * (1 - Math.exp(-agg.kigen / R.kigenSoft));
    let v = R.baseKigen + facPart + Math.min(tiles, 3) * 2.2 - Math.max(0, tiles - 3) * 1.9;
    const crowd = Math.max(0, st.units.length - agg.cap);
    v -= crowd * 4.2;
    // そうび の ごきげん ボーナス
    st.units.forEach((u) => {
      const eq = u.equip ? D.EQUIP_BY_ID[u.equip] : null;
      if (eq && eq.kigen) v += eq.kigen;
    });
    return U.clamp(Math.round(v), 0, 100);
  }

  function isStriking() { return S.data.kigen < R.strikeAt; }

  function prodMultiplier() {
    const st = S.data;
    let m = 0.5 + st.kigen / 100;
    if (isStriking()) m *= 0.45;
    return m;
  }

  /** 1日あたりの しゅうにゅう（表示用にも つかう） */
  function income(extraMul) {
    const agg = facilityAgg();
    const ty = tileYield();
    const m = prodMultiplier() * (extraMul === undefined ? 1 : extraMul);
    const out = {};
    [agg.yieldSum, ty].forEach((src) => {
      for (const k in src) out[k] = (out[k] || 0) + src[k];
    });
    for (const k in out) out[k] = Math.max(0, Math.round(out[k] * m));
    return out;
  }

  /* =========================================================
     リソース
     ========================================================= */
  function canPay(cost) {
    const st = S.data;
    for (const k in cost) if ((st.res[k] || 0) < cost[k]) return false;
    return true;
  }
  function pay(cost) {
    if (!canPay(cost)) return false;
    const st = S.data;
    for (const k in cost) st.res[k] -= cost[k];
    return true;
  }
  function gain(delta) {
    const st = S.data;
    for (const k in delta) {
      st.res[k] = Math.max(0, (st.res[k] || 0) + delta[k]);
    }
  }
  function lackList(cost) {
    const st = S.data;
    return Object.keys(cost).filter((k) => (st.res[k] || 0) < cost[k]);
  }

  /* =========================================================
     ログ
     ========================================================= */
  function log(text, kind) {
    const st = S.data;
    st.log.unshift({ day: st.day, text, kind: kind || 'none' });
    if (st.log.length > 40) st.log.length = 40;
  }

  /* =========================================================
     区画
     ========================================================= */
  function tileById(id) { return D.TILES.find((t) => t.id === id); }

  function tileNeighborIds(id) {
    const t = tileById(id);
    if (!t) return [];
    return H.neighbors(t.q, t.r)
      .map((n) => D.TILES.find((x) => x.q === n.q && x.r === n.r))
      .filter(Boolean).map((x) => x.id);
  }

  /** プレイヤーが せめられる 区画（じぶんの 区画に となりあう 他の 区画） */
  function attackableIds() {
    const st = S.data;
    const set = new Set();
    ownedTileIds().forEach((id) => {
      tileNeighborIds(id).forEach((nid) => {
        if (st.tiles[nid].owner !== 'player') set.add(nid);
      });
    });
    return Array.from(set);
  }

  function shares() {
    const st = S.data;
    const out = {};
    Object.keys(D.FACTIONS).forEach((f) => { out[f] = 0; });
    Object.keys(st.tiles).forEach((id) => { out[st.tiles[id].owner] += 1; });
    return out;
  }

  /** 区画の じっしつ ぼうぎょりょく */
  function tileDefense(id) {
    const st = S.data;
    const t = tileById(id);
    const s = st.tiles[id];
    let d = s.def + D.TERRAIN[t.ter].def;
    if (s.owner === 'player') {
      d += facilityAgg().def;
      d += Math.min(4, Math.floor(s.days / 5));
    } else {
      const f = D.FACTIONS[s.owner];
      d = d * (f.power || 1) * (1 + st.day * 0.024);
    }
    return Math.max(1, Math.round(d));
  }

  /** 敵の 部隊 づよさ（バトル生成に つかう） */
  function enemyPower(id) {
    const st = S.data;
    const s = st.tiles[id];
    const f = D.FACTIONS[s.owner] || D.FACTIONS.none;
    return tileDefense(id) * (f.power || 1) * (1 + st.day * 0.015);
  }

  /** プレイヤーが 区画を とったとき、となりの ライバルが まもりを かためる */
  function alertNeighbors(id) {
    const st = S.data;
    const msgs = [];
    tileNeighborIds(id).forEach((nid) => {
      const t = st.tiles[nid];
      if (t.owner === 'player' || t.owner === 'none') return;
      t.def = Math.min(16, t.def + 1);
      msgs.push(D.FACTIONS[t.owner].name);
    });
    return Array.from(new Set(msgs));
  }

  /* =========================================================
     つぎの日へ
     ========================================================= */
  function nextDay(opts) {
    const st = S.data;
    const noPlayerAttack = !!(opts && opts.noPlayerAttack);
    const rng = U.makeRng((st.seed + st.day * 7919) >>> 0);
    const rep = {
      day: st.day, income: {}, event: null, kigenBefore: st.kigen,
      msgs: [], aiMoves: [], pendingAttack: null, levelUps: [],
    };

    // --- イベント ---
    let prodMul = 1;
    const ev = pickEvent(rng);
    rep.event = ev;
    if (ev) {
      if (ev.res) gain(ev.res);
      if (ev.kigen) st.kigenMod += ev.kigen;
      if (ev.genki) st.genki = Math.max(0, st.genki + ev.genki);
      if (ev.prodMul) prodMul = ev.prodMul;
      if (ev.id !== 'none') log(ev.text, ev.kind);
    }

    // --- ごきげん度 ---
    st.kigenMod *= 0.55;
    if (Math.abs(st.kigenMod) < 0.5) st.kigenMod = 0;
    st.kigen = U.clamp(Math.round(kigenTarget() + st.kigenMod), 0, 100);
    if (isStriking()) {
      log('ごきげん ななめ！ だだっこストライキで せいさんが がた落ち…', 'bad');
      rep.msgs.push('だだっこストライキ はっせい中！ ゆうぐを ふやして ごきげんを とりもどそう。');
    }

    // --- しゅうにゅう ---
    const inc = income(prodMul);
    gain(inc);
    rep.income = inc;

    // --- げんき かいふく ---
    st.genki = Math.min(R.genkiMax, st.genki + R.genkiPerDay);

    // --- 区画の しはい 日数 ---
    Object.keys(st.tiles).forEach((id) => { st.tiles[id].days += 1; });

    // --- がいこう の ふうか ---
    D.RIVALS.forEach((f) => {
      const fs = st.factions[f];
      if (fs.pact > 0) fs.pact -= 1;
      else fs.fav = U.clamp(fs.fav + D.DIPLO.dailyDrift, 0, 100);
    });

    // --- ライバル AI ---
    runAI(rng, rep, noPlayerAttack);

    // --- 日づけ ---
    st.day += 1;
    st.lastSeen = Date.now();

    checkEnd(rep);
    return rep;
  }

  function pickEvent(rng) {
    let total = 0;
    D.EVENTS.forEach((e) => { total += e.w; });
    let x = rng() * total;
    for (const e of D.EVENTS) { x -= e.w; if (x <= 0) return e; }
    return D.EVENTS[D.EVENTS.length - 1];
  }

  /* ---------- ライバル AI ---------- */
  function runAI(rng, rep, noPlayerAttack) {
    const st = S.data;
    const order = rng.shuffle(D.RIVALS.slice());
    let playerAttacked = false;
    // 中盤いこう ライバルは 1日に 2回 うごく
    const acts = st.day >= 10 ? order.concat(rng.shuffle(D.RIVALS.slice())) : order;

    acts.forEach((fid) => {
      const fac = D.FACTIONS[fid];
      const fs = st.factions[fid];
      const mine = Object.keys(st.tiles).filter((id) => st.tiles[id].owner === fid);
      if (!mine.length) return;
      if (!rng.chance(fac.aggr)) {
        // ようすみ：まもりを かためる
        const t = rng.pick(mine);
        st.tiles[t].def = Math.min(12, st.tiles[t].def + 1);
        rep.aiMoves.push({ fac: fid, kind: 'fortify', tile: t });
        return;
      }

      // せめる さき
      const cands = [];
      mine.forEach((id) => {
        tileNeighborIds(id).forEach((nid) => {
          const o = st.tiles[nid].owner;
          if (o === fid) return;
          if (o === 'player' && (noPlayerAttack || fs.pact > 0 || playerAttacked)) return;
          let w = 10;
          if (o === 'none') w = 16;
          else if (o === 'player') w = 12 + Math.max(0, 6 - tileDefense(nid));
          else w = 7;
          w += Math.max(0, 10 - tileDefense(nid));
          cands.push({ id: nid, w, from: id });
        });
      });
      if (!cands.length) return;

      let total = 0; cands.forEach((c) => { total += c.w; });
      let x = rng() * total; let target = cands[0];
      for (const c of cands) { x -= c.w; if (x <= 0) { target = c; break; } }

      const tState = st.tiles[target.id];
      if (tState.owner === 'player') {
        // プレイヤーへの しゅうげき → バトルで けっちゃく
        playerAttacked = true;
        rep.pendingAttack = { fac: fid, tile: target.id, from: target.from };
        return;
      }

      // AI 同士 / 中立 は じどう はんてい
      const atkP = (fac.power || 1) * (2.6 + mine.length * 0.62) * (1 + st.day * 0.020);
      const defP = tileDefense(target.id) * 0.72;
      const win = rng() < atkP / (atkP + defP);
      if (win) {
        const before = tState.owner;
        tState.owner = fid;
        tState.days = 0;
        tState.def = Math.max(2, Math.round(tileById(target.id).def * 0.8));
        rep.aiMoves.push({ fac: fid, kind: 'capture', tile: target.id, from: before });
        log(fac.name + 'が「' + tileById(target.id).name + '」を てにいれた。', 'bad');
      } else {
        rep.aiMoves.push({ fac: fid, kind: 'fail', tile: target.id });
      }
    });
  }

  /* ---------- しゅうりょう はんてい ---------- */
  function checkEnd(rep) {
    const st = S.data;
    const sh = shares();
    if (sh.player === 0) {
      st.ended = 'lose';
      rep.msgs.push('こうえんを ぜんぶ とられてしまった…');
      return;
    }
    if (sh.player === D.TILES.length) {
      st.ended = 'win';
      return;
    }
    if (st.day > R.dayLimit) {
      let best = 'player', bestN = -1;
      Object.keys(sh).forEach((k) => {
        if (k === 'none') return;
        if (sh[k] > bestN) { bestN = sh[k]; best = k; }
      });
      st.ended = best === 'player' ? 'win' : 'timeup';
    }
  }

  /* =========================================================
     るす（放置）せいさん
     ========================================================= */
  function applyOffline() {
    const st = S.data;
    const now = Date.now();
    const hours = (now - (st.lastSeen || now)) / 3600000;
    st.lastSeen = now;
    if (hours < 0.05) return null;

    // さいしょの 8時間ぶんは 放置生産として しかく回収
    const h = Math.min(hours, R.offlineCapH);
    const inc = income();
    const out = {};
    let any = false;
    for (const k in inc) {
      const v = Math.floor(inc[k] * h * R.offlineRate);
      if (v > 0) { out[k] = v; any = true; }
    }
    if (any) gain(out);

    // 8時間を こえた ぶんは「8時間 = 1日」で 日づけを すすめる（超過÷8 切り捨て）
    // 防衛バトルは はさめないので ランダムな しゅうげきは 起きないが、
    // 1日ごとに「まもりが いちばん ひくい マス」を いちばん よわい 勢力に のっとられる
    let days = 0;
    const stolen = [];
    const dayFrom = st.day;
    if (hours > R.offlineCapH && !st.ended) {
      const want = Math.floor((hours - R.offlineCapH) / R.offlineCapH);
      while (days < want && days < 90 && !st.ended) {
        nextDay({ noPlayerAttack: true });
        days++;
        const hit = offlineSteal();
        if (hit) stolen.push(hit);
      }
      st.lastSeen = now;               // nextDay が 上書きするので もどす
    }

    if (!any && !days) return null;
    return { hours: h, gained: out, days, dayFrom, dayTo: st.day, stolen };
  }

  /** るす中の のっとり：まもり最小の 自マスを、区画数が いちばん すくない 勢力へ */
  function offlineSteal() {
    const st = S.data;
    const mine = ownedTileIds();
    if (mine.length <= 1) return null;           // さいごの 1マスまでは うばわれない
    let tid = mine[0];
    mine.forEach((id) => { if (tileDefense(id) < tileDefense(tid)) tid = id; });
    const sh = shares();
    const alive = D.RIVALS.filter((f) => sh[f] > 0);
    if (!alive.length) return null;
    alive.sort((a, b) =>
      sh[a] - sh[b] || (D.FACTIONS[a].power || 1) - (D.FACTIONS[b].power || 1));
    const fac = alive[0];
    const t = tileById(tid);
    st.tiles[tid].owner = fac;
    st.tiles[tid].days = 0;
    st.tiles[tid].def = Math.max(2, Math.round(t.def * 0.8));
    st.stats.lost += 1;
    st.kigenMod -= 6;
    st.kigen = U.clamp(Math.round(kigenTarget() + st.kigenMod), 0, 100);
    log(`るすの あいだに ${D.FACTIONS[fac].name}が「${t.name}」を のっとった…`, 'bad');
    return { tile: tid, name: t.name, fac };
  }

  /* =========================================================
     そうび
     ========================================================= */
  function addEquip(id, n) {
    const st = S.data;
    st.equips[id] = (st.equips[id] || 0) + (n || 1);
  }
  /** もっている かず（そうび中を のぞく） */
  function equipFree(id) {
    const st = S.data;
    const have = st.equips[id] || 0;
    const used = st.units.filter((u) => u.equip === id).length;
    return have - used;
  }
  function setEquip(u, id) {
    const st = S.data;
    if (u.equip === id) { u.equip = null; return true; }
    if (id && equipFree(id) <= 0) return false;
    u.equip = id || null;
    return true;
  }
  function unitById(uid) { return S.data.units.find((u) => u.uid === uid); }

  function teamUnits() {
    const st = S.data;
    return st.team.map(unitById).filter(Boolean);
  }

  /** チームの ごうけい せんとうりょく */
  function teamPower() {
    return teamUnits().reduce((a, u) => a + unitPower(u), 0);
  }

  /* =========================================================
     セーブ
     ========================================================= */
  function persist() {
    if (!S.data) return;
    S.data.lastSeen = Date.now();
    U.save(S.data);
  }
  function restore() {
    const d = U.load();
    if (!d || d.v !== 1) return null;
    // 欠けている キーを おぎなう（バージョン差の 保険）
    d.res = Object.assign({}, R.startRes, d.res);
    d.stats = Object.assign({ battles: 0, wins: 0, scouts: 0, built: 0, captured: 0, lost: 0 }, d.stats);
    d.seen = d.seen || {};
    d.equips = d.equips || {};
    d.pendingScout = Array.isArray(d.pendingScout) ? d.pendingScout : null;
    S.data = d;
    return d;
  }

  GP.state = {
    S,
    get st() { return S.data; },
    newGame, restore, persist,
    makeUnit, unitName, unitStats, unitPower, giveXp, xpNeed, rollEvolution,
    plotsOpen, facilityAgg, ownedTileIds, tileYield, teamCap, rosterCap,
    kigenTarget, isStriking, prodMultiplier, income,
    canPay, pay, gain, lackList, log,
    addEquip, equipFree, setEquip, unitById, teamUnits, teamPower, alertNeighbors,
    tileById, tileNeighborIds, attackableIds, shares, tileDefense, enemyPower,
    nextDay, applyOffline,
  };
})(window.GP);
