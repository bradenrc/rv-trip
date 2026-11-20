import { describe, it, expect } from "vitest";
import {
  BUSINESS_CARD_COPY,
  businessCard,
  businessTapAction,
  localityOfAddress,
} from "./business-tap";
import { savedPlace, type SavedPlace } from "./types";

// #201 · docs/design/202 §1–§2: tap a business on the Google basemap → the
// pin card offers Save, or Open → when the library already holds that place.

function save(id: string, name: string, extra: Partial<SavedPlace> = {}): SavedPlace {
  return savedPlace.parse({
    id,
    ownerId: "dev-household",
    place: { name, lat: null, lng: null, googlePlaceId: null },
    type: "dining",
    rating: null,
    lastChange: null,
    again: null,
    ...extra,
  });
}

const FORT_GEORGE = save("s_fortgeorge", "Fort George Brewery", {
  place: { name: "Fort George Brewery", lat: 46.1886, lng: -123.8306, googlePlaceId: "ChIJ_fortgeorge" },
  status: "been",
});
const KOA = save("s_koa", "Astoria/Warrenton KOA", {
  place: { name: "Astoria/Warrenton KOA", lat: 46.1564, lng: -123.8865, googlePlaceId: null },
  type: "campground",
});
const LIBRARY = [KOA, FORT_GEORGE];

describe("businessTapAction — Save vs Open → by Google place id", () => {
  it("a tapped id the library holds → Open, with that save", () => {
    const a = businessTapAction({ googlePlaceId: "ChIJ_fortgeorge", name: null }, LIBRARY);
    expect(a).toEqual({ kind: "open", save: FORT_GEORGE });
  });

  it("an id the library does not hold → Save", () => {
    expect(businessTapAction({ googlePlaceId: "ChIJ_pelican", name: "Pelican Brewing" }, LIBRARY)).toEqual({
      kind: "save",
    });
  });

  it("an empty library → Save", () => {
    expect(businessTapAction({ googlePlaceId: "ChIJ_fortgeorge", name: "Fort George Brewery" }, [])).toEqual({
      kind: "save",
    });
  });

  it("the id match wins over an earlier same-name row (isAlreadySaved rule 1 first)", () => {
    const twin = save("s_twin", "Fort George Brewery", {
      place: { name: "Fort George Brewery", lat: null, lng: null, googlePlaceId: null },
    });
    const a = businessTapAction({ googlePlaceId: "ChIJ_fortgeorge", name: "Fort George Brewery" }, [twin, FORT_GEORGE]);
    expect(a).toEqual({ kind: "open", save: FORT_GEORGE });
  });

  it("falls back to isAlreadySaved's name rule once the name is known (same name, within 150 m)", () => {
    const a = businessTapAction(
      { googlePlaceId: "ChIJ_koa", name: "Astoria/Warrenton KOA", lat: 46.1565, lng: -123.8866 },
      LIBRARY,
    );
    expect(a).toEqual({ kind: "open", save: KOA });
  });

  it("a tap with no name yet matches by id alone (the KOA has no Google id → Save)", () => {
    expect(businessTapAction({ googlePlaceId: "ChIJ_koa", name: null, lat: 46.1565, lng: -123.8866 }, LIBRARY)).toEqual({
      kind: "save",
    });
  });
});

describe("localityOfAddress", () => {
  it("is the town, without the state, the ZIP or the country", () => {
    expect(localityOfAddress("33180 Cape Kiwanda Dr, Pacific City, OR 97135, USA")).toBe("Pacific City");
    expect(localityOfAddress("1483 Duane St, Astoria, OR 97103, USA")).toBe("Astoria");
  });

  it("is null with no address", () => {
    expect(localityOfAddress(null)).toBeNull();
    expect(localityOfAddress("")).toBeNull();
  });
});

describe("businessCard — the card a tapped business raises", () => {
  it("not saved: the Google name, the town, Save", () => {
    const card = businessCard(
      {
        googlePlaceId: "ChIJ_pelican",
        name: "Pelican Brewing",
        address: "33180 Cape Kiwanda Dr, Pacific City, OR 97135, USA",
      },
      LIBRARY,
    );
    expect(card).toEqual({
      googlePlaceId: "ChIJ_pelican",
      name: "Pelican Brewing",
      area: "Pacific City",
      type: "other",
      action: { kind: "save" },
    });
  });

  it("the tile follows Google's primaryType when the tap carries one", () => {
    const card = businessCard({ googlePlaceId: "ChIJ_p", name: "Pelican Brewing", primaryType: "restaurant" }, []);
    expect(card?.type).toBe("dining");
  });

  it("saved: the save's own name and type, Open →", () => {
    const card = businessCard(
      { googlePlaceId: "ChIJ_fortgeorge", name: null, address: "1483 Duane St, Astoria, OR 97103, USA" },
      LIBRARY,
    );
    expect(card).toEqual({
      googlePlaceId: "ChIJ_fortgeorge",
      name: "Fort George Brewery",
      area: "Astoria",
      type: "dining",
      action: { kind: "open", save: FORT_GEORGE },
    });
  });

  it("saved with no address yet: the save's area or region is the line", () => {
    const withRegion = { ...FORT_GEORGE, region: "Astoria, OR" };
    const card = businessCard({ googlePlaceId: "ChIJ_fortgeorge", name: null }, [withRegion]);
    expect(card?.area).toBe("Astoria, OR");
  });

  it("a phone POI name keeps its first line (Android labels can wrap)", () => {
    const card = businessCard({ googlePlaceId: "ChIJ_p", name: "Pelican Brewing\nPacific City" }, []);
    expect(card?.name).toBe("Pelican Brewing");
  });

  it("nothing names it (no details, not saved) → no card", () => {
    expect(businessCard({ googlePlaceId: "ChIJ_unknown", name: null }, LIBRARY)).toBeNull();
    expect(businessCard({ googlePlaceId: "ChIJ_unknown", name: "  " }, LIBRARY)).toBeNull();
  });

  it("the card's words are the wireframe's", () => {
    expect(BUSINESS_CARD_COPY).toEqual({ tag: "Google place", save: "Save", open: "Open →", saved: "saved" });
  });
});
