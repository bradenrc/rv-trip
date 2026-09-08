import { describe, it, expect } from "vitest";
import {
  legCreateInput,
  legPatchInput,
  legReorderInput,
  stopCreateInput,
  stopPatchInput,
} from "./types";
import { stopDatesOutsideTrip, stopOutsideTripMessage } from "./trip-status";

/**
 * The leg + stop handlers parse their bodies from these schemas, so what the
 * schemas do IS the handler contract (same reasoning as
 * `trip-write-contract.test.ts` for the trip side). The two behaviours worth
 * pinning: unknown keys are stripped — `id`, `tripId` and `sortOrder` are never
 * client-supplied on a create — and an omitted key on a PATCH stays ABSENT, so
 * the row menu can send one field without resetting the rest.
 */

const LEG = "6f1b6d0e-6d3b-4d9e-9d1f-6a0a7b2c3d4e";
const TRIP = "b2c4a6e8-1111-4222-8333-444455556666";
const STOP_A = "11111111-2222-4333-8444-555566667777";

describe("legCreateInput", () => {
  it("takes the parent trip and the title, and nothing else", () => {
    expect(
      legCreateInput.parse({
        tripId: TRIP,
        title: "Cascades & Home",
        sortOrder: 99,
        id: "spoofed",
      }),
    ).toEqual({ tripId: TRIP, title: "Cascades & Home" });
  });

  it("refuses a blank title and a tripId that could never name a row", () => {
    expect(legCreateInput.safeParse({ tripId: TRIP, title: "" }).success).toBe(false);
    expect(legCreateInput.safeParse({ tripId: "not-a-uuid", title: "Leg 2" }).success).toBe(
      false,
    );
  });
});

describe("legPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(legPatchInput.parse({})).toEqual({});
  });

  it("renames, and strips what the client is not allowed to set", () => {
    expect(legPatchInput.parse({ title: "Oregon Coast", tripId: TRIP, sortOrder: 3 })).toEqual({
      title: "Oregon Coast",
    });
  });

  it("still validates the field it does receive", () => {
    expect(legPatchInput.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("legReorderInput", () => {
  it("takes the new order of leg ids", () => {
    expect(legReorderInput.parse({ order: [LEG, TRIP] })).toEqual({ order: [LEG, TRIP] });
  });

  it("refuses an empty order and a non-id member", () => {
    expect(legReorderInput.safeParse({ order: [] }).success).toBe(false);
    expect(legReorderInput.safeParse({ order: ["1"] }).success).toBe(false);
  });
});

describe("stopCreateInput", () => {
  it("creates a floating stop from a leg and a place name", () => {
    expect(stopCreateInput.parse({ legId: LEG, place: { name: "Bend, OR" } })).toEqual({
      legId: LEG,
      place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
      arriveDate: null,
      departDate: null,
    });
  });

  it("carries coordinates and dates when the caller has them", () => {
    expect(
      stopCreateInput.parse({
        legId: LEG,
        place: { name: "Bend, OR", lat: 44.06, lng: -121.31, googlePlaceId: "gp1" },
        arriveDate: "2026-08-12",
        departDate: "2026-08-16",
      }),
    ).toEqual({
      legId: LEG,
      place: { name: "Bend, OR", lat: 44.06, lng: -121.31, googlePlaceId: "gp1" },
      arriveDate: "2026-08-12",
      departDate: "2026-08-16",
    });
  });

  it("refuses a nameless place, a foreign-shaped legId and a non-ISO date", () => {
    expect(stopCreateInput.safeParse({ legId: LEG, place: { name: "" } }).success).toBe(false);
    expect(stopCreateInput.safeParse({ legId: "leg-2", place: { name: "Bend" } }).success).toBe(
      false,
    );
    expect(
      stopCreateInput.safeParse({
        legId: LEG,
        place: { name: "Bend" },
        arriveDate: "Aug 12",
      }).success,
    ).toBe(false);
  });

  it("never lets the client pick the sort order or the id", () => {
    expect(
      stopCreateInput.parse({
        legId: LEG,
        place: { name: "Bend, OR" },
        sortOrder: 0,
        id: "spoofed",
      }),
    ).toEqual({
      legId: LEG,
      place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
      arriveDate: null,
      departDate: null,
    });
  });
});

describe("stopPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(stopPatchInput.parse({})).toEqual({});
  });

  it("renames without touching anything else", () => {
    expect(stopPatchInput.parse({ placeName: "Newport, OR" })).toEqual({
      placeName: "Newport, OR",
    });
  });

  it("carries the three widened fields — placeName, legId and sortOrder", () => {
    expect(stopPatchInput.parse({ placeName: "Bend, OR", legId: LEG, sortOrder: 2 })).toEqual({
      placeName: "Bend, OR",
      legId: LEG,
      sortOrder: 2,
    });
  });

  it("unschedules by sending both dates as null", () => {
    expect(stopPatchInput.parse({ arriveDate: null, departDate: null })).toEqual({
      arriveDate: null,
      departDate: null,
    });
  });

  it("strips the keys a stop write may never carry", () => {
    expect(stopPatchInput.parse({ notes: "windy", id: STOP_A, place: { name: "x" } })).toEqual({
      notes: "windy",
    });
  });

  it("still validates the fields it does receive", () => {
    expect(stopPatchInput.safeParse({ placeName: "" }).success).toBe(false);
    expect(stopPatchInput.safeParse({ arriveDate: "Aug 12" }).success).toBe(false);
    expect(stopPatchInput.safeParse({ legId: "leg-2" }).success).toBe(false);
    expect(stopPatchInput.safeParse({ sortOrder: 1.5 }).success).toBe(false);
    expect(stopPatchInput.safeParse({ rating: 9 }).success).toBe(false);
  });
});

describe("stopDatesOutsideTrip", () => {
  const window = { startDate: "2026-08-01", endDate: "2026-08-28" };

  it("passes a stop the trip window fully contains, including on both edges", () => {
    expect(
      stopDatesOutsideTrip(window, { arriveDate: "2026-08-12", departDate: "2026-08-16" }),
    ).toBe(false);
    expect(
      stopDatesOutsideTrip(window, { arriveDate: "2026-08-01", departDate: "2026-08-28" }),
    ).toBe(false);
  });

  it("catches a stop that starts before the trip or ends after it", () => {
    expect(
      stopDatesOutsideTrip(window, { arriveDate: "2026-07-30", departDate: "2026-08-02" }),
    ).toBe(true);
    expect(
      stopDatesOutsideTrip(window, { arriveDate: "2026-08-27", departDate: "2026-08-30" }),
    ).toBe(true);
  });

  it("has nothing to say about a floating stop", () => {
    expect(stopDatesOutsideTrip(window, { arriveDate: null, departDate: null })).toBe(false);
    expect(stopDatesOutsideTrip(window, { arriveDate: "2026-09-30", departDate: null })).toBe(
      false,
    );
  });

  it("names the offending span and the trip's range", () => {
    expect(stopOutsideTripMessage(window, "2026-08-30", "2026-09-02")).toBe(
      "Aug 30–Sep 2 is outside the trip, which runs Aug 1–28. Change the trip's dates first.",
    );
  });
});
