import { useRef, useState } from 'react';
import { X, Plus, Trash2, BookPlus, FolderPlus } from 'lucide-react';
import { validReading, sanitizeGroupName, type CustomWord } from '../lib/customwords';

interface Props {
  words: CustomWord[];
  onChange: (list: CustomWord[]) => void;
  onClose: () => void;
  title?: string;
  readOnly?: boolean; // 閲覧のみ（オンラインで非ホストのとき）
  note?: string;
  // 自作テーマ（グループ）機能。これらを渡すとテーマ分けUIが有効になる。
  groups?: string[];
  onGroupsChange?: (g: string[]) => void;
}

const ALL = '__all__';
const NONE = '__none__';

// 追加語句の編集（端末保存／オンライン共有の両方で使う共通UI）。
export default function WordEditor({ words, onChange, onClose, title = '語句の追加', readOnly = false, note, groups, onGroupsChange }: Props) {
  const [display, setDisplay] = useState('');
  const [reading, setReading] = useState('');
  const [err, setErr] = useState('');
  const [active, setActive] = useState<string>(ALL); // 表示中／追加先テーマ
  const [newGroup, setNewGroup] = useState('');
  const displayRef = useRef<HTMLInputElement>(null);

  const grouping = !!groups; // テーマ分け機能の有効/無効
  const groupList = groups ?? [];
  // 実在テーマが選択されていればそこへ追加、それ以外（すべて/未分類）は未分類で追加。
  const targetGroup = grouping && groupList.includes(active) ? active : undefined;

  const add = () => {
    const d = display.trim();
    const r = reading.trim();
    if (!d || !r) { setErr('表示と読みの両方を入力してください'); return; }
    // 「ゔ」など濁点付き含むひらがな（ぁ-ゖ）＋長音符を許可。
    if (!/^[ぁ-ゖー]+$/.test(r)) { setErr('読みは「ひらがな」で入力してください'); return; }
    if (!validReading(r)) { setErr('この読みは入力（タイピング）できません。表記を見直してください'); return; }
    if (words.some((w) => w.display === d && w.reading === r)) { setErr('すでに追加されています'); return; }
    onChange([...words, { display: d, reading: r, ...(targetGroup ? { group: targetGroup } : {}) }]);
    setDisplay(''); setReading(''); setErr('');
    displayRef.current?.focus(); // 追加後は次の入力のため「表示」へカーソルを戻す
  };

  const remove = (w: CustomWord) => onChange(words.filter((x) => x !== w));
  const reassign = (w: CustomWord, g: string) =>
    onChange(words.map((x) => (x === w ? { display: x.display, reading: x.reading, ...(g ? { group: g } : {}) } : x)));

  const addGroup = () => {
    const name = sanitizeGroupName(newGroup);
    if (!name) return;
    if (groupList.includes(name)) { setActive(name); setNewGroup(''); return; }
    onGroupsChange?.([...groupList, name]);
    setActive(name);
    setNewGroup('');
  };

  const deleteActiveGroup = () => {
    if (!groupList.includes(active)) return;
    // そのテーマの語句は「未分類」に戻す。
    onChange(words.map((w) => (w.group === active ? { display: w.display, reading: w.reading } : w)));
    onGroupsChange?.(groupList.filter((g) => g !== active));
    setActive(ALL);
  };

  const visible = words.filter((w) => {
    if (!grouping || active === ALL) return true;
    if (active === NONE) return !w.group;
    return w.group === active;
  });

  const groupCount = (g: string) => words.filter((w) => (g === NONE ? !w.group : w.group === g)).length;

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

        {/* テーマ（グループ）選択・管理 */}
        {grouping && (
          <div className="mb-3">
            <div className="text-[10px] text-gray-500 mb-1">テーマ（自作）</div>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: ALL, label: 'すべて' }, { id: NONE, label: '未分類' }, ...groupList.map((g) => ({ id: g, label: g }))].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                    active === t.id ? 'bg-fuchsia-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                  }`}
                >
                  {t.label}
                  <span className="ml-1 opacity-60">{t.id === ALL ? words.length : groupCount(t.id)}</span>
                </button>
              ))}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
                  placeholder="新しいテーマ名"
                  maxLength={20}
                  className="flex-1 px-2 py-1 rounded-lg bg-neutral-800 border border-white/10 text-xs text-white outline-none focus:border-fuchsia-500"
                />
                <button onClick={addGroup} className="bg-fuchsia-700 hover:bg-fuchsia-600 rounded-lg px-2 py-1 text-xs font-bold flex items-center gap-1">
                  <FolderPlus className="w-3.5 h-3.5" /> 作成
                </button>
                {groupList.includes(active) && (
                  <button onClick={deleteActiveGroup} title="このテーマを削除（語句は未分類へ）" className="text-gray-500 hover:text-red-400 px-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

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
            {grouping && (
              <p className="text-[10px] text-gray-500 mb-2">
                追加先テーマ: <span className="text-fuchsia-300 font-bold">{targetGroup ?? '未分類'}</span>
              </p>
            )}
            {err && <p className="text-[11px] text-red-400 mb-2">{err}</p>}
            <button
              onClick={add}
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-500 rounded-lg px-3 py-2 font-bold text-sm flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" /> 追加
            </button>
          </div>
        )}

        <div className="text-xs text-gray-500 mb-1.5">追加済み（{visible.length}{grouping && active !== ALL ? ` / 全${words.length}` : ''}）</div>
        {visible.length === 0 ? (
          <p className="text-[11px] text-gray-600 py-4 text-center">まだ追加された語句はありません</p>
        ) : (
          <div className="bg-neutral-950/40 rounded-xl divide-y divide-white/5 max-h-64 overflow-y-auto">
            {visible.map((w, i) => (
              <div key={`${w.display}|${w.reading}|${i}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="text-sm text-white font-bold">{w.display}</span>
                  <span className="text-[11px] text-gray-500 ml-2">{w.reading}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {grouping && !readOnly && (
                    <select
                      value={w.group ?? ''}
                      onChange={(e) => reassign(w, e.target.value)}
                      className="bg-neutral-800 border border-white/10 rounded px-1 py-0.5 text-[10px] text-gray-300 outline-none focus:border-fuchsia-500 max-w-[6rem]"
                    >
                      <option value="">未分類</option>
                      {groupList.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  )}
                  {!readOnly && (
                    <button onClick={() => remove(w)} className="text-gray-500 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
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
