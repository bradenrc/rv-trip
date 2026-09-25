import { describe, expect, it } from "vitest";
import { savedPlace, type SavedPlace, type SaveDestination } from "../domain/types";
import type { PlaceSummary } from "../providers/index";
import {
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
const dest = (name: string, region: string | null): SaveDestination => ({
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
  destination: SaveDestination | null,
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
    destination,
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

  it("orders destinations alphabetically inside a region, each with its saves", () => {
    const oregon = shelves.regions[0]!;
    expect(oregon.destinations.map((d) => [d.destination.name, d.saves.length])).toEqual([
      ["Bandon, OR", 2],
      ["Bend, OR", 2],
      ["Nehalem, OR", 1],
      ["Newport, OR", 1],
      ["Tillamook, OR", 1],
      ["Warrenton, OR", 1],
    ]);
    expect(shelves.regions[1]!.destinations.map((d) => d.destination.name)).toEqual([
      "San José, Costa Rica",
    ]);
  });

  it("orders saves newest first by createdAt inside a destination", () => {
    const [bandon, bend] = shelves.regions[0]!.destinations;
    expect(bandon!.saves.map((s) => s.place.name)).toEqual(["chandel", "great BLM camp spot"]);
    expect(bend!.saves.map((s) => s.place.name)).toEqual(["taco truck Dana said", "Sunny's Smokehouse"]);
  });

  it("puts saves with no destination in Unanchored, newest first, apart from the regions", () => {
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
    expect(been.regions[0]!.destinations[0]!.saves.map((s) => s.place.name)).toEqual([
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

  it("keeps two destinations of one name apart by id, and sorts a save with no createdAt last", () => {
    const shelves2 = savesShelves(
      [
        save("old", BANDON, null as unknown as string),
        save("new", BANDON, "2026-01-01T00:00:00Z"),
      ],
      "want",
    );
    expect(shelves2.regions[0]!.destinations[0]!.saves.map((s) => s.place.name)).toEqual(["new", "old"]);
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
    // No label of its own: the destination's town.
    const bare = save("taco truck Dana said", BEND, "2026-08-01T00:00:00Z", { anchor: "area" });
    expect(saveRowLine(bare)).toBe("note · Bend area");
    expect(saveRowLine(save("x", null, "2026-01-01T00:00:00Z", { anchor: "area" }))).toBe("note");
  });

  it("draws a place by its kind and destination: 'Restaurant · Bend, OR'", () => {
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
