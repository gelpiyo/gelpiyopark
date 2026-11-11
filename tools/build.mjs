/* =========================================================
   tools/build.mjs — 1ファイル版を つくる

   dist/gelpiyo-park.html … そのまま ひらける スタンドアロンHTML
                            （USB・メール添付・社内共有 などに。窓口の 接続先 入り）
   dist/artifact.html     … Artifact 用（<html>/<head>/<body> なし。接続先 なし）

   つかいかた: node tools/build.mjs
   ========================================================= */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const NET_CONFIG = 'js/netconfig.js';
// Artifact は 外への 通信を 止められて いて 失敗の 窓しか 出せないので、接続先を 入れない
const OFFLINE_NET_CONFIG = "window.GP = window.GP || {};\nGP.netConfig = Object.freeze({ baseUrl: '', board: '' });\n";

const JS = [
  'js/util.js', 'js/data.js', NET_CONFIG, 'js/icons.js', 'js/piyodata.js', 'js/piyo.js', 'js/hex.js', 'js/state.js',
  'js/ui.js', 'js/parkscene.js', 'js/park.js', 'js/squad.js', 'js/gacha.js',
  'js/battle.js', 'js/worldmap.js', 'js/net.js', 'js/backup.js', 'js/online.js', 'js/main.js',
];
const scriptWith = (netConfig) => JS.map((f) => `/* ===== ${f} ===== */\n${f === NET_CONFIG ? netConfig : read(f)}`).join('\n');
const onlineScript = scriptWith(read(NET_CONFIG));
const offlineScript = scriptWith(OFFLINE_NET_CONFIG);

const html = read('index.html');
const css = read('css/style.css');

// index.html の <body> の なかみ だけ とりだす
const bodyInner = html
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/\s*<script src="js\/[^"]+"><\/script>/g, '')
  .trim();

const inlined = `<style>\n${css}\n</style>\n${bodyInner}\n<script>\n${offlineScript}\n</script>`;

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
${onlineScript}
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
console.log('  内訳: CSS', kb(css), '/ JS', kb(onlineScript), '/ HTML', kb(bodyInner));
