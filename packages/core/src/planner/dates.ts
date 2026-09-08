import type { IsoDate } from "../domain/types";

/**
 * Date formatting for the planner (plain YYYY-MM-DD, UTC — no tz drift).
 * Moved from apps/web/src/lib/trip-ui.tsx (C0, issue #31) so the native app
 * formats dates exactly the way the web does.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["S", "M", "T", "W", "T", "F", "S"];

function parts(d: IsoDate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y: y!, m: m!, day: day! };
}
export function monthAbbr(d: IsoDate): string {
  return MONTHS[parts(d).m - 1]!;
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
/** Add n days to a plain date (UTC arithmetic, never a local Date). */
export function addDays(d: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
