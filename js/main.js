/* =========================================================
   main.js — きどう / タイトル / メニュー / エンディング
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';
  const U = GP.util;
  const D = GP.data;
  const St = GP.state;
  const UI = GP.ui;
  const { $, el } = U;

  /* =========================================================
     タイトル
     ========================================================= */
  function renderTitlePiyos() {
    const box = $('#title-piyos');
    box.innerHTML = '';
    [
      { hue: 2, sat: 76, lit: 54, acc: ['crown'], mood: 'happy' },
      { hue: 47, sat: 90, lit: 60, acc: [], mood: 'happy' },
      { hue: 130, sat: 55, lit: 52, acc: ['gun'], mood: 'happy' },
    ].forEach((o, i) => {
      if (i === 1) {
        // まんなかは 実機3Dモデル（まわる）。だめなら SVG に フォールバック
        const v3 = GP.piyo.view3d(o, { size: 108, drag: false });
        if (v3) {
          v3.style.animation = 'hop 1.6s ease-in-out .25s infinite';
          box.appendChild(v3);
          return;
        }
      }
      const d = el('div', { html: GP.piyo.svg(o) });
      box.appendChild(d.firstElementChild);
    });
  }

  function showTitle() {
    $('#title-screen').hidden = false;
    $('#app').hidden = true;
    $('#btn-continue').hidden = !U.hasSave();
    $('#btn-account').hidden = !GP.net.enabled();
    renderTitlePiyos();
  }

  // ひきつぎで この端末の データが おきかわったら タイトルへ（「つづきから」で うけとった セーブを ひらく）
  function showAccount() {
    GP.online.openAccount(showTitle);
  }

  function enterGame(fresh) {
    $('#title-screen').hidden = true;
    $('#app').hidden = false;
    UI.tab('park');
    UI.refreshHud();
    if (fresh) {
      setTimeout(showHowTo, 260);
    } else {
      // るすばん生産 → かくてい前スカウトの ふくげん → エンディング の じゅんに 1つずつ
      const endingIfNeeded = () => { if (St.st.ended) setTimeout(showEnding, 200); };
      const resumeScout = () => { GP.gacha.resumePending(endingIfNeeded); };
      const off = St.applyOffline();
      UI.refreshHud();
      UI.rerender();
      if (off) showOffline(off, resumeScout);
      else resumeScout();
    }
    St.persist();
  }

  function startNew() {
    const go = () => { St.newGame(); enterGame(true); };
    if (U.hasSave()) {
      UI.modal({
        title: 'あたらしく はじめる？',
        body: el('p', { class: 'hint', text: 'いまの セーブデータは きえてしまいます。よろしいですか？' }),
        buttons: [
          { label: 'やめる', cls: 'btn-ghost' },
          { label: 'はじめる', cls: 'btn-danger', onClick: go },
        ],
      });
    } else go();
  }

  /* =========================================================
     るすばん せいさん
     ========================================================= */
  function showOffline(off, after) {
    const row = el('div', { class: 'cost-row' });
    D.RES_ORDER.forEach((k) => {
      if (!off.gained[k]) return;
      row.appendChild(el('span', { class: 'cost', html: GP.icons.res(k) + ' +' + off.gained[k] }));
    });
    if (!row.children.length && !off.days) { if (after) after(); return; }
    const h = off.hours;
    const txt = h >= 1 ? Math.floor(h) + '時間' + Math.round((h % 1) * 60) + 'ふん' : Math.round(h * 60) + 'ふん';
    const body = el('div');
    body.appendChild(el('p', {
      class: 'hint',
      text: `るすの あいだ（${off.days ? txt + '＋α' : txt}）に ゲルぴよたちが あつめて くれました。`,
    }));
    if (row.children.length) body.appendChild(row);
    if (off.days) {
      body.appendChild(el('div', { class: 'panel', style: 'background:#FFF3D0;margin-bottom:0' }, [
        el('div', { class: 'panel-title', html: UI.rich(`:calendar: ながい るすで 日づけが ${off.days}日 すすんだ`) }),
        el('p', {
          class: 'hint', style: 'margin:0;color:#4A3A2C;font-size:13px',
          text: `DAY ${off.dayFrom} → DAY ${off.dayTo}。まいにちの しゅうかくは うけとりずみ。` +
            'ライバルたちも うごいたみたい（こうえん日記を チェック）。',
        }),
      ]));
      if (off.revoked) {
        body.appendChild(el('div', { class: 'panel', style: 'background:#FFECE8;margin-bottom:0' }, [
          el('div', { class: 'panel-title', html: UI.rich(':shock: しょうりが くつがえった！') }),
          el('p', {
            class: 'hint', style: 'margin:0;color:#4A3A2C;font-size:13px',
            text: 'ぜんぶの 区画を せいあつ して いたのに、るす中に とりかえされて しまいました。'
              + 'もう一度 ぜんぶ とりもどそう！',
          }),
        ]));
      }
      const stolen = off.stolen || [];
      if (stolen.length) {
        const names = stolen.slice(0, 3)
          .map((x) => `「${x.name}」→ ${D.FACTIONS[x.fac].name}${x.revived ? '（ふっかつ！）' : ''}`)
          .join('、');
        body.appendChild(el('div', { class: 'panel', style: 'background:#FFECE8;margin-bottom:0' }, [
          el('div', { class: 'panel-title', html: UI.rich(`:warn: るす中に 区画を ${stolen.length}こ のっとられた！`) }),
          el('p', {
            class: 'hint', style: 'margin:0;color:#4A3A2C;font-size:13px',
            text: names + (stolen.length > 3 ? ' など。' : '。') +
              ' まもりの よわい マスから ねらわれます。とりかえそう！',
          }),
        ]));
      }
    }
    UI.modal({
      title: ':house: おかえりなさい！',
      body,
      buttons: [{ label: 'うけとる', cls: 'btn-accent' }],
      onClose: () => {
        UI.refreshHud(); UI.rerender();
        if (after) setTimeout(after, 120);
      },
    });
  }

  /* =========================================================
     あそびかた
     ========================================================= */
  function showHowTo() {
    const body = el('div');
    const sec = (t, items) => {
      body.appendChild(el('h3', { class: 'panel-title', style: 'margin-top:10px', html: UI.rich(t) }));
      const ul = el('ul', { class: 'log-list' });
      items.forEach((x) => ul.appendChild(el('li', {}, [
        el('span', { class: 'log-day', text: '・' }), el('span', { class: 'log-txt', html: UI.rich(x) }),
      ])));
      body.appendChild(ul);
    };
    body.appendChild(el('p', {
      class: 'hint',
      text: 'ゲルぴよ団の リーダーに なって、こうえんを そだてながら ライバルと なわばりを あらそう シミュレーションです。',
    }));
    sec(':tabPark: こうえん（ないせい）', [
      'あきちを タップして ゆうぐを たてる。ゆうぐが ざいりょうを うみ、ごきげん度も あがる。',
      'ごきげん度が たかいほど せいさんも せんとうりょくも アップ。ひくいと だだっこストライキ！',
      '「つぎの日へ」で しゅうかく＋ライバルの こうどう。1日 1回 すすむ。',
      'ブラウザを とじても るすばん せいさんが たまります（さいだい 8時間ぶん）。8時間を こえると 8時間ごとに 日づけが 1日 すすみ、まもりの いちばん よわい 区画を 区画が いちばん すくない 勢力に 1日 1こ のっとられます（ぜんめつした 勢力は ここで ふっかつ／さいごの 1マスは あんぜん）。',
    ]);
    sec(':tabMap: なわばり', [
      'じぶんの 区画の となりを タップ → 「せめこむ」で バトル。げんき :genki:を 1 つかう。',
      'かてば 区画を せいあつ。ざいりょう・けいけんち・そうびが てにはいる。',
      'ライバルには 「こうしょう」で おやつを おくって なかよく なれる。お約束（不可侵）や 区画の じょうと も。',
      'まけると 区画を とられて ごきげん度も さがる。まもりを かためて そなえよう。',
    ]);
    sec(':tabSquad: なかま・スカウト', [
      'やくわりの あいしょう：そっこう → えんきょり → ぼうぎょ → そっこう（3すくみ）。',
      'さくせん（とつげき／まもり／とりかこみ）で バトルの うごきが かわる。',
      'スカウトで なかまを あつめ、そうび と かけら :kakera:で そだてる。Lv5・12・20 で しんか！',
    ]);
    sec(':trophy: しょうり じょうけん', [
      'すべての 区画を せいあつ すれば しょうり。',
      // あそびかたは タイトルからも ひらくので、ゲーム中は いまの リミットを だす
      (St.st
        ? `DAY ${St.dayLimitNow()} までに いちばん おおくの 区画を もっていても しょうり`
          + (St.st.dayBonus ? `（きほん ${D.RULES.dayLimit}日 ＋ ぜんめつ ボーナス ${St.st.dayBonus}日）。` : '。')
        : `DAY ${D.RULES.dayLimit} までに いちばん おおくの 区画を もっていても しょうり。`),
      `あかぴよ団・カラス組・ネコ軍団の どれかを じぶんで ぜんめつ させる ごとに タイムリミットが +${D.RULES.wipeBonus}日！`,
      `ながい るすの あいだに あいては ふっかつ する。たおしなおすと +${D.RULES.wipeBonusAgain}日（ぜん制圧の かちも とりかえされると くつがえる）。`,
      'ぜんぶ とられると まけ。',
    ]);
    UI.modal({ title: 'あそびかた', body, buttons: [{ label: 'わかった！', cls: 'btn-primary' }] });
  }

  /* =========================================================
     メニュー
     ========================================================= */
  function showMenu() {
    const st = St.st;
    const body = el('div');
    const s = st.stats;
    const sh = St.shares();
    [
      ['いま の 日づけ', 'DAY ' + st.day + ' / ' + St.dayLimitNow()
        + (st.overtime ? '（えんちょうせん）'
          : st.dayBonus ? '（ぜんめつ ボーナス +' + st.dayBonus + '日）' : '')],
      ['なわばり', sh.player + ' / ' + D.TILES.length + ' 区画'],
      ['なかま', st.units.length + ' ぴよ'],
      ['バトル', s.battles + ' かい（' + s.wins + ' しょう）'],
      ['たてた ゆうぐ', s.built + ' こ'],
      ['スカウト', s.scouts + ' かい'],
    ].forEach(([k, v]) => body.appendChild(UI.kv(k, v)));

    body.appendChild(el('h3', { class: 'panel-title', style: 'margin-top:12px', text: 'せってい' }));
    const btns = el('div', { class: 'build-list' });
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(showHowTo, 120); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('book') }),
      el('span', { class: 'build-info' }, [el('h4', { text: 'あそびかた' }), el('p', { text: 'ルールを もういちど よむ' })]),
    ]));
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(showHistory, 120); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('trophy') }),
      el('span', { class: 'build-info' }, [
        el('h4', { text: 'せいせき' }),
        el('p', { text: `さいきん ${D.RULES.resultHistoryMax}かいの けっちゃくの きろく` }),
      ]),
    ]));
    if (GP.net.enabled()) {
      btns.appendChild(el('button', {
        class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(showAccount, 120); },
      }, [
        el('span', { class: 'build-ico', html: GP.icons.svg('lock') }),
        el('span', { class: 'build-info' }, [el('h4', { text: 'アカウント・ひきつぎ' }), el('p', { text: 'ひきつぎコード・セーブの ひかえ' })]),
      ]));
    }
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { St.persist(); UI.toast('セーブしました', 'good'); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('save') }),
      el('span', { class: 'build-info' }, [el('h4', { text: 'いま セーブする' }), el('p', { text: 'ふだんは じどうで ほぞんされます' })]),
    ]));
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(askNotify, 120); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('bell') }),
      el('span', { class: 'build-info' }, [
        el('h4', { text: 'おしらせを うけとる' }),
        el('p', { text: 'ごきげんが ななめに なったら おしらせ（PWA通知）' }),
      ]),
    ]));
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(() => { showTitle(); }, 120); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('house') }),
      el('span', { class: 'build-info' }, [el('h4', { text: 'タイトルへ もどる' }), el('p', { text: 'しんこうは ほぞんされます' })]),
    ]));
    btns.appendChild(el('button', {
      class: 'build-item', type: 'button', onclick: () => { UI.closeModal(); setTimeout(startNew, 120); },
    }, [
      el('span', { class: 'build-ico', html: GP.icons.svg('refresh') }),
      el('span', { class: 'build-info' }, [el('h4', { text: 'さいしょから' }), el('p', { text: 'セーブデータを けして やりなおす' })]),
    ]));
    body.appendChild(btns);

    body.appendChild(el('p', {
      class: 'hint', style: 'margin-top:12px;text-align:center',
      text: 'ゲルぴよ公園大作戦 ～ぴよ達の遊び場争奪戦～ / プロトタイプ',
    }));

    UI.modal({ title: 'メニュー', body });
  }

  /* =========================================================
     せいせき（けっちゃくの きろく）
     ========================================================= */
  // 「つづきから」で同じ決着を表示しなおしても二重に記録しないよう、記録した決着をセーブに残す
  function recordResult(key) {
    const st = St.st;
    if (st.recordedEnding === key) return;
    st.recordedEnding = key;
    const rec = St.resultRecord(Date.now());
    U.saveHistory(U.pushHistory(U.loadHistory(), rec, D.RULES.resultHistoryMax));
    St.persist();
  }

  // スコアの計算が入る前に保存された記録は、内訳が欠けているので「—」にする
  const orDash = (v, show) => (v === undefined || v === null ? '—' : show(v));

  function historyRows(rec) {
    return [
      ['ゆうぐ レベル ごうけい', String(rec.levelTotal)],
      ['かかった 日すう', rec.daysUsed + '日'],
      ['きげん', rec.dayLimit + '日'],
      ['なかまの へいきん Lv', orDash(rec.unitAvgLv, (v) => String(U.round(v, 2)))],
      ['なわばりの まもり ごうけい', orDash(rec.defenseTotal, String)],
    ];
  }

  function historyItem(rec, index) {
    const box = el('div', { class: 'history-item' });
    box.appendChild(el('h4', { text: `${index + 1}. ${U.formatDateTime(rec.at)}` }));
    box.appendChild(el('p', { class: 'history-score', text: 'スコア ' + orDash(rec.score, (v) => v.toLocaleString('ja-JP')) }));
    // 記録は 引き継ぎで 窓口からも とどく。UI.kv は 値を innerHTML で 入れるので エスケープ
    historyRows(rec).forEach(([k, v]) => box.appendChild(UI.kv(k, U.esc(v))));
    return box;
  }

  function showHistory() {
    const list = U.loadHistory();
    const body = el('div');
    body.appendChild(el('p', { class: 'hint', text: `けっちゃく した ときの きろくを さいきん ${D.RULES.resultHistoryMax}かいぶん のこします。` }));
    if (!list.length) body.appendChild(el('p', { class: 'hint', text: 'まだ きろくが ありません。' }));
    list.forEach((rec, i) => body.appendChild(historyItem(rec, i)));
    UI.modal({ title: ':trophy: せいせき', body, buttons: [{ label: 'とじる', cls: 'btn-primary' }] });
  }

  /* =========================================================
     エンディング
     ========================================================= */
  // おなじ けっちゃくを 2ど ださない ための しるし（しゅるいが かわれば また だす）
  let shownEnding = '';
  function showEnding() {
    const st = St.st;
    if (!st.ended) return;
    const key = st.ended + ':' + (st.endedBy || '') + ':' + (st.endedDay || st.day);
    if (shownEnding === key) return;
    shownEnding = key;
    const sh = St.shares();
    const win = st.ended === 'win';
    const body = el('div', { style: 'text-align:center' });

    const art = el('div', { style: 'display:flex;justify-content:center;gap:2px;margin-bottom:8px' });
    (win ? [
      { hue: 2, sat: 76, lit: 54, acc: ['crown'], mood: 'happy' },
      { hue: 205, sat: 78, lit: 56, acc: ['straw'], mood: 'happy' },
      { hue: 48, sat: 88, lit: 60, acc: [], mood: 'happy' },
    ] : [
      { hue: 205, sat: 40, lit: 56, acc: [], mood: 'sad' },
      { hue: 30, sat: 30, lit: 60, acc: [], mood: 'sad' },
    ]).forEach((o) => {
      const d = el('div', { html: GP.piyo.svg(o) });
      const s = d.firstElementChild;
      s.setAttribute('style', 'width:74px');
      art.appendChild(s);
    });
    body.appendChild(art);

    body.appendChild(el('h4', {
      style: 'font-size:22px;margin-bottom:6px;color:' + (win ? '#F07C1F' : '#8A7969'),
      text: win ? 'こうえんは ぼくらの ものだ！' : 'また あそぼうね…',
    }));
    body.appendChild(el('p', {
      class: 'hint',
      text: win
        ? `DAY ${st.endedDay || st.day} までに ${sh.player} 区画を てにいれて、こうえん いちばんの グループに なりました！`
        : st.ended === 'lose'
          ? 'なわばりを ぜんぶ とられて しまいました…。つぎは ゆうぐを たてて ごきげん度を たかく たもとう。'
          : `タイムリミットの DAY ${St.dayLimitNow()} まで あそびました。あなたの 区画は ${sh.player} でした。`,
    }));

    const s = st.stats;
    [['さいしゅう 区画', sh.player + ' / ' + D.TILES.length],
     ['バトル', s.battles + ' かい（' + s.wins + ' しょう）'],
     ['なかま', st.units.length + ' ぴよ'],
     ['たてた ゆうぐ', s.built + ' こ'],
     ['さいこう ごきげん度', st.kigen + '']]
      .forEach(([k, v]) => body.appendChild(UI.kv(k, v)));

    // つづけられるのは ぜん制圧の クリアだけ。
    // タイムリミット・なわばり ぜんめつ は ここで おしまい。
    // （endedBy の ない ふるい セーブは 区画数から すいそく する）
    const canContinue = st.endedBy
      ? st.endedBy === 'conquest'
      : (st.ended === 'win' && sh.player === D.TILES.length);
    // 続けられる決着は「つづきを あそぶ」なら記録しないので、「さいしょから」を選んだときに記録する
    if (!canContinue) recordResult(key);
    if (!canContinue) {
      body.appendChild(el('p', {
        class: 'hint', style: 'margin-top:10px',
        text: st.ended === 'lose'
          ? 'こうえんを ぜんぶ とられて しまいました。ここで おしまいです。'
          : 'タイムリミットに とうたつ しました。ここで おしまいです。',
      }));
    }

    const foot = [];
    if (canContinue) {
      foot.push({
        label: 'つづきを あそぶ', cls: 'btn-ghost',
        onClick: () => {
          st.ended = null;
          // リミットの 日に けっちゃく して いた ばあいだけ えんちょうせん あつかい
          if (st.day >= St.dayLimitNow()) st.overtime = true;
          shownEnding = '';        // このあと ぜん制圧 したら また リザルトを だす
          St.persist(); UI.refreshHud(); UI.rerender();
        },
      });
    }
    const restart = () => { setTimeout(startNew, 120); };
    foot.push({
      label: 'さいしょから', cls: 'btn-accent',
      onClick: () => {
        recordResult(key); shownEnding = '';
        UI.closeModal();
        // ランキングへ おくるのは ぜん制圧の クリアだけ
        if (canContinue) GP.online.startRanking(St.resultRecord(Date.now()), restart);
        else restart();
        // ランキングの 窓を ボタンの あとしまつで とじさせない
        return false;
      },
    });

    UI.modal({
      title: win ? ':trophy: クリア！' : 'ゲーム しゅうりょう',
      body, noClose: true, buttons: foot,
    });
  }

  /* =========================================================
     PWA（ホーム画面に追加 / オフライン / おしらせ）
     ========================================================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (new URLSearchParams(location.search).has('dev')) return;   // かいはつ中は つかわない
    navigator.serviceWorker.register('sw.js').catch(() => { /* あとまわし */ });
  }

  /** ごきげん ななめ の おしらせ（ローカル通知）
      ※ 本番の 再訪問プッシュは Web Push + サーバが ひつよう。ここは しくみの デモ。 */
  function notifySupported() {
    return typeof Notification !== 'undefined' && location.protocol !== 'file:';
  }
  function askNotify() {
    if (!notifySupported()) { UI.toast('この かんきょうでは おしらせを つかえません', 'bad'); return; }
    Notification.requestPermission().then((p) => {
      UI.toast(p === 'granted' ? 'おしらせを オンに しました！' : 'おしらせは オフの ままです', p === 'granted' ? 'good' : '');
    });
  }
  function maybeNotify() {
    if (!notifySupported() || Notification.permission !== 'granted') return;
    const st = St.st;
    if (!st || !St.isStriking()) return;
    try {
      new Notification('ゲルぴよ公園大作戦', {
        body: 'ゲルぴよたちが ごきげん ななめ！ ゆうぐを たてに きてね🐣',
        icon: 'assets/icon.svg', tag: 'gelpiyo-kigen',
      });
    } catch (e) { /* だめでも ゲームは つづく */ }
  }

  /* =========================================================
     きどう
     ========================================================= */
  function boot() {
    UI.init();
    GP.park.init();
    GP.squad.init();
    GP.gacha.init();
    GP.battle.init();
    GP.icons.fillStatic();
    GP.worldmap.init();

    $('#btn-newgame').addEventListener('click', startNew);
    $('#btn-howto').addEventListener('click', showHowTo);
    $('#btn-account').addEventListener('click', showAccount);
    $('#btn-menu').addEventListener('click', showMenu);
    $('#btn-continue').addEventListener('click', () => {
      if (!St.restore()) { UI.toast('セーブデータが よめませんでした', 'bad'); return; }
      shownEnding = '';
      enterGame(false);
    });

    // じどう セーブ
    setInterval(() => { if (St.st) St.persist(); }, 20000);
    window.addEventListener('pagehide', () => { if (St.st) St.persist(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && St.st) { St.persist(); maybeNotify(); }
    });
    // セーブの ひかえ：裏へ 回る ときに おくる（うえの St.persist() の あとで うごく）
    const sendBackup = () => { GP.backup.sendNow({ keepalive: true }); };
    window.addEventListener('pagehide', sendBackup);
    document.addEventListener('visibilitychange', () => { if (document.hidden) sendBackup(); });
    // べつの タブが 引き継ぎで セーブを おきかえた：この タブの 古い ゲームで 上書きしない よう、閉じて 読みなおす
    window.addEventListener('storage', (e) => {
      if (e.key !== GP.backup.REPLACED_KEY || e.newValue === null) return;
      St.unload();
      location.reload();
    });
    registerSW();

    // 開発／動作確認用：?dev=park|map|squad|gacha ですぐ その画面を ひらく
    const dev = new URLSearchParams(location.search).get('dev');
    if (dev) {
      St.newGame();
      const st = St.st;
      st.res.danbo = 400; st.res.juice = 260; st.res.snack = 180;
      st.res.menko = 120; st.res.kakera = 90;
      ['slide', 'candy', 'gym', 'base', 'swing', 'flower'].forEach((f, i) => {
        st.plots[i + 2] = { fac: f, lv: i === 0 ? 2 : 1 };
      });
      ['gaki', 'teppo', 'danshoku', 'sanbou'].forEach((sp) => {
        const u = St.makeUnit(sp, 6); st.units.push(u); st.seen[sp] = true;
        if (st.team.length < St.teamCap()) st.team.push(u.uid);
      });
      st.tiles.t02.owner = 'player'; st.tiles.t06.owner = 'player';
      st.kigen = St.kigenTarget();
      $('#title-screen').hidden = true;
      $('#app').hidden = false;
      UI.tab(['park', 'map', 'squad', 'gacha'].indexOf(dev) >= 0 ? dev : 'park');
      UI.refreshHud();
      return;
    }

    showTitle();
  }

  GP.main = { boot, showEnding, showHowTo, showMenu, showTitle, showHistory, showAccount };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.GP);
