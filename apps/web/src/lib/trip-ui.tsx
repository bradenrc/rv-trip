import type { IsoDate } from "@rv-trip/core";

// ── date formatting (plain YYYY-MM-DD, UTC — no tz drift) ──────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function parts(d: IsoDate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y: y!, m: m!, day: day! };
}
export function monthDay(d: IsoDate): string {
  const p = parts(d);
  return `${MONTHS[p.m - 1]} ${p.day}`;
}
export function weekdayLetter(d: IsoDate): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return WD[dt.getUTCDay()]!;
}
/** "Aug 2–5" from a start/end; single day if equal. */
export function dateRange(start: IsoDate, end: IsoDate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${MONTHS[a.m - 1]} ${a.day}`;
  if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.day}–${b.day}`;
  return `${monthDay(start)} – ${monthDay(end)}`;
}
export function fullRange(start: IsoDate, end: IsoDate): string {
  const a = parts(start);
  const b = parts(end);
  const yr = b.y;
  if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.day} – ${b.day}, ${yr}`;
  return `${monthDay(start)} – ${monthDay(end)}, ${yr}`;
}

// The drive-time estimate that used to live here is gone. It was a SECOND
// haversine (at 75 km/h) duplicating StubRoutingProvider's (at 80), and it was
// the one the app actually rendered. There is now one implementation —
// `estimateRoute` in @rv-trip/core — and the stub wraps it.
