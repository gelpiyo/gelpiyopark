/* =========================================================
   tools/build.mjs — 1ファイル版を つくる

   dist/gelpiyo-park.html … そのまま ひらける スタンドアロンHTML
                            （USB・メール添付・社内共有 などに）
   dist/artifact.html     … Artifact 用（<html>/<head>/<body> なし）

   つかいかた: node tools/build.mjs
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const JS = [
  'js/util.js', 'js/data.js', 'js/piyodata.js', 'js/piyo.js', 'js/hex.js', 'js/state.js',
  'js/ui.js', 'js/parkscene.js', 'js/park.js', 'js/squad.js', 'js/gacha.js',
  'js/battle.js', 'js/worldmap.js', 'js/main.js',
];

const html = read('index.html');
const css = read('css/style.css');
const script = JS.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join('\n');

// index.html の <body> の なかみ だけ とりだす
const bodyInner = html
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/\s*<script src="js\/[^"]+"><\/script>/g, '')
  .trim();

const inlined = `<style>\n${css}\n</style>\n${bodyInner}\n<script>\n${script}\n</script>`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });

/* ---------- スタンドアロン ---------- */
const head = html
  .replace(/^[\s\S]*?<head>/, '')
  .replace(/<\/head>[\s\S]*$/, '')
  .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
  .replace(/\s*<link rel="manifest"[^>]*>/g, '')
  .trim();

const standalone = `<!DOCTYPE html>
<html lang="ja">
<head>
${head}
<style>
${css}
</style>
</head>
<body>
${bodyInner}
<script>
${script}
</script>
</body>
</html>
`;
writeFileSync(join(ROOT, 'dist/gelpiyo-park.html'), standalone);

/* ---------- Artifact 用（body のなかみ のみ） ---------- */
writeFileSync(join(ROOT, 'dist/artifact.html'),
  `<title>ゲルぴよ公園大作戦</title>\n${inlined}\n`);

const kb = (s) => Math.round(s.length / 1024) + ' KB';
console.log('dist/gelpiyo-park.html :', kb(standalone), '（スタンドアロン）');
console.log('dist/artifact.html     :', kb(inlined), '（Artifact用）');
console.log('  内訳: CSS', kb(css), '/ JS', kb(script), '/ HTML', kb(bodyInner));
