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
  bgImage?: string; // そのプレイヤーが設定した背景画像（共有）。あれば盤面背景にしてブロックは透過。
}

// 周囲プレイヤー（または solo のダミー）を表す小さな盤面。
// 山（処理待ちの単語）を下から積み上がるブロックで表し、満杯に近いほど赤くなる。
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
        className="aspect-[3/4] rounded-lg border flex flex-col items-center justify-center relative overflow-hidden"
        style={{ background: 'rgb(var(--n-950) / 0.5)', borderColor: 'var(--line)' }}
      >
        <div className="font-tech font-bold text-lg tracking-[0.2em] text-muted opacity-60">K.O.</div>
        {name && <div className="absolute bottom-1 inset-x-0 text-center text-xs truncate px-1 text-muted opacity-60">{name}</div>}
      </div>
    );
  }

  const dangerLevel = height / max;
  const danger = dangerLevel > 0.7;
  // 縁の強調色: 攻撃対象=charge / 被攻撃=incoming / 自分=primary / 危険=incoming。
  const accent = hit ? 'var(--charge)' : incoming ? 'var(--incoming)' : highlight ? 'var(--primary)' : danger ? 'var(--incoming)' : null;
  const block = danger ? 'var(--incoming)' : highlight ? 'var(--primary)' : 'rgb(var(--n-400))';

  return (
    <div
      className="aspect-[3/4] rounded-lg border p-1.5 pb-5 flex flex-col transition-all duration-200 relative overflow-hidden"
      style={{
        background: 'rgb(var(--n-950) / 0.55)',
        borderColor: accent ?? 'var(--line)',
        boxShadow: accent ? `0 0 0 1px ${accent}, 0 0 14px -2px ${accent}` : 'none',
        transform: hit || incoming ? 'scale(1.04)' : undefined,
      }}
    >
      {/* プレイヤー設定の背景画像（共有）。あれば盤面の背景にする。 */}
      {bgImage && (
        <div className="absolute inset-0 bg-center bg-cover pointer-events-none" style={{ backgroundImage: `url("${bgImage}")` }} />
      )}
      {/* 山のブロック（下から積む） */}
      <div className={`relative flex-1 min-h-0 flex flex-col-reverse gap-[2px] ${bgImage ? 'opacity-70' : ''}`}>
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-[2px] transition-colors duration-300"
            style={{ background: i < height ? block : 'rgb(var(--n-50) / 0.025)', opacity: i < height ? (danger ? 0.95 : 0.7) : 1 }}
          />
        ))}
      </div>
      {combo !== undefined && combo > 2 && (
        <div className="absolute top-1 right-1.5 font-tech text-xs font-bold tabular-nums text-cyan-300">{combo}連</div>
      )}
      {str !== undefined && !itemEmoji && (
        // 強さを★1〜3で表示（強いほど赤寄り）。
        <div className="absolute top-1 left-1.5 text-[11px] leading-none" style={{ color: str >= 0.66 ? 'var(--incoming)' : str >= 0.33 ? 'var(--charge)' : 'var(--muted)' }}>
          {'★'.repeat(str >= 0.66 ? 3 : str >= 0.33 ? 2 : 1)}
        </div>
      )}
      {itemEmoji && (
        <div className="absolute top-1 left-1 text-sm animate-in zoom-in duration-200 drop-shadow">{itemEmoji}</div>
      )}
      {name && (
        <div className="absolute bottom-1 inset-x-0 text-center text-xs truncate px-1 text-muted">{name}</div>
      )}
    </div>
  );
}
