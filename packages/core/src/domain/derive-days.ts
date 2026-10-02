import type { IsoDate, Segment, Destination, TravelMode } from "./types";
import { isScheduled } from "./types";
import { localDate } from "./segments";

/**
 * The calendar projection. Month-at-a-glance is a PURE PROJECTION of a trip's
 * scheduled destinations and its travel segments onto its date range — day types are
 * never stored, so the grammar can never drift out of sync. Move a destination's dates
 * and the whole calendar reflows automatically.
 *
 * Semantics (v2 — #110 · docs/design/110 §4), in order:
 *   1. Every trip date starts EMPTY (an unplanned gap, or time before the first
 *      arrival / after the last departure). Surfacing these holes is a feature.
 *   2. Every scheduled destination owns [arriveDate, departDate] inclusive — each
 *      owned date is a STAY day at that destination. (v1 made the arrival a drive
 *      day; a destination with no inbound segment now keeps its arrival as a stay.)
 *   3. Every segment paints TRAVEL on its local-date span, clamped to the trip
 *      window, carrying { mode, segmentId, fromDestinationId, toDestinationId }. Travel
 *      overwrites stay — the shared day A.depart === B.arrive is the hop A→B.
 *        - timed (departAt + arriveAt): every LOCAL date from
 *          localDate(departAt, departTz) to localDate(arriveAt, arriveTz) (Q4 B);
 *        - untimed into a scheduled destination: that destination's arriveDate (v1's rule);
 *        - untimed going home from a scheduled destination: its departDate;
 *        - otherwise (the date-giving endpoint is floating): no day.
 *      A boundary fly/ferry hop (to or from home) wins its days (#124).
 *
 * Floating destinations (no dates) contribute nothing — they live in the route
 * sequence view. `unscheduledDestinationIds` lists them so the UI can show a
 * "not yet scheduled" rail.
 */

export type DayKind = "stay" | "travel" | "empty";

export interface DayCell {
  date: IsoDate;
  kind: DayKind;
  /** set when kind === 'stay' */
  destinationId?: string;
  /** set when kind === 'travel' — drive | fly | ferry */
  mode?: TravelMode;
  /** set when kind === 'travel' — the segment that made the day */
  segmentId?: string;
  /** set when kind === 'travel'; null means "from home base" */
  fromDestinationId?: string | null;
  /** set when kind === 'travel'; null means "home" */
  toDestinationId?: string | null;
}

export interface DerivedCalendar {
  days: DayCell[];
  unscheduledDestinationIds: string[];
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

/** The destination fields a day is a function of. */
type DayDestination = Pick<Destination, "id" | "arriveDate" | "departDate">;
/** The segment fields a day is a function of. */
type DaySegment = Pick<
  Segment,
  "id" | "fromDestinationId" | "toDestinationId" | "mode" | "departAt" | "arriveAt" | "departTz" | "arriveTz" | "sortOrder"
>;

/** The local dates a segment is travel on — [] when it lands on no day. */
export function segmentDates(seg: DaySegment, destinationsById: Map<string, DayDestination>): IsoDate[] {
  if (seg.departAt !== null && seg.arriveAt !== null) {
    const from = localDate(seg.departAt, seg.departTz);
    const to = localDate(seg.arriveAt, seg.arriveTz);
    return from <= to ? eachDateInclusive(from, to) : [to];
  }
  if (seg.toDestinationId !== null) {
    const to = destinationsById.get(seg.toDestinationId);
    return to && isScheduled(to) ? [to.arriveDate] : [];
  }
  if (seg.fromDestinationId !== null) {
    const from = destinationsById.get(seg.fromDestinationId);
    return from && isScheduled(from) ? [from.departDate] : [];
  }
  return [];
}

export function deriveDays(
  range: { startDate: IsoDate; endDate: IsoDate },
  destinations: DayDestination[],
  segments: DaySegment[],
): DerivedCalendar {
  const scheduled = destinations
    .filter(isScheduled)
    .slice()
    .sort((a, b) =>
      a.arriveDate === b.arriveDate
        ? a.departDate.localeCompare(b.departDate)
        : a.arriveDate.localeCompare(b.arriveDate),
    );

  const unscheduledDestinationIds = destinations
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
      byDate.set(date, { date, kind: "stay", destinationId: s.id });
    }
  }

  // 3. Travel overwrites stay, segment by segment in journey order — except
  //    that a BOUNDARY fly/ferry hop (home → first, last → home) paints last
  //    (#124): the arrival and departure days are the trip's ✈ days, and an
  //    untimed drive that borrows the same destination date must not paint over them.
  const destinationsById = new Map(destinations.map((s) => [s.id, s]));
  const boundaryAir = (s: DaySegment) =>
    (s.fromDestinationId === null || s.toDestinationId === null) && s.mode !== "drive" ? 1 : 0;
  const painted = [...segments].sort(
    (a, b) => boundaryAir(a) - boundaryAir(b) || a.sortOrder - b.sortOrder,
  );
  for (const seg of painted) {
    for (const date of segmentDates(seg, destinationsById)) {
      if (!inRange(date)) continue;
      byDate.set(date, {
        date,
        kind: "travel",
        mode: seg.mode,
        segmentId: seg.id,
        fromDestinationId: seg.fromDestinationId,
        toDestinationId: seg.toDestinationId,
      });
    }
  }

  return {
    days: eachDateInclusive(range.startDate, range.endDate).map(
      (d) => byDate.get(d)!,
    ),
    unscheduledDestinationIds,
  };
}
