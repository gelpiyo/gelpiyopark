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
    const looks = st.units.length
      ? GP.piyo.looksOf(st.units[st.units.length - 1], 'happy')
      : { hue: 48, sat: 88, lit: 60, mood: 'happy' };
    const v3 = GP.piyo.view3d(looks, { size: 118 });
    if (v3) {
      const holder = el('div', { class: 'gacha-piyo' });
      holder.appendChild(v3);
      stage.appendChild(holder);
    } else {
      stage.appendChild(el('div', { class: 'gacha-piyo', html: GP.piyo.svg(looks) }));
    }

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
    const records = [];
    const batchSeen = new Set();
    for (let i = 0; i < count; i++) {
      const sp = rollOne(rng, guaranteeR && i === count - 1);
      records.push({ sp: sp.id, isNew: !st.seen[sp.id] && !batchSeen.has(sp.id), marked: false });
      batchSeen.add(sp.id);
    }
    st.stats.scouts += count;
    // かくてい前に とじても ひかない ぶんが きえないよう、けっかを 先に ほぞん
    st.pendingScout = records;
    St.persist();
    rolling = false;
    UI.refreshHud();
    render();
    showResults(records);
  }

  /** 再開時：かくてい前の スカウト結果が のこっていたら モーダルを ふくげんする */
  function resumePending(after) {
    const st = St.st;
    if (!st || !st.pendingScout || !st.pendingScout.length) {
      if (after) after();
      return;
    }
    showResults(st.pendingScout, after, true);
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
  function showResults(records, after, resumed) {
    const st = St.st;
    // ほぞん形式（種族ID）から 表示用に ひく。しらない IDは とばす（将来の互換）
    const items = records
      .map((rec) => ({ rec, sp: D.SPECIES_BY_ID[rec.sp] }))
      .filter((x) => x.sp);
    if (!items.length) {
      st.pendingScout = null;
      St.persist();
      if (after) after();
      return;
    }
    const multi = items.length > 1;
    let decided = false;

    /** mode: 'keep' = にがすマークの ない子を なかまに ／ 'release' = ぜんいん にがす */
    const commit = (mode) => {
      if (decided) return;
      decided = true;
      let kept = 0, gotKakera = 0;
      items.forEach(({ rec, sp }) => {
        if (mode === 'release' || rec.marked) {
          const k = D.RULES.dupKakera[sp.rar];
          st.res.kakera += k;
          gotKakera += k;
          return;
        }
        const out = addSpecies(sp);              // 上限・かぶりの じどう変換は ここで
        if (out.kind === 'unit') kept += 1;
        else gotKakera += out.kakera;
      });
      st.pendingScout = null;                    // かくてい したので ほぞんを けす
      St.persist();
      UI.refreshHud();
      if (kept) UI.toast(`なかまが ${kept}ぴよ ふえた！` + (gotKakera ? `　🧩+${gotKakera}` : ''), 'good');
      else UI.toast(`🧩 かけら +${gotKakera}`, 'good');
    };

    const body = el('div');
    if (resumed) {
      body.appendChild(el('p', {
        class: 'hint',
        style: 'margin-top:0',
        text: 'とじる まえの スカウトけっかを ふくげん しました。',
      }));
    }
    const grid = el('div', { class: 'result-grid' });

    items.forEach(({ rec, sp }, i) => {
      const rar = D.RARITY[sp.rar];
      const cell = el(multi ? 'button' : 'div', {
        class: 'result-cell' + (rec.isNew ? ' is-new' : '') + (rec.marked ? ' is-release' : ''),
        type: multi ? 'button' : null,
        style: 'animation-delay:' + (i * 70) + 'ms',
      });
      cell.innerHTML = GP.piyo.svg({
        hue: sp.hue, sat: sp.sat, lit: sp.lit,
        kind: sp.kind || 'piyo', acc: sp.acc ? [sp.acc] : [], mood: 'happy',
      });
      cell.appendChild(el('div', { class: 'rn', style: 'color:' + rar.color, text: rar.name }));
      cell.appendChild(el('div', { class: 'rn', text: sp.name }));
      if (rec.isNew) cell.appendChild(el('span', { class: 'newtag', text: 'NEW' }));
      cell.appendChild(el('span', { class: 'reltag', text: 'にがす' }));
      if (multi) {
        cell.addEventListener('click', () => {
          rec.marked = !rec.marked;
          cell.classList.toggle('is-release', rec.marked);
          St.persist();                          // マークも ほぞん（再開時に ひきつぐ）
        });
      }
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    const news = items.filter((x) => x.rec.isNew).length;
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

    const best = items.reduce((a, x) =>
      D.RARITY[x.sp.rar].star > D.RARITY[a.sp.rar].star ? x : a, items[0]);
    const title = D.RARITY[best.sp.rar].star === 3 ? '✨ SR が でた！' : 'スカウト けっか';

    UI.modal({
      title, body,
      buttons: [
        { label: multi ? 'ぜんぶ にがす' : 'にがす', cls: 'btn-ghost', onClick: () => commit('release') },
        { label: 'なかまに する', cls: 'btn-accent', onClick: () => commit('keep') },
      ],
      // ✕や 背景タップで とじたときは「なかまに する」あつかい（まちがって きえないように）
      onClose: () => {
        commit('keep');
        UI.rerender();
        if (after) setTimeout(after, 150);
      },
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

  GP.gacha = { init, render, addSpecies, resumePending };
})(window.GP);
