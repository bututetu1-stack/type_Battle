import type { Word } from '../lib/types';
import { buildRuby } from '../lib/words';

interface CurrentWordProps {
  word: Word;
  tokenIndex: number;
  currentTyping: string;
  accent?: string; // 入力中トークンの色（Tailwind クラス）
  typedRomaji?: string[]; // 確定済みトークンで実際に打たれた綴り（index 揃え）
}

// 現在のお題の内側表示: 漢字＋ふりがな(ruby) / かな進捗 / ローマ字ガイド。
// 外枠カード（種別ごとの色）は親側で付ける。
export default function CurrentWord({ word, tokenIndex, currentTyping, accent = 'text-cyan-400', typedRomaji = [] }: CurrentWordProps) {
  // 漢字部分にだけ振り仮名を付けたセグメント列。長文でも各セグメントが
  // 独立して折り返せるので、まとめてルビを振った時の縦並びバグが起きない。
  const segs = buildRuby(word.display, word.reading);

  return (
    <>
      {/* 漢字＋ふりがな（漢字のみルビ・横並びで折り返し可能） */}
      <div className="flex flex-wrap justify-center items-end gap-x-0.5 gap-y-1 mb-3 leading-tight">
        {segs.map((s, i) =>
          s.rt ? (
            <ruby key={i} className="text-3xl md:text-4xl font-bold tracking-wide">
              {s.text}
              <rt className="text-sm md:text-base text-cyan-200/80 font-normal tracking-tight">{s.rt}</rt>
            </ruby>
          ) : (
            <span key={i} className="text-3xl md:text-4xl font-bold tracking-wide">
              {s.text}
            </span>
          ),
        )}
      </div>

      {/* かな（打鍵進捗のハイライト）。長文でも折り返せるようにする。 */}
      <div className="flex flex-wrap justify-center items-center text-xl md:text-2xl font-bold tracking-widest mb-3">
        {word.tokens.map((t, i) => {
          let colorClass = 'text-gray-500';
          if (i < tokenIndex) colorClass = 'text-white/90 drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]';
          if (i === tokenIndex) colorClass = accent;
          return (
            <span key={i} className={`${colorClass} transition-colors duration-100`}>
              {t.kana}
            </span>
          );
        })}
      </div>

      {/* ローマ字ガイド: 入力済みは薄く残し、次に打つ1文字だけを強調する */}
      <div className="flex flex-wrap justify-center items-center text-lg md:text-xl font-mono tracking-[0.15em] min-h-[1.6em]">
        {word.tokens.map((t, i) => {
          // そのトークンに表示する綴り：確定済みは実際に打った綴り、入力中は入力に合う候補、未入力は既定。
          const str =
            i < tokenIndex
              ? typedRomaji[i] ?? t.romaji[0]
              : i === tokenIndex
                ? t.romaji.find((r) => r.startsWith(currentTyping)) || t.romaji[0]
                : t.romaji[0];
          const typedLen = i < tokenIndex ? str.length : i === tokenIndex ? currentTyping.length : 0;
          return (
            <span key={i} className="flex">
              {str.split('').map((ch, j) => {
                const isTyped = j < typedLen;
                const isNext = i === tokenIndex && j === typedLen; // 次に打つべき1文字
                return (
                  <span
                    key={j}
                    className={
                      isNext
                        ? 'text-cyan-300 font-bold drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]'
                        : isTyped
                          ? 'text-gray-600'
                          : 'text-gray-400'
                    }
                  >
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </>
  );
}
