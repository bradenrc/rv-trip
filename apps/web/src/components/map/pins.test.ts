import { describe, it, expect } from "vitest";
import {
  type Idea,
  encodeFlexiblePolyline,
  orderedPairs,
  routeCacheKey,
  type RouteMap,
  type RouteResult,
  type Destination,
  type Trip,
} from "@rv-trip/core";
import { buildMapModel, layerCounts, locateRowOf, type IdeaPin, type UnmappedRow } from "./pins";

/**
 * The map's drive arcs (docs/design/43 §2).
 *
 * What this guards is the seam the corridor needs: one arc per
 * `orderedPairs()` pair — the SAME pair set the Route rail and the dashboard
 * card key on, floating destinations included — each carrying the `source` the Mapbox
 * layer paints by, and its decoded geometry. A trip you have already taken
 * still draws nothing.
 */

const HASH = "test-routing-hash";

/** HERE's published flexible-polyline test vector — four vertices. */
const HERE_CORRIDOR = "BFoz5xJ67i1B1B7PzIhaxL7Y";

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

/** The seed fixture's shape: two chapters, three dated destinations, one floating. */
function seedTrip(status: Trip["status"] = "planning"): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    homeBasePlace: null,
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status,
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
          // Floating — no dates. It sits at the end of ITS chapter, so the pair
          // Bend → Crater Lake is the trip's last drive.
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

/** A routed answer for one pair, with a four-vertex corridor. */
function routedPair(trip: Trip, fromDestinationId: string, primaryRoad: string): RouteMap {
  const pair = orderedPairs(trip).find((p) => p.fromDestinationId === fromDestinationId);
  expect(pair, `pair leaving ${fromDestinationId}`).toBeDefined();
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
    // …while every one of its destinations is still on the map.
    expect(pins).toHaveLength(4);
  });

  it("skips a pair whose coordinates are missing rather than inventing one", () => {
    const trip = seedTrip();
    trip.chapters[0]!.destinations[1]!.place = { name: "Newport, OR", lat: null, lng: null, googlePlaceId: null };
    const { arcs, unmapped } = buildMapModel([trip], [], {}, HASH);
    // orderedPairs yields no pair on either side of a coordless destination.
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

/**
 * Ideas on the map (#69, Q1/Q2/Q4 = A).
 *
 * An idea is the grammar's *maybe*, and `ideas` has carried place_name / lat /
 * lng / google_place_id since day one — nothing ever drew them. Three
 * behaviours are load-bearing: a located idea becomes a third pin kind, a
 * coordless one becomes an `UnmappedRow` at ANY status (Q4 = A), and the
 * row's `kind` is carried EXPLICITLY rather than derived from the layer.
 */
function mkIdea(over: Partial<Idea> & { id: string }): Idea {
  return {
    id: over.id,
    tripId: over.tripId ?? "t1",
    destinationId: over.destinationId ?? "bend",
    title: over.title ?? "Deschutes River float",
    category: over.category ?? "do",
    status: over.status ?? "idea",
    place: over.place ?? null,
    rating: over.rating ?? null,
    notes: over.notes ?? null,
    sortOrder: over.sortOrder ?? 0,
    lastChange: null,
    again: null,
  };
}

/** The seed trip with ideas hung under Bend. */
function tripWithIdeas(ideas: Idea[]): Trip {
  const trip = seedTrip();
  trip.chapters[1]!.destinations[0]!.ideas = ideas;
  return trip;
}

describe("buildMapModel — the third pin kind", () => {
  it("draws a located idea as an IdeaPin carrying its destination, trip and status", () => {
    const trip = tripWithIdeas([
      mkIdea({
        id: "tumalo",
        title: "Tumalo Falls trailhead",
        status: "planned",
        place: {
          name: "Tumalo Falls Trailhead",
          lat: 44.0317,
          lng: -121.5678,
          googlePlaceId: "ChIJtumalo",
        },
      }),
    ]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    const idea = pins.find((p) => p.kind === "idea") as IdeaPin;
    expect(idea).toMatchObject({
      kind: "idea",
      id: "tumalo",
      lat: 44.0317,
      lng: -121.5678,
      layer: "planning",
      name: "Tumalo Falls trailhead",
      status: "planned",
      destinationName: "Bend, OR",
      tripId: "t1",
      tripTitle: "Pacific Northwest Loop",
    });
    expect(unmapped).toEqual([]);
  });

  it("names the IDEA's title on the pin, not the place it resolved to", () => {
    // The rail row and the sheet row have to read as the same object.
    const trip = tripWithIdeas([
      mkIdea({
        id: "aquarium",
        title: "Oregon Coast Aquarium",
        place: { name: "Oregon Coast Aquarium, Newport", lat: 44.617, lng: -124.048, googlePlaceId: null },
      }),
    ]);
    const { pins } = buildMapModel([trip], [], {}, HASH);
    expect(pins.find((p) => p.kind === "idea")!.name).toBe("Oregon Coast Aquarium");
  });

  it("keeps a coordless idea as an unmapped row at EVERY status (Q4 = A)", () => {
    const trip = tripWithIdeas([
      mkIdea({ id: "float", title: "Deschutes River float", status: "idea" }),
      mkIdea({ id: "rim", title: "Rim Drive scenic loop", status: "planned" }),
      mkIdea({ id: "done", title: "Pilot Butte at sunset", status: "done" }),
    ]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    expect(pins.some((p) => p.kind === "idea")).toBe(false);
    expect(unmapped.map((u) => u.id)).toEqual(["float", "rim", "done"]);
  });

  it("treats a NAMED but coordless idea as unmapped — the picker's escape row", () => {
    // `mapIdea` returns a non-null `place` the moment place_name is set, with
    // lat/lng still null. Half a place is not a pin.
    const trip = tripWithIdeas([
      mkIdea({
        id: "float",
        place: { name: "Deschutes River", lat: null, lng: null, googlePlaceId: null },
      }),
    ]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    expect(pins.some((p) => p.kind === "idea")).toBe(false);
    expect(unmapped.map((u) => [u.id, u.kind])).toEqual([["float", "idea"]]);
  });

  it("carries `kind` on every unmapped row — the derivation would have lied about an idea", () => {
    const trip = tripWithIdeas([mkIdea({ id: "float" })]);
    trip.chapters[0]!.destinations[0]!.place = { name: "Astoria, OR", lat: null, lng: null, googlePlaceId: null };
    const { unmapped } = buildMapModel(
      [trip],
      [
        {
          id: "bakery",
          ownerId: "dev-user",
          place: { name: "Sisters Bakery", lat: null, lng: null, googlePlaceId: null },
          region: null,
          type: "dining",
          status: "want",
          note: null,
          source: null,
          rating: null,
          tripId: null,
          tripName: null,
          lastChange: null,
          again: null,
          anchor: "area",
          areaLabel: null,
          area: null,
          suggestedPlace: null,
          createdAt: null,
        },
      ],
      {},
      HASH,
    );
    expect(unmapped.map((u) => [u.id, u.kind])).toEqual([
      ["astoria", "destination"],
      ["float", "idea"],
      ["bakery", "place"],
    ]);
    // …and `locateRowOf` is now a passthrough of that field.
    expect(unmapped.map(locateRowOf)).toEqual([
      { kind: "destination", id: "astoria" },
      { kind: "idea", id: "float" },
      { kind: "place", id: "bakery" },
    ]);
  });

  it("counts an idea under its trip's layer, mapped or not (G4)", () => {
    const trip = tripWithIdeas([
      mkIdea({
        id: "tumalo",
        place: { name: "Tumalo Falls Trailhead", lat: 44.0317, lng: -121.5678, googlePlaceId: null },
      }),
      mkIdea({ id: "float" }),
    ]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    // Four destinations + one idea pin drawn, one idea still unmapped.
    expect(layerCounts(pins, unmapped).planning).toBe(6);
  });

  it("never lets an idea reach the `saved` layer — only the shelf lives there", () => {
    const trip = tripWithIdeas([mkIdea({ id: "float" })]);
    const rows: UnmappedRow[] = buildMapModel([trip], [], {}, HASH).unmapped;
    expect(rows.every((u) => u.layer !== "saved")).toBe(true);
  });
});

/**
 * The SHELF (#80 i4). `trip.ideas[]` is the trip's unattached ideas — the rows
 * with `destination_id IS NULL` that i1 put on the tree. They are drawable points like
 * any other idea, and they are the reason the camera box can now grow a genuine
 * outlier: a shelf idea is parked wherever the reader found it, not beside a
 * destination.
 */
function tripWithShelf(ideas: Idea[]): Trip {
  const trip = seedTrip();
  trip.ideas = ideas;
  return trip;
}

describe("buildMapModel — the trip's idea shelf", () => {
  const moab = {
    name: "Arches National Park",
    lat: 38.7331,
    lng: -109.5925,
    googlePlaceId: "ChIJarches",
  };

  it("draws a located shelf idea, with no destination name to borrow", () => {
    const trip = tripWithShelf([
      mkIdea({ id: "arches", destinationId: null, title: "Arches at sunrise", place: moab }),
    ]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    const idea = pins.find((p) => p.kind === "idea") as IdeaPin;
    expect(idea).toMatchObject({
      kind: "idea",
      id: "arches",
      lat: 38.7331,
      lng: -109.5925,
      layer: "planning",
      name: "Arches at sunrise",
      // An unattached idea hangs under no destination — the rail prints the trip alone.
      destinationName: null,
      tripId: "t1",
      tripTitle: "Pacific Northwest Loop",
    });
    expect(unmapped).toEqual([]);
  });

  it("keeps a coordless shelf idea as an unmapped `idea` row, so Locate can reach it", () => {
    const trip = tripWithShelf([mkIdea({ id: "hot-springs", destinationId: null, title: "a hot spring" })]);
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    expect(pins.some((p) => p.kind === "idea")).toBe(false);
    expect(unmapped.map((u) => [u.id, u.kind, u.layer])).toEqual([
      ["hot-springs", "idea", "planning"],
    ]);
    expect(unmapped.map(locateRowOf)).toEqual([{ kind: "idea", id: "hot-springs" }]);
  });

  it("counts a shelf idea under its trip's layer beside the attached ones", () => {
    const trip = tripWithShelf([
      mkIdea({ id: "arches", destinationId: null, place: moab }),
      mkIdea({ id: "hot-springs", destinationId: null }),
    ]);
    trip.chapters[1]!.destinations[0]!.ideas = [mkIdea({ id: "float" })];
    const { pins, unmapped } = buildMapModel([trip], [], {}, HASH);
    // Four destinations + one shelf pin drawn; one shelf row and one attached row unmapped.
    expect(layerCounts(pins, unmapped).planning).toBe(7);
    expect(pins.filter((p) => p.kind === "idea").map((p) => p.id)).toEqual(["arches"]);
  });

  it("draws the shelf's ideas once, after the destinations they are not attached to", () => {
    // Render order is z-order (MapView keys the marker tier off `kind`, but the
    // rail reads this list straight): a shelf idea is neither duplicated under a
    // destination nor interleaved with one.
    const trip = tripWithShelf([mkIdea({ id: "arches", destinationId: null, place: moab })]);
    const { pins } = buildMapModel([trip], [], {}, HASH);
    expect(pins.map((p) => p.id)).toEqual(["astoria", "newport", "bend", "crater", "arches"]);
  });
});
