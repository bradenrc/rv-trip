import { describe, it, expect } from "vitest";
import { encodeFlexiblePolyline } from "../providers/polyline";
import { orderedPairs, routeCacheKey } from "../domain/route-order";
import type { Stop, Trip } from "../domain/types";
import type { RouteResult } from "../providers/index";
import type { RouteMap } from "./index";
import { tripArcs } from "./map-arcs";

/**
 * `tripArcs` — the map's drive model, shared by the web's `/map` overview and
 * the phone's Map lens (issue #44 i3, lifted from
 * apps/web/src/components/map/pins.ts).
 *
 * What this guards is the seam a second renderer needs: one arc per
 * `orderedPairs()` pair — the SAME pair set the Route rail and the dashboard
 * card key on, floating stops included — each carrying the `source` a Mapbox
 * layer paints by, the miles the rail prints, and its decoded geometry. No
 * layer scoping and no label copy: those stay the web's (`pins.ts`), because
 * the phone's masthead words them differently.
 */

const HASH = "test-routing-hash";

/** HERE's published flexible-polyline test vector — four vertices. */
const HERE_CORRIDOR = "BFoz5xJ67i1B1B7PzIhaxL7Y";

function mkStop(partial: Partial<Stop> & { id: string; legId: string }): Stop {
  return {
    id: partial.id,
    legId: partial.legId,
    place: partial.place ?? { name: partial.id, lat: 45, lng: -122, googlePlaceId: null },
    arriveDate: partial.arriveDate ?? null,
    departDate: partial.departDate ?? null,
    sortOrder: partial.sortOrder ?? 0,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
  };
}

/** The seed fixture's shape: two legs, three dated stops, one floating. */
function seedTrip(): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    legs: [
      {
        id: "coast",
        tripId: "t1",
        title: "Oregon Coast",
        sortOrder: 0,
        stops: [
          mkStop({
            id: "astoria",
            legId: "coast",
            place: { name: "Astoria, OR", lat: 46.1879, lng: -123.8313, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-05",
            sortOrder: 0,
          }),
          mkStop({
            id: "newport",
            legId: "coast",
            place: { name: "Newport, OR", lat: 44.6365, lng: -124.053, googlePlaceId: null },
            arriveDate: "2026-08-05",
            departDate: "2026-08-09",
            sortOrder: 1,
          }),
        ],
      },
      {
        id: "cascades",
        tripId: "t1",
        title: "Cascades & Home",
        sortOrder: 1,
        stops: [
          mkStop({
            id: "bend",
            legId: "cascades",
            place: { name: "Bend, OR", lat: 44.0582, lng: -121.3153, googlePlaceId: null },
            arriveDate: "2026-08-12",
            departDate: "2026-08-16",
            sortOrder: 0,
          }),
          // Floating — no dates. It sits at the end of ITS leg, so the pair
          // Bend → Crater Lake is the trip's last drive.
          mkStop({
            id: "crater",
            legId: "cascades",
            place: { name: "Crater Lake NP", lat: 42.9446, lng: -122.109, googlePlaceId: null },
            sortOrder: 1,
          }),
        ],
      },
    ],
  };
}

/** A routed answer for one pair, with a four-vertex corridor. */
function routedPair(trip: Trip, fromStopId: string, primaryRoad: string | null): RouteMap {
  const pair = orderedPairs(trip).find((p) => p.fromStopId === fromStopId);
  expect(pair, `pair leaving ${fromStopId}`).toBeDefined();
  const result: RouteResult = {
    durationSeconds: 3 * 3600,
    distanceMeters: 218_874, // 136 mi
    polyline: HERE_CORRIDOR,
    primaryRoad,
    source: "here",
    notices: [],
  };
  return { [routeCacheKey(pair!.from, pair!.to, HASH)]: result };
}

describe("tripArcs — one arc per ordered pair, two renderers", () => {
  it("draws one arc per orderedPairs pair, the floating drive included", () => {
    const trip = seedTrip();
    const pairs = orderedPairs(trip);
    // Three, not two: a scheduled-only sequence would miss Bend → Crater Lake.
    expect(pairs).toHaveLength(3);

    const arcs = tripArcs(trip, {}, HASH);
    expect(arcs).toHaveLength(pairs.length);
    expect(arcs.map((a) => a.id)).toEqual(["astoria->newport", "newport->bend", "bend->crater"]);
    // The chord endpoints are the pair's, so a label can still sit at its midpoint.
    expect(arcs[0]!.from).toEqual(pairs[0]!.from);
    expect(arcs[0]!.to).toEqual(pairs[0]!.to);
  });

  it("gives a routed pair the decoded HERE corridor", () => {
    const arcs = tripArcs(seedTrip(), routedPair(seedTrip(), "astoria", "US-101"), HASH);
    const routed = arcs[0]!;

    expect(routed.source).toBe("here");
    expect(routed.path).toHaveLength(4);
    // [lng, lat] — GeoJSON's order, in traversal order.
    expect(routed.path[0]![0]).toBeCloseTo(8.69821, 5);
    expect(routed.path[0]![1]).toBeCloseTo(50.10228, 5);
    // The numbers the rail prints, carried raw — no label copy in core.
    expect(routed.miles).toBe(136);
    expect(routed.primaryRoad).toBe("US-101");
  });

  it("gives an estimate pair exactly its two-point chord, and no road", () => {
    const arcs = tripArcs(seedTrip(), routedPair(seedTrip(), "astoria", "US-101"), HASH);
    const estimate = arcs[1]!;

    expect(estimate.source).toBe("estimate");
    // Unchanged BY CONSTRUCTION — `estimateRoute` encodes its own endpoints, so
    // the decode path yields the chord rather than being special-cased.
    expect(estimate.path).toEqual([
      [estimate.from.lng, estimate.from.lat],
      [estimate.to.lng, estimate.to.lat],
    ]);
    expect(estimate.primaryRoad).toBeNull();
    expect(estimate.miles).toBeGreaterThan(0);
  });

  it("reads the same key the rail does — a stale routingHash is a clean miss", () => {
    const trip = seedTrip();
    const arcs = tripArcs(trip, routedPair(trip, "astoria", "US-101"), "some-other-rig");
    expect(arcs.map((a) => a.source)).toEqual(["estimate", "estimate", "estimate"]);
    expect(arcs.every((a) => a.path.length === 2)).toBe(true);
  });

  it("names no road when the vendor named none", () => {
    const trip = seedTrip();
    const arcs = tripArcs(trip, routedPair(trip, "astoria", null), HASH);
    expect(arcs[0]!.source).toBe("here");
    expect(arcs[0]!.primaryRoad).toBeNull();
  });

  it("defaults to no routes and no rig, so a caller can ask for the estimates", () => {
    const arcs = tripArcs(seedTrip());
    expect(arcs).toHaveLength(3);
    expect(arcs.every((a) => a.source === "estimate")).toBe(true);
  });

  it("skips a pair whose coordinates are missing rather than inventing one", () => {
    const trip = seedTrip();
    trip.legs[0]!.stops[1]!.place = {
      name: "Newport, OR",
      lat: null,
      lng: null,
      googlePlaceId: null,
    };
    // orderedPairs yields no pair on either side of a coordless stop.
    expect(tripArcs(trip, {}, HASH).map((a) => a.id)).toEqual(["bend->crater"]);
  });

  it("decodes a stub `estimate` result to its chord rather than special-casing it", () => {
    const trip = seedTrip();
    const pair = orderedPairs(trip)[0]!;
    const routes: RouteMap = {
      [routeCacheKey(pair.from, pair.to, HASH)]: {
        durationSeconds: 0,
        distanceMeters: 0,
        polyline: encodeFlexiblePolyline([pair.from, pair.to]),
        primaryRoad: null,
        source: "estimate",
        notices: [],
      },
    };
    const arcs = tripArcs(trip, routes, HASH);
    expect(arcs[0]!.source).toBe("estimate");
    expect(arcs[0]!.path).toHaveLength(2);
  });
});
