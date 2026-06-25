interface MiniBoardProps {
  height: number;
  max: number;
  isKO: boolean;
  name?: string;
  combo?: number;
  highlight?: boolean; // 自分自身を強調
  hit?: boolean; // 直近に自分が攻撃した対象
}

// 周囲プレイヤー（または solo のダミー）を表す小さな盤面ゲージ。
export default function MiniBoard({ height, max, isKO, name, combo, highlight, hit }: MiniBoardProps) {
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
      {name && (
        <div className="absolute bottom-0.5 inset-x-0 text-center text-[8px] text-gray-400 truncate px-1">{name}</div>
      )}
    </div>
  );
}
