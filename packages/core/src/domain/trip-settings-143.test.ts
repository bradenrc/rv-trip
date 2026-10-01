import { describe, it, expect } from "vitest";
import { phoneTripSettingsDraft, phoneTripSettingsPatch } from "./trip-form";
import { tripPatchInput, type Trip } from "./types";

/**
 * #143 · Q8 A — the phone's "Trip settings": Destination · Dates · Starts from
 * above the three defaults. Save sends only what changed; status, rating and
 * note are never part of it (they stay web-only).
 */

const BLI = {
  name: "Bellingham, WA",
  lat: 48.75,
  lng: -122.48,
  googlePlaceId: "ChIJbli",
  address: null,
  rating: null,
  primaryType: null,
};
const BOI_AIRPORT = { ...BLI, name: "Boise Airport (BOI)", googlePlaceId: "ChIJboi", lat: 43.56, lng: -116.22 };

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific NW Loop",
    homeBase: "Boise, ID",
    homeBasePlace: { name: "Boise, ID", lat: 43.615, lng: -116.2023, googlePlaceId: "ChIJnbRH" },
    homeBaseFromHousehold: true,
    destination: { id: "d1", name: "Oregon Coast & Cascades", googlePlaceId: "ChIJore", lat: 44, lng: -123 },
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: false,
    rating: 4,
    note: "keep",
    defaultMode: "drive",
    lodgingDefault: "campground",
    rigOn: true,
    surfaceRadiusMi: null,
    ideas: [],
    legs: [],
    segments: [],
    ...over,
  };
}

describe("phoneTripSettingsDraft / phoneTripSettingsPatch", () => {
  it("opens on the trip and saves nothing when nothing moved", () => {
    const t = trip();
    const d = phoneTripSettingsDraft(t);
    expect(d.destination?.name).toBe("Oregon Coast & Cascades");
    expect(d.homeBasePlace?.name).toBe("Boise, ID");
    expect(d).toMatchObject({ startDate: "2026-08-01", endDate: "2026-08-28", mode: "road" });
    expect(phoneTripSettingsPatch(t, d)).toEqual({});
  });

  it("sends a newly picked destination as the picked place", () => {
    const t = trip();
    const patch = phoneTripSettingsPatch(t, { ...phoneTripSettingsDraft(t), destination: BLI });
    expect(patch).toEqual({
      destination: { name: "Bellingham, WA", googlePlaceId: "ChIJbli", lat: 48.75, lng: -122.48 },
    });
    expect(tripPatchInput.parse(patch)).toEqual(patch);
  });

  it("clears the destination with null; a pick with no Google id is not a change", () => {
    const t = trip();
    expect(phoneTripSettingsPatch(t, { ...phoneTripSettingsDraft(t), destination: null })).toEqual({
      destination: null,
    });
    const freeText = { ...BLI, googlePlaceId: null, lat: null, lng: null };
    expect(phoneTripSettingsPatch(t, { ...phoneTripSettingsDraft(t), destination: freeText })).toEqual({});
    // A trip with no destination and nothing picked stays that way.
    const bare = trip({ destination: null });
    expect(phoneTripSettingsPatch(bare, phoneTripSettingsDraft(bare))).toEqual({});
  });

  it("sends only the dates that changed, and never a backwards range", () => {
    const t = trip();
    const d = phoneTripSettingsDraft(t);
    expect(phoneTripSettingsPatch(t, { ...d, endDate: "2026-08-20" })).toEqual({ endDate: "2026-08-20" });
    expect(phoneTripSettingsPatch(t, { ...d, endDate: "2026-07-01" })).toEqual({});
  });

  it("Starts from: a pick writes this trip's override; 'Use household default' sends null", () => {
    const t = trip();
    const picked = phoneTripSettingsPatch(t, { ...phoneTripSettingsDraft(t), homeBasePlace: BOI_AIRPORT });
    expect(picked).toEqual({
      homeBase: "Boise Airport (BOI)",
      homeBasePlace: { name: "Boise Airport (BOI)", lat: 43.56, lng: -116.22, googlePlaceId: "ChIJboi" },
    });

    const own = trip({
      homeBaseFromHousehold: false,
      homeBase: "Boise Airport (BOI)",
      homeBasePlace: { name: "Boise Airport (BOI)", lat: 43.56, lng: -116.22, googlePlaceId: "ChIJboi" },
    });
    expect(phoneTripSettingsPatch(own, { ...phoneTripSettingsDraft(own), homeBasePlace: null })).toEqual({
      homeBase: null,
      homeBasePlace: null,
    });
  });

  it("folds in the three defaults and never touches status, rating or note", () => {
    const t = trip();
    const patch = phoneTripSettingsPatch(t, {
      ...phoneTripSettingsDraft(t),
      mode: "air",
      lodgingDefault: "hotel",
    });
    expect(patch).toEqual({ defaultMode: "fly", lodgingDefault: "hotel", rigOn: false });
    for (const k of ["status", "statusAuto", "rating", "note"]) expect(patch).not.toHaveProperty(k);
  });
});
