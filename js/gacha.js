/* =========================================================
   gacha.js — ぴよスカウト
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const UI = GP.ui;
  const { $, el } = U;

  let rolling = false;

  /* =========================================================
     えがく
     ========================================================= */
  function render() {
    const st = St.st;
    const stage = $('#gacha-stage');
    stage.innerHTML = '';
    stage.appendChild(el('div', { class: 'gacha-bush' }));
    const peek = st.units.length
      ? GP.piyo.svg(GP.piyo.looksOf(st.units[st.units.length - 1], 'happy'))
      : GP.piyo.svg({ hue: 48, sat: 88, lit: 60, mood: 'happy' });
    stage.appendChild(el('div', { class: 'gacha-piyo', html: peek }));

    const free = st.freeScoutDay !== st.day;
    const btnFree = $('#btn-scout-free');
    btnFree.disabled = !free;
    $('#free-sub').textContent = free ? '1日1回 むりょう（きょう まだ）' : 'きょうは もう つかった';

    $('#btn-scout1').disabled = st.res.menko < D.RULES.gachaCost1;
    $('#btn-scout10').disabled = st.res.menko < D.RULES.gachaCost10;
  }

  /* =========================================================
     ちゅうせん
     ========================================================= */
  function rollRarity(rng, floorR) {
    if (floorR) {
      // R かくてい わく：SR / R のみ
      return rng() < D.GACHA_RATE.SR / (D.GACHA_RATE.SR + D.GACHA_RATE.R) ? 'SR' : 'R';
    }
    const x = rng();
    if (x < D.GACHA_RATE.SR) return 'SR';
    if (x < D.GACHA_RATE.SR + D.GACHA_RATE.R) return 'R';
    return 'N';
  }

  function rollOne(rng, floorR) {
    const rar = rollRarity(rng, floorR);
    const pool = D.SPECIES.filter((s) => s.rar === rar);
    return rng.pick(pool);
  }

  /* =========================================================
     スカウト じっこう
     ========================================================= */
  async function scout(count, cost, guaranteeR) {
    const st = St.st;
    if (rolling) return;
    if (cost && !St.canPay(cost)) { UI.toast('レアメンコが たりない…', 'bad'); return; }
    if (cost) St.pay(cost);
    rolling = true;

    const stage = $('#gacha-stage');
    stage.classList.add('is-rolling');
    UI.refreshHud();
    await U.sleep(620);
    stage.classList.remove('is-rolling');

    // ここでは まだ なかまに くわえない。
    // けっか画面で「なかまに する／にがす」を えらんでから かくてい する。
    const rng = U.rnd;
    const results = [];
    const batchSeen = new Set();
    for (let i = 0; i < count; i++) {
      const sp = rollOne(rng, guaranteeR && i === count - 1);
      results.push({ sp, isNew: !st.seen[sp.id] && !batchSeen.has(sp.id), marked: false });
      batchSeen.add(sp.id);
    }
    st.stats.scouts += count;
    St.persist();
    rolling = false;
    UI.refreshHud();
    render();
    showResults(results);
  }

  /** 種族を なかまに くわえる（あふれ / かぶり の しょり こみ） */
  function addSpecies(sp) {
    const st = St.st;
    const isNew = !st.seen[sp.id];
    st.seen[sp.id] = true;

    const dupCount = st.units.filter((u) => u.sp === sp.id).length;
    const full = st.units.length >= St.rosterCap();
    const k = D.RULES.dupKakera[sp.rar];

    if (full) {
      st.res.kakera += k;
      return { sp, kind: 'kakera', kakera: k, isNew, reason: 'full' };
    }
    if (dupCount >= 3) {
      st.res.kakera += k;
      return { sp, kind: 'kakera', kakera: k, isNew, reason: 'dup' };
    }
    const u = St.makeUnit(sp.id, 1);
    st.units.push(u);
    if (st.team.length < St.teamCap()) st.team.push(u.uid);
    return { sp, kind: 'unit', unit: u, isNew };
  }

  /* =========================================================
     けっか — 「なかまに する」か「にがす」を えらんで かくてい
     ========================================================= */
  function showResults(results) {
    const st = St.st;
    const multi = results.length > 1;
    let decided = false;

    /** mode: 'keep' = にがすマークの ない子を なかまに ／ 'release' = ぜんいん にがす */
    const commit = (mode) => {
      if (decided) return;
      decided = true;
      let kept = 0, gotKakera = 0;
      results.forEach((r) => {
        if (mode === 'release' || r.marked) {
          const k = D.RULES.dupKakera[r.sp.rar];
          st.res.kakera += k;
          gotKakera += k;
          return;
        }
        const out = addSpecies(r.sp);              // 上限・かぶりの じどう変換は ここで
        if (out.kind === 'unit') kept += 1;
        else gotKakera += out.kakera;
      });
      St.persist();
      UI.refreshHud();
      if (kept) UI.toast(`なかまが ${kept}ぴよ ふえた！` + (gotKakera ? `　🧩+${gotKakera}` : ''), 'good');
      else UI.toast(`🧩 かけら +${gotKakera}`, 'good');
    };

    const body = el('div');
    const grid = el('div', { class: 'result-grid' });

    results.forEach((r, i) => {
      const rar = D.RARITY[r.sp.rar];
      const cell = el(multi ? 'button' : 'div', {
        class: 'result-cell' + (r.isNew ? ' is-new' : ''),
        type: multi ? 'button' : null,
        style: 'animation-delay:' + (i * 70) + 'ms',
      });
      cell.innerHTML = GP.piyo.svg({
        hue: r.sp.hue, sat: r.sp.sat, lit: r.sp.lit,
        kind: r.sp.kind || 'piyo', acc: r.sp.acc ? [r.sp.acc] : [], mood: 'happy',
      });
      cell.appendChild(el('div', { class: 'rn', style: 'color:' + rar.color, text: rar.name }));
      cell.appendChild(el('div', { class: 'rn', text: r.sp.name }));
      if (r.isNew) cell.appendChild(el('span', { class: 'newtag', text: 'NEW' }));
      cell.appendChild(el('span', { class: 'reltag', text: 'にがす' }));
      if (multi) {
        cell.addEventListener('click', () => {
          r.marked = !r.marked;
          cell.classList.toggle('is-release', r.marked);
        });
      }
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    const news = results.filter((r) => r.isNew).length;
    if (news) body.appendChild(el('p', { class: 'hint', text: `あたらしい なかま ${news} しゅるい！` }));
    if (multi) {
      body.appendChild(el('p', {
        class: 'hint',
        text: 'タップで にがす子を えらべます（のこりは なかまに）。',
      }));
    }
    const dk = D.RULES.dupKakera;
    body.appendChild(el('p', {
      class: 'hint',
      text: `にがすと かけらに なります（N🧩${dk.N}／R🧩${dk.R}／SR🧩${dk.SR}）。` +
        'なかまが いっぱいの ときや おなじ子が 3びき いるときも かけらに なります。',
    }));

    const best = results.reduce((a, r) =>
      D.RARITY[r.sp.rar].star > D.RARITY[a.sp.rar].star ? r : a, results[0]);
    const title = D.RARITY[best.sp.rar].star === 3 ? '✨ SR が でた！' : 'スカウト けっか';

    UI.modal({
      title, body,
      buttons: [
        { label: multi ? 'ぜんぶ にがす' : 'にがす', cls: 'btn-ghost', onClick: () => commit('release') },
        { label: 'なかまに する', cls: 'btn-accent', onClick: () => commit('keep') },
      ],
      // ✕や 背景タップで とじたときは「なかまに する」あつかい（まちがって きえないように）
      onClose: () => { commit('keep'); UI.rerender(); },
    });
  }

  /* =========================================================
     しょきか
     ========================================================= */
  function init() {
    $('#btn-scout-free').addEventListener('click', () => {
      const st = St.st;
      if (st.freeScoutDay === st.day) { UI.toast('きょうは もう スカウトしたよ', ''); return; }
      st.freeScoutDay = st.day;
      scout(1, null, false);
    });
    $('#btn-scout1').addEventListener('click', () =>
      scout(1, { menko: D.RULES.gachaCost1 }, false));
    $('#btn-scout10').addEventListener('click', () =>
      scout(10, { menko: D.RULES.gachaCost10 }, true));
    UI.register('gacha', { render });
  }

  GP.gacha = { init, render, addSpecies };
})(window.GP);
