import { useEffect, useRef, useState } from 'react';
import { X, Check, Crop } from 'lucide-react';

interface Props {
  src: string; // 元画像の dataURL
  onCancel: () => void;
  onConfirm: (crop: { x: number; y: number; w: number; h: number }) => void; // 元画像ピクセル座標
  aspect?: number | null; // 初期の縦横比(幅/高さ)。null=自由。未指定は画面比率
  title?: string;
}

interface Rect { x: number; y: number; w: number; h: number }

const screenAspect = () => (typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9);

// 背景／盤面画像の「どこを切り取るか」を選ぶ画面。
// 選択枠をドラッグ移動／右下ハンドルでリサイズ。縦横比はプリセットから選べる（固定/自由）。
export default function ImageCropper({ src, onCancel, onConfirm, aspect, title = '切り取る範囲を選ぶ' }: Props) {
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [asp, setAsp] = useState<number | null>(aspect === undefined ? screenAspect() : aspect);
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; o: Rect } | null>(null);

  // 縦横比に合わせて、表示領域内に収まる中央の枠を作る。
  const fitRect = (dw: number, dh: number, a: number | null, prev?: Rect): Rect => {
    if (a == null) {
      const w = prev ? Math.min(prev.w, dw) : dw * 0.85;
      const h = prev ? Math.min(prev.h, dh) : dh * 0.85;
      return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
    }
    let w = dw * 0.9;
    let h = w / a;
    if (h > dh * 0.9) { h = dh * 0.9; w = h * a; }
    if (w > dw) { w = dw; h = w / a; }
    return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
  };

  useEffect(() => {
    const im = new Image();
    im.onload = () => {
      const maxW = 460, maxH = 420;
      let dw = Math.min(maxW, im.width);
      let dh = im.height * (dw / im.width);
      if (dh > maxH) { dh = maxH; dw = im.width * (dh / im.height); }
      dw = Math.round(dw); dh = Math.round(dh);
      setNat({ w: im.width, h: im.height });
      setDisp({ w: dw, h: dh });
      setSel(fitRect(dw, dh, aspect === undefined ? screenAspect() : aspect));
    };
    im.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // 縦横比プリセット変更時、現在の枠を作り直す。
  const changeAspect = (a: number | null) => { setAsp(a); if (disp.w) setSel(fitRect(disp.w, disp.h, a, sel)); };

  useEffect(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === 'move') {
        setSel({ ...d.o, x: clamp(d.o.x + dx, 0, disp.w - d.o.w), y: clamp(d.o.y + dy, 0, disp.h - d.o.h) });
      } else if (asp == null) {
        const w = clamp(d.o.w + dx, 40, disp.w - d.o.x);
        const h = clamp(d.o.h + dy, 40, disp.h - d.o.y);
        setSel({ ...d.o, w, h });
      } else {
        let w = clamp(d.o.w + dx, 40, disp.w - d.o.x);
        let h = w / asp;
        if (d.o.y + h > disp.h) { h = disp.h - d.o.y; w = h * asp; }
        setSel({ ...d.o, w, h });
      }
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [disp, asp]);

  const startMove = (e: React.PointerEvent) => { e.preventDefault(); drag.current = { mode: 'move', sx: e.clientX, sy: e.clientY, o: sel }; };
  const startResize = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); drag.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, o: sel }; };
  const useWhole = () => { setAsp(null); setSel({ x: 0, y: 0, w: disp.w, h: disp.h }); };

  const confirm = () => {
    const scale = nat.w / disp.w;
    onConfirm({ x: sel.x * scale, y: sel.y * scale, w: sel.w * scale, h: sel.h * scale });
  };

  const PRESETS: { label: string; a: number | null }[] = [
    { label: '自由', a: null },
    { label: '画面', a: screenAspect() },
    { label: '正方形', a: 1 },
    { label: '16:9', a: 16 / 9 },
    { label: '4:3', a: 4 / 3 },
    { label: '盤面(3:4)', a: 3 / 4 },
  ];
  const near = (x: number | null, y: number | null) => (x == null && y == null) || (x != null && y != null && Math.abs(x - y) < 0.01);

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-neutral-900 border border-white/10 rounded-2xl p-5 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black flex items-center gap-2 text-white">
            <Crop className="w-5 h-5 text-cyan-400" /> {title}
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* 縦横比プリセット */}
        <div className="flex flex-wrap gap-1 mb-3">
          {PRESETS.map((pr) => (
            <button
              key={pr.label}
              onClick={() => changeAspect(pr.a)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                near(asp, pr.a) ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
              }`}
            >
              {pr.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mb-3">枠をドラッグで移動 ／ 右下の角でサイズ変更。比率は上から選べます（「画面」は背景がそのまま、「盤面(3:4)」は盤面がそのまま表示されます）。</p>

        <div className="relative mx-auto select-none touch-none" style={{ width: disp.w, height: disp.h }}>
          <img src={src} alt="" className="absolute inset-0 w-full h-full object-fill rounded-lg pointer-events-none" draggable={false} />
          {disp.w > 0 && (
            <div
              onPointerDown={startMove}
              className="absolute border-2 border-cyan-400 cursor-move"
              style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
            >
              <div
                onPointerDown={startResize}
                className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-cyan-400 border-2 border-white cursor-se-resize"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-4 gap-2">
          <button onClick={useWhole} className="text-xs text-gray-400 hover:text-white underline">全体を使う</button>
          <div className="flex gap-2">
            <button onClick={onCancel} className="bg-neutral-800 hover:bg-neutral-700 rounded-lg px-4 py-2 text-sm font-bold">やめる</button>
            <button onClick={confirm} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-5 py-2 text-sm font-bold flex items-center gap-1">
              <Check className="w-4 h-4" /> 決定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
