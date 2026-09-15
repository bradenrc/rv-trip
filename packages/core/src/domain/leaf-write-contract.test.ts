import { describe, it, expect } from "vitest";
import {
  ideaCreateInput,
  ideaPatchInput,
  ideaPromoteInput,
  reservationCreateInput,
  reservationPatchInput,
} from "./types";

/**
 * The reservation and idea handlers parse their bodies from these schemas, so
 * what the schemas do IS the handler contract. Three behaviours are
 * load-bearing: `promote`'s type is OPTIONAL and defaults to the "activity"
 * the mutation used to hardcode (so a caller that posts no body is
 * unaffected); an omitted PATCH key stays ABSENT rather than becoming a
 * phantom reset; and unknown keys are stripped, so `id`/`stopId` can never be
 * written through an edit.
 */

const STOP = "6f1c5b4e-0000-4000-8000-000000000001";
const TRIP = "6f1c5b4e-0000-4000-8000-0000000000aa";

describe("reservationCreateInput", () => {
  it("fills the optional half of the form with nulls", () => {
    expect(
      reservationCreateInput.parse({ stopId: STOP, type: "campground", name: "Fort Stevens" }),
    ).toEqual({
      stopId: STOP,
      type: "campground",
      name: "Fort Stevens",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: null,
      rating: null,
      notes: null,
    });
  });

  it("carries the whole row an undone delete puts back", () => {
    const body = {
      stopId: STOP,
      type: "dining" as const,
      name: "Rogue Ales brewery lunch",
      checkIn: "2026-08-18",
      checkOut: null,
      confirmationNumber: "RA-771",
      cost: 64,
      rating: 4,
      notes: "Sit outside.",
    };
    expect(reservationCreateInput.parse(body)).toEqual(body);
  });

  it("refuses a blank name, a bad type, a non-ISO date and a negative cost", () => {
    const base = { stopId: STOP, type: "dining", name: "X" };
    expect(reservationCreateInput.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(reservationCreateInput.safeParse({ ...base, type: "brunch" }).success).toBe(false);
    expect(reservationCreateInput.safeParse({ ...base, checkIn: "Aug 18" }).success).toBe(false);
    expect(reservationCreateInput.safeParse({ ...base, cost: -1 }).success).toBe(false);
    expect(reservationCreateInput.safeParse({ ...base, stopId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("reservationPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(reservationPatchInput.parse({})).toEqual({});
  });

  it("passes through only what was sent, and strips what is not editable", () => {
    expect(
      reservationPatchInput.parse({ name: "Renamed", id: "r1", stopId: STOP, ideaId: "i1" }),
    ).toEqual({ name: "Renamed" });
  });

  it("clears a field with an explicit null", () => {
    expect(reservationPatchInput.parse({ cost: null, checkOut: null })).toEqual({
      cost: null,
      checkOut: null,
    });
  });
});

describe("ideaCreateInput", () => {
  it("defaults a fresh idea to the 'idea' status with no place", () => {
    expect(
      ideaCreateInput.parse({ tripId: TRIP, stopId: STOP, title: "Cape Perpetua overlook" }),
    ).toEqual({
      tripId: TRIP,
      stopId: STOP,
      category: "do",
      title: "Cape Perpetua overlook",
      status: "idea",
      place: null,
      rating: null,
      notes: null,
    });
  });

  it("never lets the client pick a sortOrder — the server appends", () => {
    expect(
      ideaCreateInput.parse({ tripId: TRIP, stopId: STOP, title: "X", sortOrder: 99 }),
    ).not.toHaveProperty("sortOrder");
  });

  /** #80 — the shelf create. A maybe belongs to the TRIP; the stop is the
   * optional half, and the trip is the half that cannot be left out. */
  it("takes a shelf idea: an explicit null stopId and a category", () => {
    expect(
      ideaCreateInput.parse({ tripId: TRIP, stopId: null, category: "stay", title: "Coachland" }),
    ).toEqual({
      tripId: TRIP,
      stopId: null,
      category: "stay",
      title: "Coachland",
      status: "idea",
      place: null,
      rating: null,
      notes: null,
    });
  });

  it("defaults stopId to null — an idea with no stop in hand is a shelf idea", () => {
    expect(ideaCreateInput.parse({ tripId: TRIP, title: "Hot springs" }).stopId).toBeNull();
  });

  it("refuses a create with no trip — there is no other ownership path", () => {
    expect(ideaCreateInput.safeParse({ stopId: STOP, title: "Orphan" }).success).toBe(false);
    expect(ideaCreateInput.safeParse({ tripId: "not-a-uuid", title: "Orphan" }).success).toBe(false);
  });
});

describe("ideaPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(ideaPatchInput.parse({})).toEqual({});
  });

  it("leaves `place` ABSENT when the body does not carry it — the status cycle", () => {
    // The whole reason the flattening below tests for `undefined`: every
    // shipped idea write is a single-field patch, and a phantom `place: null`
    // here would wipe place_name/lat/lng/google_place_id on every one of them.
    const patch = ideaPatchInput.parse({ status: "planned" });
    expect(patch).toEqual({ status: "planned" });
    expect("place" in patch).toBe(false);
  });

  it("carries the whole place the row's picker chose", () => {
    expect(
      ideaPatchInput.parse({
        place: { name: "Tumalo Falls Trailhead", lat: 44.0317, lng: -121.5678, googlePlaceId: "ChIJtumalo" },
      }),
    ).toEqual({
      place: { name: "Tumalo Falls Trailhead", lat: 44.0317, lng: -121.5678, googlePlaceId: "ChIJtumalo" },
    });
  });

  it("takes a coordless place — the picker's free-text escape row is a legal pick", () => {
    expect(ideaPatchInput.parse({ place: { name: "Deschutes River float" } })).toEqual({
      place: { name: "Deschutes River float", lat: null, lng: null, googlePlaceId: null },
    });
  });

  it("clears the place with an explicit null, and strips what is not editable", () => {
    expect(ideaPatchInput.parse({ place: null, id: "i1", sortOrder: 9 })).toEqual({
      place: null,
    });
  });

  /** #80 — the drop. `stop_id` IS a column, so unlike `place` it is editable
   * through this patch: an id attaches, an explicit null sends the row back to
   * the shelf, and an absent key still leaves the attachment alone. */
  it("carries the drop's stopId, including an explicit null", () => {
    expect(ideaPatchInput.parse({ stopId: STOP })).toEqual({ stopId: STOP });
    expect(ideaPatchInput.parse({ stopId: null })).toEqual({ stopId: null });
    expect("stopId" in ideaPatchInput.parse({ status: "planned" })).toBe(false);
  });

  it("refuses a stopId that is not a uuid — it addresses a real uuid column", () => {
    expect(ideaPatchInput.safeParse({ stopId: "nope" }).success).toBe(false);
  });

  it("carries the category — a maybe can be re-filed from Do to Eat", () => {
    expect(ideaPatchInput.parse({ category: "eat" })).toEqual({ category: "eat" });
    expect(ideaPatchInput.safeParse({ category: "sleep" }).success).toBe(false);
  });

  it("refuses a place with no name", () => {
    expect(ideaPatchInput.safeParse({ place: { name: "" } }).success).toBe(false);
  });
});

describe("ideaPromoteInput", () => {
  it("keeps today's 'activity' when no type is sent — the shipped caller posts no body", () => {
    expect(ideaPromoteInput.parse({})).toEqual({ type: "activity" });
  });

  it("takes the type you picked", () => {
    expect(ideaPromoteInput.parse({ type: "dining" })).toEqual({ type: "dining" });
  });

  it("refuses a type that is not on the reservation enum", () => {
    expect(ideaPromoteInput.safeParse({ type: "Eat" }).success).toBe(false);
  });
});
