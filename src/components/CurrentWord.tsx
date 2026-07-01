import type { Word } from '../lib/types';
import { buildRuby } from '../lib/words';
import type { ReadingMode } from '../lib/keyconfig';

interface CurrentWordProps {
  word: Word;
  tokenIndex: number;
  currentTyping: string;
  accent?: string; // 入力中トークンの色（Tailwind クラス）
  typedRomaji?: string[]; // 確定済みトークンで実際に打たれた綴り（index 揃え）
  romajiVisible?: boolean; // ローマ字ガイドを表示するか（ミス時のみ表示モード用）
  readingMode?: ReadingMode; // 読みの見せ方: full=ふりがな+かな / kana=かなのみ / none=漢字のみ
}

// 現在のお題の内側表示: 漢字＋ふりがな(ruby) / かな進捗 / ローマ字ガイド。
// 外枠カード（計器HUDの角ブラケット付き .tr-card）は親側で付ける。
export default function CurrentWord({ word, tokenIndex, currentTyping, accent = 'text-primary', typedRomaji = [], romajiVisible = true, readingMode = 'full' }: CurrentWordProps) {
  // 漢字部分にだけ振り仮名を付けたセグメント列。各セグメントが独立して折り返せるので、
  // まとめてルビを振った時の縦並びバグが起きない。
  const segs = buildRuby(word.display, word.reading);

  // 読みの長さに応じて文字サイズを段階的に縮小し、長文でもカード内に収める。
  const rlen = word.reading.length;
  const size = rlen <= 8 ? 'lg' : rlen <= 16 ? 'md' : rlen <= 26 ? 'sm' : 'xs';
  const kanjiFs = { lg: 'clamp(28px,3.4vw,50px)', md: 'clamp(23px,2.7vw,40px)', sm: 'clamp(18px,2.1vw,30px)', xs: 'clamp(15px,1.7vw,24px)' }[size];
  const kanaFs = { lg: 'clamp(15px,1.6vw,20px)', md: 'clamp(13px,1.4vw,17px)', sm: 'clamp(11px,1.2vw,15px)', xs: 'clamp(10px,1vw,13px)' }[size];
  const romajiFs = { lg: 'clamp(13px,1.3vw,17px)', md: 'clamp(12px,1.2vw,15px)', sm: 'clamp(11px,1.05vw,13px)', xs: 'clamp(10px,0.95vw,12px)' }[size];

  return (
    <>
      {/* 漢字＋ふりがな（漢字のみルビ・横並びで折り返し可能） */}
      <div
        className="flex flex-wrap justify-center items-end gap-x-1 gap-y-1 mb-2.5 font-bold text-text [text-wrap:balance]"
        style={{ fontSize: kanjiFs, lineHeight: 1.35, textShadow: '0 0 26px var(--glow)' }}
      >
        {segs.map((s, i) =>
          s.rt && readingMode === 'full' ? (
            <ruby key={i} className="tracking-wide" style={{ whiteSpace: 'nowrap', rubyPosition: 'over' }}>
              {s.text}
              <rt
                className="font-normal font-tech"
                style={{ fontSize: '0.28em', color: 'var(--primary)', opacity: 0.85, letterSpacing: '0.04em', textShadow: '0 0 8px var(--glow)', lineHeight: 1 }}
              >
                {s.rt}
              </rt>
            </ruby>
          ) : (
            <span key={i} className="tracking-wide" style={{ whiteSpace: 'nowrap' }}>
              {s.text}
            </span>
          ),
        )}
      </div>

      {/* かな（打鍵進捗のハイライト）。長文でも折り返せるようにする。
          readingMode='none'（漢字のみ）の時は読みを隠すため非表示。 */}
      {readingMode !== 'none' && (
        <div
          className="flex flex-wrap justify-center items-center font-semibold mb-2.5"
          style={{ fontSize: kanaFs }}
        >
          {word.tokens.map((t, i) => {
            const done = i < tokenIndex;
            const active = i === tokenIndex;
            return (
              <span
                key={i}
                className={`transition-colors duration-100 ${active ? accent : done ? 'text-text' : 'text-muted'}`}
                style={done ? { textShadow: '0 0 8px rgba(232,244,255,.3)' } : active ? { textShadow: '0 0 16px var(--glow)' } : { opacity: 0.55 }}
              >
                {t.kana}
              </span>
            );
          })}
        </div>
      )}

      {/* 漢字のみ(none)モード: 読みは隠したまま、何文字打ったかだけ●で示す進捗表示。 */}
      {readingMode === 'none' && (
        <div className="flex flex-wrap justify-center items-center gap-1.5 mb-2.5 min-h-[1.4em]">
          {word.tokens.map((_, i) => (
            <span
              key={i}
              className={`text-base leading-none ${i < tokenIndex ? 'text-primary' : i === tokenIndex ? 'text-primary' : 'text-muted'}`}
              style={i < tokenIndex ? { textShadow: '0 0 5px var(--glow)' } : i === tokenIndex ? { opacity: 0.7 } : { opacity: 0.6 }}
            >
              {i === tokenIndex ? '◉' : '●'}
            </span>
          ))}
        </div>
      )}

      {/* ローマ字ガイド: 入力済みは薄く残し、次に打つ1文字だけを強調する。
          「ミス時のみ表示」モードでは romajiVisible=false の間は高さだけ確保して隠す。
          readingMode='none'（漢字のみ）の時はローマ字も隠して完全に読みを伏せる。 */}
      <div className="flex flex-wrap justify-center items-center font-mono2 min-h-[1.4em]" style={{ fontSize: romajiFs, letterSpacing: '0.08em' }}>
        {readingMode !== 'none' && romajiVisible && word.tokens.map((t, i) => {
          // そのトークンに表示する綴り：確定済みは実際に打った綴り、入力中は入力に合う候補、未入力は既定。
          const str =
            i < tokenIndex
              ? typedRomaji[i] ?? t.romaji[0]
              : i === tokenIndex
                ? t.romaji.find((r) => r.startsWith(currentTyping)) || t.romaji[0]
                : t.romaji[0];
          const typedLen = i < tokenIndex ? str.length : i === tokenIndex ? currentTyping.length : 0;
          return (
            <span key={i} className="flex" style={i > 0 ? { marginLeft: '0.3em' } : undefined}>
              {str.split('').map((ch, j) => {
                const isTyped = j < typedLen;
                const isNext = i === tokenIndex && j === typedLen; // 次に打つべき1文字
                return (
                  <span
                    key={j}
                    className={isNext ? 'text-primary font-bold' : 'text-muted'}
                    style={isNext ? { textShadow: '0 0 16px var(--glow), 0 0 4px var(--glow)' } : isTyped ? { opacity: 0.5 } : undefined}
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
