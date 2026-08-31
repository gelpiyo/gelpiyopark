/* =========================================================
   park.js — こうえん（内政）画面
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const UI = GP.ui;
  const { $, el } = U;

  /* =========================================================
     えがく
     ========================================================= */
  function render() {
    const st = St.st;
    const agg = St.facilityAgg();
    const owned = St.ownedTileIds();

    $('#park-name').textContent = 'ぴよ団の こうえん';
    $('#park-sub').textContent =
      `なかま ${st.units.length}/${St.rosterCap()}　定員 ${agg.cap}　なわばり ${owned.length}/${D.TILES.length}`;

    // しゅうにゅう
    const inc = St.income();
    const box = $('#park-income');
    box.innerHTML = '';
    const keys = D.RES_ORDER.filter((k) => inc[k] > 0);
    if (!keys.length) box.appendChild(el('span', { class: 'inc' }, 'しゅうにゅう なし'));
    keys.forEach((k) => {
      box.appendChild(el('span', { class: 'inc up' }, D.RES[k].ico + '+' + inc[k]));
    });
    if (St.isStriking()) {
      box.appendChild(el('span', { class: 'inc', style: 'color:#E4614F' }, '😖ストライキ中'));
    }

    renderGrid();
    renderLog();

    const sub = $('#nextday-sub');
    const left = D.RULES.dayLimit - st.day + 1;
    sub.textContent = `せいさん回収＋ライバル行動　のこり ${Math.max(0, left)}日`;
  }

  function renderGrid() {
    const st = St.st;
    const grid = $('#park-grid');
    grid.innerHTML = '';
    const open = St.plotsOpen();

    for (let i = 0; i < D.RULES.plotsTotal; i++) {
      const p = st.plots[i];
      if (i >= open) {
        grid.appendChild(el('button', {
          class: 'plot is-locked', type: 'button',
          onclick: () => UI.toast('なわばりを ひろげると あきちが ふえるよ', ''),
        }, [
          el('span', { class: 'plot-ico', text: '🔒' }),
          el('span', { class: 'plot-name', text: 'あきち' }),
        ]));
        continue;
      }
      if (!p) {
        const b = el('button', {
          class: 'plot is-empty can-build', type: 'button',
          onclick: () => openBuild(i),
        });
        grid.appendChild(b);
        continue;
      }
      const f = D.FAC_BY_ID[p.fac];
      const b = el('button', { class: 'plot is-built', type: 'button', onclick: () => openPlot(i) }, [
        el('span', { class: 'plot-lv', text: 'Lv' + p.lv }),
        el('span', { class: 'plot-ico', text: f.ico }),
        el('span', { class: 'plot-name', text: f.short || f.name }),
      ]);
      // あそんでいる ぴよ
      const cap = D.facCap(p.fac, p.lv);
      const show = Math.min(2, cap, st.units.length);
      for (let k = 0; k < show; k++) {
        const u = st.units[(i * 3 + k) % st.units.length];
        const svg = GP.piyo.svg(GP.piyo.looksOf(u, 'happy'));
        const holder = el('span', { class: 'plot-piyo' + (k ? ' p2' : ''), html: svg });
        b.appendChild(holder.firstElementChild ? holder : holder);
      }
      grid.appendChild(b);
    }
  }

  function renderLog() {
    const list = $('#park-log');
    list.innerHTML = '';
    const st = St.st;
    if (!st.log.length) {
      list.appendChild(el('li', {}, [el('span', { class: 'log-txt', text: 'まだ なにも ないよ。' })]));
      return;
    }
    st.log.slice(0, 14).forEach((l) => {
      list.appendChild(el('li', { class: l.kind }, [
        el('span', { class: 'log-day', text: 'D' + l.day }),
        el('span', { class: 'log-txt', text: l.text }),
      ]));
    });
  }

  /* =========================================================
     けんせつ
     ========================================================= */
  function openBuild(idx) {
    const st = St.st;
    const list = el('div', { class: 'build-list' });

    D.FACILITIES.forEach((f) => {
      const cost = D.facCost(f.id, 0);
      const ok = St.canPay(cost);
      const y = D.facYield(f.id, 1);
      const bits = [];
      const yt = UI.yieldText(y);
      if (yt !== 'なし') bits.push('1日 ' + yt);
      bits.push('ごきげん +' + U.round(D.facKigen(f.id, 1), 0));
      if (f.cap) bits.push('定員 ' + D.facCap(f.id, 1));
      if (f.bonus && f.bonus.teamCap) bits.push('出撃わく +' + f.bonus.teamCap);
      if (f.bonus && f.bonus.roster) bits.push('なかま上限 +' + f.bonus.roster);
      if (f.bonus && f.bonus.def) bits.push('まもり +' + f.bonus.def);

      const item = el('button', {
        class: 'build-item', type: 'button', disabled: ok ? null : true,
        onclick: () => doBuild(idx, f.id),
      }, [
        el('span', { class: 'build-ico', text: f.ico }),
        el('span', { class: 'build-info' }, [
          el('h4', { text: f.name }),
          el('p', { text: f.desc }),
          el('span', { class: 'build-cost', html: UI.costText(cost) + '　' + bits.join('・') }),
        ]),
      ]);
      list.appendChild(item);
    });

    UI.modal({ title: 'ゆうぐを たてる', body: list });
  }

  function doBuild(idx, facId) {
    const st = St.st;
    const cost = D.facCost(facId, 0);
    if (!St.pay(cost)) { UI.toast('ざいりょうが たりない…', 'bad'); return; }
    st.plots[idx] = { fac: facId, lv: 1 };
    st.stats.built += 1;
    st.kigenMod += 4;
    st.kigen = U.clamp(Math.round(St.kigenTarget() + st.kigenMod), 0, 100);
    St.log(D.FAC_BY_ID[facId].name + 'が かんせい！ みんな よろこんでいる。', 'good');
    UI.closeModal();
    UI.toast(D.FAC_BY_ID[facId].ico + ' ' + D.FAC_BY_ID[facId].name + 'を たてた！', 'good');
    St.persist();
    render(); UI.refreshHud();
  }

  /* =========================================================
     しせつの しょうさい / きょうか
     ========================================================= */
  function openPlot(idx) {
    const st = St.st;
    const p = st.plots[idx];
    const f = D.FAC_BY_ID[p.fac];
    const body = el('div');

    body.appendChild(el('p', { class: 'hint', text: f.desc }));

    const now = { y: D.facYield(p.fac, p.lv), k: D.facKigen(p.fac, p.lv), c: D.facCap(p.fac, p.lv) };
    const nxt = { y: D.facYield(p.fac, p.lv + 1), k: D.facKigen(p.fac, p.lv + 1), c: D.facCap(p.fac, p.lv + 1) };

    body.appendChild(UI.kv('レベル', `Lv${p.lv} <span style="color:#8A7969">→ Lv${p.lv + 1}</span>`));
    body.appendChild(UI.kv('1日の さんしゅつ',
      `${UI.yieldText(now.y)} <span style="color:#8A7969">→ ${UI.yieldText(nxt.y)}</span>`));
    body.appendChild(UI.kv('ごきげん',
      `+${U.round(now.k, 1)} <span style="color:#8A7969">→ +${U.round(nxt.k, 1)}</span>`));
    body.appendChild(UI.kv('あそべる 定員',
      `${now.c} <span style="color:#8A7969">→ ${nxt.c}</span>`));
    if (f.bonus) {
      const t = [];
      if (f.bonus.teamCap) t.push('出撃わく +' + f.bonus.teamCap * p.lv);
      if (f.bonus.roster) t.push('なかま上限 +' + f.bonus.roster * p.lv);
      if (f.bonus.def) t.push('ホーム まもり +' + f.bonus.def * p.lv);
      body.appendChild(UI.kv('とくしゅ', t.join('・')));
    }

    const cost = D.facCost(p.fac, p.lv);
    body.appendChild(el('p', { class: 'hint', text: 'きょうか に ひつような ざいりょう' }));
    body.appendChild(UI.costRow(cost));

    const refund = {};
    const spent = D.facCost(p.fac, 0);
    Object.keys(spent).forEach((k) => { refund[k] = Math.floor(spent[k] * 0.5); });

    UI.modal({
      title: f.ico + ' ' + f.name,
      body,
      buttons: [
        { label: 'とりこわす', cls: 'btn-ghost', onClick: () => confirmRemove(idx, refund) },
        {
          label: 'きょうか する', cls: 'btn-accent',
          disabled: !St.canPay(cost),
          onClick: () => {
            if (!St.pay(cost)) return false;
            p.lv += 1;
            st.kigenMod += 2;
            St.log(f.name + 'を Lv' + p.lv + 'に きょうかした！', 'good');
            UI.toast('Lv' + p.lv + 'に なった！', 'good');
            St.persist(); render(); UI.refreshHud();
          },
        },
      ],
    });
  }

  function confirmRemove(idx, refund) {
    const st = St.st;
    const p = st.plots[idx];
    const f = D.FAC_BY_ID[p.fac];
    UI.modal({
      title: 'とりこわす？',
      body: el('div', {}, [
        el('p', { class: 'hint', text: f.name + 'を とりこわします。ざいりょうの はんぶんが もどります。' }),
        UI.costRow(refund),
      ]),
      buttons: [
        { label: 'やめる', cls: 'btn-ghost' },
        {
          label: 'とりこわす', cls: 'btn-danger',
          onClick: () => {
            St.gain(refund);
            st.plots[idx] = null;
            st.kigenMod -= 3;
            St.log(f.name + 'を とりこわした。', 'none');
            St.persist(); render(); UI.refreshHud();
          },
        },
      ],
    });
    return false;
  }

  /* =========================================================
     つぎの日へ
     ========================================================= */
  let advancing = false;
  async function nextDay() {
    if (advancing) return;
    const st = St.st;
    if (st.ended) { GP.main.showEnding(); return; }
    advancing = true;
    const btn = $('#btn-nextday');
    btn.disabled = true;

    const rep = St.nextDay();
    St.persist();
    UI.refreshHud();
    render();

    showDayReport(rep, () => {
      advancing = false;
      btn.disabled = false;
      if (rep.pendingAttack) {
        GP.worldmap.defendBattle(rep.pendingAttack);
      } else if (st.ended) {
        GP.main.showEnding();
      }
    });
  }

  function showDayReport(rep, done) {
    const st = St.st;
    const body = el('div');

    // イベント
    if (rep.event && rep.event.id !== 'none') {
      const ico = rep.event.kind === 'good' ? '🎉' : rep.event.kind === 'bad' ? '💦' : '🍃';
      body.appendChild(el('div', {
        class: 'panel', style: 'margin-top:0;background:' +
          (rep.event.kind === 'bad' ? '#FFECE8' : '#EFFBEA'),
      }, [
        el('div', { class: 'panel-title', text: ico + ' きょうの できごと' }),
        el('p', { class: 'hint', style: 'margin:0;font-size:13px;color:#4A3A2C', text: rep.event.text }),
      ]));
    }

    // しゅうにゅう
    const incKeys = D.RES_ORDER.filter((k) => rep.income[k] > 0);
    const incBox = el('div', { class: 'cost-row' });
    if (!incKeys.length) incBox.appendChild(el('span', { class: 'cost' }, 'なし'));
    incKeys.forEach((k) => {
      incBox.appendChild(el('span', { class: 'cost' }, D.RES[k].ico + ' +' + rep.income[k]));
    });
    body.appendChild(el('div', { class: 'panel', style: 'margin-top:8px' }, [
      el('div', { class: 'panel-title', text: '📥 きょうの しゅうかく' }), incBox,
      el('p', {
        class: 'hint', style: 'margin-bottom:0',
        text: 'ごきげん度 ' + rep.kigenBefore + ' → ' + st.kigen +
          '（せいさん ×' + U.round(St.prodMultiplier(), 2) + '）',
      }),
    ]));

    // ライバルの うごき
    if (rep.aiMoves.length || rep.pendingAttack) {
      const ul = el('ul', { class: 'log-list' });
      rep.aiMoves.forEach((m) => {
        const f = D.FACTIONS[m.fac];
        let txt = '';
        if (m.kind === 'capture') txt = f.name + 'が「' + St.tileById(m.tile).name + '」を せいあつ';
        else if (m.kind === 'fail') txt = f.name + 'が「' + St.tileById(m.tile).name + '」を ねらったが しっぱい';
        else txt = f.name + 'が「' + St.tileById(m.tile).name + '」の まもりを かためた';
        ul.appendChild(el('li', { class: m.kind === 'capture' ? 'bad' : '' }, [
          el('span', { class: 'log-day', text: '●' }), el('span', { class: 'log-txt', text: txt }),
        ]));
      });
      if (rep.pendingAttack) {
        const f = D.FACTIONS[rep.pendingAttack.fac];
        ul.appendChild(el('li', { class: 'bad' }, [
          el('span', { class: 'log-day', text: '⚔' }),
          el('span', {
            class: 'log-txt',
            text: f.name + 'が「' + St.tileById(rep.pendingAttack.tile).name + '」に せめこんできた！',
          }),
        ]));
      }
      body.appendChild(el('div', { class: 'panel', style: 'margin-bottom:0' }, [
        el('div', { class: 'panel-title', text: '🗺 ライバルの うごき' }), ul,
      ]));
    }

    UI.modal({
      title: 'DAY ' + rep.day + ' の けっか',
      body,
      buttons: [{
        label: rep.pendingAttack ? 'むかえうつ！' : 'つぎへ',
        cls: rep.pendingAttack ? 'btn-danger' : 'btn-primary',
      }],
      onClose: done,
    });
  }

  /* =========================================================
     しょきか
     ========================================================= */
  function init() {
    $('#btn-nextday').addEventListener('click', nextDay);
    UI.register('park', { render });
    if (GP.parkscene) GP.parkscene.init();
  }

  GP.park = { init, render, nextDay, showDayReport, openPlot, openBuild };
})(window.GP);
