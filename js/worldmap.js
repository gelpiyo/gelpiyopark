/* =========================================================
   worldmap.js — なわばりマップ（ヘックス）／ しんぐん・こうしょう
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

  const CW = 640, CH = 620, HEX = 66, OX = 320, OY = 306;
  let selected = null;
  let ctx = null;
  let pulse = 0;
  let rafId = 0;

  /* =========================================================
     えがく
     ========================================================= */
  function render() {
    drawMap();
    renderShares();
    renderDetail();
    renderFactions();
    if (!rafId) loop();
  }

  function loop() {
    const step = () => {
      pulse += 0.045;
      drawMap();
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function drawMap() {
    const canvas = $('#map-canvas');
    if (!canvas || canvas.offsetParent === null) return;
    ctx = U.fitCanvas(canvas, CW, CH);
    const st = St.st;
    ctx.clearRect(0, 0, CW, CH);

    const atk = new Set(St.attackableIds());

    D.TILES.forEach((t) => {
      const s = st.tiles[t.id];
      const f = D.FACTIONS[s.owner];
      const ter = D.TERRAIN[t.ter];
      const p = H.toPixel(t.q, t.r, HEX, OX, OY);

      // かげ
      H.path(ctx, p.x, p.y + 4, HEX - 3);
      ctx.fillStyle = 'rgba(40,60,45,.22)'; ctx.fill();

      // じめん
      H.path(ctx, p.x, p.y, HEX - 3);
      const g = ctx.createLinearGradient(p.x, p.y - HEX, p.x, p.y + HEX);
      g.addColorStop(0, mix(ter.fill, f.color, s.owner === 'none' ? 0.06 : 0.30));
      g.addColorStop(1, mix(shade(ter.fill, -0.14), f.dark, s.owner === 'none' ? 0.06 : 0.34));
      ctx.fillStyle = g; ctx.fill();

      // ふち
      ctx.lineWidth = s.owner === 'none' ? 3 : 5;
      ctx.strokeStyle = s.owner === 'none' ? 'rgba(255,255,255,.55)' : f.color;
      ctx.stroke();

      // せめられる ところ を てんめつ
      if (atk.has(t.id)) {
        ctx.save();
        ctx.globalAlpha = 0.28 + Math.sin(pulse) * 0.2;
        H.path(ctx, p.x, p.y, HEX - 7);
        ctx.lineWidth = 4; ctx.strokeStyle = '#FFD166'; ctx.stroke();
        ctx.restore();
      }
      // せんたく中
      if (selected === t.id) {
        H.path(ctx, p.x, p.y, HEX - 1);
        ctx.lineWidth = 4; ctx.strokeStyle = '#FF9F43'; ctx.stroke();
      }

      // ちけい アイコン
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.font = '30px system-ui, "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ter.ico, p.x, p.y - 20);
      ctx.restore();

      // ぴよ（もちぬし）
      if (s.owner !== 'none') {
        GP.piyo.paint(ctx, p.x, p.y + 4, 44, Object.assign(
          {}, GP.piyo.factionLooks(s.owner, 'rush', s.owner === 'player' ? 'happy' : 'angry')));
      }

      // なまえ
      ctx.save();
      ctx.font = '900 12px "Hiragino Maru Gothic ProN","Yu Gothic UI",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = t.name.length > 8 ? t.name.slice(0, 7) + '…' : t.name;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,30,25,.72)';
      ctx.strokeText(label, p.x, p.y + 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, p.x, p.y + 34);

      // まもり（盾は 絵文字を つかわず えがく）
      const dv = St.tileDefense(t.id);
      drawShield(ctx, p.x - 12, p.y + 49);
      ctx.font = '900 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,30,25,.72)';
      ctx.strokeText(String(dv), p.x - 3, p.y + 50);
      ctx.fillStyle = '#FFE9B0';
      ctx.fillText(String(dv), p.x - 3, p.y + 50);
      ctx.restore();
    });
  }

  /** ちいさな 盾アイコン */
  function drawShield(ctx, x, y) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y - 6); ctx.lineTo(x + 7, y - 6);
    ctx.lineTo(x + 7, y + 1); ctx.quadraticCurveTo(x + 7, y + 5, x + 3.5, y + 6.5);
    ctx.quadraticCurveTo(x, y + 5, x, y + 1);
    ctx.closePath();
    ctx.fillStyle = '#FFE9B0'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,30,25,.72)'; ctx.stroke();
    ctx.fillStyle = '#FFE9B0'; ctx.fill();
    ctx.restore();
  }

  function renderShares() {
    const sh = St.shares();
    const box = $('#map-shares');
    box.innerHTML = '';
    const total = D.TILES.length;
    ['player', 'crow', 'cat', 'red', 'none'].forEach((k) => {
      if (!sh[k]) return;
      const f = D.FACTIONS[k];
      const seg = el('div', {
        class: 'share-seg',
        style: `width:${(sh[k] / total) * 100}%;background:${f.color}`,
      }, sh[k] >= 2 ? f.short : '');
      box.appendChild(seg);
    });
  }

  function renderFactions() {
    const st = St.st;
    const box = $('#faction-list');
    box.innerHTML = '';
    D.RIVALS.forEach((id) => {
      const f = D.FACTIONS[id];
      const fs = st.factions[id];
      const row = el('div', { class: 'fac' }, [
        el('span', { class: 'fac-dot', style: 'background:' + f.color }),
        el('span', { class: 'fac-name', text: f.name }),
        el('span', { class: 'fac-bar' }, [
          el('span', { class: 'fac-fill', style: `width:${fs.fav}%;background:${f.color}` }),
        ]),
        el('span', { class: 'fac-val' }, [
          fs.pact > 0 ? el('span', { class: 'fac-pact', text: '約束' + fs.pact + '日' })
                      : document.createTextNode(fs.fav + '/100'),
        ]),
      ]);
      row.addEventListener('click', () => openDiplomacy(id));
      box.appendChild(row);
    });
    box.appendChild(el('p', { class: 'hint', style: 'margin-bottom:0', text: 'タップで こうしょう（おやつ外交）ができます。' }));
  }

  /* =========================================================
     区画 しょうさい
     ========================================================= */
  function renderDetail() {
    const st = St.st;
    const empty = $('#tile-empty');
    const box = $('#tile-detail');
    if (!selected) { empty.hidden = false; box.hidden = true; return; }
    empty.hidden = true; box.hidden = false;
    box.innerHTML = '';

    const t = St.tileById(selected);
    const s = st.tiles[selected];
    const f = D.FACTIONS[s.owner];
    const ter = D.TERRAIN[t.ter];

    box.appendChild(el('h3', {}, [
      document.createTextNode(t.name),
      el('span', { class: 'owner-chip', style: 'background:' + f.color, text: f.name }),
    ]));
    box.appendChild(el('p', { class: 'hint', style: 'margin-top:4px', text: ter.ico + ' ' + ter.name + '：' + ter.note }));

    const stats = el('div', { class: 'tile-stats' });
    stats.appendChild(el('span', { class: 'tstat', html: 'まもり <b>' + St.tileDefense(selected) + '</b>' }));
    stats.appendChild(el('span', { class: 'tstat', html: '1日の さんしゅつ <b>' + UI.yieldText(ter.yield) + '</b>' }));
    if (s.owner === 'player') stats.appendChild(el('span', { class: 'tstat', html: 'しはい <b>' + s.days + '日</b>' }));
    box.appendChild(stats);

    const btns = el('div', { class: 'tile-buttons' });
    const attackable = St.attackableIds().indexOf(selected) >= 0;

    if (s.owner === 'player') {
      const cost = { danbo: 14 + s.def * 4 };
      btns.appendChild(el('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        disabled: !St.canPay(cost) ? true : null,
        onclick: () => fortify(selected, cost),
      }, `まもりを かためる（📦${cost.danbo}）`));
    } else if (attackable) {
      const pact = s.owner !== 'none' && st.factions[s.owner] && st.factions[s.owner].pact > 0;
      btns.appendChild(el('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        disabled: st.genki <= 0 || pact ? true : null,
        onclick: () => confirmAttack(selected),
      }, st.genki <= 0 ? 'げんきが たりない' : pact ? 'お約束中は せめられない' : `せめこむ（⚡1）`));
      if (s.owner !== 'none') {
        btns.appendChild(el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => openDiplomacy(s.owner),
        }, 'こうしょう する'));
      }
    } else {
      btns.appendChild(el('p', { class: 'hint', style: 'margin:0', text: 'じぶんの なわばりの となりの 区画だけ せめこめます。' }));
    }
    box.appendChild(btns);
  }

  function fortify(id, cost) {
    const st = St.st;
    if (!St.pay(cost)) return;
    st.tiles[id].def = Math.min(14, st.tiles[id].def + 2);
    St.log(St.tileById(id).name + 'の まもりを かためた。', 'good');
    UI.toast('まもりが あがった！', 'good');
    St.persist(); render(); UI.refreshHud();
  }

  /* =========================================================
     しんぐん（こうげき）
     ========================================================= */
  function confirmAttack(id) {
    const st = St.st;
    const t = St.tileById(id);
    const s = st.tiles[id];
    const f = D.FACTIONS[s.owner];
    const team = St.teamUnits();
    if (!team.length) { UI.toast('へんせいに なかまが いないよ！', 'bad'); return; }

    const power = St.enemyPower(id);
    const mine = St.teamPower();
    const est = mine / (mine + power * 26);
    const level = est > 0.72 ? { t: 'かんたん そう', c: '#57C785' }
      : est > 0.5 ? { t: 'いい しょうぶ', c: '#F2B134' }
      : est > 0.32 ? { t: 'ちょっと つらい', c: '#F0844A' }
      : { t: 'かなり きびしい…', c: '#E4614F' };

    const body = el('div');
    body.appendChild(el('p', { class: 'hint', text: `${f.name}の「${t.name}」に せめこみます。` }));
    body.appendChild(UI.kv('あいての まもり', String(St.tileDefense(id))));
    body.appendChild(UI.kv('こちらの せんとうりょく', String(mine)));
    body.appendChild(UI.kv('よそう', `<span style="color:${level.c}">${level.t}</span>`));
    body.appendChild(UI.kv('さくせん', (D.TACTICS.find((x) => x.id === st.tactic) || D.TACTICS[0]).name));
    body.appendChild(UI.kv('ごきげん ほせい', '×' + U.round(0.72 + st.kigen / 200, 2)));

    const cheer = s.owner !== 'none' && st.factions[s.owner] && st.factions[s.owner].cheer > 0;
    const roster = el('div', { class: 'team-slots', style: 'margin-top:10px' });
    team.forEach((u) => {
      const ss = St.unitStats(u);
      const slot = el('div', { class: 'slot' });
      slot.appendChild(UI.piyoEl(u, 'angry'));
      slot.appendChild(el('span', { class: 'slot-info' }, [
        el('span', { class: 'slot-name', text: St.unitName(u) }),
        el('span', { class: 'slot-meta', text: `Lv${u.lv}　❤${ss.hp} ⚔${ss.atk}` }),
      ]));
      roster.appendChild(slot);
    });
    body.appendChild(roster);
    if (cheer) body.appendChild(el('p', { class: 'hint', text: '🎉 おうえんの ゲルぴよが かけつけて くれます！' }));

    UI.modal({
      title: '⚔ せめこむ？',
      body,
      buttons: [
        { label: 'やめる', cls: 'btn-ghost' },
        { label: 'いくぞー！', cls: 'btn-danger', onClick: () => { setTimeout(() => doAttack(id), 160); } },
      ],
    });
  }

  async function doAttack(id) {
    const st = St.st;
    if (st.genki <= 0) { UI.toast('げんきが たりない…', 'bad'); return; }
    st.genki -= 1;
    st.stats.battles += 1;
    const t = St.tileById(id);
    const s = st.tiles[id];
    const fac = s.owner;
    const cheerOn = fac !== 'none' && st.factions[fac] && st.factions[fac].cheer > 0;
    if (cheerOn) st.factions[fac].cheer -= 1;

    UI.refreshHud();

    const sim = await GP.battle.run({
      terrain: t.ter,
      playerUnits: St.teamUnits(),
      enemyFac: fac,
      enemyPower: St.enemyPower(id),
      tactic: st.tactic,
      kigen: st.kigen,
      seed: (st.seed + st.day * 131 + id.charCodeAt(2) * 7 + st.stats.battles * 17) >>> 0,
      defense: false,
      cheer: cheerOn,
      pName: 'ぴよ団',
      eName: D.FACTIONS[fac].name,
    });

    if (sim.winner === 'p') {
      s.owner = 'player'; s.days = 0;
      s.def = Math.max(2, Math.round(t.def * 0.7));
      st.stats.wins += 1; st.stats.captured += 1;
      St.log(`「${t.name}」を てにいれた！`, 'good');
      if (fac !== 'none') st.factions[fac].fav = U.clamp(st.factions[fac].fav - 12, 0, 100);
      // となりの ライバルが けいかいを つよめる
      const alerted = St.alertNeighbors(id);
      if (alerted.length) {
        St.log(alerted.join('と') + 'が けいかいして まもりを かためた。', 'bad');
      }
      giveRewards(sim, t, true);
    } else {
      st.kigenMod -= 8;
      St.log(`「${t.name}」の せめこみに しっぱい…`, 'bad');
      giveRewards(sim, t, false);
    }
    st.kigen = U.clamp(Math.round(St.kigenTarget() + st.kigenMod), 0, 100);
    St.persist();
    UI.refreshHud();
    render();
  }

  /* =========================================================
     ぼうえい（ライバルの しゅうげき）
     ========================================================= */
  async function defendBattle(pa) {
    const st = St.st;
    const t = St.tileById(pa.tile);
    const s = st.tiles[pa.tile];
    const f = D.FACTIONS[pa.fac];
    st.stats.battles += 1;

    const taunt = (f.taunt && f.taunt.length) ? U.rnd.pick(f.taunt) : '';
    if (taunt) UI.toast(f.name + '「' + taunt + '」', 'bad');

    const team = St.teamUnits();
    if (!team.length) {
      // だれも いない → じどう はいぼく
      s.owner = pa.fac; s.days = 0;
      st.stats.lost += 1;
      St.log(`だれも いなくて「${t.name}」を とられた…`, 'bad');
      St.persist(); UI.refreshHud(); UI.rerender();
      return;
    }

    const sim = await GP.battle.run({
      terrain: t.ter,
      playerUnits: team,
      enemyFac: pa.fac,
      enemyPower: St.enemyPower(pa.tile) * 0.92,
      tactic: st.tactic,
      kigen: st.kigen,
      seed: (st.seed + st.day * 977 + st.stats.battles * 31) >>> 0,
      defense: true,
      defBonus: St.tileDefense(pa.tile),
      pName: 'ぴよ団（ぼうえい）',
      eName: f.name,
    });

    if (sim.winner === 'p') {
      st.stats.wins += 1;
      st.kigenMod += 6;
      st.factions[pa.fac].fav = U.clamp(st.factions[pa.fac].fav - 6, 0, 100);
      St.log(`「${t.name}」を まもりきった！`, 'good');
      giveRewards(sim, t, true, true);
    } else {
      s.owner = pa.fac; s.days = 0;
      s.def = Math.max(2, Math.round(t.def * 0.8));
      st.stats.lost += 1;
      st.kigenMod -= 12;
      St.log(`「${t.name}」を ${f.name}に とられた…`, 'bad');
      giveRewards(sim, t, false, true);
    }
    st.kigen = U.clamp(Math.round(St.kigenTarget() + st.kigenMod), 0, 100);
    St.persist();
    UI.refreshHud();
    UI.rerender();
    if (st.tiles && St.shares().player === 0) { st.ended = 'lose'; GP.main.showEnding(); }
  }

  /* =========================================================
     ごほうび
     ========================================================= */
  function giveRewards(sim, tile, win, isDefense) {
    const st = St.st;
    const ter = D.TERRAIN[tile.ter];
    const gained = {};
    const rng = U.rnd;

    if (win) {
      Object.keys(ter.yield).forEach((k) => { gained[k] = Math.round(ter.yield[k] * 3.4); });
      gained.danbo = (gained.danbo || 0) + 8;
      gained.kakera = 2 + (isDefense ? 1 : 1);
      if (rng.chance(0.3)) gained.menko = 2;
    } else {
      gained.kakera = 1;
    }
    St.gain(gained);

    // けいけんち
    const xp = win ? D.RULES.xpPerWin : Math.round(D.RULES.xpPerWin * 0.35);
    const grew = [];
    sim.survivors.forEach((uid) => {
      const u = St.unitById(uid);
      if (!u) return;
      u.wins += win ? 1 : 0;
      const evs = St.giveXp(u, xp);
      if (evs.length) grew.push({ u, evs });
    });
    sim.downed.forEach((uid) => {
      const u = St.unitById(uid);
      if (!u) return;
      const evs = St.giveXp(u, Math.round(xp * 0.4));
      if (evs.length) grew.push({ u, evs });
    });

    // そうび ドロップ
    let drop = null;
    if (win && rng.chance(0.42)) {
      const pool = D.EQUIPS.filter((e) => e.id !== 'crown' || rng.chance(0.25));
      drop = rng.pick(pool);
      St.addEquip(drop.id, 1);
    }

    showResult(sim, gained, xp, drop, grew, win);
  }

  function showResult(sim, gained, xp, drop, grew, win) {
    const body = el('div');
    body.appendChild(el('h4', {
      style: 'text-align:center;font-size:20px;margin-bottom:8px;color:' + (win ? '#3D9E6A' : '#C05340'),
      text: win ? 'しょうり！ 🎉' : 'ざんねん…',
    }));

    const row = el('div', { class: 'cost-row' });
    D.RES_ORDER.concat(['kakera']).forEach((k) => {
      if (!gained[k]) return;
      row.appendChild(el('span', { class: 'cost' }, D.RES[k].ico + ' +' + gained[k]));
    });
    if (row.children.length) {
      body.appendChild(el('h3', { class: 'panel-title', text: 'てにいれた もの' }));
      body.appendChild(row);
    }
    body.appendChild(el('p', { class: 'hint', text: `せんとうに でた なかまに けいけんち +${xp}` }));

    if (drop) {
      body.appendChild(el('div', { class: 'panel', style: 'background:#FFF3D0' }, [
        el('div', { class: 'panel-title', text: '🎁 そうびを ひろった！' }),
        el('p', { class: 'hint', style: 'margin:0;color:#4A3A2C;font-size:13px', text: drop.ico + ' ' + drop.name }),
      ]));
    }

    if (grew.length) {
      const ul = el('ul', { class: 'log-list' });
      grew.forEach((g) => {
        const evo = g.evs.filter((e) => e.type === 'evo');
        const lv = g.evs.filter((e) => e.type === 'lv').pop();
        let txt = St.unitName(g.u) + ' が Lv' + (lv ? lv.lv : g.u.lv) + ' に！';
        if (evo.length) txt += ' ' + evo[evo.length - 1].evo.msg;
        ul.appendChild(el('li', { class: 'good' }, [
          el('span', { class: 'log-day', text: '↑' }), el('span', { class: 'log-txt', text: txt }),
        ]));
      });
      body.appendChild(el('h3', { class: 'panel-title', style: 'margin-top:10px', text: '🌱 せいちょう' }));
      body.appendChild(ul);
    }

    UI.modal({
      title: 'バトル けっか', body,
      buttons: [{ label: 'もどる', cls: win ? 'btn-accent' : 'btn-primary' }],
      onClose: () => { UI.rerender(); },
    });
  }

  /* =========================================================
     こうしょう（おやつ がいこう）
     ========================================================= */
  function openDiplomacy(facId) {
    const st = St.st;
    const f = D.FACTIONS[facId];
    const fs = st.factions[facId];
    if (!fs) return;

    const body = el('div');
    const head = el('div', { class: 'detail-piyo' });
    head.innerHTML = GP.piyo.svg(GP.piyo.factionLooks(facId, 'boss',
      fs.fav >= 60 ? 'happy' : fs.fav >= 35 ? 'normal' : 'angry'));
    head.firstElementChild.setAttribute('style', 'width:80px;flex:0 0 auto');
    head.appendChild(el('div', { class: 'detail-meta' }, [
      el('h4', { text: f.name }),
      el('p', { class: 'hint', style: 'margin:2px 0 0', text: 'なかよし度 ' + fs.fav + ' / 100' }),
      el('div', { class: 'xpbar' }, [el('div', { style: `width:${fs.fav}%;background:${f.color}` })]),
      fs.pact > 0 ? el('p', { class: 'hint', style: 'margin:4px 0 0;color:#3D9E6A', text: `お約束 のこり ${fs.pact}日（おたがい せめない）` }) : null,
    ]));
    body.appendChild(head);

    // おくりもの
    body.appendChild(el('h3', { class: 'panel-title', text: '🎁 おくりものを する' }));
    const gifts = el('div', { class: 'build-list' });
    D.GIFTS.forEach((g) => {
      const ok = St.canPay(g.cost);
      gifts.appendChild(el('button', {
        class: 'build-item', type: 'button', disabled: ok ? null : true,
        onclick: () => {
          if (!St.pay(g.cost)) return;
          const up = g.up + Math.round(U.rnd() * 4) - 2;
          fs.fav = U.clamp(fs.fav + up, 0, 100);
          St.log(f.name + 'に ' + g.name + 'を おくった（なかよし +' + up + '）', 'good');
          UI.toast('なかよし度 +' + up, 'good');
          St.persist(); UI.closeModal(); openDiplomacy(facId); render(); UI.refreshHud();
        },
      }, [
        el('span', { class: 'build-ico', text: g.ico }),
        el('span', { class: 'build-info' }, [
          el('h4', { text: g.name }),
          el('p', { text: 'なかよし度 およそ +' + g.up }),
          el('span', { class: 'build-cost', html: UI.costText(g.cost) }),
        ]),
      ]));
    });
    body.appendChild(gifts);

    // おねがい
    body.appendChild(el('h3', { class: 'panel-title', style: 'margin-top:12px', text: '🤝 おねがいごと' }));
    const acts = el('div', { class: 'build-list' });

    acts.appendChild(actBtn({
      ico: '🤙', name: 'お約束（平和条約）',
      desc: D.DIPLO.pactDays + '日 おたがい せめこまない',
      need: D.DIPLO.pactNeed, fav: fs.fav,
      onDo: () => {
        fs.pact = D.DIPLO.pactDays;
        fs.fav = U.clamp(fs.fav - 8, 0, 100);
        St.log(f.name + 'と お約束を むすんだ！', 'good');
        UI.toast('お約束 せいりつ！', 'good');
      },
    }));
    acts.appendChild(actBtn({
      ico: '📣', name: 'おうえんを たのむ',
      desc: 'つぎの この あいてとの バトルに なかまが 1ぴき くわわる',
      need: D.DIPLO.cheerNeed, fav: fs.fav,
      onDo: () => {
        fs.cheer = (fs.cheer || 0) + 1;
        fs.fav = U.clamp(fs.fav - 14, 0, 100);
        St.log(f.name + 'が おうえんに きて くれることに なった！', 'good');
        UI.toast('おうえん ゲット！', 'good');
      },
    }));
    acts.appendChild(actBtn({
      ico: '🏳', name: '区画を ゆずって もらう',
      desc: 'いちばん まもりの よわい 区画を ゆずって もらう',
      need: D.DIPLO.cedeNeed, fav: fs.fav,
      onDo: () => {
        const mine = Object.keys(st.tiles).filter((id) => st.tiles[id].owner === facId);
        if (!mine.length) { UI.toast('ゆずれる 区画が ないみたい…', 'bad'); return; }
        mine.sort((a, b) => St.tileDefense(a) - St.tileDefense(b));
        const id = mine[0];
        st.tiles[id].owner = 'player';
        st.tiles[id].days = 0;
        fs.fav = D.DIPLO.cedeReset;
        st.stats.captured += 1;
        St.log(f.name + 'が「' + St.tileById(id).name + '」を ゆずって くれた！', 'good');
        UI.toast('区画を ゆずって もらった！', 'good');
      },
    }));
    body.appendChild(acts);

    function actBtn(cfg) {
      const ok = cfg.fav >= cfg.need;
      return el('button', {
        class: 'build-item', type: 'button', disabled: ok ? null : true,
        onclick: () => {
          cfg.onDo();
          St.persist(); UI.closeModal(); render(); UI.refreshHud();
        },
      }, [
        el('span', { class: 'build-ico', text: cfg.ico }),
        el('span', { class: 'build-info' }, [
          el('h4', { text: cfg.name }),
          el('p', { text: cfg.desc }),
          el('span', {
            class: 'build-cost',
            html: ok ? '<span style="color:#3D9E6A">できる！</span>'
                     : `<span class="lack">なかよし度 ${cfg.need} ひつよう</span>`,
          }),
        ]),
      ]);
    }

    UI.modal({ title: 'こうしょう', body });
  }

  /* =========================================================
     しょきか
     ========================================================= */
  function init() {
    const canvas = $('#map-canvas');
    const hit = (e) => {
      e.preventDefault();
      const p = U.canvasPoint(canvas, e.changedTouches ? e.changedTouches[0] : e, CW, CH);
      const ax = H.toAxial(p.x, p.y, HEX, OX, OY);
      const t = D.TILES.find((x) => x.q === ax.q && x.r === ax.r);
      if (!t) { selected = null; } else { selected = selected === t.id ? null : t.id; }
      renderDetail(); drawMap();
    };
    canvas.addEventListener('click', hit);
    UI.register('map', { render });
  }

  /* ---------- いろの ヘルパー ---------- */
  function toRgb(c) {
    const s = c.replace('#', '');
    const n = parseInt(s.length === 3 ? s.split('').map((x) => x + x).join('') : s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    const A = toRgb(a), B = toRgb(b);
    return `rgb(${Math.round(U.lerp(A[0], B[0], t))},${Math.round(U.lerp(A[1], B[1], t))},${Math.round(U.lerp(A[2], B[2], t))})`;
  }
  function shade(c, amt) {
    const A = toRgb(c);
    return `rgb(${U.clamp(Math.round(A[0] + 255 * amt), 0, 255)},${U.clamp(Math.round(A[1] + 255 * amt), 0, 255)},${U.clamp(Math.round(A[2] + 255 * amt), 0, 255)})`;
  }

  GP.worldmap = { init, render, defendBattle, openDiplomacy, stopLoop };
})(window.GP);
