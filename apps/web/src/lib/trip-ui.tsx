import type { IsoDate, Place } from "@rv-trip/core";

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

// ── drive-time estimate (haversine at a nominal RV highway speed) ──────────
export function estimateDrive(
  from: Place,
  to: Place,
  avgKmh = 75,
): { miles: number; minutes: number; label: string } | null {
  if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) return null;
  const R = 6371;
  const dLat = deg(to.lat - from.lat);
  const dLng = deg(to.lng - from.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(deg(from.lat)) * Math.cos(deg(to.lat));
  const km = 2 * R * Math.asin(Math.sqrt(h));
  const miles = Math.round(km * 0.621371);
  const minutes = Math.round((km / avgKmh) * 60);
  const h2 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const time = h2 > 0 ? `${h2}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  return { miles, minutes, label: `~${time} · ${miles} mi` };
}
function deg(x: number): number {
  return (x * Math.PI) / 180;
}
