import { Swords } from 'lucide-react';

interface AttackGaugeProps {
  progress: number; // 次の攻撃までのゲージ進捗（クリア数ベース / ミスでリセットされない）
  combo: number; // 連鎖（＝アタック数の元。ミスでリセットされる）
  pinch?: boolean; // ピンチ倍率の対象か
  badges?: number; // バッジ倍率
  threshold?: number; // 何クリアごとに発射するか（ゲージ減少アイテムで 5→4 になる）
  unit?: string; // しきい値の単位表記（'クリア' or '文字'）
}

// 進捗（threshold クリアごと発射）とその時送れる攻撃量を表示。
// ミスをしても進捗は減らず、攻撃量(=連鎖)だけがリセットされる。
export default function AttackGauge({ progress, combo, pinch, badges = 0, threshold = 5, unit = 'クリア' }: AttackGaugeProps) {
  const seg = ((progress % threshold) + threshold) % threshold; // 0..threshold-1 現在の進捗
  // ブロック数が多すぎる（文字数方式）と細かすぎるので表示上は最大12分割に丸める。
  const segCount = Math.min(threshold, 12);
  const segFilled = Math.round((seg / threshold) * segCount);
  let amount = Math.max(1, Math.floor(combo / 5)); // 連鎖が低くても最低1は撃てる
  if (pinch) amount = Math.round(amount * 1.5);
  amount = Math.round(amount * (1 + 0.25 * Math.min(badges, 4)));
  amount = Math.min(amount, 5); // ATTACK_CAP と一致

  return (
    <div className="w-full max-w-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted tracking-wide flex items-center gap-1">
          <Swords className="w-3.5 h-3.5 text-charge" /> 攻撃チャージ
          <span className="text-[10px] text-muted">（{threshold}{unit}ごとに発射）</span>
        </span>
        <span className={`text-sm font-black font-tech flex items-center gap-1 ${pinch ? 'text-incoming' : 'text-charge'}`}>
          次の攻撃 +{amount}
          {pinch && <span className="text-[10px] text-incoming">ピンチ×1.5</span>}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: segCount }).map((_, i) => {
          const on = i < segFilled;
          const col = pinch ? 'var(--incoming)' : 'var(--charge)';
          return (
            <div
              key={i}
              className="h-3.5 flex-1 rounded transition-colors"
              style={{
                background: on ? col : 'var(--surface2)',
                border: on ? 'none' : '1px solid var(--line)',
                boxShadow: on ? `0 0 8px ${col}` : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
