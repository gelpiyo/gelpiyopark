/* =========================================================
   tools/godot-check.mjs — Godot版の けんしょうを まとめて じっこう

   1) js/data.js → godot/data/master.json（マスタの かきだし）
   2) Web版の ロジックで せいかい データ（godot/tests/golden.json）を つくる
   3) Godot（ヘッドレス）で テストを じっこう
        parity_test  … Web版と 13万こうもく 一致するか
        actions_test … プレイヤーの こうどう（建設・育成・スカウト・がいこう…）
        art_test     … ぴよ SVG 427とおりが Web版と 一致・アイコンも ぜんぶ 画像に できるか・3Dモデルも 一致
        ui_scroll_test … スマホの スライドで ダイアログ・画面が スクロールするか（ボタンの うえからでも）
        history_test … せいせき（けっちゃくの 記録）の 保存・5件まで・二重記録なし
        ranking_test … ランキング送信の流れ（にせ窓口 tools/mock-ranking-server.mjs を 毎回 まっさらで 起動）
        account_test … ひきつぎコードの 出し直し・べつの 端末への 引き継ぎ・セーブの ひかえの 送受信（にせ窓口）
        bot_test     … 自動プレイ 12ゲームが Web版と 一致＋ランダム N ゲーム

   Web版の js/ を かえたら これを まわす。
   つかいかた: node tools/godot-check.mjs [ランダムゲーム数=20]
   Godot の 場所は 環境変数 GODOT で かえられる（きほん ~/.local/bin/godot_console.exe）
   ========================================================= */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = process.env.GODOT || join(homedir(), '.local/bin/godot_console.exe');
const N = process.argv[2] || '20';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const clean = (s) => s.split('\n')
  .filter((l) => l.trim() && !/^Godot Engine|godot_ai|^\s*$/.test(l)).join('\n');

let ok = true;
for (const t of ['tools/export-data.mjs', 'tools/export-art.mjs', 'tools/golden.mjs']) {
  const r = run(process.execPath, [t]);
  console.log(r.out.trim());
  if (r.code !== 0) { console.log('✗ ' + t + ' が しっぱい'); process.exit(1); }
}

if (!existsSync(GODOT)) {
  console.log(`✗ Godot が みつからない: ${GODOT}（環境変数 GODOT で してい できます）`);
  process.exit(1);
}
const gd = join(ROOT, 'godot');
run(GODOT, ['--headless', '--path', gd, '--import']);     // クラス名の とうろく
for (const [script, extra] of [['parity_test', []], ['actions_test', []], ['art_test', []], ['ui_scroll_test', []], ['history_test', []], ['bot_test', ['--', N]]]) {
  console.log(`\n##### ${script} #####`);
  const r = run(GODOT, ['--headless', '--path', gd, '--script', `res://tests/${script}.gd`, ...extra],
    { timeout: 600000 });
  console.log(clean(r.out));
  if (r.code !== 0 || /SCRIPT ERROR|Parse Error/.test(r.out)) ok = false;
}
// 本物の窓口に テストの記録を 書かない ため、にせ窓口を テストごとに まっさらで 起動する
async function startMock() {
  const mock = spawn(process.execPath, [join(ROOT, 'tools/mock-ranking-server.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    mock.stdout.on('data', (d) => { const m = /LISTEN (\d+)/.exec(String(d)); if (m) resolve(m[1]); });
    mock.on('exit', (code) => reject(new Error('mock-ranking-server が とまった: ' + code)));
  });
  return { mock, url: `http://127.0.0.1:${port}` };
}

for (const script of ['ranking_test', 'account_test']) {
  console.log(`\n##### ${script} #####`);
  const { mock, url } = await startMock();
  try {
    const r = run(GODOT, ['--headless', '--path', gd, '--script', `res://tests/${script}.gd`, '--', '--base=' + url], { timeout: 600000 });
    console.log(clean(r.out));
    if (r.code !== 0 || /SCRIPT ERROR|Parse Error/.test(r.out)) ok = false;
  } finally {
    mock.kill();
  }
}
console.log('\n' + (ok ? '✓ Godot版の けんしょう：すべて OK' : '✗ Godot版の けんしょう：NG あり'));
process.exit(ok ? 0 : 1);
