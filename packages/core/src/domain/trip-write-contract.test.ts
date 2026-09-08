import { describe, it, expect } from "vitest";
import { tripCreateInput, tripPatchInput } from "./types";

/**
 * The trip handlers parse their bodies from these schemas, so what the schemas
 * do IS the handler contract. Pinned here because two of the behaviours are
 * load-bearing and easy to lose in a zod upgrade: unknown keys are stripped,
 * and an omitted optional-over-defaulted field stays ABSENT (a phantom default
 * would silently reset a field the settings dialog never touched).
 */

describe("tripCreateInput", () => {
  it("defaults homeBase to null when the create form leaves it blank", () => {
    expect(
      tripCreateInput.parse({
        title: "Redwoods Run",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
      }),
    ).toEqual({
      title: "Redwoods Run",
      startDate: "2026-09-20",
      endDate: "2026-10-04",
      homeBase: null,
    });
  });

  it("refuses a blank title and a non-ISO date", () => {
    const base = { title: "X", startDate: "2026-09-20", endDate: "2026-10-04" };
    expect(tripCreateInput.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(tripCreateInput.safeParse({ ...base, startDate: "Sep 20" }).success).toBe(false);
  });
});

describe("tripPatchInput", () => {
  it("accepts an empty patch without inventing defaults", () => {
    expect(tripPatchInput.parse({})).toEqual({});
  });

  it("passes through only what was sent, and strips unknown keys", () => {
    expect(tripPatchInput.parse({ title: "Renamed", legs: [], ownerId: "someone-else" })).toEqual({
      title: "Renamed",
    });
  });

  it("carries the manual status pin as a pair", () => {
    expect(tripPatchInput.parse({ status: "complete", statusAuto: false })).toEqual({
      status: "complete",
      statusAuto: false,
    });
  });

  it("still validates the fields it does receive", () => {
    expect(tripPatchInput.safeParse({ endDate: "nope" }).success).toBe(false);
    expect(tripPatchInput.safeParse({ rating: 9 }).success).toBe(false);
    expect(tripPatchInput.safeParse({ status: "traveling" }).success).toBe(false);
  });
});
