/* =========================================================
   tools/sim.mjs — ゲームロジックの 自動テスト & バランス確認
   ブラウザ抜きで state.js / battle.js を うごかし、
   ・例外が でないか
   ・勝率／決着日数／リソース推移 が まともか
   を まとめて しらべる。

   つかいかた:  node tools/sim.mjs [試行回数]
   ========================================================= */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- ブラウザAPIの さいしょうげん スタブ ---------- */
function makeGame() {
  const store = new Map();
  const noopEl = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    setAttribute() {}, remove() {}, get firstElementChild() { return null; },
    children: [], hidden: false, textContent: '', innerHTML: '',
  });
  const ctx = createContext({
    console,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Map, Set, Error,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    document: {
      createElement: noopEl, createTextNode: () => ({}),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, readyState: 'complete', hidden: false,
    },
    URLSearchParams,
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  for (const f of ['js/util.js', 'js/data.js', 'js/piyo.js', 'js/hex.js', 'js/state.js']) {
    runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  ctx.GP.ui = {};                        // battle.js が さんしょう するだけの ダミー
  runInContext(readFileSync(join(ROOT, 'js/battle.js'), 'utf8'), ctx, { filename: 'js/battle.js' });
  return ctx.GP;
}

/* =========================================================
   1) たんたいテスト
   ========================================================= */
function unitTests(GP) {
  const { data: D, state: St, util: U } = GP;
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  St.newGame();
  const st = St.st;

  ok(st.units.length === 3, 'しょきメンバーは 3ぴよ');
  ok(st.team.length === 3, 'しょきへんせいは 3ぴよ');
  ok(Object.keys(st.tiles).length === D.TILES.length, '区画かずが マスタと あう');
  ok(St.shares().player === 1, 'しょきの じぶんの 区画は 1');

  // ステータス
  const u = st.units[0];
  const s1 = St.unitStats(u);
  u.lv = 10;
  const s2 = St.unitStats(u);
  ok(s2.atk > s1.atk && s2.hp > s1.hp, 'レベルで ステータスが あがる');
  u.lv = 1;

  // そうび
  St.addEquip('gun', 1);
  ok(St.equipFree('gun') === 1, 'そうびの あきかず');
  St.setEquip(u, 'gun');
  ok(St.equipFree('gun') === 0, 'そうび中は あきが へる');
  ok(St.unitStats(u).atk > s1.atk, 'そうびで こうげきが あがる');
  St.setEquip(u, 'gun');
  ok(u.equip === null, 'おなじ そうびを タップで はずせる');

  // 相性
  ok(D.typeMult('rush', 'range') > 1, 'そっこう は えんきょり に つよい');
  ok(D.typeMult('rush', 'guard') < 1, 'そっこう は ぼうぎょ に よわい');
  ok(D.typeMult('range', 'guard') > 1, 'えんきょり は ぼうぎょ に つよい');
  ok(D.typeMult('guard', 'rush') > 1, 'ぼうぎょ は そっこう に つよい');

  // しさん
  const before = st.res.danbo;
  ok(St.canPay({ danbo: 1 }) === true, 'はらえる');
  St.pay({ danbo: 5 });
  ok(st.res.danbo === before - 5, 'しはらい');
  St.gain({ danbo: 5 });
  ok(st.res.danbo === before, 'かいふく');
  ok(St.canPay({ danbo: 99999 }) === false, 'たりないと はらえない');

  // ヘックス きんぼう
  const nb = St.tileNeighborIds('t00');
  ok(nb.length === 6, 'ちゅうおうの となりは 6区画（実際 ' + nb.length + '）');
  ok(St.attackableIds().length === 6, 'しょきの こうげき かのう 区画は 6');

  // けいけんち／しんか
  const u2 = St.makeUnit('kopiyo', 1);
  const evs = St.giveXp(u2, 1000000);
  ok(u2.lv === D.RULES.lvMax, 'けいけんち たくさんで さいだいレベル');
  ok(evs.some((e) => e.type === 'evo'), 'とちゅうで しんかが おきる');

  // 放置
  st.lastSeen = Date.now() - 3600 * 1000 * 4;
  const off = St.applyOffline();
  ok(off && off.hours > 3.9, 'るすばん せいさんが けいさん される');

  return fails;
}

/* =========================================================
   2) バトル 勝率テスト
   ========================================================= */
function battleTests(GP, N) {
  const { data: D, state: St, battle: B, util: U } = GP;
  const rows = [];
  for (const [label, group] of [['中立', ['t02', 't03', 't04', 't05']], ['本拠', ['t07', 't11', 't17', 't09']]])
  for (const day of [1, 8, 16, 26, 36]) {
    let wins = 0, turnsSum = 0, err = 0;
    for (let i = 0; i < N; i++) {
      St.newGame();
      const st = St.st;
      st.day = day;
      // その日 そうおうに そだった チーム
      // その日 そうおうに そだった チーム（レア・そうび こみの 現実的な 想定）
      const lv = Math.max(1, Math.round(1 + day * 0.46));
      st.units.forEach((u) => { u.lv = lv; });
      const want = Math.min(5, 3 + Math.floor(day / 10));
      while (st.units.length < want) {
        const rar = day >= 12 && st.units.length === 3 ? 'SR' : 'R';
        const sp = U.rnd.pick(D.SPECIES.filter((x) => x.rar === rar));
        const nu = St.makeUnit(sp.id, lv);
        st.units.push(nu); st.team.push(nu.uid);
      }
      if (day >= 8) {
        ['gun', 'shield', 'boots', 'crown', 'whistle'].forEach((e) => St.addEquip(e, 1));
        St.teamUnits().forEach((u, k) => St.setEquip(u, ['gun', 'shield', 'boots', 'crown', 'whistle'][k]));
      }
      const tileId = U.rnd.pick(group);
      try {
        const sim = B.simulate({
          terrain: St.tileById(tileId).ter,
          playerUnits: St.teamUnits(),
          enemyFac: st.tiles[tileId].owner,
          enemyPower: St.enemyPower(tileId),
          tactic: U.rnd.pick(['charge', 'defend', 'surround']),
          kigen: 60, seed: (day * 7919 + i * 31) >>> 0,
        });
        if (sim.winner === 'p') wins++;
        turnsSum += sim.events.filter((e) => e.t === 'turn').length;
      } catch (e) { err++; if (err === 1) console.error('  battle error:', e.message); }
    }
    rows.push({ label, day, winRate: Math.round((wins / N) * 100), avgTurns: Math.round(turnsSum / N), err });
  }
  return rows;
}

/* =========================================================
   3) 通しプレイ（かんたんAI）
   ========================================================= */
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

/* =========================================================
   じっこう
   ========================================================= */
const N = +(process.argv[2] || 40);
const GP = makeGame();

console.log('=== 1. たんたいテスト ===');
const fails = unitTests(GP);
if (fails.length) { fails.forEach((f) => console.log('  NG:', f)); }
else console.log('  すべて OK');

console.log('\n=== 2. バトル 勝率（' + N + '回/日） ===');
console.log('  相手   DAY   勝率   平均ターン  エラー');
battleTests(GP, N).forEach((r) => {
  console.log(`  ${r.label}  ${String(r.day).padStart(4)}  ${String(r.winRate).padStart(4)}%  ${String(r.avgTurns).padStart(8)}  ${r.err}`);
});

console.log('\n=== 3. 通しプレイ（' + N + '回） ===');
const results = [];
let crashed = 0;
for (let i = 0; i < N; i++) {
  try { results.push(playthrough(GP, (i * 7919 + 13) >>> 0)); }
  catch (e) { crashed++; if (crashed === 1) console.error('  crash:', e.stack.split('\n').slice(0, 3).join('\n')); }
}
const by = (k) => results.map((r) => r[k]);
const avg = (a) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
const count = (v) => results.filter((r) => r.ended === v).length;
console.log('  クラッシュ           :', crashed);
console.log('  かち（全区画/最多）  :', count('win'), '/', results.length);
console.log('  まけ（全滅）         :', count('lose'));
console.log('  時間ぎれ（区画で負け）:', count('timeup'));
console.log('  平均 決着日          :', avg(by('day')));
console.log('  平均 さいしゅう区画  :', avg(by('tiles')), '/', GP.data.TILES.length);
console.log('  平均 バトル数        :', avg(by('battles')), '（勝率', avg(by('winRate')) + '%）');
console.log('  平均 ごきげん度      :', avg(by('kigen')));
console.log('  平均 なかま／ゆうぐ  :', avg(by('units')), '/', avg(by('built')));
console.log('  平均 のこりリソース  : 📦' + avg(results.map((r) => r.res.d)),
            '🥤' + avg(results.map((r) => r.res.j)),
            '🍪' + avg(results.map((r) => r.res.s)),
            '🎴' + avg(results.map((r) => r.res.m)));

process.exit(fails.length || crashed ? 1 : 0);
