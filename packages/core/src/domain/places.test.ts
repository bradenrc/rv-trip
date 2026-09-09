import { describe, it, expect } from "vitest";
import {
  SUGGESTION_MIN_RATING,
  buildSuggestionShelf,
  isAlreadySaved,
  matchCandidateFromSaved,
  normalizePlaceName,
  suggestionToCreate,
  suggestionsFromTrips,
  type MatchCandidate,
  type PlaceSuggestion,
} from "./places";
import { savedPlaceCreate } from "./types";
import type { SavedPlace, Trip } from "./types";

// The "Been there?" rule of docs/design/41 §7, against the real seed
// (packages/db/src/seed.ts). Every case below is a row that ships today.

const saved = (
  name: string,
  lat: number | null,
  lng: number | null,
  googlePlaceId: string | null = null,
): MatchCandidate => ({ name, lat, lng, googlePlaceId });

// packages/db/src/seed.ts — the eight seeded library rows that matter here.
const SOUTH_BEACH_SAVED = saved("South Beach State Park", 44.6094, -124.0631);
const FISHING_BRIDGE_RV = saved("Fishing Bridge RV Park", 44.5647, -110.3735);
const LIBRARY = [
  saved("Kalaloch Campground", 47.6118, -124.3762),
  saved("Sunny's Smokehouse", 44.0582, -121.3153),
  SOUTH_BEACH_SAVED,
  FISHING_BRIDGE_RV,
];

describe("normalizePlaceName", () => {
  it("lowercases, trims, collapses whitespace and strips . , ' &", () => {
    expect(normalizePlaceName("  Sunny's   Smokehouse  ")).toBe("sunnys smokehouse");
    expect(normalizePlaceName("St. Mary, MT")).toBe("st mary mt");
    expect(normalizePlaceName("Astoria & Warrenton KOA")).toBe("astoria warrenton koa");
  });

  it("makes the seed's two spellings of one name equal", () => {
    expect(normalizePlaceName("south beach state park")).toBe(
      normalizePlaceName("South Beach State Park"),
    );
  });
});

describe("isAlreadySaved — rule 1, id match wins", () => {
  it("matches on equal non-null googlePlaceId whatever the name or distance says", () => {
    const c = saved("Kalaloch Campground (site A15)", 48.9, -122.1, "ChIJ_kalaloch");
    const library = [saved("Kalaloch Campground", 47.6118, -124.3762, "ChIJ_kalaloch")];
    expect(isAlreadySaved(c, library)).toBe(true);
  });

  it("does not match two null ids on the id rule alone — the names still decide", () => {
    expect(isAlreadySaved(saved("Astoria/Warrenton KOA", null, null), LIBRARY)).toBe(false);
  });
});

describe("isAlreadySaved — rule 2, names must match", () => {
  it("keeps Fishing Bridge, WY separate from Fishing Bridge RV Park at 0 m", () => {
    // seed.ts — the stop and the saved row carry identical coordinates and
    // neither has a googlePlaceId. A campground is not its town.
    const stop = saved("Fishing Bridge, WY", 44.5647, -110.3735);
    expect(isAlreadySaved(stop, LIBRARY)).toBe(false);
  });

  it("ignores a shared region word — Newport, OR is not Local Ocean Seafoods", () => {
    const library = [saved("Local Ocean Seafoods", 44.6297, -124.0526)];
    expect(isAlreadySaved(saved("Newport, OR", 44.6365, -124.053), library)).toBe(false);
  });
});

describe("isAlreadySaved — rule 3, coordinates are a tiebreaker", () => {
  it("matches an equal name within 150 m when both sides have real coords", () => {
    // ~90 m north of the saved row.
    const c = saved("South Beach State Park", 44.6102, -124.0631);
    expect(isAlreadySaved(c, [SOUTH_BEACH_SAVED])).toBe(true);
  });

  it("does not match an equal name 3 km apart when both sides have real coords", () => {
    // Two genuinely different Riverside Parks stay separate: the candidate
    // carries its OWN pin here, so the 150 m guard has something to measure.
    const c = saved("South Beach State Park", 44.6365, -124.053);
    expect(isAlreadySaved(c, [SOUTH_BEACH_SAVED])).toBe(false);
  });

  it("matches on the name alone when the candidate has no coordinates (Gap 3)", () => {
    // The South Beach State Park reservation (seed.ts) has no lat/lng of its
    // own; its parent stop's pin is ~3.1 km away and is never borrowed.
    const c = saved("South Beach State Park", null, null);
    expect(isAlreadySaved(c, LIBRARY)).toBe(true);
  });

  it("matches on the name alone when the LIBRARY row is the coordless side", () => {
    const c = saved("South Beach State Park", 44.6365, -124.053);
    expect(isAlreadySaved(c, [saved("South Beach State Park", null, null)])).toBe(true);
  });
});

describe("isAlreadySaved — rule 4, borrowed coordinates never enter", () => {
  it("is decided by the candidate's own coords, so a borrowed pin cannot flip it", () => {
    const own = saved("South Beach State Park", null, null);
    const borrowed = { ...own, lat: 44.6365, lng: -124.053 };
    expect(isAlreadySaved(own, LIBRARY)).toBe(true);
    // Same row with its parent stop's pin pasted in would have been suggested —
    // which is exactly why the caller must never paste it.
    expect(isAlreadySaved(borrowed, LIBRARY)).toBe(false);
  });

  it("returns false against an empty library", () => {
    expect(isAlreadySaved(saved("Anything", null, null), [])).toBe(false);
  });
});

// ── candidates ─────────────────────────────────────────────────────────────

/** The seeded Pacific Northwest Loop, with `status` under test. */
function pnwLoop(status: Trip["status"]): Trip {
  return {
    id: "9f1c2f4a-1d3b-4a2e-8c55-0b7e6a9d1234",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status,
    rating: null,
    note: null,
    legs: [
      {
        id: "leg-coast",
        tripId: "9f1c2f4a-1d3b-4a2e-8c55-0b7e6a9d1234",
        title: "Oregon Coast",
        sortOrder: 0,
        stops: [
          {
            id: "stop-astoria",
            legId: "leg-coast",
            place: { name: "Astoria, OR", lat: 46.1879, lng: -123.8313, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-05",
            sortOrder: 0,
            rating: 5,
            notes: "Loved the riverwalk. Book the same RV park next time.",
            reservations: [
              {
                id: "res-koa",
                stopId: "stop-astoria",
                ideaId: null,
                type: "campground",
                name: "Astoria/Warrenton KOA",
                checkIn: "2026-08-02",
                checkOut: "2026-08-05",
                confirmationNumber: "KOA-88213",
                cost: 204,
                rating: 5,
                notes: "Full hookups, site A12 backs to the trees.",
              },
              {
                id: "res-museum",
                stopId: "stop-astoria",
                ideaId: null,
                type: "tour",
                name: "Columbia River Maritime Museum",
                checkIn: "2026-08-03",
                checkOut: null,
                confirmationNumber: null,
                cost: 38,
                rating: null,
                notes: null,
              },
            ],
            ideas: [],
          },
          {
            id: "stop-newport",
            legId: "leg-coast",
            place: { name: "Newport, OR", lat: 44.6365, lng: -124.053, googlePlaceId: null },
            arriveDate: "2026-08-05",
            departDate: "2026-08-09",
            sortOrder: 1,
            rating: 4,
            notes: null,
            reservations: [
              {
                id: "res-south-beach",
                stopId: "stop-newport",
                ideaId: null,
                type: "campground",
                name: "South Beach State Park",
                checkIn: "2026-08-05",
                checkOut: "2026-08-09",
                confirmationNumber: "ORP-40192",
                cost: 160,
                rating: 4,
                notes: null,
              },
            ],
            ideas: [],
          },
          {
            id: "stop-bend",
            legId: "leg-coast",
            place: { name: "Bend, OR", lat: 44.0582, lng: -121.3153, googlePlaceId: null },
            arriveDate: "2026-08-12",
            departDate: "2026-08-16",
            sortOrder: 2,
            rating: null,
            notes: null,
            reservations: [],
            ideas: [],
          },
        ],
      },
    ],
  };
}

describe("suggestionsFromTrips", () => {
  it("is empty while the trip is still planning — the seed as it ships", () => {
    expect(suggestionsFromTrips([pnwLoop("planning")])).toEqual([]);
  });

  it("collects stops AND reservations rated >= 4 once the trip is complete (Q4=B)", () => {
    const got = suggestionsFromTrips([pnwLoop("complete")]);
    expect(got.map((s) => s.name)).toEqual([
      "Astoria, OR",
      "Astoria/Warrenton KOA",
      "Newport, OR",
      "South Beach State Park",
    ]);
    // Unrated rows never reach the rule.
    expect(got.map((s) => s.name)).not.toContain("Columbia River Maritime Museum");
    expect(got.map((s) => s.name)).not.toContain("Bend, OR");
    expect(got.every((s) => s.rating >= SUGGESTION_MIN_RATING)).toBe(true);
  });

  it("gives a reservation its parent stop's name as the region and NO coordinates", () => {
    const koa = suggestionsFromTrips([pnwLoop("complete")]).find(
      (s) => s.name === "Astoria/Warrenton KOA",
    )!;
    expect(koa.kind).toBe("reservation");
    expect(koa.region).toBe("Astoria, OR");
    expect(koa.lat).toBeNull();
    expect(koa.lng).toBeNull();
    expect(koa.type).toBe("campground");
    expect(koa.note).toBe("Full hookups, site A12 backs to the trees.");
    expect(koa.tripTitle).toBe("Pacific Northwest Loop");
  });

  it("carries a stop's own coordinates and files it under Other", () => {
    const astoria = suggestionsFromTrips([pnwLoop("complete")]).find(
      (s) => s.name === "Astoria, OR",
    )!;
    expect(astoria.kind).toBe("stop");
    expect(astoria.lat).toBe(46.1879);
    expect(astoria.type).toBe("other");
    expect(astoria.region).toBeNull();
  });

  it("keys every candidate uniquely by kind and id", () => {
    const keys = suggestionsFromTrips([pnwLoop("complete")]).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("reservation:res-koa");
  });
});

// ── the shelf ──────────────────────────────────────────────────────────────

const libraryRow = (name: string, lat: number | null, lng: number | null): SavedPlace => ({
  id: `saved-${name}`,
  ownerId: "dev-user",
  place: { name, lat, lng, googlePlaceId: null },
  region: null,
  type: "campground",
  status: "been",
  note: null,
  source: null,
  rating: 5,
  tripId: null,
  tripName: null,
});

describe("buildSuggestionShelf", () => {
  const candidates = () => suggestionsFromTrips([pnwLoop("complete")]);
  const library = [
    libraryRow("South Beach State Park", 44.6094, -124.0631),
    libraryRow("Fishing Bridge RV Park", 44.5647, -110.3735),
  ].map(matchCandidateFromSaved);

  it("is null when nothing is left to suggest — the bar simply does not render", () => {
    expect(buildSuggestionShelf([], library)).toBeNull();
    expect(buildSuggestionShelf(suggestionsFromTrips([pnwLoop("planning")]), library)).toBeNull();
  });

  it("drops the rows already in the library and keeps the rest", () => {
    const shelf = buildSuggestionShelf(candidates(), library)!;
    expect(shelf.suggestions.map((s) => s.name)).toEqual([
      "Astoria, OR",
      "Astoria/Warrenton KOA",
      "Newport, OR",
    ]);
    expect(shelf.headline).toBe("Pacific Northwest Loop is complete.");
    expect(shelf.detail).toBe(
      "3 places you rated ★4 or better aren’t in your library yet.",
    );
  });

  it("uses the singular copy when one suggestion is left", () => {
    const one = candidates().filter((s) => s.name === "Astoria/Warrenton KOA");
    const shelf = buildSuggestionShelf(one, library)!;
    expect(shelf.suggestions).toHaveLength(1);
    expect(shelf.detail).toBe("1 place you rated ★4 or better isn’t in your library yet.");
  });

  it("drops dismissed keys, and goes back to null when all are dismissed", () => {
    const all = candidates();
    const shelf = buildSuggestionShelf(all, library, ["stop:stop-astoria"])!;
    expect(shelf.suggestions.map((s) => s.key)).not.toContain("stop:stop-astoria");
    const keys = all.map((s) => s.key);
    expect(buildSuggestionShelf(all, library, keys)).toBeNull();
  });

  it("names the most recently ended trip in the headline", () => {
    const older: PlaceSuggestion = {
      ...candidates()[0]!,
      key: "stop:old",
      id: "old",
      name: "Jackson, WY",
      tripId: "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
      tripTitle: "Yellowstone & Tetons",
      tripEndDate: "2024-09-19",
    };
    const shelf = buildSuggestionShelf([older, ...candidates()], library)!;
    expect(shelf.headline).toBe("Pacific Northwest Loop is complete.");
    expect(shelf.suggestions[shelf.suggestions.length - 1]!.name).toBe("Jackson, WY");
  });
});

describe("suggestionToCreate", () => {
  it("accepts a suggestion straight onto the been shelf, carrying its rating and trip", () => {
    const koa = suggestionsFromTrips([pnwLoop("complete")]).find(
      (s) => s.name === "Astoria/Warrenton KOA",
    )!;
    const body = suggestionToCreate(koa);
    expect(body).toEqual({
      name: "Astoria/Warrenton KOA",
      region: "Astoria, OR",
      lat: null,
      lng: null,
      googlePlaceId: null,
      type: "campground",
      status: "been",
      note: "Full hookups, site A12 backs to the trees.",
      source: null,
      rating: 5,
      tripId: "9f1c2f4a-1d3b-4a2e-8c55-0b7e6a9d1234",
    });
    // It is a real POST /api/places body, not a shape only this file believes.
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
  });
});
