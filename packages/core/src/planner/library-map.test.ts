import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { savedPlace, type SavedPlace, type SaveArea, type Trip } from "../domain/types";
import { pnwTrip } from "../seeds/index";
import { destinationBeen, libraryFilterKeeps, libraryMap, libraryTrips, type LibraryFilter } from "./library-map";

/**
 * #184 · #186 i5 — the wireframe's §1 #184 table, row for row. The Pacific
 * Northwest Loop (Aug 1–28) is drawn with its three dated destinations (Astoria
 * departs Aug 5, Newport Aug 9, Bend Aug 16); Bellingham (Nov 11–15) has one.
 * On Tue Nov 17 both read `complete`; on Fri Aug 7 the Loop is in progress.
 */

const NOV_17 = "2026-11-17";
const AUG_7 = "2026-08-07";

function loop(status: Trip["status"]): Trip {
  const base = pnwTrip();
  return {
    ...base,
    status,
    statusAuto: false,
    chapters: base.chapters.map((c) => ({
      ...c,
      destinations: c.destinations.filter((d) => d.id !== "stp_crater"),
    })),
  };
}

function bellingham(status: Trip["status"]): Trip {
  const base = pnwTrip();
  const template = base.chapters[0]!.destinations[0]!;
  return {
    ...base,
    id: "trip_bham",
    title: "Bellingham",
    startDate: "2026-11-11",
    endDate: "2026-11-15",
    status,
    statusAuto: false,
    ideas: [],
    segments: [],
    chapters: [
      {
        ...base.chapters[0]!,
        id: "chapter_bham",
        tripId: "trip_bham",
        destinations: [
          {
            ...template,
            id: "stp_bham",
            chapterId: "chapter_bham",
            place: { name: "Bellingham, WA", lat: 48.7519, lng: -122.4787, googlePlaceId: null },
            arriveDate: "2026-11-11",
            departDate: "2026-11-15",
            ideas: [],
            reservations: [],
          },
        ],
      },
    ],
  };
}

const BEND: SaveArea = {
  id: "d_bend",
  name: "Bend, OR",
  region: "Oregon",
  googlePlaceId: "g_bend",
  lat: 44.0582,
  lng: -121.3153,
};

function save(id: string, name: string, extra: Partial<SavedPlace>): SavedPlace {
  return savedPlace.parse({
    id,
    ownerId: "dev-household",
    place: { name, lat: null, lng: null, googlePlaceId: null },
    type: "campground",
    rating: null,
    lastChange: null,
    again: null,
    ...extra,
  });
}

const at = (name: string, lat: number, lng: number) => ({ name, lat, lng, googlePlaceId: null });

const KOA = save("s_koa", "Astoria/Warrenton KOA", {
  place: at("Astoria/Warrenton KOA", 46.1564, -123.8865),
  status: "been",
  rating: 5,
  tripId: "trip_pnw",
  tripName: "Pacific Northwest Loop",
});
const FORT_GEORGE = save("s_fortgeorge", "Fort George Brewery", {
  place: at("Fort George Brewery", 46.1886, -123.8306),
  type: "dining",
  status: "been",
  rating: 4,
  tripId: "trip_pnw",
});
const AQUARIUM = save("s_aquarium", "Oregon Coast Aquarium", {
  place: at("Oregon Coast Aquarium", 44.6175, -124.0474),
  type: "tour",
  status: "been",
  rating: 4,
  tripId: "trip_pnw",
});
const ASLAN = save("s_aslan", "Aslan Brewing Co.", {
  place: at("Aslan Brewing Co.", 48.7508, -122.4782),
  type: "dining",
  status: "been",
  rating: 4,
  tripId: "trip_bham",
});
/** Want, no trip, and no point of its own: pinned at its Bend area (savePoint). */
const DESCHUTES = save("s_deschutes", "Deschutes River float", { type: "tour", status: "want", anchor: "area", area: BEND });
/** No point at all — never a pin, counted in unmapped. */
const TACO = save("s_taco", "that taco truck", { type: "dining", status: "want" });

const SAVES = [KOA, FORT_GEORGE, AQUARIUM, ASLAN, DESCHUTES, TACO];
const ALL: LibraryFilter = { kind: "all" };
const BEEN: LibraryFilter = { kind: "been" };
const WANT: LibraryFilter = { kind: "want" };
const ONE_LOOP: LibraryFilter = { kind: "trip", tripId: "trip_pnw" };

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("destinationBeen — a trip's stops are been once complete, or once departed (q7 A)", () => {
  it("Tue Nov 17: every Loop and Bellingham destination is been (both trips complete)", () => {
    const m = libraryMap([loop("complete"), bellingham("complete")], [], NOV_17, ALL);
    expect(m.destinations.map((d) => [d.name, d.been])).toEqual([
      ["Astoria, OR", true],
      ["Newport, OR", true],
      ["Bend, OR", true],
      ["Bellingham, WA", true],
    ]);
  });

  it("Fri Aug 7: Astoria (departs Aug 5) is been, Newport (departs Aug 9) is not", () => {
    const t = loop("upcoming");
    const [astoria, newport] = t.chapters[0]!.destinations;
    expect(destinationBeen(t, astoria!, AUG_7)).toBe(true);
    expect(destinationBeen(t, newport!, AUG_7)).toBe(false);
  });

  it("a complete trip is been even with no departDate or no today; otherwise no today is never been", () => {
    expect(destinationBeen({ status: "complete" }, { departDate: null }, null)).toBe(true);
    expect(destinationBeen({ status: "upcoming" }, { departDate: "2026-08-05" }, null)).toBe(false);
    expect(destinationBeen({ status: "planning" }, { departDate: null }, AUG_7)).toBe(false);
    // departing today is not yet behind you
    expect(destinationBeen({ status: "upcoming" }, { departDate: AUG_7 }, AUG_7)).toBe(false);
  });
});

describe("libraryFilterKeeps — the four filters", () => {
  it("all keeps everything; been / want split on been; trip matches tripId", () => {
    const been = { been: true, tripId: "trip_pnw" };
    const want = { been: false, tripId: null };
    expect([libraryFilterKeeps(ALL, been), libraryFilterKeeps(ALL, want)]).toEqual([true, true]);
    expect([libraryFilterKeeps(BEEN, been), libraryFilterKeeps(BEEN, want)]).toEqual([true, false]);
    expect([libraryFilterKeeps(WANT, been), libraryFilterKeeps(WANT, want)]).toEqual([false, true]);
    expect([libraryFilterKeeps(ONE_LOOP, been), libraryFilterKeeps(ONE_LOOP, want)]).toEqual([true, false]);
  });
});

describe("libraryMap — the §1 #184 table on Tue Nov 17", () => {
  const trips = [loop("complete"), bellingham("complete")];

  it("All: every mapped destination and every save with a point; the taco truck is unmapped", () => {
    const m = libraryMap(trips, SAVES, NOV_17, ALL);
    expect(ids(m.destinations)).toEqual(["stp_astoria", "stp_newport", "stp_bend", "stp_bham"]);
    expect(ids(m.saves)).toEqual(["s_koa", "s_fortgeorge", "s_aquarium", "s_aslan", "s_deschutes"]);
    expect(m.unmapped).toBe(1);
  });

  it("destinations carry their trip, point and scheduled ordinal", () => {
    const m = libraryMap(trips, [], NOV_17, ALL);
    expect(m.destinations[0]).toEqual({
      id: "stp_astoria",
      tripId: "trip_pnw",
      name: "Astoria, OR",
      lat: 46.1879,
      lng: -123.8313,
      ordinal: 1,
      been: true,
    });
    expect(m.destinations.map((d) => d.ordinal)).toEqual([1, 2, 3, 1]);
  });

  it("saves carry the core category, been and tripId; an area save is pinned at its area (savePoint)", () => {
    const m = libraryMap(trips, SAVES, NOV_17, ALL);
    expect(m.saves.find((s) => s.id === "s_koa")).toEqual({
      id: "s_koa",
      name: "Astoria/Warrenton KOA",
      lat: 46.1564,
      lng: -123.8865,
      category: "Stay",
      been: true,
      tripId: "trip_pnw",
    });
    expect(m.saves.find((s) => s.id === "s_deschutes")).toEqual({
      id: "s_deschutes",
      name: "Deschutes River float",
      lat: 44.0582,
      lng: -121.3153,
      category: "Do",
      been: false,
      tripId: null,
    });
    expect(m.saves.find((s) => s.id === "s_fortgeorge")?.category).toBe("Eat");
  });

  it("Been there keeps the KOA save and drops the Deschutes save", () => {
    const m = libraryMap(trips, SAVES, NOV_17, BEEN);
    expect(ids(m.saves)).toContain("s_koa");
    expect(ids(m.saves)).not.toContain("s_deschutes");
    expect(ids(m.destinations)).toEqual(["stp_astoria", "stp_newport", "stp_bend", "stp_bham"]);
    expect(m.unmapped).toBe(0);
  });

  it("Want to go does the reverse — and no destination is left on a complete trip", () => {
    const m = libraryMap(trips, SAVES, NOV_17, WANT);
    expect(ids(m.saves)).toEqual(["s_deschutes"]);
    expect(m.destinations).toEqual([]);
    expect(m.unmapped).toBe(1);
  });

  it("One trip · the Loop keeps its three destinations and its three visited saves only", () => {
    const m = libraryMap(trips, SAVES, NOV_17, ONE_LOOP);
    expect(ids(m.destinations)).toEqual(["stp_astoria", "stp_newport", "stp_bend"]);
    expect(ids(m.saves)).toEqual(["s_koa", "s_fortgeorge", "s_aquarium"]);
    expect(m.unmapped).toBe(0);
  });
});

describe("libraryMap — Fri Aug 7, the Loop in progress", () => {
  it("Astoria lands under Been there, Newport under Want to go", () => {
    const trips = [loop("upcoming")];
    expect(ids(libraryMap(trips, [], AUG_7, BEEN).destinations)).toEqual(["stp_astoria"]);
    expect(ids(libraryMap(trips, [], AUG_7, WANT).destinations)).toEqual(["stp_newport", "stp_bend"]);
  });
});

describe("libraryMap — a save with no point is never a pin", () => {
  it("counts in unmapped only", () => {
    const m = libraryMap([], [TACO], NOV_17, ALL);
    expect(m.saves).toEqual([]);
    expect(m.unmapped).toBe(1);
  });
});

describe("libraryTrips — the One trip chooser", () => {
  it("lists Bellingham before the Loop, with dates and mapped-destination counts", () => {
    expect(libraryTrips([loop("complete"), bellingham("complete")])).toEqual([
      { id: "trip_bham", title: "Bellingham", dates: "11/11 – 11/15", destinations: 1 },
      { id: "trip_pnw", title: "Pacific Northwest Loop", dates: "08/01 – 08/28", destinations: 3 },
    ]);
  });

  it("leaves out a trip with no mapped destination", () => {
    const b = bellingham("complete");
    const unmapped: Trip = {
      ...b,
      chapters: b.chapters.map((c) => ({
        ...c,
        destinations: c.destinations.map((d) => ({ ...d, place: { ...d.place, lat: null, lng: null } })),
      })),
    };
    expect(ids(libraryTrips([loop("complete"), unmapped]))).toEqual(["trip_pnw"]);
  });
});

describe("library-map.ts makes no request", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "library-map.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("imports no routing module and calls no fetch or routeTrip", () => {
    expect(code).not.toMatch(/routeTrip|fetch\(|providers\/|routing|api-client/);
  });
});
