import { describe, it, expect } from "vitest";
import {
  changeHistoryRow,
  savedPlace,
  savedPlaceCreate,
  savedPlacePatch,
  normalizeSavedPlacePatch,
  stop,
  trip,
  tripSummary,
} from "./types";

// The write grammar for the Places library (docs/design/41 §3). `savedPlace` is
// the READ shape — nested `place`, server-owned `id`/`ownerId`, joined
// `tripName`. The wire bodies the picker and the sheets send are FLAT and
// partial, so they get their own named schemas; validating them against
// `savedPlace` fails on the missing keys and silently drops every flat one.

const TRIP_ID = "8c2b2c1e-6a4e-4f0e-9a0b-6f2b1d0a7c31";

// Verbatim from the wireframe's POST /api/places body.
const SAVE_BODY = {
  name: "Kalaloch Campground",
  region: "Olympic NP, WA",
  googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
  lat: 47.6118,
  lng: -124.3762,
  type: "campground",
  status: "want",
  source: "Jane & Rick",
  note: "Bluff sites right over the beach…",
};

describe("savedPlaceCreate — the flat POST /api/places body", () => {
  it("accepts the wireframe's save body verbatim and keeps every flat key", () => {
    const parsed = savedPlaceCreate.parse(SAVE_BODY);
    expect(parsed).toEqual({ ...SAVE_BODY, rating: null, tripId: null });
  });

  it("is NOT the read shape — savedPlace rejects the same body", () => {
    // The regression this schema exists for: safeParse against savedPlace fails
    // on the missing place/id/ownerId, so a create validated that way is empty.
    expect(savedPlace.safeParse(SAVE_BODY).success).toBe(false);
  });

  it("needs only a name — everything else defaults", () => {
    expect(savedPlaceCreate.parse({ name: "Sunny's Smokehouse" })).toEqual({
      name: "Sunny's Smokehouse",
      region: null,
      lat: null,
      lng: null,
      googlePlaceId: null,
      type: "other",
      status: "want",
      note: null,
      source: null,
      rating: null,
      tripId: null,
    });
  });

  it("accepts a suggestion straight onto the been shelf, coordless", () => {
    // "Accepting a suggestion is a POST with status:'been' and no lat/lng, not
    // a PATCH: the library row does not exist yet." (wireframe §3)
    const parsed = savedPlaceCreate.parse({
      name: "Astoria, OR",
      type: "campground",
      status: "been",
      rating: 5,
      tripId: TRIP_ID,
    });
    expect(parsed.status).toBe("been");
    expect(parsed.rating).toBe(5);
    expect(parsed.lat).toBeNull();
    expect(parsed.lng).toBeNull();
  });

  it("drops the server-owned and joined keys a client must not set", () => {
    const parsed = savedPlaceCreate.parse({
      ...SAVE_BODY,
      id: "spoofed",
      ownerId: "someone-else",
      tripName: "Pacific Northwest Loop",
    });
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("ownerId");
    expect(parsed).not.toHaveProperty("tripName");
  });

  it("rejects an empty name, an unknown category and an out-of-range rating", () => {
    expect(savedPlaceCreate.safeParse({ ...SAVE_BODY, name: "" }).success).toBe(false);
    expect(savedPlaceCreate.safeParse({ ...SAVE_BODY, type: "brewery" }).success).toBe(false);
    expect(savedPlaceCreate.safeParse({ ...SAVE_BODY, rating: 6 }).success).toBe(false);
    expect(savedPlaceCreate.safeParse({ ...SAVE_BODY, status: "maybe" }).success).toBe(false);
  });
});

describe("savedPlacePatch — the partial PATCH /api/places/:id body", () => {
  it("accepts the wireframe's graduation body and sets nothing else", () => {
    const parsed = savedPlacePatch.parse({
      status: "been",
      rating: 5,
      tripId: TRIP_ID,
      source: null,
    });
    expect(parsed).toEqual({ status: "been", rating: 5, tripId: TRIP_ID, source: null });
  });

  it("leaves absent keys absent, so a patch never blanks a column it omits", () => {
    const parsed = savedPlacePatch.parse({ note: "Sites 1-10 face the water." });
    expect(Object.keys(parsed)).toEqual(["note"]);
  });

  it("accepts a coordinate backfill (the Locate write path)", () => {
    expect(savedPlacePatch.parse({ lat: 46.1712, lng: -123.9012 })).toEqual({
      lat: 46.1712,
      lng: -123.9012,
    });
  });

  it("rejects a patch that would change nothing", () => {
    // `.set({})` is a Drizzle error, and an all-unknown-keys body is a caller
    // bug worth a 400 rather than a 500.
    expect(savedPlacePatch.safeParse({}).success).toBe(false);
    expect(savedPlacePatch.safeParse({ tripName: "Pacific Northwest Loop" }).success).toBe(false);
  });

  it("rejects the same invalid values create does", () => {
    expect(savedPlacePatch.safeParse({ rating: 0 }).success).toBe(false);
    expect(savedPlacePatch.safeParse({ type: "brewery" }).success).toBe(false);
    expect(savedPlacePatch.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("normalizeSavedPlacePatch — graduation clears the tip's source", () => {
  it("clears source when the client forgot to send source: null", () => {
    // The acceptance body is { status, rating, tripId } — no source — and the
    // row must still land on the been shelf with source null.
    expect(
      normalizeSavedPlacePatch({ status: "been", rating: 5, tripId: TRIP_ID }),
    ).toEqual({ status: "been", rating: 5, tripId: TRIP_ID, source: null });
  });

  it("clears source even when the client tries to carry one over", () => {
    expect(
      normalizeSavedPlacePatch({ status: "been", source: "Jane & Rick" }),
    ).toEqual({ status: "been", source: null });
  });

  it("leaves a non-graduating patch untouched", () => {
    expect(normalizeSavedPlacePatch({ source: "Forum tip" })).toEqual({
      source: "Forum tip",
    });
    expect(normalizeSavedPlacePatch({ status: "want", source: "Forum tip" })).toEqual({
      status: "want",
      source: "Forum tip",
    });
  });
});

// ── the dashboard row ──────────────────────────────────────────────────────
// `milesEstimated` is REQUIRED, not defaulted (docs/design/43 §3): the card's
// number is now the rail's number, and the chip is the only thing that says
// whether that number is a road distance or a chord. A row without the flag is
// a row from a server that cannot tell you, and the api-client must not quietly
// render it as measured.
const SUMMARY_ROW = {
  id: "8c2b2c1e-6a4e-4f0e-9a0b-6f2b1d0a7c31",
  title: "Pacific Northwest Loop",
  homeBase: "Boise, ID",
  startDate: "2026-08-01",
  endDate: "2026-08-28",
  status: "planning",
  statusAuto: false,
  rating: null,
  note: null,
  days: 28,
  stops: 4,
  legs: 2,
  miles: 427,
  milesEstimated: false,
  open: 14,
};

describe("tripSummary — the dashboard row's wire shape", () => {
  it("accepts a row carrying milesEstimated", () => {
    expect(tripSummary.parse(SUMMARY_ROW)).toEqual(SUMMARY_ROW);
  });

  it("carries the cold-cache row's estimate flag through verbatim", () => {
    // The wireframe's second card: 336 mi with the estimate chip.
    const cold = { ...SUMMARY_ROW, miles: 336, milesEstimated: true };
    expect(tripSummary.parse(cold).milesEstimated).toBe(true);
  });

  it("rejects a row without it", () => {
    const { milesEstimated: _omitted, ...withoutFlag } = SUMMARY_ROW;
    expect(tripSummary.safeParse(withoutFlag).success).toBe(false);
  });
});

// ── the byline's joined row (#78 · docs/design/81 §6) ──────────────────────
// `lastChange` is nullable + .default(null) for one reason: every payload
// already in flight — a phone build on its own Expo cadence, a cached bundle,
// a fixture written before #78 — must keep parsing. The tests below are that
// promise, stated as the shape rather than as a hope.

/** A trip EXACTLY as the server shipped it before #78: no `lastChange` on the
 * trip, the stop, the reservation, the attached idea or the shelf idea. */
const PRE_78_TRIP = {
  id: TRIP_ID,
  ownerId: "dev-household",
  title: "Pacific Northwest Loop",
  homeBase: "Boise, ID",
  homeBasePlace: null,
  startDate: "2026-08-01",
  endDate: "2026-08-28",
  status: "planning",
  statusAuto: false,
  rating: null,
  note: null,
  legs: [
    {
      id: "leg-coast",
      tripId: TRIP_ID,
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
          ],
          ideas: [
            {
              id: "idea-fort",
              tripId: TRIP_ID,
              stopId: "stop-astoria",
              title: "Fort Stevens bike loop",
              category: "do",
              status: "idea",
              place: null,
              rating: null,
              notes: null,
              sortOrder: 0,
            },
          ],
        },
      ],
    },
  ],
  ideas: [
    {
      id: "idea-shelf",
      tripId: TRIP_ID,
      stopId: null,
      title: "Blue Scorcher Bakery",
      category: "eat",
      status: "idea",
      place: null,
      rating: null,
      notes: null,
      sortOrder: 0,
    },
  ],
};

describe("lastChange — the one joined row the byline reads", () => {
  it("parses a pre-#78 trip and defaults lastChange to null everywhere", () => {
    const parsed = trip.parse(PRE_78_TRIP);
    const parsedStop = parsed.legs[0]!.stops[0]!;

    expect(parsedStop.lastChange).toBeNull();
    expect(parsedStop.reservations[0]!.lastChange).toBeNull();
    expect(parsedStop.ideas[0]!.lastChange).toBeNull();
    expect(parsed.ideas[0]!.lastChange).toBeNull();
  });

  it("leaves the rest of a pre-#78 trip byte-for-byte alone", () => {
    const parsed = trip.parse(PRE_78_TRIP);
    // Everything the planner already reads survives the new field: the only
    // difference between what went in and what came out is `lastChange`.
    expect(parsed.title).toBe("Pacific Northwest Loop");
    expect(parsed.legs[0]!.stops[0]!.place.name).toBe("Astoria, OR");
    expect(parsed.legs[0]!.stops[0]!.reservations[0]!.cost).toBe(204);
    expect(parsed.ideas[0]!.title).toBe("Blue Scorcher Bakery");
  });

  it("carries a real row through — the wireframe's 'rated by Jess · Sep 12'", () => {
    const withByline = {
      ...PRE_78_TRIP.legs[0]!.stops[0]!,
      lastChange: { field: "rating", memberName: "Jess", at: "2026-09-12T18:04:11Z" },
    };
    expect(stop.parse(withByline).lastChange).toEqual({
      field: "rating",
      memberName: "Jess",
      at: "2026-09-12T18:04:11Z",
    });
  });

  it("speaks only the three shared-voice fields", () => {
    const bogus = {
      ...PRE_78_TRIP.legs[0]!.stops[0]!,
      lastChange: { field: "cost", memberName: "Jess", at: "2026-09-12T18:04:11Z" },
    };
    expect(stop.safeParse(bogus).success).toBe(false);
  });

  it("defaults on a saved place too — the /places card's byline", () => {
    const row = {
      id: "sp-1",
      ownerId: "dev-household",
      place: { name: "Astoria/Warrenton KOA", lat: null, lng: null, googlePlaceId: null },
      region: "Astoria, OR",
      type: "campground",
      status: "been",
      note: "Riverfront sites 41–48.",
      source: null,
      rating: 5,
      tripId: null,
      tripName: null,
    };
    expect(savedPlace.parse(row).lastChange).toBeNull();
    expect(
      savedPlace.parse({
        ...row,
        lastChange: { field: "notes", memberName: "Braden", at: "2026-08-29T15:00:00Z" },
      }).lastChange,
    ).toEqual({ field: "notes", memberName: "Braden", at: "2026-08-29T15:00:00Z" });
  });

  it("is a history ROW that adds from/to — what the popover renders", () => {
    expect(
      changeHistoryRow.parse({
        field: "rating",
        from: "4",
        to: "5",
        memberName: "Jess",
        at: "2026-09-12T18:04:11Z",
      }),
    ).toEqual({
      field: "rating",
      from: "4",
      to: "5",
      memberName: "Jess",
      at: "2026-09-12T18:04:11Z",
    });
    // "— → ★★★★": a genuinely absent old value is null, never the string.
    expect(
      changeHistoryRow.parse({
        field: "rating",
        from: null,
        to: "4",
        memberName: "Braden",
        at: "2026-08-30T15:00:00Z",
      }).from,
    ).toBeNull();
  });
});
