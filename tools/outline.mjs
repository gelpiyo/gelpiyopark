/* =========================================================
   tools/outline.mjs — 実機3Dモデルの「正面図」を SVG用データに変換

   js/piyodata.js（3Dメッシュ）を よみこみ、正面投影を ラスタライズ →
   輪郭トレース（Mooreたどり）→ RDPで 単純化 して、
   ・からだの シルエット（とさかの あいだの くぼみも 正確）
   ・め／くちばし／ほっぺ の 位置と 大きさ
   を SVG座標（x 0..100 / y 0..132）で js/piyo.js の SHAPE に うめこむ。

   つかいかた: node tools/outline.mjs
   ========================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'js/piyodata.js'), 'utf8');

const q = +src.match(/q:\s*(\d+)/)[1];
const parts = JSON.parse(src.match(/parts:\s*(\[.*?\])/s)[1]);
const vB64 = src.match(/v:\s*'([^']+)'/)[1];
const iB64 = src.match(/i:\s*'([^']+)'/)[1];
const pos16 = new Int16Array(Buffer.from(vB64, 'base64').buffer);
const idx = new Uint16Array(Buffer.from(iB64, 'base64').buffer);

/* ---------- SVG座標系（x右 / y下） ----------
   モデル y: -0.98..0.98 → SVG y 126..6 ／ x 同スケール（中心50） */
const SCALE = 61.2, CXS = 50, CYS = 66;
const sx = (x) => CXS + x * SCALE;
const sy = (y) => CYS - y * SCALE;
const r1 = (v) => Math.round(v * 10) / 10;

const P = [];   // 全頂点（SVG座標）
for (let i = 0; i < pos16.length; i += 3) {
  P.push([sx(pos16[i] / q), sy(pos16[i + 1] / q)]);
}

const partOf = (name) => parts.find((p) => p.n === name);
function vertsOf(name) {
  const pt = partOf(name);
  const set = new Set();
  for (let k = pt.s; k < pt.s + pt.c; k++) set.add(idx[k]);
  return [...set].map((v) => P[v]);
}

/* =========================================================
   1) からだの シルエット
   ========================================================= */
const RES = 0.5;                        // 1セル = 0.5 SVG単位
const GW = Math.ceil(100 / RES), GH = Math.ceil(132 / RES);
const grid = new Uint8Array(GW * GH);
const at = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH) ? grid[y * GW + x] : 0;

// 三角形を ぬりつぶす
const body = partOf('body');
for (let k = body.s; k < body.s + body.c; k += 3) {
  const A = P[idx[k]], B = P[idx[k + 1]], C = P[idx[k + 2]];
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) / RES) - 1);
  const x1 = Math.min(GW - 1, Math.ceil(Math.max(A[0], B[0], C[0]) / RES) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]) / RES) - 1);
  const y1 = Math.min(GH - 1, Math.ceil(Math.max(A[1], B[1], C[1]) / RES) + 1);
  const e = (p, a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const x = (gx + 0.5) * RES, y = (gy + 0.5) * RES;
      const d0 = e(null, A, B, x, y), d1 = e(null, B, C, x, y), d2 = e(null, C, A, x, y);
      if ((d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0)) grid[gy * GW + gx] = 1;
    }
  }
}
// 1px の あなを とじる（かんたん クロージング）
const g2 = new Uint8Array(grid);
for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
  if (!at(x, y) && at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) >= 3) g2[y * GW + x] = 1;
}
grid.set(g2);

// Mooreたどりで 輪郭を とる
let sxp = -1, syp = -1;
outer: for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
  if (at(x, y)) { sxp = x; syp = y; break outer; }
}
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const contour = [];
let cx = sxp, cy = syp, dir = 6;   // うえ向きから 時計まわりに さがす
for (let step = 0; step < 40000; step++) {
  contour.push([cx, cy]);
  let found = false;
  for (let t = 0; t < 8; t++) {
    const d = (dir + 6 + t) % 8;           // ひだり手法
    const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
    if (at(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
  }
  if (!found) break;
  if (cx === sxp && cy === syp && contour.length > 10) break;
}

/* RDP 単純化 */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let dmax = 0, imax = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax <= eps) return [a, b];
  return rdp(pts.slice(0, imax + 1), eps).slice(0, -1).concat(rdp(pts.slice(imax), eps));
}
const simp = rdp(contour, 0.85).slice(0, -1);
const outline = simp.map(([x, y]) => [r1(x * RES), r1(y * RES)]);

/* =========================================================
   2) かお パーツ
   ========================================================= */
const eyes = vertsOf('eye');
const left = eyes.filter(([x]) => x < 50), right = eyes.filter(([x]) => x >= 50);
function cluster(vs) {
  let mx = 0, my = 0;
  vs.forEach(([x, y]) => { mx += x; my += y; });
  mx /= vs.length; my /= vs.length;
  let rx = 0, ry = 0;
  vs.forEach(([x, y]) => { rx = Math.max(rx, Math.abs(x - mx)); ry = Math.max(ry, Math.abs(y - my)); });
  return { x: mx, y: my, rx, ry };
}
const eL = cluster(left), eR = cluster(right);
const eye = {
  dx: r1((eR.x - eL.x) / 2),
  y: r1((eL.y + eR.y) / 2),
  rx: r1((eL.rx + eR.rx) / 2 * 0.92),
  ry: r1((eL.ry + eR.ry) / 2 * 0.92),
};

function bounds(vs) {
  let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
  vs.forEach(([x, y]) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  });
  return { cy: r1((y0 + y1) / 2), w: r1(x1 - x0), h: r1(y1 - y0) };
}
const beak = bounds(vertsOf('beak'));
const accent = bounds(vertsOf('accent'));

/* あたまの ドーム（|x-50| 14..30 の 範囲の さいこう点）＝ ぼうし の めやす */
let domeY = 999;
outline.forEach(([x, y]) => { if (Math.abs(x - 50) > 14 && Math.abs(x - 50) < 30 && y < domeY) domeY = y; });

const shape = { body: outline, eye, beak, accent, dome: r1(domeY), bottom: 126.5 };

const snippet =
`  /* @generated-shape-start（tools/outline.mjs が 3Dモデルから 自動生成） */
  const SHAPE = ${JSON.stringify(shape)};
  /* @generated-shape-end */`;

const pj = join(ROOT, 'js/piyo.js');
let piyo = readFileSync(pj, 'utf8');
const re = /  \/\* @generated-shape-start.*?@generated-shape-end \*\//s;
if (re.test(piyo)) piyo = piyo.replace(re, snippet);
else piyo = piyo.replace('  let idSeq = 0;', snippet + '\n\n  let idSeq = 0;');
writeFileSync(pj, piyo);

console.log('輪郭点:', outline.length, '点（トレース', contour.length, '→ RDP後）');
console.log('め   :', JSON.stringify(eye));
console.log('くち :', JSON.stringify(beak));
console.log('ほっぺ:', JSON.stringify(accent));
console.log('ドーム y:', shape.dome);
console.log('→ js/piyo.js の SHAPE を こうしん しました');
