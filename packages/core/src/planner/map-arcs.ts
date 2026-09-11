import { orderedPairs, routeCacheKey, type PairPoint } from "../domain/route-order";
import { NO_ROUTING_HASH } from "../domain/rig";
import type { Trip } from "../domain/types";
import { estimateRoute, type RouteSource } from "../providers/index";
import { routeToGeoJSON } from "../providers/polyline";
import { driveMiles } from "../providers/route-format";
import type { RouteMap } from "./index";

/**
 * The drive arcs a map draws, as a pure function of a trip.
 *
 * One entry per `orderedPairs()` pair — the ONE trip-wide ordered sequence the
 * Route rail, the dashboard card and the `routes` table all key on, floating
 * stops included. Each carries the `source` a line layer paints by (solid
 * corridor vs. dash), the miles the rail prints, the road the vendor named, and
 * the drawn geometry.
 *
 * Lifted out of `apps/web/src/components/map/pins.ts` in #44 so the phone's Map
 * lens and the web's `/map` overview derive their arcs from the same call: two
 * renderers, one model, no second haversine and no second cache key. `pins.ts`
 * keeps what is genuinely its own — the four-layer scoping and its label copy
 * ("136 mi · US-101" / "~108 mi · est."), which the phone's masthead words
 * differently.
 *
 * Nothing here styles anything and nothing here is async: the cache-key miss
 * (you dragged a floating stop and invented a pair the server never routed)
 * falls back to `estimateRoute`, the one surviving synchronous haversine, which
 * is exactly how the rail falls back through the SAME key. That is why the map
 * and the rail — and the phone and the laptop — cannot print different numbers.
 */
export interface TripArc {
  /** `"<fromStopId>-><toStopId>"` — stable across a re-render, no index. */
  id: string;
  /** The pair's endpoints — the chord, for a label's midpoint. */
  from: PairPoint;
  to: PairPoint;
  source: RouteSource;
  miles: number;
  /** The road the drive mostly runs on ("US-101"), when the vendor named one. */
  primaryRoad: string | null;
  /** The drawn path as `[lng, lat]` positions: the decoded HERE corridor when
   * routed, the two endpoints otherwise (so an estimate is unchanged by
   * construction, never by a branch). */
  path: [number, number][];
}

/**
 * `routes` + `routingHash` are the server's resolved drives. They default to
 * "none, no rig" so a caller that only wants the straight-line estimates — a
 * trip with no rig on file — can ask with one argument.
 */
export function tripArcs(
  trip: Trip,
  routes: RouteMap = {},
  routingHash: string = NO_ROUTING_HASH,
): TripArc[] {
  return orderedPairs(trip).map((pair) => {
    const key = routeCacheKey(pair.from, pair.to, routingHash);
    const result = routes[key] ?? estimateRoute(pair.from, pair.to);
    return {
      id: `${pair.fromStopId}->${pair.toStopId}`,
      from: pair.from,
      to: pair.to,
      source: result.source,
      miles: driveMiles(result),
      primaryRoad: result.primaryRoad,
      path: routeToGeoJSON(result, pair.from, pair.to).coordinates,
    };
  });
}
