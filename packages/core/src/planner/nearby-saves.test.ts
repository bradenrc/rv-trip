import { describe, expect, it } from "vitest";
import type { Idea, NearbySave, SavedPlace, Stop, Trip } from "../domain/types";
import { ideaCreateInput, nearbySavesResponse as nearbySavesSchema } from "../domain/types";
import {
  IDEAS_EMPTY_COPY,
  addAllLabel,
  ideasHeading,
  nearbyBanner,
  nearbyBeyondLine,
  nearbyCountLabel,
  nearbyIdeaBody,
  nearbyRowLine,
  nearbySaves,
  nextSurfaceRing,
} from "./nearby-saves";
import { NEAR_RADIUS_MI } from "./shelf";

/**
 * Trip surfacing (#111 i3 · docs/design/111 "#102 · trip surfacing").
 *
 * The Oregon Coast fixture EXACTLY as the plan's acceptance states it: two
 * stops (Astoria + Newport) and the seven saves of the design's distance
 * table. The coordinates are chosen so haversine gives the table's numbers —
 * South Beach 1.9, Fort Stevens 6.2 (a hair nearer than Beverly Beach's 6.2,
 * which is the order the frame draws), Nehalem Bay 34.3 → "34", Cape Lookout
 * 50.3, Kalaloch 101.7 and the BLM pin 110.5. The frame COUNTS in the other
 * surfaces of the wireframe are illustrative (vet MED) and are not asserted.
 */

const ASTORIA = { name: "Astoria, OR", lat: 46.1879, lng: -123.8313 };
const NEWPORT = { name: "Newport, OR", lat: 44.6365, lng: -124.053 };

function stop(id: string, p: { name: string; lat: number | null; lng: number | null }, sortOrder: number): Stop {
  return {
    id,
    legId: "L1",
    place: { ...p, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    sortOrder,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
  };
}

function idea(over: Partial<Idea> & { id: string }): Idea {
  return {
    tripId: "T1",
    stopId: null,
    title: "A maybe",
    category: "stay",
    status: "idea",
    place: null,
    rating: null,
    notes: null,
    sortOrder: 0,
    lastChange: null,
    ...over,
  };
}

function coast(ideas: Idea[] = [], stops: Stop[] = [stop("S_ast", ASTORIA, 0), stop("S_new", NEWPORT, 1)]): Trip {
  return {
    id: "T1",
    ownerId: "dev-user",
    title: "Oregon Coast, summer '27",
    homeBase: null,
    homeBasePlace: null,
    startDate: "2027-07-01",
    endDate: "2027-07-14",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    defaultMode: "drive",
    lodgingDefault: null,
    rigOn: true,
    surfaceRadiusMi: null,
    legs: [{ id: "L1", tripId: "T1", title: "Coast", sortOrder: 0, stops }],
    segments: [],
    ideas,
  };
}

function save(over: Partial<SavedPlace> & { id: string; name: string; lat: number | null; lng: number | null }): SavedPlace {
  const { name, lat, lng, ...rest } = over;
  return {
    ownerId: "dev-user",
    place: { name, lat, lng, googlePlaceId: null },
    region: null,
    type: "campground",
    status: "want",
    note: null,
    source: null,
    rating: null,
    tripId: null,
    tripName: null,
    lastChange: null,
    anchor: "pin",
    areaLabel: null,
    destination: null,
    suggestedPlace: null,
    createdAt: null,
    ...rest,
  };
}

const SAVES: SavedPlace[] = [
  save({ id: "s_south", name: "South Beach State Park", lat: 44.6094, lng: -124.0631, status: "been", rating: 5 }),
  save({ id: "s_fort", name: "Fort Stevens State Park", lat: 46.2045, lng: -123.958, source: "Jane & Rick" }),
  save({ id: "s_bev", name: "Beverly Beach State Park", lat: 44.7262, lng: -124.0578, source: "Jane & Rick" }),
  save({ id: "s_neh", name: "Nehalem Bay State Park", lat: 45.6967, lng: -123.9335, source: "Jane & Rick" }),
  save({ id: "s_cape", name: "Cape Lookout State Park", lat: 45.3623, lng: -123.9728, source: "Marcy" }),
  save({ id: "s_kal", name: "Kalaloch Campground", lat: 47.6118, lng: -124.3762, source: "Jane & Rick" }),
  save({ id: "s_blm", name: "great BLM camp spot", lat: 43.05, lng: -124.33 }),
];

const names = (items: NearbySave[]) => items.map((i) => i.name);

describe("nearbySaves — the Oregon Coast fixture", () => {
  it("at 50 mi: South Beach 1.9, Fort Stevens 6.2, Beverly Beach 6.2, Nehalem Bay 34 — beyond is Cape Lookout at 50.3", () => {
    const r = nearbySaves(coast(), SAVES, [], 50);
    expect(r.radiusMi).toBe(50);
    expect(r.items.map((i) => [i.name, i.nearestStop.name, i.distanceMi])).toEqual([
      ["South Beach State Park", "Newport, OR", 1.9],
      ["Fort Stevens State Park", "Astoria, OR", 6.2],
      ["Beverly Beach State Park", "Newport, OR", 6.2],
      ["Nehalem Bay State Park", "Astoria, OR", 34],
    ]);
    expect(r.beyond).toEqual({
      radiusMi: 100,
      count: 1,
      nearestMi: 50.3,
      nearestName: "Cape Lookout State Park",
    });
    // The wire contract parses what the function returns.
    expect(nearbySavesSchema.parse(r)).toEqual(r);
  });

  it("at 100 mi: adds Cape Lookout; beyond is 2, the nearest at 101.7", () => {
    const r = nearbySaves(coast(), SAVES, [], 100);
    expect(names(r.items)).toEqual([
      "South Beach State Park",
      "Fort Stevens State Park",
      "Beverly Beach State Park",
      "Nehalem Bay State Park",
      "Cape Lookout State Park",
    ]);
    const cape = r.items.at(-1)!;
    expect(cape.distanceMi).toBe(50);
    expect(cape.nearestStop).toEqual({ id: "S_new", name: "Newport, OR" });
    expect(r.beyond).toEqual({
      radiusMi: 200,
      count: 2,
      nearestMi: 101.7,
      nearestName: "Kalaloch Campground",
    });
  });

  it("at 25 mi: the next ring is 50", () => {
    const r = nearbySaves(coast(), SAVES, [], 25);
    expect(names(r.items)).toEqual([
      "South Beach State Park",
      "Fort Stevens State Park",
      "Beverly Beach State Park",
    ]);
    expect(r.beyond).toMatchObject({ radiusMi: 50, count: 1, nearestMi: 34.3 });
  });

  it("at 200 mi there is no next ring: beyond is null", () => {
    const r = nearbySaves(coast(), SAVES, [], 200);
    expect(r.items).toHaveLength(7);
    expect(r.beyond).toBeNull();
  });

  it("a null radius reads as NEAR_RADIUS_MI (50)", () => {
    expect(NEAR_RADIUS_MI).toBe(50);
    const r = nearbySaves(coast(), SAVES, [], null);
    expect(r.radiusMi).toBe(50);
    expect(r.items).toHaveLength(4);
  });

  it("carries the display fields and the save's own place", () => {
    const [south, fort] = nearbySaves(coast(), SAVES, [], 50).items;
    expect(south).toEqual({
      saveId: "s_south",
      name: "South Beach State Park",
      type: "campground",
      status: "been",
      rating: 5,
      source: null,
      place: { name: "South Beach State Park", lat: 44.6094, lng: -124.0631, googlePlaceId: null },
      nearestStop: { id: "S_new", name: "Newport, OR" },
      distanceMi: 1.9,
    });
    expect(fort!.source).toBe("Jane & Rick");
  });
});

describe("nearbySaves — what is left out", () => {
  it("drops dismissed save ids", () => {
    const r = nearbySaves(coast(), SAVES, ["s_fort", "s_neh"], 50);
    expect(names(r.items)).toEqual(["South Beach State Park", "Beverly Beach State Park"]);
  });

  it("a dismissed save no longer counts in beyond either", () => {
    const r = nearbySaves(coast(), SAVES, ["s_cape"], 50);
    expect(r.beyond).toBeNull();
  });

  it("drops saves already on the trip as an idea (isAlreadySaved on the idea's place)", () => {
    const trip = coast([
      // An Add from this sheet — the same name and point.
      idea({
        id: "i1",
        title: "Fort Stevens State Park",
        place: { name: "Fort Stevens State Park", lat: 46.2045, lng: -123.958, googlePlaceId: null },
      }),
    ]);
    // …and one already dragged onto a stop still counts as on the trip.
    trip.legs[0]!.stops[1]!.ideas = [
      idea({
        id: "i2",
        stopId: "S_new",
        title: "South Beach",
        place: { name: "South Beach State Park", lat: 44.6094, lng: -124.0631, googlePlaceId: null },
      }),
    ];
    const r = nearbySaves(trip, SAVES, [], 50);
    expect(names(r.items)).toEqual(["Beverly Beach State Park", "Nehalem Bay State Park"]);
  });

  it("an idea of the same name 5 mi away is a different place and does not exclude", () => {
    const trip = coast([
      idea({
        id: "i1",
        title: "Beverly Beach State Park",
        place: { name: "Beverly Beach State Park", lat: 44.8, lng: -124.06, googlePlaceId: null },
      }),
    ]);
    expect(names(nearbySaves(trip, SAVES, [], 50).items)).toContain("Beverly Beach State Park");
  });

  it("skips a save with no point at all (no coords, no destination coords)", () => {
    const r = nearbySaves(coast(), [save({ id: "x", name: "somewhere", lat: null, lng: null, anchor: "area" })], [], 200);
    expect(r.items).toEqual([]);
    expect(r.beyond).toBeNull();
  });

  it("a trip with no located stops surfaces nothing", () => {
    const trip = coast([], [stop("S_x", { name: "TBD", lat: null, lng: null }, 0)]);
    const r = nearbySaves(trip, SAVES, [], 200);
    expect(r.items).toEqual([]);
    expect(r.beyond).toBeNull();
  });
});

describe("nearbySaves — an area save with no coordinates", () => {
  it("is measured from its destination's coordinates, and keeps its own coordless place", () => {
    const note = save({
      id: "s_note",
      name: "taco stand Jane mentioned",
      lat: null,
      lng: null,
      anchor: "area",
      areaLabel: "Newport, OR",
      type: "dining",
      destination: {
        id: "d_new",
        name: "Newport, OR",
        region: "Oregon",
        googlePlaceId: "ChIJnewport",
        lat: 44.6368,
        lng: -124.0535,
      },
    });
    const r = nearbySaves(coast(), [note], [], 25);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.nearestStop.name).toBe("Newport, OR");
    expect(r.items[0]!.distanceMi).toBe(0);
    expect(r.items[0]!.place).toEqual({
      name: "taco stand Jane mentioned",
      lat: null,
      lng: null,
      googlePlaceId: null,
    });
  });

  it("a save's own coordinates win over its destination's", () => {
    const pin = save({
      id: "s_pin",
      name: "pin",
      lat: 43.05,
      lng: -124.33,
      destination: {
        id: "d_new",
        name: "Newport, OR",
        region: "Oregon",
        googlePlaceId: "ChIJnewport",
        lat: 44.6368,
        lng: -124.0535,
      },
    });
    expect(nearbySaves(coast(), [pin], [], 100).items).toEqual([]);
  });
});

describe("nextSurfaceRing", () => {
  it("walks 25 → 50 → 100 → 200 → none", () => {
    expect(nextSurfaceRing(25)).toBe(50);
    expect(nextSurfaceRing(50)).toBe(100);
    expect(nextSurfaceRing(100)).toBe(200);
    expect(nextSurfaceRing(200)).toBeNull();
  });
});

describe("the banner, sheet and Ideas copy", () => {
  it("banner: '{n} of your saves are near this trip' / 'within {r} mi of a stop · tap to review'", () => {
    expect(nearbyBanner(4, 50)).toEqual({
      title: "4 of your saves are near this trip",
      sub: "within 50 mi of a stop · tap to review",
      dismiss: "Dismiss",
    });
    expect(nearbyBanner(5, 100).sub).toBe("within 100 mi of a stop · tap to review");
    expect(nearbyBanner(1, 50).title).toBe("1 of your saves is near this trip");
  });

  it("the sheet head counts saves", () => {
    expect(nearbyCountLabel(4)).toBe("4 saves");
    expect(nearbyCountLabel(1)).toBe("1 save");
  });

  it("a row reads distance · nearest stop · who", () => {
    const [south, fort, , neh] = nearbySaves(coast(), SAVES, [], 50).items;
    expect(nearbyRowLine(fort!)).toBe("6.2 mi · Astoria, OR · Jane & Rick");
    expect(nearbyRowLine(neh!)).toBe("34 mi · Astoria, OR · Jane & Rick");
    // A been save names the shelf; the Stars render after it.
    expect(nearbyRowLine(south!)).toBe("1.9 mi · Newport, OR · Been");
    const blm = nearbySaves(coast(), SAVES, [], 200).items.at(-1)!;
    expect(nearbyRowLine(blm)).toBe("110 mi · Newport, OR");
  });

  it("the beyond line", () => {
    const r50 = nearbySaves(coast(), SAVES, [], 50);
    expect(nearbyBeyondLine(r50.beyond!, 50)).toEqual({
      lead: "1 more just past 50 mi",
      rest: ", the nearest at 50.3 mi (Cape Lookout State Park). Tap 100 mi.",
    });
    const r100 = nearbySaves(coast(), SAVES, [], 100);
    expect(nearbyBeyondLine(r100.beyond!, 100)).toEqual({
      lead: "2 more just past 100 mi",
      rest: ", the nearest at 101.7 mi (Kalaloch Campground). Tap 200 mi.",
    });
  });

  it("Add all counts what is still to add", () => {
    expect(addAllLabel(4)).toBe("Add all 4 to ideas");
    expect(addAllLabel(2)).toBe("Add all 2 to ideas");
  });

  it("the Ideas section", () => {
    expect(ideasHeading(0)).toBe("Ideas · 0");
    expect(IDEAS_EMPTY_COPY).toBe("No ideas yet. Your saves above are the fastest way to start.");
  });
});

describe("nearbyIdeaBody — Add copies the save into the trip's ideas", () => {
  it("is a valid POST /api/ideas body: shelf idea, category from the type, the place copied, source as notes", () => {
    const fort = nearbySaves(coast(), SAVES, [], 50).items[1]!;
    const body = nearbyIdeaBody("0b0b0b0b-0000-4000-8000-000000000001", fort);
    expect(body).toEqual({
      tripId: "0b0b0b0b-0000-4000-8000-000000000001",
      stopId: null,
      category: "stay",
      title: "Fort Stevens State Park",
      status: "idea",
      place: { name: "Fort Stevens State Park", lat: 46.2045, lng: -123.958, googlePlaceId: null },
      rating: null,
      notes: "Jane & Rick",
    });
    expect(ideaCreateInput.safeParse(body).success).toBe(true);
  });

  it("dining → eat, activity → do", () => {
    const base = nearbySaves(coast(), SAVES, [], 50).items[0]!;
    expect(nearbyIdeaBody("t", { ...base, type: "dining" }).category).toBe("eat");
    expect(nearbyIdeaBody("t", { ...base, type: "activity" }).category).toBe("do");
    expect(nearbyIdeaBody("t", { ...base, type: "other" }).category).toBe("do");
  });
});
