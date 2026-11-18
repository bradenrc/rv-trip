import { describe, expect, it } from "vitest";
import { savedPlace, type SavedPlace, type SaveArea } from "../domain/types";
import type { PlaceSummary } from "../providers/index";
import {
  PLACES_CATEGORIES,
  isPlacesCategory,
  nearYou,
  nearYouName,
  nearYouNothing,
  nearYouWithin,
  placesCategoryEmpty,
  saveRowLine,
  savesShelves,
  shelfCounts,
  suggestedPlaceFromSearch,
  suggestionStrip,
} from "./shelves";

/**
 * The Saves tab's grouping (#111 i2 · docs/design/111 "The Saves tab"). The
 * fixture is the wireframe's Want to go list exactly: Oregon 8 (Bandon 2,
 * Bend 2, Nehalem 1, Newport 1, Tillamook 1, Warrenton 1), Costa Rica 1 and
 * Unanchored 2 — the sum of the rows drawn, 11.
 */
const dest = (name: string, region: string | null): SaveArea => ({
  id: `d_${name}`,
  name,
  region,
  googlePlaceId: `g_${name}`,
  lat: null,
  lng: null,
});
const BANDON = dest("Bandon, OR", "Oregon");
const BEND = dest("Bend, OR", "Oregon");
const NEHALEM = dest("Nehalem, OR", "Oregon");
const NEWPORT = dest("Newport, OR", "Oregon");
const TILLAMOOK = dest("Tillamook, OR", "Oregon");
const WARRENTON = dest("Warrenton, OR", "Oregon");
const SAN_JOSE = dest("San José, Costa Rica", "Costa Rica");

let n = 0;
function save(
  name: string,
  area: SaveArea | null,
  createdAt: string,
  extra: Partial<SavedPlace> = {},
): SavedPlace {
  n += 1;
  return savedPlace.parse({
    id: `s${n}`,
    ownerId: "dev-household",
    place: { name, lat: null, lng: null, googlePlaceId: null },
    type: "campground",
    rating: null,
    lastChange: null,
    again: null,
    area,
    createdAt,
    ...extra,
  });
}

// Deliberately shuffled — the function owns the order, not the input.
const WANT: SavedPlace[] = [
  save("Kalaloch Campground", null, "2026-06-01T00:00:00Z", { source: "Jane & Rick" }),
  save("Fort Stevens State Park", WARRENTON, "2026-06-02T00:00:00Z", { source: "Jane & Rick" }),
  save("El Chandelier", SAN_JOSE, "2026-09-20T00:00:00Z", { type: "dining", source: "Marcy" }),
  save("chandel", BANDON, "2026-09-25T17:12:00Z", { anchor: "area", type: "other", areaLabel: "Bandon, OR" }),
  save("Sunny's Smokehouse", BEND, "2026-05-01T00:00:00Z", { type: "dining", anchor: "place" }),
  save("Cape Lookout State Park", TILLAMOOK, "2026-06-03T00:00:00Z", { source: "Marcy" }),
  save("great BLM camp spot", BANDON, "2026-09-25T17:10:04Z", { anchor: "pin" }),
  save("pin in the Alvord Desert", null, "2026-09-01T00:00:00Z", { anchor: "pin", type: "other" }),
  save("taco truck Dana said", BEND, "2026-08-01T00:00:00Z", { anchor: "area", type: "other" }),
  save("Beverly Beach State Park", NEWPORT, "2026-06-04T00:00:00Z", { source: "Jane & Rick" }),
  save("Nehalem Bay State Park", NEHALEM, "2026-06-05T00:00:00Z", { source: "Jane & Rick" }),
];
const BEEN = save("South Beach State Park", NEWPORT, "2025-05-26T00:00:00Z", {
  status: "been",
  rating: 5,
});

describe("savesShelves — the wireframe's Want to go list", () => {
  const shelves = savesShelves([...WANT, BEEN], "want");

  it("orders regions by save count, most first: Oregon 8, then Costa Rica 1", () => {
    expect(shelves.regions.map((r) => [r.region, r.count])).toEqual([
      ["Oregon", 8],
      ["Costa Rica", 1],
    ]);
  });

  it("orders areas alphabetically inside a region, each with its saves", () => {
    const oregon = shelves.regions[0]!;
    expect(oregon.areas.map((d) => [d.area.name, d.saves.length])).toEqual([
      ["Bandon, OR", 2],
      ["Bend, OR", 2],
      ["Nehalem, OR", 1],
      ["Newport, OR", 1],
      ["Tillamook, OR", 1],
      ["Warrenton, OR", 1],
    ]);
    expect(shelves.regions[1]!.areas.map((d) => d.area.name)).toEqual([
      "San José, Costa Rica",
    ]);
  });

  it("orders saves newest first by createdAt inside an area", () => {
    const [bandon, bend] = shelves.regions[0]!.areas;
    expect(bandon!.saves.map((s) => s.place.name)).toEqual(["chandel", "great BLM camp spot"]);
    expect(bend!.saves.map((s) => s.place.name)).toEqual(["taco truck Dana said", "Sunny's Smokehouse"]);
  });

  it("puts saves with no area in Unanchored, newest first, apart from the regions", () => {
    expect(shelves.unanchored.map((s) => s.place.name)).toEqual([
      "pin in the Alvord Desert",
      "Kalaloch Campground",
    ]);
  });

  it("sums to the drawn 11 and leaves the Been there save out", () => {
    const total = shelves.regions.reduce((a, r) => a + r.count, 0) + shelves.unanchored.length;
    expect(total).toBe(11);
    expect(shelfCounts([...WANT, BEEN])).toEqual({ want: 11, been: 1 });
  });

  it("groups the Been there shelf the same way", () => {
    const been = savesShelves([...WANT, BEEN], "been");
    expect(been.regions.map((r) => [r.region, r.count])).toEqual([["Oregon", 1]]);
    expect(been.regions[0]!.areas[0]!.saves.map((s) => s.place.name)).toEqual([
      "South Beach State Park",
    ]);
    expect(been.unanchored).toEqual([]);
  });

  it("breaks a region-count tie by region name", () => {
    const tied = savesShelves(
      [
        save("a", dest("Walla Walla, WA", "Washington"), "2026-01-01T00:00:00Z"),
        save("b", dest("Boise, ID", "Idaho"), "2026-01-01T00:00:00Z"),
      ],
      "want",
    );
    expect(tied.regions.map((r) => r.region)).toEqual(["Idaho", "Washington"]);
  });

  it("keeps two areas of one name apart by id, and sorts a save with no createdAt last", () => {
    const shelves2 = savesShelves(
      [
        save("old", BANDON, null as unknown as string),
        save("new", BANDON, "2026-01-01T00:00:00Z"),
      ],
      "want",
    );
    expect(shelves2.regions[0]!.areas[0]!.saves.map((s) => s.place.name)).toEqual(["new", "old"]);
  });
});

describe("saveRowLine — the row's second line", () => {
  it("names the source first: 'Heard from Jane & Rick'", () => {
    expect(saveRowLine(WANT[1]!)).toBe("Heard from Jane & Rick");
  });

  it("draws a pin by its point: 'pin · 43.0500, −124.3300'", () => {
    const pin = save("great BLM camp spot", BANDON, "2026-09-25T17:10:04Z", {
      anchor: "pin",
      place: { name: "great BLM camp spot", lat: 43.05, lng: -124.33, googlePlaceId: null },
    });
    expect(saveRowLine(pin)).toBe("pin · 43.0500, −124.3300");
  });

  it("draws an area note by its town: 'note · Bandon area'", () => {
    expect(saveRowLine(WANT[3]!)).toBe("note · Bandon area");
    // No label of its own: the area's town.
    const bare = save("taco truck Dana said", BEND, "2026-08-01T00:00:00Z", { anchor: "area" });
    expect(saveRowLine(bare)).toBe("note · Bend area");
    expect(saveRowLine(save("x", null, "2026-01-01T00:00:00Z", { anchor: "area" }))).toBe("note");
  });

  it("draws a place by its kind and area: 'Restaurant · Bend, OR'", () => {
    expect(saveRowLine(WANT[4]!)).toBe("Restaurant · Bend, OR");
  });
});

describe("the offline upgrade suggestion (Q3 A)", () => {
  const hit = (over: Partial<PlaceSummary> = {}): PlaceSummary => ({
    googlePlaceId: "ChIJchandelier",
    name: "El Chandelier",
    location: { lat: 43.37, lng: -124.21 },
    rating: 4.6,
    address: "Coos Bay, OR",
    primaryTypeDisplayName: "Restaurant",
    ...over,
  });

  it("takes the TOP hit, with the subline the capture sheet draws", () => {
    expect(suggestedPlaceFromSearch([hit(), hit({ name: "Other" })])).toEqual({
      name: "El Chandelier",
      googlePlaceId: "ChIJchandelier",
      lat: 43.37,
      lng: -124.21,
      subline: "Restaurant · Coos Bay, OR",
    });
  });

  it("is null for no hits", () => {
    expect(suggestedPlaceFromSearch([])).toBeNull();
  });

  it("reads 'Did you mean El Chandelier?' over the subline", () => {
    expect(
      suggestionStrip({
        name: "El Chandelier",
        googlePlaceId: "g",
        lat: null,
        lng: null,
        subline: "Restaurant · Coos Bay, OR",
      }),
    ).toEqual({ title: "Did you mean El Chandelier?", sub: "Restaurant · Coos Bay, OR", dismiss: "Dismiss" });
  });
});

/**
 * #186 i1 · #182 Near you — docs/design/186 §1 "nearYou · from Boise". The
 * fixture is the wireframe's Boise library: Want to go 10 (Stay 2, Eat 3,
 * Do 5) and Been there 7 (Stay 2, Eat 3, Do 2). Coordinates are chosen so
 * each distance from (43.615, −116.202) lands on the §1 table's figure.
 */
describe("nearYou — the wireframe's Boise library (#182)", () => {
  const HERE = { lat: 43.615, lng: -116.202 };
  const area = (name: string, region: string | null, lat: number | null, lng: number | null): SaveArea => ({
    id: `a_${name}`,
    name,
    region,
    googlePlaceId: `g_${name}`,
    lat,
    lng,
  });
  const BOISE = area("Boise", "Idaho", 43.615, -116.2023);
  const IDAHO_CITY = area("Idaho City", "Idaho", 43.8285, -115.8345);
  const MOUNTAIN_HOME = area("Mountain Home", "Idaho", 43.1329, -115.6912);
  const MCCALL = area("McCall", "Idaho", 44.9113, -116.0987);
  const BEND_OR = area("Bend", "Oregon", 44.0582, -121.3153);
  const CRATER = area("Crater Lake NP", "Oregon", 42.9446, -122.109);
  const NEWPORT_OR = area("Newport", "Oregon", 44.6368, -124.0535);
  const ASTORIA = area("Astoria", "Oregon", 46.1879, -123.8313);
  const TRUCKEE = area("Truckee", "California", 39.328, -120.1833);
  const VEGAS = area("Las Vegas", "Nevada", 36.1716, -115.1391);
  const BELLINGHAM = area("Bellingham", "Washington", 48.7519, -122.4787);

  let k = 0;
  function at(
    name: string,
    a: SaveArea | null,
    own: { lat: number; lng: number } | null,
    extra: Partial<SavedPlace> = {},
  ): SavedPlace {
    k += 1;
    return savedPlace.parse({
      id: `b${k}`,
      ownerId: "dev-household",
      place: { name, lat: own?.lat ?? null, lng: own?.lng ?? null, googlePlaceId: null },
      type: "activity",
      rating: null,
      lastChange: null,
      again: null,
      area: a,
      anchor: own ? "place" : "area",
      createdAt: `2026-10-${String(k).padStart(2, "0")}T00:00:00Z`,
      ...extra,
    });
  }

  const LIBRARY: SavedPlace[] = [
    // Want to go — 10
    at("Ponderosa State Park", MCCALL, { lat: 44.9278, lng: -116.0838 }, { type: "campground" }),
    at("Table Rock sunrise hike", BOISE, { lat: 43.6031, lng: -116.1631 }),
    at("that taco truck", null, null, { type: "dining" }),
    at("Bogus Basin", BOISE, { lat: 43.764, lng: -116.1029 }, { source: "Jane & Rick" }),
    at("The Springs, Idaho City", IDAHO_CITY, null, { areaLabel: "Idaho City, ID" }),
    at("Deschutes River float", BEND_OR, null),
    at("Rim Drive scenic loop", CRATER, null),
    at("Rogue Ales brewery lunch", NEWPORT_OR, null, { type: "dining" }),
    at("Village Camp Truckee", TRUCKEE, null, { type: "campground" }),
    at("The Chandelier, Cosmopolitan", VEGAS, null, { type: "dining", source: "a friend" }),
    // Been there — 7
    at("Mountain Home KOA", MOUNTAIN_HOME, { lat: 43.133, lng: -115.688 }, { type: "campground", status: "been", rating: 3 }),
    at("Barbacoa", BOISE, { lat: 43.6011, lng: -116.1797 }, { type: "dining", status: "been", rating: 4 }),
    at("Astoria/Warrenton KOA", ASTORIA, null, { type: "campground", status: "been", rating: 5 }),
    at("Fort George Brewery", ASTORIA, null, { type: "dining", status: "been", rating: 4 }),
    at("Oregon Coast Aquarium", NEWPORT_OR, null, { status: "been", rating: 4 }),
    at("Aslan Brewing Co.", BELLINGHAM, null, { type: "dining", status: "been", rating: 4 }),
    at("Chuckanut Drive", BELLINGHAM, null, { status: "been", rating: 5 }),
  ];
  const restNames = (r: ReturnType<typeof nearYou>["rest"]) => [
    ...r.regions.flatMap((g) => g.areas.flatMap((a) => a.saves.map((s) => s.place.name))),
    ...r.unanchored.map((s) => s.place.name),
  ];

  it("names the four chips in the frame's order", () => {
    expect(PLACES_CATEGORIES).toEqual(["All", "Stay", "Eat", "Do"]);
  });

  it("Want/All from Boise: Table Rock, Bogus Basin, then The Springs measured from its Idaho City area", () => {
    const r = nearYou(LIBRARY, "want", HERE, "All");
    expect(r.near.map((n) => n.save.place.name)).toEqual([
      "Table Rock sunrise hike",
      "Bogus Basin",
      "The Springs, Idaho City",
    ]);
    const [table, bogus, springs] = r.near;
    expect(table!.mi).toBeCloseTo(2.1, 1);
    expect(bogus!.mi).toBeCloseTo(11.4, 1);
    expect(springs!.mi).toBeCloseTo(23.5, 1);
    expect(springs!.save.place.lat).toBeNull(); // no pin of its own: the area's point measured it
    expect(r.total).toBe(10);
  });

  it("Want/All: Ponderosa (≈90.9 mi) is in the rest under Idaho ▸ McCall; the taco truck is unanchored", () => {
    const r = nearYou(LIBRARY, "want", HERE, "All");
    const idaho = r.rest.regions.find((g) => g.region === "Idaho")!;
    expect(idaho.areas.map((a) => [a.area.name, a.saves.map((s) => s.place.name)])).toEqual([
      ["McCall", ["Ponderosa State Park"]],
    ]);
    expect(r.rest.unanchored.map((s) => s.place.name)).toEqual(["that taco truck"]);
    expect(restNames(r.rest)).toHaveLength(7);
    for (const n of r.near) expect(restNames(r.rest)).not.toContain(n.save.place.name);
  });

  it("Been/All from Boise: Barbacoa (≈1.5 mi) then Mountain Home KOA (≈42.1 mi)", () => {
    const r = nearYou(LIBRARY, "been", HERE, "All");
    expect(r.near.map((n) => [n.save.place.name, Math.round(n.mi * 10) / 10])).toEqual([
      ["Barbacoa", 1.5],
      ["Mountain Home KOA", 42.1],
    ]);
    expect(r.total).toBe(7);
    expect(restNames(r.rest)).toHaveLength(5);
  });

  it("cat Stay drops every non-Stay save from both near and rest", () => {
    const want = nearYou(LIBRARY, "want", HERE, "Stay");
    expect(want.near).toEqual([]);
    expect(restNames(want.rest).sort()).toEqual(["Ponderosa State Park", "Village Camp Truckee"]);
    expect(want.total).toBe(2);

    const been = nearYou(LIBRARY, "been", HERE, "Stay");
    expect(been.near.map((n) => n.save.place.name)).toEqual(["Mountain Home KOA"]);
    expect(restNames(been.rest)).toEqual(["Astoria/Warrenton KOA"]);
    expect(been.total).toBe(2);
  });

  it("counts match the chips: Want Stay 2 · Eat 3 · Do 5, Been Stay 2 · Eat 3 · Do 2", () => {
    const totals = (status: "want" | "been") =>
      PLACES_CATEGORIES.map((c) => nearYou(LIBRARY, status, null, c).total);
    expect(totals("want")).toEqual([10, 2, 3, 5]);
    expect(totals("been")).toEqual([7, 2, 3, 2]);
  });

  it("Travel and Other saves show under All only", () => {
    const extra = [
      ...LIBRARY,
      at("Bonneville ferry", BOISE, { lat: 43.62, lng: -116.2 }, { type: "transport" }),
      at("a spot Dana mentioned", BOISE, null, { type: "other" }),
    ];
    const all = nearYou(extra, "want", HERE, "All");
    expect(all.near.map((n) => n.save.place.name)).toEqual(
      expect.arrayContaining(["Bonneville ferry", "a spot Dana mentioned"]),
    );
    expect(all.total).toBe(12);
    for (const c of ["Stay", "Eat", "Do"] as const) {
      const r = nearYou(extra, "want", HERE, c);
      const names = [...r.near.map((n) => n.save.place.name), ...restNames(r.rest)];
      expect(names).not.toContain("Bonneville ferry");
      expect(names).not.toContain("a spot Dana mentioned");
    }
  });

  it("here null: no Near you — rest is exactly savesShelves of the filtered list", () => {
    for (const status of ["want", "been"] as const) {
      const r = nearYou(LIBRARY, status, null, "All");
      expect(r.near).toEqual([]);
      expect(r.rest).toEqual(savesShelves(LIBRARY, status));
    }
    const stay = nearYou(LIBRARY, "want", null, "Stay");
    expect(stay.rest).toEqual(
      savesShelves(
        LIBRARY.filter((s) => s.type === "campground" || s.type === "lodging"),
        "want",
      ),
    );
  });

  // #186 i2 — the copy and the chip name both clients read.
  it("names the location chip by the nearest near save's area (Boise on both shelves)", () => {
    expect(nearYouName(nearYou(LIBRARY, "want", HERE, "All").near, "Garden City")).toBe("Boise");
    expect(nearYouName(nearYou(LIBRARY, "been", HERE, "All").near, null)).toBe("Boise");
  });

  it("falls back to the resolved locality, then to null (the chip reads \"Near you\")", () => {
    const far = { lat: 47.6, lng: -122.3 };
    expect(nearYou(LIBRARY, "want", far, "All").near).toEqual([]);
    expect(nearYouName([], "Seattle")).toBe("Seattle");
    expect(nearYouName([], null)).toBeNull();
    // A near save with no area is skipped for the name, not taken as "no name".
    const truck = at("cart by the river", null, { lat: 43.616, lng: -116.2 }, { type: "dining" });
    const near = nearYou([truck, ...LIBRARY], "want", HERE, "All").near;
    expect(near[0]!.save.place.name).toBe("cart by the river");
    expect(nearYouName(near, "Garden City")).toBe("Boise");
  });

  it("writes the two dashed lines the wireframe draws", () => {
    expect(placesCategoryEmpty("Eat", "want")).toBe("No eat places on Want to go yet.");
    expect(placesCategoryEmpty("Stay", "been")).toBe("No stay places on Been there yet.");
    expect(nearYouNothing("Boise")).toBe("Nothing on this shelf within 50 mi of Boise.");
    expect(nearYouNothing(null)).toBe("Nothing on this shelf within 50 mi.");
    expect(nearYouWithin(null)).toBe("within 50 mi");
    expect(nearYouWithin("Boise")).toBe("within 50 mi of Boise");
  });

  it("narrows a stored chip value to the four the build draws", () => {
    for (const c of PLACES_CATEGORIES) expect(isPlacesCategory(c)).toBe(true);
    expect(isPlacesCategory("Travel")).toBe(false);
    expect(isPlacesCategory(null)).toBe(false);
    expect(isPlacesCategory("stay")).toBe(false);
  });
});
