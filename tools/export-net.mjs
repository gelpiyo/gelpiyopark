/* =========================================================
   tools/export-net.mjs — 窓口の 接続先を Web版に うつす

   Godot版の godot/data/ranking.json を「ただ ひとつの もと」に して、
   Web版が よむ js/netconfig.js を かきだす（接続先を 2 か所に 書かない）。

   つかいかた: node tools/export-net.mjs          … js/netconfig.js を かく
               node tools/export-net.mjs --check  … かかずに 見くらべる（ずれて いれば 終了コード 1）
   ========================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'godot/data/ranking.json';
const DEST = 'js/netconfig.js';
const URL_PREFIX = 'https://';
const URL_TEXT = /^[\w.:/~%-]+$/;
const BOARD_NAME = /^[\w-]+$/;
const EXIT_STALE = 1;
const EXIT_FAILED = 1;

function readConfig() {
  try {
    return JSON.parse(readFileSync(join(ROOT, SRC), 'utf8'));
  } catch (e) {
    throw new Error(`${SRC} を よめない（${e.code || e.name}）`);
  }
}

// 値は 出さない（公開の ログに 窓口の URL を のこさない）
function assertBaseUrl(url) {
  const ok = typeof url === 'string' && url.startsWith(URL_PREFIX) && url.length > URL_PREFIX.length
    && !url.endsWith('/') && URL_TEXT.test(url);
  if (!ok) throw new Error(`${SRC} の baseUrl は ${URL_PREFIX} で はじまり、さいごに / を つけない（つかえる 文字は 英数字と . : / ~ % - _）`);
}

function assertBoard(board) {
  if (typeof board !== 'string' || !BOARD_NAME.test(board)) throw new Error(`${SRC} の board は 英数字・_・- だけ`);
}

function render({ baseUrl, board }) {
  assertBaseUrl(baseUrl);
  assertBoard(board);
  return [
    `/* js/netconfig.js — ${SRC} から tools/export-net.mjs で 自動生成。てで へんしゅう しない */`,
    'window.GP = window.GP || {};',
    `GP.netConfig = Object.freeze({ baseUrl: '${baseUrl}', board: '${board}' });`,
    '',
  ].join('\n');
}

// git の 改行変換（autocrlf）で ずれた あつかいに しない
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function check(text) {
  const dest = join(ROOT, DEST);
  if (existsSync(dest) && sameText(readFileSync(dest, 'utf8'), text)) {
    console.log(`ok  ${DEST} は ${SRC} と そろって います`);
    return;
  }
  console.error(`NG  ${DEST} が ${SRC} と ずれて います → node tools/export-net.mjs`);
  process.exitCode = EXIT_STALE;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  // godot/ は 追跡外なので、無い 環境では 見くらべる ものが ない
  if (checkOnly && !existsSync(join(ROOT, SRC))) {
    console.log(`skip  ${SRC} が ないので 見くらべません`);
    return;
  }
  const text = render(readConfig());
  if (checkOnly) return check(text);
  writeFileSync(join(ROOT, DEST), text);
  console.log('wrote', DEST);
}

// 設定が おかしい ときは 理由だけを 出す（スタックトレースで うめない）
try {
  main();
} catch (e) {
  console.error('NG  ' + e.message);
  process.exitCode = EXIT_FAILED;
}
