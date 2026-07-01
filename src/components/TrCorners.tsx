// 計器HUDカードの四隅ブラケット装飾。親は position:relative であること。
export default function TrCorners({ color = 'var(--primary)' }: { color?: string }) {
  const base = 'absolute pointer-events-none';
  const s = { width: 16, height: 16, opacity: 0.55 } as const;
  return (
    <>
      <span className={base} style={{ ...s, top: 12, left: 12, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <span className={base} style={{ ...s, top: 12, right: 12, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
      <span className={base} style={{ ...s, bottom: 12, left: 12, borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <span className={base} style={{ ...s, bottom: 12, right: 12, borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
    </>
  );
}
