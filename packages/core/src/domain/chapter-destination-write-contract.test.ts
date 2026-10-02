import { describe, it, expect } from "vitest";
import {
  chapterCreateInput,
  chapterPatchInput,
  chapterReorderInput,
  destinationCreateInput,
  destinationPatchInput,
} from "./types";
import { destinationDatesOutsideTrip, destinationOutsideTripMessage } from "./trip-status";

/**
 * The chapter + destination handlers parse their bodies from these schemas, so what the
 * schemas do IS the handler contract (same reasoning as
 * `trip-write-contract.test.ts` for the trip side). The two behaviours worth
 * pinning: unknown keys are stripped — `id`, `tripId` and `sortOrder` are never
 * client-supplied on a create — and an omitted key on a PATCH stays ABSENT, so
 * the row menu can send one field without resetting the rest.
 */

const CHAPTER = "6f1b6d0e-6d3b-4d9e-9d1f-6a0a7b2c3d4e";
const TRIP = "b2c4a6e8-1111-4222-8333-444455556666";
const DESTINATION_A = "11111111-2222-4333-8444-555566667777";

describe("chapterCreateInput", () => {
  it("takes the parent trip and the title, and nothing else", () => {
    expect(
      chapterCreateInput.parse({
        tripId: TRIP,
        title: "Cascades & Home",
        sortOrder: 99,
        id: "spoofed",
      }),
    ).toEqual({ tripId: TRIP, title: "Cascades & Home" });
  });

  it("#155 · Q1 A — takes a null title (an unnamed chapter), and an omitted one is null", () => {
    expect(chapterCreateInput.parse({ tripId: TRIP, title: null })).toEqual({ tripId: TRIP, title: null });
    expect(chapterCreateInput.parse({ tripId: TRIP })).toEqual({ tripId: TRIP, title: null });
  });

  it("refuses a blank title and a tripId that could never name a row", () => {
    expect(chapterCreateInput.safeParse({ tripId: TRIP, title: "" }).success).toBe(false);
    expect(chapterCreateInput.safeParse({ tripId: "not-a-uuid", title: "Chapter 2" }).success).toBe(
      false,
    );
  });
});

describe("chapterPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(chapterPatchInput.parse({})).toEqual({});
  });

  it("renames, and strips what the client is not allowed to set", () => {
    expect(chapterPatchInput.parse({ title: "Oregon Coast", tripId: TRIP, sortOrder: 3 })).toEqual({
      title: "Oregon Coast",
    });
  });

  it("still validates the field it does receive", () => {
    expect(chapterPatchInput.safeParse({ title: "" }).success).toBe(false);
  });

  it("#155 · un-names a chapter with an explicit null", () => {
    expect(chapterPatchInput.parse({ title: null })).toEqual({ title: null });
  });
});

describe("chapterReorderInput", () => {
  it("takes the new order of chapter ids", () => {
    expect(chapterReorderInput.parse({ order: [CHAPTER, TRIP] })).toEqual({ order: [CHAPTER, TRIP] });
  });

  it("refuses an empty order and a non-id member", () => {
    expect(chapterReorderInput.safeParse({ order: [] }).success).toBe(false);
    expect(chapterReorderInput.safeParse({ order: ["1"] }).success).toBe(false);
  });
});

describe("destinationCreateInput", () => {
  it("creates a floating destination from a chapter and a place name", () => {
    expect(destinationCreateInput.parse({ chapterId: CHAPTER, place: { name: "Bend, OR" } })).toEqual({
      chapterId: CHAPTER,
      place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
      arriveDate: null,
      departDate: null,
    });
  });

  it("carries coordinates and dates when the caller has them", () => {
    expect(
      destinationCreateInput.parse({
        chapterId: CHAPTER,
        place: { name: "Bend, OR", lat: 44.06, lng: -121.31, googlePlaceId: "gp1" },
        arriveDate: "2026-08-12",
        departDate: "2026-08-16",
      }),
    ).toEqual({
      chapterId: CHAPTER,
      place: { name: "Bend, OR", lat: 44.06, lng: -121.31, googlePlaceId: "gp1" },
      arriveDate: "2026-08-12",
      departDate: "2026-08-16",
    });
  });

  it("refuses a nameless place, a foreign-shaped chapterId and a non-ISO date", () => {
    expect(destinationCreateInput.safeParse({ chapterId: CHAPTER, place: { name: "" } }).success).toBe(false);
    expect(destinationCreateInput.safeParse({ chapterId: "chapter-2", place: { name: "Bend" } }).success).toBe(
      false,
    );
    expect(
      destinationCreateInput.safeParse({
        chapterId: CHAPTER,
        place: { name: "Bend" },
        arriveDate: "Aug 12",
      }).success,
    ).toBe(false);
  });

  it("never lets the client pick the sort order or the id", () => {
    expect(
      destinationCreateInput.parse({
        chapterId: CHAPTER,
        place: { name: "Bend, OR" },
        sortOrder: 0,
        id: "spoofed",
      }),
    ).toEqual({
      chapterId: CHAPTER,
      place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
      arriveDate: null,
      departDate: null,
    });
  });
});

describe("destinationPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(destinationPatchInput.parse({})).toEqual({});
  });

  it("renames without touching anything else", () => {
    expect(destinationPatchInput.parse({ placeName: "Newport, OR" })).toEqual({
      placeName: "Newport, OR",
    });
  });

  it("carries the three widened fields — placeName, chapterId and sortOrder", () => {
    expect(destinationPatchInput.parse({ placeName: "Bend, OR", chapterId: CHAPTER, sortOrder: 2 })).toEqual({
      placeName: "Bend, OR",
      chapterId: CHAPTER,
      sortOrder: 2,
    });
  });

  it("unschedules by sending both dates as null", () => {
    expect(destinationPatchInput.parse({ arriveDate: null, departDate: null })).toEqual({
      arriveDate: null,
      departDate: null,
    });
  });

  it("strips the keys a destination write may never carry", () => {
    expect(destinationPatchInput.parse({ notes: "windy", id: DESTINATION_A, chapterId: CHAPTER })).toEqual({
      notes: "windy",
      chapterId: CHAPTER,
    });
  });

  /** #60: the whole place travels as ONE key. Coordinates were unreachable
   * before, which is why a `"New destination"` row could never be repaired by a
   * patch. Defaults fill the three optional halves so a name-only place is a
   * legal, honestly coordless write. */
  it("carries the whole place — name, coordinates and place id together", () => {
    expect(
      destinationPatchInput.parse({
        place: {
          name: "Cape Lookout State Park",
          lat: 45.3612,
          lng: -123.9707,
          googlePlaceId: "ChIJlXc1RkoPlVQR",
        },
      }),
    ).toEqual({
      place: {
        name: "Cape Lookout State Park",
        lat: 45.3612,
        lng: -123.9707,
        googlePlaceId: "ChIJlXc1RkoPlVQR",
      },
    });
    expect(destinationPatchInput.parse({ place: { name: "rogue ales brewery" } }).place).toEqual({
      name: "rogue ales brewery",
      lat: null,
      lng: null,
      googlePlaceId: null,
    });
    expect(destinationPatchInput.safeParse({ place: { name: "" } }).success).toBe(false);
  });

  it("still validates the fields it does receive", () => {
    expect(destinationPatchInput.safeParse({ placeName: "" }).success).toBe(false);
    expect(destinationPatchInput.safeParse({ arriveDate: "Aug 12" }).success).toBe(false);
    expect(destinationPatchInput.safeParse({ chapterId: "chapter-2" }).success).toBe(false);
    expect(destinationPatchInput.safeParse({ sortOrder: 1.5 }).success).toBe(false);
    expect(destinationPatchInput.safeParse({ rating: 9 }).success).toBe(false);
  });
});

describe("destinationDatesOutsideTrip", () => {
  const window = { startDate: "2026-08-01", endDate: "2026-08-28" };

  it("passes a destination the trip window fully contains, including on both edges", () => {
    expect(
      destinationDatesOutsideTrip(window, { arriveDate: "2026-08-12", departDate: "2026-08-16" }),
    ).toBe(false);
    expect(
      destinationDatesOutsideTrip(window, { arriveDate: "2026-08-01", departDate: "2026-08-28" }),
    ).toBe(false);
  });

  it("catches a destination that starts before the trip or ends after it", () => {
    expect(
      destinationDatesOutsideTrip(window, { arriveDate: "2026-07-30", departDate: "2026-08-02" }),
    ).toBe(true);
    expect(
      destinationDatesOutsideTrip(window, { arriveDate: "2026-08-27", departDate: "2026-08-30" }),
    ).toBe(true);
  });

  it("has nothing to say about a floating destination", () => {
    expect(destinationDatesOutsideTrip(window, { arriveDate: null, departDate: null })).toBe(false);
    expect(destinationDatesOutsideTrip(window, { arriveDate: "2026-09-30", departDate: null })).toBe(
      false,
    );
  });

  it("names the offending span and the trip's range", () => {
    expect(destinationOutsideTripMessage(window, "2026-08-30", "2026-09-02")).toBe(
      "Aug 30–Sep 2 is outside the trip, which runs Aug 1–28. Change the trip's dates first.",
    );
  });
});
