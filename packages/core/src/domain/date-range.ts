import type { IsoDate } from "./types";

/**
 * The RangePicker's arithmetic (#127 · Q6 A · Q7 B) — pure, so the web
 * component (`packages/ui/src/RangePicker.tsx`) and its phone twin
 * (`apps/mobile/src/ui.tsx`) draw the same month, count the same nights and
 * raise the same amber guard.
 *
 * Plain `YYYY-MM-DD` strings throughout, parsed as UTC midnight — a trip day
 * has no timezone.
 */

/** A picked range. `end` is null between the first and the second tap. */
export interface DateRangeValue {
  start: IsoDate | null;
  end: IsoDate | null;
}

/** The trip's own span — the band the picker always shows. */
export interface DateSpan {
  start: IsoDate;
  end: IsoDate;
}

const DAY = 86_400_000;
const ms = (d: IsoDate) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number): IsoDate => new Date(t).toISOString().slice(0, 10);

export function addDaysIso(d: IsoDate, n: number): IsoDate {
  return iso(ms(d) + n * DAY);
}

/** Nights between check-in and check-out ("Oct 10 → Oct 13" is 3). */
export function rangeNights(start: IsoDate, end: IsoDate): number {
  return Math.round((ms(end) - ms(start)) / DAY);
}

/** A complete range, forward (a one-day range is legal: 0 nights). */
export function isCompleteRange(v: DateRangeValue): v is DateSpan {
  return v.start !== null && v.end !== null && v.start <= v.end;
}

/**
 * A day tapped. The first tap (or a tap after a complete range) starts a new
 * range; the second closes it — and a second tap BEFORE the start swaps the
 * two, so the pick is always forward.
 */
export function pickDay(v: DateRangeValue, day: IsoDate): DateRangeValue {
  if (v.start === null || v.end !== null) return { start: day, end: null };
  return day < v.start ? { start: day, end: v.start } : { start: v.start, end: day };
}

/** How many picked days fall OUTSIDE the trip span (0 = inside, or no span). */
export function daysOutsideSpan(v: DateSpan, span: DateSpan | null | undefined): number {
  if (!span) return 0;
  let n = 0;
  for (let t = ms(v.start); t <= ms(v.end); t += DAY) {
    const d = iso(t);
    if (d < span.start || d > span.end) n++;
  }
  return n;
}

/** The trip span widened just enough to hold the pick — what "Extend trip"
 * hands `onExtendTrip` (Q7 B). The span itself when nothing sticks out. */
export function widenedSpan(v: DateSpan, span: DateSpan): DateSpan {
  return {
    start: v.start < span.start ? v.start : span.start,
    end: v.end > span.end ? v.end : span.end,
  };
}

/** Everything the picker's footer says about a pick. */
export interface RangePickState {
  nights: number;
  /** Days of the pick that sit outside the trip — the amber guard. */
  outsideDays: number;
  /** Set exactly when `outsideDays > 0`: the span "Extend trip" would move to. */
  extendTo: DateSpan | null;
  /** The pick IS the trip span — the "✓ whole trip" line. */
  wholeTrip: boolean;
}

export function rangePickState(v: DateSpan, span: DateSpan | null | undefined): RangePickState {
  const outsideDays = daysOutsideSpan(v, span);
  return {
    nights: rangeNights(v.start, v.end),
    outsideDays,
    extendTo: span && outsideDays > 0 ? widenedSpan(v, span) : null,
    wholeTrip: !!span && v.start === span.start && v.end === span.end,
  };
}

/** "3 nights" · "1 night" · "day trip". */
export function nightsLabel(n: number): string {
  if (n <= 0) return "day trip";
  return `${n} night${n === 1 ? "" : "s"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Oct 10" */
export function shortDay(d: IsoDate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

/** "Oct 10 → Oct 13" — the picker's big line. */
export function rangeLabel(v: DateSpan): string {
  return `${shortDay(v.start)} → ${shortDay(v.end)}`;
}

/** "Oct 10 – 14" (same month) or "Oct 30 – Nov 2" — the Extend chip's span. */
export function spanLabel(s: DateSpan): string {
  return s.start.slice(0, 7) === s.end.slice(0, 7)
    ? `${shortDay(s.start)} – ${Number(s.end.slice(8, 10))}`
    : `${shortDay(s.start)} – ${shortDay(s.end)}`;
}

/** "October 2026" */
export function monthTitle(month: string): string {
  return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** "YYYY-MM" of a date, and the month `n` away from it. */
export function monthOf(d: IsoDate): string {
  return d.slice(0, 7);
}
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const date = new Date(Date.UTC(y, m, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * The month as a Sunday-first grid of weeks — null for the blank lead-in and
 * tail cells, so every row has seven.
 */
export function monthGrid(month: string): (IsoDate | null)[][] {
  const first = `${month}-01`;
  const lead = new Date(ms(first)).getUTCDay();
  const days: (IsoDate | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.slice(0, 7) === month; d = addDaysIso(d, 1)) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** How one day cell paints. */
export interface DayCellState {
  /** Inside the trip band (rv-navy-soft). */
  inTrip: boolean;
  /** First / last day of the trip band — the pill caps. */
  tripStart: boolean;
  tripEnd: boolean;
  /** Inside the picked range. */
  picked: boolean;
  /** The range's own start or end (the solid disc). */
  edge: boolean;
  /** Picked AND outside the trip — amber, not green (Q7 B). */
  outside: boolean;
}

export function dayCellState(
  day: IsoDate,
  v: DateRangeValue,
  span: DateSpan | null | undefined,
): DayCellState {
  const inTrip = !!span && day >= span.start && day <= span.end;
  const start = v.start;
  const end = v.end ?? v.start;
  const picked = start !== null && end !== null && day >= start && day <= end;
  const edge = picked && (day === start || day === end);
  return {
    inTrip,
    tripStart: !!span && day === span.start,
    tripEnd: !!span && day === span.end,
    picked,
    edge,
    outside: picked && !!span && !inTrip,
  };
}

/** The nights stepper on the stay form: move check-out, never before check-in. */
export function stepNights(v: DateSpan, delta: number): DateSpan {
  const end = addDaysIso(v.end, delta);
  return end < v.start ? v : { start: v.start, end };
}
