import { isScheduled, type Stop, type Trip } from "./types";

/**
 * ONE trip-wide ordered sequence, and the adjacent pairs it implies.
 *
 * G1/G2 (docs/design/9 §4): the Route view built its connectors per leg while
 * the rail summed every scheduled stop trip-wide, so the rail had always
 * counted a drive the screen never showed. Both now consume this single
 * enumerator, which is why the rail is exactly the sum of the connectors you
 * can see.
 *
 * It lives in @rv-trip/core rather than in apps/web/src/lib so it can be unit
 * tested — this is the function that makes the rail equal the screen.
 */

export interface PairPoint {
  lat: number;
  lng: number;
}

export interface OrderedPair {
  fromStopId: string;
  toStopId: string;
  fromLegId: string;
  toLegId: string;
  from: PairPoint;
  to: PairPoint;
  /** The pair crosses from one leg into the next — drawn under a hairline rule. */
  legBoundary: boolean;
}

/** Legs by sortOrder; within a leg, scheduled by arrival date then floating by sortOrder. */
export function orderedStops(trip: Trip): Stop[] {
  return [...trip.legs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((leg) => orderedLegStops(leg.stops));
}

export function orderedLegStops(stops: Stop[]): Stop[] {
  const scheduled = stops
    .filter(isScheduled)
    .sort((a, b) => a.arriveDate.localeCompare(b.arriveDate));
  const floating = stops
    .filter((s) => !isScheduled(s))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return [...scheduled, ...floating];
}

/**
 * Every adjacent pair in that sequence that CAN be routed.
 *
 * Coordinates — not dates — are the precondition (Q2 = A). A stop without
 * coordinates simply yields no pair on either side of it, and no pair is
 * invented across it: missing coordinates means no connector is rendered, not a
 * neutral estimate. (The "estimate" state covers no rig / no credentials /
 * provider error.)
 */
export function orderedPairs(trip: Trip): OrderedPair[] {
  const ordered = orderedStops(trip);
  const pairs: OrderedPair[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    const a = point(from);
    const b = point(to);
    if (!a || !b) continue;
    pairs.push({
      fromStopId: from.id,
      toStopId: to.id,
      fromLegId: from.legId,
      toLegId: to.legId,
      from: a,
      to: b,
      legBoundary: from.legId !== to.legId,
    });
  }
  return pairs;
}

function point(stop: Stop): PairPoint | null {
  const { lat, lng } = stop.place;
  return lat == null || lng == null ? null : { lat, lng };
}

/**
 * The route cache key, and the `routes` table's primary key. A route changes
 * only when a stop or a ROUTING field of the rig does, so a keyed map (never a
 * positional array) crosses the RSC boundary and survives client-side
 * reordering. The third part is `routingHash`, never `rigHash`.
 */
export function routeCacheKey(from: PairPoint, to: PairPoint, routingHash: string): string {
  return `${from.lat},${from.lng}|${to.lat},${to.lng}|${routingHash}`;
}
