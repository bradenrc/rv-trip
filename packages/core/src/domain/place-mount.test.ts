import { describe, it, expect } from "vitest";
import {
  homeBaseColumns,
  homeBasePatch,
  homeBasePlaceOf,
  placeOf,
  stopPatchColumns,
  stopPlaceCreate,
  stopPlacePatch,
} from "./place-form";
import { ideaDraftInput, ideaPlace } from "./leaf-form";
import { stopCreateInput, stopPatchInput, tripPatchInput, type Trip } from "./types";
import { nearLabel, nearOf, pickedFromPlace, type PickedPlace } from "../providers/place-picker";
import { routeSummary } from "../planner/index";

/**
 * Issue #60 — mounting the place picker in the planner.
 *
 * The four new mounts are React and have no test runner, so every DECISION
 * they make lives in `packages/core` and is pinned here: what a pick posts,
 * what it patches, which key wins when a body carries two, how the nested
 * `place` on the wire becomes the flat columns drizzle's `.set()` wants, and
 * what the rail's new unmapped count and its Locate rows are counted from.
 */

const LEG = "6f1b6d0e-6d3b-4d9e-9d1f-6a0a7b2c3d4e";

const CAPE: PickedPlace = {
  name: "Cape Lookout State Park",
  lat: 45.3612,
  lng: -123.9707,
  googlePlaceId: "ChIJlXc1RkoPlVQR",
  address: "13000 Whiskey Creek Rd W, Tillamook, OR 97141",
  rating: 4.7,
};

/** What the picker's free-text escape row emits. */
const ROGUE: PickedPlace = {
  name: "rogue ales brewery",
  lat: null,
  lng: null,
  googlePlaceId: null,
  address: null,
  rating: null,
};

describe("placeOf — the picked place as the grammar's Place", () => {
  it("keeps the four persisted fields and drops Google's display-only pair", () => {
    expect(placeOf(CAPE)).toEqual({
      name: "Cape Lookout State Park",
      lat: 45.3612,
      lng: -123.9707,
      googlePlaceId: "ChIJlXc1RkoPlVQR",
    });
  });

  it("trims the name — the escape row reads the query back exactly as typed", () => {
    expect(placeOf({ ...ROGUE, name: "  rogue ales brewery  " }).name).toBe("rogue ales brewery");
  });
});

describe("stopPlaceCreate — Add stop IS the pick", () => {
  it("posts the name, the coordinates and the place id in ONE write", () => {
    const body = stopPlaceCreate(LEG, CAPE);
    expect(body).toEqual({
      legId: LEG,
      place: {
        name: "Cape Lookout State Park",
        lat: 45.3612,
        lng: -123.9707,
        googlePlaceId: "ChIJlXc1RkoPlVQR",
      },
      arriveDate: null,
      departDate: null,
    });
    expect(stopCreateInput.safeParse(body).success).toBe(true);
  });

  it("a coordless escape pick is a legal create — honestly coordless", () => {
    const body = stopPlaceCreate(LEG, ROGUE)!;
    expect(body.place).toEqual({
      name: "rogue ales brewery",
      lat: null,
      lng: null,
      googlePlaceId: null,
    });
    expect(stopCreateInput.safeParse(body).success).toBe(true);
  });

  it("is null on an empty name — the same null the draft row is dismissed on", () => {
    expect(stopPlaceCreate(LEG, { ...ROGUE, name: "   " })).toBeNull();
  });
});

describe("stopPlacePatch — Change place… / Set place", () => {
  it("sends the whole place as one key, and parses as a PATCH body", () => {
    const patch = stopPlacePatch(CAPE)!;
    expect(patch).toEqual({ place: placeOf(CAPE) });
    const parsed = stopPatchInput.safeParse(patch);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(patch);
  });

  it("never sends half a coordinate — the pair travels with the name", () => {
    const patch = stopPlacePatch({ ...CAPE, lng: null })!;
    expect(patch.place).toEqual({
      name: "Cape Lookout State Park",
      lat: 45.3612,
      lng: null,
      googlePlaceId: "ChIJlXc1RkoPlVQR",
    });
    // …and the picker itself already renders that as coordless, so what the
    // row says and what the map can draw agree.
  });

  it("is null on an empty name", () => {
    expect(stopPlacePatch({ ...ROGUE, name: "" })).toBeNull();
  });
});

describe("stopPatchColumns — the handler's flattening", () => {
  it("turns the nested place into the three columns updateStopFields writes", () => {
    expect(stopPatchColumns(stopPatchInput.parse(stopPlacePatch(CAPE)))).toEqual({
      placeName: "Cape Lookout State Park",
      lat: 45.3612,
      lng: -123.9707,
      googlePlaceId: "ChIJlXc1RkoPlVQR",
    });
  });

  it("leaves every other key exactly where it was", () => {
    expect(
      stopPatchColumns({ arriveDate: "2026-08-09", departDate: null, legId: LEG, sortOrder: 2 }),
    ).toEqual({ arriveDate: "2026-08-09", departDate: null, legId: LEG, sortOrder: 2 });
  });

  it("passes a bare rename straight through — `placeName` still works alone", () => {
    expect(stopPatchColumns({ placeName: "Newport, OR" })).toEqual({ placeName: "Newport, OR" });
  });

  /** The #60 vet's MED: `updateStopFields` spreads a flat object into `.set()`,
   * so without this the answer would be decided by key order. */
  it("the whole place OUTRANKS placeName when a body carries both", () => {
    expect(
      stopPatchColumns({ placeName: "a typo nobody wants", place: placeOf(CAPE) }),
    ).toEqual({
      placeName: "Cape Lookout State Park",
      lat: 45.3612,
      lng: -123.9707,
      googlePlaceId: "ChIJlXc1RkoPlVQR",
    });
  });

  it("a coordless place explicitly NULLS the coordinates a row used to have", () => {
    expect(stopPatchColumns({ place: placeOf(ROGUE) })).toEqual({
      placeName: "rogue ales brewery",
      lat: null,
      lng: null,
      googlePlaceId: null,
    });
  });

  it("an empty patch stays empty — a legal no-op, never `.set({})`", () => {
    expect(stopPatchColumns({})).toEqual({});
  });
});

describe("home base — one object on the wire, three columns underneath", () => {
  it("the name and the anchor travel together", () => {
    expect(homeBasePatch(CAPE)).toEqual({
      homeBase: "Cape Lookout State Park",
      homeBasePlace: placeOf(CAPE),
    });
  });

  it("a cleared picker clears BOTH — never a name with a stale anchor", () => {
    expect(homeBasePatch(null)).toEqual({ homeBase: null, homeBasePlace: null });
    expect(homeBasePatch({ ...ROGUE, name: "  " })).toEqual({
      homeBase: null,
      homeBasePlace: null,
    });
  });

  it("parses as a PATCH /api/trips/:id body", () => {
    const parsed = tripPatchInput.safeParse(homeBasePatch(CAPE));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.homeBasePlace).toEqual(placeOf(CAPE));
  });

  it("flattens onto the three nullable columns, and back", () => {
    expect(homeBaseColumns(placeOf(CAPE))).toEqual({
      homeBaseLat: 45.3612,
      homeBaseLng: -123.9707,
      homeBasePlaceId: "ChIJlXc1RkoPlVQR",
    });
    expect(homeBaseColumns(null)).toEqual({
      homeBaseLat: null,
      homeBaseLng: null,
      homeBasePlaceId: null,
    });
  });

  /** The read half. Without it `trip.homeBasePlace` is silently always null and
   * the first stop of a leg has no search bias — the #60 vet's HIGH. */
  it("reads back as one place, and as null for a pre-#60 row", () => {
    expect(
      homeBasePlaceOf({
        homeBase: "Boise, ID",
        homeBaseLat: 43.615,
        homeBaseLng: -116.2023,
        homeBasePlaceId: "ChIJnbRH",
      }),
    ).toEqual({
      name: "Boise, ID",
      lat: 43.615,
      lng: -116.2023,
      googlePlaceId: "ChIJnbRH",
    });
    expect(
      homeBasePlaceOf({
        homeBase: "Boise, ID",
        homeBaseLat: null,
        homeBaseLng: null,
        homeBasePlaceId: null,
      }),
    ).toBeNull();
    expect(
      homeBasePlaceOf({
        homeBase: null,
        homeBaseLat: null,
        homeBaseLng: null,
        homeBasePlaceId: null,
      }),
    ).toBeNull();
  });
});

describe("ideaDraftInput — the picker on Add idea is optional", () => {
  it("still returns place: null when nothing was picked", () => {
    expect(ideaDraftInput("11111111-2222-4333-8444-555566667777", "Cape Perpetua overlook")?.place)
      .toBeNull();
  });

  it("attaches the picked place when there is one", () => {
    expect(
      ideaDraftInput("11111111-2222-4333-8444-555566667777", "Cape Perpetua overlook", CAPE)?.place,
    ).toEqual(placeOf(CAPE));
  });

  it("a place without a title is not an idea", () => {
    expect(ideaDraftInput("11111111-2222-4333-8444-555566667777", "   ", CAPE)).toBeNull();
  });

  it("ideaPlace drops an empty pick rather than storing a nameless place", () => {
    expect(ideaPlace(null)).toBeNull();
    expect(ideaPlace({ ...ROGUE, name: " " })).toBeNull();
    expect(ideaPlace(ROGUE)).toEqual(placeOf(ROGUE));
  });
});

describe("pickedFromPlace / nearOf — what the mounted picker opens on, and where it looks", () => {
  it("seeds the controlled value from a stored place, with no Google display fields", () => {
    expect(pickedFromPlace({ name: "Newport, OR", lat: 44.6083, lng: -124.064, googlePlaceId: null }))
      .toEqual({
        name: "Newport, OR",
        lat: 44.6083,
        lng: -124.064,
        googlePlaceId: null,
        address: null,
        rating: null,
      });
    expect(pickedFromPlace(null)).toBeNull();
  });

  it("biases to the first candidate with a FULL pair — the stop above, else home base", () => {
    const previous = { name: "Newport, OR", lat: 44.6083, lng: -124.064 };
    const home = { name: "Boise, ID", lat: 43.615, lng: -116.2023 };
    expect(nearOf(previous, home)).toEqual(previous);
    expect(nearOf(null, home)).toEqual(home);
    // Half a coordinate is no coordinate here too: it falls through.
    expect(nearOf({ name: "Half a pin", lat: 44.6083, lng: null }, home)).toEqual(home);
    expect(nearOf(null, null)).toBeNull();
  });

  it("says where it is looking, in the picker's own coordinate typography", () => {
    expect(nearLabel({ name: "Newport, OR", lat: 44.6083, lng: -124.064 })).toBe(
      "near · Newport, OR · 44.6083, \u2212124.0640",
    );
  });
});

describe("routeSummary — the rail counts the stops it cannot draw", () => {
  const stopOf = (id: string, name: string, lat: number | null, lng: number | null) => ({
    id,
    legId: "l1",
    place: { name, lat, lng, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
  });

  const trip = (): Trip => ({
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    homeBasePlace: null,
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    legs: [
      {
        id: "l1",
        tripId: "t1",
        title: "Oregon Coast",
        sortOrder: 0,
        stops: [
          stopOf("s1", "Newport, OR", 44.6083, -124.064),
          stopOf("s2", "rogue ales brewery", null, null),
          stopOf("s3", "New stop", null, null),
        ],
      },
    ],
  });

  it("counts them, and names them for Locate", () => {
    const s = routeSummary(trip());
    expect(s.unmapped).toBe(2);
    expect(s.unmappedStops).toEqual([
      { id: "s2", name: "rogue ales brewery" },
      { id: "s3", name: "New stop" },
    ]);
  });

  it("is 0 and empty when every stop is mapped — the rail draws nothing", () => {
    const t = trip();
    t.legs[0]!.stops = [stopOf("s1", "Newport, OR", 44.6083, -124.064)];
    const s = routeSummary(t);
    expect(s.unmapped).toBe(0);
    expect(s.unmappedStops).toEqual([]);
  });

  it("half a coordinate still counts as unmapped", () => {
    const t = trip();
    t.legs[0]!.stops = [stopOf("s1", "Half a pin", 44.6083, null)];
    expect(routeSummary(t).unmapped).toBe(1);
  });
});
