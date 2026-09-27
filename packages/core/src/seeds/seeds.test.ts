import { describe, it, expect } from "vitest";
import { segmentDateConflicts, reconcileSegments } from "../domain/segments";
import { savedPlace, trip as tripSchema } from "../domain/types";
import { savesShelves, shelfCounts } from "../capture/shelves";
import { DESTINATION_MAX_MILES, haversineMeters } from "../providers/index";
import { timelineModel } from "../planner/index";
import {
  SEED_OWNER,
  costaRicaTrip,
  greeceTrip,
  pnwTrip,
  seedDestinations,
  seedSaves,
  seedTrips,
} from "./index";

/**
 * The seeds every later pass is judged against (#110 §7). They are PURE data,
 * so this is where their invariants run — packages/db's seed.ts only writes
 * them (vet MED on #110: a DB-writing script has no test runner).
 */
describe("the seed trips", () => {
  it("parse as the domain grammar", () => {
    for (const t of seedTrips()) expect(() => tripSchema.parse(t)).not.toThrow();
  });

  it("carry ZERO segment/date conflicts (Q3 A: stop dates win)", () => {
    for (const t of seedTrips()) expect({ [t.title]: segmentDateConflicts(t) }).toEqual({ [t.title]: [] });
  });

  it("are already dense: reconciling them changes nothing", () => {
    for (const t of seedTrips()) {
      expect(reconcileSegments(t, () => "never")).toEqual(t.segments);
    }
  });

  it("PNW: 4 drive segments, untimed — home→Astoria · Astoria→Newport · Newport→Bend · Bend→Crater", () => {
    const t = pnwTrip();
    expect(t.segments.map((s) => [s.fromStopId, s.toStopId, s.mode, s.departAt])).toEqual([
      [null, "stp_astoria", "drive", null],
      ["stp_astoria", "stp_newport", "drive", null],
      ["stp_newport", "stp_bend", "drive", null],
      ["stp_bend", "stp_crater", "drive", null],
    ]);
    expect({ defaultMode: t.defaultMode, lodgingDefault: t.lodgingDefault, rigOn: t.rigOn }).toEqual({
      defaultMode: "drive",
      lodgingDefault: "campground",
      rigOn: true,
    });
  });

  it("Costa Rica: the two AA flights hang on seg_out, the stop keeps only the Westin", () => {
    const t = costaRicaTrip();
    const out = t.segments.find((s) => s.id === "seg_out")!;
    expect(out.reservations.map((r) => [r.name, r.stopId, r.segmentId])).toEqual([
      ["AA 2451 BOI→LAX", null, "seg_out"],
      ["AA 2208 LAX→LIR", null, "seg_out"],
    ]);
    const conchal = t.legs[0]!.stops[0]!;
    expect(conchal.reservations.map((r) => r.name)).toEqual(["Westin Reserva Conchal"]);
    expect(conchal.ideas.map((i) => i.title)).toEqual(["Playa Conchal snorkel", "Tamarindo surf lesson"]);
    expect(t.segments.map((s) => s.id)).toEqual(["seg_out", "seg_home"]);
    expect({ defaultMode: t.defaultMode, lodgingDefault: t.lodgingDefault, rigOn: t.rigOn }).toEqual({
      defaultMode: "fly",
      lodgingDefault: "hotel",
      rigOn: false,
    });
  });

  it("Greece: no home base — a fly, a ferry and a fly, one hotel per stop", () => {
    const t = greeceTrip();
    expect(t.homeBase).toBeNull();
    expect(t.legs.map((l) => l.title)).toEqual(["Athens", "Cyclades", "Back to Athens"]);
    expect(t.segments.map((s) => s.mode)).toEqual(["fly", "ferry", "fly"]);
    for (const l of t.legs) {
      for (const s of l.stops) expect(s.reservations.map((r) => r.type)).toEqual(["lodging"]);
    }
  });
});

describe("the seeds on the gantt (wireframe §1)", () => {
  it("PNW is today's timeline: Astoria cols 2–4, Newport 5–9, Bend 12–16, all arriving by drive", () => {
    const m = timelineModel(pnwTrip());
    const bars = m.legs.flatMap((l) => l.bars);
    expect(bars.map((b) => [b.name, b.startCol, b.span, b.arriveMode, b.resCount, b.ideaCount])).toEqual([
      ["Astoria, OR", 2, 3, "drive", 2, 0],
      ["Newport, OR", 5, 5, "drive", 1, 2],
      ["Bend, OR", 12, 5, "drive", 0, 1],
    ]);
    expect(m.gaps.map((g) => [g.startCol, g.span])).toEqual([
      [1, 1],
      [10, 2],
      [17, 12],
    ]);
    expect(m.rhythm[1]).toMatchObject({ kind: "travel", mode: "drive", title: "2026-08-02 — Drive → Astoria, OR" });
  });

  it("Costa Rica: Conchal's bar ends Jan 23 but reads its own dates, and arrives by air", () => {
    const m = timelineModel(costaRicaTrip());
    const [bar] = m.legs[0]!.bars;
    expect(bar).toMatchObject({
      name: "Westin Reserva Conchal",
      range: "Jan 16–24",
      startCol: 1,
      span: 8,
      arriveMode: "fly",
      resCount: 1,
      ideaCount: 2,
    });
    expect(m.openLabel).toBe("Every day planned");
    expect(m.rhythm[8]!.title).toBe("2027-01-24 — Fly → home");
    expect(m.rhythm[9]).toMatchObject({ kind: "travel", mode: "fly" });
  });

  it("Greece: the first Athens has no inbound segment, so no arrival edge", () => {
    const m = timelineModel(greeceTrip());
    const bars = m.legs.flatMap((l) => l.bars);
    expect(bars.map((b) => [b.name, b.range, b.startCol, b.span, b.arriveMode])).toEqual([
      ["Athens", "May 10–12", 1, 2, null],
      ["Mykonos", "May 12–16", 3, 4, "fly"],
      ["Naxos", "May 16–19", 7, 3, "ferry"],
      ["Athens", "May 19–20", 10, 2, "fly"],
    ]);
    expect(m.rhythm[6]!.title).toBe("2027-05-16 — Ferry → Naxos");
  });
});

// ── #111 i2 · the walk's Saves tab ─────────────────────────────────────────

describe("the seed saves (#111 i2)", () => {
  const dests = seedDestinations();
  const byKey = new Map(dests.map((d) => [d.key, d]));
  /** The seed as the read shape, the way GET /api/places will answer it. */
  const library = seedSaves().map((s, i) =>
    savedPlace.parse({
      id: `seed_${i}`,
      ownerId: SEED_OWNER,
      place: { name: s.name, lat: s.lat, lng: s.lng, googlePlaceId: null },
      region: s.region,
      type: s.type,
      status: s.status,
      source: s.source,
      rating: s.rating,
      lastChange: null,
      anchor: s.anchor,
      areaLabel: s.areaLabel,
      destination: s.destination ? { ...byKey.get(s.destination)!, id: s.destination } : null,
      suggestedPlace: s.suggestedPlace,
      createdAt: s.createdAt,
    }),
  );

  it("draws the wireframe's Want to go shelf: Oregon 8, Costa Rica 1, Unanchored 2", () => {
    const want = savesShelves(library, "want");
    expect(want.regions.map((r) => [r.region, r.count])).toEqual([
      ["Oregon", 8],
      ["Costa Rica", 1],
    ]);
    expect(want.regions[0]!.destinations.map((d) => [d.destination.name, d.saves.map((s) => s.place.name)])).toEqual([
      ["Bandon, OR", ["great BLM camp spot", "chandel"]],
      ["Bend, OR", ["taco truck Dana said", "Sunny's Smokehouse"]],
      ["Nehalem, OR", ["Nehalem Bay State Park"]],
      ["Newport, OR", ["Beverly Beach State Park"]],
      ["Tillamook, OR", ["Cape Lookout State Park"]],
      ["Warrenton, OR", ["Fort Stevens State Park"]],
    ]);
    expect(want.regions[1]!.destinations[0]!.saves.map((s) => [s.place.name, s.source])).toEqual([
      ["El Chandelier", "Marcy"],
    ]);
    expect(want.unanchored.map((s) => s.place.name)).toEqual(["pin in the Alvord Desert", "Kalaloch Campground"]);
    expect(shelfCounts(library)).toEqual({ want: 11, been: 4 });
  });

  it("carries Jane & Rick on the three coast campgrounds and Marcy on Cape Lookout", () => {
    const heard = Object.fromEntries(library.map((s) => [s.place.name, s.source]));
    expect(heard["Fort Stevens State Park"]).toBe("Jane & Rick");
    expect(heard["Nehalem Bay State Park"]).toBe("Jane & Rick");
    expect(heard["Beverly Beach State Park"]).toBe("Jane & Rick");
    expect(heard["Cape Lookout State Park"]).toBe("Marcy");
  });

  it("has South Beach on the Been there shelf, ★5, under Newport, OR · Oregon, visited on the coast trip", () => {
    const south = seedSaves().find((s) => s.name === "South Beach State Park")!;
    expect(south).toMatchObject({ status: "been", rating: 5, trip: "trip_coast", destination: "newport" });
    expect(byKey.get("newport")).toMatchObject({ name: "Newport, OR", region: "Oregon" });
    const been = savesShelves(library, "been");
    expect(been.regions[0]!.region).toBe("Oregon");
    expect(been.regions[0]!.destinations[0]!.saves.map((s) => s.place.name)).toContain("South Beach State Park");
  });

  it("hangs the one Q3 A suggestion on the offline 'chandel' note", () => {
    const withSuggestion = seedSaves().filter((s) => s.suggestedPlace);
    expect(withSuggestion.map((s) => [s.name, s.anchor, s.suggestedPlace!.name])).toEqual([
      ["chandel", "area", "El Chandelier"],
    ]);
  });

  it("files every anchored save within 25 mi of its destination, and names only real trips", () => {
    const tripIds = new Set(seedTrips().map((t) => t.id));
    for (const s of seedSaves()) {
      if (s.trip) expect(tripIds.has(s.trip)).toBe(true);
      if (!s.destination) continue;
      const d = byKey.get(s.destination);
      expect(d, s.name).toBeDefined();
      const mi = haversineMeters({ lat: s.lat!, lng: s.lng! }, d!) / 1609.344;
      expect(mi, s.name).toBeLessThanOrEqual(DESTINATION_MAX_MILES);
    }
  });

  it("keeps destination place ids unique — the (owner, google_place_id) unique", () => {
    expect(new Set(dests.map((d) => d.googlePlaceId)).size).toBe(dests.length);
  });
});
