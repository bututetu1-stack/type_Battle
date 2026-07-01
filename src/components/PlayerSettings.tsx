import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import {
  loadKeyConfig, saveKeyConfig, keyLabel, defaultKeyConfig,
  type KeyConfig, type InputMode,
} from '../lib/keyconfig';
import { CAT_META } from '../lib/items';
import { COLOR_THEMES, loadThemeId, saveThemeId, applyColorTheme, IMAGE_THEME_ID, fileToDataUrl, cropToBgImages, saveBgImage, clearBgImage, loadBgImage, cropToMiniImage, saveBoardImage, clearBoardImage, loadBoardImage } from '../lib/theme';
import ImageCropper from './ImageCropper';

// プレイヤー設定（入力方式＋キーコンフィグ）。ソロ/オンライン共通でlocalStorageに保存。
export default function PlayerSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<KeyConfig>(() => loadKeyConfig());
  const [themeId, setThemeId] = useState<string>(() => loadThemeId());
  const [hasImage, setHasImage] = useState<boolean>(() => !!loadBgImage());
  const [imgBusy, setImgBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null); // クロップ画面に渡す元画像
  const pickTheme = (id: string) => { setThemeId(id); saveThemeId(id); applyColorTheme(id); };
  // アップロード → まずクロップ画面を開く。
  const onUploadBg = async (file: File | undefined) => {
    if (!file) return;
    setImgBusy(true);
    try { setCropSrc(await fileToDataUrl(file)); } catch { /* 読み込み失敗は無視 */ }
    setImgBusy(false);
  };
  // クロップ確定 → フル/ミニを生成して保存・適用。
  const onCropConfirm = async (crop: { x: number; y: number; w: number; h: number }) => {
    if (!cropSrc) return;
    try {
      const { full, mini } = await cropToBgImages(cropSrc, crop);
      saveBgImage(full, mini);
      setHasImage(true);
      pickTheme(IMAGE_THEME_ID);
    } catch { /* 失敗は無視 */ }
    setCropSrc(null);
  };
  const removeBg = () => { clearBgImage(); setHasImage(false); pickTheme(COLOR_THEMES[0].id); };
  // 盤面(ミニボード)専用画像（任意・3:4でクロップ）。
  const [hasBoard, setHasBoard] = useState<boolean>(() => !!loadBoardImage());
  const [boardCropSrc, setBoardCropSrc] = useState<string | null>(null);
  const onUploadBoard = async (file: File | undefined) => {
    if (!file) return;
    try { setBoardCropSrc(await fileToDataUrl(file)); } catch { /* 無視 */ }
  };
  const onBoardCropConfirm = async (crop: { x: number; y: number; w: number; h: number }) => {
    if (!boardCropSrc) return;
    try { saveBoardImage(await cropToMiniImage(boardCropSrc, crop)); setHasBoard(true); } catch { /* 無視 */ }
    setBoardCropSrc(null);
  };
  const removeBoard = () => { clearBoardImage(); setHasBoard(false); };
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
      <span className="text-sm text-text">{label}</span>
      <button
        onClick={() => setCapturing(bindId)}
        className={`min-w-[5rem] px-3 py-1 rounded-lg text-sm font-mono2 font-bold border transition-colors ${
          capturing === bindId
            ? 'border-primary bg-surface2 text-primary animate-pulse'
            : 'border-line bg-surface text-text hover:bg-surface2'
        }`}
      >
        {capturing === bindId ? 'キー入力…' : keyLabel(value)}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="tr-card w-full max-w-md max-h-[85vh] overflow-y-auto p-5"
        style={{ background: 'var(--bg2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black font-tech flex items-center gap-2 text-text">
            <Keyboard className="w-5 h-5 text-primary" /> プレイヤー設定
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text"><X className="w-5 h-5" /></button>
        </div>

        {/* 入力方式 */}
        <div className="mb-4">
          <div className="text-xs text-muted mb-1.5">アイテムの入力方式</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'cycle', label: 'スロット切替式', desc: '1キーで切替→発動' },
              { id: 'direct', label: '直接キー式', desc: 'スロットごとに即発動' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-lg px-3 py-2 text-left border transition-colors ${
                  cfg.inputMode === m.id ? 'bg-surface2 border-primary text-primary' : 'bg-surface border-line text-muted hover:bg-surface2'
                }`}
              >
                <div className="text-sm font-bold">{m.label}</div>
                <div className="text-[10px] text-muted">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* カラーテーマ（背景の雰囲気） */}
        <div className="mb-4">
          <div className="text-xs text-muted mb-1.5">カラーテーマ（背景）</div>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTheme(t.id)}
                className={`rounded-lg px-1 py-2 flex flex-col items-center gap-1 border transition-colors ${
                  themeId === t.id ? 'border-primary bg-surface2' : 'border-line bg-surface hover:bg-surface2'
                }`}
              >
                <span className="w-7 h-7 rounded-full border border-white/20" style={{ background: t.css }} />
                <span className={`text-[10px] font-bold ${themeId === t.id ? 'text-primary' : 'text-muted'}`}>{t.label}</span>
              </button>
            ))}
            {/* 背景画像（自分のPCから） */}
            <label
              className={`rounded-lg px-1 py-2 flex flex-col items-center gap-1 border cursor-pointer transition-colors ${
                themeId === IMAGE_THEME_ID ? 'border-primary bg-surface2' : 'border-line bg-surface hover:bg-surface2'
              }`}
            >
              <span className="w-7 h-7 rounded-full border border-line flex items-center justify-center text-sm" style={{ background: 'var(--bg)' }}>🖼</span>
              <span className={`text-[10px] font-bold ${themeId === IMAGE_THEME_ID ? 'text-primary' : 'text-muted'}`}>{imgBusy ? '処理中' : '画像'}</span>
              <input type="file" accept="image/*" className="hidden" onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} onChange={(e) => onUploadBg(e.target.files?.[0])} />
            </label>
          </div>
          {hasImage && (
            <div className="flex items-center justify-between mt-2 text-[10px] text-muted">
              <span>背景画像を設定中（盤面用画像が未設定なら、オンラインの盤面背景にもこの中央が使われます）</span>
              <button onClick={removeBg} className="text-incoming hover:opacity-80 underline shrink-0 ml-2">削除</button>
            </div>
          )}

          {/* 盤面(ミニボード)専用画像（任意・縦長3:4） */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">盤面（ミニボード）用画像 <span className="text-muted">任意・縦長3:4</span></span>
            <div className="flex items-center gap-2 shrink-0">
              {hasBoard && <span className="text-[10px] text-primary">設定中</span>}
              {hasBoard && <button onClick={removeBoard} className="text-[10px] text-incoming hover:opacity-80 underline">削除</button>}
              <label className="tr-btn-ghost text-[11px] font-bold rounded-lg px-3 py-1 cursor-pointer">
                {hasBoard ? '変更' : 'アップロード'}
                <input type="file" accept="image/*" className="hidden" onClick={(e) => { (e.target as HTMLInputElement).value = ''; }} onChange={(e) => onUploadBoard(e.target.files?.[0])} />
              </label>
            </div>
          </div>
          <p className="text-[10px] text-muted mt-1">※ 盤面用画像を設定すると、オンラインで他の人から見えるあなたの盤面（棒グラフ）の背景に、背景画像とは別の画像を使えます。</p>
        </div>

        {/* ローマ字（つづり）の表示タイミング */}
        <div className="mb-4">
          <div className="text-xs text-muted mb-1.5">ローマ字（つづり）の表示</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'always', label: '常に表示', desc: 'いつでもつづりを表示' },
              { id: 'mistake', label: 'ミス時のみ', desc: '入力を間違えた時だけ表示' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => update({ ...cfg, romajiMode: m.id })}
                className={`rounded-lg px-3 py-2 text-left border transition-colors ${
                  cfg.romajiMode === m.id ? 'bg-surface2 border-primary text-primary' : 'bg-surface border-line text-muted hover:bg-surface2'
                }`}
              >
                <div className="text-sm font-bold">{m.label}</div>
                <div className="text-[10px] text-muted">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* お題の読みの見せ方。「漢字のみ」でふりがな・かな・ローマ字を全部隠す難読チャレンジ。 */}
        <div className="mb-4">
          <div className="text-xs text-muted mb-1.5">お題の読み（むずかしさ）</div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'full', label: 'ふりがな', desc: '漢字の上に読み＋かな' },
              { id: 'kana', label: 'かなのみ', desc: 'ふりがな無し・かなは表示' },
              { id: 'none', label: '漢字のみ', desc: '読みを全部隠す（難読）' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => update({ ...cfg, readingMode: m.id })}
                className={`rounded-lg px-2 py-2 text-left border transition-colors ${
                  cfg.readingMode === m.id ? 'bg-surface2 border-primary text-primary' : 'bg-surface border-line text-muted hover:bg-surface2'
                }`}
              >
                <div className="text-sm font-bold">{m.label}</div>
                <div className="text-[10px] text-muted">{m.desc}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted mt-1">※「漢字のみ」は ふりがな・かな・ローマ字をすべて隠します（漢字を見て読みを打つ）。</p>
        </div>

        {/* キー割当 */}
        <div className="bg-surface rounded-xl p-3 divide-y divide-line">
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

        <p className="text-[10px] text-muted mt-2 leading-relaxed">
          ※ ボタンを押してから設定したいキーを押してください（Escでキャンセル）。
          タイピングに使う文字キーは避けてください（数字キーや Space/Enter 推奨）。
        </p>

        <div className="flex justify-between items-center mt-4">
          <button
            onClick={() => update(defaultKeyConfig())}
            className="text-xs text-muted hover:text-text underline"
          >
            既定に戻す
          </button>
          <button onClick={onClose} className="tr-btn px-5 py-2 font-bold text-sm">
            閉じる
          </button>
        </div>
      </div>

      {cropSrc && (
        <ImageCropper src={cropSrc} onCancel={() => setCropSrc(null)} onConfirm={onCropConfirm} title="背景の切り取り範囲を選ぶ" />
      )}
      {boardCropSrc && (
        <ImageCropper src={boardCropSrc} onCancel={() => setBoardCropSrc(null)} onConfirm={onBoardCropConfirm} aspect={3 / 4} title="盤面用の切り取り範囲を選ぶ（縦長）" />
      )}
    </div>
  );
}
