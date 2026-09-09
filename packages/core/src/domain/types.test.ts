import { describe, it, expect } from "vitest";
import {
  savedPlace,
  savedPlaceCreate,
  savedPlacePatch,
  normalizeSavedPlacePatch,
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
