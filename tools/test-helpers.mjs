/* =========================================================
   tools/test-helpers.mjs — オンライン機能の テストで 共通の 道具
   tools/online-test.mjs・tools/e2e-online.mjs が つかう。
   ========================================================= */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK = join(dirname(fileURLToPath(import.meta.url)), 'mock-ranking-server.mjs');
const LISTEN = /LISTEN (\d+)/;
const START_TIMEOUT_MS = 5000;
const LOOPBACK = '127.0.0.1';
const FULLWIDTH_OFFSET = 0xFEE0;

/** にせ窓口を きどうする → {url, stop}。corsOrigins は ブラウザから つなぐ ページの オリジン（カンマ区切り。空なら CORS なし） */
export function startMock(corsOrigins = '') {
  const child = spawn(process.execPath, [MOCK], { env: { ...process.env, CORS_ALLOW_ORIGINS: corsOrigins }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('にせ窓口が きどう しない: ' + MOCK)), START_TIMEOUT_MS);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('にせ窓口が とまった: ' + code)); });
    child.stdout.on('data', (chunk) => {
      const hit = LISTEN.exec(String(chunk));
      if (!hit) return;
      clearTimeout(timer);
      resolve({ url: `http://${LOOPBACK}:${hit[1]}`, stop: () => child.kill() });
    });
  });
}

/** 半角の 英数字・記号を 全角に する（全角で 打たれた ひきつぎコードの たしかめ用） */
export const toFullWidth = (text) => Array.from(text, (c) => String.fromCodePoint(c.codePointAt(0) + FULLWIDTH_OFFSET)).join('');
