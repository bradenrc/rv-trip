import { describe, it, expect } from "vitest";
import {
  SAVE_SHEET_TYPES,
  applySavedPlacePatch,
  editPlacePatch,
  emptySavePlaceForm,
  graduateFormFromSaved,
  graduatePatch,
  pickPlace,
  regionFromAddress,
  savePlaceBody,
  savePlaceFormFromSaved,
  savedPlaceToCreate,
} from "./place-form";
import { savedPlaceCreate, savedPlacePatch } from "./types";
import type { SavedPlace } from "./types";
import type { PickedPlace } from "../providers/place-picker";

// The two sheets of docs/design/41 §5, as data. The JSX lives in
// apps/web/src/components/places/, which has no test runner; every decision the
// sheets make — what the picked place seeds, what the wire body looks like,
// what graduation clears — lives here, where vitest actually runs it.

const KALALOCH: PickedPlace = {
  name: "Kalaloch Campground",
  lat: 47.6118,
  lng: -124.3762,
  googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
  address: "156954 US-101, Forks, WA 98331",
  rating: 4.4,
};

const FREE_TEXT: PickedPlace = {
  name: "That gravel pullout",
  lat: null,
  lng: null,
  googlePlaceId: null,
  address: null,
  rating: null,
};

const TRIP_ID = "8c2b2c1e-6a4e-4f0e-9a0b-6f2b1d0a7c31";

const SAVED: SavedPlace = {
  id: "0f6d1f04-7a1c-4a05-9a9f-2f4c1c2f0a11",
  ownerId: "dev-user",
  place: {
    name: "Kalaloch Campground",
    lat: 47.6118,
    lng: -124.3762,
    googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
  },
  region: "Olympic NP, WA",
  type: "campground",
  status: "want",
  note: "Bluff sites right over the beach — they said book site A15 for the sunset.",
  source: "Jane & Rick",
  rating: null,
  tripId: null,
  tripName: null,
};

describe("regionFromAddress", () => {
  it("keeps the locality and the state, dropping the street and the ZIP", () => {
    // §5 draws Region as "from the address, editable". The address Google
    // returns for this very place is the §3 details payload.
    expect(regionFromAddress("156954 US-101, Forks, WA 98331")).toBe("Forks, WA");
  });

  it("passes a two-part address through", () => {
    expect(regionFromAddress("Bend, OR")).toBe("Bend, OR");
  });

  it("ignores a trailing country so the state still survives", () => {
    expect(regionFromAddress("1 Main St, Bend, OR 97701, USA")).toBe("Bend, OR");
  });

  it("falls back to the whole thing when there is only one part", () => {
    expect(regionFromAddress("Olympic National Park")).toBe("Olympic National Park");
  });

  it("has nothing to say about a missing or empty address", () => {
    expect(regionFromAddress(null)).toBeNull();
    expect(regionFromAddress("   ")).toBeNull();
  });
});

describe("the save sheet's category row", () => {
  it("offers one representative type per category, in the design's order", () => {
    // Stay · Eat · Do · Travel · Other — the sheet renders each through
    // categoryMeta, so it never defines its own icon or color.
    expect(SAVE_SHEET_TYPES).toEqual(["campground", "dining", "activity", "transport", "other"]);
  });
});

describe("pickPlace", () => {
  it("seeds the region from the address when the field is still empty", () => {
    const form = pickPlace(emptySavePlaceForm(), KALALOCH);
    expect(form.picked).toEqual(KALALOCH);
    expect(form.region).toBe("Forks, WA");
  });

  it("never clobbers a region the user typed", () => {
    const typed = { ...emptySavePlaceForm(), region: "Olympic NP, WA" };
    expect(pickPlace(typed, KALALOCH).region).toBe("Olympic NP, WA");
  });

  it("leaves the category alone — nothing on the wire carries Google's type", () => {
    // PickedPlace / PlaceSummary carry no `types`, so the sheet's default is
    // Other and the user picks. See docs/design/41/dev-notes.md.
    expect(pickPlace(emptySavePlaceForm(), KALALOCH).type).toBe("other");
  });

  it("keeps the typed region when the place is cleared", () => {
    const form = pickPlace({ ...emptySavePlaceForm(), region: "Bend, OR" }, null);
    expect(form.picked).toBeNull();
    expect(form.region).toBe("Bend, OR");
  });
});

describe("savePlaceBody", () => {
  it("is the wireframe's flat POST body, and it parses", () => {
    const form = {
      ...pickPlace(emptySavePlaceForm(), KALALOCH),
      type: "campground" as const,
      region: "Olympic NP, WA",
      source: "Jane & Rick",
      note: "Bluff sites right over the beach…",
    };
    const body = savePlaceBody(form);
    expect(body).toEqual({
      name: "Kalaloch Campground",
      region: "Olympic NP, WA",
      lat: 47.6118,
      lng: -124.3762,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      type: "campground",
      status: "want",
      source: "Jane & Rick",
      note: "Bluff sites right over the beach…",
      // A save is always a "want" row the user is describing; the rating and
      // the trip are the graduate sheet's, and a suggestion (which does post
      // them) is i6's payload, not this sheet's.
      rating: null,
      tripId: null,
    });
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
  });

  it("saves a coordless free-text place — the escape row is a legal save", () => {
    const body = savePlaceBody(pickPlace(emptySavePlaceForm(), FREE_TEXT));
    expect(body).toMatchObject({
      name: "That gravel pullout",
      lat: null,
      lng: null,
      googlePlaceId: null,
      region: null,
      source: null,
      note: null,
    });
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
  });

  it("blank optional fields go to the wire as null, not as empty strings", () => {
    const form = { ...pickPlace(emptySavePlaceForm(), KALALOCH), region: "  ", source: " ", note: "" };
    expect(savePlaceBody(form)).toMatchObject({ region: null, source: null, note: null });
  });

  it("has no body at all until a place is chosen", () => {
    expect(savePlaceBody(emptySavePlaceForm())).toBeNull();
  });
});

describe("savePlaceFormFromSaved / editPlacePatch", () => {
  it("round-trips a library row into the sheet and back out as a patch", () => {
    const form = savePlaceFormFromSaved(SAVED);
    expect(form.picked).toMatchObject({
      name: "Kalaloch Campground",
      lat: 47.6118,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
    });
    expect(form.region).toBe("Olympic NP, WA");
    expect(form.source).toBe("Jane & Rick");

    const patch = editPlacePatch({ ...form, note: "Book site A15." });
    expect(patch).toEqual({
      name: "Kalaloch Campground",
      region: "Olympic NP, WA",
      lat: 47.6118,
      lng: -124.3762,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      type: "campground",
      source: "Jane & Rick",
      note: "Book site A15.",
    });
    expect(savedPlacePatch.safeParse(patch).success).toBe(true);
  });

  it("never names status, rating or tripId — the shelf moves in the other sheet", () => {
    const patch = editPlacePatch(savePlaceFormFromSaved(SAVED))!;
    expect(Object.keys(patch)).not.toContain("status");
    expect(Object.keys(patch)).not.toContain("rating");
    expect(Object.keys(patch)).not.toContain("tripId");
  });
});

describe("the graduate sheet", () => {
  it("carries the queue note over, editable", () => {
    const form = graduateFormFromSaved(SAVED);
    expect(form.note).toBe(SAVED.note);
    expect(form.rating).toBe(0);
    expect(form.tripId).toBe("");
  });

  it("moves the same record: been + rating + trip, source cleared", () => {
    const patch = graduatePatch({ rating: 5, tripId: TRIP_ID, note: "Worth the drive." });
    expect(patch).toEqual({
      status: "been",
      rating: 5,
      tripId: TRIP_ID,
      note: "Worth the drive.",
      source: null,
    });
    expect(savedPlacePatch.safeParse(patch).success).toBe(true);
  });

  it("an unrated, trip-less graduation still moves the shelf", () => {
    expect(graduatePatch({ rating: 0, tripId: "", note: "" })).toEqual({
      status: "been",
      rating: null,
      tripId: null,
      note: null,
      source: null,
    });
  });
});

describe("applySavedPlacePatch — the island's echo of the write", () => {
  it("applies an edit and leaves every unnamed column alone", () => {
    const next = applySavedPlacePatch(SAVED, editPlacePatch(
      { ...savePlaceFormFromSaved(SAVED), region: "Kalaloch, WA", note: "" },
    )!);
    expect(next.region).toBe("Kalaloch, WA");
    expect(next.note).toBeNull();
    expect(next.status).toBe("want");
    expect(next.source).toBe("Jane & Rick");
    expect(next.rating).toBeNull();
    expect(next.place).toEqual(SAVED.place);
  });

  it("graduates the same record: one row, source gone, trip named", () => {
    const next = applySavedPlacePatch(
      SAVED,
      graduatePatch({ rating: 5, tripId: TRIP_ID, note: "Worth the drive." }),
      "Pacific Northwest Loop",
    );
    expect(next.id).toBe(SAVED.id);
    expect(next.status).toBe("been");
    expect(next.rating).toBe(5);
    expect(next.tripId).toBe(TRIP_ID);
    expect(next.tripName).toBe("Pacific Northwest Loop");
    expect(next.source).toBeNull();
  });

  it("keeps the joined trip name when the patch does not name a trip", () => {
    const been = { ...SAVED, status: "been" as const, tripId: TRIP_ID, tripName: "Coast" };
    expect(applySavedPlacePatch(been, { note: "Again." }).tripName).toBe("Coast");
  });
});

describe("savedPlaceToCreate — the undo toast's re-save", () => {
  it("flattens a deleted row back into a create body, keeping the shelf", () => {
    const been: SavedPlace = {
      ...SAVED,
      status: "been",
      source: null,
      rating: 5,
      tripId: TRIP_ID,
      tripName: "Pacific Northwest Loop",
    };
    const body = savedPlaceToCreate(been);
    expect(body).toEqual({
      name: "Kalaloch Campground",
      region: "Olympic NP, WA",
      lat: 47.6118,
      lng: -124.3762,
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      type: "campground",
      status: "been",
      note: SAVED.note,
      source: null,
      rating: 5,
      tripId: TRIP_ID,
    });
    // `tripName` is joined on read and never written.
    expect(Object.keys(body)).not.toContain("tripName");
    expect(savedPlaceCreate.safeParse(body).success).toBe(true);
  });
});
