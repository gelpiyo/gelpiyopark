/* =========================================================
   data.js — マスタデータ（施設 / ぴよ / 装備 / 勢力 / 地形 / 区画）
   数値はすべてここに集約。バランス調整はこのファイルだけで完結する。
   ========================================================= */
window.GP = window.GP || {};

(function (GP) {
  'use strict';

  /* ---------------------------------------------------------
     リソース
     --------------------------------------------------------- */
  const RES = {
    danbo: { id: 'danbo', name: 'ダンボール', ico: '📦' },
    juice: { id: 'juice', name: 'ジュース缶', ico: '🥤' },
    snack: { id: 'snack', name: 'おやつ', ico: '🍪' },
    menko: { id: 'menko', name: 'レアメンコ', ico: '🎴' },
    kakera: { id: 'kakera', name: 'なかよしのかけら', ico: '🧩' },
  };
  const RES_ORDER = ['danbo', 'juice', 'snack', 'menko'];

  /* ---------------------------------------------------------
     施設（遊具）
     cost   : Lv1 建設コスト
     yield  : Lv1 の1日あたり産出
     kigen  : ごきげん度への寄与
     cap    : 遊べる ぴよの定員（混雑をやわらげる）
     bonus  : 特殊効果 { teamCap:1 } / { roster:2 } / { def:2 }
     --------------------------------------------------------- */
  const FACILITIES = [
    { id: 'sunaba', name: 'すなば', ico: '🏖', tag: 'せいさん',
      desc: 'ダンボールの きれはしが よく みつかる すなの ひろば。',
      cost: { danbo: 10 }, yield: { danbo: 2 }, kigen: 2, cap: 2 },

    { id: 'swing', name: 'ブランコ', ico: '🎠', tag: 'せいさん',
      desc: 'こいで あそぶと のどが かわく。ジュース缶が あつまる。',
      cost: { danbo: 14, juice: 4 }, yield: { juice: 2 }, kigen: 3, cap: 2 },

    { id: 'fountain', name: 'みずのみば', short: 'みずのみ', ico: '⛲', tag: 'せいさん',
      desc: 'みんなの きゅうすいスポット。ジュース缶の かいしゅう率アップ。',
      cost: { danbo: 12, juice: 8 }, yield: { juice: 3 }, kigen: 3, cap: 1 },

    { id: 'gym', name: 'ジャングルジム', short: 'ジム', ico: '🧗', tag: 'せいさん',
      desc: 'てっぺんから ざいりょうが よく みえる。ダンボール産出 大。',
      cost: { danbo: 34 }, yield: { danbo: 3 }, kigen: 4, cap: 3 },

    { id: 'candy', name: 'だがしや', ico: '🍬', tag: 'せいさん',
      desc: 'おやつが てにはいる。こうしょう（がいこう）に かかせない。',
      cost: { danbo: 24, juice: 14 }, yield: { snack: 3 }, kigen: 4, cap: 3 },

    { id: 'slide', name: 'きょだいすべりだい', short: 'すべりだい', ico: '🛝', tag: 'ごきげん',
      desc: 'こうえん いちの 大にんき ゆうぐ。ごきげん度が ぐんと あがる。',
      cost: { danbo: 40, juice: 20 }, yield: { juice: 4 }, kigen: 9, cap: 4 },

    { id: 'base', name: 'ひみつきち', ico: '🏕', tag: 'とくしゅ',
      desc: 'さくせん会議の ばしょ。出撃メンバーの わくが ふえる。',
      cost: { danbo: 55, juice: 26, snack: 8 }, yield: { danbo: 3 }, kigen: 5, cap: 4,
      bonus: { teamCap: 1 } },

    { id: 'house', name: 'ぴよハウス', ico: '🏠', tag: 'とくしゅ',
      desc: 'なかまが とまれる おうち。もてる なかまの 上限が ふえる。',
      cost: { danbo: 28, juice: 10, snack: 4 }, yield: {}, kigen: 2, cap: 2,
      bonus: { roster: 4 } },

    { id: 'craft', name: 'こうさくしつ', short: 'こうさく', ico: '🧰', tag: 'とくしゅ',
      desc: 'ダンボールを けずって メンコを つくる。スカウトの もとで。',
      cost: { danbo: 45, juice: 18, snack: 12 }, yield: { menko: 1 }, kigen: 1, cap: 1 },

    { id: 'fort', name: 'すなやま とりで', short: 'とりで', ico: '🏰', tag: 'とくしゅ',
      desc: 'ホーム区画の まもりを かためる。しゅうげきに つよくなる。',
      cost: { danbo: 36, juice: 12 }, yield: {}, kigen: 1, cap: 1,
      bonus: { def: 2 } },

    { id: 'bench', name: 'ベンチ', ico: '🪑', tag: 'ごきげん',
      desc: 'ひとやすみ どころ。ちいさいけれど ごきげんに ひびく。',
      cost: { danbo: 8 }, yield: {}, kigen: 3, cap: 2 },

    { id: 'flower', name: 'はなだん', ico: '🌷', tag: 'ごきげん',
      desc: 'みばえが よくなって みんな ごきげん。',
      cost: { danbo: 10, juice: 4 }, yield: {}, kigen: 5, cap: 0 },
  ];
  const FAC_BY_ID = {};
  FACILITIES.forEach((f) => { FAC_BY_ID[f.id] = f; });

  /** Lv に応じた建設／強化コスト */
  function facCost(facId, level) {
    const f = FAC_BY_ID[facId];
    const m = Math.pow(1.85, level);           // level 0 = 新規建設
    const out = {};
    for (const k in f.cost) out[k] = Math.max(1, Math.round(f.cost[k] * m));
    return out;
  }
  /** Lv に応じた産出（level は 1 始まり） */
  function facYield(facId, level) {
    const f = FAC_BY_ID[facId];
    const m = 1 + 0.65 * (level - 1);
    const out = {};
    for (const k in f.yield) out[k] = f.yield[k] * m;
    return out;
  }
  function facKigen(facId, level) {
    return FAC_BY_ID[facId].kigen * (1 + 0.35 * (level - 1));
  }
  function facCap(facId, level) {
    return Math.round(FAC_BY_ID[facId].cap * (1 + 0.5 * (level - 1)));
  }

  /* ---------------------------------------------------------
     ぴよの やくわり（タイプ）
     --------------------------------------------------------- */
  const ROLES = {
    rush:  { id: 'rush',  name: 'そっこう',   short: '速', ico: '🏃', color: '#F0844A',
             desc: 'すばしっこい。まっさきに つっこむ。えんきょりに つよい。',
             base: { hp: 56, atk: 14, def: 4, rng: 1, mov: 3, spd: 12 } },
    range: { id: 'range', name: 'えんきょり', short: '遠', ico: '💦', color: '#4EA8DE',
             desc: '水鉄砲で とおくから ねらう。ぼうぎょに つよい。',
             base: { hp: 44, atk: 15, def: 3, rng: 3, mov: 2, spd: 10 } },
    guard: { id: 'guard', name: 'ぼうぎょ',   short: '盾', ico: '🛡', color: '#8C7A5B',
             desc: 'ダンボール盾で うけとめる。そっこうに つよい。',
             base: { hp: 88, atk: 9,  def: 10, rng: 1, mov: 2, spd: 7 } },
    brain: { id: 'brain', name: 'さくせん',   short: '策', ico: '🧠', color: '#8B6FD6',
             desc: 'なかまを おうえん・かいふくする しえん やく。',
             base: { hp: 48, atk: 8,  def: 5, rng: 2, mov: 2, spd: 11 } },
    boss:  { id: 'boss',  name: 'たいしょう', short: '将', ico: '👑', color: '#E4614F',
             desc: 'よわてんが ない ばんのう タイプ。まわりを つよくする。',
             base: { hp: 74, atk: 16, def: 7, rng: 1, mov: 2, spd: 9 } },
    trick: { id: 'trick', name: 'おじゃま',   short: '妨', ico: '😜', color: '#57C785',
             desc: 'あいての ちからを さげる いたずら やく。',
             base: { hp: 52, atk: 10, def: 5, rng: 2, mov: 3, spd: 13 } },
  };
  const ROLE_ORDER = ['rush', 'range', 'guard', 'brain', 'boss', 'trick'];

  /** 相性表 attacker -> defender の ばいりつ */
  const TYPE_CHART = {
    rush:  { range: 1.5, guard: 0.7 },
    range: { guard: 1.5, rush: 0.7 },
    guard: { rush: 1.5, range: 0.7 },
    brain: {},
    boss:  {},
    trick: {},
  };
  function typeMult(a, d) {
    return (TYPE_CHART[a] && TYPE_CHART[a][d]) || 1;
  }

  /* ---------------------------------------------------------
     レアリティ
     --------------------------------------------------------- */
  const RARITY = {
    N:  { id: 'N',  name: 'N',  mult: 1.00, color: '#7BA7C9', star: 1 },
    R:  { id: 'R',  name: 'R',  mult: 1.22, color: '#B07AD8', star: 2 },
    SR: { id: 'SR', name: 'SR', mult: 1.52, color: '#F0A020', star: 3 },
  };

  /* ---------------------------------------------------------
     ぴよ 種族（スカウトで出る）
     hue    : 体色（HSL の色相）／ sat, lit で調整
     kind   : 'piyo' | 'crow' | 'cat'
     --------------------------------------------------------- */
  const SPECIES = [
    // ---- N ----
    { id: 'kopiyo',   name: 'こぴよ',           rar: 'N', role: 'rush',  hue: 205, sat: 78, lit: 56, acc: null,      flavor: 'げんきだけが とりえ。' },
    { id: 'sunapiyo', name: 'すなぴよ',         rar: 'N', role: 'guard', hue: 38,  sat: 62, lit: 62, acc: null,      flavor: 'すなばの ぬし。うごかない。' },
    { id: 'mizupiyo', name: 'みずぴよ',         rar: 'N', role: 'range', hue: 190, sat: 72, lit: 58, acc: 'gun',     flavor: 'いつも 水鉄砲を もっている。' },
    { id: 'kusapiyo', name: 'くさぴよ',         rar: 'N', role: 'rush',  hue: 100, sat: 55, lit: 55, acc: null,      flavor: 'はらっぱを かけまわる。' },
    { id: 'nebopiyo', name: 'ねぼすけぴよ',     rar: 'N', role: 'guard', hue: 220, sat: 22, lit: 62, acc: null,      flavor: 'たいてい ねている。' },
    { id: 'genkipiyo',name: 'げんきぴよ',       rar: 'N', role: 'rush',  hue: 48,  sat: 88, lit: 60, acc: null,      flavor: 'こえが おおきい。' },
    { id: 'nonbiri',  name: 'のんびりぴよ',     rar: 'N', role: 'brain', hue: 30,  sat: 42, lit: 76, acc: null,      flavor: 'あわてない。ぜったいに。' },
    { id: 'dobopiyo', name: 'どろんこぴよ',     rar: 'N', role: 'trick', hue: 24,  sat: 34, lit: 44, acc: null,      flavor: 'どろだんごの めいじん。' },

    // ---- R ----
    { id: 'teppo',    name: 'みずでっぽう小僧', rar: 'R', role: 'range', hue: 196, sat: 82, lit: 50, acc: 'gun',     flavor: 'ねらった まとは はずさない。' },
    { id: 'danshoku', name: 'ダンボール職人',   rar: 'R', role: 'guard', hue: 28,  sat: 56, lit: 46, acc: 'shield',  flavor: 'いちにちで とりでを つくる。' },
    { id: 'amimochi', name: 'あみもち名人',     rar: 'R', role: 'trick', hue: 128, sat: 52, lit: 46, acc: 'net',     flavor: '虫とり網で なんでも つかまえる。' },
    { id: 'sanbou',   name: 'さくせん参謀',     rar: 'R', role: 'brain', hue: 268, sat: 48, lit: 58, acc: 'goggle',  flavor: 'すなばに じんけいを かく。' },
    { id: 'kakekko',  name: 'かけっこ王',       rar: 'R', role: 'rush',  hue: 18,  sat: 84, lit: 56, acc: 'boots',   flavor: 'こうえん さいそく。たぶん。' },
    { id: 'goggle',   name: 'ゴーグルぴよ',     rar: 'R', role: 'range', hue: 172, sat: 62, lit: 48, acc: 'goggle',  flavor: 'みずけむりの なかでも みえる。' },
    { id: 'nagagutsu',name: 'ながぐつぴよ',     rar: 'R', role: 'rush',  hue: 350, sat: 66, lit: 56, acc: 'boots',   flavor: 'みずたまりが へっちゃら。' },
    { id: 'randsel',  name: 'ランドセルぴよ',   rar: 'R', role: 'guard', hue: 340, sat: 52, lit: 52, acc: 'randsel', flavor: 'なかみは ほとんど おやつ。' },

    // ---- SR ----
    { id: 'gaki',     name: 'ガキ大将ゲルぴよ', rar: 'SR', role: 'boss',  hue: 2,   sat: 76, lit: 52, acc: 'crown',   flavor: 'こうえんの ぬし。よぶと くる。' },
    { id: 'densetsu', name: 'でんせつの水鉄砲', rar: 'SR', role: 'range', hue: 214, sat: 84, lit: 42, acc: 'gun',     flavor: 'いちど うつと にじが でる。' },
    { id: 'teppeki',  name: 'てっぺきダンボール',rar: 'SR', role: 'guard', hue: 20,  sat: 48, lit: 34, acc: 'shield',  flavor: 'あめでも ふやけない ダンボール。' },
    { id: 'shinpi',   name: 'しんぴの頭脳派',   rar: 'SR', role: 'brain', hue: 285, sat: 62, lit: 46, acc: 'goggle',  flavor: 'あしたの てんきが わかる。' },
    { id: 'itazura',  name: 'いたずらキング',   rar: 'SR', role: 'trick', hue: 312, sat: 68, lit: 52, acc: 'straw',   flavor: 'わなを しかけるのが しごと。' },
  ];
  const SPECIES_BY_ID = {};
  SPECIES.forEach((s) => { SPECIES_BY_ID[s.id] = s; });

  const GACHA_RATE = { SR: 0.04, R: 0.26, N: 0.70 };

  /* ---------------------------------------------------------
     そうび
     --------------------------------------------------------- */
  const EQUIPS = [
    { id: 'straw',   name: '麦わら帽子',       ico: '👒', mod: { def: 2 },                    note: 'ごきげん +1' , kigen: 1 },
    { id: 'net',     name: '虫取り網',         ico: '🥅', mod: { atk: 3 } },
    { id: 'randsel', name: 'ランドセル',       ico: '🎒', mod: { hp: 16, def: 2 } },
    { id: 'gun',     name: '水鉄砲',           ico: '🔫', mod: { atk: 4 },                    note: 'えんきょりなら しゃてい +1', special: 'rangeUp' },
    { id: 'shield',  name: 'ダンボール盾',     ico: '🛡', mod: { def: 6, mov: -1 } },
    { id: 'boots',   name: 'ながぐつ',         ico: '🥾', mod: { mov: 1, spd: 2 },            note: 'みずたまりを むし', special: 'ignoreWater' },
    { id: 'goggle',  name: 'すいちゅうメガネ', ico: '🥽', mod: { spd: 3, atk: 1 } },
    { id: 'towel',   name: 'まきタオル',       ico: '🧣', mod: { hp: 14 } },
    { id: 'whistle', name: 'ホイッスル',       ico: '📣', mod: { spd: 4 },                    note: 'みかた ぜんいん こうげき +1', special: 'aura' },
    { id: 'crown',   name: 'きんのかんむり',   ico: '👑', mod: { hp: 12, atk: 3, def: 3 } },
  ];
  const EQUIP_BY_ID = {};
  EQUIPS.forEach((e) => { EQUIP_BY_ID[e.id] = e; });

  /* ---------------------------------------------------------
     せいちょう（しんか）
     --------------------------------------------------------- */
  const EVOLUTIONS = [
    { id: 'onii',   name: 'たよれるお兄ちゃん', mult: 1.10, w: 34, kind: 'good',
      msg: 'すっかり たよれる お兄ちゃんに なった！' },
    { id: 'onee',   name: 'たよれるお姉ちゃん', mult: 1.10, w: 34, kind: 'good',
      msg: 'すっかり たよれる お姉ちゃんに なった！' },
    { id: 'nebo',   name: 'ねぼすけ', mult: 1.0, w: 12, kind: 'bad',
      mod: { spd: -4, hp: 18 }, msg: 'ひるねの あじを おぼえてしまった…（すばやさ↓ たいりょく↑）' },
    { id: 'amae',   name: 'あまえんぼ', mult: 1.0, w: 12, kind: 'bad',
      mod: { atk: -3, def: 5 }, msg: 'あまえんぼに なった…（こうげき↓ ぼうぎょ↑）' },
    { id: 'legend', name: 'でんせつの', mult: 1.24, w: 8, kind: 'rare',
      msg: 'まばゆい ひかりに つつまれた…！ でんせつの ゲルぴよだ！' },
  ];
  const EVO_LEVELS = [5, 12, 20];

  /* ---------------------------------------------------------
     勢力
     --------------------------------------------------------- */
  const FACTIONS = {
    player: { id: 'player', name: 'ぴよ団',       short: 'ぴよ',  color: '#FFC93C', dark: '#D9A00F',
              kind: 'piyo', hue: 47, sat: 90, lit: 60 },
    crow:   { id: 'crow',   name: 'カラス組',     short: 'カラス', color: '#6D5BA8', dark: '#4A3C78',
              kind: 'crow', hue: 262, sat: 20, lit: 28, aggr: 0.85, power: 1.10,
              taunt: ['カァー！ ここは おれたちの なわばりだ！', 'おやつを おいてけ〜！'] },
    cat:    { id: 'cat',    name: '野良ネコ軍団', short: 'ネコ',  color: '#F0844A', dark: '#C0621F',
              kind: 'cat',  hue: 26,  sat: 72, lit: 56, aggr: 0.7, power: 1.0,
              taunt: ['ニャ〜ん、ひなたぼっこの ばしょを よこすニャ', 'ここは ネコの とおりみち！'] },
    red:    { id: 'red',    name: 'あかぴよ団',   short: 'あか',  color: '#E4614F', dark: '#B94434',
              kind: 'piyo', hue: 2,   sat: 76, lit: 54, aggr: 0.95, power: 1.05,
              taunt: ['まけないぴよ〜！', 'すべりだいは ぼくらのだ！'] },
    none:   { id: 'none',   name: 'のらぴよ',     short: 'のら',  color: '#A9A29A', dark: '#867F77',
              kind: 'piyo', hue: 40,  sat: 12, lit: 62, aggr: 0, power: 0.86 },
  };
  const RIVALS = ['crow', 'cat', 'red'];

  /* ---------------------------------------------------------
     地形
     --------------------------------------------------------- */
  const TERRAIN = {
    hiroba:  { id: 'hiroba',  name: 'ひろば',   ico: '🌱', def: 0, yield: { danbo: 1, juice: 1 },
               fill: '#B7E3A0', obst: 'none',  note: 'さえぎる ものが ない ひらけた ばしょ。' },
    sunaba:  { id: 'sunaba',  name: 'すなば',   ico: '🏖', def: 1, yield: { danbo: 3 },
               fill: '#F2DFAE', obst: 'sand',  note: 'すなやまが あって うごきにくい。' },
    ike:     { id: 'ike',     name: 'いけ',     ico: '💧', def: 3, yield: { juice: 4 },
               fill: '#A8DCEF', obst: 'water', note: 'みずたまりだらけ。まもりが かたい。' },
    kodachi: { id: 'kodachi', name: 'こだち',   ico: '🌳', def: 2, yield: { snack: 3, danbo: 1 },
               fill: '#93CE8C', obst: 'tree',  note: 'きが しげって えんきょりが とどきにくい。' },
    oka:     { id: 'oka',     name: 'おかし山', ico: '⛰', def: 2, yield: { snack: 2, menko: 1 },
               fill: '#E8C89A', obst: 'gym',   note: 'たかい ばしょ。メンコが ひろえる。' },
  };

  /* ---------------------------------------------------------
     区画（半径2のヘックス = 19区画）
     q,r は アクシャル座標
     --------------------------------------------------------- */
  const TILES = [
    { id: 't00', q:  0, r:  0, name: 'ちゅうおう広場',     ter: 'hiroba',  owner: 'player', def: 4 },
    { id: 't01', q:  1, r: -1, name: 'すべりだい丘',       ter: 'oka',     owner: 'none',   def: 3 },
    { id: 't02', q:  1, r:  0, name: 'ブランコ坂',         ter: 'hiroba',  owner: 'none',   def: 2 },
    { id: 't03', q:  0, r:  1, name: 'すなば台地',         ter: 'sunaba',  owner: 'none',   def: 2 },
    { id: 't04', q: -1, r:  1, name: 'はらっぱ',           ter: 'hiroba',  owner: 'none',   def: 2 },
    { id: 't05', q: -1, r:  0, name: 'ベンチ通り',         ter: 'hiroba',  owner: 'none',   def: 2 },
    { id: 't06', q:  0, r: -1, name: 'てつぼう広場',       ter: 'hiroba',  owner: 'none',   def: 3 },
    { id: 't07', q:  2, r: -2, name: 'かぜのおか',         ter: 'oka',     owner: 'crow',   def: 5 },
    { id: 't08', q:  2, r: -1, name: 'からす林',           ter: 'kodachi', owner: 'crow',   def: 6 },
    { id: 't09', q:  2, r:  0, name: 'ジャングルジム砦',   ter: 'kodachi', owner: 'crow',   def: 5 },
    { id: 't10', q:  1, r:  1, name: 'どろんこ谷',         ter: 'ike',     owner: 'none',   def: 4 },
    { id: 't11', q:  0, r:  2, name: 'みずばの泉',         ter: 'ike',     owner: 'cat',    def: 5 },
    { id: 't12', q: -1, r:  2, name: 'ひなたの えんがわ',  ter: 'sunaba',  owner: 'cat',    def: 4 },
    { id: 't13', q: -2, r:  2, name: 'ねこじゃらし小道',   ter: 'kodachi', owner: 'cat',    def: 5 },
    { id: 't14', q: -2, r:  1, name: 'かくれんぼ横丁',     ter: 'kodachi', owner: 'none',   def: 3 },
    { id: 't15', q: -2, r:  0, name: 'だがしや通り',       ter: 'hiroba',  owner: 'red',    def: 4 },
    { id: 't16', q:  1, r: -2, name: 'まつぼっくりの森',   ter: 'kodachi', owner: 'none',   def: 3 },
    { id: 't17', q:  0, r: -2, name: 'ゆうひ台',           ter: 'oka',     owner: 'red',    def: 5 },
    { id: 't18', q: -1, r: -1, name: 'あかぴよ ひみつ基地', ter: 'sunaba', owner: 'red',    def: 6 },
  ];

  /* ---------------------------------------------------------
     さくせん（バトル方針）
     --------------------------------------------------------- */
  const TACTICS = [
    { id: 'charge',  name: 'とつげき', ico: '⚡',
      desc: 'いきおいよく つっこむ。こうげき+12% ／ ぼうぎょ-15% ／ うごき+1',
      mod: { atk: 1.12, def: 0.85, mov: 1 }, target: 'near' },
    { id: 'defend',  name: 'まもり',   ico: '🛡',
      desc: 'かたまって まもる。ぼうぎょ+25% ／ こうげき-8% ／ うごき-1',
      mod: { atk: 0.92, def: 1.25, mov: -1 }, target: 'near' },
    { id: 'surround',name: 'とりかこみ', ico: '🎯',
      desc: 'よわい あいてから ねらう。すばやさ+3 ／ こうげき+4%',
      mod: { atk: 1.04, def: 1.0, spd: 3 }, target: 'weak' },
  ];

  /* ---------------------------------------------------------
     こうしょう（がいこう）
     --------------------------------------------------------- */
  const GIFTS = [
    { id: 'juice', name: '高級ジュース', ico: '🥤', cost: { juice: 18 },  up: 9 },
    { id: 'snack', name: '高級おやつ',   ico: '🍪', cost: { snack: 12 },  up: 14 },
    { id: 'menko', name: 'レアメンコ',   ico: '🎴', cost: { menko: 3 },   up: 26 },
  ];
  const DIPLO = {
    pactNeed: 50,   // 平和条約（お約束）
    pactDays: 4,
    cheerNeed: 70,  // おうえん（次のバトルで味方+1）
    cedeNeed: 88,   // 区画のじょうと
    cedeReset: 42,
    start: 30,
    dailyDrift: -1, // 何もしないと すこしずつ さがる
  };

  /* ---------------------------------------------------------
     日ごとの イベント
     --------------------------------------------------------- */
  const EVENTS = [
    { id: 'sashiire', w: 10, kind: 'good', text: 'ちかくの おうちから おやつの さしいれ！',   res: { snack: 12 } },
    { id: 'danbo',    w: 10, kind: 'good', text: 'ひっこしの ダンボールを もらった！',        res: { danbo: 18 } },
    { id: 'takara',   w: 5,  kind: 'good', text: 'すなばから レアメンコを ほりだした！',       res: { menko: 3 } },
    { id: 'piyobiyo', w: 8,  kind: 'good', text: 'ぴよ日和。みんな ごきげん！',                kigen: 12 },
    { id: 'juice',    w: 9,  kind: 'good', text: 'じどうはんばいきの したから ジュース缶！',   res: { juice: 14 } },
    { id: 'ame',      w: 9,  kind: 'bad',  text: 'あめふり。だれも あそびに こない…',          kigen: -12, prodMul: 0.6 },
    { id: 'kaze',     w: 7,  kind: 'bad',  text: 'かぜが つよい。ダンボールが とんでいった…',  res: { danbo: -10 }, kigen: -4 },
    { id: 'itazura',  w: 7,  kind: 'bad',  text: 'ライバルの いたずら！ ゆうぐが よごれた…',    kigen: -8 },
    { id: 'kaze2',    w: 5,  kind: 'bad',  text: 'ぴよたちが かぜぎみ。げんきが たりない…',     genki: -1, kigen: -5 },
    { id: 'none',     w: 30, kind: 'none', text: 'とくに なにも なかった、へいわな 1日。' },
  ];

  /* ---------------------------------------------------------
     ゲームルール定数
     --------------------------------------------------------- */
  const RULES = {
    startRes:    { danbo: 46, juice: 24, snack: 14, menko: 12, kakera: 0 },
    startKigen:  50,
    baseKigen:   34,
    kigenCapFac: 50,      // ゆうぐで あがる ごきげん度の じょうげん
    kigenSoft:   48,      // ていげん の つよさ
    genkiMax:    3,
    genkiPerDay: 1,
    teamCapBase: 4,
    rosterBase:  8,
    plotsBase:   6,        // 最初から ひらけている 区画数
    plotsTotal:  16,       // 4 x 4
    plotPerTile: 1,        // 縄張り1つ ごとに ひらける 数
    dayLimit:    40,       // このターンまでに いちばん おおくの 区画を
    gachaCost1:  5,
    gachaCost10: 45,
    dupKakera:   { N: 4, R: 12, SR: 40 },
    train: { kakera: 2, snack: 1, xp: 12 },  // いくせい 1回ぶん：かけら2＋おやつ1 → けいけんち+12
    xpPerWin:    20,
    xpTable:     (lv) => Math.round(26 * Math.pow(1.19, lv - 1)),
    lvMax:       25,
    strikeAt:    26,       // これ未満で だだっこストライキ
    offlineCapH: 8,        // 放置ボーナスの じょうげん（時間）
    offlineRate: 0.42,     // 放置中は 1日ぶんの何%か（1時間 = 1日 あつかい）
  };

  GP.data = {
    RES, RES_ORDER,
    FACILITIES, FAC_BY_ID, facCost, facYield, facKigen, facCap,
    ROLES, ROLE_ORDER, TYPE_CHART, typeMult,
    RARITY, SPECIES, SPECIES_BY_ID, GACHA_RATE,
    EQUIPS, EQUIP_BY_ID,
    EVOLUTIONS, EVO_LEVELS,
    FACTIONS, RIVALS, TERRAIN, TILES,
    TACTICS, GIFTS, DIPLO, EVENTS, RULES,
  };
})(window.GP);
