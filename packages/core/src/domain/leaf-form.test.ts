import { describe, it, expect } from "vitest";
import {
  BLANK_RESERVATION_DRAFT,
  UNDO_WINDOW_MS,
  ideaDraftInput,
  ideaRestoreInput,
  reservationCost,
  reservationDraft,
  reservationDraftInput,
  reservationDraftPatch,
  reservationRestoreInput,
  type ReservationDraft,
} from "./leaf-form";
import {
  ideaCreateInput,
  reservationCreateInput,
  reservationPatchInput,
  type Idea,
  type Reservation,
} from "./types";

const STOP = "6f1c5b4e-0000-4000-8000-000000000001";

/** The reservation the design's undo toast is holding: "Rogue Ales brewery
 * lunch", promoted from an idea and rated. */
function res(over: Partial<Reservation> = {}): Reservation {
  return {
    id: "r1",
    stopId: STOP,
    ideaId: null,
    type: "dining",
    name: "Rogue Ales brewery lunch",
    checkIn: "2026-08-18",
    checkOut: null,
    confirmationNumber: null,
    cost: 64,
    rating: 4,
    notes: "Sit outside.",
    ...over,
  };
}

function ideaFixture(over: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    stopId: STOP,
    title: "Rogue Ales brewery lunch",
    status: "planned",
    place: null,
    rating: null,
    notes: "Ask about the tour.",
    sortOrder: 2,
    ...over,
  };
}

describe("reservationCost", () => {
  it("reads an empty field as 'no cost recorded', not zero", () => {
    expect(reservationCost("")).toBeNull();
    expect(reservationCost("   ")).toBeNull();
  });

  it("reads a number, including a free one", () => {
    expect(reservationCost("204")).toBe(204);
    expect(reservationCost("38.50")).toBe(38.5);
    expect(reservationCost("0")).toBe(0);
  });

  it("is undefined — not null — for anything that is not a cost", () => {
    // undefined is what disables Save; null would silently save "no cost".
    expect(reservationCost("abc")).toBeUndefined();
    expect(reservationCost("-5")).toBeUndefined();
  });
});

describe("reservationDraftInput — the add form's POST body", () => {
  it("sends every field on the core reservation schema", () => {
    const draft: ReservationDraft = {
      type: "campground",
      name: "Astoria/Warrenton KOA",
      checkIn: "2026-08-02",
      checkOut: "2026-08-05",
      confirmationNumber: "KOA-88213",
      cost: "204",
    };
    expect(reservationDraftInput(STOP, draft)).toEqual({
      stopId: STOP,
      type: "campground",
      name: "Astoria/Warrenton KOA",
      checkIn: "2026-08-02",
      checkOut: "2026-08-05",
      confirmationNumber: "KOA-88213",
      cost: 204,
      rating: null,
      notes: null,
    });
  });

  it("is a body the API's own schema accepts", () => {
    const body = reservationDraftInput(STOP, {
      ...BLANK_RESERVATION_DRAFT,
      name: "Columbia River Maritime Museum",
      type: "activity",
    });
    expect(reservationCreateInput.safeParse(body).success).toBe(true);
  });

  it("leaves the optional fields null when the form is bare", () => {
    expect(
      reservationDraftInput(STOP, { ...BLANK_RESERVATION_DRAFT, name: "Fort Stevens" }),
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

  it("is null — the same null that disables Save — when it is not submittable", () => {
    const ok = { ...BLANK_RESERVATION_DRAFT, name: "Fort Stevens" };
    expect(reservationDraftInput(STOP, BLANK_RESERVATION_DRAFT)).toBeNull();
    expect(reservationDraftInput(STOP, { ...ok, name: "   " })).toBeNull();
    expect(reservationDraftInput(STOP, { ...ok, cost: "free" })).toBeNull();
    // check-out before check-in
    expect(
      reservationDraftInput(STOP, { ...ok, checkIn: "2026-08-05", checkOut: "2026-08-02" }),
    ).toBeNull();
    // a check-out with no check-in is not a stay
    expect(reservationDraftInput(STOP, { ...ok, checkOut: "2026-08-02" })).toBeNull();
  });

  it("accepts a check-in with no check-out — a dinner is one date", () => {
    expect(
      reservationDraftInput(STOP, {
        ...BLANK_RESERVATION_DRAFT,
        type: "dining",
        name: "Rogue Ales",
        checkIn: "2026-08-18",
      })?.checkOut,
    ).toBeNull();
  });
});

describe("reservationDraft / reservationDraftPatch — the edit form", () => {
  it("opens on the row it is editing", () => {
    expect(reservationDraft(res())).toEqual({
      type: "dining",
      name: "Rogue Ales brewery lunch",
      checkIn: "2026-08-18",
      checkOut: "",
      confirmationNumber: "",
      cost: "64",
    });
  });

  it("sends ONLY what changed — an untouched field is left alone", () => {
    const r = res();
    const patch = reservationDraftPatch(r, { ...reservationDraft(r), name: "Rogue Ales lunch" });
    expect(patch).toEqual({ name: "Rogue Ales lunch" });
  });

  it("is {} when nothing moved", () => {
    const r = res();
    expect(reservationDraftPatch(r, reservationDraft(r))).toEqual({});
  });

  it("clears a field back to null rather than to an empty string", () => {
    const r = res();
    const patch = reservationDraftPatch(r, { ...reservationDraft(r), checkIn: "", cost: "" });
    expect(patch).toEqual({ checkIn: null, cost: null });
    expect(reservationPatchInput.safeParse(patch).success).toBe(true);
  });

  it("is null when the draft is not submittable, so a bad date can't ride along", () => {
    const r = res();
    expect(
      reservationDraftPatch(r, { ...reservationDraft(r), name: "ok", cost: "later" }),
    ).toBeNull();
  });
});

describe("reservationRestoreInput — what Undo re-POSTs", () => {
  it("carries every field of the deleted row, rating and notes included", () => {
    const r = res();
    expect(reservationRestoreInput(r)).toEqual({
      stopId: STOP,
      type: "dining",
      name: "Rogue Ales brewery lunch",
      checkIn: "2026-08-18",
      checkOut: null,
      confirmationNumber: null,
      cost: 64,
      rating: 4,
      notes: "Sit outside.",
    });
    expect(reservationCreateInput.safeParse(reservationRestoreInput(r)).success).toBe(true);
  });
});

describe("ideaDraftInput / ideaRestoreInput", () => {
  it("creates an idea from just a title", () => {
    expect(ideaDraftInput(STOP, "  Cape Perpetua overlook  ")).toEqual({
      stopId: STOP,
      title: "Cape Perpetua overlook",
      status: "idea",
      place: null,
      rating: null,
      notes: null,
    });
  });

  it("is null on an empty title", () => {
    expect(ideaDraftInput(STOP, "   ")).toBeNull();
  });

  it("restores a deleted idea with its status, rating and note intact", () => {
    const body = ideaRestoreInput(ideaFixture());
    expect(body).toEqual({
      stopId: STOP,
      title: "Rogue Ales brewery lunch",
      status: "planned",
      place: null,
      rating: null,
      notes: "Ask about the tour.",
    });
    expect(ideaCreateInput.safeParse(body).success).toBe(true);
  });
});

describe("UNDO_WINDOW_MS", () => {
  it("is the design's six-second window", () => {
    expect(UNDO_WINDOW_MS).toBe(6000);
  });
});
