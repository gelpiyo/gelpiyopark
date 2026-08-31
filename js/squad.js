/* =========================================================
   squad.js — なかま（へんせい / ずかん / いくせい / そうび）
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const UI = GP.ui;
  const { $, el } = U;

  let view = 'team';
  let filter = 'all';

  /* =========================================================
     えがく
     ========================================================= */
  function render() {
    $('#squad-team-view').hidden = view !== 'team';
    $('#squad-all-view').hidden = view !== 'all';
    U.$$('[data-squadtab]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.squadtab === view));
    if (view === 'team') renderTeam(); else renderAll();
  }

  function renderTeam() {
    const st = St.st;
    const cap = St.teamCap();
    $('#team-cap').textContent = cap;

    // 定員オーバーぶんは はずす
    if (st.team.length > cap) st.team.length = cap;

    const box = $('#team-slots');
    box.innerHTML = '';
    for (let i = 0; i < cap; i++) {
      const uid = st.team[i];
      const u = uid ? St.unitById(uid) : null;
      if (!u) {
        box.appendChild(el('button', {
          class: 'slot is-empty', type: 'button', onclick: () => openPicker(i),
        }, '＋ なかまを えらぶ'));
        continue;
      }
      const s = St.unitStats(u);
      const rar = D.RARITY[s.rar];
      const slot = el('button', { class: 'slot', type: 'button', onclick: () => openDetail(u) }, [
        el('span', { class: 'slot-rar', style: 'color:' + rar.color, text: rar.name }),
      ]);
      slot.appendChild(UI.piyoEl(u, 'normal'));
      slot.appendChild(el('span', { class: 'slot-info' }, [
        el('span', { class: 'slot-name', text: St.unitName(u) }),
        el('span', { class: 'slot-meta', html: UI.roleChip(s.role) + `<span>Lv${u.lv}</span>` }),
        el('span', { class: 'slot-meta', text: UI.statLine(s) }),
      ]));
      box.appendChild(slot);
    }

    // さくせん
    const row = $('#tactic-row');
    row.innerHTML = '';
    D.TACTICS.forEach((t) => {
      row.appendChild(el('button', {
        class: 'tac' + (st.tactic === t.id ? ' is-on' : ''), type: 'button',
        onclick: () => { st.tactic = t.id; St.persist(); render(); },
      }, [
        el('span', { class: 'tac-ico', text: t.ico }),
        el('span', { text: t.name }),
      ]));
    });
    const cur = D.TACTICS.find((t) => t.id === st.tactic) || D.TACTICS[0];
    $('#tactic-desc').textContent = cur.desc;
  }

  function renderAll() {
    const st = St.st;

    // なかまの かず / 上限
    const cap = St.rosterCap();
    const full = st.units.length >= cap;
    const rc = $('#roster-count');
    rc.classList.toggle('is-full', full);
    rc.innerHTML = '';
    rc.appendChild(el('span', { html: `なかま <b>${st.units.length}</b> / ${cap} ひき` }));
    rc.appendChild(el('span', { class: 'rc-bar' }, [
      el('span', { class: 'rc-fill', style: `width:${Math.min(100, (st.units.length / cap) * 100)}%` }),
    ]));
    rc.appendChild(el('span', {
      class: 'rc-note',
      text: full ? 'いっぱい！ ぴよハウスで 上限UP' : '',
    }));

    // フィルタ
    const fr = $('#squad-filter');
    fr.innerHTML = '';
    const opts = [{ id: 'all', name: 'ぜんぶ' }]
      .concat(D.ROLE_ORDER.map((r) => ({ id: r, name: D.ROLES[r].name })));
    opts.forEach((o) => {
      fr.appendChild(el('button', {
        class: 'seg' + (filter === o.id ? ' is-on' : ''), type: 'button',
        onclick: () => { filter = o.id; render(); },
      }, o.name));
    });

    const list = $('#piyo-list');
    list.innerHTML = '';
    const units = st.units
      .filter((u) => filter === 'all' || D.SPECIES_BY_ID[u.sp].role === filter)
      .slice()
      .sort((a, b) => St.unitPower(b) - St.unitPower(a));

    if (!units.length) {
      list.appendChild(el('p', { class: 'hint', style: 'grid-column:1/-1', text: 'この やくわりの なかまは まだ いないよ。' }));
      return;
    }
    units.forEach((u) => {
      const s = St.unitStats(u);
      const rar = D.RARITY[s.rar];
      const inTeam = st.team.indexOf(u.uid) >= 0;
      const card = el('button', {
        class: 'pcard' + (inTeam ? ' in-team' : ''), type: 'button',
        onclick: () => openDetail(u),
      }, [
        el('span', { class: 'pcard-rar', style: 'color:' + rar.color, text: rar.name }),
        inTeam ? el('span', { class: 'pcard-team', text: '⚔' }) : null,
      ]);
      card.appendChild(UI.piyoEl(u, 'normal'));
      card.appendChild(el('span', { class: 'pcard-name', text: St.unitName(u) }));
      card.appendChild(el('span', { class: 'pcard-lv', text: `Lv${u.lv}・${D.ROLES[s.role].short}` }));
      list.appendChild(card);
    });
  }

  /* =========================================================
     なかま えらび
     ========================================================= */
  function openPicker(slotIdx) {
    const st = St.st;
    const avail = st.units.filter((u) => st.team.indexOf(u.uid) < 0);
    if (!avail.length) {
      UI.toast('えらべる なかまが いないよ。スカウトしよう！', '');
      return;
    }
    const grid = el('div', { class: 'piyo-list' });
    avail.sort((a, b) => St.unitPower(b) - St.unitPower(a)).forEach((u) => {
      const s = St.unitStats(u);
      const rar = D.RARITY[s.rar];
      const card = el('button', { class: 'pcard', type: 'button', onclick: () => {
        st.team[slotIdx] = u.uid;
        // すきま を つめる
        st.team = st.team.filter(Boolean);
        St.persist(); UI.closeModal(); render(); UI.refreshHud();
        UI.toast(St.unitName(u) + 'を へんせいに いれた！', 'good');
      } }, [el('span', { class: 'pcard-rar', style: 'color:' + rar.color, text: rar.name })]);
      card.appendChild(UI.piyoEl(u, 'normal'));
      card.appendChild(el('span', { class: 'pcard-name', text: St.unitName(u) }));
      card.appendChild(el('span', { class: 'pcard-lv', text: `Lv${u.lv}・${D.ROLES[s.role].short}　⚔${St.unitPower(u)}` }));
      grid.appendChild(card);
    });
    UI.modal({ title: 'なかまを えらぶ', body: grid });
  }

  /* =========================================================
     しょうさい
     ========================================================= */
  function openDetail(u) {
    const st = St.st;
    const build = () => {
      const s = St.unitStats(u);
      const sp = D.SPECIES_BY_ID[u.sp];
      const rar = D.RARITY[s.rar];
      const inTeam = st.team.indexOf(u.uid) >= 0;
      const body = el('div');

      const head = el('div', { class: 'detail-piyo' });
      const v3 = GP.piyo.view3d(GP.piyo.looksOf(u, 'happy'), { size: 104 });
      if (v3) {
        const holder = el('span', { class: 'detail-3d' });
        holder.appendChild(v3);
        holder.appendChild(el('small', { text: 'ドラッグで まわせるよ' }));
        head.appendChild(holder);
      } else {
        head.appendChild(UI.piyoEl(u, 'happy'));
      }
      head.appendChild(el('div', { class: 'detail-meta' }, [
        el('h4', { text: St.unitName(u) }),
        el('div', { html: `<span style="color:${rar.color};font-weight:900">${rar.name}</span>　` + UI.roleChip(s.role) }),
        el('p', { class: 'hint', style: 'margin:4px 0 0', text: sp.flavor }),
      ]));
      body.appendChild(head);

      // レベル / けいけんち
      const need = St.xpNeed(u.lv);
      const pct = u.lv >= D.RULES.lvMax ? 100 : Math.round((u.xp / need) * 100);
      body.appendChild(el('div', { class: 'kv' }, [
        el('span', { text: 'レベル' }),
        el('b', { text: 'Lv' + u.lv + (u.lv >= D.RULES.lvMax ? '（さいだい）' : ` （${u.xp}/${need}）`) }),
      ]));
      const bar = el('div', { class: 'xpbar' });
      bar.appendChild(el('div', { style: 'width:' + pct + '%' }));
      body.appendChild(bar);

      // ステータス
      const g = el('div', { class: 'stat-grid' });
      [['たいりょく', s.hp], ['こうげき', s.atk], ['ぼうぎょ', s.def],
       ['しゃてい', s.rng], ['うごき', s.mov], ['すばやさ', s.spd]]
        .forEach(([k, v]) => {
          g.appendChild(el('div', { class: 'stat' }, [el('span', { text: k }), el('b', { text: String(v) })]));
        });
      body.appendChild(g);
      body.appendChild(el('p', { class: 'hint', style: 'margin-top:0', text: D.ROLES[s.role].desc }));

      // そうび
      body.appendChild(el('h3', { class: 'panel-title', text: 'そうび' }));
      const eq = el('div', { class: 'equip-row' });
      const owned = D.EQUIPS.filter((e) => (st.equips[e.id] || 0) > 0);
      if (!owned.length) {
        eq.appendChild(el('p', { class: 'hint', style: 'margin:0', text: 'そうびは バトルの ごほうびで てにはいるよ。' }));
      }
      owned.forEach((e) => {
        const on = u.equip === e.id;
        const free = St.equipFree(e.id);
        const mods = Object.keys(e.mod || {}).map((k) => {
          const lbl = { hp: '体', atk: '攻', def: '守', mov: '動', spd: '速', rng: '射' }[k] || k;
          return lbl + (e.mod[k] > 0 ? '+' : '') + e.mod[k];
        }).join(' ');
        eq.appendChild(el('button', {
          class: 'equip-chip' + (on ? ' is-on' : ''), type: 'button',
          disabled: !on && free <= 0 ? true : null,
          onclick: () => {
            if (!St.setEquip(u, e.id)) { UI.toast('あきが ないよ', 'bad'); return; }
            St.persist(); UI.closeModal(); openDetail(u); render();
          },
        }, [
          el('span', { text: e.ico + ' ' + e.name + (free > 1 || (!on && free > 0) ? ` ×${free}` : '') }),
          el('small', { text: mods + (e.note ? '／' + e.note : '') }),
        ]));
      });
      body.appendChild(eq);

      // いくせい
      body.appendChild(el('h3', { class: 'panel-title', style: 'margin-top:12px', text: 'いくせい' }));
      const T = D.RULES.train;
      body.appendChild(el('p', {
        class: 'hint', style: 'margin-top:0',
        text: `もちもの 🧩${st.res.kakera}　🍪${Math.floor(st.res.snack)}　／　かけら${T.kakera}こ＋おやつ${T.snack}こ で けいけんち +${T.xp}`,
      }));
      const trainRow = el('div', { class: 'equip-row' });
      [1, 5, 20].forEach((n) => {
        const need = { kakera: n * T.kakera, snack: n * T.snack };
        trainRow.appendChild(el('button', {
          class: 'equip-chip', type: 'button',
          disabled: !St.canPay(need) || u.lv >= D.RULES.lvMax ? true : null,
          onclick: () => train(u, n),
        }, [
          el('span', { text: `🧩${need.kakera} ＋ 🍪${need.snack}` }),
          el('small', { text: `けいけんち +${n * T.xp}` }),
        ]));
      });
      body.appendChild(trainRow);

      return { body, inTeam };
    };

    const { body, inTeam } = build();
    UI.modal({
      title: 'ぴよ しょうさい',
      body,
      buttons: [
        {
          label: inTeam ? 'へんせいから はずす' : 'へんせいに いれる',
          cls: inTeam ? 'btn-ghost' : 'btn-primary',
          onClick: () => toggleTeam(u),
        },
        { label: 'にがす', cls: 'btn-ghost', onClick: () => confirmRelease(u) },
      ],
    });
  }

  function toggleTeam(u) {
    const st = St.st;
    const i = st.team.indexOf(u.uid);
    if (i >= 0) {
      st.team.splice(i, 1);
      UI.toast(St.unitName(u) + 'を はずした', '');
    } else {
      if (st.team.length >= St.teamCap()) {
        UI.toast('出撃わくが いっぱい！ ひみつきちを たてると ふえるよ', 'bad');
        return false;
      }
      st.team.push(u.uid);
      UI.toast(St.unitName(u) + 'を へんせいに いれた！', 'good');
    }
    St.persist(); render(); UI.refreshHud();
  }

  function train(u, n) {
    const st = St.st;
    const T = D.RULES.train;
    const need = { kakera: n * T.kakera, snack: n * T.snack };
    if (!St.pay(need)) { UI.toast('かけら か おやつが たりない…', 'bad'); return; }
    const evs = St.giveXp(u, n * T.xp);
    St.persist();
    UI.closeModal();
    reportGrowth(u, evs, () => { openDetail(u); render(); UI.refreshHud(); });
    if (!evs.length) { UI.toast('けいけんち +' + n * T.xp, 'good'); }
  }

  /** レベルアップ / しんか の えんしゅつ */
  function reportGrowth(u, evs, done) {
    if (!evs.length) { if (done) done(); return; }
    const evo = evs.filter((e) => e.type === 'evo');
    const lvs = evs.filter((e) => e.type === 'lv');
    const body = el('div', { style: 'text-align:center' });
    const art = UI.piyoEl(u, 'happy', 'width:120px;margin:0 auto 8px');
    art.classList.add('piyo-squish');
    body.appendChild(art);
    body.appendChild(el('h4', { style: 'font-size:17px;margin-bottom:6px', text: St.unitName(u) }));
    if (lvs.length) {
      body.appendChild(el('p', {
        class: 'hint', style: 'font-size:14px;color:#4A3A2C',
        text: `レベルが ${lvs[lvs.length - 1].lv} に あがった！`,
      }));
    }
    evo.forEach((e) => {
      body.appendChild(el('div', {
        class: 'panel',
        style: 'background:' + (e.evo.kind === 'bad' ? '#FFECE8' : e.evo.kind === 'rare' ? '#FFF3D0' : '#EFFBEA'),
      }, [
        el('div', { class: 'panel-title', text: e.evo.kind === 'rare' ? '✨ とくべつな せいちょう！' : '🌱 せいちょう！' }),
        el('p', { class: 'hint', style: 'margin:0;color:#4A3A2C;font-size:13px', text: e.evo.msg }),
      ]));
    });
    UI.modal({ title: 'せいちょう', body, buttons: [{ label: 'やったー！', cls: 'btn-accent' }], onClose: done });
  }

  function confirmRelease(u) {
    const st = St.st;
    if (st.units.length <= 1) { UI.toast('さいごの ひとりは にがせないよ', 'bad'); return false; }
    const back = D.RULES.dupKakera[D.SPECIES_BY_ID[u.sp].rar] * (1 + (u.lv - 1) * 0.2);
    const n = Math.round(back);
    UI.modal({
      title: 'にがす？',
      body: el('div', {}, [
        el('p', { class: 'hint', text: St.unitName(u) + 'を おうちに かえします。なかよしのかけらに なります。' }),
        el('div', { class: 'cost-row' }, [el('span', { class: 'cost' }, '🧩 +' + n)]),
      ]),
      buttons: [
        { label: 'やめる', cls: 'btn-ghost' },
        {
          label: 'にがす', cls: 'btn-danger', onClick: () => {
            st.units = st.units.filter((x) => x.uid !== u.uid);
            st.team = st.team.filter((x) => x !== u.uid);
            st.res.kakera += n;
            St.persist(); render(); UI.refreshHud();
            UI.toast('またね！ 🧩+' + n, '');
          },
        },
      ],
    });
    return false;
  }

  /* =========================================================
     しょきか
     ========================================================= */
  function init() {
    U.$$('[data-squadtab]').forEach((b) => {
      b.addEventListener('click', () => { view = b.dataset.squadtab; render(); });
    });
    UI.register('squad', { render });
  }

  GP.squad = { init, render, openDetail, reportGrowth };
})(window.GP);
