import { useEffect, useState } from 'react';
import { Trophy, X, Globe, Smartphone, Loader2, RefreshCw } from 'lucide-react';
import { topScores, type ScoreMode } from '../lib/scores';
import { fetchGlobalTop, currentUid, LEADERBOARD_BUCKETS, type GlobalEntry } from '../lib/leaderboard';

interface RecordsBoardProps {
  initialMode?: ScoreMode;
  initialView?: 'local' | 'online';
  onClose: () => void;
}

const MODE_LABEL: Record<ScoreMode, string> = {
  timeattack: 'タイムアタック',
  royale: 'バトル',
};

const MODES: ScoreMode[] = ['timeattack', 'royale'];

// タブボタンのクラス（選択中はトークンのアクセント）。
function tab(active: boolean): string {
  return `flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
    active ? 'bg-surface2 border-primary text-primary' : 'bg-surface border-line text-muted hover:bg-surface2'
  }`;
}

// 端末ローカル＋グローバル（オンライン）のハイスコア表。
export default function RecordsBoard({ initialMode = 'timeattack', initialView = 'local', onClose }: RecordsBoardProps) {
  const [view, setView] = useState<'local' | 'online'>(initialView);
  const [mode, setMode] = useState<ScoreMode>(initialMode);
  const [bucket, setBucket] = useState<number>(60);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="tr-card w-full max-w-2xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="flex items-center gap-2 text-lg font-black font-tech text-warning" style={{ letterSpacing: '0.06em' }}>
            <Trophy className="w-5 h-5" /> ハイスコア記録
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text p-1" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* この端末 / オンライン の切替 */}
        <div className="flex gap-2 px-5 pt-4">
          <button onClick={() => setView('local')} className={tab(view === 'local')}>
            <Smartphone className="w-4 h-4" /> この端末
          </button>
          <button onClick={() => setView('online')} className={tab(view === 'online')}>
            <Globe className="w-4 h-4" /> オンライン
          </button>
        </div>

        {view === 'local' ? (
          <LocalView mode={mode} setMode={setMode} />
        ) : (
          <OnlineView bucket={bucket} setBucket={setBucket} />
        )}

        <div className="px-5 py-3 border-t border-line text-xs text-muted">
          {view === 'local'
            ? '※ 記録はこの端末のブラウザ内にのみ保存されます（各モード上位20件）。'
            : '※ タイムアタックの総合スコアを制限時間ごとに全プレイヤーで競うランキングです（各自の自己ベスト）。'}
        </div>
      </div>
    </div>
  );
}

// --- 端末ローカルのモード別ハイスコア ---
function LocalView({ mode, setMode }: { mode: ScoreMode; setMode: (m: ScoreMode) => void }) {
  const rows = topScores(mode);
  return (
    <>
      <div className="flex gap-2 px-5 pt-3">
        {MODES.map((m) => (
          <button key={m} onClick={() => setMode(m)} className={tab(mode === m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <Empty text="まだ記録がありません。ソロでプレイして記録を残そう。" />
        ) : (
          <ScoreTable rows={rows} />
        )}
      </div>
    </>
  );
}

// --- グローバル（オンライン）タイムアタックのランキング ---
function OnlineView({ bucket, setBucket }: { bucket: number; setBucket: (s: number) => void }) {
  const [rows, setRows] = useState<GlobalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    currentUid().then(setMyUid).catch(() => setMyUid(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchGlobalTop(bucket, 50)
      .then((list) => { if (!cancelled) { setRows(list); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [bucket, reloadKey]);

  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-3 flex-wrap">
        {LEADERBOARD_BUCKETS.map((s) => (
          <button key={s} onClick={() => setBucket(s)} className={tab(bucket === s)}>
            {s}秒
          </button>
        ))}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="tr-btn-ghost ml-auto flex items-center gap-1 px-2.5 py-2 text-xs"
          aria-label="再読み込み"
        >
          <RefreshCw className="w-3.5 h-3.5" /> 更新
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 text-muted py-12 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
          </div>
        ) : error ? (
          <Empty text="ランキングを取得できませんでした。通信状態を確認して「更新」してください。" />
        ) : rows.length === 0 ? (
          <Empty text="まだ記録がありません。このランキングの一番乗りを目指そう！" />
        ) : (
          <ScoreTable rows={rows} highlightUid={myUid} />
        )}
      </div>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center text-muted py-12 text-sm">{text}</div>;
}

// ローカル記録・グローバル記録の共通テーブル。
interface Row {
  uid?: string;
  name: string;
  score: number;
  keys: number;
  kps: number;
  acc: number;
  theme: string;
  ts: number;
}
function ScoreTable({ rows, highlightUid }: { rows: Row[]; highlightUid?: string | null }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted text-xs border-b border-line font-tech">
          <th className="text-left py-2 pr-2 font-normal">#</th>
          <th className="text-left py-2 pr-2 font-normal">名前</th>
          <th className="text-right py-2 px-2 font-normal">総合スコア</th>
          <th className="text-right py-2 px-2 font-normal">総打鍵</th>
          <th className="text-right py-2 px-2 font-normal">KPS</th>
          <th className="text-right py-2 px-2 font-normal">正確率</th>
          <th className="text-left py-2 pl-2 font-normal">テーマ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const mine = !!highlightUid && r.uid === highlightUid;
          return (
            <tr
              key={r.uid ?? r.ts}
              className={`border-b border-line ${i < 3 ? 'text-text' : 'text-muted'}`}
              style={mine ? { background: 'var(--surface2)' } : undefined}
            >
              <td className="py-2 pr-2 font-mono2">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
              </td>
              <td className="py-2 pr-2 truncate max-w-[8rem] text-text">
                {r.name}{mine && <span className="ml-1 text-[10px] text-primary">(あなた)</span>}
              </td>
              <td className="py-2 px-2 text-right font-mono2 font-bold text-charge">{r.score}</td>
              <td className="py-2 px-2 text-right font-mono2">{r.keys}</td>
              <td className="py-2 px-2 text-right font-mono2">{r.kps}</td>
              <td className="py-2 px-2 text-right font-mono2">{Math.round(r.acc * 100)}%</td>
              <td className="py-2 pl-2 text-muted truncate max-w-[8rem]">{themeLabel(r.theme)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// テーマID（'all' やカンマ区切り）を短い表示に整える。
function themeLabel(theme: string): string {
  if (!theme || theme === 'all' || theme === '') return '全テーマ';
  const parts = theme.split(',').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '全テーマ';
  return `${parts[0]} 他${parts.length - 1}`;
}
