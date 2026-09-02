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

  /* @generated-shape-start（tools/outline.mjs が 3Dモデルから 自動生成） */
  const SHAPE = {"body":[[55.5,6],[57.5,6],[61,9.5],[62,11.5],[62.5,16],[60,21.5],[65.5,25],[71,30.5],[77.5,43],[82.5,55.5],[86,62],[86.5,62.5],[92,62.5],[93.5,65],[93,70.5],[91.5,74.5],[90,76],[90.5,83],[91,83.5],[90.5,96],[88.5,102.5],[83,111.5],[78,116.5],[72,120.5],[67.5,125],[65.5,125.5],[65,125],[39.5,125.5],[39,125],[32.5,125],[31.5,124.5],[27.5,120.5],[21.5,116.5],[16.5,111.5],[11.5,103.5],[9.5,98],[8.5,92.5],[8.5,83.5],[9,83],[9.5,76],[7,72],[6,68.5],[6.5,63.5],[8,62.5],[12.5,62.5],[15.5,58.5],[22,43],[28.5,30.5],[34,25],[38,23],[40.5,20.5],[40.5,18.5],[39.5,17.5],[29.5,12],[30,9.5],[31.5,8.5],[35,8.5],[47.5,19],[51,19.5],[54.5,17],[56.5,14.5],[57,11]],"eye":{"dx":11.2,"y":43.6,"rx":2.3,"ry":2},"beak":{"cy":47.1,"w":14.5,"h":5.7},"accent":{"cy":47.1,"w":13.1,"h":1.2},"dome":8.5,"bottom":126.5};
  /* @generated-shape-end */

  /* SHAPE から なめらかな とじた パスを つくる（Catmull-Rom風：中点+2次） */
  let PIYO_D = null;
  function piyoBodyD() {
    if (PIYO_D) return PIYO_D;
    const pts = SHAPE.body, n = pts.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m0 = mid(pts[0], pts[1]);
    let d = `M${m0[0]} ${m0[1]}`;
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n], q2 = pts[(i + 1) % n], m = mid(p, q2);
      d += ` Q${p[0]} ${p[1]} ${m[0]} ${m[1]}`;
    }
    PIYO_D = d + ' Z';
    return PIYO_D;
  }
  function tracePiyoBody(ctx) {
    const pts = SHAPE.body, n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n], q2 = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + q2[0]) / 2, (p[1] + q2[1]) / 2);
    }
    ctx.closePath();
  }
  // かおの きじゅん値（3Dモデルの 実測 ＋ よみやすさの ため すこし 拡大）
  const FACE = {
    exL: 50 - SHAPE.eye.dx, exR: 50 + SHAPE.eye.dx, ey: SHAPE.eye.y,
    erx: SHAPE.eye.rx * 1.3, ery: SHAPE.eye.ry * 1.35,
    by: SHAPE.beak.cy, bw: SHAPE.beak.w * 0.58,
  };

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
  function eyesAt(mood, ink, L, R, Y, rx, ry) {
    const w = rx * 1.05, hh = ry * 1.31;
    if (mood === 'happy') {
      return `<g fill="none" stroke="${ink}" stroke-width="${(rx * 0.81).toFixed(1)}" stroke-linecap="round">
        <path d="M${L - w} ${Y + ry * 0.33} q${w} ${-hh} ${w * 2} 0"/>
        <path d="M${R - w} ${Y + ry * 0.33} q${w} ${-hh} ${w * 2} 0"/></g>`;
    }
    if (mood === 'ko') {
      const a = rx * 0.88;
      return `<g stroke="${ink}" stroke-width="${(rx * 0.7).toFixed(1)}" stroke-linecap="round">
        <path d="M${L - a} ${Y - a} l${a * 2} ${a * 2} M${L + a} ${Y - a} l${-a * 2} ${a * 2}"/>
        <path d="M${R - a} ${Y - a} l${a * 2} ${a * 2} M${R + a} ${Y - a} l${-a * 2} ${a * 2}"/></g>`;
    }
    const base =
      `<g>
        <ellipse cx="${L}" cy="${Y}" rx="${rx}" ry="${ry}" fill="${ink}"/>
        <ellipse cx="${R}" cy="${Y}" rx="${rx}" ry="${ry}" fill="${ink}"/>
        <circle cx="${L - rx * 0.32}" cy="${Y - ry * 0.36}" r="${(rx * 0.32).toFixed(1)}" fill="#fff" opacity=".92"/>
        <circle cx="${R - rx * 0.32}" cy="${Y - ry * 0.36}" r="${(rx * 0.32).toFixed(1)}" fill="#fff" opacity=".92"/>
      </g>`;
    if (mood === 'angry') {
      return base + `<g stroke="${ink}" stroke-width="${(rx * 0.6).toFixed(1)}" stroke-linecap="round" opacity=".85">
        <path d="M${L - rx * 1.23} ${Y - ry * 1.8} l${rx * 1.93} ${ry * 0.66}"/>
        <path d="M${R + rx * 1.23} ${Y - ry * 1.8} l${-rx * 1.93} ${ry * 0.66}"/></g>`;
    }
    if (mood === 'sad') {
      return base + `<g stroke="${ink}" stroke-width="${(rx * 0.56).toFixed(1)}" stroke-linecap="round" opacity=".8">
        <path d="M${L - rx * 1.23} ${Y - ry * 1.64} l${rx * 1.93} ${ry * 0.82}"/>
        <path d="M${R + rx * 1.23} ${Y - ry * 1.64} l${-rx * 1.93} ${ry * 0.82}"/></g>
        <path d="M${R + rx * 0.88} ${Y + ry * 0.66} q${rx * 0.53} ${ry * 1.15} 0 ${ry * 1.64} q${-rx * 0.53} ${-ry * 0.5} 0 ${-ry * 1.64}" fill="#8FD3F4" opacity=".9"/>`;
    }
    return base;
  }
  function eyes(mood, ink) { return eyesAt(mood, ink, 36, 64, 63, 5.7, 6.1); }

  /** 実機モデル 正面の ちいさな くちばし（＋ピンクの くちライン） */
  function beakPiyo(mood, gid) {
    const y = FACE.by, w = FACE.bw;
    const open = mood === 'happy' || mood === 'angry';
    const mouth = `<path d="M${50 - w * 0.72} ${y + 1.4} q${w * 0.72} ${w * 0.36} ${w * 1.44} 0"
      fill="none" stroke="#E8879C" stroke-width="1.5" stroke-linecap="round" opacity=".85"/>`;
    if (open) {
      return `<g>
        <path d="M${50 - w} ${y - 0.6} Q50 ${y - 4} ${50 + w} ${y - 0.6} Q50 ${y + 1.8} ${50 - w} ${y - 0.6}z" fill="#FFC94D"/>
        <path d="M${50 - w * 0.82} ${y + 0.4} Q50 ${y + 5} ${50 + w * 0.82} ${y + 0.4} Q50 ${y + 2} ${50 - w * 0.82} ${y + 0.4}z" fill="#E28E0C"/>
      </g>`;
    }
    return `<g>
      <path d="M${50 - w} ${y} Q50 ${y - 4.4} ${50 + w} ${y} Q50 ${y + 4.4} ${50 - w} ${y}z" fill="url(#bk${gid})"/>
      ${mouth}
    </g>`;
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
  // 実機シルエットは かおが たかめ・ほそめ なので、そうびを あわせて ずらす
  const PIYO_ACC_FIT = {
    straw:  { dy: -17, s: 0.9 },
    goggle: { dy: -4,  s: 0.76 },
    crown:  { dy: -2,  s: 0.82 },
    whistle:{ dy: 4,   s: 0.92 },
    towel:  { dy: -2,  s: 0.96 },
    boots:  { dy: 5,   s: 1 },
    gun:    { dy: 2,   s: 1 },
    shield: { dy: 0,   s: 1 },
    randsel:{ dy: 0,   s: 1 },
    net:    { dy: 0,   s: 1 },
  };
  function fitAcc(kind, a, html) {
    if (!html) return '';
    if (kind !== 'piyo') return html;
    const f = PIYO_ACC_FIT[a];
    if (!f || (f.dy === 0 && f.s === 1)) return html;
    return `<g transform="translate(50 ${f.dy}) scale(${f.s}) translate(-50 0)">${html}</g>`;
  }

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

    const back = accs.map((a) => fitAcc(kind, a, ACC_BACK[a] ? ACC_BACK[a]() : '')).join('');
    const front = accs.map((a) => fitAcc(kind, a, ACC_FRONT[a] ? ACC_FRONT[a]() : '')).join('');
    const hasBoots = accs.indexOf('boots') >= 0;

    let inner;
    if (kind === 'piyo') {
      // ---- 実機3Dモデルの 正面図から おこした かたち ----
      const F = FACE;
      inner =
        `${defs}
         ${back}
         <!-- からだ（とさか・はね・あしを ふくむ 実機シルエット） -->
         <path d="${piyoBodyD()}" fill="url(#bd${gid})"/>
         <path d="${piyoBodyD()}" fill="url(#sh${gid})"/>
         <ellipse cx="50" cy="114" rx="29" ry="9" fill="${deep}" opacity=".14"/>
         <!-- かお -->
         <g opacity=".08">
           <ellipse cx="${F.exL}" cy="${F.ey}" rx="${F.erx + 2.4}" ry="${F.ery + 2.2}" fill="${deep}"/>
           <ellipse cx="${F.exR}" cy="${F.ey}" rx="${F.erx + 2.4}" ry="${F.ery + 2.2}" fill="${deep}"/>
         </g>
         ${eyesAt(mood, ink, F.exL, F.exR, F.ey, F.erx, F.ery)}
         ${beakPiyo(mood, gid)}
         ${front}`;
    } else {
      // ---- カラス / ネコ（したがきの 2Dデザインを いじ） ----
      const bodyPath =
        'M50 18 C71 18 87.5 43 89 70 C90.5 98 74.5 118 50 118 C25.5 118 9.5 98 11 70 C12.5 43 29 18 50 18 z';
      inner =
        `${defs}
         ${back}
         ${crest(kind, light, main)}
         ${hasBoots ? '' :
          `<g fill="${light}">
            <ellipse cx="34" cy="120" rx="12" ry="8"/><ellipse cx="66" cy="120" rx="12" ry="8"/>
          </g>`}
         <g fill="${light}" opacity=".95">
           <ellipse cx="8" cy="86" rx="9.5" ry="17" transform="rotate(-18 8 86)"/>
           <ellipse cx="92" cy="86" rx="9.5" ry="17" transform="rotate(18 92 86)"/>
         </g>
         <path d="${bodyPath}" fill="url(#bd${gid})"/>
         <path d="${bodyPath}" fill="url(#sh${gid})"/>
         <ellipse cx="50" cy="107" rx="31" ry="11" fill="${deep}" opacity=".16"/>
         <g opacity=".10"><ellipse cx="36" cy="63" rx="9.5" ry="8.5" fill="${deep}"/>
           <ellipse cx="64" cy="63" rx="9.5" ry="8.5" fill="${deep}"/></g>
         ${eyes(mood, ink)}
         ${beak(kind, mood, gid)}
         ${front}`;
    }

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
  /** そうびの 部位（おなじ部位は かさねず、そうびを 優先する） */
  const ACC_SLOT = {
    straw: 'head', crown: 'head', goggle: 'face',
    gun: 'handR', shield: 'handL', net: 'back', randsel: 'back',
    boots: 'feet', towel: 'waist', whistle: 'neck',
  };

  function looksOf(unit, mood) {
    const D = GP.data;
    const sp = D.SPECIES_BY_ID[unit.sp];
    const acc = [];
    // 種族固有の もちもの（みずぴよの 水鉄砲 など）は そうびを つけても のこす。
    // ただし おなじ部位（ぼうし×ぼうし 等）は そうび側だけを 見せる。
    const spAcc = sp && sp.acc ? sp.acc : null;
    const eq = unit.equip && D.EQUIP_BY_ID[unit.equip] ? unit.equip : null;
    if (spAcc && (!eq || (spAcc !== eq && ACC_SLOT[spAcc] !== ACC_SLOT[eq]))) acc.push(spAcc);
    if (eq) acc.push(eq);
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

    if (kind === 'piyo') {
      // ---- 実機シルエット（SVGと おなじ SHAPE から えがく） ----
      const g = ctx.createLinearGradient(0, 6, 22, 127);
      g.addColorStop(0, top); g.addColorStop(0.52, main); g.addColorStop(1, deep);
      ctx.fillStyle = g;
      tracePiyoBody(ctx);
      ctx.fill();
      const sg2 = ctx.createRadialGradient(38, 36, 2, 38, 36, 44);
      sg2.addColorStop(0, 'rgba(255,255,255,.5)');
      sg2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg2; ctx.fill();

      const F = FACE;
      const ink2 = '#17120E';
      if (o.mood === 'ko') {
        const a = F.erx * 1.05;
        ctx.strokeStyle = ink2; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        [F.exL, F.exR].forEach((ex) => {
          ctx.beginPath();
          ctx.moveTo(ex - a, F.ey - a); ctx.lineTo(ex + a, F.ey + a);
          ctx.moveTo(ex + a, F.ey - a); ctx.lineTo(ex - a, F.ey + a);
          ctx.stroke();
        });
      } else if (o.mood === 'happy') {
        const w = F.erx * 1.1;
        ctx.strokeStyle = ink2; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        [F.exL, F.exR].forEach((ex) => {
          ctx.beginPath();
          ctx.moveTo(ex - w, F.ey + 1);
          ctx.quadraticCurveTo(ex, F.ey - F.ery * 2.2, ex + w, F.ey + 1);
          ctx.stroke();
        });
      } else {
        ctx.fillStyle = ink2;
        [F.exL, F.exR].forEach((ex) => {
          ctx.beginPath(); ctx.ellipse(ex, F.ey, F.erx, F.ery, 0, 0, 7); ctx.fill();
        });
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        [F.exL, F.exR].forEach((ex) => {
          ctx.beginPath(); ctx.arc(ex - F.erx * 0.32, F.ey - F.ery * 0.36, F.erx * 0.34, 0, 7); ctx.fill();
        });
        if (o.mood === 'angry' || o.mood === 'sad') {
          const sgn = o.mood === 'angry' ? 1 : -1;
          ctx.strokeStyle = ink2; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(F.exL - F.erx * 1.3, F.ey - F.ery * 1.9 + (sgn < 0 ? 1 : 0));
          ctx.lineTo(F.exL + F.erx * 0.7, F.ey - F.ery * 1.9 + sgn * 2);
          ctx.moveTo(F.exR + F.erx * 1.3, F.ey - F.ery * 1.9 + (sgn < 0 ? 1 : 0));
          ctx.lineTo(F.exR - F.erx * 0.7, F.ey - F.ery * 1.9 + sgn * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      // くちばし
      const w2 = F.bw;
      ctx.fillStyle = '#F5A81E';
      ctx.beginPath();
      ctx.moveTo(50 - w2, F.by);
      ctx.quadraticCurveTo(50, F.by - 4.4, 50 + w2, F.by);
      ctx.quadraticCurveTo(50, F.by + 4.4, 50 - w2, F.by);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(232,135,156,.85)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(50 - w2 * 0.72, F.by + 1.4);
      ctx.quadraticCurveTo(50, F.by + 1.4 + w2 * 0.36, 50 + w2 * 0.72, F.by + 1.4);
      ctx.stroke();

      ctx.restore();
      return;
    }

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

  /* =========================================================
     実機3Dモデル ビュー（WebGL）
     tools/mesh.mjs が gelpyto_3D_mod.gltf から つくった
     GP.piyoMesh（js/piyodata.js）を よみこんで えがく。
     ・からだの 色は 2Dと おなじ 色相システム（hue/sat/lit）
     ・じどうで まわる＋ドラッグで まわせる
     ・canvas が DOM から きえたら じどうで かたづける
     ========================================================= */

  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }

  let meshCache = null;
  function decodeMesh() {
    if (meshCache) return meshCache;
    if (!GP.piyoMesh) return null;
    const M = GP.piyoMesh;
    const toBuf = (s) => {
      const bin = atob(s);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    };
    const qpos = new Int16Array(toBuf(M.v));
    const idx = new Uint16Array(toBuf(M.i));
    const pos = new Float32Array(qpos.length);
    for (let i = 0; i < qpos.length; i++) pos[i] = qpos[i] / M.q;
    meshCache = { pos, nrm: buildNormals(pos, idx), idx, parts: M.parts };
    return meshCache;
  }

  /** なめらか法線（三角形の 法線を 頂点に つみあげる） */
  function buildNormals(pos, idx) {
    const nrm = new Float32Array(pos.length);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [a, b, c].forEach((o) => { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; });
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const d = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= d; nrm[i + 1] /= d; nrm[i + 2] /= d;
    }
    return nrm;
  }

  /* =========================================================
     3D そうび（プロシージャル生成）
     モデル空間: x右 / y上（あし -0.98 〜 あたま +0.98）/ z 手前
     ========================================================= */
  function primNew() { return { v: [], i: [] }; }
  function primBox(m, cx, cy, cz, w, h, d, yaw) {
    const c = Math.cos(yaw || 0), sn = Math.sin(yaw || 0);
    const base = m.v.length / 3;
    const hw = w / 2, hh = h / 2, hd = d / 2;
    for (let k = 0; k < 8; k++) {
      const ox = (k & 1 ? hw : -hw), oy = (k & 2 ? hh : -hh), oz = (k & 4 ? hd : -hd);
      m.v.push(cx + ox * c + oz * sn, cy + oy, cz - ox * sn + oz * c);
    }
    [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
     [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]
      .forEach((t) => m.i.push(base + t[0], base + t[1], base + t[2]));
  }
  /** axis: 'y'（たて）/ 'z'（前むき）。rB=0 で 円すい */
  function primCyl(m, cx, cy, cz, axis, rA, rB, h, seg, caps) {
    const base = m.v.length / 3;
    const halfs = h / 2;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      if (axis === 'y') {
        m.v.push(cx + ca * rA, cy - halfs, cz + sa * rA);
        m.v.push(cx + ca * rB, cy + halfs, cz + sa * rB);
      } else {
        m.v.push(cx + ca * rA, cy + sa * rA, cz - halfs);
        m.v.push(cx + ca * rB, cy + sa * rB, cz + halfs);
      }
    }
    for (let k = 0; k < seg; k++) {
      const p0 = base + k * 2, p1 = p0 + 1, p2 = p0 + 2, p3v = p0 + 3;
      m.i.push(p0, p2, p1, p1, p2, p3v);
    }
    if (caps !== false) {
      const cA = m.v.length / 3;
      if (axis === 'y') { m.v.push(cx, cy - halfs, cz); m.v.push(cx, cy + halfs, cz); }
      else { m.v.push(cx, cy, cz - halfs); m.v.push(cx, cy, cz + halfs); }
      for (let k = 0; k < seg; k++) {
        m.i.push(cA, base + k * 2 + 2, base + k * 2);
        m.i.push(cA + 1, base + k * 2 + 1, base + k * 2 + 3);
      }
    }
  }
  /** from 以降に つくった 頂点を、点(cx,cy,cz)を 支点に x軸まわりで かたむける */
  function primTilt(m, from, cx, cy, cz, ax) {
    const c = Math.cos(ax), sn = Math.sin(ax);
    for (let i = from; i < m.v.length; i += 3) {
      const y = m.v[i + 1] - cy, z = m.v[i + 2] - cz;
      m.v[i + 1] = cy + y * c - z * sn;
      m.v[i + 2] = cz + y * sn + z * c;
    }
  }
  function primDone(m, color, gloss) {
    return { pos: new Float32Array(m.v), idx: new Uint16Array(m.i), color, gloss };
  }
  const p3 = (f, color, gloss) => { const m = primNew(); f(m); return primDone(m, color, gloss); };
  const C3 = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  /** そうびID → 3Dパーツ群（2Dの 配色に あわせる） */
  const ACC3D = {
    straw: () => [
      p3((m) => primCyl(m, 0, 0.66, 0, 'y', 0.60, 0.60, 0.045, 18), C3('#F5DFAE'), 0.25),
      p3((m) => primCyl(m, 0, 0.78, 0, 'y', 0.34, 0.25, 0.22, 16), C3('#EFD9A4'), 0.25),
      p3((m) => primCyl(m, 0, 0.705, 0, 'y', 0.35, 0.345, 0.075, 16, false), C3('#D9553F'), 0.3),
    ],
    crown: () => [
      // あたまの実測: 半径0.28 ≒ y0.65 → リング下端を あたまに くいこませて すき間ゼロ
      p3((m) => {
        primCyl(m, 0, 0.65, 0, 'y', 0.285, 0.27, 0.15, 12, false);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.3;
          primCyl(m, Math.cos(a) * 0.25, 0.795, Math.sin(a) * 0.25, 'y', 0.06, 0, 0.15, 8);
        }
      }, C3('#FFD24A'), 0.9),
    ],
    goggle: () => [
      p3((m) => {
        primCyl(m, -0.185, 0.366, 0.52, 'z', 0.155, 0.155, 0.08, 14, false);
        primCyl(m, 0.185, 0.366, 0.52, 'z', 0.155, 0.155, 0.08, 14, false);
        // よこヒモ：レンズの ふち（x±0.34, z0.51）から あたまの よこ後方（z0.09）へ
        primBox(m, -0.405, 0.366, 0.30, 0.44, 0.10, 0.05, -1.25);
        primBox(m, 0.405, 0.366, 0.30, 0.44, 0.10, 0.05, 1.25);
        primBox(m, 0, 0.366, 0.545, 0.10, 0.07, 0.05, 0);
      }, C3('#3E4C59'), 0.5),
      p3((m) => {
        primCyl(m, -0.185, 0.366, 0.545, 'z', 0.12, 0.12, 0.03, 14);
        primCyl(m, 0.185, 0.366, 0.545, 'z', 0.12, 0.12, 0.03, 14);
      }, C3('#BEEAF7'), 0.95),
    ],
    gun: () => [
      // はねさきの実測 (x0.70, y-0.16, z0.05) に グリップを かさねて「もたせる」
      p3((m) => primBox(m, 0.70, -0.12, 0.28, 0.13, 0.12, 0.34, 0), C3('#FF8A3D'), 0.6),
      p3((m) => primBox(m, 0.70, -0.09, 0.50, 0.07, 0.07, 0.16, 0), C3('#63C6E0'), 0.7),
      p3((m) => primBox(m, 0.70, -0.24, 0.14, 0.11, 0.18, 0.12, 0.1), C3('#F06C1F'), 0.5),
      p3((m) => primCyl(m, 0.70, 0.00, 0.24, 'y', 0.075, 0.075, 0.10, 10), C3('#8FD3F4'), 0.9),
    ],
    shield: () => [
      // ひだり前に かまえた 板（あつみ方向 d を そとむきに して、体表の そとに 出す）
      p3((m) => primBox(m, -0.566, -0.14, 0.500, 0.56, 0.64, 0.05, -0.35), C3('#A97B45'), 0.3),
      p3((m) => primBox(m, -0.578, -0.14, 0.532, 0.46, 0.54, 0.06, -0.35), C3('#D2A468'), 0.35),
    ],
    boots: () => [
      // あしの実測: x ±0.02..0.43 / y -0.98..-0.85 / つまさき z +0.49 まで
      // → つまさきを すっぽり つつむ 位置に（うしろは 胴の底に つながる）
      p3((m) => {
        primBox(m, -0.24, -0.83, 0.36, 0.34, 0.30, 0.54, 0);
        primBox(m, 0.24, -0.83, 0.36, 0.34, 0.30, 0.54, 0);
      }, C3('#FFC93C'), 0.6),
      p3((m) => {
        primBox(m, -0.24, -0.965, 0.38, 0.37, 0.05, 0.60, 0);
        primBox(m, 0.24, -0.965, 0.38, 0.37, 0.05, 0.60, 0);
      }, C3('#E0A310'), 0.4),
    ],
    towel: () => [
      p3((m) => primCyl(m, 0, -0.28, 0, 'y', 0.71, 0.68, 0.16, 20, false), C3('#EF6B6B'), 0.35),
    ],
    randsel: () => [
      p3((m) => primBox(m, 0, -0.05, -0.56, 0.56, 0.52, 0.24, 0), C3('#B03F50'), 0.45),
      p3((m) => primBox(m, 0, 0.14, -0.55, 0.58, 0.18, 0.27, 0), C3('#8E2E3E'), 0.45),
    ],
    whistle: () => [
      p3((m) => primCyl(m, 0, 0.24, 0, 'y', 0.50, 0.47, 0.028, 18, false), C3('#EFE9DC'), 0.3),
      p3((m) => primBox(m, 0.10, -0.10, 0.68, 0.17, 0.11, 0.10, 0.2), C3('#F0A020'), 0.7),
    ],
    net: () => [
      // はねさき (0.70, -0.16, 0.05) を にぎり点に、柄を まえに かたむけて もつ
      p3((m) => {
        const f = m.v.length;
        primBox(m, 0.70, 0.10, 0.05, 0.055, 1.15, 0.055, 0);
        primCyl(m, 0.70, 0.68, 0.05, 'z', 0.22, 0.22, 0.05, 14, false);
        primTilt(m, f, 0.70, -0.16, 0.05, 0.30);
      }, C3('#B98A50'), 0.3),
      p3((m) => {
        const f = m.v.length;
        primCyl(m, 0.70, 0.68, 0.03, 'z', 0.20, 0.20, 0.015, 14);
        primTilt(m, f, 0.70, -0.16, 0.05, 0.30);
      }, C3('#DFF0D8'), 0.2),
    ],
  };

  const VS = `
attribute vec3 aP; attribute vec3 aN;
uniform mat4 uMVP; uniform mat3 uRot;
varying vec3 vN;
void main(){ vN = uRot * aN; gl_Position = uMVP * vec4(aP, 1.0); }`;
  const FS = `
precision mediump float;
varying vec3 vN;
uniform vec3 uColor; uniform float uGloss;
void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(-0.38, 0.82, 0.6));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float diff = max(dot(N, L), 0.0);
  vec3 col = uColor * (0.52 + diff * 0.55);
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 30.0) * uGloss;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4) * 0.3;
  col += vec3(spec) + uColor * rim;          /* ゲルの ツヤ */
  gl_FragColor = vec4(col, 1.0);
}`;

  /* ---------- ちいさな行列 ---------- */
  function mat4Perspective(fov, asp, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function rotYX(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) * Ry(yaw)（列優先 3x3）
    return [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
  }

  /**
   * 実機3Dモデルの ビューを つくる。
   * @param {object} looks  looksOf()/factionLooks() の もどりち（hue/sat/lit/kind）
   * @param {object} opts   { size:CSSpx, spin:bool, drag:bool, bob:bool }
   * @returns {HTMLCanvasElement|null}  つかえない環境では null（よびだし側で SVG に フォールバック）
   */
  function view3d(looks, opts) {
    const o = opts || {};
    if (looks && looks.kind && looks.kind !== 'piyo') return null;   // カラス/ネコは 2Dのみ
    const mesh = decodeMesh();
    if (!mesh) return null;

    const size = o.size || 110;
    const canvas = document.createElement('canvas');
    canvas.className = 'piyo3d';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * 1.12 * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = Math.round(size * 1.12) + 'px';

    let gl;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    } catch (e) { gl = null; }
    if (!gl) return null;

    const prog = gl.createProgram();
    [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]].forEach(([type, src]) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(prog, sh);
    });
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    const makeBuf = (target, data) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    const bufP = makeBuf(gl.ARRAY_BUFFER, mesh.pos);
    const bufN = makeBuf(gl.ARRAY_BUFFER, mesh.nrm);
    const bufI = makeBuf(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
    const locP = gl.getAttribLocation(prog, 'aP');
    const locN = gl.getAttribLocation(prog, 'aN');
    gl.enableVertexAttribArray(locP);
    gl.enableVertexAttribArray(locN);
    const bindGeom = (bp, bn, bi) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, bp);
      gl.vertexAttribPointer(locP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bn);
      gl.vertexAttribPointer(locN, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
    };

    // ---- そうび（プロシージャル3D）を くみたてる ----
    const accGeoms = [];
    ((looks && looks.acc) || []).forEach((a) => {
      if (!ACC3D[a]) return;
      ACC3D[a]().forEach((g) => {
        accGeoms.push({
          color: g.color, gloss: g.gloss === undefined ? 0.5 : g.gloss,
          bp: makeBuf(gl.ARRAY_BUFFER, g.pos),
          bn: makeBuf(gl.ARRAY_BUFFER, buildNormals(g.pos, g.idx)),
          bi: makeBuf(gl.ELEMENT_ARRAY_BUFFER, g.idx),
          n: g.idx.length,
        });
      });
    });

    const uMVP = gl.getUniformLocation(prog, 'uMVP');
    const uRot = gl.getUniformLocation(prog, 'uRot');
    const uColor = gl.getUniformLocation(prog, 'uColor');
    const uGloss = gl.getUniformLocation(prog, 'uGloss');

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    // パーツの いろ：からだは 2Dと おなじ 色相システムで
    const partColor = (name) => {
      if (name === 'body') return hslToRgb(looks.hue ?? 205, looks.sat ?? 76, looks.lit ?? 56);
      if (name === 'eye') return [0.10, 0.085, 0.07];
      if (name === 'beak') return [0.96, 0.66, 0.12];
      return [0.95, 0.62, 0.70];                     // ほっぺ
    };
    const colors = {};
    mesh.parts.forEach((pt) => { colors[pt.n] = partColor(pt.n); });

    // そうびが よこ・うしろに つくものは、まず 見える むきで ひらく
    const ACC_FACE_YAW = {
      gun: -0.55, whistle: -0.25, shield: 0.55, net: -0.5,
      randsel: Math.PI * 0.9,
    };
    const accArr = (looks && looks.acc) || [];
    const lastAcc = accArr[accArr.length - 1];
    const yawStart = ACC_FACE_YAW[lastAcc] !== undefined ? ACC_FACE_YAW[lastAcc] : 0.35;
    let yaw = o.yaw0 === undefined ? yawStart : o.yaw0;
    let pitch = 0.12, vy = o.spin === false ? 0 : 0.65;
    let dragging = false, lx = 0, ly = 0, lastTouch = 0;
    let rafId = 0, t0 = performance.now();

    if (o.drag !== false) {
      canvas.style.touchAction = 'none';
      canvas.style.cursor = 'grab';
      canvas.addEventListener('pointerdown', (e) => {
        dragging = true; lx = e.clientX; ly = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        yaw += (e.clientX - lx) * 0.013;
        pitch = Math.max(-0.9, Math.min(0.9, pitch + (e.clientY - ly) * 0.01));
        lx = e.clientX; ly = e.clientY;
        lastTouch = performance.now();
      });
      const up = () => { dragging = false; lastTouch = performance.now(); };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    }

    const proj = mat4Perspective(0.62, canvas.width / canvas.height, 0.4, 12);
    const DIST = 3.5;

    function frame(now) {
      if (!canvas.isConnected) { destroy(); return; }
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
      if (!dragging && now - lastTouch > 900) yaw += vy * dt;

      const bob = o.bob === false ? 0 : Math.sin(now / 480) * 0.03;
      const R = rotYX(yaw, pitch);
      // MVP = proj * translate(0, bob-0.04, -DIST) * R（4x4に くみたて）
      const m = [
        R[0], R[1], R[2], 0,
        R[3], R[4], R[5], 0,
        R[6], R[7], R[8], 0,
        0, bob + 0.02, -DIST, 1,
      ];
      const mvp = new Float32Array(16);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        mvp[c * 4 + r] =
          proj[0 * 4 + r] * m[c * 4 + 0] + proj[1 * 4 + r] * m[c * 4 + 1] +
          proj[2 * 4 + r] * m[c * 4 + 2] + proj[3 * 4 + r] * m[c * 4 + 3];
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uMVP, false, mvp);
      gl.uniformMatrix3fv(uRot, false, R);
      bindGeom(bufP, bufN, bufI);
      mesh.parts.forEach((pt) => {
        const c = colors[pt.n];
        gl.uniform3f(uColor, c[0], c[1], c[2]);
        gl.uniform1f(uGloss, pt.n === 'body' ? 0.85 : 0.4);
        gl.drawElements(gl.TRIANGLES, pt.c, gl.UNSIGNED_SHORT, pt.s * 2);
      });
      accGeoms.forEach((g) => {
        bindGeom(g.bp, g.bn, g.bi);
        gl.uniform3f(uColor, g.color[0], g.color[1], g.color[2]);
        gl.uniform1f(uGloss, g.gloss);
        gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
      });
    }

    function destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }

    rafId = requestAnimationFrame(frame);
    return canvas;
  }

  function has3d() { return !!GP.piyoMesh; }

  GP.piyo = { svg, node, looksOf, factionLooks, paint, hsl, view3d, has3d };
})(window.GP);
