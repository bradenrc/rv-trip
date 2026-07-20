import type { IsoDate, Stop } from "./types";
import { isScheduled } from "./types";

/**
 * The calendar projection. Month-at-a-glance is a PURE PROJECTION of a trip's
 * scheduled stops onto its date range — day types are never stored, so the
 * grammar can never drift out of sync. Move a stop's dates and the whole
 * calendar reflows automatically.
 *
 * Semantics (v1 — deliberately simple and testable):
 *   - Scheduled stops (both dates present) are sorted by arriveDate.
 *   - A stop "owns" every date in [arriveDate, departDate] inclusive.
 *   - The arriveDate of a stop is a DRIVE day (you traveled to get there),
 *     from the previous stop (fromStopId) to this one (toStopId). The first
 *     stop's arrival drives from home base (fromStopId = null).
 *   - Every other owned date is a STAY day at that stop.
 *   - When two stops share a day (A.departDate === B.arriveDate), the arrival
 *     (drive) wins — that day is the drive A→B.
 *   - Dates in the trip range owned by no stop are EMPTY (an unplanned gap, or
 *     time before the first arrival / after the last departure). Surfacing
 *     these holes is a feature.
 *
 * Floating stops (no dates) contribute nothing here — they live in the route
 * sequence view. `unscheduledStopIds` lists them so the UI can show a
 * "not yet scheduled" rail.
 */

export type DayKind = "stay" | "drive" | "empty";

export interface DayCell {
  date: IsoDate;
  kind: DayKind;
  /** set when kind === 'stay' */
  stopId?: string;
  /** set when kind === 'drive'; null fromStopId means "from home base" */
  fromStopId?: string | null;
  toStopId?: string;
}

export interface DerivedCalendar {
  days: DayCell[];
  unscheduledStopIds: string[];
}

const MS_PER_DAY = 86_400_000;

function toUtcMs(d: IsoDate): number {
  // 'YYYY-MM-DD' parsed as UTC midnight — no timezone drift.
  return Date.parse(`${d}T00:00:00Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inclusive list of dates from start to end (start <= end). */
export function eachDateInclusive(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const endMs = toUtcMs(end);
  for (let ms = toUtcMs(start); ms <= endMs; ms += MS_PER_DAY) {
    out.push(fromUtcMs(ms));
  }
  return out;
}

export function deriveDays(
  range: { startDate: IsoDate; endDate: IsoDate },
  stops: Stop[],
): DerivedCalendar {
  const scheduled = stops
    .filter(isScheduled)
    .slice()
    .sort((a, b) =>
      a.arriveDate === b.arriveDate
        ? a.departDate.localeCompare(b.departDate)
        : a.arriveDate.localeCompare(b.arriveDate),
    );

  const unscheduledStopIds = stops
    .filter((s) => !isScheduled(s))
    .map((s) => s.id);

  // Seed every trip day as empty.
  const byDate = new Map<IsoDate, DayCell>();
  for (const date of eachDateInclusive(range.startDate, range.endDate)) {
    byDate.set(date, { date, kind: "empty" });
  }

  const inRange = (d: IsoDate) => byDate.has(d);

  scheduled.forEach((s, i) => {
    const prev = i > 0 ? scheduled[i - 1] : undefined;
    for (const date of eachDateInclusive(s.arriveDate, s.departDate)) {
      if (!inRange(date)) continue; // clamp to trip window
      if (date === s.arriveDate) {
        byDate.set(date, {
          date,
          kind: "drive",
          fromStopId: prev ? prev.id : null,
          toStopId: s.id,
        });
      } else {
        byDate.set(date, { date, kind: "stay", stopId: s.id });
      }
    }
  });

  return {
    days: eachDateInclusive(range.startDate, range.endDate).map(
      (d) => byDate.get(d)!,
    ),
    unscheduledStopIds,
  };
}
