import { describe, it, expect } from "vitest";
import {
  BLANK_TRIP_DRAFT,
  tripDayCount,
  tripDraftInput,
  tripSettingsDraft,
  tripSettingsPatch,
  tripCascadeCounts,
  chapterCascadeCounts,
  destinationCascadeCounts,
  cascadeLossSentence,
  destinationDatesDraft,
  destinationDatesHelp,
  destinationDatesPatch,
  unscheduleDestinationPatch,
  withTripMode,
  lodgingChoices,
  tripModeChoice,
  tripDefaultsPatch,
  type TripModeChoice,
  type TripSettingsDraft,
} from "./trip-form";
import { tripCreateInput, tripPatchInput, type Chapter, type Destination, type Trip } from "./types";

/** What the picker hands back for "Boise, ID" — a mapped pick. */
const BOISE = {
  name: "Boise, ID",
  lat: 43.615,
  lng: -116.2023,
  googlePlaceId: "ChIJnbRH",
  address: "Boise, ID, USA",
  rating: null,
  primaryType: null,
};

/** The trip the settings dialog opens over — the seed trip, unpinned. */
function fixture(over: Partial<Trip> = {}): Trip {
  return {
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
    defaultMode: "drive",
    lodgingDefault: null,
    rigOn: true,
    surfaceRadiusMi: null,
    ideas: [],
    chapters: [],
    segments: [],
    ...over,
  };
}

describe("tripDayCount", () => {
  it("counts both ends — the create form's '14 days' hint", () => {
    expect(tripDayCount("2026-09-20", "2026-10-04")).toBe(15);
    expect(tripDayCount("2026-08-01", "2026-08-28")).toBe(28);
  });

  it("is 1 for a single-day trip", () => {
    expect(tripDayCount("2026-09-20", "2026-09-20")).toBe(1);
  });

  it("is null when the range is backwards or incomplete", () => {
    expect(tripDayCount("2026-10-04", "2026-09-20")).toBeNull();
    expect(tripDayCount("", "2026-09-20")).toBeNull();
    expect(tripDayCount("2026-09-20", "not-a-date")).toBeNull();
  });
});

describe("tripDraftInput — /trips/new", () => {
  /** A road trip with its preselected answers — the page's state 2. */
  const ROAD = withTripMode(BLANK_TRIP_DRAFT, "road");

  it("builds the POST body the design shows", () => {
    expect(
      tripDraftInput({
        ...ROAD,
        title: "Redwoods Run",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
        homeBasePlace: BOISE,
      }),
    ).toEqual({
      title: "Redwoods Run",
      startDate: "2026-09-20",
      endDate: "2026-10-04",
      homeBase: "Boise, ID",
      homeBasePlace: { name: "Boise, ID", lat: 43.615, lng: -116.2023, googlePlaceId: "ChIJnbRH" },
      defaultMode: "drive",
      lodgingDefault: "campground",
      rigOn: true,
    });
  });

  it("trims, and no picked place is a null home base — the field is optional", () => {
    expect(
      tripDraftInput({
        ...ROAD,
        title: "  Redwoods Run  ",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
        homeBasePlace: null,
      }),
    ).toMatchObject({
      title: "Redwoods Run",
      startDate: "2026-09-20",
      endDate: "2026-10-04",
      homeBase: null,
      homeBasePlace: null,
    });
  });

  it("is null until the form is submittable", () => {
    expect(tripDraftInput(BLANK_TRIP_DRAFT)).toBeNull();
    expect(
      tripDraftInput({ ...ROAD, startDate: "2026-09-20", endDate: "2026-10-04" }),
    ).toBeNull(); // no title
    expect(
      tripDraftInput({ ...ROAD, title: "Redwoods Run", startDate: "2026-09-20", endDate: "" }),
    ).toBeNull(); // no end date
  });

  it("is null with no mode picked — the question the page opens on (#103)", () => {
    expect(
      tripDraftInput({
        ...BLANK_TRIP_DRAFT,
        title: "Redwoods Run",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
      }),
    ).toBeNull();
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      tripDraftInput({ ...ROAD, title: "Redwoods Run", startDate: "2026-10-04", endDate: "2026-09-20" }),
    ).toBeNull();
  });

  const filled = (mode: TripModeChoice) => ({
    ...withTripMode(BLANK_TRIP_DRAFT, mode),
    title: "T",
    startDate: "2027-01-16",
    endDate: "2027-01-25",
  });

  it("maps road / air / mixed to drive / fly / fly (Q2 A: a mix stores fly)", () => {
    expect(tripDraftInput(filled("road"))?.defaultMode).toBe("drive");
    expect(tripDraftInput(filled("air"))?.defaultMode).toBe("fly");
    expect(tripDraftInput(filled("mixed"))?.defaultMode).toBe("fly");
  });

  it("forces rigOn false off the road — a fly trip or a mix is never asked", () => {
    expect(tripDraftInput({ ...filled("air"), rigOn: true })?.rigOn).toBe(false);
    expect(tripDraftInput({ ...filled("mixed"), rigOn: true })?.rigOn).toBe(false);
    expect(tripDraftInput({ ...filled("road"), rigOn: false })?.rigOn).toBe(false);
    expect(tripDraftInput(filled("road"))?.rigOn).toBe(true);
  });

  it("preselects campgrounds + the rig for a road trip, hotels otherwise", () => {
    expect(withTripMode(BLANK_TRIP_DRAFT, "road")).toMatchObject({ lodgingDefault: "campground", rigOn: true });
    expect(withTripMode(BLANK_TRIP_DRAFT, "air")).toMatchObject({ lodgingDefault: "hotel", rigOn: false });
    expect(withTripMode(BLANK_TRIP_DRAFT, "mixed")).toMatchObject({ lodgingDefault: "hotel", rigOn: false });
  });

  it("orders the lodging cards by mode", () => {
    expect(lodgingChoices("road")).toEqual(["campground", "hotel", "airbnb", "friends"]);
    expect(lodgingChoices("air")).toEqual(["hotel", "airbnb", "friends", "campground"]);
  });

  it("every body parses under the API's own schema", () => {
    for (const m of ["road", "air", "mixed"] as const) {
      expect(tripCreateInput.safeParse(tripDraftInput(filled(m))).success).toBe(true);
    }
  });
});

describe("the three defaults in Trip settings (#103 · klunk row 7)", () => {
  it("reopens a fly trip — Greece's 'A mix' included — as Fly & stay", () => {
    expect(tripModeChoice("fly")).toBe("air");
    expect(tripModeChoice("drive")).toBe("road");
    const d = tripSettingsDraft(fixture({ defaultMode: "fly", lodgingDefault: "hotel", rigOn: false }));
    expect(d).toMatchObject({ mode: "air", lodgingDefault: "hotel", rigOn: false });
  });

  it("sends only what changed", () => {
    const t = fixture({ defaultMode: "fly", lodgingDefault: "hotel", rigOn: false });
    expect(tripSettingsPatch(t, tripSettingsDraft(t))).toEqual({});
    // "A mix" stores the same fly: not a change.
    expect(tripSettingsPatch(t, { ...tripSettingsDraft(t), mode: "mixed" })).toEqual({});
    expect(tripSettingsPatch(t, { ...tripSettingsDraft(t), mode: "road", rigOn: false })).toEqual({
      defaultMode: "drive",
    });
    expect(tripSettingsPatch(t, { ...tripSettingsDraft(t), lodgingDefault: "friends" })).toEqual({
      lodgingDefault: "friends",
    });
  });

  it("Road trip → Fly & stay also turns the rig off", () => {
    const t = fixture({ defaultMode: "drive", lodgingDefault: "campground", rigOn: true });
    expect(tripDefaultsPatch(t, { mode: "air", lodgingDefault: "campground", rigOn: true })).toEqual({
      defaultMode: "fly",
      rigOn: false,
    });
  });
});

describe("tripSettingsDraft", () => {
  it("reads an auto trip as Automatic, with nulls as empty fields", () => {
    expect(tripSettingsDraft(fixture())).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      // A pre-#60 trip has a name and no anchor: the picker opens on the name.
      homeBasePlace: {
        name: "Boise, ID",
        lat: null,
        lng: null,
        googlePlaceId: null,
        address: null,
        rating: null,
        primaryType: null,
      },
      status: "auto",
      rating: 0,
      note: "",
      mode: "road",
      lodgingDefault: null,
      rigOn: true,
    });
  });

  it("reads a pinned trip as its stored status", () => {
    const d = tripSettingsDraft(fixture({ statusAuto: false, status: "planning", rating: 4 }));
    expect(d.status).toBe("planning");
    expect(d.rating).toBe(4);
  });
});

const draftOf = (t: Trip, over: Partial<TripSettingsDraft> = {}): TripSettingsDraft => ({
  ...tripSettingsDraft(t),
  ...over,
});

describe("tripSettingsPatch — only what changed", () => {
  it("is empty when nothing was touched", () => {
    const t = fixture();
    expect(tripSettingsPatch(t, draftOf(t))).toEqual({});
  });

  it("sends only the field that changed", () => {
    const t = fixture();
    expect(tripSettingsPatch(t, draftOf(t, { endDate: "2026-08-30" }))).toEqual({
      endDate: "2026-08-30",
    });
  });

  it("clears home base and note to null, not to an empty string", () => {
    const t = fixture({ note: "Coast run" });
    expect(tripSettingsPatch(t, draftOf(t, { homeBasePlace: null, note: "" }))).toEqual({
      homeBase: null,
      homeBasePlace: null,
      note: null,
    });
  });

  it("pins the status as a pair when a status is chosen", () => {
    const t = fixture();
    expect(tripSettingsPatch(t, draftOf(t, { status: "complete" }))).toEqual({
      status: "complete",
      statusAuto: false,
    });
  });

  it("unpins with statusAuto alone — the stored status is left to the derivation", () => {
    const t = fixture({ statusAuto: false, status: "planning" });
    expect(tripSettingsPatch(t, draftOf(t, { status: "auto" }))).toEqual({ statusAuto: true });
  });

  it("does not re-send a pin that is already in place", () => {
    const t = fixture({ statusAuto: false, status: "planning" });
    expect(tripSettingsPatch(t, draftOf(t))).toEqual({});
  });

  it("zero stars clears the rating", () => {
    const t = fixture({ rating: 5 });
    expect(tripSettingsPatch(t, draftOf(t, { rating: 0 }))).toEqual({ rating: null });
  });

  it("drops a backwards range rather than sending it", () => {
    const t = fixture();
    expect(tripSettingsPatch(t, draftOf(t, { startDate: "2026-08-29" }))).toEqual({});
  });

  it("the patch it builds parses as a PATCH /api/trips/:id body", () => {
    const t = fixture();
    const patch = tripSettingsPatch(
      t,
      draftOf(t, { homeBasePlace: BOISE, rating: 3, note: "Good" }),
    );
    expect(patch).toEqual({
      homeBase: "Boise, ID",
      homeBasePlace: { name: "Boise, ID", lat: 43.615, lng: -116.2023, googlePlaceId: "ChIJnbRH" },
      rating: 3,
      note: "Good",
    });
    const parsed = tripPatchInput.safeParse(patch);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(patch);
  });
});

describe("tripCascadeCounts + cascadeLossSentence — the delete confirm names the loss", () => {
  const destinationOf = (id: string, res: number, ideas: number) => ({
    id,
    chapterId: "l1",
    place: { name: id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: Array.from({ length: res }, (_, i) => ({
      id: `${id}-r${i}`,
      destinationId: id,
      ideaId: null,
      type: "campground" as const,
      name: "res",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: null,
      rating: null,
      notes: null,
      segmentId: null,
      startsAt: null,
      endsAt: null,
      startsTz: null,
      endsTz: null,
      lodgingKind: null,
      transportKind: null,
      lastChange: null,
      again: null,
    })),
    ideas: Array.from({ length: ideas }, (_, i) => ({
      id: `${id}-i${i}`,
      tripId: "t1",
      destinationId: id,
      title: "idea",
      category: "do" as const,
      status: "idea" as const,
      place: null,
      rating: null,
      notes: null,
      sortOrder: i,
      lastChange: null,
      again: null,
    })),
    lastChange: null,
    again: null,
  });

  const peopled = fixture({
    chapters: [
      { id: "l1", tripId: "t1", title: "Oregon Coast", sortOrder: 0, destinations: [destinationOf("a", 2, 1), destinationOf("b", 1, 1)] },
      { id: "l2", tripId: "t1", title: "Cascades", sortOrder: 1, destinations: [] },
    ],
  });

  it("counts the whole tree", () => {
    expect(tripCascadeCounts(peopled)).toEqual({ chapters: 2, destinations: 2, reservations: 3, ideas: 2 });
  });

  it("writes the loss line the confirm shows", () => {
    expect(cascadeLossSentence(tripCascadeCounts(peopled))).toBe(
      "Its 2 chapters, 2 destinations, 3 reservations and 2 ideas are deleted with it. This can't be undone.",
    );
  });

  it("singulars are singular", () => {
    expect(cascadeLossSentence({ chapters: 1, destinations: 1, reservations: 1, ideas: 1 })).toBe(
      "Its 1 chapter, 1 destination, 1 reservation and 1 idea are deleted with it. This can't be undone.",
    );
  });

  it("omits what is not there", () => {
    expect(cascadeLossSentence({ chapters: 1, destinations: 0, reservations: 0, ideas: 0 })).toBe(
      "Its 1 chapter is deleted with it. This can't be undone.",
    );
  });

  it("an empty tree says only what is true", () => {
    expect(cascadeLossSentence({ chapters: 0, destinations: 0, reservations: 0, ideas: 0 })).toBe(
      "This can't be undone.",
    );
  });
});

describe("chapterCascadeCounts / destinationCascadeCounts — the other two confirms", () => {
  const idea = (id: string, destinationId: string, i: number) => ({
    id,
    tripId: "t1",
    destinationId,
    title: "idea",
    category: "do" as const,
    status: "idea" as const,
    place: null,
    rating: null,
    notes: null,
    sortOrder: i,
    lastChange: null,
    again: null,
  });
  const res = (id: string, destinationId: string) => ({
    id,
    destinationId,
    ideaId: null,
    type: "campground" as const,
    name: "res",
    checkIn: null,
    checkOut: null,
    confirmationNumber: null,
    cost: null,
    rating: null,
    notes: null,
    segmentId: null,
    startsAt: null,
    endsAt: null,
    startsTz: null,
    endsTz: null,
    lodgingKind: null,
    transportKind: null,
    lastChange: null,
    again: null,
  });
  const destinationOf = (id: string, resCount: number, ideaCount: number): Destination => ({
    id,
    chapterId: "l1",
    place: { name: id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: Array.from({ length: resCount }, (_, i) => res(`${id}-r${i}`, id)),
    ideas: Array.from({ length: ideaCount }, (_, i) => idea(`${id}-i${i}`, id, i)),
    lastChange: null,
    again: null,
  });
  const chapter: Chapter = {
    id: "l1",
    tripId: "t1",
    title: "Oregon Coast",
    sortOrder: 0,
    destinations: [destinationOf("Astoria, OR", 2, 1), destinationOf("Newport, OR", 1, 1)],
  };

  it("a chapter never counts itself — the sentence is about what goes WITH it", () => {
    expect(chapterCascadeCounts(chapter)).toEqual({ chapters: 0, destinations: 2, reservations: 3, ideas: 2 });
    expect(cascadeLossSentence(chapterCascadeCounts(chapter))).toBe(
      "Its 2 destinations, 3 reservations and 2 ideas are deleted with it. This can't be undone.",
    );
  });

  it("a destination counts only its own leaves", () => {
    expect(destinationCascadeCounts(destinationOf("Bend, OR", 1, 2))).toEqual({
      chapters: 0,
      destinations: 0,
      reservations: 1,
      ideas: 2,
    });
    expect(cascadeLossSentence(destinationCascadeCounts(destinationOf("Bend, OR", 1, 2)))).toBe(
      "Its 1 reservation and 2 ideas are deleted with it. This can't be undone.",
    );
  });

  it("a childless destination still confirms, it just has nothing to name", () => {
    expect(cascadeLossSentence(destinationCascadeCounts(destinationOf("Bend, OR", 0, 0)))).toBe(
      "This can't be undone.",
    );
  });
});

describe("the destination-dates dialog", () => {
  const destinationOf = (arriveDate: string | null, departDate: string | null): Destination => ({
    id: "s1",
    chapterId: "l1",
    place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
    arriveDate,
    departDate,
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
    again: null,
  });

  it("opens on the destination's dates, and on blanks for a floating destination", () => {
    expect(destinationDatesDraft(destinationOf("2026-08-12", "2026-08-16"))).toEqual({
      arriveDate: "2026-08-12",
      departDate: "2026-08-16",
    });
    expect(destinationDatesDraft(destinationOf(null, null))).toEqual({ arriveDate: "", departDate: "" });
  });

  it("writes the help line the design shows", () => {
    expect(destinationDatesHelp({ arriveDate: "2026-08-12", departDate: "2026-08-16" })).toBe(
      "5 days · Aug 12 is the drive day in",
    );
  });

  it("has no help line to write until both dates are a usable range", () => {
    expect(destinationDatesHelp({ arriveDate: "2026-08-12", departDate: "" })).toBeNull();
    expect(destinationDatesHelp({ arriveDate: "2026-08-16", departDate: "2026-08-12" })).toBeNull();
  });

  it("sends both dates, and only when they changed", () => {
    const destination = destinationOf("2026-08-12", "2026-08-16");
    expect(destinationDatesPatch(destination, { arriveDate: "2026-08-13", departDate: "2026-08-16" })).toEqual({
      arriveDate: "2026-08-13",
      departDate: "2026-08-16",
    });
    expect(destinationDatesPatch(destination, { arriveDate: "2026-08-12", departDate: "2026-08-16" })).toEqual({});
  });

  it("refuses a backwards or half-typed range — the Save button reads the same null", () => {
    const destination = destinationOf(null, null);
    expect(destinationDatesPatch(destination, { arriveDate: "2026-08-16", departDate: "2026-08-12" })).toBeNull();
    expect(destinationDatesPatch(destination, { arriveDate: "2026-08-12", departDate: "" })).toBeNull();
  });

  it("Unschedule is one patch setting BOTH dates to null", () => {
    expect(unscheduleDestinationPatch()).toEqual({ arriveDate: null, departDate: null });
  });
});
