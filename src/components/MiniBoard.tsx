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
  bgImage?: string; // そのプレイヤーが設定した背景画像（共有）。あれば盤面背景にして棒グラフは透過。
}

// 周囲プレイヤー（または solo のダミー）を表す小さな盤面ゲージ。計器HUDのトークン色を使用。
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
  bgImage,
}: MiniBoardProps) {
  if (isKO) {
    return (
      <div
        className="aspect-[3/4] rounded-md border flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="font-black text-2xl rotate-[-15deg]" style={{ color: 'var(--muted)', opacity: 0.5 }}>K.O.</div>
        {name && <div className="absolute bottom-0.5 inset-x-0 text-center text-[8px] truncate px-1" style={{ color: 'var(--muted)' }}>{name}</div>}
      </div>
    );
  }

  const dangerLevel = height / max;
  // 縁の強調色: 攻撃対象=charge / 被攻撃=incoming / 自分=primary / 危険=incoming。
  const accent = hit ? 'var(--charge)' : incoming ? 'var(--incoming)' : highlight ? 'var(--primary)' : dangerLevel > 0.7 ? 'var(--incoming)' : null;
  const barColor = dangerLevel > 0.7 ? 'var(--incoming)' : highlight ? 'var(--primary)' : 'var(--muted)';

  return (
    <div
      className="aspect-[3/4] rounded-md border p-1 flex flex-col justify-end transition-all duration-200 relative"
      style={{
        background: accent ? 'var(--surface2)' : 'var(--surface)',
        borderColor: accent ?? 'var(--line)',
        boxShadow: accent ? `0 0 10px ${accent}` : 'none',
        transform: hit || incoming ? 'scale(1.05)' : undefined,
      }}
    >
      {/* プレイヤー設定の背景画像（共有）。あれば盤面の背景にする。 */}
      {bgImage && (
        <div
          className="absolute inset-0 rounded-md bg-center bg-cover pointer-events-none"
          style={{ backgroundImage: `url("${bgImage}")` }}
        />
      )}
      <div className={`relative w-full flex gap-[1px] h-full items-end ${bgImage ? 'opacity-40' : 'opacity-70'}`}>
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className="flex-1 transition-all duration-300"
            style={{ height: `${((max - i) / max) * 100}%`, background: max - i <= height ? barColor : 'transparent' }}
          />
        ))}
      </div>
      {combo !== undefined && combo > 2 && (
        <div className="absolute top-0.5 right-0.5 text-[9px] font-bold" style={{ color: 'var(--primary)' }}>{combo}c</div>
      )}
      {str !== undefined && (
        // 強さを★1〜3で表示（強いほど赤寄り）。
        <div className="absolute top-0.5 left-0.5 text-[8px] font-bold" style={{ color: str >= 0.66 ? 'var(--incoming)' : str >= 0.33 ? 'var(--charge)' : 'var(--muted)' }}>
          {'★'.repeat(str >= 0.66 ? 3 : str >= 0.33 ? 2 : 1)}
        </div>
      )}
      {itemEmoji && (
        <div className="absolute top-0.5 left-0.5 text-sm animate-in zoom-in duration-200 drop-shadow">{itemEmoji}</div>
      )}
      {name && (
        <div className="absolute bottom-0.5 inset-x-0 text-center text-[8px] truncate px-1" style={{ color: 'var(--muted)' }}>{name}</div>
      )}
    </div>
  );
}
