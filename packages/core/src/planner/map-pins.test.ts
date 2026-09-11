import { describe, it, expect } from "vitest";
import { MIN_BOUNDS_SPAN } from "../domain/bounds";
import { orderedPairs, routeCacheKey } from "../domain/route-order";
import type { Stop, Trip } from "../domain/types";
import type { RouteResult } from "../providers/index";
import { encodeFlexiblePolyline } from "../providers/polyline";
import type { RouteMap } from "./index";
import { tripArcs } from "./map-arcs";
import {
  arcFeatureCollection,
  arcVertices,
  mapBounds,
  scheduledOrder,
  tripStopPins,
} from "./map-pins";

/**
 * The pin + camera half of the shared map model (issue #44 i4).
 *
 * `tripArcs` (i3) gave the two renderers one set of lines. These four give them
 * one set of DISCS and one camera box — the parts the phone's Map lens needs
 * that were previously trapped in `apps/web/src/components/map/pins.ts` (which
 * imports `@rv-trip/ui` and so can never be reached from React Native) and in
 * `MapView.tsx`'s `useMemo`s.
 *
 * The load-bearing case is `mapBounds`: `TripArc.path` is `[lng, lat]` tuples
 * (polyline.ts) while `boundsFor` takes `{ lat, lng }` (bounds.ts), and the
 * wireframe's own snippet concatenated the two shapes. A function is the only
 * place that mistake can be made once and then be impossible.
 */

const HASH = "test-routing-hash";

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

/** The seed fixture the wireframe draws: three dated stops, one floating. */
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

describe("scheduledOrder", () => {
  it("numbers the scheduled stops trip-wide by arrival date, and counts them", () => {
    const { ordinals, total } = scheduledOrder(seedTrip());
    expect(total).toBe(3);
    expect(ordinals.get("astoria")).toBe(1);
    expect(ordinals.get("newport")).toBe(2);
    expect(ordinals.get("bend")).toBe(3);
  });

  it("gives a floating stop no ordinal and does not count it in the total", () => {
    const { ordinals, total } = scheduledOrder(seedTrip());
    expect(ordinals.has("crater")).toBe(false);
    expect(total).toBe(3);
  });

  it("orders across legs by date, not by leg — the sequence is trip-wide", () => {
    // Move Bend to the front of the calendar while leaving it in the second leg.
    const trip = seedTrip();
    trip.legs[1]!.stops[0]!.arriveDate = "2026-08-01";
    trip.legs[1]!.stops[0]!.departDate = "2026-08-02";
    const { ordinals } = scheduledOrder(trip);
    expect(ordinals.get("bend")).toBe(1);
    expect(ordinals.get("astoria")).toBe(2);
    expect(ordinals.get("newport")).toBe(3);
  });

  it("is empty for a trip with nothing scheduled", () => {
    const trip = seedTrip();
    for (const leg of trip.legs) {
      for (const stop of leg.stops) {
        stop.arriveDate = null;
        stop.departDate = null;
      }
    }
    const { ordinals, total } = scheduledOrder(trip);
    expect(total).toBe(0);
    expect(ordinals.size).toBe(0);
  });
});

describe("tripStopPins", () => {
  it("draws one pin per stop with coordinates, in leg then stop order", () => {
    const pins = tripStopPins(seedTrip());
    expect(pins.map((p) => p.id)).toEqual(["astoria", "newport", "bend", "crater"]);
    expect(pins.map((p) => p.name)).toEqual([
      "Astoria, OR",
      "Newport, OR",
      "Bend, OR",
      "Crater Lake NP",
    ]);
  });

  it("carries the scheduled ordinal, and null + floating for the floating stop", () => {
    const pins = tripStopPins(seedTrip());
    expect(pins.map((p) => p.ordinal)).toEqual([1, 2, 3, null]);
    expect(pins.map((p) => p.floating)).toEqual([false, false, false, true]);
  });

  it("carries the real coordinates, narrowed — never null", () => {
    const astoria = tripStopPins(seedTrip())[0]!;
    expect(astoria.lat).toBe(46.1879);
    expect(astoria.lng).toBe(-123.8313);
  });

  it("drops a coordless stop rather than drawing it at 0,0", () => {
    const trip = seedTrip();
    trip.legs[0]!.stops[1]!.place = { name: "Newport, OR", lat: null, lng: null, googlePlaceId: null };
    const pins = tripStopPins(trip);
    expect(pins.map((p) => p.id)).toEqual(["astoria", "bend", "crater"]);
    // The ordinal is still the SCHEDULED sequence's, which counts the stop even
    // though the map cannot draw it — the rail and the map must not disagree.
    expect(pins.find((p) => p.id === "bend")!.ordinal).toBe(3);
  });
});

describe("arcFeatureCollection", () => {
  it("is one FeatureCollection with one LineString per arc, keyed by id and source", () => {
    const arcs = tripArcs(seedTrip());
    const fc = arcFeatureCollection(arcs);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(arcs.length);
    expect(fc.features.map((f) => f.properties.id)).toEqual(arcs.map((a) => a.id));
    for (const f of fc.features) {
      expect(f.type).toBe("Feature");
      expect(f.geometry.type).toBe("LineString");
      expect(f.properties.source).toBe("estimate");
    }
  });

  it("keeps the decoded corridor geometry untouched — the layers case on `source`", () => {
    const trip = seedTrip();
    const pair = orderedPairs(trip).find((p) => p.fromStopId === "astoria")!;
    const polyline = encodeFlexiblePolyline([
      { lat: pair.from.lat, lng: pair.from.lng },
      { lat: 45.5, lng: -124.2 },
      { lat: pair.to.lat, lng: pair.to.lng },
    ]);
    const result: RouteResult = {
      durationSeconds: 9300,
      distanceMeters: 189_900,
      polyline,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const routes: RouteMap = { [routeCacheKey(pair.from, pair.to, HASH)]: result };
    const arcs = tripArcs(trip, routes, HASH);
    const routed = arcs.find((a) => a.source === "here")!;
    const feature = arcFeatureCollection(arcs).features.find((f) => f.properties.source === "here")!;
    expect(feature.geometry.coordinates).toEqual(routed.path);
    expect(feature.geometry.coordinates).toHaveLength(3);
  });

  it("is an empty collection for no arcs, never null — one source, always", () => {
    expect(arcFeatureCollection([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("arcVertices", () => {
  it("flips every [lng, lat] corridor vertex to a drawable { lat, lng } point", () => {
    const arcs = tripArcs(seedTrip());
    const vertices = arcVertices(arcs);
    expect(vertices).toHaveLength(arcs.reduce((n, a) => n + a.path.length, 0));
    // Oregon: latitudes ~42-47, longitudes ~-125..-121. A tuple read in the
    // wrong order puts every point in the Southern Ocean.
    for (const v of vertices) {
      expect(v.lat).toBeGreaterThan(40);
      expect(v.lat).toBeLessThan(50);
      expect(v.lng).toBeLessThan(-100);
    }
  });

  it("is empty for no arcs", () => {
    expect(arcVertices([])).toEqual([]);
  });
});

describe("mapBounds", () => {
  it("encloses the pins when every arc is a two-point chord", () => {
    const trip = seedTrip();
    const pins = tripStopPins(trip);
    const bounds = mapBounds(tripArcs(trip), pins)!;
    expect(bounds.north).toBeCloseTo(46.1879, 4);
    expect(bounds.south).toBeCloseTo(42.9446, 4);
    expect(bounds.west).toBeCloseTo(-124.053, 4);
    expect(bounds.east).toBeCloseTo(-121.3153, 4);
  });

  it("widens to hold a routed corridor that runs outside its endpoints", () => {
    const trip = seedTrip();
    const pair = orderedPairs(trip).find((p) => p.fromStopId === "astoria")!;
    // US-101 runs WEST of both Astoria and Newport: a vertex at -124.9 is
    // outside the box the four pins alone would produce.
    const polyline = encodeFlexiblePolyline([
      { lat: pair.from.lat, lng: pair.from.lng },
      { lat: 45.5, lng: -124.9 },
      { lat: pair.to.lat, lng: pair.to.lng },
    ]);
    const result: RouteResult = {
      durationSeconds: 9300,
      distanceMeters: 189_900,
      polyline,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const routes: RouteMap = { [routeCacheKey(pair.from, pair.to, HASH)]: result };
    const pins = tripStopPins(trip);
    const withCorridor = mapBounds(tripArcs(trip, routes, HASH), pins)!;
    expect(withCorridor.west).toBeCloseTo(-124.9, 1);
    expect(withCorridor.west).toBeLessThan(mapBounds(tripArcs(trip), pins)!.west);
  });

  it("pads a single pin to a finite box rather than asking for infinite zoom", () => {
    const bounds = mapBounds([], [{ lat: 44.6365, lng: -124.053 }])!;
    expect(bounds.north - bounds.south).toBeCloseTo(MIN_BOUNDS_SPAN, 10);
    expect(bounds.east - bounds.west).toBeCloseTo(MIN_BOUNDS_SPAN, 10);
  });

  it("is null when there is nothing to fit — the caller draws a frame instead", () => {
    expect(mapBounds([], [])).toBeNull();
  });
});
