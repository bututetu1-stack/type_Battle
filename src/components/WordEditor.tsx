import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, BookPlus, FolderPlus, FolderInput } from 'lucide-react';
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
  const [selected, setSelected] = useState<Set<string>>(new Set()); // 複数選択（key=display|reading）
  const [moveTarget, setMoveTarget] = useState(''); // 一括移動先テーマ（''=未分類）
  const displayRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const dragModeRef = useRef<'add' | 'remove'>('add');
  const backdropDownRef = useRef(false); // 押し始めが背景か（ドラッグ選択が背景で離れても閉じない）

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

  // --- 複数選択（チェックボックス＋ドラッグ）でテーマ一括移動・一括削除 ---
  const keyOf = (w: CustomWord) => `${w.display}|${w.reading}`;
  const applySel = (k: string, mode: 'add' | 'remove') =>
    setSelected((prev) => { const n = new Set(prev); if (mode === 'add') n.add(k); else n.delete(k); return n; });
  const toggleOne = (w: CustomWord) =>
    setSelected((prev) => { const n = new Set(prev); const k = keyOf(w); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const startDrag = (w: CustomWord) => {
    const k = keyOf(w);
    dragModeRef.current = selected.has(k) ? 'remove' : 'add';
    draggingRef.current = true;
    applySel(k, dragModeRef.current);
  };
  const dragOver = (w: CustomWord) => { if (draggingRef.current) applySel(keyOf(w), dragModeRef.current); };
  useEffect(() => {
    const up = () => { draggingRef.current = false; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  const moveSelected = (g: string) => {
    onChange(words.map((w) => (selected.has(keyOf(w)) ? { display: w.display, reading: w.reading, ...(g ? { group: g } : {}) } : w)));
    setSelected(new Set());
  };
  const deleteSelected = () => {
    onChange(words.filter((w) => !selected.has(keyOf(w))));
    setSelected(new Set());
  };

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

  const multi = grouping && !readOnly; // 複数選択UIの有効/無効
  const visibleKeys = visible.map(keyOf);
  const allVisSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const selectAllVisible = () =>
    setSelected((prev) => { const n = new Set(prev); if (allVisSelected) visibleKeys.forEach((k) => n.delete(k)); else visibleKeys.forEach((k) => n.add(k)); return n; });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      // 背景クリックで閉じる。ただし「押し始めが背景のとき」だけ。行ドラッグ選択で
      // カーソルが背景に出てから離してもエディタが閉じない（誤操作防止）。
      onPointerDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onClick={() => { if (backdropDownRef.current) onClose(); }}
    >
      <div
        className="bg-bg2 border border-line rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black flex items-center gap-2 text-text">
            <BookPlus className="w-5 h-5 text-fuchsia-400" /> {title}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text"><X className="w-5 h-5" /></button>
        </div>

        {note && <p className="text-[11px] text-muted mb-3">{note}</p>}

        {/* テーマ（グループ）選択・管理 */}
        {grouping && (
          <div className="mb-3">
            <div className="text-[10px] text-muted mb-1">テーマ（自作）</div>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: ALL, label: 'すべて' }, { id: NONE, label: '未分類' }, ...groupList.map((g) => ({ id: g, label: g }))].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActive(t.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                    active === t.id ? 'bg-fuchsia-600 text-text' : 'bg-surface text-muted hover:bg-surface2'
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
                  className="flex-1 px-2 py-1 rounded-lg bg-surface border border-line text-xs text-text outline-none focus:border-fuchsia-500"
                />
                <button onClick={addGroup} className="bg-fuchsia-700 hover:bg-fuchsia-600 rounded-lg px-2 py-1 text-xs font-bold flex items-center gap-1">
                  <FolderPlus className="w-3.5 h-3.5" /> 作成
                </button>
                {groupList.includes(active) && (
                  <button onClick={deleteActiveGroup} title="このテーマを削除（語句は未分類へ）" className="text-muted hover:text-red-400 px-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="bg-bg/50 rounded-xl p-3 mb-3">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-[10px] text-muted">表示（漢字など）</label>
                <input
                  ref={displayRef}
                  value={display}
                  onChange={(e) => setDisplay(e.target.value)}
                  placeholder="例: 鍾乳洞"
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-surface border border-line text-sm text-text outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted">読み（ひらがな）</label>
                <input
                  value={reading}
                  onChange={(e) => setReading(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                  placeholder="例: しょうにゅうどう"
                  className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-surface border border-line text-sm text-text outline-none focus:border-primary"
                />
              </div>
            </div>
            {grouping && (
              <p className="text-[10px] text-muted mb-2">
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

        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted">追加済み（{visible.length}{grouping && active !== ALL ? ` / 全${words.length}` : ''}）</span>
          {multi && visible.length > 0 && (
            <label className="flex items-center gap-1 text-[10px] text-muted cursor-pointer select-none">
              <input type="checkbox" checked={allVisSelected} onChange={selectAllVisible} className="accent-fuchsia-500" />
              表示中を全選択
            </label>
          )}
        </div>

        {/* 一括操作バー（1件以上選択時）：テーマへ移動／削除 */}
        {multi && selected.size > 0 && (
          <div className="flex items-center gap-1.5 mb-2 bg-fuchsia-950/40 border border-fuchsia-700/40 rounded-lg px-2 py-1.5">
            <span className="text-[11px] text-fuchsia-200 font-bold shrink-0">{selected.size}件</span>
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="bg-surface border border-line rounded px-1 py-0.5 text-[10px] text-text outline-none focus:border-fuchsia-500 min-w-0 flex-1"
            >
              <option value="">未分類</option>
              {groupList.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <button onClick={() => moveSelected(moveTarget)} className="bg-fuchsia-600 hover:bg-fuchsia-500 rounded px-2 py-0.5 text-[10px] font-bold flex items-center gap-0.5 shrink-0">
              <FolderInput className="w-3 h-3" />移動
            </button>
            <button onClick={deleteSelected} className="text-muted hover:text-red-400 shrink-0" title="選択した語句を削除">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setSelected(new Set())} className="text-[10px] text-muted hover:text-text underline shrink-0">解除</button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-[11px] text-muted py-4 text-center">まだ追加された語句はありません</p>
        ) : (
          <>
          {multi && <p className="text-[9px] text-muted mb-1">チェック または 行をドラッグでまとめて選択 → 上のバーでテーマ移動</p>}
          <div className="bg-bg/40 rounded-xl divide-y divide-white/5 max-h-64 overflow-y-auto">
            {visible.map((w, i) => {
              const sel = selected.has(keyOf(w));
              return (
              <div
                key={`${w.display}|${w.reading}|${i}`}
                className={`flex items-center justify-between gap-2 px-3 py-2 select-none ${sel ? 'bg-fuchsia-600/20' : ''}`}
                onPointerDown={() => multi && startDrag(w)}
                onPointerEnter={() => multi && dragOver(w)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {multi && (
                    <input
                      type="checkbox"
                      checked={sel}
                      onChange={() => toggleOne(w)}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="accent-fuchsia-500 shrink-0"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="text-sm text-text font-bold">{w.display}</span>
                    <span className="text-[11px] text-muted ml-2">{w.reading}</span>
                    {grouping && w.group && <span className="text-[9px] text-fuchsia-300/70 ml-2">🗂{w.group}</span>}
                  </span>
                </div>
                {!readOnly && (
                  <button onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(w)} className="text-muted hover:text-red-400 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              );
            })}
          </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-5 py-2 font-bold text-sm">閉じる</button>
        </div>
      </div>
    </div>
  );
}
