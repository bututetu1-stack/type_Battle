import { Swords } from 'lucide-react';

interface AttackGaugeProps {
  combo: number;
  pinch?: boolean; // ピンチ倍率の対象か
  badges?: number; // バッジ倍率
}

// 次のマイルストーン（5連鎖ごと）までの進捗と、その瞬間に送れる攻撃量を表示。
export default function AttackGauge({ combo, pinch, badges = 0 }: AttackGaugeProps) {
  const seg = combo % 5; // 0..4 現在の進捗
  const nextMilestone = (Math.floor(combo / 5) + 1) * 5;
  let amount = Math.floor(nextMilestone / 5);
  if (pinch) amount = Math.round(amount * 1.5);
  amount = Math.round(amount * (1 + 0.25 * Math.min(badges, 4)));

  return (
    <div className="w-full max-w-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500 tracking-wider">次の攻撃チャージ</span>
        <span className={`text-xs font-bold flex items-center gap-1 ${pinch ? 'text-red-400' : 'text-orange-300'}`}>
          <Swords className="w-3 h-3" /> +{amount}
          {pinch && <span className="text-[9px] text-red-400">ピンチ×1.5</span>}
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-sm transition-colors ${
              i < seg ? (pinch ? 'bg-red-500' : 'bg-orange-400') : 'bg-neutral-800'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
