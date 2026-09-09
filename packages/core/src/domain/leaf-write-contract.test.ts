import { describe, it, expect } from "vitest";
import { ideaCreateInput, ideaPromoteInput, reservationCreateInput, reservationPatchInput } from "./types";

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
    expect(ideaCreateInput.parse({ stopId: STOP, title: "Cape Perpetua overlook" })).toEqual({
      stopId: STOP,
      title: "Cape Perpetua overlook",
      status: "idea",
      place: null,
      rating: null,
      notes: null,
    });
  });

  it("never lets the client pick a sortOrder — the server appends", () => {
    expect(ideaCreateInput.parse({ stopId: STOP, title: "X", sortOrder: 99 })).not.toHaveProperty(
      "sortOrder",
    );
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
