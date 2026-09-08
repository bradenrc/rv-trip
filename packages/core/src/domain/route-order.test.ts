import { describe, it, expect } from "vitest";
import { orderedStops, orderedPairs, routeCacheKey } from "./route-order";
import type { Trip, Stop } from "./types";

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

describe("orderedStops", () => {
  it("is one trip-wide sequence: legs by sortOrder, then stops within a leg", () => {
    expect(orderedStops(seedTrip()).map((s) => s.id)).toEqual([
      "astoria",
      "newport",
      "bend",
      "crater",
    ]);
  });

  it("orders a leg's scheduled stops by arrival date, floating ones after by sortOrder", () => {
    const trip = seedTrip();
    trip.legs[0]!.stops = [
      mkStop({ id: "floatB", legId: "coast", sortOrder: 9 }),
      mkStop({ id: "late", legId: "coast", arriveDate: "2026-08-06", departDate: "2026-08-07" }),
      mkStop({ id: "floatA", legId: "coast", sortOrder: 2 }),
      mkStop({ id: "early", legId: "coast", arriveDate: "2026-08-02", departDate: "2026-08-03" }),
    ];
    expect(orderedStops(trip).map((s) => s.id).slice(0, 4)).toEqual([
      "early",
      "late",
      "floatA",
      "floatB",
    ]);
  });

  it("respects leg sortOrder rather than array position", () => {
    const trip = seedTrip();
    trip.legs = [trip.legs[1]!, trip.legs[0]!];
    expect(orderedStops(trip).map((s) => s.id)).toEqual(["astoria", "newport", "bend", "crater"]);
  });
});

describe("orderedPairs", () => {
  it("routes every adjacent pair — including the leg boundary and the floating stop", () => {
    const pairs = orderedPairs(seedTrip());
    expect(pairs.map((p) => [p.fromStopId, p.toStopId])).toEqual([
      ["astoria", "newport"],
      ["newport", "bend"],
      ["bend", "crater"],
    ]);
  });

  it("marks only the pair that crosses a leg boundary", () => {
    expect(orderedPairs(seedTrip()).map((p) => p.legBoundary)).toEqual([false, true, false]);
  });

  it("coordinates — not dates — are the precondition", () => {
    const trip = seedTrip();
    // Bend loses its coordinates: both pairs touching it vanish, and no pair is
    // invented across it. Missing coords = no connector rendered.
    trip.legs[1]!.stops[0]!.place = { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null };
    expect(orderedPairs(trip).map((p) => [p.fromStopId, p.toStopId])).toEqual([
      ["astoria", "newport"],
    ]);
  });

  it("carries the coordinates through so a caller never re-reads the place", () => {
    const first = orderedPairs(seedTrip())[0]!;
    expect(first.from).toEqual({ lat: 46.1879, lng: -123.8313 });
    expect(first.to).toEqual({ lat: 44.6365, lng: -124.053 });
  });

  it("has no pairs for a trip with a single stop", () => {
    const trip = seedTrip();
    trip.legs = [{ ...trip.legs[0]!, stops: [trip.legs[0]!.stops[0]!] }];
    expect(orderedPairs(trip)).toEqual([]);
  });
});

describe("routeCacheKey", () => {
  it("is from|to|rig, so it survives reordering and changes with the rig", () => {
    const from = { lat: 44.6365, lng: -124.053 };
    const to = { lat: 44.0582, lng: -121.3153 };
    expect(routeCacheKey(from, to, "abc")).toBe("44.6365,-124.053|44.0582,-121.3153|abc");
    expect(routeCacheKey(from, to, "def")).not.toBe(routeCacheKey(from, to, "abc"));
  });

  it("is directional", () => {
    const a = { lat: 1, lng: 2 };
    const b = { lat: 3, lng: 4 };
    expect(routeCacheKey(a, b, "r")).not.toBe(routeCacheKey(b, a, "r"));
  });

  it("keys the pairs orderedPairs produces", () => {
    const keys = orderedPairs(seedTrip()).map((p) => routeCacheKey(p.from, p.to, "r"));
    expect(new Set(keys).size).toBe(3);
  });
});
