import { describe, it, expect } from "vitest";
import { boundsCovers, MIN_BOUNDS_SPAN } from "../domain/bounds";
import { orderedPairs, routeCacheKey } from "../domain/route-order";
import type { Destination, Trip } from "../domain/types";
import type { RouteResult } from "../providers/index";
import { encodeFlexiblePolyline } from "../providers/polyline";
import type { RouteMap } from "./index";
import { tripArcs } from "./map-arcs";
import {
  arcFeatureCollection,
  arcVertices,
  mapBounds,
  scheduledOrder,
  tripDestinationPins,
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

function mkDestination(partial: Partial<Destination> & { id: string; chapterId: string }): Destination {
  return {
    id: partial.id,
    chapterId: partial.chapterId,
    place: partial.place ?? { name: partial.id, lat: 45, lng: -122, googlePlaceId: null },
    arriveDate: partial.arriveDate ?? null,
    departDate: partial.departDate ?? null,
    sortOrder: partial.sortOrder ?? 0,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
    again: null,
  };
}

/** The seed fixture the wireframe draws: three dated destinations, one floating. */
function seedTrip(): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    homeBasePlace: null,
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    ideas: [],
    chapters: [
      {
        id: "coast",
        tripId: "t1",
        title: "Oregon Coast",
        sortOrder: 0,
        destinations: [
          mkDestination({
            id: "astoria",
            chapterId: "coast",
            place: { name: "Astoria, OR", lat: 46.1879, lng: -123.8313, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-05",
            sortOrder: 0,
          }),
          mkDestination({
            id: "newport",
            chapterId: "coast",
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
        destinations: [
          mkDestination({
            id: "bend",
            chapterId: "cascades",
            place: { name: "Bend, OR", lat: 44.0582, lng: -121.3153, googlePlaceId: null },
            arriveDate: "2026-08-12",
            departDate: "2026-08-16",
            sortOrder: 0,
          }),
          mkDestination({
            id: "crater",
            chapterId: "cascades",
            place: { name: "Crater Lake NP", lat: 42.9446, lng: -122.109, googlePlaceId: null },
            sortOrder: 1,
          }),
        ],
      },
    ],
    defaultMode: "drive",
    lodgingDefault: null,
    rigOn: true,
    surfaceRadiusMi: null,
    segments: [],
  };
}

describe("scheduledOrder", () => {
  it("numbers the scheduled destinations trip-wide by arrival date, and counts them", () => {
    const { ordinals, total } = scheduledOrder(seedTrip());
    expect(total).toBe(3);
    expect(ordinals.get("astoria")).toBe(1);
    expect(ordinals.get("newport")).toBe(2);
    expect(ordinals.get("bend")).toBe(3);
  });

  it("gives a floating destination no ordinal and does not count it in the total", () => {
    const { ordinals, total } = scheduledOrder(seedTrip());
    expect(ordinals.has("crater")).toBe(false);
    expect(total).toBe(3);
  });

  it("orders across chapters by date, not by chapter — the sequence is trip-wide", () => {
    // Move Bend to the front of the calendar while leaving it in the second chapter.
    const trip = seedTrip();
    trip.chapters[1]!.destinations[0]!.arriveDate = "2026-08-01";
    trip.chapters[1]!.destinations[0]!.departDate = "2026-08-02";
    const { ordinals } = scheduledOrder(trip);
    expect(ordinals.get("bend")).toBe(1);
    expect(ordinals.get("astoria")).toBe(2);
    expect(ordinals.get("newport")).toBe(3);
  });

  it("is empty for a trip with nothing scheduled", () => {
    const trip = seedTrip();
    for (const chapter of trip.chapters) {
      for (const destination of chapter.destinations) {
        destination.arriveDate = null;
        destination.departDate = null;
      }
    }
    const { ordinals, total } = scheduledOrder(trip);
    expect(total).toBe(0);
    expect(ordinals.size).toBe(0);
  });
});

describe("tripDestinationPins", () => {
  it("draws one pin per destination with coordinates, in chapter then destination order", () => {
    const pins = tripDestinationPins(seedTrip());
    expect(pins.map((p) => p.id)).toEqual(["astoria", "newport", "bend", "crater"]);
    expect(pins.map((p) => p.name)).toEqual([
      "Astoria, OR",
      "Newport, OR",
      "Bend, OR",
      "Crater Lake NP",
    ]);
  });

  it("carries the scheduled ordinal, and null + floating for the floating destination", () => {
    const pins = tripDestinationPins(seedTrip());
    expect(pins.map((p) => p.ordinal)).toEqual([1, 2, 3, null]);
    expect(pins.map((p) => p.floating)).toEqual([false, false, false, true]);
  });

  it("carries the real coordinates, narrowed — never null", () => {
    const astoria = tripDestinationPins(seedTrip())[0]!;
    expect(astoria.lat).toBe(46.1879);
    expect(astoria.lng).toBe(-123.8313);
  });

  it("drops a coordless destination rather than drawing it at 0,0", () => {
    const trip = seedTrip();
    trip.chapters[0]!.destinations[1]!.place = { name: "Newport, OR", lat: null, lng: null, googlePlaceId: null };
    const pins = tripDestinationPins(trip);
    expect(pins.map((p) => p.id)).toEqual(["astoria", "bend", "crater"]);
    // The ordinal is still the SCHEDULED sequence's, which counts the destination even
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
    const pair = orderedPairs(trip).find((p) => p.fromDestinationId === "astoria")!;
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
    const pins = tripDestinationPins(trip);
    const bounds = mapBounds(tripArcs(trip), pins)!;
    expect(bounds.north).toBeCloseTo(46.1879, 4);
    expect(bounds.south).toBeCloseTo(42.9446, 4);
    expect(bounds.west).toBeCloseTo(-124.053, 4);
    expect(bounds.east).toBeCloseTo(-121.3153, 4);
  });

  it("widens to hold a routed corridor that runs outside its endpoints", () => {
    const trip = seedTrip();
    const pair = orderedPairs(trip).find((p) => p.fromDestinationId === "astoria")!;
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
    const pins = tripDestinationPins(trip);
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

  /**
   * #80 i4 — the trip-level shelf lets an idea sit anywhere on the trip, so the
   * camera box can now grow a genuine outlier. The two properties the refit
   * rests on: the box holds EVERY point, and the fit grows rather than
   * collapsing.
   */
  it("holds a far-flung idea without collapsing the fit", () => {
    const trip = seedTrip();
    const arcs = tripArcs(trip);
    const pins = tripDestinationPins(trip);
    // A shelf idea parked a long way off the route — Moab, UT.
    const idea = { lat: 38.5733, lng: -109.5498 };

    const before = mapBounds(arcs, pins)!;
    const after = mapBounds(arcs, [...pins, idea])!;

    for (const p of [...pins, idea]) {
      expect(p.lat).toBeGreaterThanOrEqual(after.south);
      expect(p.lat).toBeLessThanOrEqual(after.north);
      expect(p.lng).toBeGreaterThanOrEqual(after.west);
      expect(p.lng).toBeLessThanOrEqual(after.east);
    }
    expect(after.south).toBeCloseTo(idea.lat, 4);
    expect(after.east).toBeCloseTo(idea.lng, 4);
    expect(after.north - after.south).toBeGreaterThan(before.north - before.south);
    expect(after.east - after.west).toBeGreaterThan(before.east - before.west);
    expect(after.north - after.south).toBeGreaterThan(MIN_BOUNDS_SPAN);
  });

  /** The other half of the refit guard: the camera only moves when the new box
   * is NOT already on screen (bounds.ts `boundsCovers`). */
  it("a near idea is already covered by the box the destinations make; the outlier is not", () => {
    const trip = seedTrip();
    const arcs = tripArcs(trip);
    const pins = tripDestinationPins(trip);
    const shown = mapBounds(arcs, pins)!;

    const near = mapBounds(arcs, [...pins, { lat: 44.0601, lng: -121.3402 }])!;
    expect(boundsCovers(shown, near)).toBe(true);

    const far = mapBounds(arcs, [...pins, { lat: 38.5733, lng: -109.5498 }])!;
    expect(boundsCovers(shown, far)).toBe(false);
  });
});
