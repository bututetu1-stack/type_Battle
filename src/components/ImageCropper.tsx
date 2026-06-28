import { useEffect, useRef, useState } from 'react';
import { X, Check, Crop } from 'lucide-react';

interface Props {
  src: string; // 元画像の dataURL
  onCancel: () => void;
  onConfirm: (crop: { x: number; y: number; w: number; h: number }) => void; // 元画像ピクセル座標
}

interface Rect { x: number; y: number; w: number; h: number }

// 背景画像の「どこを切り取るか」を選ぶ画面。
// 表示画像の上で選択枠をドラッグ移動／右下ハンドルでリサイズして範囲を決める。
export default function ImageCropper({ src, onCancel, onConfirm }: Props) {
  const [nat, setNat] = useState({ w: 0, h: 0 }); // 元画像サイズ
  const [disp, setDisp] = useState({ w: 0, h: 0 }); // 表示サイズ
  const [sel, setSel] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 }); // 表示座標の選択枠
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; o: Rect } | null>(null);
  // 切り取り枠の縦横比は「画面の比率」に固定する。こうすると全画面背景(cover)が
  // 再トリミングされず、選んだ枠がそのまま背景になる（枠＝実際の見た目が一致）。
  const aspect = useRef(typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9);

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
      // 画面比率に合わせた初期枠（表示内に収まるよう調整）。
      const a = aspect.current;
      let w = dw * 0.85;
      let h = w / a;
      if (h > dh * 0.9) { h = dh * 0.9; w = h * a; }
      if (w > dw) { w = dw; h = w / a; }
      setSel({ x: Math.round((dw - w) / 2), y: Math.round((dh - h) / 2), w: Math.round(w), h: Math.round(h) });
    };
    im.src = src;
  }, [src]);

  useEffect(() => {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === 'move') {
        setSel({ ...d.o, x: clamp(d.o.x + dx, 0, disp.w - d.o.w), y: clamp(d.o.y + dy, 0, disp.h - d.o.h) });
      } else {
        // 縦横比を保ったままリサイズ（はみ出さないようクランプ）。
        const a = aspect.current;
        let w = clamp(d.o.w + dx, 40, disp.w - d.o.x);
        let h = w / a;
        if (d.o.y + h > disp.h) { h = disp.h - d.o.y; w = h * a; }
        setSel({ ...d.o, w, h });
      }
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [disp]);

  const startMove = (e: React.PointerEvent) => { e.preventDefault(); drag.current = { mode: 'move', sx: e.clientX, sy: e.clientY, o: sel }; };
  const startResize = (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); drag.current = { mode: 'resize', sx: e.clientX, sy: e.clientY, o: sel }; };

  const useWhole = () => setSel({ x: 0, y: 0, w: disp.w, h: disp.h });

  const confirm = () => {
    const scale = nat.w / disp.w; // 表示→元画像
    onConfirm({ x: sel.x * scale, y: sel.y * scale, w: sel.w * scale, h: sel.h * scale });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-neutral-900 border border-white/10 rounded-2xl p-5 max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-black flex items-center gap-2 text-white">
            <Crop className="w-5 h-5 text-cyan-400" /> 切り取る範囲を選ぶ
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">枠をドラッグで移動 ／ 右下の角でサイズ変更（枠は画面の縦横比に固定）。選んだ範囲がそのまま背景になります。盤面(縦長)には中央あたりが表示されます。</p>

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
