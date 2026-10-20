// ローマ字の判定表・読みのトークン化・ふりがな（ルビ）生成。
// 単語辞書（words.ts・約270KB）から切り出した軽い部分。ホーム画面や語句の追加画面は
// こちらだけを読むので、辞書の読み込みを待たずに表示できる（words.ts からも再公開している）。
import type { Token } from './types';

// ローマ字入力マッピング（柔軟な入力に対応）
export const ROMAJI_MAP: Record<string, string[]> = {
  'あ': ['a'], 'い': ['i'], 'う': ['u', 'wu'], 'え': ['e'], 'お': ['o'],
  'か': ['ka', 'ca'], 'き': ['ki'], 'く': ['ku', 'cu', 'qu'], 'け': ['ke'], 'こ': ['ko', 'co'],
  'さ': ['sa'], 'し': ['si', 'shi', 'ci'], 'す': ['su'], 'せ': ['se', 'ce'], 'そ': ['so'],
  'た': ['ta'], 'ち': ['ti', 'chi'], 'つ': ['tu', 'tsu'], 'て': ['te'], 'と': ['to'],
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
  'ちゃ': ['tya', 'cha', 'cya'], 'ちゅ': ['tyu', 'chu', 'cyu'], 'ちょ': ['tyo', 'cho', 'cyo'],
  'にゃ': ['nya'], 'にゅ': ['nyu'], 'にょ': ['nyo'],
  'ひゃ': ['hya'], 'ひゅ': ['hyu'], 'ひょ': ['hyo'],
  'みゃ': ['mya'], 'みゅ': ['myu'], 'みょ': ['myo'],
  'りゃ': ['rya'], 'りゅ': ['ryu'], 'りょ': ['ryo'],
  'ぎゃ': ['gya'], 'ぎゅ': ['gyu'], 'ぎょ': ['gyo'],
  'じゃ': ['ja', 'jya', 'zya'], 'じゅ': ['ju', 'jyu', 'zyu'], 'じょ': ['jo', 'jyo', 'zyo'],
  'びゃ': ['bya'], 'びゅ': ['byu'], 'びょ': ['byo'],
  'ぴゃ': ['pya'], 'ぴゅ': ['pyu'], 'ぴょ': ['pyo'],
  // 小さい母音を含む合成音は、合成綴り(fa など)に加えて
  // 「基音＋小さい母音(la/xa 系)」での分割入力も許容する。
  'ふぁ': ['fa', 'fula', 'fuxa', 'hula', 'huxa'],
  'ふぃ': ['fi', 'fuli', 'fuxi', 'huli', 'huxi'],
  'ふぇ': ['fe', 'fule', 'fuxe', 'hule', 'huxe'],
  'ふぉ': ['fo', 'fulo', 'fuxo', 'hulo', 'huxo'],
  'てぃ': ['thi', 'teli', 'texi'],
  'でぃ': ['dhi', 'deli', 'dexi'],
  'とぅ': ['twu', 'tolu', 'toxu'], 'どぅ': ['dwu', 'dolu', 'doxu'],
  'てゅ': ['thu'], 'でゅ': ['dhu'], 'ふゅ': ['fyu'],
  'つぁ': ['tsa'], 'つぃ': ['tsi'], 'つぇ': ['tse'], 'つぉ': ['tso'],
  'ちぇ': ['che', 'tye', 'cye'], 'しぇ': ['she', 'sye'], 'じぇ': ['je', 'jye', 'zye'],
  'うぁ': ['wha', 'ula', 'uxa'], 'うぃ': ['wi', 'whi', 'uli', 'uxi'],
  'うぇ': ['we', 'whe', 'ule', 'uxe'], 'うぉ': ['who', 'ulo', 'uxo'],
  'ゔ': ['vu'], // 単独の「ゔ」（ヴ）。これが無いと「ゔ」を含む読みが入力・追加できなかった。
  'ゔぁ': ['va', 'vula', 'vuxa'], 'ゔぃ': ['vi', 'vuli', 'vuxi'],
  'ゔぇ': ['ve', 'vule', 'vuxe'], 'ゔぉ': ['vo', 'vulo', 'vuxo'],
  'ゔゃ': ['vya'], 'ゔゅ': ['vyu'], 'ゔょ': ['vyo'],
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
  // 促音「っ」は次の音の頭の子音を重ねる表記をデフォルトにする（例: きって→t）。
  // xtu/ltu などの明示入力も引き続き許容する。
  tokens.forEach((tk, idx) => {
    if (tk.kana !== 'っ') return;
    const next = tokens[idx + 1];
    const c = next?.romaji[0]?.[0];
    if (c && !'aiueon'.includes(c)) {
      tk.romaji = [c, 'xtu', 'xtsu', 'ltu', 'ltsu'];
    }
  });
  return tokens;
};

// --- 振り仮名（ルビ）セグメント生成 ---
// 漢字部分にだけ振り仮名を付けるため、display を「漢字ラン / かな・記号ラン」に分け、
// reading を手がかりに各漢字ランの読みを切り出す。
export interface RubySeg {
  text: string;
  rt?: string; // 漢字ランのみ読みを持つ
}

// CJK 漢字（＋反復記号など）か判定する。
const isKanjiChar = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x4e00 && c <= 0x9fff) || // CJK統合漢字
    (c >= 0x3400 && c <= 0x4dbf) || // 拡張A
    ch === '々' ||
    ch === '〆' ||
    ch === 'ヶ' ||
    ch === 'ヵ'
  );
};

// カタカナ→ひらがな（reading[ひらがな]と照合するため）。
const kataToHira = (s: string): string =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// display と reading から、漢字部分にだけ rt（振り仮名）を付けたセグメント列を返す。
// ひらがな・カタカナ・記号には rt を付けない。
export function buildRuby(display: string, reading: string): RubySeg[] {
  // 同種文字（漢字 / 非漢字）が続く範囲をランにまとめる。
  const runs: { text: string; kanji: boolean }[] = [];
  for (const ch of display) {
    const kanji = isKanjiChar(ch);
    const last = runs[runs.length - 1];
    if (last && last.kanji === kanji) last.text += ch;
    else runs.push({ text: ch, kanji });
  }

  const hasKanji = runs.some((r) => r.kanji);
  if (!hasKanji) {
    // 漢字なし。表示にラテン文字など「日本語の仮名以外」が含まれ、かつ読みと違うなら
    // 語全体に読みをルビとして乗せる（海外艦名 Bismarck/Ark Royal などを原語表示）。
    const isKana = (c: string) => {
      const o = c.codePointAt(0) ?? 0;
      return (o >= 0x3040 && o <= 0x309f) || (o >= 0x30a0 && o <= 0x30ff);
    };
    const foreign = [...display].some((c) => !isKana(c) && !/[\sー・]/.test(c));
    if (foreign && reading && reading !== display) return [{ text: display, rt: reading }];
    // それ以外（かなのみ）は振り仮名不要。
    return runs.map((r) => ({ text: r.text }));
  }

  const segs: RubySeg[] = [];
  let ri = 0; // reading 内のポインタ
  let consistent = true; // display のかなが reading 内に順番どおり現れるか
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run.kanji) {
      // かな/記号ランは reading 上をそのまま進める（カタカナはひらがな化して照合）。
      const hira = kataToHira(run.text);
      if (reading.startsWith(hira, ri)) ri += hira.length;
      else consistent = false; // 表示中のかなが読みに無い＝当て字的で対応づけ不能
      segs.push({ text: run.text });
    } else {
      // 次のかなランの位置を手がかりに、この漢字ランの読みを切り出す。
      const next = runs[i + 1];
      let furi: string;
      if (next) {
        const nextHira = kataToHira(next.text);
        const idx = reading.indexOf(nextHira, ri);
        if (idx >= 0) {
          furi = reading.slice(ri, idx);
          ri = idx;
        } else {
          // 次のかなランを読み中に見つけられない＝対応づけ不能。
          furi = reading.slice(ri);
          ri = reading.length;
          consistent = false;
        }
      } else {
        furi = reading.slice(ri);
        ri = reading.length;
      }
      segs.push({ text: run.text, rt: furi || undefined });
    }
  }

  // 「打ち止め＝ラストオーダー」のように、表示のかなが読みに対応しない当て字では
  // 上のアルゴリズムが先頭の漢字に読みを全振りしてしまう。その場合は単語全体を
  // ひとつのルビ単位にして、読みを語全体の上に乗せる（漫画のルビと同じ振る舞い）。
  if (!consistent) return [{ text: display, rt: reading }];
  return segs;
}

// 読み（かな）が最後までローマ字入力できるか検証する（追加語句のバリデーション用）。
export function isTypeableReading(reading: string): boolean {
  if (!reading) return false;
  // 1文字ずつローマ字表に存在するか（漢字・カタカナ・記号など打てない文字を弾く）。
  // tokenizeWord は未知文字をそのまま通すため、ここで明示的に弾く必要がある。
  for (const c of reading) {
    if (!ROMAJI_MAP[c]) return false;
  }
  const toks = tokenizeWord(reading);
  if (toks.length === 0) return false;
  // トークンのかなを連結して元の読みと一致し、かつ全トークンに綴り候補があること。
  const joined = toks.map((t) => t.kana).join('');
  if (joined !== reading) return false;
  return toks.every((t) => t.romaji && t.romaji.length > 0 && t.romaji[0].length > 0);
}
