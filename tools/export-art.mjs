/* =========================================================
   tools/export-art.mjs — 見た目の データを Godot 用に かきだす

   1) js/icons.js の アイコン 62種 → godot/data/icons.json（名前 → SVG 文字列）
      Godot は 実行時に Image.load_svg_from_string で 画像に する
   2) js/piyo.js の ぴよ SVG を いろいろな 見た目で つくり → godot/tests/golden_art.json
      Godot版（godot/scripts/view/piyo_art.gd）が おなじ SVG を つくれるかの せいかい
   3) js/piyodata.js の 実機3Dモデル（gelpyto_3D_mod.gltf から tools/mesh.mjs が つくった もの）
      → godot/data/piyo_mesh.json。あわせて 3D の せいかい（法線・そうびパーツ）も golden_art.json へ

   Web版の icons.js / piyo.js を かえたら これを さいじっこう する。
   つかいかた: node tools/export-art.mjs
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const noopEl = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {},
  setAttribute() {}, querySelectorAll: () => [], innerHTML: '', firstElementChild: null });
const ctx = createContext({
  console, Math, JSON, Object, Array, String, Number, Boolean, Map, Set, Error, Date, atob,
  Int16Array, Uint16Array, Uint8Array, Float32Array,
  document: { createElement: noopEl, querySelectorAll: () => [] },
});
ctx.window = ctx; ctx.globalThis = ctx;
for (const f of ['js/util.js', 'js/data.js', 'js/icons.js', 'js/piyodata.js', 'js/piyo.js']) {
  runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { icons: I, piyo: P, data: D } = ctx.GP;

/* ---------- 1) アイコン ---------- */
const icons = {};
for (const name of I.names()) {
  icons[name] = I.svg(name, 32).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
}
const iconDest = join(ROOT, 'godot/data/icons.json');
mkdirSync(dirname(iconDest), { recursive: true });
writeFileSync(iconDest, JSON.stringify({ _meta: { source: 'js/icons.js', note: 'tools/export-art.mjs で 自動生成' }, icons }, null, 0));

/* ---------- 2) ぴよ SVG の せいかい ---------- */
// id の 通し番号（bdg1a など）は Web版の DOM 都合なので とりのぞいて くらべる
const norm = (s) => s.replace(/\b(bd|sh|bk)g[0-9a-z]+\b/g, '$1');
const cases = [];
const add = (looks) => cases.push({ looks: JSON.parse(JSON.stringify(looks)), svg: norm(P.svg(looks)) });
const moods = ['normal', 'happy', 'sad', 'angry', 'ko'];
// 種族 × 表情
D.SPECIES.forEach((sp) => moods.forEach((m) =>
  add(P.looksOf({ sp: sp.id, lv: 1, equip: null, evo: null }, m))));
// 種族 × そうび（種族の もちものとの くみあわせ）
D.SPECIES.forEach((sp) => D.EQUIPS.forEach((eq) =>
  add(P.looksOf({ sp: sp.id, lv: 1, equip: eq.id, evo: null }, 'normal'))));
// でんせつ しんか（色が かわる）
D.SPECIES.forEach((sp) => add(P.looksOf({ sp: sp.id, lv: 20, equip: null, evo: 'legend' }, 'happy')));
// 勢力 × やくわり × 表情
Object.keys(D.FACTIONS).forEach((f) => D.ROLE_ORDER.forEach((r) => ['normal', 'angry', 'ko'].forEach((m) =>
  add(P.factionLooks(f, r, m)))));
// ひだりむき
add({ hue: 48, sat: 88, lit: 60, acc: ['crown', 'gun'], mood: 'happy', flip: true });
// looksOf / factionLooks じたいも くらべる
const looksCases = [];
D.SPECIES.forEach((sp) => D.EQUIPS.concat([{ id: null }]).forEach((eq) => ['normal', 'ko'].forEach((m) =>
  looksCases.push({ unit: { sp: sp.id, equip: eq.id, evo: sp.id === 'kopiyo' ? 'legend' : null }, mood: m,
    looks: P.looksOf({ sp: sp.id, equip: eq.id, evo: sp.id === 'kopiyo' ? 'legend' : null }, m) }))));

/* ---------- 3) 実機3Dモデル ---------- */
const M = ctx.GP.piyoMesh;
const meshDest = join(ROOT, 'godot/data/piyo_mesh.json');
writeFileSync(meshDest, JSON.stringify({ _meta: { source: 'js/piyodata.js', note: 'tools/export-art.mjs で 自動生成' },
  q: M.q, parts: M.parts, v: M.v, i: M.i }));
const M3 = P._mesh3d;
const dm = M3.decode();
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const step = 97;                               // 法線は 間引いて くらべる
const nrmSample = [];
for (let k = 0; k < dm.nrm.length / 3; k += step) nrmSample.push([k, r6(dm.nrm[k * 3]), r6(dm.nrm[k * 3 + 1]), r6(dm.nrm[k * 3 + 2])]);
const acc3d = {};
for (const id of M3.accIds()) {
  acc3d[id] = M3.acc(id).map((g) => ({ pos: Array.from(g.pos, r6), idx: Array.from(g.idx), color: g.color.map(r6), gloss: g.gloss }));
}
const mesh3d = { verts: dm.pos.length / 3, tris: dm.idx.length / 3, posSum: r6(dm.pos.reduce((a, b) => a + b, 0)), nrmSample, acc3d };

const artDest = join(ROOT, 'godot/tests/golden_art.json');
writeFileSync(artDest, JSON.stringify({ svg: cases, looks: looksCases, mesh3d }));
console.log(`wrote ${iconDest}（アイコン ${Object.keys(icons).length}種）`);
console.log(`wrote ${artDest}（ぴよ SVG ${cases.length}とおり / looksOf ${looksCases.length} / 3D ${mesh3d.verts}頂点・そうび ${Object.keys(acc3d).length}種）`);
console.log(`wrote ${meshDest}`);
