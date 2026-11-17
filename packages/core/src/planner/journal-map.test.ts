import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Idea, Trip } from "../domain/types";
import { pnwTrip } from "../seeds/index";
import { journalMap } from "./journal-map";
import { setDestinationFields, setDestinationReservationFields, setIdeaFields } from "./journal";

/**
 * #179 · #181 i5 — the Journal map (docs/design/181 frames 4 and 5). The
 * Pacific Northwest Loop as the wireframe draws it after the trip: Fort George
 * (Eat, pinned) and the KOA under Astoria, the aquarium (Do, pinned) under
 * Newport, the Deschutes float (no place) under Bend.
 */

function withIdea(trip: Trip, destinationId: string, idea: Idea): Trip {
  return {
    ...trip,
    chapters: trip.chapters.map((c) => ({
      ...c,
      destinations: c.destinations.map((d) => (d.id === destinationId ? { ...d, ideas: [...d.ideas, idea] } : d)),
    })),
  };
}

function loggedLoop(): Trip {
  let t = pnwTrip();
  t = withIdea(t, "stp_astoria", {
    id: "idea_fortgeorge",
    tripId: "trip_pnw",
    destinationId: "stp_astoria",
    title: "Fort George Brewery",
    category: "eat",
    status: "done",
    place: { name: "Fort George Brewery", lat: 46.1871, lng: -123.8317, googlePlaceId: null },
    rating: 4,
    again: true,
    notes: null,
    sortOrder: 5,
    lastChange: null,
  });
  t = setIdeaFields(t, "idea_aquarium", {
    status: "done",
    rating: 4,
    place: { name: "Oregon Coast Aquarium", lat: 44.6175, lng: -124.0477, googlePlaceId: null },
  });
  // Logged, but with no place: it is listed and cannot be pinned.
  t = setIdeaFields(t, "idea_deschutes", { status: "done", rating: 5 });
  return t;
}

describe("journalMap (#179)", () => {
  it("Aug 29, after the trip: three been discs 1·2·3 joined Astoria → Newport → Bend", () => {
    const m = journalMap(loggedLoop(), "2026-08-29");
    const dests = m.points.filter((p) => p.kind === "destination");
    expect(dests.map((p) => [p.id, p.ordinal, p.been])).toEqual([
      ["stp_astoria", 1, true],
      ["stp_newport", 2, true],
      ["stp_bend", 3, true],
    ]);
    expect(m.join).toEqual([
      [-123.8313, 46.1879],
      [-124.053, 44.6365],
      [-121.3153, 44.0582],
    ]);
  });

  it("pins only the logged ideas that have coordinates, in their category", () => {
    const m = journalMap(loggedLoop(), "2026-08-29");
    const entries = m.points.filter((p) => p.kind === "entry");
    expect(entries.map((p) => [p.id, p.category, p.ordinal])).toEqual([
      ["idea_fortgeorge", "Eat", null],
      ["idea_aquarium", "Do", null],
    ]);
    // Cape Kiwanda has a place but was never logged; the Deschutes float was
    // logged but has no place — it is counted, not drawn.
    expect(entries.some((p) => p.id === "idea_kiwanda")).toBe(false);
    expect(m.unmapped).toBe(1);
  });

  it("Aug 7, mid-trip: Bend is not drawn yet and Newport is not been", () => {
    const m = journalMap(loggedLoop(), "2026-08-07");
    const dests = m.points.filter((p) => p.kind === "destination");
    expect(dests.map((p) => [p.id, p.been])).toEqual([
      ["stp_astoria", true],
      ["stp_newport", false],
    ]);
    expect(m.join).toEqual([
      [-123.8313, 46.1879],
      [-124.053, 44.6365],
    ]);
    // Bend's float is not listed yet, so it is not counted either.
    expect(m.unmapped).toBe(0);
  });

  it("with no date known, every listed destination is been", () => {
    const m = journalMap(loggedLoop(), null);
    expect(m.points.filter((p) => p.kind === "destination").every((p) => p.been)).toBe(true);
  });

  it("counts a listed destination with no coordinates in unmapped, and drops it from the join", () => {
    const t = setDestinationFields(loggedLoop(), "stp_bend", {
      place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
    });
    const m = journalMap(t, "2026-08-29");
    expect(m.points.some((p) => p.id === "stp_bend")).toBe(false);
    expect(m.join).toHaveLength(2);
    expect(m.unmapped).toBe(2); // Bend itself and its float
  });

  it("an empty journal has nothing to draw", () => {
    let t = setDestinationFields(pnwTrip(), "stp_astoria", { rating: null });
    t = setDestinationFields(t, "stp_newport", { rating: null });
    t = setDestinationReservationFields(t, "res_koa", { rating: null });
    t = setDestinationReservationFields(t, "res_southbeach", { rating: null });
    const m = journalMap(t, "2026-08-29");
    expect(m).toEqual({ points: [], join: [], unmapped: 0 });
  });
});

describe("journal-map.ts makes no request", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "journal-map.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("imports no routing module and calls no fetch or routeTrip", () => {
    expect(code).not.toMatch(/routeTrip|fetch\(|providers\/|routing/);
  });
});
