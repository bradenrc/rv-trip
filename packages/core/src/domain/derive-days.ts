import type { IsoDate, Segment, Stop, TravelMode } from "./types";
import { isScheduled } from "./types";
import { localDate } from "./segments";

/**
 * The calendar projection. Month-at-a-glance is a PURE PROJECTION of a trip's
 * scheduled stops and its travel segments onto its date range — day types are
 * never stored, so the grammar can never drift out of sync. Move a stop's dates
 * and the whole calendar reflows automatically.
 *
 * Semantics (v2 — #110 · docs/design/110 §4), in order:
 *   1. Every trip date starts EMPTY (an unplanned gap, or time before the first
 *      arrival / after the last departure). Surfacing these holes is a feature.
 *   2. Every scheduled stop owns [arriveDate, departDate] inclusive — each
 *      owned date is a STAY day at that stop. (v1 made the arrival a drive
 *      day; a stop with no inbound segment now keeps its arrival as a stay.)
 *   3. Every segment paints TRAVEL on its local-date span, clamped to the trip
 *      window, carrying { mode, segmentId, fromStopId, toStopId }. Travel
 *      overwrites stay — the shared day A.depart === B.arrive is the hop A→B.
 *        - timed (departAt + arriveAt): every LOCAL date from
 *          localDate(departAt, departTz) to localDate(arriveAt, arriveTz) (Q4 B);
 *        - untimed into a scheduled stop: that stop's arriveDate (v1's rule);
 *        - untimed going home from a scheduled stop: its departDate;
 *        - otherwise (the date-giving endpoint is floating): no day.
 *
 * Floating stops (no dates) contribute nothing — they live in the route
 * sequence view. `unscheduledStopIds` lists them so the UI can show a
 * "not yet scheduled" rail.
 */

export type DayKind = "stay" | "travel" | "empty";

export interface DayCell {
  date: IsoDate;
  kind: DayKind;
  /** set when kind === 'stay' */
  stopId?: string;
  /** set when kind === 'travel' — drive | fly | ferry */
  mode?: TravelMode;
  /** set when kind === 'travel' — the segment that made the day */
  segmentId?: string;
  /** set when kind === 'travel'; null means "from home base" */
  fromStopId?: string | null;
  /** set when kind === 'travel'; null means "home" */
  toStopId?: string | null;
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

/** The stop fields a day is a function of. */
type DayStop = Pick<Stop, "id" | "arriveDate" | "departDate">;
/** The segment fields a day is a function of. */
type DaySegment = Pick<
  Segment,
  "id" | "fromStopId" | "toStopId" | "mode" | "departAt" | "arriveAt" | "departTz" | "arriveTz" | "sortOrder"
>;

/** The local dates a segment is travel on — [] when it lands on no day. */
export function segmentDates(seg: DaySegment, stopsById: Map<string, DayStop>): IsoDate[] {
  if (seg.departAt !== null && seg.arriveAt !== null) {
    const from = localDate(seg.departAt, seg.departTz);
    const to = localDate(seg.arriveAt, seg.arriveTz);
    return from <= to ? eachDateInclusive(from, to) : [to];
  }
  if (seg.toStopId !== null) {
    const to = stopsById.get(seg.toStopId);
    return to && isScheduled(to) ? [to.arriveDate] : [];
  }
  if (seg.fromStopId !== null) {
    const from = stopsById.get(seg.fromStopId);
    return from && isScheduled(from) ? [from.departDate] : [];
  }
  return [];
}

export function deriveDays(
  range: { startDate: IsoDate; endDate: IsoDate },
  stops: DayStop[],
  segments: DaySegment[],
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

  // 1. Seed every trip day as empty.
  const byDate = new Map<IsoDate, DayCell>();
  for (const date of eachDateInclusive(range.startDate, range.endDate)) {
    byDate.set(date, { date, kind: "empty" });
  }
  const inRange = (d: IsoDate) => byDate.has(d);

  // 2. Every owned date is a stay.
  for (const s of scheduled) {
    for (const date of eachDateInclusive(s.arriveDate, s.departDate)) {
      if (!inRange(date)) continue; // clamp to trip window
      byDate.set(date, { date, kind: "stay", stopId: s.id });
    }
  }

  // 3. Travel overwrites stay, segment by segment in journey order.
  const stopsById = new Map(stops.map((s) => [s.id, s]));
  for (const seg of [...segments].sort((a, b) => a.sortOrder - b.sortOrder)) {
    for (const date of segmentDates(seg, stopsById)) {
      if (!inRange(date)) continue;
      byDate.set(date, {
        date,
        kind: "travel",
        mode: seg.mode,
        segmentId: seg.id,
        fromStopId: seg.fromStopId,
        toStopId: seg.toStopId,
      });
    }
  }

  return {
    days: eachDateInclusive(range.startDate, range.endDate).map(
      (d) => byDate.get(d)!,
    ),
    unscheduledStopIds,
  };
}
