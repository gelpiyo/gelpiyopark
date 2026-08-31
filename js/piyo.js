/* =========================================================
   piyo.js — ゲルぴよ の 見た目（SVG生成 & Canvas描画）
   画像アセットを使わず ベクターで描くので 通信量は ほぼゼロ。
   色相・そうび・ひょうじょう の くみあわせで バリエーションを つくる。
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';

  const hsl = (h, s, l, a) =>
    a === undefined ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${a})`;

  let idSeq = 0;
  const cache = new Map();

  /* SVG の <defs> は id で 参照する（fill="url(#…)"）。
     おなじ 見た目の ぴよを 画面に いくつも 出すとき、キャッシュした 文字列を
     そのまま つかうと id が 重複し、さきに DOM から けされた ほうを
     参照していた 個体の ぬりが きえてしまう（からだだけ 消える）。
     → キャッシュには 目じるし(GID)入りの ひな形を しまい、
       とりだす たびに 世界で ひとつの id に 差しかえる。 */
  const GID = '__GID__';
  const stamp = (tpl) => tpl.split(GID).join('g' + (idSeq++).toString(36));

  /* =========================================================
     ひょうじょう（目・くち）
     ========================================================= */
  function eyes(mood, ink) {
    const L = 36, R = 64, Y = 63;
    if (mood === 'happy') {
      return `<g fill="none" stroke="${ink}" stroke-width="4.6" stroke-linecap="round">
        <path d="M${L - 6} ${Y + 2} q6 -8 12 0"/><path d="M${R - 6} ${Y + 2} q6 -8 12 0"/></g>`;
    }
    if (mood === 'ko') {
      return `<g stroke="${ink}" stroke-width="4" stroke-linecap="round">
        <path d="M${L - 5} ${Y - 5} l10 10 M${L + 5} ${Y - 5} l-10 10"/>
        <path d="M${R - 5} ${Y - 5} l10 10 M${R + 5} ${Y - 5} l-10 10"/></g>`;
    }
    const base =
      `<g>
        <ellipse cx="${L}" cy="${Y}" rx="5.7" ry="6.1" fill="${ink}"/>
        <ellipse cx="${R}" cy="${Y}" rx="5.7" ry="6.1" fill="${ink}"/>
        <circle cx="${L - 1.8}" cy="${Y - 2.2}" r="1.8" fill="#fff" opacity=".92"/>
        <circle cx="${R - 1.8}" cy="${Y - 2.2}" r="1.8" fill="#fff" opacity=".92"/>
      </g>`;
    if (mood === 'angry') {
      return base + `<g stroke="${ink}" stroke-width="3.4" stroke-linecap="round" opacity=".85">
        <path d="M${L - 7} ${Y - 11} l11 4"/><path d="M${R + 7} ${Y - 11} l-11 4"/></g>`;
    }
    if (mood === 'sad') {
      return base + `<g stroke="${ink}" stroke-width="3.2" stroke-linecap="round" opacity=".8">
        <path d="M${L - 7} ${Y - 10} l11 5"/><path d="M${R + 7} ${Y - 10} l-11 5"/></g>
        <path d="M${R + 5} ${Y + 4} q3 7 0 10 q-3 -3 0 -10" fill="#8FD3F4" opacity=".9"/>`;
    }
    return base;
  }

  function beak(kind, mood, gid) {
    if (kind === 'cat') {
      // ネコ：ω くち と ひげ
      return `<g>
        <path d="M41 76 q4.5 5.5 9 0 q4.5 5.5 9 0" fill="none" stroke="#5A4632" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M50 70 l-3.6 3.2 h7.2 z" fill="#E8879A"/>
        <g stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".78">
          <path d="M28 70 l-14 -4 M28 75 l-15 2.5 M72 70 l14 -4 M72 75 l15 2.5"/></g>
      </g>`;
    }
    const dark = kind === 'crow';
    const bot = dark ? '#4A4854' : '#E28E0C';
    const open = mood === 'happy' || mood === 'angry';
    if (open) {
      return `<g>
        <path d="M36 74 q14 -7 28 0 q-14 6 -28 0z" fill="${dark ? '#6C6A78' : '#FFC94D'}"/>
        <path d="M36 74 q14 7 28 0 q-14 10 -28 0z" fill="${bot}"/>
      </g>`;
    }
    return `<g>
      <path d="M35.6 75 q14.4 -9.6 28.8 0 q-14.4 8.4 -28.8 0z" fill="url(#bk${gid})"/>
      <path d="M38 76.6 q12 3.6 24 0" fill="none" stroke="${bot}" stroke-width="1.5" opacity=".5"/>
    </g>`;
  }

  /* =========================================================
     あたま の かざり（とさか / みみ）
     ========================================================= */
  // ゲルぴよ の 目じるし：ほそく カーブした 2本の とさか
  const TUFT_L = 'M41 34 C35.5 25 27.5 12.5 22.8 5.8 C20.7 2.8 25 -0.2 27.4 2.9 C33.4 10.6 42.4 22.6 50.5 31 Z';
  const TUFT_R = 'M51.5 30 C60 21 69.5 8.8 76 2.6 C78.6 0.1 82 3.4 79.6 6.2 C73.4 13.4 64 25.6 60.5 34.5 Z';

  function crest(kind, cLight, cMain) {
    if (kind === 'cat') {
      return `<g fill="${cMain}">
        <path d="M25 36 L20 6 L46 22 z"/><path d="M75 36 L80 6 L54 22 z"/>
      </g><g fill="#F2A6B4" opacity=".85">
        <path d="M28 32 L25 14 L39 23 z"/><path d="M72 32 L75 14 L61 23 z"/>
      </g>`;
    }
    if (kind === 'crow') {
      return `<g fill="${cLight}">
        <path d="M43 26 L23 -2 L34 26 z"/><path d="M49 24 L45 -7 L58 24 z"/><path d="M57 26 L77 0 L67 28 z"/>
      </g>`;
    }
    // ぷにっとした ゲル素材の かんじ：本体より うすい 色 ＋ すこし とうめい
    return `<g fill="${cLight}" opacity=".9">
      <path d="${TUFT_L}"/><path d="${TUFT_R}"/>
    </g>`;
  }

  /* =========================================================
     そうび（前面 / 背面）
     ========================================================= */
  const ACC_BACK = {
    randsel: () => `<g>
      <rect x="12" y="74" width="76" height="40" rx="13" fill="#B03F50"/>
      <rect x="12" y="74" width="76" height="11" rx="5.5" fill="#8E2E3E"/>
    </g>`,
    net: () => `<g>
      <rect x="82" y="34" width="4.5" height="62" rx="2.2" fill="#B98A50"
            transform="rotate(10 84 65)"/>
      <circle cx="87" cy="32" r="14" fill="none" stroke="#B98A50" stroke-width="4"/>
      <circle cx="87" cy="32" r="12" fill="#EAF6E2" opacity=".6"/>
    </g>`,
  };

  const ACC_FRONT = {
    straw: () => `<g>
      <ellipse cx="50" cy="40" rx="47" ry="13" fill="#E3C48C"/>
      <ellipse cx="50" cy="38.5" rx="47" ry="12" fill="#F5DFAE"/>
      <path d="M24 39 q26 -34 52 0 z" fill="#EBD09B"/>
      <path d="M25.5 38.5 q24.5 -31 49 0" fill="#F7E7C2"/>
      <path d="M25 35 q25 7 50 0" fill="none" stroke="#D9553F" stroke-width="5"/>
    </g>`,
    goggle: () => `<g>
      <path d="M14 61 q36 -10 72 0" fill="none" stroke="#3E4C59" stroke-width="4.5"/>
      <rect x="21" y="52" width="26" height="22" rx="10" fill="#BEEAF7" stroke="#3E4C59" stroke-width="3.4"/>
      <rect x="53" y="52" width="26" height="22" rx="10" fill="#BEEAF7" stroke="#3E4C59" stroke-width="3.4"/>
      <path d="M26 56 l7 0 l-9 9 z" fill="#fff" opacity=".8"/>
      <path d="M58 56 l7 0 l-9 9 z" fill="#fff" opacity=".8"/>
    </g>`,
    gun: () => `<g transform="translate(72 80) rotate(-14)">
      <rect x="0" y="0" width="30" height="11" rx="4" fill="#FF8A3D"/>
      <rect x="26" y="2.5" width="13" height="6" rx="3" fill="#63C6E0"/>
      <rect x="4" y="9" width="9" height="16" rx="4" fill="#F06C1F"/>
      <circle cx="18" cy="-5" r="6" fill="#8FD3F4" opacity=".9"/>
    </g>`,
    shield: () => `<g transform="translate(-6 66) rotate(-9)">
      <rect x="0" y="0" width="31" height="45" rx="7" fill="#D2A468" stroke="#A97B45" stroke-width="3"/>
      <g stroke="#A97B45" stroke-width="2" opacity=".6">
        <path d="M0 12 h31 M0 23 h31 M0 34 h31"/></g>
      <path d="M8 22 l6.5 8 l11 -15" fill="none" stroke="#fff" stroke-width="4"
            stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
    </g>`,
    boots: () => `<g fill="#FFC93C" stroke="#E0A310" stroke-width="2.5">
      <path d="M27 104 h15 v11 q0 6 -8 6 h-9 q-6 0 -6 -5.5 q0 -5.5 8 -6.5 z"/>
      <path d="M58 104 h15 v11.5 q8 1 8 6.5 q0 5.5 -6 5.5 h-9 q-8 0 -8 -6 z"/>
    </g>`,
    crown: () => `<g>
      <path d="M26 34 L32 13 L42 26 L50 7 L58 26 L68 13 L74 34 z" fill="#FFD24A"
            stroke="#E0A310" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="50" cy="12" r="3.6" fill="#EF6B6B"/>
      <circle cx="32" cy="17" r="2.8" fill="#6FD3E8"/>
      <circle cx="68" cy="17" r="2.8" fill="#6FD3E8"/>
    </g>`,
    towel: () => `<g>
      <path d="M13 94 q37 11 74 0 l0 8 q-37 11 -74 0 z" fill="#EF6B6B"/>
      <path d="M13 97.5 q37 11 74 0" fill="none" stroke="#fff" stroke-width="2.6" opacity=".55"/>
    </g>`,
    whistle: () => `<g>
      <path d="M31 52 Q50 100 69 52" fill="none" stroke="#EFE9DC" stroke-width="2.8"/>
      <g transform="translate(39 90)">
        <rect x="0" y="0" width="22" height="12" rx="5.5" fill="#F0A020"/>
        <circle cx="16.5" cy="6" r="3" fill="#fff" opacity=".85"/>
      </g>
    </g>`,
    net: () => '',
    randsel: () => `<g stroke="#8E2E3E" stroke-width="5.5" fill="none" opacity=".92" stroke-linecap="round">
      <path d="M31 78 q6 22 4 34"/><path d="M69 78 q-6 22 -4 34"/></g>`,
  };

  /* =========================================================
     SVG 生成
     ========================================================= */
  function svg(opts) {
    const o = opts || {};
    const hue = o.hue !== undefined ? o.hue : 205;
    const sat = o.sat !== undefined ? o.sat : 76;
    const lit = o.lit !== undefined ? o.lit : 56;
    const kind = o.kind || 'piyo';
    const mood = o.mood || 'normal';
    const accs = (o.acc ? (Array.isArray(o.acc) ? o.acc : [o.acc]) : []).filter(Boolean);
    const key = [hue, sat, lit, kind, mood, accs.join('+'), o.flip ? 1 : 0].join('|');
    if (cache.has(key)) return stamp(cache.get(key));

    const gid = GID;
    const main = hsl(hue, sat, lit);
    const top = hsl(hue, Math.min(sat + 6, 100), Math.min(lit + 13, 92));
    const deep = hsl(hue, sat, Math.max(lit - 17, 8));
    const light = hsl(hue, Math.max(sat - 18, 6), Math.min(lit + 22, 94));
    const ink = kind === 'crow' ? '#0E0C12' : '#17120E';

    const defs =
      `<defs>
        <linearGradient id="bd${gid}" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stop-color="${top}"/>
          <stop offset="0.52" stop-color="${main}"/>
          <stop offset="1" stop-color="${deep}"/>
        </linearGradient>
        <radialGradient id="sh${gid}" cx="0.32" cy="0.26" r="0.46">
          <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
          <stop offset="0.55" stop-color="#fff" stop-opacity=".14"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="bk${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${kind === 'crow' ? '#7A7887' : '#FFD065'}"/>
          <stop offset="1" stop-color="${kind === 'crow' ? '#484652' : '#EE9B12'}"/>
        </linearGradient>
      </defs>`;

    const bodyPath =
      'M50 18 C71 18 87.5 43 89 70 C90.5 98 74.5 118 50 118 C25.5 118 9.5 98 11 70 C12.5 43 29 18 50 18 z';

    const back = accs.map((a) => (ACC_BACK[a] ? ACC_BACK[a]() : '')).join('');
    const front = accs.map((a) => (ACC_FRONT[a] ? ACC_FRONT[a]() : '')).join('');
    const hasBoots = accs.indexOf('boots') >= 0;

    const inner =
      `${defs}
       ${back}
       <!-- とさか / みみ -->
       ${crest(kind, light, main)}
       <!-- あし -->
       ${hasBoots ? '' :
        `<g fill="${light}">
          <ellipse cx="34" cy="120" rx="12" ry="8"/><ellipse cx="66" cy="120" rx="12" ry="8"/>
        </g>`}
       <!-- てばね -->
       <g fill="${light}" opacity=".95">
         <ellipse cx="8" cy="86" rx="9.5" ry="17" transform="rotate(-18 8 86)"/>
         <ellipse cx="92" cy="86" rx="9.5" ry="17" transform="rotate(18 92 86)"/>
       </g>
       <!-- からだ -->
       <path d="${bodyPath}" fill="url(#bd${gid})"/>
       <path d="${bodyPath}" fill="url(#sh${gid})"/>
       <ellipse cx="50" cy="107" rx="31" ry="11" fill="${deep}" opacity=".16"/>
       <!-- かお（目の くぼみ） -->
       <g opacity=".10"><ellipse cx="36" cy="63" rx="9.5" ry="8.5" fill="${deep}"/>
         <ellipse cx="64" cy="63" rx="9.5" ry="8.5" fill="${deep}"/></g>
       ${eyes(mood, ink)}
       ${beak(kind, mood, gid)}
       ${front}`;

    const flip = o.flip ? ' transform="scale(-1,1) translate(-100,0)"' : '';
    const out =
      `<svg class="piyo" viewBox="-5 -8 110 142" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<g${flip}>${inner}</g></svg>`;

    cache.set(key, out);
    return stamp(out);
  }

  /** ぴよ SVG を持つ要素を返す */
  function node(opts, cls) {
    const d = document.createElement('div');
    d.className = 'piyo-wrap ' + (cls || '');
    d.innerHTML = svg(opts);
    return d.firstElementChild;
  }

  /* =========================================================
     個体 → 見た目オプション
     ========================================================= */
  function looksOf(unit, mood) {
    const D = GP.data;
    const sp = D.SPECIES_BY_ID[unit.sp];
    const acc = [];
    if (unit.equip && D.EQUIP_BY_ID[unit.equip]) acc.push(unit.equip);
    else if (sp && sp.acc) acc.push(sp.acc);
    let hue = sp ? sp.hue : 205, sat = sp ? sp.sat : 76, lit = sp ? sp.lit : 56;
    if (unit.evo === 'legend') { sat = Math.min(sat + 14, 100); lit = Math.min(lit + 6, 80); }
    return { hue, sat, lit, kind: (sp && sp.kind) || 'piyo', acc, mood: mood || 'normal' };
  }

  /** 勢力の 兵の 見た目 */
  function factionLooks(facId, roleId, mood) {
    const f = GP.data.FACTIONS[facId] || GP.data.FACTIONS.none;
    const accByRole = { range: 'gun', guard: 'shield', boss: 'crown', trick: 'net', brain: 'goggle', rush: 'boots' };
    return {
      hue: f.hue, sat: f.sat, lit: f.lit, kind: f.kind,
      acc: accByRole[roleId] ? [accByRole[roleId]] : [],
      mood: mood || (facId === 'player' ? 'normal' : 'angry'),
    };
  }

  /* =========================================================
     Canvas 用 かんいばん（バトル / マップ）
     ========================================================= */
  function paint(ctx, x, y, size, o) {
    const hue = o.hue !== undefined ? o.hue : 205;
    const sat = o.sat !== undefined ? o.sat : 76;
    const lit = o.lit !== undefined ? o.lit : 56;
    const kind = o.kind || 'piyo';
    const s = size / 100;
    const main = hsl(hue, sat, lit);
    const top = hsl(hue, sat, Math.min(lit + 13, 92));
    const deep = hsl(hue, sat, Math.max(lit - 17, 8));
    const light = hsl(hue, Math.max(sat - 18, 6), Math.min(lit + 22, 94));
    const sq = o.squash || 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * (o.flip ? -1 : 1), s);
    ctx.scale(1 / sq, sq);
    ctx.translate(-50, -66);

    // かげ
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(50, 120, 28, 7, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    // とさか / みみ
    if (kind === 'cat') {
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(25, 36); ctx.lineTo(20, 6); ctx.lineTo(46, 22); ctx.closePath();
      ctx.moveTo(75, 36); ctx.lineTo(80, 6); ctx.lineTo(54, 22); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(242,166,180,.85)';
      ctx.beginPath(); ctx.moveTo(28, 32); ctx.lineTo(25, 14); ctx.lineTo(39, 23); ctx.closePath();
      ctx.moveTo(72, 32); ctx.lineTo(75, 14); ctx.lineTo(61, 23); ctx.closePath();
      ctx.fill();
    } else if (kind === 'crow') {
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(43, 26); ctx.lineTo(23, -2); ctx.lineTo(34, 26); ctx.closePath();
      ctx.moveTo(49, 24); ctx.lineTo(45, -7); ctx.lineTo(58, 24); ctx.closePath();
      ctx.moveTo(57, 26); ctx.lineTo(77, 0); ctx.lineTo(67, 28); ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(41, 34);
      ctx.bezierCurveTo(35.5, 25, 27.5, 12.5, 22.8, 5.8);
      ctx.bezierCurveTo(20.7, 2.8, 25, -0.2, 27.4, 2.9);
      ctx.bezierCurveTo(33.4, 10.6, 42.4, 22.6, 50.5, 31);
      ctx.closePath();
      ctx.moveTo(51.5, 30);
      ctx.bezierCurveTo(60, 21, 69.5, 8.8, 76, 2.6);
      ctx.bezierCurveTo(78.6, 0.1, 82, 3.4, 79.6, 6.2);
      ctx.bezierCurveTo(73.4, 13.4, 64, 25.6, 60.5, 34.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // てばね・あし
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(8, 86, 9.5, 17, -0.31, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(92, 86, 9.5, 17, 0.31, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(34, 120, 12, 8, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(66, 120, 12, 8, 0, 0, 7); ctx.fill();

    // からだ
    const g = ctx.createLinearGradient(0, 18, 25, 118);
    g.addColorStop(0, top); g.addColorStop(0.52, main); g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(50, 18);
    ctx.bezierCurveTo(71, 18, 87.5, 43, 89, 70);
    ctx.bezierCurveTo(90.5, 98, 74.5, 118, 50, 118);
    ctx.bezierCurveTo(25.5, 118, 9.5, 98, 11, 70);
    ctx.bezierCurveTo(12.5, 43, 29, 18, 50, 18);
    ctx.closePath(); ctx.fill();

    // ツヤ
    const sg = ctx.createRadialGradient(34, 42, 2, 34, 42, 44);
    sg.addColorStop(0, 'rgba(255,255,255,.5)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fill();

    // め
    const ink = kind === 'crow' ? '#0E0C12' : '#17120E';
    ctx.fillStyle = ink;
    if (o.mood === 'ko') {
      ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(31, 58); ctx.lineTo(41, 68); ctx.moveTo(41, 58); ctx.lineTo(31, 68);
      ctx.moveTo(59, 58); ctx.lineTo(69, 68); ctx.moveTo(69, 58); ctx.lineTo(59, 68);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(36, 63, 5.7, 6.1, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(64, 63, 5.7, 6.1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.arc(34.2, 60.8, 1.8, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(62.2, 60.8, 1.8, 0, 7); ctx.fill();
    }

    // くちばし
    if (kind !== 'cat') {
      ctx.fillStyle = kind === 'crow' ? '#5E5C69' : '#F5A81E';
      ctx.beginPath();
      ctx.moveTo(35.6, 75); ctx.quadraticCurveTo(50, 65.4, 64.4, 75);
      ctx.quadraticCurveTo(50, 83.4, 35.6, 75); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = '#5A4632'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(41, 76); ctx.quadraticCurveTo(45.5, 81.5, 50, 76);
      ctx.quadraticCurveTo(54.5, 81.5, 59, 76); ctx.stroke();
    }
    ctx.restore();
  }

  GP.piyo = { svg, node, looksOf, factionLooks, paint, hsl };
})(window.GP);
