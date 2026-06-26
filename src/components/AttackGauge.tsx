import { Swords } from 'lucide-react';

interface AttackGaugeProps {
  progress: number; // 次の攻撃までのゲージ進捗（クリア数ベース / ミスでリセットされない）
  combo: number; // 連鎖（＝アタック数の元。ミスでリセットされる）
  pinch?: boolean; // ピンチ倍率の対象か
  badges?: number; // バッジ倍率
}

// 進捗（5クリアごと発射）とその時送れる攻撃量を表示。
// ミスをしても進捗は減らず、攻撃量(=連鎖)だけがリセットされる。
export default function AttackGauge({ progress, combo, pinch, badges = 0 }: AttackGaugeProps) {
  const seg = ((progress % 5) + 5) % 5; // 0..4 現在の進捗
  let amount = Math.max(1, Math.floor(combo / 5)); // 連鎖が低くても最低1は撃てる
  if (pinch) amount = Math.round(amount * 1.5);
  amount = Math.round(amount * (1 + 0.25 * Math.min(badges, 4)));
  amount = Math.min(amount, 5); // ATTACK_CAP と一致

  return (
    <div className="w-full max-w-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 tracking-wide flex items-center gap-1">
          <Swords className="w-3.5 h-3.5 text-orange-400" /> 攻撃チャージ
          <span className="text-[10px] text-gray-600">（5クリアごとに発射）</span>
        </span>
        <span className={`text-sm font-black flex items-center gap-1 ${pinch ? 'text-red-400' : 'text-orange-300'}`}>
          次の攻撃 +{amount}
          {pinch && <span className="text-[10px] text-red-400">ピンチ×1.5</span>}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`h-3.5 flex-1 rounded transition-colors ${
              i < seg
                ? pinch
                  ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                  : 'bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]'
                : 'bg-neutral-800 border border-neutral-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
