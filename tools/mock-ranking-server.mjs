/* =========================================================
   tools/mock-ranking-server.mjs — テスト用の にせ窓口（αTEST の Cloud Run と同じ入口・項目名・断りの名前）
   本物の窓口に テストの記録を 書かない ための もの（手引き「自動の検査の結果を本番の記録に書かない」）。
   形は 窓口のソース（gelpiyo-api の src/app.js）に そろえた。データは メモリだけ（ディスクに書かない）。

   つかいかた: node tools/mock-ranking-server.mjs   → 「LISTEN <port>」を出して待つ
   テスト専用: GET /_test/state で 受けた結果・名前・セーブの ひかえ・引き継ぎの 試しの回数を 見られる
   ========================================================= */
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';

const BOARD = { board: 'gc01_gelpiyopark', game: 'gelpiyopark', minSec: 3, maxSec: 1800, maxValue: 5000000, graceSec: 600 };
const MS_PER_SEC = 1000;
const NAME_MAX = 20;
const KEY_BYTES = 32;
const ID_BYTES = 10;
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 12;
const CODE_GROUP = 4;
const SAVE_MAX = 512 * 1024;
const RECOVER_LIMIT = 10;

const players = new Map();   // playerId -> { playerId, name, code }
const devices = new Map();   // deviceKey -> playerId
const codes = new Map();     // コード（区切りなし）-> playerId
const saves = new Map();     // playerId -> { data, appVersion, savedAt, updatedAt, size, puts }
const runs = new Map();      // runId -> { playerId, startedMs, closed }
const entries = new Map();   // playerId -> { best, attempts, clears }
const finishes = [];
let recoverTries = 0;

class ApiError extends Error {
  constructor(status, code, message = code) { super(message); this.status = status; this.code = code; }
}

const token = (n) => randomBytes(n).toString('base64url');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const newCode = () => Array.from({ length: CODE_LEN }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const formatCode = (c) => c.match(new RegExp(`.{${CODE_GROUP}}`, 'g')).join('-');

function cleanName(v) {
  const n = String(v ?? '').trim();
  if ([...n].length < 1 || [...n].length > NAME_MAX) throw new ApiError(400, 'bad_name', `名前は 1〜${NAME_MAX} 文字`);
  return n;
}

function auth(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
  if (!m) throw new ApiError(401, 'no_key');
  const pid = devices.get(m[1]);
  if (!pid) throw new ApiError(401, 'bad_key');
  return players.get(pid);
}

function newDevice(pid) {
  const deviceKey = token(KEY_BYTES);
  devices.set(deviceKey, pid);
  return deviceKey;
}

function register(body) {
  const p = { playerId: 'p' + token(ID_BYTES), name: cleanName(body.name), code: newCode() };
  players.set(p.playerId, p);
  codes.set(p.code, p.playerId);
  return [201, { playerId: p.playerId, name: p.name, deviceKey: newDevice(p.playerId), recoveryCode: formatCode(p.code) }];
}

function reissue(p) {
  codes.delete(p.code);
  p.code = newCode();
  codes.set(p.code, p.playerId);
  return [200, { recoveryCode: formatCode(p.code) }];
}

const saveOut = (s) => ({ data: s.data, appVersion: s.appVersion, savedAt: s.savedAt, updatedAt: s.updatedAt, size: s.size });

function recover(body) {
  if (recoverTries >= RECOVER_LIMIT) throw new ApiError(429, 'too_many', 'しばらく待ってからもう一度');
  recoverTries += 1;
  const code = normCode(body.code);
  if (code.length !== CODE_LEN) throw new ApiError(400, 'bad_code');
  const pid = codes.get(code);
  if (!pid) throw new ApiError(404, 'code_not_found');
  [...devices].filter(([, owner]) => owner === pid).forEach(([key]) => devices.delete(key));
  const s = saves.get(pid);
  return [200, { playerId: pid, name: players.get(pid).name, deviceKey: newDevice(pid), save: s ? saveOut(s) : null }];
}

function putSave(p, body) {
  if (typeof body.data !== 'string') throw new ApiError(400, 'bad_data', 'data は JSON の文字列');
  const size = Buffer.byteLength(body.data, 'utf8');
  if (size > SAVE_MAX) throw new ApiError(413, 'too_large');
  try { JSON.parse(body.data); } catch { throw new ApiError(400, 'bad_data', 'data が JSON として読めない'); }
  const updatedAt = new Date().toISOString();
  const puts = (saves.get(p.playerId)?.puts || 0) + 1;
  saves.set(p.playerId, { data: body.data, appVersion: String(body.appVersion ?? ''), savedAt: String(body.savedAt ?? ''), updatedAt, size, puts });
  return [200, { ok: true, size, updatedAt }];
}

function startRun(p, board) {
  if (board !== BOARD.board) throw new ApiError(404, 'no_board');
  const e = entries.get(p.playerId) || { best: null, attempts: 0, clears: 0 };
  e.attempts += 1;
  entries.set(p.playerId, e);
  const runId = 'r' + token(ID_BYTES);
  runs.set(runId, { playerId: p.playerId, startedMs: Date.now(), closed: false });
  return [201, { runId, startedAt: new Date().toISOString(), attempts: e.attempts }];
}

function finishRun(p, board, runId, body) {
  if (!Number.isInteger(body.value) || body.value < 0) throw new ApiError(400, 'bad_value');
  const run = runs.get(runId);
  if (board !== BOARD.board) throw new ApiError(404, 'no_board');
  if (!run || run.playerId !== p.playerId) throw new ApiError(404, 'no_run');
  if (run.closed) throw new ApiError(409, 'already_done');
  if (Date.now() - run.startedMs < BOARD.minSec * MS_PER_SEC) throw new ApiError(409, 'too_short');
  if (body.value > BOARD.maxValue) throw new ApiError(409, 'too_high');
  run.closed = true;
  finishes.push({ playerId: p.playerId, name: p.name, elapsedMs: Date.now() - run.startedMs, body });
  return [200, recordEntry(p, body)];
}

function recordEntry(p, body) {
  const e = entries.get(p.playerId);
  const improved = body.cleared === true && (e.best === null || body.value > e.best);
  if (body.cleared === true) e.clears += 1;
  if (improved) e.best = body.value;
  const bests = [...entries.values()].filter((x) => x.best !== null).map((x) => x.best);
  const rank = e.best === null ? null : bests.filter((b) => b > e.best).length + 1;
  return { accepted: true, improved, best: e.best, attempts: e.attempts, clears: e.clears, rank, participants: bests.length };
}

function testState() {
  const savesOut = Object.fromEntries([...saves].map(([pid, s]) => [pid, { puts: s.puts, size: s.size, data: s.data }]));
  return { finishes, names: [...players.values()].map((p) => p.name), saves: savesOut, recoverTries };
}

// [メソッド, 入口, 鍵が要るか, 処理]
const routes = [
  ['POST', /^\/v1\/players$/, false, ({ body }) => register(body)],
  ['GET', /^\/v1\/me$/, true, ({ p }) => [200, { playerId: p.playerId, name: p.name }]],
  ['PATCH', /^\/v1\/me$/, true, ({ p, body }) => { p.name = cleanName(body.name); return [200, { playerId: p.playerId, name: p.name }]; }],
  ['POST', /^\/v1\/me\/code$/, true, ({ p }) => reissue(p)],
  ['POST', /^\/v1\/recover$/, false, ({ body }) => recover(body)],
  ['GET', /^\/v1\/save$/, true, ({ p }) => [200, saves.has(p.playerId) ? { exists: true, ...saveOut(saves.get(p.playerId)) } : { exists: false }]],
  ['PUT', /^\/v1\/save$/, true, ({ p, body }) => putSave(p, body)],
  ['GET', /^\/v1\/challenge\/events$/, false, () => [200, { events: [{ id: 'gc01', name: 'テスト', active: true, boards: [BOARD] }] }]],
  ['POST', /^\/v1\/challenge\/([\w-]+)\/runs$/, true, ({ p, m }) => startRun(p, m[1])],
  ['POST', /^\/v1\/challenge\/([\w-]+)\/runs\/([\w-]+)\/finish$/, true, ({ p, m, body }) => finishRun(p, m[1], m[2], body)],
  ['GET', /^\/_test\/state$/, false, () => [200, testState()]],
];

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'bad_json'); }
}

async function route(req) {
  const url = new URL(req.url, 'http://localhost');
  const hit = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
  if (!hit) throw new ApiError(404, 'not_found');
  const [, re, needAuth, fn] = hit;
  const body = req.method === 'GET' ? {} : await readJson(req);
  const p = needAuth ? auth(req) : null;
  return fn({ body, p, m: url.pathname.match(re) });
}

const server = createServer(async (req, res) => {
  let status;
  let out;
  try {
    [status, out] = await route(req);
  } catch (e) {
    [status, out] = e instanceof ApiError ? [e.status, { error: e.code, message: e.message }] : [500, { error: 'mock_error', message: `${req.method} ${req.url}: ${e.message}` }];
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out));
});
server.listen(0, '127.0.0.1', () => console.log(`LISTEN ${server.address().port}`));
