import { describe, expect, it } from "vitest";
import {
  beenWriteThrough,
  isJournalWorthy,
  saveTypeOfIdeaCategory,
  type BeenLibraryRow,
} from "./been-write-through";
import { ideaCategoryOfSaveType } from "../planner/nearby-saves";

/**
 * #113 · the Been write-through's DECISION (docs/design/113 "The data
 * contract"). packages/db's `writeThroughBeen` writes what this decides.
 */

const LIBRARY: BeenLibraryRow[] = [
  // The seeded Been save — coordinates of its own, no Google id.
  { id: "sv_southbeach", name: "South Beach State Park", lat: 44.6094, lng: -124.0631, googlePlaceId: null },
  { id: "sv_localocean", name: "Local Ocean Seafoods", lat: 44.6297, lng: -124.0526, googlePlaceId: null },
  // A want save with a place id.
  { id: "sv_chandelier", name: "El Chandelier", lat: 9.9325, lng: -84.0521, googlePlaceId: "ChIJ_chandelier" },
];

const snorkel = {
  kind: "idea" as const,
  title: "Playa Conchal snorkel",
  category: "do" as const,
  status: "done" as const,
  place: { name: "Playa Conchal", lat: 10.4012, lng: -85.8123, googlePlaceId: null },
  rating: 5,
  again: true,
};

describe("beenWriteThrough (#113)", () => {
  it("creates a Been save for a done idea with a place no save matches", () => {
    expect(beenWriteThrough(snorkel, LIBRARY)).toEqual({
      action: "create",
      candidate: { name: "Playa Conchal", lat: 10.4012, lng: -85.8123, googlePlaceId: null },
      type: "activity",
    });
  });

  it("updates the save the shipped isAlreadySaved rule matches (name + 150 m)", () => {
    const localOcean = {
      ...snorkel,
      title: "Local Ocean Seafoods",
      category: "eat" as const,
      place: { name: "Local Ocean Seafoods", lat: 44.6299, lng: -124.0534, googlePlaceId: null },
    };
    expect(beenWriteThrough(localOcean, LIBRARY)).toEqual({ action: "update", saveId: "sv_localocean" });
    // Same name 5 km away is a different place: create.
    const farAway = { ...localOcean, place: { ...localOcean.place, lat: 44.67 } };
    expect(beenWriteThrough(farAway, LIBRARY).action).toBe("create");
    // A matching Google id wins over everything else.
    const byId = {
      ...snorkel,
      place: { name: "Chandelier (typo)", lat: null, lng: null, googlePlaceId: "ChIJ_chandelier" },
    };
    expect(beenWriteThrough(byId, LIBRARY)).toEqual({ action: "update", saveId: "sv_chandelier" });
  });

  it("keeps a reservation coordless — name only, matched by name alone (rule 4)", () => {
    const southBeach = { kind: "reservation" as const, name: "South Beach State Park", type: "campground" as const, rating: 4, again: true };
    expect(beenWriteThrough(southBeach, LIBRARY)).toEqual({ action: "update", saveId: "sv_southbeach" });
    const westin = { kind: "reservation" as const, name: "Westin Reserva Conchal", type: "lodging" as const, rating: 4, again: true };
    expect(beenWriteThrough(westin, LIBRARY)).toEqual({
      action: "create",
      candidate: { name: "Westin Reserva Conchal", lat: null, lng: null, googlePlaceId: null },
      type: "lodging",
    });
  });

  it("skips a Travel-category reservation, however it was rated", () => {
    const flight = { kind: "reservation" as const, name: "AA 2451 BOI→LAX", type: "transport" as const, rating: 5, again: false };
    expect(beenWriteThrough(flight, LIBRARY)).toEqual({ action: "skip", reason: "travel" });
  });

  it("skips what isn't journal-worthy, and an idea or stop with no place", () => {
    expect(beenWriteThrough({ ...snorkel, status: "planned", rating: null, again: null }, LIBRARY)).toEqual({
      action: "skip",
      reason: "not-journal-worthy",
    });
    expect(beenWriteThrough({ ...snorkel, place: null }, LIBRARY)).toEqual({ action: "skip", reason: "no-place" });
    const coordlessStop = {
      kind: "stop" as const,
      place: { name: "Somewhere", lat: null, lng: null, googlePlaceId: null },
      rating: 4,
      again: null,
    };
    expect(beenWriteThrough(coordlessStop, LIBRARY)).toEqual({ action: "skip", reason: "no-place" });
  });

  it("files a rated stop as an 'other' save — a town is not a campground", () => {
    const newport = {
      kind: "stop" as const,
      place: { name: "Newport, OR", lat: 44.6365, lng: -124.053, googlePlaceId: null },
      rating: 4,
      again: null,
    };
    expect(beenWriteThrough(newport, LIBRARY)).toMatchObject({ action: "create", type: "other" });
  });

  it("is journal-worthy on done, a rating, or an again answer (false counts)", () => {
    expect(isJournalWorthy({ status: "done", rating: null, again: null })).toBe(true);
    expect(isJournalWorthy({ status: "idea", rating: 3, again: null })).toBe(true);
    expect(isJournalWorthy({ status: "idea", rating: null, again: false })).toBe(true);
    expect(isJournalWorthy({ status: "planned", rating: null, again: null })).toBe(false);
  });

  it("pins the idea kind ⇄ save type mapping both ways", () => {
    expect(saveTypeOfIdeaCategory("eat")).toBe("dining");
    expect(saveTypeOfIdeaCategory("stay")).toBe("lodging");
    expect(saveTypeOfIdeaCategory("do")).toBe("activity");
    expect(ideaCategoryOfSaveType("campground")).toBe("stay");
    expect(ideaCategoryOfSaveType("dining")).toBe("eat");
    expect(ideaCategoryOfSaveType("tour")).toBe("do");
    expect(ideaCategoryOfSaveType("other")).toBe("do");
  });
});
