import { describe, it, expect } from "vitest";
import {
  BLANK_TRIP_DRAFT,
  tripDayCount,
  tripDraftInput,
  tripSettingsDraft,
  tripSettingsPatch,
  tripCascadeCounts,
  cascadeLossSentence,
  type TripSettingsDraft,
} from "./trip-form";
import { tripPatchInput, type Trip } from "./types";

/** The trip the settings dialog opens over — the seed trip, unpinned. */
function fixture(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    legs: [],
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
  it("builds the POST body the design shows", () => {
    expect(
      tripDraftInput({
        title: "Redwoods Run",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
        homeBase: "Boise, ID",
      }),
    ).toEqual({
      title: "Redwoods Run",
      startDate: "2026-09-20",
      endDate: "2026-10-04",
      homeBase: "Boise, ID",
    });
  });

  it("trims, and an empty home base is null — the field is optional", () => {
    expect(
      tripDraftInput({
        title: "  Redwoods Run  ",
        startDate: "2026-09-20",
        endDate: "2026-10-04",
        homeBase: "   ",
      }),
    ).toEqual({
      title: "Redwoods Run",
      startDate: "2026-09-20",
      endDate: "2026-10-04",
      homeBase: null,
    });
  });

  it("is null until the form is submittable", () => {
    expect(tripDraftInput(BLANK_TRIP_DRAFT)).toBeNull();
    expect(
      tripDraftInput({ ...BLANK_TRIP_DRAFT, startDate: "2026-09-20", endDate: "2026-10-04" }),
    ).toBeNull(); // no title
    expect(
      tripDraftInput({ title: "Redwoods Run", startDate: "2026-09-20", endDate: "", homeBase: "" }),
    ).toBeNull(); // no end date
  });

  it("refuses a range that ends before it starts", () => {
    expect(
      tripDraftInput({
        title: "Redwoods Run",
        startDate: "2026-10-04",
        endDate: "2026-09-20",
        homeBase: "",
      }),
    ).toBeNull();
  });
});

describe("tripSettingsDraft", () => {
  it("reads an auto trip as Automatic, with nulls as empty fields", () => {
    expect(tripSettingsDraft(fixture())).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      homeBase: "Boise, ID",
      status: "auto",
      rating: 0,
      note: "",
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
    expect(tripSettingsPatch(t, draftOf(t, { homeBase: "  ", note: "" }))).toEqual({
      homeBase: null,
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
    const patch = tripSettingsPatch(t, draftOf(t, { homeBase: "Bend, OR", rating: 3, note: "Good" }));
    expect(patch).toEqual({ homeBase: "Bend, OR", rating: 3, note: "Good" });
    const parsed = tripPatchInput.safeParse(patch);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(patch);
  });
});

describe("tripCascadeCounts + cascadeLossSentence — the delete confirm names the loss", () => {
  const stopOf = (id: string, res: number, ideas: number) => ({
    id,
    legId: "l1",
    place: { name: id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: Array.from({ length: res }, (_, i) => ({
      id: `${id}-r${i}`,
      stopId: id,
      ideaId: null,
      type: "campground" as const,
      name: "res",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: null,
      rating: null,
      notes: null,
    })),
    ideas: Array.from({ length: ideas }, (_, i) => ({
      id: `${id}-i${i}`,
      stopId: id,
      title: "idea",
      status: "idea" as const,
      place: null,
      rating: null,
      notes: null,
      sortOrder: i,
    })),
  });

  const peopled = fixture({
    legs: [
      { id: "l1", tripId: "t1", title: "Oregon Coast", sortOrder: 0, stops: [stopOf("a", 2, 1), stopOf("b", 1, 1)] },
      { id: "l2", tripId: "t1", title: "Cascades", sortOrder: 1, stops: [] },
    ],
  });

  it("counts the whole tree", () => {
    expect(tripCascadeCounts(peopled)).toEqual({ legs: 2, stops: 2, reservations: 3, ideas: 2 });
  });

  it("writes the loss line the confirm shows", () => {
    expect(cascadeLossSentence(tripCascadeCounts(peopled))).toBe(
      "Its 2 legs, 2 stops, 3 reservations and 2 ideas are deleted with it. This can't be undone.",
    );
  });

  it("singulars are singular", () => {
    expect(cascadeLossSentence({ legs: 1, stops: 1, reservations: 1, ideas: 1 })).toBe(
      "Its 1 leg, 1 stop, 1 reservation and 1 idea are deleted with it. This can't be undone.",
    );
  });

  it("omits what is not there", () => {
    expect(cascadeLossSentence({ legs: 1, stops: 0, reservations: 0, ideas: 0 })).toBe(
      "Its 1 leg is deleted with it. This can't be undone.",
    );
  });

  it("an empty tree says only what is true", () => {
    expect(cascadeLossSentence({ legs: 0, stops: 0, reservations: 0, ideas: 0 })).toBe(
      "This can't be undone.",
    );
  });
});
