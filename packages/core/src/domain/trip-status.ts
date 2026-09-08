import type { IsoDate, Stop, Trip, TripStatus } from "./types";
import { isScheduled } from "./types";

/**
 * The trip's derived read (its status) and the one guard on its write (a date
 * range that would orphan a scheduled stop). Both are pure and live beside
 * `deriveDays` for the same reason it does: status is a PROJECTION of the
 * calendar, never a stored fact, so a trip crosses from planning into upcoming
 * with the clock without anybody writing to it.
 *
 * The single stored fact is the OVERRIDE: `statusAuto = false` pins `status` to
 * whatever is in the column and the derivation steps aside.
 */

/** How close a start date has to be before a trip reads as "upcoming". */
export const UPCOMING_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Today as a plain 'YYYY-MM-DD' — the same calendar vocabulary the rest of the
 * grammar works in. UTC, so it never drifts a day under a local offset. */
export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `today` to `date`. Negative once `date` is in the past. */
export function daysUntil(date: IsoDate, today: IsoDate): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / MS_PER_DAY,
  );
}

/** The fields the derivation reads — a `Trip` satisfies it, and so does a row. */
export type TripStatusInput = Pick<
  Trip,
  "startDate" | "endDate" | "status" | "statusAuto"
>;

/**
 * What a trip reads as today.
 *
 * A manual choice always wins. Otherwise: a trip that has ended is complete, a
 * trip starting within the next 30 days is upcoming, everything else is
 * planning. A trip you are ON right now has a negative `daysUntil`, so it
 * satisfies `<= 30` and reads as upcoming — the enum has three states and none
 * of them is "traveling", so in-progress reads as upcoming deliberately.
 */
export function deriveTripStatus(t: TripStatusInput, today: IsoDate): TripStatus {
  if (!t.statusAuto) return t.status;
  if (t.endDate < today) return "complete";
  if (daysUntil(t.startDate, today) <= UPCOMING_WINDOW_DAYS) return "upcoming";
  return "planning";
}

// ── the one refusal on a trip write ────────────────────────────────────────

/** A scheduled stop a proposed trip range would push (partly) off the calendar. */
export interface OrphanedStop {
  id: string;
  name: string;
  arriveDate: IsoDate;
  departDate: IsoDate;
}

/**
 * Scheduled stops that a proposed trip range does not fully contain.
 *
 * `deriveDays` clamps every stop date to the trip window (derive-days.ts), so a
 * stop left hanging outside it does not become wrong — it becomes INVISIBLE.
 * That is the whole reason the write is refused instead of accepted.
 */
export function stopsOutsideRange(
  range: { startDate: IsoDate; endDate: IsoDate },
  stops: readonly Stop[],
): OrphanedStop[] {
  return stops
    .filter(isScheduled)
    .filter((s) => s.arriveDate < range.startDate || s.departDate > range.endDate)
    .map((s) => ({
      id: s.id,
      name: s.place.name,
      arriveDate: s.arriveDate,
      departDate: s.departDate,
    }));
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Aug 12–16" · "Aug 28–Sep 2" · "Aug 12" — the date line the refusal quotes. */
export function formatDateSpan(arrive: IsoDate, depart: IsoDate): string {
  const [, am, ad] = arrive.split("-") as [string, string, string];
  const [, dm, dd] = depart.split("-") as [string, string, string];
  const from = `${MONTHS[Number(am) - 1]} ${Number(ad)}`;
  if (arrive === depart) return from;
  const to = am === dm ? String(Number(dd)) : `${MONTHS[Number(dm) - 1]} ${Number(dd)}`;
  return `${from}–${to}`;
}

/** The human sentence the 409 carries, built from the offending stops. */
export function orphanedStopsMessage(orphans: readonly OrphanedStop[]): string {
  const named = orphans
    .map((o) => `${o.name} is scheduled ${formatDateSpan(o.arriveDate, o.departDate)}`)
    .join(", ");
  return `${named}, outside the new range. Move or unschedule ${
    orphans.length === 1 ? "it" : "them"
  } first.`;
}
