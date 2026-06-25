import type { RNG } from './rng';
import type { Token, Word, WordType } from './types';

// タイピングのお題プール
export const WORD_POOL = [
  'ありがとう', 'こんにちは', 'たいぴんぐ', 'ばとるろわいやる', 'ぱそこん',
  'きーぼーど', 'まうす', 'いんたーねっと', 'ぷろぐらみんぐ', 'えんじにあ',
  'てとます', 'ぷよぷよ', 'すまーとふぉん', 'あぷりけーしょん',
  'しょうがっこう', 'だいがく', 'おにぎり', 'はんばーがー', 'らーめん',
  'たいよう', 'うちゅう', 'あおぞら', 'しんかんせん', 'ひこうき',
  'りんご', 'みかん', 'すいか', 'がんばって', 'れべるあっぷ', 'あいてむ',
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

// 単語をトークン（判定単位）に分割する。
export const tokenizeWord = (word: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < word.length) {
    const char = word[i];
    const nextChar = word[i + 1] || '';
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

// 与えられた決定論的 RNG から新しい単語オブジェクトを生成する。
// 同じシード・同じ呼び出し順なら常に同じ単語列になる。
export const generateWord = (rng: RNG): Word => {
  const text = WORD_POOL[Math.floor(rng() * WORD_POOL.length)];
  const rand = rng();
  let type: WordType = 'normal';
  if (rand < 0.1) type = 'treasure'; // 10%でお宝
  else if (rand < 0.3) type = 'ojama'; // 20%でおじゃま

  return {
    id: `w${idCounter++}`,
    text,
    type,
    tokens: tokenizeWord(text),
  };
};
