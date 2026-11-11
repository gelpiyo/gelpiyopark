/* =========================================================
   tools/export-data.mjs — js/data.js の マスタを Godot 用 JSON に かきだす

   Web版の js/data.js を「ただ ひとつの データげん」に して、
   Godot版（godot/data/master.json）は それを よむ だけに する。
   data.js の 関数（facCost など・RULES.xpTable）は JSON に できないので
   Godot 側の godot/scripts/core/game_data.gd に おなじ 式で うつしてある。

   つかいかた: node tools/export-data.mjs
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = createContext({ console, Math });
ctx.window = ctx;
runInContext(readFileSync(join(ROOT, 'js/data.js'), 'utf8'), ctx, { filename: 'js/data.js' });
const D = ctx.GP.data;

// 関数と、ID引きの 重複テーブル（Godot 側で つくりなおす）は のぞく
const SKIP = new Set(['FAC_BY_ID', 'SPECIES_BY_ID', 'EQUIP_BY_ID']);
const out = {};
for (const [k, v] of Object.entries(D)) {
  if (typeof v === 'function' || SKIP.has(k)) continue;
  out[k] = v;
}
// RULES.xpTable（関数）は おとす
out.RULES = Object.fromEntries(Object.entries(D.RULES).filter(([, v]) => typeof v !== 'function'));
out._meta = {
  source: 'js/data.js',
  note: 'tools/export-data.mjs で 自動生成。てで へんしゅう しない',
};

const json = JSON.stringify(out, (key, val) => (typeof val === 'function' ? undefined : val), 1);
const dest = join(ROOT, 'godot/data/master.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, json + '\n');
console.log('wrote', dest, (json.length / 1024).toFixed(1) + 'KB', '/ keys:', Object.keys(out).join(', '));
