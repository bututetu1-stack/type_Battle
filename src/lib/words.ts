import type { RNG } from './rng';
import type { Token, Word, WordType } from './types';

// お題の語彙。display=表示（漢字交じり）, reading=読み（かな・判定の元）。
interface WordEntry {
  display: string;
  reading: string;
}

export const WORD_POOL: WordEntry[] = [
  // あいさつ・日常
  { display: 'ありがとう', reading: 'ありがとう' },
  { display: 'こんにちは', reading: 'こんにちは' },
  { display: '宜しく', reading: 'よろしく' },
  { display: '頑張って', reading: 'がんばって' },
  { display: 'お疲れ様', reading: 'おつかれさま' },
  { display: '初めまして', reading: 'はじめまして' },
  // IT・ゲーム
  { display: 'タイピング', reading: 'たいぴんぐ' },
  { display: 'キーボード', reading: 'きーぼーど' },
  { display: 'マウス', reading: 'まうす' },
  { display: 'パソコン', reading: 'ぱそこん' },
  { display: 'インターネット', reading: 'いんたーねっと' },
  { display: 'プログラミング', reading: 'ぷろぐらみんぐ' },
  { display: '技術者', reading: 'ぎじゅつしゃ' },
  { display: '開発', reading: 'かいはつ' },
  { display: '画面', reading: 'がめん' },
  { display: '電源', reading: 'でんげん' },
  { display: '通信', reading: 'つうしん' },
  { display: '対戦', reading: 'たいせん' },
  { display: '連鎖', reading: 'れんさ' },
  { display: '攻撃', reading: 'こうげき' },
  { display: '逆転', reading: 'ぎゃくてん' },
  { display: '勝利', reading: 'しょうり' },
  { display: '宝物', reading: 'たからもの' },
  { display: '道具', reading: 'どうぐ' },
  // 食べ物
  { display: 'お握り', reading: 'おにぎり' },
  { display: 'ハンバーガー', reading: 'はんばーがー' },
  { display: '拉麺', reading: 'らーめん' },
  { display: '林檎', reading: 'りんご' },
  { display: '蜜柑', reading: 'みかん' },
  { display: '西瓜', reading: 'すいか' },
  { display: '寿司', reading: 'すし' },
  { display: '味噌汁', reading: 'みそしる' },
  { display: '玉子焼き', reading: 'たまごやき' },
  { display: '珈琲', reading: 'こーひー' },
  // 自然・乗り物
  { display: '太陽', reading: 'たいよう' },
  { display: '宇宙', reading: 'うちゅう' },
  { display: '青空', reading: 'あおぞら' },
  { display: '新幹線', reading: 'しんかんせん' },
  { display: '飛行機', reading: 'ひこうき' },
  { display: '自転車', reading: 'じてんしゃ' },
  { display: '電車', reading: 'でんしゃ' },
  { display: '海', reading: 'うみ' },
  { display: '山', reading: 'やま' },
  { display: '川', reading: 'かわ' },
  { display: '森林', reading: 'しんりん' },
  { display: '稲妻', reading: 'いなずま' },
  // 学校・生活
  { display: '小学校', reading: 'しょうがっこう' },
  { display: '大学', reading: 'だいがく' },
  { display: '図書館', reading: 'としょかん' },
  { display: '宿題', reading: 'しゅくだい' },
  { display: '友達', reading: 'ともだち' },
  { display: '家族', reading: 'かぞく' },
  { display: '音楽', reading: 'おんがく' },
  { display: '映画', reading: 'えいが' },
  { display: '物語', reading: 'ものがたり' },
  { display: '挑戦', reading: 'ちょうせん' },
  { display: '冒険', reading: 'ぼうけん' },
  { display: '出発', reading: 'しゅっぱつ' },
  { display: '一番', reading: 'いちばん' },
  { display: '全力', reading: 'ぜんりょく' },
  { display: '集中', reading: 'しゅうちゅう' },
  { display: '反撃', reading: 'はんげき' },
  { display: '相殺', reading: 'そうさい' },
  // 追加語彙
  { display: '人懐っこい', reading: 'ひとなつっこい' },
  { display: '熱放射', reading: 'ねつほうしゃ' },
  { display: '貿易', reading: 'ぼうえき' },
  { display: 'クラクション', reading: 'くらくしょん' },
  { display: '掛け軸', reading: 'かけじく' },
  { display: '人混み', reading: 'ひとごみ' },
  { display: '調理実習', reading: 'ちょうりじっしゅう' },
  { display: '横顔', reading: 'よこがお' },
  { display: '受験勉強', reading: 'じゅけんべんきょう' },
  { display: 'クリスタル', reading: 'くりすたる' },
  { display: '醤油', reading: 'しょうゆ' },
  { display: '回文', reading: 'かいぶん' },
  { display: 'どん底', reading: 'どんぞこ' },
  { display: '有権者', reading: 'ゆうけんしゃ' },
  { display: '鼻毛', reading: 'はなげ' },
  { display: '赤目', reading: 'あかめ' },
  { display: '月曜日', reading: 'げつようび' },
  { display: '倒置法', reading: 'とうちほう' },
  { display: 'ネットゲーム', reading: 'ねっとげーむ' },
  { display: 'グリーンピース', reading: 'ぐりーんぴーす' },
  { display: 'カモノハシ', reading: 'かものはし' },
  { display: 'かみなり雲', reading: 'かみなりぐも' },
  { display: '問題解決', reading: 'もんだいかいけつ' },
  { display: 'スポンサー', reading: 'すぽんさー' },
  { display: '戦闘服', reading: 'せんとうふく' },
  { display: '湿る', reading: 'しめる' },
  { display: '乱発', reading: 'らんぱつ' },
  { display: '原材料', reading: 'げんざいりょう' },
  { display: '路線変更', reading: 'ろせんへんこう' },
  { display: '遠足', reading: 'えんそく' },
  { display: 'ホットココア', reading: 'ほっとここあ' },
  { display: '少女漫画', reading: 'しょうじょまんが' },
  { display: '洞察力', reading: 'どうさつりょく' },
  { display: '出演', reading: 'しゅつえん' },
  { display: '昆虫標本', reading: 'こんちゅうひょうほん' },
  { display: '充電', reading: 'じゅうでん' },
  { display: 'トレーニング', reading: 'とれーにんぐ' },
  { display: '両思い', reading: 'りょうおもい' },
  { display: '卒業アルバム', reading: 'そつぎょうあるばむ' },
  { display: 'コンビニスイーツ', reading: 'こんびにすいーつ' },
  { display: '懸賞金', reading: 'けんしょうきん' },
  { display: '外来種', reading: 'がいらいしゅ' },
  { display: 'メリーゴーランド', reading: 'めりーごーらんど' },
  { display: 'かりあげ', reading: 'かりあげ' },
  { display: 'サラリーマン', reading: 'さらりーまん' },
  { display: 'まばら', reading: 'まばら' },
  { display: '聴診器', reading: 'ちょうしんき' },
  { display: '玉虫色', reading: 'たまむしいろ' },
  { display: '有刺鉄線', reading: 'ゆうしてっせん' },
  // 追加語彙 2
  { display: '焼きそばパン', reading: 'やきそばぱん' },
  { display: '変わらない', reading: 'かわらない' },
  { display: '通販サイト', reading: 'つうはんさいと' },
  { display: '一握り', reading: 'ひとにぎり' },
  { display: '送料無料', reading: 'そうりょうむりょう' },
  { display: '誕生石', reading: 'たんじょうせき' },
  { display: 'だきまくら', reading: 'だきまくら' },
  { display: 'お笑いコンビ', reading: 'おわらいこんび' },
  { display: '殿堂入り', reading: 'でんどういり' },
  { display: '大騒ぎ', reading: 'おおさわぎ' },
  { display: '司会者', reading: 'しかいしゃ' },
  { display: '予想通り', reading: 'よそうどおり' },
  { display: '音楽番組', reading: 'おんがくばんぐみ' },
  { display: '機種変更', reading: 'きしゅへんこう' },
  { display: 'ナルト', reading: 'なると' },
  { display: 'あられ', reading: 'あられ' },
  { display: 'お祓い', reading: 'おはらい' },
  { display: 'ゲーム機', reading: 'げーむき' },
  { display: '江戸時代', reading: 'えどじだい' },
  { display: 'トラベラー', reading: 'とらべらー' },
  { display: '正義は勝つ', reading: 'せいぎはかつ' },
  { display: '保証金', reading: 'ほしょうきん' },
  { display: 'ホラー漫画', reading: 'ほらーまんが' },
  { display: '準決勝', reading: 'じゅんけっしょう' },
  { display: 'ショートケーキ', reading: 'しょーとけーき' },
  { display: 'ヨーロッパ', reading: 'よーろっぱ' },
  { display: '二十面相', reading: 'にじゅうめんそう' },
  { display: 'パズルゲーム', reading: 'ぱずるげーむ' },
  { display: '日本地図', reading: 'にほんちず' },
  { display: '生卵', reading: 'なまたまご' },
  { display: '朝方', reading: 'あさがた' },
  { display: '囁く', reading: 'ささやく' },
  { display: '呼吸法', reading: 'こきゅうほう' },
  { display: 'シャボン玉', reading: 'しゃぼんだま' },
  { display: '哺乳類', reading: 'ほにゅうるい' },
  { display: 'イノベーション', reading: 'いのべーしょん' },
  { display: 'コンディショナー', reading: 'こんでぃしょなー' },
  { display: '現行犯', reading: 'げんこうはん' },
  { display: '競馬', reading: 'けいば' },
  { display: 'キャンセル料', reading: 'きゃんせるりょう' },
  { display: '爪痕', reading: 'つめあと' },
  { display: '大使', reading: 'たいし' },
  { display: '数学', reading: 'すうがく' },
  { display: 'もやし', reading: 'もやし' },
  { display: '百万年後', reading: 'ひゃくまんねんご' },
  { display: '老人ホーム', reading: 'ろうじんほーむ' },
  { display: '世代交代', reading: 'せだいこうたい' },
  { display: '繰り返す', reading: 'くりかえす' },
  { display: '優勝カップ', reading: 'ゆうしょうかっぷ' },
  { display: 'バーテンダー', reading: 'ばーてんだー' },
  // 追加語彙 3
  { display: '二階から目薬', reading: 'にかいからめぐすり' },
  { display: 'クレーター', reading: 'くれーたー' },
  { display: '心の目', reading: 'こころのめ' },
  { display: '朝寝坊', reading: 'あさねぼう' },
  { display: '影絵', reading: 'かげえ' },
  { display: '裏切り', reading: 'うらぎり' },
  { display: '羊', reading: 'ひつじ' },
  { display: '高級車', reading: 'こうきゅうしゃ' },
  { display: 'ホールインワン', reading: 'ほーるいんわん' },
  { display: '化学反応', reading: 'かがくはんのう' },
  { display: '繰り出す', reading: 'くりだす' },
  { display: '直談判', reading: 'じかだんぱん' },
  { display: '小学生', reading: 'しょうがくせい' },
  { display: '百発百中', reading: 'ひゃっぱつひゃくちゅう' },
  { display: '幸か不幸か', reading: 'こうかふこうか' },
  { display: 'ヘアアイロン', reading: 'へああいろん' },
  { display: '挙動不審', reading: 'きょどうふしん' },
  { display: 'シークワーサー', reading: 'しーくわーさー' },
  { display: '無', reading: 'む' },
  { display: 'コンビニエンスストア', reading: 'こんびにえんすすとあ' },
  { display: '急転直下', reading: 'きゅうてんちょっか' },
  { display: '晴れ', reading: 'はれ' },
  { display: '写真週刊誌', reading: 'しゃしんしゅうかんし' },
  { display: '十進法', reading: 'じっしんほう' },
  { display: '弁当箱', reading: 'べんとうばこ' },
  { display: '無人駅', reading: 'むじんえき' },
  { display: '運転手', reading: 'うんてんしゅ' },
  { display: 'お布団', reading: 'おふとん' },
  { display: '保健室', reading: 'ほけんしつ' },
  { display: '誤解', reading: 'ごかい' },
  { display: '花吹雪', reading: 'はなふぶき' },
  { display: '間一髪', reading: 'かんいっぱつ' },
  { display: '草食系男子', reading: 'そうしょくけいだんし' },
  { display: '神がかり', reading: 'かみがかり' },
  { display: '国語', reading: 'こくご' },
  { display: 'ぼたもち', reading: 'ぼたもち' },
  { display: '放送事故', reading: 'ほうそうじこ' },
  { display: '進捗を生む', reading: 'しんちょくをうむ' },
  { display: '皮', reading: 'かわ' },
  { display: '昼下がり', reading: 'ひるさがり' },
  { display: '言葉遣い', reading: 'ことばづかい' },
  { display: '河原', reading: 'かわら' },
  { display: '挨拶代わり', reading: 'あいさつがわり' },
  { display: 'ホットミルク', reading: 'ほっとみるく' },
  { display: '奇妙', reading: 'きみょう' },
  { display: 'フンコロガシ', reading: 'ふんころがし' },
  { display: 'ピストル', reading: 'ぴすとる' },
  { display: 'アイマスク', reading: 'あいますく' },
];

// ローマ字入力マッピング（柔軟な入力に対応）
export const ROMAJI_MAP: Record<string, string[]> = {
  'あ': ['a'], 'い': ['i'], 'う': ['u', 'wu'], 'え': ['e'], 'お': ['o'],
  'か': ['ka', 'ca'], 'き': ['ki'], 'く': ['ku', 'cu', 'qu'], 'け': ['ke'], 'こ': ['ko', 'co'],
  'さ': ['sa'], 'し': ['shi', 'si', 'ci'], 'す': ['su'], 'せ': ['se', 'ce'], 'そ': ['so'],
  'た': ['ta'], 'ち': ['chi', 'ti'], 'つ': ['tsu', 'tu'], 'て': ['te'], 'と': ['to'],
  'な': ['na'], 'に': ['ni'], 'ぬ': ['nu'], 'ね': ['ne'], 'の': ['no'],
  'は': ['ha'], 'ひ': ['hi'], 'ふ': ['fu', 'hu'], 'へ': ['he'], 'ほ': ['ho'],
  'ま': ['ma'], 'み': ['mi'], 'む': ['mu'], 'め': ['me'], 'も': ['mo'],
  'や': ['ya'], 'ゆ': ['yu'], 'よ': ['yo'],
  'ら': ['ra'], 'り': ['ri'], 'る': ['ru'], 'れ': ['re'], 'ろ': ['ro'],
  'わ': ['wa'], 'を': ['wo'], 'ん': ['nn', 'xn'],
  'が': ['ga'], 'ぎ': ['gi'], 'ぐ': ['gu'], 'げ': ['ge'], 'ご': ['go'],
  'ざ': ['za'], 'じ': ['ji', 'zi'], 'ず': ['zu'], 'ぜ': ['ze'], 'ぞ': ['zo'],
  'だ': ['da'], 'ぢ': ['di'], 'づ': ['du'], 'で': ['de'], 'ど': ['do'],
  'ば': ['ba'], 'び': ['bi'], 'ぶ': ['bu'], 'べ': ['be'], 'ぼ': ['bo'],
  'ぱ': ['pa'], 'ぴ': ['pi'], 'ぷ': ['pu'], 'ぺ': ['pe'], 'ぽ': ['po'],
  'きゃ': ['kya'], 'きゅ': ['kyu'], 'きょ': ['kyo'],
  'しゃ': ['sha', 'sya'], 'しゅ': ['shu', 'syu'], 'しょ': ['sho', 'syo'],
  'ちゃ': ['cha', 'tya', 'cya'], 'ちゅ': ['chu', 'tyu', 'cyu'], 'ちょ': ['cho', 'tyo', 'cyo'],
  'にゃ': ['nya'], 'にゅ': ['nyu'], 'にょ': ['nyo'],
  'ひゃ': ['hya'], 'ひゅ': ['hyu'], 'ひょ': ['hyo'],
  'みゃ': ['mya'], 'みゅ': ['myu'], 'みょ': ['myo'],
  'りゃ': ['rya'], 'りゅ': ['ryu'], 'りょ': ['ryo'],
  'ぎゃ': ['gya'], 'ぎゅ': ['gyu'], 'ぎょ': ['gyo'],
  'じゃ': ['ja', 'jya', 'zya'], 'じゅ': ['ju', 'jyu', 'zyu'], 'じょ': ['jo', 'jyo', 'zyo'],
  'びゃ': ['bya'], 'びゅ': ['byu'], 'びょ': ['byo'],
  'ぴゃ': ['pya'], 'ぴゅ': ['pyu'], 'ぴょ': ['pyo'],
  'ふぁ': ['fa'], 'ふぃ': ['fi'], 'ふぇ': ['fe'], 'ふぉ': ['fo'],
  'てぃ': ['thi'], 'でぃ': ['dhi'],
  'ー': ['-'],
  'っ': ['xtsu', 'xtu', 'ltsu', 'ltu'],
  'ぁ': ['xa', 'la'], 'ぃ': ['xi', 'li'], 'ぅ': ['xu', 'lu'], 'ぇ': ['xe', 'le'], 'ぉ': ['xo', 'lo'],
  'ゃ': ['xya', 'lya'], 'ゅ': ['xyu', 'lyu'], 'ょ': ['xyo', 'lyo'],
};

// 読み（かな）をトークン（判定単位）に分割する。
export const tokenizeWord = (reading: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < reading.length) {
    const char = reading[i];
    const nextChar = reading[i + 1] || '';
    if (ROMAJI_MAP[char + nextChar]) {
      tokens.push({ kana: char + nextChar, romaji: ROMAJI_MAP[char + nextChar] });
      i += 2;
    } else if (ROMAJI_MAP[char]) {
      tokens.push({ kana: char, romaji: ROMAJI_MAP[char] });
      i += 1;
    } else {
      tokens.push({ kana: char, romaji: [char] });
      i += 1;
    }
  }
  return tokens;
};

// 単語IDの連番カウンタ（React の key 用。シードに依存せず常に一意）。
let idCounter = 0;

function buildWord(entry: WordEntry, type: WordType, prefix: string): Word {
  return {
    id: `${prefix}${idCounter++}`,
    display: entry.display,
    reading: entry.reading,
    type,
    tokens: tokenizeWord(entry.reading),
  };
}

// 与えられた決定論的 RNG から新しい単語を生成する。
export const generateWord = (rng: RNG): Word => {
  const entry = WORD_POOL[Math.floor(rng() * WORD_POOL.length)];
  const rand = rng();
  let type: WordType = 'normal';
  if (rand < 0.1) type = 'treasure'; // 10%でお宝
  else if (rand < 0.3) type = 'ojama'; // 20%でおじゃま
  return buildWord(entry, type, 'w');
};

// 受信したおじゃま用の単語（常に ojama）。攻撃由来なので Math.random で選ぶ。
export const makeOjamaWord = (): Word => {
  const entry = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];
  return buildWord(entry, 'ojama', 'o');
};
