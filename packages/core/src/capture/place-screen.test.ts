import { describe, expect, it } from "vitest";
import { savedPlace, type SavedPlace } from "../domain/types";
import type { PlaceDetails } from "../providers/index";
import {
  DELETE_OFFLINE_TOAST,
  EDIT_OFFLINE_NOTICE,
  RESTORED_TOAST,
  placeGoogleLine,
  removedToast,
  placeScreenMeta,
  placeSourceLine,
  placeTelUrl,
  placeTripLine,
  saveForJournalEntry,
} from "./place-screen";

/** #197 · #193 — the phone Place screen's copy (docs/design/197 §2 frames 1–4). */

const save = (over: Record<string, unknown>): SavedPlace =>
  savedPlace.parse({
    id: "s1",
    ownerId: "o",
    place: { name: "Aslan Brewing Co." },
    type: "dining",
    rating: null,
    ...over,
  });

const AREA = { id: "a1", name: "Bellingham, WA", region: "Washington", googlePlaceId: "ChIJbham" };

describe("placeScreenMeta — the mono line under the name", () => {
  it("is the category word and the area", () => {
    expect(placeScreenMeta(save({ area: AREA, anchor: "place" }))).toBe("Eat · Bellingham, WA");
    expect(placeScreenMeta(save({ type: "activity", area: AREA, anchor: "pin" }))).toBe("Do · Bellingham, WA");
  });

  it("falls back to the note's own area label, then the region, then the word alone", () => {
    expect(placeScreenMeta(save({ anchor: "area", areaLabel: "Bend, OR" }))).toBe("Eat · Bend, OR");
    expect(placeScreenMeta(save({ region: "Olympic NP, WA" }))).toBe("Eat · Olympic NP, WA");
    expect(placeScreenMeta(save({ anchor: "area" }))).toBe("Eat");
  });
});

describe("placeSourceLine — the faded mono line at the foot of Yours", () => {
  it("names who the tip came from", () => {
    expect(placeSourceLine(save({ source: "Jane & Rick" }))).toBe("from Jane & Rick");
  });

  it("dates a dropped pin by the local day it was captured", () => {
    const at = new Date(2026, 10, 13, 9, 30).toISOString();
    expect(placeSourceLine(save({ anchor: "pin", createdAt: at }))).toBe("dropped pin · Nov 13");
    expect(placeSourceLine(save({ anchor: "pin" }))).toBe("dropped pin");
  });

  it("is null for a Google place or a note with no source", () => {
    expect(placeSourceLine(save({ anchor: "place" }))).toBeNull();
    expect(placeSourceLine(save({ anchor: "area" }))).toBeNull();
  });
});

describe("placeTripLine — the accent trip link", () => {
  it("is the trip's name and its span, when the trip is known", () => {
    const s = save({ tripId: "t1", tripName: "Bellingham" });
    expect(placeTripLine(s, { startDate: "2026-11-11", endDate: "2026-11-15" })).toBe("Bellingham · Nov 11–15 →");
    expect(placeTripLine(s, { startDate: "2026-10-30", endDate: "2026-11-02" })).toBe("Bellingham · Oct 30–Nov 2 →");
    expect(placeTripLine(s, null)).toBe("Bellingham →");
  });

  it("is null with no trip", () => {
    expect(placeTripLine(save({}), null)).toBeNull();
  });
});

const DETAILS: PlaceDetails = {
  googlePlaceId: "ChIJaslan",
  name: "Aslan Brewing Co.",
  location: null,
  rating: 4.6,
  address: null,
  userRatingCount: 1284,
  websiteUri: null,
  nationalPhoneNumber: null,
  googleMapsUri: null,
};

describe("placeGoogleLine — Google's rating, never mistaken for ours", () => {
  it("reads G ★ rating · count reviews", () => {
    expect(placeGoogleLine(DETAILS)).toBe("G ★ 4.6 · 1,284 reviews");
    expect(placeGoogleLine({ ...DETAILS, userRatingCount: 1 })).toBe("G ★ 4.6 · 1 review");
    expect(placeGoogleLine({ ...DETAILS, userRatingCount: 1234567 })).toBe("G ★ 4.6 · 1,234,567 reviews");
  });

  it("drops what Google did not say", () => {
    expect(placeGoogleLine({ ...DETAILS, userRatingCount: null })).toBe("G ★ 4.6");
    expect(placeGoogleLine({ ...DETAILS, rating: null })).toBe("G · 1,284 reviews");
    expect(placeGoogleLine({ ...DETAILS, rating: null, userRatingCount: null })).toBe("G");
  });
});

describe("placeTelUrl — Call", () => {
  it("dials the digits, assuming +1 for a national number", () => {
    expect(placeTelUrl("(360) 778-2088")).toBe("tel:+13607782088");
    expect(placeTelUrl("+44 20 7946 0958")).toBe("tel:+442079460958");
  });
});

describe("#194 · the Edit and Delete copy (docs/design/197 §3 frames 5–8)", () => {
  it("says what Delete removed, by name (frame 6)", () => {
    expect(removedToast("Aslan Brewing Co.")).toEqual({ title: "Removed Aslan Brewing Co.", sub: null });
  });

  it("says what Undo put back (frame 7)", () => {
    expect(RESTORED_TOAST).toEqual({ title: "Restored, with its rating, note and shelf", sub: null });
  });

  it("refuses offline: Delete's toast and Edit's sheet line (frame 8)", () => {
    expect(DELETE_OFFLINE_TOAST).toEqual({ title: "Deleting needs a connection", sub: null });
    expect(EDIT_OFFLINE_NOTICE).toBe("Editing needs a connection. Nothing is saved offline.");
  });
});

describe("saveForJournalEntry — #195 · a Journal entry's way into its Place (frame 11)", () => {
  const aslan = save({ id: "s-aslan", place: { name: "Aslan Brewing Co.", lat: 48.75, lng: -122.48 } });
  const koa = save({ id: "s-koa", type: "campground", place: { name: "Astoria/Warrenton KOA" } });

  it("finds the save whose name matches, by isAlreadySaved's normalized-name rule", () => {
    expect(saveForJournalEntry({ name: "Aslan Brewing Co." }, [koa, aslan])?.id).toBe("s-aslan");
    expect(saveForJournalEntry({ name: "  aslan brewing co " }, [koa, aslan])?.id).toBe("s-aslan");
  });

  it("matches by name only — a save's coordinates never rule an entry out (the entry has none)", () => {
    expect(saveForJournalEntry({ name: "Astoria/Warrenton KOA" }, [aslan, koa])?.id).toBe("s-koa");
  });

  it("is null when nothing in Places matches, or Places has not loaded", () => {
    expect(saveForJournalEntry({ name: "Whatcom Falls walk" }, [aslan, koa])).toBeNull();
    expect(saveForJournalEntry({ name: "Aslan Brewing Co." }, null)).toBeNull();
    expect(saveForJournalEntry({ name: "Aslan Brewing Co." }, [])).toBeNull();
  });

  it("takes the first match in library order when two saves share a name", () => {
    const again = save({ id: "s-aslan-2", place: { name: "Aslan Brewing Co." } });
    expect(saveForJournalEntry({ name: "Aslan Brewing Co." }, [again, aslan])?.id).toBe("s-aslan-2");
  });
});
