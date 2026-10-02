import { isScheduled, type IsoDate, type Destination, type TravelMode, type Trip } from "./types";

/**
 * ONE trip-wide ordered sequence, and the adjacent pairs it implies.
 *
 * G1/G2 (docs/design/9 §4): the Route view built its connectors per chapter while
 * the rail summed every scheduled destination trip-wide, so the rail had always
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

/**
 * The fields the route SEQUENCE is a function of. A domain `Destination` satisfies it;
 * so does the bare row packages/db reconciles segments from (#110).
 */
export interface RouteDestination {
  id: string;
  chapterId: string;
  arriveDate: IsoDate | null;
  departDate: IsoDate | null;
  sortOrder: number;
}

export interface OrderedPair {
  fromDestinationId: string;
  toDestinationId: string;
  fromChapterId: string;
  toChapterId: string;
  from: PairPoint;
  to: PairPoint;
  /** The pair crosses from one chapter into the next — drawn under a hairline rule. */
  chapterBoundary: boolean;
  /**
   * How the hop is travelled — its segment's mode (#110 §6). A pair with no row
   * yet (an optimistic edit the server has not reconciled) reads the trip's
   * `defaultMode`, which is exactly the mode `reconcileSegments` would give it.
   */
  mode: TravelMode;
}

/** Chapters by sortOrder; within a chapter, scheduled by arrival date then floating by sortOrder. */
export function orderedDestinations<S extends RouteDestination>(trip: {
  chapters: { sortOrder: number; destinations: S[] }[];
}): S[] {
  return [...trip.chapters]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((chapter) => orderedChapterDestinations(chapter.destinations));
}

export function orderedChapterDestinations<S extends RouteDestination>(destinations: S[]): S[] {
  const scheduled = destinations
    .filter((s) => isScheduled(s))
    .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
  const floating = destinations
    .filter((s) => !isScheduled(s))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return [...scheduled, ...floating];
}

/**
 * Every adjacent pair in that sequence that CAN be routed.
 *
 * Coordinates — not dates — are the precondition (Q2 = A). A destination without
 * coordinates simply yields no pair on either side of it, and no pair is
 * invented across it: missing coordinates means no connector is rendered, not a
 * neutral estimate. (The "estimate" state covers no rig / no credentials /
 * provider error.)
 */
export function orderedPairs(trip: Trip): OrderedPair[] {
  const ordered = orderedDestinations(trip);
  const modes = new Map(
    trip.segments.map((s) => [`${s.fromDestinationId ?? ""}|${s.toDestinationId ?? ""}`, s.mode] as const),
  );
  const pairs: OrderedPair[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    const a = point(from);
    const b = point(to);
    if (!a || !b) continue;
    pairs.push({
      fromDestinationId: from.id,
      toDestinationId: to.id,
      fromChapterId: from.chapterId,
      toChapterId: to.chapterId,
      from: a,
      to: b,
      chapterBoundary: from.chapterId !== to.chapterId,
      mode: modes.get(`${from.id}|${to.id}`) ?? trip.defaultMode,
    });
  }
  return pairs;
}

/**
 * The pairs that are DRIVEN (#110 §6) — the only ones anything pays or measures
 * a road for: HERE routing, the corridor check, the drive rail and the miles
 * summary. Map arcs keep `orderedPairs`, so a flight still draws its straight
 * no-route arc.
 */
export function drivePairs(trip: Trip): OrderedPair[] {
  return orderedPairs(trip).filter((p) => p.mode === "drive");
}

function point(destination: Destination): PairPoint | null {
  const { lat, lng } = destination.place;
  return lat == null || lng == null ? null : { lat, lng };
}

/**
 * The route cache key, and the `routes` table's primary key. A route changes
 * only when a destination or a ROUTING field of the rig does, so a keyed map (never a
 * positional array) crosses the RSC boundary and survives client-side
 * reordering. The third part is `routingHash`, never `rigHash`.
 */
export function routeCacheKey(from: PairPoint, to: PairPoint, routingHash: string): string {
  return `${from.lat},${from.lng}|${to.lat},${to.lng}|${routingHash}`;
}
