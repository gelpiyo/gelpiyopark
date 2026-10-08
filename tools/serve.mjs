/* =========================================================
   tools/serve.mjs — かるい しずてき サーバ（node だけで うごく）

   python が ない かんきょうでも かくにん できる ように。
   つかいかた: node tools/serve.mjs [ポート] [lan]
     ポート … きほん 8123
     lan   … つけると LAN（0.0.0.0）にも こうかい。スマホ実機で ためす とき
   ========================================================= */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = +(process.argv[2] || 8123);
const HOST = process.argv.includes("lan") ? "0.0.0.0" : "127.0.0.1";
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let p = normalize(join(ROOT, url));
    const rel = relative(ROOT, p);                 // ROOT の そとは ださない
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('out of root');
    if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
    const buf = await readFile(p);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}).listen(PORT, HOST, () => {
  console.log('serving', ROOT);
  console.log('→ http://127.0.0.1:' + PORT + '/', HOST === '0.0.0.0' ? '（LAN にも こうかい中）' : '');
});
