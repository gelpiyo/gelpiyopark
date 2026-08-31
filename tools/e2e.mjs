/* =========================================================
   tools/e2e.mjs — ブラウザ操作の とおしテスト（CDP）
   じっさいに タップして 例外が でないかを しらべる。
   まえもって headless chrome を --remote-debugging-port=9222 で
   きどう しておくこと。

   つかいかた: node tools/e2e.mjs [http://localhost:8123]
   ========================================================= */
const BASE = process.argv[2] || 'http://localhost:8123';

const t = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find((x) => x.type === 'page');
// ブラウザ拡張きのうの メッセージングノイズは ページの エラーではないので むしする
const isNoise = (t) =>
  /Receiving end does not exist|message channel closed before a response/.test(t || '');
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  else if (m.method === 'Runtime.exceptionThrown') {
    const t = m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '';
    if (!isNoise(t)) errs.push('EXC ' + t);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    if (!isNoise(m.params.entry.text)) errs.push('ERR ' + m.params.entry.text);
  }
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    errs.push('EVAL ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return null;
  }
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const steps = [];
const step = async (name, expr, wait = 700) => {
  const before = errs.length;
  const v = await evalJs(expr);
  await sleep(wait);
  steps.push({ name, value: v, newErrors: errs.length - before });
  console.log(`  ${errs.length > before ? 'NG' : 'ok'}  ${name.padEnd(34)} ${JSON.stringify(v)}`);
};

console.log('=== ブラウザ とおしテスト ===');
await send('Page.navigate', { url: BASE + '/?dev=park' });
for (let i = 0; i < 40; i++) {
  await sleep(150);
  if (await evalJs('document.readyState === "complete" && !!window.GP && !!GP.state.st')) break;
}
await sleep(500);

/* ---------- こうえん ---------- */
await step('あきちを タップ', `(()=>{const b=[...document.querySelectorAll('.plot.is-empty')][0];
  if(!b) return 'なし'; b.click(); return document.getElementById('modal-title').textContent;})()`);
await step('ゆうぐを たてる', `(()=>{const b=[...document.querySelectorAll('.build-item:not([disabled])')][0];
  if(!b) return 'なし'; b.click(); return GP.state.st.plots.filter(Boolean).length;})()`);
await step('たてた ゆうぐを タップ', `(()=>{const b=[...document.querySelectorAll('.plot.is-built')][0];
  b.click(); return document.getElementById('modal-title').textContent;})()`);
await step('きょうかする', `(()=>{const b=[...document.querySelectorAll('#modal-foot .btn')].pop();
  if(b.disabled) { GP.ui.closeModal(); return 'コストたりず(想定内)'; } b.click(); return 'Lv up';})()`);

/* ---------- 2Dこうえんビュー ---------- */
await step('2Dビューに ゆうぐが 反映', `(()=>{
  const built=GP.state.st.plots.filter(Boolean).length;
  const r=GP.parkscene.debugRects();
  return (r.length===built?'OK ':'NG ')+r.length+'/'+built+'けん';})()`, 400);
await step('2Dの ゆうぐを タップ→強化画面', `(()=>{
  const cv=document.getElementById('park-canvas');
  const r0=GP.parkscene.debugRects()[0];
  if(!r0) return 'なし';
  const rc=cv.getBoundingClientRect();
  const x=rc.left+(r0.cx/640)*rc.width, y=rc.top+((r0.y-r0.h/3)/300)*rc.height;
  cv.dispatchEvent(new MouseEvent('click',{clientX:x,clientY:y,bubbles:true}));
  const title=document.getElementById('modal-title').textContent;
  GP.ui.closeModal();
  return title||'ひらかず';})()`, 500);

/* ---------- 日を すすめる ---------- */
for (let d = 0; d < 3; d++) {
  await step(`つぎの日へ (${d + 1})`, `(()=>{document.getElementById('btn-nextday').click(); return GP.state.st.day;})()`, 900);
  await step('  けっかを とじる', `(()=>{const b=[...document.querySelectorAll('#modal-foot .btn')][0];
    if(b) b.click(); return GP.state.st.day;})()`, 900);
}

/* ---------- なわばり：区画タップ → しんぐん ---------- */
await step('なわばりタブ', `(()=>{document.querySelector('[data-tab="map"]').click(); return GP.ui.current;})()`);
await step('区画を タップ（canvas）', `(()=>{
  const cv=document.getElementById('map-canvas'), r=cv.getBoundingClientRect();
  // まだ とっていない となりの 区画を えらんで タップする
  const HEX=66,OX=320,OY=306,CW=640,CH=620;
  const id=GP.state.attackableIds()[0];
  const t=GP.state.tileById(id);
  const p=GP.hex.toPixel(t.q,t.r,HEX,OX,OY);
  const x=r.left+(p.x/CW)*r.width, y=r.top+(p.y/CH)*r.height;
  cv.dispatchEvent(new MouseEvent('click',{clientX:x,clientY:y,bubbles:true}));
  return (document.querySelector('#tile-detail h3')?.textContent || 'えらべず')+' / genki='+GP.state.st.genki;})()`);
await step('せめこむ ボタン', `(()=>{const b=[...document.querySelectorAll('#tile-detail .btn')]
  .find(x=>/せめこむ/.test(x.textContent)); if(!b||b.disabled) return 'おせず';
  b.click(); return document.getElementById('modal-title').textContent;})()`);
await step('いくぞー！', `(()=>{const b=[...document.querySelectorAll('#modal-foot .btn')].pop();
  if(!b) return 'なし'; b.click(); return 'start';})()`, 1400);
await step('バトル スキップ', `(()=>{const b=document.getElementById('btn-battle-skip');
  if(document.getElementById('battle-screen').hidden) return 'バトル中でない';
  b.click(); return 'skip';})()`, 3200);
await step('けっかを とじる', `(()=>{const b=[...document.querySelectorAll('#modal-foot .btn')][0];
  if(b) b.click(); return GP.state.shares().player + '区画';})()`, 800);

/* ---------- こうしょう ---------- */
await step('こうしょうを ひらく', `(()=>{GP.worldmap.openDiplomacy('crow');
  return document.getElementById('modal-title').textContent;})()`);
await step('おくりものを する', `(()=>{const b=[...document.querySelectorAll('.build-item:not([disabled])')][0];
  if(!b) return 'かえず'; b.click(); return GP.state.st.factions.crow.fav;})()`);
await step('とじる', `(()=>{GP.ui.closeModal(); return 'closed';})()`);

/* ---------- なかま ---------- */
await step('なかまタブ', `(()=>{document.querySelector('[data-tab="squad"]').click(); return GP.ui.current;})()`);
await step('ぴよ しょうさい', `(()=>{const b=[...document.querySelectorAll('.slot:not(.is-empty)')][0];
  if(!b) return 'なし'; b.click(); return document.getElementById('modal-title').textContent;})()`);
await step('いくせい（かけら）', `(()=>{const b=[...document.querySelectorAll('#modal-body .equip-chip:not([disabled])')]
  .find(x=>/けいけんち/.test(x.textContent)); if(!b) return 'かえず'; b.click(); return 'trained';})()`, 900);
await step('とじる', `(()=>{GP.ui.closeModal(); return 'closed';})()`);
await step('ずかんタブ（かず/上限 表示）', `(()=>{document.querySelector('[data-squadtab="all"]').click();
  const rc=document.getElementById('roster-count').textContent.replace(/\s+/g,' ').trim();
  const ok=new RegExp(GP.state.st.units.length+' / '+GP.state.rosterCap()).test(rc);
  return (ok?'OK ':'NG ')+rc+'（'+document.querySelectorAll('.pcard').length+'枚）';})()`);
await step('さくせん へんこう', `(()=>{const b=[...document.querySelectorAll('.tac')][1];
  document.querySelector('[data-squadtab="team"]').click();
  const t=[...document.querySelectorAll('.tac')][1]; t.click(); return GP.state.st.tactic;})()`);

/* ---------- スカウト ---------- */
await step('スカウトタブ', `(()=>{document.querySelector('[data-tab="gacha"]').click(); return GP.ui.current;})()`);
await step('おさんぽ スカウト', `(()=>{document.getElementById('btn-scout-free').click(); return 'rolling';})()`, 1600);
await step('2択ボタンの かくにん', `(()=>{
  const labels=[...document.querySelectorAll('#modal-foot .btn')].map(b=>b.textContent.trim());
  const ok=labels.some(t=>/にがす/.test(t)) && labels.some(t=>/なかまに する/.test(t));
  return (ok?'OK ':'NG ')+labels.join(' / ');})()`, 300);
await step('なかまに する', `(()=>{const before=GP.state.st.units.length;
  const b=[...document.querySelectorAll('#modal-foot .btn')].find(x=>/なかまに する/.test(x.textContent));
  if(!b) return 'ボタンなし'; b.click();
  return before+'→'+GP.state.st.units.length+'ぴよ';})()`, 700);
await step('ぴよハウスで 上限UP', `(()=>{const st=GP.state.st;
  st.plots[st.plots.findIndex(p=>!p)] = {fac:'house', lv:3};
  st.res.menko += 100; GP.ui.refreshHud();
  return 'なかま上限 ' + GP.state.rosterCap();})()`);
await step('10れん スカウト', `(()=>{const b=document.getElementById('btn-scout10');
  if(b.disabled) return 'メンコたりず'; b.click(); return 'rolling';})()`, 1800);
await step('1体だけ にがすマーク', `(()=>{
  const cells=[...document.querySelectorAll('.result-cell')];
  if(!cells.length) return 'セルなし';
  cells[0].click();
  return cells[0].classList.contains('is-release') ? 'OK マークついた' : 'NG マークつかず';})()`, 300);
await step('ぜんぶ にがす（10れん）', `(()=>{const st=GP.state.st;const u0=st.units.length,k0=st.res.kakera;
  const b=[...document.querySelectorAll('#modal-foot .btn')].find(x=>/にがす/.test(x.textContent));
  if(!b) return 'ボタンなし'; b.click();
  const ok = st.units.length===u0 && st.res.kakera>k0;
  return (ok?'OK ':'NG ')+u0+'ぴよのまま / 🧩'+k0+'→'+st.res.kakera;})()`, 700);

/* ---------- SVG id の 重複チェック（からだが 消えるバグの 再発防止） ----------
   ぴよの からだは fill="url(#bd…)" で <defs> を さんしょうしている。
   おなじ id が 画面に 2つ あると、さきに DOM から けされた ほうを
   見ていた 個体の からだが 消える。id は かならず 全部ちがうこと。 */
await step('こうえんタブ', `(()=>{document.querySelector('[data-tab="park"]').click(); return GP.ui.current;})()`);
await step('SVG id 重複なし（こうえん）', `(()=>{
  const ids=[...document.querySelectorAll('svg.piyo [id]')].map(e=>e.id);
  const c={}; ids.forEach(i=>c[i]=(c[i]||0)+1);
  const dup=Object.entries(c).filter(([k,v])=>v>1);
  return dup.length ? 'NG 重複'+dup.length+'件: '+dup.slice(0,3).map(d=>d[0]+'x'+d[1]) : 'OK '+ids.length+'個すべて一意';})()`);
await step('からだの ぬり参照 きれなし', `(()=>{
  const svgs=[...document.querySelectorAll('svg.piyo')];
  let bad=0;
  svgs.forEach(s=>{
    const b=s.querySelector('path[fill^="url(#bd"]');
    if(!b){bad++;return;}
    const id=b.getAttribute('fill').slice(5,-1);   // "url(#bdg0)" -> "bdg0"
    if(!s.querySelector('#'+CSS.escape(id))) bad++;
  });
  return bad ? 'NG '+bad+'体で 参照ぎれ' : 'OK '+svgs.length+'体すべて解決';})()`);
await step('なかま詳細を ひらいても 一意', `(()=>{
  document.querySelector('[data-tab="squad"]').click();
  GP.squad.openDetail(GP.state.teamUnits()[0]);
  const ids=[...document.querySelectorAll('svg.piyo [id]')].map(e=>e.id);
  const c={}; ids.forEach(i=>c[i]=(c[i]||0)+1);
  const dup=Object.entries(c).filter(([k,v])=>v>1);
  GP.ui.closeModal();
  return dup.length ? 'NG 重複'+dup.length+'件' : 'OK '+ids.length+'個すべて一意';})()`);

/* ---------- メニュー・セーブ ---------- */
await step('メニュー', `(()=>{document.getElementById('btn-menu').click();
  return document.getElementById('modal-title').textContent;})()`);
await step('とじる', `(()=>{GP.ui.closeModal(); return 'closed';})()`);
await step('セーブ／ロード', `(()=>{GP.state.persist();
  const raw=localStorage.getItem('gelpiyo-park-save-v1');
  const before=GP.state.st.day;
  const ok=!!GP.state.restore();
  return ok && GP.state.st.day===before ? 'OK ('+raw.length+' bytes)' : 'NG';})()`);

console.log('\n--- けっか ---');
const bad = steps.filter((s) => s.newErrors > 0);
console.log('  ステップ数 :', steps.length);
console.log('  エラー     :', errs.length);
if (errs.length) errs.slice(0, 12).forEach((e) => console.log('   ', e.slice(0, 220)));
else console.log('  例外なし ✓');
ws.close();
process.exit(errs.length ? 1 : 0);
