interface MiniBoardProps {
  height: number;
  max: number;
  isKO: boolean;
  name?: string;
  combo?: number;
  highlight?: boolean; // 自分自身を強調
  hit?: boolean; // 直近に自分が攻撃した対象
  incoming?: boolean; // 直近に自分を攻撃してきた相手
  itemEmoji?: string; // 直近に使用したアイテムのアイコン
  str?: number; // CPUの強さ(0..1)。表示でわかるよう★で表現
}

// 周囲プレイヤー（または solo のダミー）を表す小さな盤面ゲージ。
export default function MiniBoard({
  height,
  max,
  isKO,
  name,
  combo,
  highlight,
  hit,
  incoming,
  itemEmoji,
  str,
}: MiniBoardProps) {
  if (isKO) {
    return (
      <div className="aspect-[3/4] bg-neutral-900/40 rounded-md border border-neutral-800 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="text-neutral-700 font-black text-2xl rotate-[-15deg]">K.O.</div>
        <div className="absolute inset-0 bg-red-950/20 mix-blend-overlay" />
        {name && <div className="absolute bottom-0.5 inset-x-0 text-center text-[8px] text-neutral-600 truncate px-1">{name}</div>}
      </div>
    );
  }

  const dangerLevel = height / max;

  return (
    <div
      className={`aspect-[3/4] rounded-md border p-1 flex flex-col justify-end transition-all duration-200 relative ${
        hit
          ? 'border-orange-400 ring-2 ring-orange-400/80 bg-orange-950/30 scale-105 shadow-lg shadow-orange-500/30'
          : incoming
            ? 'border-red-500 ring-2 ring-red-500/80 bg-red-950/40 scale-105 shadow-lg shadow-red-500/40'
            : highlight
              ? 'border-cyan-500/70 bg-cyan-950/20'
              : dangerLevel > 0.7
                ? 'bg-red-950/20 border-red-900/50'
                : 'bg-neutral-900/50 border-neutral-800'
      }`}
    >
      <div className="w-full flex gap-[1px] h-full items-end opacity-60">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 transition-all duration-300 ${
              max - i <= height ? (dangerLevel > 0.7 ? 'bg-red-500' : highlight ? 'bg-cyan-400' : 'bg-gray-400') : 'bg-transparent'
            }`}
            style={{ height: `${((max - i) / max) * 100}%` }}
          />
        ))}
      </div>
      {combo !== undefined && combo > 2 && (
        <div className="absolute top-0.5 right-0.5 text-[9px] font-bold text-cyan-300">{combo}c</div>
      )}
      {str !== undefined && (
        // 強さを★1〜3で表示（強いほど赤寄り）。
        <div
          className={`absolute top-0.5 left-0.5 text-[8px] font-bold ${
            str >= 0.66 ? 'text-red-400' : str >= 0.33 ? 'text-yellow-400' : 'text-gray-500'
          }`}
        >
          {'★'.repeat(str >= 0.66 ? 3 : str >= 0.33 ? 2 : 1)}
        </div>
      )}
      {itemEmoji && (
        <div className="absolute top-0.5 left-0.5 text-sm animate-in zoom-in duration-200 drop-shadow">{itemEmoji}</div>
      )}
      {name && (
        <div className="absolute bottom-0.5 inset-x-0 text-center text-[8px] text-gray-400 truncate px-1">{name}</div>
      )}
    </div>
  );
}
