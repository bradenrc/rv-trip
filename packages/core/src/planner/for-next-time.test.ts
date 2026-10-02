import { describe, expect, it } from "vitest";
import type { SavedPlace } from "../domain/types";
import { forNextTimeResponse } from "../domain/types";
import { pnwTrip, seedAreas, seedSaves, seedTrips } from "../seeds/index";
import {
  forNextTime,
  markRowOnShelf,
  nextTimeDatesLine,
  nextTimeGroup,
  nextTimeIdeaBody,
  nextTimeKicker,
  nextTimeRowAction,
} from "./for-next-time";
import { nearbySaves } from "./nearby-saves";

/**
 * #113 · #107 "Last time here" (docs/design/113 Screen 4). The seed as the
 * walk renders it: the Pacific Northwest Loop reaches Newport Aug 5–9, and the
 * Oregon Coast Weekend (complete, ★5) left two Been saves anchored to the
 * Newport area — both `again: true` in the seed.
 */

/** The seed's saves as the library read returns them: ids, areas
 * joined, the been trip named by its seed id. */
function seededLibrary(): SavedPlace[] {
  const dests = new Map(seedAreas().map((d) => [d.key, d]));
  return seedSaves().map((s, i) => {
    const d = s.area ? dests.get(s.area)! : null;
    return {
      id: `sv_${i}_${s.name.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      ownerId: "dev-household",
      place: { name: s.name, lat: s.lat, lng: s.lng, googlePlaceId: null },
      region: s.region,
      type: s.type,
      status: s.status,
      note: s.note,
      source: s.source,
      rating: s.rating,
      again: s.again,
      tripId: s.trip,
      tripName: null,
      lastChange: null,
      anchor: s.anchor,
      areaLabel: s.areaLabel,
      area: d
        ? { id: `dst_${d.key}`, name: d.name, region: d.region, googlePlaceId: d.googlePlaceId, lat: d.lat, lng: d.lng }
        : null,
      suggestedPlace: s.suggestedPlace,
      createdAt: s.createdAt,
    };
  });
}

const idOf = (lib: SavedPlace[], name: string) => lib.find((s) => s.place.name === name)!.id;

describe("forNextTime (#113 · #107)", () => {
  it("draws one Newport card from the Oregon Coast Weekend", () => {
    const lib = seededLibrary();
    const nt = forNextTime(pnwTrip(), seedTrips(), lib);
    expect(nt.cards).toHaveLength(1);
    const card = nt.cards[0]!;
    expect(card.area).toEqual({ id: "dst_newport", name: "Newport, OR" });
    expect(card.destination).toEqual({
      id: "stp_newport",
      name: "Newport, OR",
      arriveDate: "2026-08-05",
      departDate: "2026-08-09",
    });
    expect(card.pastTrip).toMatchObject({ id: "trip_coast", title: "Oregon Coast Weekend", rating: 5 });
    expect(card.once).toEqual([]);
    expect(nextTimeKicker(card)).toBe("For next time · Newport, OR");
    expect(nextTimeDatesLine(card)).toBe("May 23–26, 2025 · you’re back Aug 5–9");
  });

  it("marks South Beach as booked on this trip and Local Ocean as on the shelf", () => {
    const lib = seededLibrary();
    const [card] = forNextTime(pnwTrip(), seedTrips(), lib).cards;
    expect(card!.again.map((r) => [r.name, r.again, r.onThisTrip])).toEqual([
      ["South Beach State Park", true, "reservation"],
      ["Local Ocean Seafoods", true, "idea"],
    ]);
    expect(nextTimeRowAction(card!.again[0]!, "again")).toBe("Booked ✓");
    expect(nextTimeRowAction(card!.again[1]!, "again")).toBe("On shelf ✓");
  });

  it("returns the card's save ids, and nearbySaves leaves them out", () => {
    const lib = seededLibrary();
    const trip = pnwTrip();
    const nt = forNextTime(trip, seedTrips(), lib);
    const southBeach = idOf(lib, "South Beach State Park");
    const localOcean = idOf(lib, "Local Ocean Seafoods");
    expect(nt.saveIds).toEqual([southBeach, localOcean]);
    // Local Ocean is already an idea, so nearby drops it on its own; South
    // Beach is only left out BECAUSE the card has it.
    const before = nearbySaves(trip, lib, [], null).items.map((i) => i.saveId);
    expect(before).toContain(southBeach);
    const after = nearbySaves(trip, lib, [], null, nt.saveIds).items.map((i) => i.saveId);
    expect(after).not.toContain(southBeach);
    expect(after).not.toContain(localOcean);
    expect(after.length).toBe(before.length - 1);
  });

  it("puts a been save with again not said and ★5 in the Again group, without a badge", () => {
    const lib = seededLibrary();
    const whale: SavedPlace = {
      ...lib.find((s) => s.place.name === "Local Ocean Seafoods")!,
      id: "sv_whale",
      place: { name: "Bayfront whale-watch charter", lat: 44.6263, lng: -124.0561, googlePlaceId: null },
      type: "tour",
      rating: 5,
      again: null,
      note: null,
    };
    const rough: SavedPlace = { ...whale, id: "sv_rough", place: { ...whale.place, name: "Jetty fishing" }, rating: 2, again: false };
    const meh: SavedPlace = { ...whale, id: "sv_meh", place: { ...whale.place, name: "Gift shop" }, rating: 3, again: null };
    const [card] = forNextTime(pnwTrip(), seedTrips(), [...lib, whale, rough, meh]).cards;
    expect(card!.again.map((r) => r.saveId)).toContain("sv_whale");
    expect(card!.again.find((r) => r.saveId === "sv_whale")!.again).toBeNull();
    expect(card!.once.map((r) => r.saveId)).toEqual(["sv_rough"]);
    // ★3 and not said: stays out.
    expect([...card!.again, ...card!.once].map((r) => r.saveId)).not.toContain("sv_meh");
    expect(nextTimeRowAction(card!.again.find((r) => r.saveId === "sv_whale")!, "again")).toBe("Add");
    expect(nextTimeRowAction(card!.once[0]!, "once")).toBeNull();
  });

  it("groups by the rule: again true · not said ★≥4 · false", () => {
    expect(nextTimeGroup({ again: true, rating: null })).toBe("again");
    expect(nextTimeGroup({ again: null, rating: 4 })).toBe("again");
    expect(nextTimeGroup({ again: null, rating: 3 })).toBeNull();
    expect(nextTimeGroup({ again: false, rating: 5 })).toBe("once");
  });

  it("draws nothing for the trip itself, an unfinished past trip, or a trip that goes nowhere near", () => {
    const lib = seededLibrary();
    const coastOpen = seedTrips().map((t) => (t.id === "trip_coast" ? { ...t, status: "upcoming" as const } : t));
    expect(forNextTime(pnwTrip(), coastOpen, lib).cards).toEqual([]);
    const cr = seedTrips().find((t) => t.id === "trip_cr")!;
    expect(forNextTime(cr, seedTrips(), lib)).toEqual({ cards: [], saveIds: [] });
  });

  it("parses as the wire shape, and Add copies the row into a shelf idea", () => {
    const lib = seededLibrary();
    const nt = forNextTime(pnwTrip(), seedTrips(), lib);
    expect(forNextTimeResponse.parse(nt)).toEqual(nt);
    const row = nt.cards[0]!.again[1]!;
    expect(nextTimeIdeaBody("trip_pnw", row)).toMatchObject({
      tripId: "trip_pnw",
      destinationId: null,
      category: "eat",
      title: "Local Ocean Seafoods",
      status: "idea",
      place: row.place,
    });
    const marked = markRowOnShelf({ ...nt, cards: [{ ...nt.cards[0]!, again: [{ ...row, onThisTrip: null }] }] }, row.saveId);
    expect(marked.cards[0]!.again[0]!.onThisTrip).toBe("idea");
  });
});
