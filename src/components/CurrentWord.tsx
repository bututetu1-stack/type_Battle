import type { Word } from '../lib/types';

interface CurrentWordProps {
  word: Word;
  tokenIndex: number;
  currentTyping: string;
  accent?: string; // 入力中トークンの色（Tailwind クラス）
}

// 現在のお題の内側表示: 漢字＋ふりがな(ruby) / かな進捗 / ローマ字ガイド。
// 外枠カード（種別ごとの色）は親側で付ける。
export default function CurrentWord({ word, tokenIndex, currentTyping, accent = 'text-cyan-400' }: CurrentWordProps) {
  const hasKanji = word.display !== word.reading;

  return (
    <>
      {/* 漢字＋ふりがな */}
      <div className="flex justify-center mb-3">
        <ruby className="text-3xl md:text-4xl font-bold tracking-wide ruby-word">
          {word.display}
          {hasKanji && <rt className="text-[0.55rem] text-gray-400 font-normal">{word.reading}</rt>}
        </ruby>
      </div>

      {/* かな（打鍵進捗のハイライト） */}
      <div className="flex justify-center items-center text-xl md:text-2xl font-bold tracking-widest mb-3">
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

      {/* ローマ字ガイド */}
      <div className="flex justify-center items-center text-lg md:text-xl font-mono tracking-[0.2em]">
        {word.tokens.map((t, i) => {
          if (i < tokenIndex) {
            return (
              <span key={i} className="text-gray-600">
                {''.padEnd(t.romaji[0].length, '-')}
              </span>
            );
          }
          if (i === tokenIndex) {
            const target = t.romaji.find((r) => r.startsWith(currentTyping)) || t.romaji[0];
            return (
              <span key={i} className="flex">
                <span className="text-cyan-300">{currentTyping}</span>
                <span className="text-gray-400 opacity-70">{target.slice(currentTyping.length)}</span>
              </span>
            );
          }
          return (
            <span key={i} className="text-gray-500 opacity-50">
              {t.romaji[0]}
            </span>
          );
        })}
      </div>
    </>
  );
}
