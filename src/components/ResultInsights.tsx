import { useState } from 'react';
import { rankOf, topOf, type Tally } from '../lib/analytics';

interface Props {
  kps: number;
  acc: number; // 0..1
  score: number;
  prev: { score: number; kps: number } | null; // 今回を除いた自己ベスト（null=初記録）
  series: number[]; // 1秒ごとの KPS（移動平均済み）
  missKeys: Tally; // ミス時に打つべきだった文字ごとの回数
  missKana: Tally; // ミスした音（かな）ごとの回数
}

// リザルトの分析パネル: ランク判定・自己ベスト比較・速度の推移・苦手キー。
export default function ResultInsights({ kps, acc, score, prev, series, missKeys, missKana }: Props) {
  const r = rankOf(kps, acc);
  const totalMiss = Object.values(missKeys).reduce((a, b) => a + b, 0);
  return (
    <div className="w-full grid gap-4 text-left" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.35fr)' }}>
      {/* ランク（e-typing / 寿司打風の称号） */}
      <Panel>
        <div className="flex items-center gap-3">
          <div
            className="font-tech font-black leading-none text-cyan-300"
            style={{ fontSize: 44, textShadow: '0 0 18px var(--glow)' }}
            aria-label={`ランク ${r.rank.id}`}
          >
            {r.rank.id}
          </div>
          <div className="min-w-0">
            <div className="text-text font-bold text-base">{r.rank.title}</div>
            <div className="text-xs text-muted leading-snug">
              {!r.next
                ? '最高ランク到達'
                : r.accToNext != null
                  ? <>正確率 <b className="text-text">{Math.round(r.accToNext * 100)}%</b> 以上で「{r.next.title}」</>
                  : <>「{r.next.title}」まで あと <b className="text-text">{r.kpsToNext?.toFixed(1)}</b> KPS</>}
            </div>
            {r.penalty > 0 && <div className="text-xs text-muted">正確率が{acc < 0.8 ? '80' : '90'}%未満のため −{r.penalty}段</div>}
          </div>
        </div>
        <BestDiff kps={kps} score={score} prev={prev} />
      </Panel>

      {/* 速度の推移（Monkeytype 風） */}
      <Panel>
        <Sparkline series={series} />
      </Panel>

      {/* 苦手キー（タイプウェル / Keybr 風のヒートマップ） */}
      <div className="col-span-2">
        <Panel>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs font-bold text-text tracking-wide">苦手キー</div>
            {totalMiss > 0 && <ScaleLegend />}
          </div>
          {totalMiss === 0 ? (
            <div className="text-sm text-success font-bold py-2">ノーミス！ 苦手キーはありません</div>
          ) : (
            <div className="flex gap-4 items-start flex-wrap">
              <KeyboardHeat tally={missKeys} />
              <WeakList keys={missKeys} kana={missKana} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => <div className="ui-panel p-4 h-full">{children}</div>;

function BestDiff({ kps, score, prev }: Pick<Props, 'kps' | 'score' | 'prev'>) {
  if (!prev) return <div className="mt-2 text-xs text-muted">初めての記録です。次はこれを超えよう</div>;
  const ds = score - prev.score;
  const dk = Math.round((kps - prev.kps) * 10) / 10;
  if (ds > 0) {
    return (
      <div className="mt-2 text-xs font-bold text-warning">
        ★ 自己ベスト更新！ <span className="text-text">+{ds}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 text-xs text-muted leading-snug">
      自己ベストまで <b className="text-text">{-ds}</b> 点
      <span className="ml-2">KPS {dk >= 0 ? '▲' : '▼'}<b className="text-text">{Math.abs(dk).toFixed(1)}</b></span>
    </div>
  );
}

// 1系列の推移なので凡例は置かず、見出しで何の線かを示す。ホバーで秒ごとの値を読める。
function Sparkline({ series }: { series: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 260, H = 64, P = 4;
  const n = series.length;
  const max = Math.max(1, ...series);
  const avg = n ? series.reduce((a, b) => a + b, 0) / n : 0;
  const x = (i: number) => P + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * P));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${H - P}L${x(0).toFixed(1)},${H - P}Z` : '';
  const peak = series.indexOf(Math.max(...series));
  const hi = hover ?? n - 1;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-bold text-text tracking-wide">速度の推移（KPS）</div>
        <div className="text-xs text-muted font-tech">平均 {avg.toFixed(1)} ・ 最高 {Math.max(0, ...series).toFixed(1)}</div>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full block"
          style={{ height: H }}
          preserveAspectRatio="none"
          role="img"
          aria-label={`速度の推移。平均 ${avg.toFixed(1)}、最高 ${Math.max(0, ...series).toFixed(1)} KPS`}
          onMouseMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - b.left) / b.width) * (n - 1));
            setHover(Math.min(n - 1, Math.max(0, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* 平均の補助線（控えめ） */}
          <line x1={P} x2={W - P} y1={y(avg)} y2={y(avg)} stroke="var(--muted)" strokeOpacity={0.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="rgb(var(--ac-400) / .14)" />
          <path d={line} fill="none" stroke="rgb(var(--ac-400))" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={P} y2={H - P} stroke="var(--text)" strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* 点は SVG の伸縮で楕円にならないよう HTML で重ねる。普段は最高点と終点だけ、ホバーで値を読む */}
        {n > 0 && (
          <>
            {hover == null && peak !== n - 1 && <Dot left={x(peak) / W} top={y(series[peak]) / H} faint />}
            <Dot left={x(hi) / W} top={y(series[hi]) / H} />
            {hover != null && (
              <div
                className="absolute top-0.5 px-1.5 py-0.5 rounded text-xs font-tech text-text whitespace-nowrap pointer-events-none"
                style={{
                  left: `${(x(hi) / W) * 100}%`,
                  transform: `translateX(${x(hi) / W > 0.75 ? 'calc(-100% - 6px)' : '6px'})`,
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                }}
              >
                {hi + 1}秒目 {series[hi].toFixed(1)} KPS
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const Dot = ({ left, top, faint }: { left: number; top: number; faint?: boolean }) => (
  <span
    className="absolute rounded-full pointer-events-none"
    style={{
      left: `${left * 100}%`, top: `${top * 100}%`, width: 8, height: 8, transform: 'translate(-50%,-50%)',
      background: faint ? 'transparent' : 'rgb(var(--ac-300))',
      border: `2px solid ${faint ? 'rgb(var(--ac-300))' : 'var(--bg2)'}`,
      boxShadow: faint ? 'none' : '0 0 8px var(--glow)',
    }}
  />
);

// 回数 → 濃淡4段（アクセント1色の明暗。多いほど明るい）。0 は目立たない素地。
const STEPS = ['--ac-900', '--ac-700', '--ac-500', '--ac-300'];
const stepOf = (c: number, max: number) => Math.min(3, Math.ceil((c / max) * 4) - 1);

const ScaleLegend = () => (
  <div className="flex items-center gap-1 text-xs text-muted">
    少
    {STEPS.map((s) => <span key={s} className="inline-block rounded-sm" style={{ width: 10, height: 10, background: `rgb(var(${s}))` }} />)}
    多
  </div>
);

const ROWS: { keys: string; indent: number }[] = [
  { keys: '1234567890-', indent: 0 },
  { keys: 'qwertyuiop', indent: 0.5 },
  { keys: 'asdfghjkl', indent: 0.75 },
  { keys: 'zxcvbnm', indent: 1.25 },
];

function KeyboardHeat({ tally }: { tally: Tally }) {
  const max = Math.max(1, ...Object.values(tally));
  const K = 22, G = 3;
  return (
    <div className="flex flex-col" style={{ gap: G }} role="img" aria-label="ミスの多いキーを明るく示したキーボード">
      {ROWS.map((row) => (
        <div key={row.keys} className="flex" style={{ gap: G, paddingLeft: row.indent * (K + G) }}>
          {[...row.keys].map((k) => {
            const c = tally[k] ?? 0;
            const s = c > 0 ? stepOf(c, max) : -1;
            return (
              <span
                key={k}
                title={c ? `${k.toUpperCase()}: ${c}回ミス` : k.toUpperCase()}
                className="relative flex items-center justify-center rounded font-mono2 uppercase"
                style={{
                  width: K, height: K, fontSize: 12,
                  background: s >= 0 ? `rgb(var(${STEPS[s]}))` : 'rgba(255,255,255,.04)',
                  border: '1px solid var(--line)',
                  color: s >= 2 ? 'var(--bg)' : s >= 0 ? 'var(--text)' : 'var(--muted)',
                  fontWeight: s >= 0 ? 700 : 400,
                }}
              >
                {k}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ヒートマップを文字でも読めるように、多い順の一覧を並べる。
function WeakList({ keys, kana }: { keys: Tally; kana: Tally }) {
  const tk = topOf(keys, 3);
  const tn = topOf(kana, 3);
  return (
    <div className="flex-1 min-w-[9rem] text-xs grid gap-2">
      <div>
        <div className="text-muted mb-1">キー</div>
        <div className="flex flex-wrap gap-1">
          {tk.map((x) => <span key={x.key} className="tr-chip font-mono2"><b className="uppercase">{x.key}</b>×{x.count}</span>)}
        </div>
      </div>
      <div>
        <div className="text-muted mb-1">音</div>
        <div className="flex flex-wrap gap-1">
          {tn.map((x) => <span key={x.key} className="tr-chip"><b>{x.key}</b>×{x.count}</span>)}
        </div>
      </div>
    </div>
  );
}
