import type { IsoDate, Segment, TravelMode } from "./types";
import { orderedStops, type RouteStop } from "./route-order";

/**
 * The journey's hops (#110 · docs/design/110 §6). Two pure functions the server
 * and the client both run, so the rows in the database and the rhythm on the
 * screen can never disagree about which hops exist:
 *
 *   - `reconcileSegments` — the DENSE row set the route sequence implies (Q1 A).
 *   - `segmentDateConflicts` — where a timed segment and a stop's dates
 *     disagree. Stop dates win (Q3 A): the write that would create a conflict
 *     is refused, a stop is never silently re-dated.
 */

/** The slice of a trip the hop set is a function of. A full domain `Trip`
 * satisfies it structurally; packages/db builds one from bare rows. */
export interface SegmentTrip {
  id: string;
  homeBase: string | null;
  defaultMode: TravelMode;
  legs: { sortOrder: number; stops: RouteStop[] }[];
  segments: Segment[];
}

/**
 * The ids a new hop is born with. The server passes `randomUUID` (the column is
 * a uuid); the client's optimistic copy never reaches the database, so any
 * unique string will do until the next read replaces it.
 */
export type SegmentIdFactory = () => string;

let tempSeq = 0;
const defaultSegmentId: SegmentIdFactory = () =>
  globalThis.crypto?.randomUUID?.() ?? `seg-tmp-${Date.now().toString(36)}-${(tempSeq++).toString(36)}`;

const hopKey = (from: string | null, to: string | null) => `${from ?? "home"}→${to ?? "home"}`;

/**
 * The segment list the route sequence implies — in order, `sortOrder` renumbered
 * from 0.
 *
 *   - One hop per adjacent pair of `orderedStops(trip)`, floating stops
 *     included (a floating hop exists; it simply contributes no day).
 *   - Plus home → first stop when the trip HAS a home base.
 *   - A hop whose (from, to) still matches an existing row keeps that row — its
 *     id, mode, times and reservations.
 *   - A new hop gets `trip.defaultMode`, untimed.
 *   - An orphaned row is dropped (the database cascades its reservations).
 *   - A → home row is NEVER invented. When one exists it is re-pointed to the
 *     new last stop (and dropped only when the trip has no stops left).
 */
export function reconcileSegments(
  trip: SegmentTrip,
  newId: SegmentIdFactory = defaultSegmentId,
): Segment[] {
  const stops = orderedStops(trip);
  const hops: { from: string | null; to: string | null }[] = [];
  if (stops.length > 0 && trip.homeBase !== null) hops.push({ from: null, to: stops[0]!.id });
  for (let i = 0; i < stops.length - 1; i++) {
    hops.push({ from: stops[i]!.id, to: stops[i + 1]!.id });
  }

  const existing = [...trip.segments].sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map<string, Segment>();
  for (const s of existing) {
    if (s.toStopId === null) continue; // the → home row is matched separately
    const key = hopKey(s.fromStopId, s.toStopId);
    if (!byKey.has(key)) byKey.set(key, s); // a duplicate hop is an orphan
  }

  const next: Segment[] = hops.map((hop) => {
    const kept = byKey.get(hopKey(hop.from, hop.to));
    if (kept) return kept;
    return {
      id: newId(),
      tripId: trip.id,
      fromStopId: hop.from,
      toStopId: hop.to,
      mode: trip.defaultMode,
      departAt: null,
      arriveAt: null,
      departTz: null,
      arriveTz: null,
      sortOrder: 0,
      reservations: [],
    };
  });

  const home = existing.find((s) => s.toStopId === null && s.fromStopId !== null);
  const last = stops[stops.length - 1];
  if (home && last) next.push({ ...home, fromStopId: last.id });

  return next.map((s, i) => (s.sortOrder === i ? s : { ...s, sortOrder: i }));
}

/** What a persistence layer has to do to move `before` onto `after`. */
export interface SegmentDiff {
  insert: Segment[];
  /** Kept rows whose from, to or sortOrder moved. */
  update: Segment[];
  /** Orphans — their reservations go with them. */
  remove: string[];
}

export function diffSegments(before: Segment[], after: Segment[]): SegmentDiff {
  const old = new Map(before.map((s) => [s.id, s]));
  const keep = new Set(after.map((s) => s.id));
  return {
    insert: after.filter((s) => !old.has(s.id)),
    update: after.filter((s) => {
      const o = old.get(s.id);
      return (
        o !== undefined &&
        (o.fromStopId !== s.fromStopId || o.toStopId !== s.toStopId || o.sortOrder !== s.sortOrder)
      );
    }),
    remove: before.filter((s) => !keep.has(s.id)).map((s) => s.id),
  };
}

/** Apply the reconciled hop set to a trip — what every optimistic structural
 * edit on the client runs, so the rhythm never paints a stale hop. */
export function withReconciledSegments<T extends SegmentTrip>(
  trip: T,
  newId: SegmentIdFactory = defaultSegmentId,
): T {
  return { ...trip, segments: reconcileSegments(trip, newId) };
}

/**
 * The LOCAL calendar date an instant falls on in a zone — "YYYY-MM-DD".
 * `en-CA` formats as ISO order. A null zone reads the instant in UTC.
 */
export function localDate(instant: string, tz: string | null): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

/** A timed segment and a stop's dates that disagree (Q3 A). */
export interface SegmentDateConflict {
  segmentId: string;
  /** The stop's date — the authority. */
  expected: IsoDate;
  /** The segment's local date. */
  actual: IsoDate;
}

/**
 * Every timed segment whose clock disagrees with the stop dates it touches.
 *
 *   - A segment INTO a stop: the local arrival date must equal that stop's
 *     `arriveDate`.
 *   - A segment going HOME: the local departure date must equal the from-stop's
 *     `departDate` (there is no to-stop to compare against).
 *
 * A floating endpoint (no dates) is EXEMPT, not a conflict: it has no date to
 * disagree with, and treating it as one would make "Unschedule" impossible on
 * any stop a flight touches (vet MED on #110). Untimed segments never conflict
 * — they borrow their day from the stop.
 */
export function segmentDateConflicts(trip: SegmentTrip): SegmentDateConflict[] {
  const byId = new Map(trip.legs.flatMap((l) => l.stops).map((s) => [s.id, s]));
  const out: SegmentDateConflict[] = [];
  for (const seg of trip.segments) {
    if (seg.departAt === null || seg.arriveAt === null) continue;
    if (seg.toStopId !== null) {
      const to = byId.get(seg.toStopId);
      if (!to || to.arriveDate === null) continue;
      const actual = localDate(seg.arriveAt, seg.arriveTz);
      if (actual !== to.arriveDate) out.push({ segmentId: seg.id, expected: to.arriveDate, actual });
    } else if (seg.fromStopId !== null) {
      const from = byId.get(seg.fromStopId);
      if (!from || from.departDate === null) continue;
      const actual = localDate(seg.departAt, seg.departTz);
      if (actual !== from.departDate) {
        out.push({ segmentId: seg.id, expected: from.departDate, actual });
      }
    }
  }
  return out;
}

/**
 * The conflicts a write would INTRODUCE — the ones in `after` that `before`
 * did not already have. A conflict that predates the write (a leg reorder that
 * re-pointed a timed → home row, say) must not lock every unrelated stop edit
 * on the trip; the write that caused it is the one refused.
 */
export function newSegmentDateConflicts(
  before: SegmentTrip,
  after: SegmentTrip,
): SegmentDateConflict[] {
  const had = new Set(
    segmentDateConflicts(before).map((c) => `${c.segmentId}|${c.expected}|${c.actual}`),
  );
  return segmentDateConflicts(after).filter(
    (c) => !had.has(`${c.segmentId}|${c.expected}|${c.actual}`),
  );
}
