import { boundsFor, hasCoords, type Bounds, type MapPoint } from "../domain/bounds";
import { isScheduled, type Trip } from "../domain/types";
import type { RouteSource } from "../providers/index";
import type { TripArc } from "./map-arcs";

/**
 * The pin + camera half of the shared map model.
 *
 * `map-arcs.ts` gave the two renderers one set of LINES (#44 i3). This gives
 * them one set of DISCS and one camera box (#44 i4). The web's equivalents live
 * in `apps/web/src/components/map/pins.ts` and `MapView.tsx`, both of which the
 * phone can never import: `pins.ts` reads `@rv-trip/ui` (DOM-only by design)
 * and `MapView.tsx` imports `mapbox-gl`. So the vendor-free half lives here,
 * beside `tripArcs`, where vitest can actually execute it.
 *
 * Nothing here styles anything: a renderer reads `ordinal` / `floating` and
 * applies the pin grammar (`MAP_PALETTE`, theme/map-palette.ts).
 */

/** The trip's scheduled sequence, as the numbers a disc and a "stop 2 of 3"
 * kicker print. */
export interface ScheduledOrder {
  /** stopId → 1-based position in the trip's scheduled sequence. A floating
   * stop is absent: it has no position in the drive order, so it gets no
   * number and no arc (MapView.tsx StopDisc draws it as a dashed ◇). */
  ordinals: Map<string, number>;
  /** How many scheduled stops the trip has — the "stop 2 of 3" denominator. */
  total: number;
}

/**
 * Number the scheduled stops TRIP-WIDE by arrival date — the same ordering
 * `routeSummary()` and `orderedStops()` use, so the map's sequence, the Route
 * rail's sequence and the stop sheet's ordinal are one sequence. Legs do not
 * reset the count: a trip has one drive order, not one per leg (docs/design/9
 * §4, the G1/G2 fix).
 */
export function scheduledOrder(trip: Trip): ScheduledOrder {
  const sequence = trip.legs
    .flatMap((l) => l.stops)
    .filter(isScheduled)
    .sort((a, b) => a.arriveDate.localeCompare(b.arriveDate));
  return {
    ordinals: new Map(sequence.map((s, i) => [s.id, i + 1])),
    total: sequence.length,
  };
}

/** A drawable trip stop: the disc's coordinate, its number, and whether it is
 * the hollow dashed floating one. */
export interface TripStopPin extends MapPoint {
  id: string;
  name: string;
  /** 1-based position in the trip's scheduled sequence; null when floating. */
  ordinal: number | null;
  floating: boolean;
}

/**
 * Every stop the map can draw, in leg-then-stop order (the order the tree is
 * written in, which is the render order and therefore the z-order).
 *
 * A stop without coordinates is DROPPED rather than drawn at 0,0 — the same
 * precondition `orderedPairs` applies to arcs (route-order.ts:49-57). It still
 * counts in `scheduledOrder`, so the numbers the reader sees on the map are the
 * numbers the rail counts, with one missing rather than all of them shifted.
 */
export function tripStopPins(trip: Trip): TripStopPin[] {
  const { ordinals } = scheduledOrder(trip);
  const pins: TripStopPin[] = [];
  for (const leg of trip.legs) {
    for (const stop of leg.stops) {
      if (!hasCoords(stop.place)) continue;
      pins.push({
        id: stop.id,
        name: stop.place.name,
        lat: stop.place.lat,
        lng: stop.place.lng,
        ordinal: ordinals.get(stop.id) ?? null,
        floating: !isScheduled(stop),
      });
    }
  }
  return pins;
}

/** One drive, as the GeoJSON feature a line layer cases on. */
export interface ArcFeature {
  type: "Feature";
  /** `source` is what every arc layer filters or cases on — the ONE predicate
   * the whole grammar is painted by (MapView.tsx:50). */
  properties: { id: string; source: RouteSource };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

export interface ArcFeatureCollection {
  type: "FeatureCollection";
  features: ArcFeature[];
}

/**
 * The ONE shape source both renderers' three line layers read. One source with
 * a data-driven predicate rather than two sources, so a drive rendered twice is
 * unrepresentable (docs/design/43 §2). The geometry is already decoded by
 * `tripArcs`; nothing is re-projected here.
 */
export function arcFeatureCollection(arcs: readonly TripArc[]): ArcFeatureCollection {
  return {
    type: "FeatureCollection",
    features: arcs.map((a) => ({
      type: "Feature" as const,
      properties: { id: a.id, source: a.source },
      geometry: { type: "LineString" as const, coordinates: a.path },
    })),
  };
}

/**
 * Every corridor vertex as a point a camera can be fitted to.
 *
 * This exists because the two shapes differ by design and the conversion is
 * easy to get backwards: `TripArc.path` is GeoJSON `[lng, lat]` positions
 * (polyline.ts:105-108) while `MapPoint` is `{ lat, lng }` (bounds.ts:11-14).
 * Reading a tuple in the wrong order puts Oregon in the Southern Ocean, and the
 * mistake is silent — the map simply fits somewhere else.
 */
export function arcVertices(arcs: readonly TripArc[]): MapPoint[] {
  return arcs.flatMap((a) => a.path.map(([lng, lat]) => ({ lat, lng })));
}

/**
 * The camera box: the corridor, not only the pins.
 *
 * US-101 runs west of both Astoria and Newport, so a routed drive's box is
 * wider than its endpoints'. An estimate contributes exactly its two endpoints,
 * so nothing moves on a map with no routed drive on it. `null` when there is
 * nothing to fit — the caller draws a frame instead of asking for infinite
 * zoom.
 */
export function mapBounds(
  arcs: readonly TripArc[],
  pins: readonly MapPoint[],
): Bounds | null {
  return boundsFor([...pins, ...arcVertices(arcs)]);
}
