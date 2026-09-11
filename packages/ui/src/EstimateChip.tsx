/**
 * An un-routed number is an unfinished measurement, not a warning — a neutral
 * chip, never amber. RouteNotice is the contrast its own doc comment draws:
 * amber is reserved for a real restriction the route avoided.
 *
 * It lives here rather than beside either caller because two app surfaces show
 * the same number now: the route rail's per-drive line
 * (apps/web/src/components/trip/RouteView.tsx) and the dashboard card's miles
 * chip (apps/web/src/components/dashboard/TripCard.tsx). Sharing the pill is
 * the only way neither one restyles it nor duplicates four token classes
 * (docs/design/43 §3).
 */
export function EstimateChip() {
  return (
    <span className="rounded-rv-pill border border-rv-border-hi px-2 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-rv-ink-faded">
      estimate
    </span>
  );
}
