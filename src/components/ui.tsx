import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

// 選択式のボタン群（セグメント）。options の value を一つだけ選ぶ。
export function Seg<T extends string | number | boolean>({
  value, options, onChange, label,
}: {
  value: T | null; // null = どれにも当てはまらない（カスタム調整中など）
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string; // 読み上げ用のグループ名
}) {
  return (
    <div className="ui-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-on={value === o.value}
          onClick={() => onChange(o.value)}
          className="ui-seg-btn"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 入力欄の見出し＋補足。
export function Field({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-text">{label}</span>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      {children}
    </div>
  );
}

// 見出し付きの面。
export function Panel({ title, icon, aside, children }: { title: string; icon?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-panel p-5">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-text">
          {icon && <span className="text-muted">{icon}</span>}
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="ui-kbd">{children}</kbd>;

// アイコンだけのボタン（読み上げ用の名前は必須）。
export const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-neutral-800 transition-colors"
  >
    {children}
  </button>
);

// スライダー横の ±1段ボタン。
const StepBtn = ({ onClick, label, disabled, children }: { onClick: () => void; label: string; disabled?: boolean; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    disabled={disabled}
    className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold shrink-0 text-text transition-colors hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
    style={{ background: 'rgb(var(--n-50) / 0.05)', border: '1px solid var(--line)' }}
  >
    {children}
  </button>
);

// 設定のスライダー1行（見出し・現在値・補足・±ボタン）。disabled なら値を見せるだけ（オンラインの参加者など）。
export const CfgSlider = ({
  label, value, display, min, max, step, onChange, hint, disabled,
}: {
  label: string; value: number; display: string; min: number; max: number; step: number;
  onChange: (v: number) => void; hint?: string; disabled?: boolean;
}) => {
  const id = useId();
  const round = (v: number) => Math.round(v * 1000) / 1000; // 0.5等の浮動小数を丸める
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm text-text">{label}</label>
        <span className="font-tech text-[15px] font-semibold tabular-nums text-cyan-200">{display}</span>
      </div>
      {hint && <div className="text-xs text-muted mt-0.5 leading-snug">{hint}</div>}
      {!disabled && (
        <div className="flex items-center gap-2.5 mt-2">
          <StepBtn label={`${label}を下げる`} onClick={() => onChange(round(Math.max(min, value - step)))}>−</StepBtn>
          <input
            id={id}
            type="range" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 ui-range"
          />
          <StepBtn label={`${label}を上げる`} onClick={() => onChange(round(Math.min(max, value + step)))}>＋</StepBtn>
        </div>
      )}
    </div>
  );
};

// 折りたたみできる設定セクション（見出し＋開閉）。項目を分類して、普段は隠しておける。
export const CfgSection = ({
  title, icon, aside, defaultOpen = false, children,
}: {
  title: string; icon: ReactNode; aside?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t first:border-t-0" style={{ borderColor: 'var(--line)' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-[15px] font-semibold text-text">
          <span className="text-muted">{icon}</span>{title}
        </span>
        <span className="flex items-center gap-3">
          {aside}
          <ChevronDown className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="pb-5 flex flex-col gap-5">{children}</div>}
    </div>
  );
};
