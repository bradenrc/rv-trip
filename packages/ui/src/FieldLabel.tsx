/** Small mono uppercase label for form fields. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-rv-ink-faded">
      {children}
    </span>
  );
}
