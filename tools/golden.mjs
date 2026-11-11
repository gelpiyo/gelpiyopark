/* =========================================================
   tools/golden.mjs — Godot版の いしょく けんしょう用「せいかい データ」を つくる

   Web版の ほんもの の ロジック（js/util, data, hex, state, battle）を node で うごかし、
   きまった 入力に たいする けっかを godot/tests/golden.json に かきだす。
   Godot がわ（godot/tests/parity_test.gd）が おなじ 入力で さいじっこう して
   ぜんこうもく 一致するかを しらべる。

   ・時刻（Date.now）・ユニットID・演出用乱数（U.rnd）は こてい して 決定論に する
   ・Web版の ロジックを かえたら これを さいじっこう する

   つかいかた: node tools/golden.mjs
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let CLOCK = 1_760_000_000_000;      // こていした 時刻（ミリ秒）

function makeGame() {
  const store = new Map();
  const noopEl = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    setAttribute() {}, remove() {}, get firstElementChild() { return null; },
    children: [], hidden: false, textContent: '', innerHTML: '',
  });
  class FakeDate extends Date { static now() { return CLOCK; } }
  const ctx = createContext({
    console, Math, JSON, Object, Array, String, Number, Boolean, Map, Set, Error, Date: FakeDate,
    performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k),
    },
    document: {
      createElement: noopEl, createTextNode: () => ({}),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, readyState: 'complete', hidden: false,
    },
    URLSearchParams,
  });
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const f of ['js/util.js', 'js/data.js', 'js/piyo.js', 'js/hex.js', 'js/state.js']) {
    runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  ctx.GP.ui = {};
  runInContext(readFileSync(join(ROOT, 'js/battle.js'), 'utf8'), ctx, { filename: 'js/battle.js' });
  return ctx.GP;
}

const GP = makeGame();
const { util: U, data: D, state: St, battle: B } = GP;

// ---- 決定論に する ----
let uidN = 0;
U.uid = (p) => (p || 'id') + '_' + (++uidN);
U.rnd = U.makeRng(777);
const clone = (x) => JSON.parse(JSON.stringify(x));
const out = { _meta: { note: 'tools/golden.mjs で 自動生成。てで へんしゅう しない', clockStart: CLOCK } };

/* ---------- 1) 乱数 ---------- */
out.rng = [1, 42, 123456789, 4294967295, 2654435769].map((seed) => {
  const r = U.makeRng(seed);
  return {
    seed,
    next: Array.from({ length: 16 }, () => r()),
    int: Array.from({ length: 8 }, () => r.int(0, 9)),
    pick: Array.from({ length: 5 }, () => r.pick(['a', 'b', 'c', 'd', 'e'])),
    chance: Array.from({ length: 8 }, () => r.chance(0.3)),
    shuffle: r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
  };
});

/* ---------- 2) data.js の 計算式 ---------- */
out.formulas = {
  fac: D.FACILITIES.map((f) => ({
    id: f.id,
    cost: [0, 1, 2, 3, 4, 5].map((lv) => D.facCost(f.id, lv)),
    yield: [1, 2, 3, 4, 5, 6].map((lv) => D.facYield(f.id, lv)),
    kigen: [1, 2, 3, 4, 5, 6].map((lv) => D.facKigen(f.id, lv)),
    cap: [1, 2, 3, 4, 5, 6].map((lv) => D.facCap(f.id, lv)),
  })),
  xp: Array.from({ length: 25 }, (_, i) => D.RULES.xpTable(i + 1)),
  type: D.ROLE_ORDER.map((a) => D.ROLE_ORDER.map((d) => D.typeMult(a, d))),
};

/* ---------- 3) ユニット ステータス ---------- */
out.units = [];
const pushUnit = (u) => out.units.push({ unit: clone(u), stats: St.unitStats(u), power: St.unitPower(u), name: St.unitName(u) });
D.SPECIES.forEach((sp) => [1, 7, 13, 25].forEach((lv) =>
  pushUnit({ uid: 'x', sp: sp.id, lv, xp: 0, equip: null, evo: null, wins: 0 })));
D.EVOLUTIONS.forEach((e) => ['kopiyo', 'mizupiyo', 'gaki'].forEach((sp) => {
  if (D.SPECIES_BY_ID[sp]) pushUnit({ uid: 'x', sp, lv: 10, xp: 0, equip: null, evo: e.id, wins: 0 });
}));
D.SPECIES.forEach((sp) => D.EQUIPS.forEach((eq) =>
  pushUnit({ uid: 'x', sp: sp.id, lv: 5, xp: 0, equip: eq.id, evo: null, wins: 0 })));

/* ---------- 4) バトル ---------- */
{
  const g = U.makeRng(2024);
  const ters = Object.keys(D.TERRAIN);
  const facs = ['none', 'crow', 'cat', 'red'];
  out.battles = [];
  for (let i = 0; i < 140; i++) {
    const n = g.int(1, 5);
    const team = [];
    for (let k = 0; k < n; k++) {
      team.push({
        uid: 'b' + i + '_' + k, sp: g.pick(D.SPECIES).id, lv: g.int(1, 25), xp: 0,
        equip: g.chance(0.5) ? g.pick(D.EQUIPS).id : null,
        evo: g.chance(0.3) ? g.pick(D.EVOLUTIONS).id : null, wins: 0,
      });
    }
    const cfg = {
      terrain: g.pick(ters), playerUnits: team, enemyFac: g.pick(facs),
      enemyPower: Math.round((1.5 + g() * 28) * 100) / 100,
      tactic: g.pick(D.TACTICS).id, kigen: g.int(0, 100),
      seed: Math.floor(g() * 4294967296), defense: g.chance(0.3), defBonus: g.int(0, 12),
      cheer: g.chance(0.2),
    };
    const sim = B.simulate(cfg);
    // looks（見た目）は 画面がわの しごとなので のぞく
    sim.events.forEach((ev) => { if (ev.units) ev.units.forEach((u) => delete u.looks); });
    out.battles.push({ cfg: clone(cfg), result: clone(sim) });
  }
}

/* ---------- 5) ゲーム進行（state 全体を 1日ごとに きろく） ---------- */
function scenario(name, seed, opts) {
  uidN = 0;
  U.rnd = U.makeRng(777);
  CLOCK = 1_760_000_000_000;
  const st = St.newGame();
  st.seed = seed;
  if (opts.setup) opts.setup(st);
  const days = [];
  for (let i = 0; i < opts.days && !st.ended; i++) {
    const act = {};
    if (opts.capture && i % opts.capture === 0) {
      const ids = St.attackableIds();
      if (ids.length) {
        const id = ids[0];
        const t = St.tileById(id);
        const s = st.tiles[id];
        s.owner = 'player'; s.days = 0; s.def = Math.max(2, Math.round(t.def * 0.7));
        st.stats.captured += 1;
        act.captured = id;
        act.alerted = St.alertNeighbors(id);
        act.wiped = St.checkWipe(true);
      }
    }
    if (opts.xpEvery && i % opts.xpEvery === 0) act.xp = St.giveXp(st.units[0], 150);
    CLOCK += 60_000;
    const rep = St.nextDay({ noPlayerAttack: i % 3 === 0 });
    days.push({ i, act: clone(act), rep: clone(rep), st: clone(st) });
  }
  let offline = null;
  if (opts.offlineH) {
    CLOCK = st.lastSeen + opts.offlineH * 3600000;
    offline = { res: clone(St.applyOffline()), st: clone(st) };
  }
  return { name, seed, opts: { days: opts.days, capture: opts.capture || 0, xpEvery: opts.xpEvery || 0,
    offlineH: opts.offlineH || 0, setup: opts.setupName || '' }, days, offline };
}

const setups = {
  // えんちょうせん（DAY 10 いこうの ライバル 2回行動まで ためす）
  long: (st) => { st.overtime = true; },
  // ゆうぐを たくさん たてた こうえん（しゅうにゅう・ごきげん・まもりの 計算を ためす）
  rich: (st) => {
    ['swing', 'fountain', 'gym', 'candy', 'slide', 'base', 'house', 'craft', 'fort', 'flower']
      .forEach((f, i) => { st.plots[2 + i] = { fac: f, lv: 1 + (i % 3) }; });
    st.res.snack = 80;                       // でんせつ しんかが でやすい じょうけん
  },
  // ほぼ ぜん制圧（るす中に くつがえる ケース）
  conquer: (st) => {
    Object.keys(st.tiles).forEach((id) => { st.tiles[id].owner = 'player'; });
    St.checkWipe(true);
  },
  // カラス組を 1区画だけに（ぜんめつ ボーナス・ふっかつ）
  crowLast: (st) => {
    const crow = Object.keys(st.tiles).filter((id) => st.tiles[id].owner === 'crow');
    crow.slice(1).forEach((id) => { st.tiles[id].owner = 'none'; });
  },
};
out.scenarios = [
  scenario('なにもしない 10日', 11, { days: 45 }),
  scenario('なにもしない 45日（えんちょう）', 21, { days: 45, setup: setups.long, setupName: 'long' }),
  scenario('せめこみ＋育成（えんちょう）', 12345, { days: 45, capture: 2, xpEvery: 5, setup: setups.long, setupName: 'long', offlineH: 30 }),
  scenario('ゆうぐ たくさん', 777, { days: 30, capture: 3, xpEvery: 3, setup: setups.rich, setupName: 'rich', offlineH: 12 }),
  scenario('ぜん制圧 → るす', 99, { days: 0, setup: setups.conquer, setupName: 'conquer', offlineH: 40 }),
  scenario('カラス ぜんめつ', 4242, { days: 20, capture: 1, setup: setups.crowLast, setupName: 'crowLast', offlineH: 50 }),
];

/* ---------- 6) 区画まわりの 計算（ある時点の state で） ---------- */
{
  uidN = 0; U.rnd = U.makeRng(777); CLOCK = 1_760_000_000_000;
  const st = St.newGame(); st.seed = 5;
  setups.rich(st);
  for (let i = 0; i < 12; i++) St.nextDay({ noPlayerAttack: true });
  out.snapshot = {
    st: clone(st),
    calc: {
      agg: St.facilityAgg(), income: St.income(), kigenTarget: St.kigenTarget(),
      teamCap: St.teamCap(), rosterCap: St.rosterCap(), plotsOpen: St.plotsOpen(),
      shares: St.shares(), attackable: St.attackableIds(), owned: St.ownedTileIds(),
      defense: Object.fromEntries(Object.keys(st.tiles).map((id) => [id, St.tileDefense(id)])),
      enemyPower: Object.fromEntries(Object.keys(st.tiles).map((id) => [id, St.enemyPower(id)])),
      neighbors: Object.fromEntries(Object.keys(st.tiles).map((id) => [id, St.tileNeighborIds(id)])),
    },
  };
}


/* ---------- 7) 自動プレイ（tools/sim.mjs の ボットで 最後まで あそぶ） ---------- */
// sim.mjs から コピー（tools/golden.mjs を つくりなおす たびに さいしん に なる）
function playthrough(GP, seedBase) {
  const { data: D, state: St, battle: B, util: U } = GP;
  St.newGame();
  const st = St.st;
  let battles = 0, wins = 0;

  for (let guard = 0; guard < 200 && !st.ended; guard++) {
    // --- けんせつ：いちばん やすくて たてられる ものを たてる／きょうか ---
    for (let pass = 0; pass < 3; pass++) {
      const open = St.plotsOpen();
      let idx = -1;
      for (let i = 0; i < open; i++) if (!st.plots[i]) { idx = i; break; }
      if (idx >= 0) {
        const cands = D.FACILITIES
          .filter((f) => St.canPay(D.facCost(f.id, 0)))
          .sort((a, b) => (b.kigen + (b.yield.danbo || 0) * 2) - (a.kigen + (a.yield.danbo || 0) * 2));
        if (!cands.length) break;
        St.pay(D.facCost(cands[0].id, 0));
        st.plots[idx] = { fac: cands[0].id, lv: 1 };
        st.stats.built++;
      } else {
        const built = st.plots.map((p, i) => ({ p, i })).filter((x) => x.p && x.p.lv < 5);
        const up = built.find((x) => St.canPay(D.facCost(x.p.fac, x.p.lv)));
        if (!up) break;
        St.pay(D.facCost(up.p.fac, up.p.lv));
        up.p.lv++;
      }
    }

    // --- スカウト ---
    if (st.freeScoutDay !== st.day) {
      st.freeScoutDay = st.day;
      addRandomUnit(GP, 'N');
    }
    while (st.res.menko >= D.RULES.gachaCost1 && st.units.length < St.rosterCap()) {
      st.res.menko -= D.RULES.gachaCost1;
      addRandomUnit(GP, null);
    }
    // つよい じゅんに へんせい
    st.units.sort((a, b) => St.unitPower(b) - St.unitPower(a));
    st.team = st.units.slice(0, St.teamCap()).map((u) => u.uid);

    // --- しんぐん ---
    while (st.genki > 0) {
      const cands = St.attackableIds()
        .filter((id) => {
          const o = st.tiles[id].owner;
          return !(o !== 'none' && st.factions[o] && st.factions[o].pact > 0);
        })
        .sort((a, b) => St.tileDefense(a) - St.tileDefense(b));
      if (!cands.length) break;
      const id = cands[0];
      const mine = St.teamPower();
      if (mine < St.enemyPower(id) * 16) break;         // かちめが なければ ようすみ
      st.genki--;
      battles++;
      const sim = B.simulate({
        terrain: St.tileById(id).ter,
        playerUnits: St.teamUnits(),
        enemyFac: st.tiles[id].owner,
        enemyPower: St.enemyPower(id),
        tactic: st.tactic, kigen: st.kigen,
        seed: (seedBase + st.day * 131 + battles * 17) >>> 0,
      });
      if (sim.winner === 'p') {
        wins++;
        st.tiles[id].owner = 'player'; st.tiles[id].days = 0;
        st.tiles[id].def = Math.max(2, Math.round(St.tileById(id).def * 0.7));
        st.stats.captured++;
        const ter = D.TERRAIN[St.tileById(id).ter];
        Object.keys(ter.yield).forEach((k) => St.gain({ [k]: Math.round(ter.yield[k] * 3.4) }));
        St.gain({ danbo: 8, kakera: 3 });
        St.checkWipe(true);          // じぶんで ぜんめつ させたら タイムリミット +
        sim.survivors.forEach((uid) => St.giveXp(St.unitById(uid), D.RULES.xpPerWin));
      } else {
        st.kigenMod -= 8;
        sim.downed.forEach((uid) => St.giveXp(St.unitById(uid), 10));
      }
    }

    // --- そだてる ---
    {
      const T = D.RULES.train;
      while (St.canPay({ kakera: 5 * T.kakera, snack: 5 * T.snack }) && st.units.length) {
        St.pay({ kakera: 5 * T.kakera, snack: 5 * T.snack });
        St.giveXp(st.units[0], 5 * T.xp);
      }
    }

    const rep = St.nextDay();
    // ぼうえいせん
    if (rep.pendingAttack) {
      battles++;
      const pa = rep.pendingAttack;
      const sim = B.simulate({
        terrain: St.tileById(pa.tile).ter,
        playerUnits: St.teamUnits(),
        enemyFac: pa.fac, enemyPower: St.enemyPower(pa.tile) * 0.92,
        tactic: st.tactic, kigen: st.kigen,
        defense: true, defBonus: St.tileDefense(pa.tile),
        seed: (seedBase + st.day * 977 + battles * 31) >>> 0,
      });
      if (sim.winner === 'p') { wins++; st.kigenMod += 6; }
      else {
        st.tiles[pa.tile].owner = pa.fac;
        st.tiles[pa.tile].days = 0;
        st.stats.lost++;
        st.kigenMod -= 12;
      }
      if (St.shares().player === 0) st.ended = 'lose';
    }
  }

  const sh = St.shares();
  return {
    ended: st.ended, day: st.day, tiles: sh.player, units: st.units.length,
    battles, winRate: battles ? Math.round((wins / battles) * 100) : 0,
    kigen: st.kigen, built: st.stats.built,
    res: { d: st.res.danbo | 0, j: st.res.juice | 0, s: st.res.snack | 0, m: st.res.menko | 0 },
  };
}

function addRandomUnit(GP, forceRar) {
  const { data: D, state: St, util: U } = GP;
  const st = St.st;
  const x = U.rnd();
  const rar = forceRar || (x < D.GACHA_RATE.SR ? 'SR' : x < D.GACHA_RATE.SR + D.GACHA_RATE.R ? 'R' : 'N');
  const sp = U.rnd.pick(D.SPECIES.filter((s) => s.rar === rar));
  st.seen[sp.id] = true;
  if (st.units.length >= St.rosterCap() || st.units.filter((u) => u.sp === sp.id).length >= 3) {
    st.res.kakera += D.RULES.dupKakera[sp.rar];
    return;
  }
  st.units.push(St.makeUnit(sp.id, 1));
}

out.bot = [];
for (let g = 0; g < 12; g++) {
  uidN = 0; U.rnd = U.makeRng(500 + g); CLOCK = 1_760_000_000_000;
  const realNew = St.newGame;
  St.newGame = () => { const st = realNew(); st.seed = 1000 + g; return st; };
  const summary = playthrough(GP, 7000 + g * 13);
  St.newGame = realNew;
  out.bot.push({ game: g, newGameSeed: 1000 + g, rndSeed: 500 + g, seedBase: 7000 + g * 13,
    summary, st: clone(St.st) });
}

const dest = join(ROOT, 'godot/tests/golden.json');
mkdirSync(dirname(dest), { recursive: true });
const json = JSON.stringify(out);
writeFileSync(dest, json);
const evCount = out.battles.reduce((a, b) => a + b.result.events.length, 0);
const dayCount = out.scenarios.reduce((a, s) => a + s.days.length, 0);
console.log(`wrote ${dest} ${(json.length / 1024).toFixed(0)}KB`);
console.log(`  自動プレイ ${out.bot.length}ゲーム（決着日 ${out.bot.map((x) => x.summary.day).join(',')}）`);
console.log(`  乱数 ${out.rng.length}シード / ユニット ${out.units.length} / バトル ${out.battles.length}（イベント ${evCount}）/ シナリオ ${out.scenarios.length}（${dayCount}日ぶん）`);
