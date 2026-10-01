import { describe, it, expect } from "vitest";
import { ApiError } from "../api-client/index";
import {
  NO_HOME_BASE_COPY,
  isNoHomeBaseRefusal,
  roundTripSavable,
  type BoundaryFlightsBody,
} from "./index";
import { homeBaseRowValue, householdHomeBasePatch, userPrefsPatch } from "./prefs";

/**
 * #142 · Q4 C · Q5 A — a missing home base is flagged before Save, set in
 * place on the phone, and the 409 safety net says one honest thing. The phone
 * has no test runner, so the rules its RoundTripSheet and Rig row run live
 * here.
 */

const BODY: BoundaryFlightsBody = {
  roundTrip: false,
  outbound: {
    name: "AS 2291 BOI→BLI",
    startsAt: "2026-10-10T14:05:00.000Z",
    endsAt: "2026-10-10T15:10:00.000Z",
    startsTz: "America/Boise",
    endsTz: "America/Los_Angeles",
    confirmationNumber: null,
    cost: null,
  },
  return: null,
};

describe("roundTripSavable — Save both flights waits for a home base (#142 · Q4 C)", () => {
  it("is false while the trip has no effective home base, even with a savable body", () => {
    expect(roundTripSavable({ homeBase: null }, BODY)).toBe(false);
  });
  it("is false while the body is not savable", () => {
    expect(roundTripSavable({ homeBase: "Boise, ID" }, null)).toBe(false);
  });
  it("is true with a home base and a savable body", () => {
    expect(roundTripSavable({ homeBase: "Boise, ID" }, BODY)).toBe(true);
  });
});

describe("isNoHomeBaseRefusal — the 409 safety net (#142)", () => {
  it("is true for the boundary-flights 409 no_home_base", () => {
    const e = new ApiError(409, "POST", "/api/trips/t1/boundary-flights", { error: "no_home_base" });
    expect(isNoHomeBaseRefusal(e)).toBe(true);
  });
  it("is false for any other 409", () => {
    const e = new ApiError(409, "POST", "/api/trips/t1/boundary-flights", { error: "segment_date_mismatch" });
    expect(isNoHomeBaseRefusal(e)).toBe(false);
  });
  it("is false for a non-409 carrying the same code, a network error, or nothing", () => {
    expect(isNoHomeBaseRefusal(new ApiError(400, "POST", "/x", { error: "no_home_base" }))).toBe(false);
    expect(isNoHomeBaseRefusal(new TypeError("Network request failed"))).toBe(false);
    expect(isNoHomeBaseRefusal(undefined)).toBe(false);
    expect(isNoHomeBaseRefusal(new ApiError(409, "POST", "/x", null))).toBe(false);
  });
  it("the copy is the one sentence — the glued “— those flights” is gone", () => {
    expect(NO_HOME_BASE_COPY).toBe("Set a home base first.");
    expect(NO_HOME_BASE_COPY).not.toContain("those flights");
  });
});

describe("the Rig screen's 🏠 Home base row (#142 · Q5 A)", () => {
  it("reads the household home base's name with a chevron", () => {
    expect(homeBaseRowValue({ homeBasePlace: { name: "Boise, ID", lat: 43.6, lng: -116.2, googlePlaceId: "g1" } })).toBe(
      "Boise, ID ›",
    );
  });
  it("reads “set one ›” when the household has none, or no prefs row at all", () => {
    expect(homeBaseRowValue({ homeBasePlace: null })).toBe("set one ›");
    expect(homeBaseRowValue({})).toBe("set one ›");
    expect(homeBaseRowValue(null)).toBe("set one ›");
  });

  it("a pick becomes the PUT /api/prefs { homeBasePlace } partial, shaped as a Place", () => {
    // The phone's search pick carries extras beyond a Place.
    const pick = {
      name: "Boise, ID",
      lat: 43.6,
      lng: -116.2,
      googlePlaceId: "g1",
      address: "Boise, ID, USA",
      primaryType: "locality",
    };
    const patch = householdHomeBasePatch(pick);
    expect(patch).toEqual({ homeBasePlace: { name: "Boise, ID", lat: 43.6, lng: -116.2, googlePlaceId: "g1" } });
    // The PUT body is `.strict()` — the partial must parse as-is.
    expect(userPrefsPatch.safeParse(patch).success).toBe(true);
  });
  it("an as-typed pick (no point) still writes a named home base", () => {
    expect(householdHomeBasePatch({ name: "Mom’s place", lat: null, lng: null, googlePlaceId: null })).toEqual({
      homeBasePlace: { name: "Mom’s place", lat: null, lng: null, googlePlaceId: null },
    });
  });
});
