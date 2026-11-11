/* =========================================================
   tools/ios-export.mjs — iPhone 用の Xcode プロジェクトを かきだす

   1) Web版の データ・絵を Godot 用に かきだす（export-data / export-art）
   2) アイコン・起動画面の 絵を つくる（godot/tools/make_ios_assets.gd）
   3) Godot を ヘッドレスで うごかし、書き出し設定「iOS」で godot/export/ios/ へ
   4) できた プロジェクトの 中身（バンドルID・名前・バージョン・同梱データ）を かくにん

   Windows では .ipa は つくれない（Xcode プロジェクトだけ）。
   フォルダ godot/export/ios/ を Mac に うつして gelpiyopark.xcodeproj を Xcode で ひらく。
   Team ID は 書き出し設定では 仮（XXXXXXXXXX）。Xcode の Signing & Capabilities で チームを えらぶ。

   つかいかた: node tools/ios-export.mjs
   Godot の 場所を かえるときは 環境変数 GODOT に godot_console.exe の パスを いれる。
   ========================================================= */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GD = join(ROOT, 'godot');
const OUT = join(GD, 'export/ios');
const GODOT = process.env.GODOT || join(homedir(), '.local/bin/godot_console.exe');

function run(label, cmd, args, opts = {}) {
  process.stdout.write(`--- ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || '');
  const errs = out.split('\n').filter((l) => /^ERROR|SCRIPT ERROR|Parse Error/.test(l));
  if (r.status !== 0 || errs.length) {
    console.error(out.split('\n').slice(-30).join('\n'));
    throw new Error(`${label} で しっぱい（exit ${r.status}）`);
  }
  return out;
}

if (!existsSync(GODOT)) throw new Error(`Godot が みつからない: ${GODOT}（環境変数 GODOT で しってい）`);
mkdirSync(OUT, { recursive: true });
const gdignore = join(GD, 'export/.gdignore');           // 書き出し先を Godot に よみこませない
if (!existsSync(gdignore)) writeFileSync(gdignore, '');

run('Web版の データ → Godot', 'node', ['tools/export-data.mjs']);
run('Web版の 絵 → Godot', 'node', ['tools/export-art.mjs']);
run('アイコン・起動画面', GODOT, ['--headless', '--path', GD, '--script', 'res://tools/make_ios_assets.gd']);
run('インポート', GODOT, ['--headless', '--path', GD, '--import']);
const log = run('iOS 書き出し', GODOT, ['--headless', '--path', GD, '--export-release', 'iOS', 'export/ios/gelpiyopark.ipa']);
log.split('\n').filter((l) => /^WARNING/.test(l)).forEach((l) => console.log('  ' + l.trim()));

/* ---------- かくにん ---------- */
const pbx = readFileSync(join(OUT, 'gelpiyopark.xcodeproj/project.pbxproj'), 'utf8');
const plist = readFileSync(join(OUT, 'gelpiyopark/gelpiyopark-Info.plist'), 'utf8');
const pck = readFileSync(join(OUT, 'gelpiyopark.pck'));
const setting = (k) => (pbx.match(new RegExp(`${k} = "?([^";]+)"?;`)) || [])[1];
const has = (s) => pck.includes(Buffer.from(s));
const checks = [
  ['バンドルID', setting('PRODUCT_BUNDLE_IDENTIFIER')],
  ['ホーム画面の 名前', setting('INFOPLIST_KEY_CFBundleDisplayName')],
  ['バージョン', `${setting('MARKETING_VERSION')}（ビルド ${setting('CURRENT_PROJECT_VERSION')}）`],
  ['Team（仮）', setting('DEVELOPMENT_TEAM')],
  ['対応端末', setting('TARGETED_DEVICE_FAMILY') === '1' ? 'iPhone のみ' : setting('TARGETED_DEVICE_FAMILY')],
  ['最小 iOS', setting('IPHONEOS_DEPLOYMENT_TARGET')],
  ['暗号の 申告', /ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist) ? 'なし（申告不要）' : '× 未設定'],
  ['同梱データ', ['data/master.json', 'data/icons.json', 'data/piyo_mesh.json'].every(has) ? 'master / icons / piyo_mesh' : '× たりない'],
  ['テストの のぞき', ['tests/golden.json', 'tools/make_ios_assets'].some(has) ? '× まざっている' : 'OK'],
];
console.log('\n=== できた Xcode プロジェクト: godot/export/ios/gelpiyopark.xcodeproj ===');
for (const [k, v] of checks) console.log(`  ${k.padEnd(10, '　')} ${v}`);
const bad = checks.filter(([, v]) => !v || String(v).startsWith('×'));
if (bad.length) { console.error('✗ かくにんで NG'); process.exit(1); }
console.log('✓ OK — godot/export/ios/ を Mac に うつして Xcode で ひらいてください');
