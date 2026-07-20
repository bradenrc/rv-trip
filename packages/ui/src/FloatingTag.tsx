/**
 * The amber "Floating" pill that marks a dateless stop — one that lives in the
 * route sequence but isn't yet placed on the calendar.
 */
export function FloatingTag() {
  return (
    <span className="rounded-rv-pill bg-rv-warning-soft px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-rv-warning">
      Floating
    </span>
  );
}
