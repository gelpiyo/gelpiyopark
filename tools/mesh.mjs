/* =========================================================
   tools/mesh.mjs — 実機3Dモデル（GLTF+BIN）→ ゲーム用データ変換

   SolidWorks 出力の gelpyto_3D_mod.gltf / .bin を よみこみ、
   1) 頂点クラスタリングで ポリゴン数を けずる（見た目は たもつ）
   2) ゲームの座標系（Y上・正面がカメラ側）へ へんかん
   3) int16 に 量子化して base64 で js/piyodata.js に うめこむ

   つかいかた:
     node tools/mesh.mjs "C:/Users/20411/Desktop/gelpyto_3D_mod.gltf"
   ========================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'C:/Users/20411/Desktop/gelpyto_3D_mod.gltf';

const gltf = JSON.parse(readFileSync(SRC, 'utf8'));
const binBuf = readFileSync(join(dirname(SRC), gltf.buffers[0].uri));
const bin = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);

function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 0;
  if (a.componentType === 5125) return new Uint32Array(bin, off, a.count * n);
  if (a.componentType === 5126) return new Float32Array(bin, off, a.count * n);
  throw new Error('unsupported componentType ' + a.componentType);
}

/* ---------- 1) パーツごとに よみだし ---------- */
// primitive: 0=くちばし(橙) 1=め(黒) 2=からだ 3=ほっぺ(桃)
const PART_DEF = [
  { prim: 2, name: 'body',   grid: 34 },   // 23,711頂点 → おおきく削減
  { prim: 1, name: 'eye',    grid: 20 },
  { prim: 0, name: 'beak',   grid: 16 },
  { prim: 3, name: 'accent', grid: 10 },
];

const prims = gltf.meshes[0].primitives;

/** 頂点クラスタリング（グリッドに まるめて 合体） */
function decimate(pos, idx, grid) {
  let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
  for (let i = 0; i < pos.length; i += 3) {
    minx = Math.min(minx, pos[i]);     maxx = Math.max(maxx, pos[i]);
    miny = Math.min(miny, pos[i + 1]); maxy = Math.max(maxy, pos[i + 1]);
    minz = Math.min(minz, pos[i + 2]); maxz = Math.max(maxz, pos[i + 2]);
  }
  const dim = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
  const g = dim / grid;
  const cell = new Map();               // key -> rep index
  const remap = new Uint32Array(pos.length / 3);
  const sums = [];
  for (let v = 0; v < pos.length / 3; v++) {
    const kx = Math.round((pos[v * 3] - minx) / g);
    const ky = Math.round((pos[v * 3 + 1] - miny) / g);
    const kz = Math.round((pos[v * 3 + 2] - minz) / g);
    const key = kx * 4000000 + ky * 2000 + kz;
    let r = cell.get(key);
    if (r === undefined) {
      r = sums.length;
      cell.set(key, r);
      sums.push([0, 0, 0, 0]);
    }
    const s = sums[r];
    s[0] += pos[v * 3]; s[1] += pos[v * 3 + 1]; s[2] += pos[v * 3 + 2]; s[3]++;
    remap[v] = r;
  }
  const outPos = new Float32Array(sums.length * 3);
  sums.forEach((s, r) => {
    outPos[r * 3] = s[0] / s[3];
    outPos[r * 3 + 1] = s[1] / s[3];
    outPos[r * 3 + 2] = s[2] / s[3];
  });
  const outIdx = [];
  const seen = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    // むきを たもった まま 重複だけ すてる
    const key = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outIdx.push(a, b, c);
  }
  return { pos: outPos, idx: outIdx };
}

const parts = PART_DEF.map((d) => {
  const p = prims[d.prim];
  const pos = accessor(p.attributes.POSITION);
  const idx = accessor(p.indices);
  const before = { v: pos.length / 3, t: idx.length / 3 };
  const dec = decimate(pos, idx, d.grid);
  console.log(`${d.name.padEnd(7)} 頂点 ${String(before.v).padStart(6)} → ${String(dec.pos.length / 3).padStart(5)}　三角形 ${String(before.t).padStart(6)} → ${String(dec.idx.length / 3).padStart(5)}`);
  return { name: d.name, ...dec };
});

/* ---------- 2) 座標系の へんかん ----------
   モデル: Z上・正面 = -X（くちばしが -X側）
   ゲーム: Y上・正面 = +Z（カメラの ほう）
   (xw, yw, zw) = (-y, z, -x)  … 右手系を たもつ                */
let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
parts.forEach((pt) => {
  const p = pt.pos;
  for (let i = 0; i < p.length; i += 3) {
    const xw = -p[i + 1], yw = p[i + 2], zw = -p[i];
    p[i] = xw; p[i + 1] = yw; p[i + 2] = zw;
    mnx = Math.min(mnx, xw); mxx = Math.max(mxx, xw);
    mny = Math.min(mny, yw); mxy = Math.max(mxy, yw);
    mnz = Math.min(mnz, zw); mxz = Math.max(mxz, zw);
  }
});
const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
const half = Math.max(mxx - mnx, mxy - mny, mxz - mnz) / 2;

/* ---------- 3) 量子化 & パック ---------- */
const Q = 32000;
let totalV = 0, totalI = 0;
parts.forEach((pt) => { totalV += pt.pos.length / 3; totalI += pt.idx.length; });
if (totalV > 65000) throw new Error('頂点が Uint16 を こえた: ' + totalV);

const packedPos = new Int16Array(totalV * 3);
const packedIdx = new Uint16Array(totalI);
const meta = [];
let vBase = 0, iBase = 0;
parts.forEach((pt) => {
  const p = pt.pos;
  for (let i = 0; i < p.length; i += 3) {
    packedPos[(vBase + i / 3) * 3]     = Math.round(((p[i]     - cx) / half) * Q * 0.98);
    packedPos[(vBase + i / 3) * 3 + 1] = Math.round(((p[i + 1] - cy) / half) * Q * 0.98);
    packedPos[(vBase + i / 3) * 3 + 2] = Math.round(((p[i + 2] - cz) / half) * Q * 0.98);
  }
  pt.idx.forEach((ix, k) => { packedIdx[iBase + k] = vBase + ix; });
  meta.push({ n: pt.name, s: iBase, c: pt.idx.length });
  vBase += p.length / 3;
  iBase += pt.idx.length;
});

const b64 = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64');

const out = `/* =========================================================
   piyodata.js — ゲルぴよ 実機3Dモデル（自動生成・編集しない）
   もと: gelpyto_3D_mod.gltf (SolidWorks)  ${totalV} 頂点 / ${totalI / 3} 三角形
   再生成: node tools/mesh.mjs <gltfのパス>
   ========================================================= */
window.GP = window.GP || {};
GP.piyoMesh = {
  q: ${Q},
  parts: ${JSON.stringify(meta)},
  v: '${b64(packedPos)}',
  i: '${b64(packedIdx)}',
};
`;
writeFileSync(join(ROOT, 'js/piyodata.js'), out);
const kb = (n) => Math.round(n / 1024) + ' KB';
console.log(`\nごうけい 頂点 ${totalV} / 三角形 ${totalI / 3}`);
console.log(`js/piyodata.js: ${kb(out.length)}（バイナリ ${kb(packedPos.byteLength + packedIdx.byteLength)}）`);
