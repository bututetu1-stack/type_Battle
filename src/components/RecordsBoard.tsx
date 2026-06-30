import { useState } from 'react';
import { Trophy, X } from 'lucide-react';
import { topScores, type ScoreMode } from '../lib/scores';

interface RecordsBoardProps {
  initialMode?: ScoreMode;
  onClose: () => void;
}

const MODE_LABEL: Record<ScoreMode, string> = {
  timeattack: 'タイムアタック',
  royale: 'バトル',
};

const MODES: ScoreMode[] = ['timeattack', 'royale'];

// 端末ローカルのハイスコア表（モード別タブ）。総合スコア降順で上位を表示する。
export default function RecordsBoard({ initialMode = 'timeattack', onClose }: RecordsBoardProps) {
  const [mode, setMode] = useState<ScoreMode>(initialMode);
  const rows = topScores(mode);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="flex items-center gap-2 text-lg font-black text-yellow-300">
            <Trophy className="w-5 h-5" /> ハイスコア記録
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 px-5 pt-4">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                mode === m
                  ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200'
                  : 'bg-neutral-800 border-white/10 text-gray-400 hover:bg-neutral-700'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {rows.length === 0 ? (
            <div className="text-center text-gray-500 py-12 text-sm">
              まだ記録がありません。ソロでプレイして「記録を保存」しよう。
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs border-b border-white/10">
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
                {rows.map((r, i) => (
                  <tr key={r.ts} className={`border-b border-white/5 ${i < 3 ? 'text-white' : 'text-gray-300'}`}>
                    <td className="py-2 pr-2 font-mono">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </td>
                    <td className="py-2 pr-2 truncate max-w-[8rem]">{r.name}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-amber-300">{r.score}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.keys}</td>
                    <td className="py-2 px-2 text-right font-mono">{r.kps}</td>
                    <td className="py-2 px-2 text-right font-mono">{Math.round(r.acc * 100)}%</td>
                    <td className="py-2 pl-2 text-gray-500 truncate max-w-[8rem]">{themeLabel(r.theme)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 text-xs text-gray-500">
          ※ 記録はこの端末のブラウザ内にのみ保存されます（各モード上位20件）。
        </div>
      </div>
    </div>
  );
}

// テーマID（'all' やカンマ区切り）を短い表示に整える。
function themeLabel(theme: string): string {
  if (!theme || theme === 'all' || theme === '') return '全テーマ';
  const parts = theme.split(',').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '全テーマ';
  return `${parts[0]} 他${parts.length - 1}`;
}
