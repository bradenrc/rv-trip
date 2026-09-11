import { describe, it, expect } from "vitest";
import {
  encodeFlexiblePolyline,
  orderedPairs,
  routeCacheKey,
  type RouteMap,
  type RouteResult,
  type Stop,
  type Trip,
} from "@rv-trip/core";
import { buildMapModel } from "./pins";

/**
 * The map's drive arcs (docs/design/43 §2).
 *
 * What this guards is the seam the corridor needs: one arc per
 * `orderedPairs()` pair — the SAME pair set the Route rail and the dashboard
 * card key on, floating stops included — each carrying the `source` the Mapbox
 * layer paints by, and its decoded geometry. A trip you have already taken
 * still draws nothing.
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
function seedTrip(status: Trip["status"] = "planning"): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status,
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
function routedPair(trip: Trip, fromStopId: string, primaryRoad: string): RouteMap {
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

describe("buildMapModel — drive arcs over the one ordered pair set", () => {
  it("draws one arc per orderedPairs pair, the floating drive included", () => {
    const trip = seedTrip();
    const pairs = orderedPairs(trip);
    // Three, not two: the old scheduled-only sequence missed Bend → Crater Lake.
    expect(pairs).toHaveLength(3);

    const { arcs } = buildMapModel([trip], [], {}, HASH);
    expect(arcs).toHaveLength(pairs.length);
    expect(arcs.map((a) => a.id)).toEqual([
      "astoria->newport",
      "newport->bend",
      "bend->crater",
    ]);
  });

  it("carries each arc's source, and paints nothing else by it", () => {
    const trip = seedTrip();
    const routes = routedPair(trip, "astoria", "US-101");
    const { arcs } = buildMapModel([trip], [], routes, HASH);

    expect(arcs.map((a) => a.source)).toEqual(["here", "estimate", "estimate"]);
  });

  it("gives a routed arc the decoded corridor and an estimate exactly its chord", () => {
    const trip = seedTrip();
    const { arcs } = buildMapModel([trip], [], routedPair(trip, "astoria", "US-101"), HASH);
    const [routed, estimate] = arcs;

    expect(routed!.path.length).toBeGreaterThan(2);
    expect(routed!.path).toHaveLength(4);
    // [lng, lat], in traversal order.
    expect(routed!.path[0]![0]).toBeCloseTo(8.69821, 5);
    expect(routed!.path[0]![1]).toBeCloseTo(50.10228, 5);

    // The estimate is unchanged BY CONSTRUCTION — two points, its own endpoints.
    expect(estimate!.path).toEqual([
      [estimate!.from.lng, estimate!.from.lat],
      [estimate!.to.lng, estimate!.to.lat],
    ]);
  });

  it("labels a routed drive with its road and an estimate with the tilde", () => {
    const trip = seedTrip();
    const { arcs } = buildMapModel([trip], [], routedPair(trip, "astoria", "US-101"), HASH);
    expect(arcs[0]!.label).toBe("136 mi · US-101");
    expect(arcs[1]!.label).toMatch(/^~\d+ mi · est\.$/);
  });

  it("names no road when the vendor named none", () => {
    const trip = seedTrip();
    const routes = routedPair(trip, "astoria", "");
    const withoutRoad: RouteMap = {};
    for (const [key, r] of Object.entries(routes)) withoutRoad[key] = { ...r, primaryRoad: null };
    const { arcs } = buildMapModel([trip], [], withoutRoad, HASH);
    expect(arcs[0]!.label).toBe("136 mi");
  });

  it("reads the same key the rail does — a hash mismatch is a clean miss", () => {
    const trip = seedTrip();
    const routes = routedPair(trip, "astoria", "US-101");
    const { arcs } = buildMapModel([trip], [], routes, "some-other-rig");
    expect(arcs.every((a) => a.source === "estimate")).toBe(true);
  });

  it("draws no arc for a trip you have already taken", () => {
    const trip = seedTrip("complete");
    const { arcs, pins } = buildMapModel([trip], [], routedPair(trip, "astoria", "US-101"), HASH);
    expect(arcs).toEqual([]);
    // …while every one of its stops is still on the map.
    expect(pins).toHaveLength(4);
  });

  it("skips a pair whose coordinates are missing rather than inventing one", () => {
    const trip = seedTrip();
    trip.legs[0]!.stops[1]!.place = { name: "Newport, OR", lat: null, lng: null, googlePlaceId: null };
    const { arcs, unmapped } = buildMapModel([trip], [], {}, HASH);
    // orderedPairs yields no pair on either side of a coordless stop.
    expect(arcs.map((a) => a.id)).toEqual(["bend->crater"]);
    expect(unmapped.map((u) => u.id)).toEqual(["newport"]);
  });

  it("still encodes its own two-point chord for an estimate (the stub's shape)", () => {
    // Guards the decode path for `estimate`: a stub result carries a real
    // polyline, and it must decode to the chord rather than be special-cased.
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
    const { arcs } = buildMapModel([trip], [], routes, HASH);
    expect(arcs[0]!.source).toBe("estimate");
    expect(arcs[0]!.path).toHaveLength(2);
  });
});
