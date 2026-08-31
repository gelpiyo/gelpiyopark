/* =========================================================
   tools/icons.mjs — PWAアイコンを いまの ゲルぴよで つくりなおす

   js/piyo.js の svg()（実機3Dモデル正面の シルエット）から
   プレイヤーカラーの ぴよを えがき、
     assets/icon.svg           … ふつうの アイコン（角丸・空と草の背景）
     assets/icon-maskable.svg  … maskable（全面背景・セーフゾーン内に収める）
   を 生成する。見た目を かえたら これを 再実行すれば 追従する。

   つかいかた: node tools/icons.mjs
   ========================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ctx = createContext({ Math, Date, JSON, Object, Array, String, Number, Map, Set, console });
ctx.window = ctx; ctx.globalThis = ctx;
for (const f of ['js/util.js', 'js/data.js', 'js/piyo.js']) {
  runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
}

// プレイヤーカラー（data.js の FACTIONS.player に 追従）
const P = ctx.GP.data.FACTIONS.player;
const full = ctx.GP.piyo.svg({ hue: P.hue, sat: P.sat, lit: P.lit, mood: 'happy' });
// そとがわの <svg> を はずして なかみだけ つかう
const inner = full.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

/* ぴよの 実寸（viewBox内）: x 6..94 / y 6..126.5 */
const BW = 88, BH = 120.5, BX = 6, BY = 6;

/** 512角の 中に ぴよを 中央配置する transform */
function fit(scale, dyExtra = 0) {
  const tx = (512 - BW * scale) / 2 - BX * scale;
  const ty = (512 - BH * scale) / 2 - BY * scale + dyExtra;
  return `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale})`;
}

/* ---------- ふつうの アイコン ---------- */
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#CFF3FB"/><stop offset=".62" stop-color="#9EE3F2"/>
<stop offset=".621" stop-color="#A9DE8C"/><stop offset="1" stop-color="#7FC463"/></linearGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#sky)"/>
<ellipse cx="256" cy="452" rx="150" ry="26" fill="#5FA84C" opacity=".35"/>
<g transform="${fit(3.55, 14)}">${inner}</g>
</svg>
`;

/* ---------- maskable（中央80%の セーフゾーンに 収める） ---------- */
const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#CFF3FB"/><stop offset=".66" stop-color="#9EE3F2"/>
<stop offset=".661" stop-color="#A9DE8C"/><stop offset="1" stop-color="#7FC463"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#sky)"/>
<g transform="${fit(2.85, 10)}">${inner}</g>
</svg>
`;

writeFileSync(join(ROOT, 'assets/icon.svg'), icon);
writeFileSync(join(ROOT, 'assets/icon-maskable.svg'), mask);
console.log('assets/icon.svg          :', Math.round(icon.length / 102.4) / 10, 'KB');
console.log('assets/icon-maskable.svg :', Math.round(mask.length / 102.4) / 10, 'KB');
console.log('プレイヤーカラー hue', P.hue, '/ sat', P.sat, '/ lit', P.lit, 'で 生成しました');
