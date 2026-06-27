import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import {
  loadKeyConfig, saveKeyConfig, keyLabel, defaultKeyConfig,
  type KeyConfig, type InputMode,
} from '../lib/keyconfig';
import { CAT_META } from '../lib/items';

// プレイヤー設定（入力方式＋キーコンフィグ）。ソロ/オンライン共通でlocalStorageに保存。
export default function PlayerSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<KeyConfig>(() => loadKeyConfig());
  // 「capturing」中は次のキー入力でそのバインドを設定する。
  const [capturing, setCapturing] = useState<string | null>(null);

  const update = (next: KeyConfig) => { setCfg(next); saveKeyConfig(next); };

  // キー捕捉。capturing 中に押されたキーをそのバインドへ割り当てる。
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setCapturing(null); return; }
      const k = e.code; // 左右Shiftなどを区別するため code を保存
      const next: KeyConfig = JSON.parse(JSON.stringify(cfg));
      if (capturing === 'cycle') next.cycle = k;
      else if (capturing === 'fire') next.fire = k;
      else if (capturing === 'target') next.target = k;
      else if (capturing.startsWith('slot:')) {
        const cat = capturing.slice(5) as 'attack' | 'defense' | 'timed';
        next.slots[cat] = k;
      }
      update(next);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, cfg]);

  const setMode = (m: InputMode) => update({ ...cfg, inputMode: m });

  const KeyRow = ({ label, bindId, value }: { label: string; bindId: string; value: string }) => (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        onClick={() => setCapturing(bindId)}
        className={`min-w-[5rem] px-3 py-1 rounded-lg text-sm font-mono font-bold border transition-colors ${
          capturing === bindId
            ? 'border-cyan-400 bg-cyan-950/50 text-cyan-200 animate-pulse'
            : 'border-white/15 bg-neutral-800 text-gray-200 hover:bg-neutral-700'
        }`}
      >
        {capturing === bindId ? 'キー入力…' : keyLabel(value)}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black flex items-center gap-2 text-white">
            <Keyboard className="w-5 h-5 text-cyan-400" /> プレイヤー設定
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* 入力方式 */}
        <div className="mb-4">
          <div className="text-xs text-gray-500 mb-1.5">アイテムの入力方式</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'cycle', label: 'スロット切替式', desc: '1キーで切替→発動' },
              { id: 'direct', label: '直接キー式', desc: 'スロットごとに即発動' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-lg px-3 py-2 text-left border transition-colors ${
                  cfg.inputMode === m.id ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200' : 'bg-neutral-800 border-white/10 text-gray-400 hover:bg-neutral-700'
                }`}
              >
                <div className="text-sm font-bold">{m.label}</div>
                <div className="text-[10px] text-gray-500">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* キー割当 */}
        <div className="bg-neutral-950/50 rounded-xl p-3 divide-y divide-white/5">
          {cfg.inputMode === 'cycle' ? (
            <>
              <KeyRow label="スロット切替" bindId="cycle" value={cfg.cycle} />
              <KeyRow label="アイテム発動" bindId="fire" value={cfg.fire} />
            </>
          ) : (
            CAT_META.map((c) => (
              <KeyRow key={c.key} label={`${c.label}スロット 発動`} bindId={`slot:${c.key}`} value={cfg.slots[c.key]} />
            ))
          )}
          <KeyRow label="ターゲット切替" bindId="target" value={cfg.target} />
        </div>

        <p className="text-[10px] text-gray-600 mt-2 leading-relaxed">
          ※ ボタンを押してから設定したいキーを押してください（Escでキャンセル）。
          タイピングに使う文字キーは避けてください（数字キーや Space/Enter 推奨）。
        </p>

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => update(defaultKeyConfig())}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            既定に戻す
          </button>
          <button onClick={onClose} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-5 py-2 font-bold text-sm">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
