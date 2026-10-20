import type { ReactNode } from 'react';

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
