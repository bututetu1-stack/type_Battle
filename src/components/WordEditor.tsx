import { useRef, useState } from 'react';
import { X, Plus, Trash2, BookPlus } from 'lucide-react';
import { validReading, type CustomWord } from '../lib/customwords';

interface Props {
  words: CustomWord[];
  onChange: (list: CustomWord[]) => void;
  onClose: () => void;
  title?: string;
  readOnly?: boolean; // 閲覧のみ（オンラインで非ホストのとき）
  note?: string;
}

// 追加語句の編集（端末保存／オンライン共有の両方で使う共通UI）。
export default function WordEditor({ words, onChange, onClose, title = '語句の追加', readOnly = false, note }: Props) {
  const [display, setDisplay] = useState('');
  const [reading, setReading] = useState('');
  const [err, setErr] = useState('');
  const displayRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const d = display.trim();
    const r = reading.trim();
    if (!d || !r) { setErr('表示と読みの両方を入力してください'); return; }
    // 「ゔ」など濁点付き含むひらがな（ぁ-ゖ）＋長音符を許可。
    if (!/^[ぁ-ゖー]+$/.test(r)) { setErr('読みは「ひらがな」で入力してください'); return; }
    if (!validReading(r)) { setErr('この読みは入力（タイピング）できません。表記を見直してください'); return; }
    if (words.some((w) => w.display === d && w.reading === r)) { setErr('すでに追加されています'); return; }
    onChange([...words, { display: d, reading: r }]);
    setDisplay(''); setReading(''); setErr('');
    displayRef.current?.focus(); // 追加後は次の入力のため「表示」へカーソルを戻す
  };

  const remove = (i: number) => onChange(words.filter((_, idx) => idx !== i));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black flex items-center gap-2 text-white">
            <BookPlus className="w-5 h-5 text-fuchsia-400" /> {title}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {note && <p className="text-[11px] text-gray-500 mb-3">{note}</p>}

        {!readOnly && (
          <div className="bg-neutral-950/50 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-gray-500">表示（漢字など）</label>
                <input
                  ref={displayRef}
                  value={display}
                  onChange={(e) => setDisplay(e.target.value)}
                  placeholder="例: 鍾乳洞"
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-neutral-800 border border-white/10 text-sm text-white outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">読み（ひらがな）</label>
                <input
                  value={reading}
                  onChange={(e) => setReading(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                  placeholder="例: しょうにゅうどう"
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-neutral-800 border border-white/10 text-sm text-white outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}
            <button
              onClick={add}
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 rounded-lg px-3 py-2 font-bold text-sm flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" /> 追加
            </button>
          </div>
        )}

        <div className="text-xs text-gray-500 mb-1.5">追加済み（{words.length}）</div>
        {words.length === 0 ? (
          <p className="text-[11px] text-gray-600 py-4 text-center">まだ追加された語句はありません</p>
        ) : (
          <div className="bg-neutral-950/40 rounded-xl divide-y divide-white/5 max-h-64 overflow-y-auto">
            {words.map((w, i) => (
              <div key={`${w.display}|${w.reading}|${i}`} className="flex items-center justify-between px-3 py-2">
                <span className="min-w-0">
                  <span className="text-sm text-white font-bold">{w.display}</span>
                  <span className="text-[11px] text-gray-500 ml-2">{w.reading}</span>
                </span>
                {!readOnly && (
                  <button onClick={() => remove(i)} className="text-gray-500 hover:text-red-400 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-5 py-2 font-bold text-sm">閉じる</button>
        </div>
      </div>
    </div>
  );
}
