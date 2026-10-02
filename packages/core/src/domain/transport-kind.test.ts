import { describe, it, expect } from "vitest";
import { costaRicaTrip } from "../seeds/index";
import {
  blankHopDraft,
  hopBookingClash,
  hopBookingInput,
  hopDraftZones,
  retimedSegment,
  shuttleBookingInput,
  shuttleDraftFromBooking,
  shuttleZone,
} from "./hops";
import { effectiveTransportKind, countsTowardClock } from "./transport-kind";
import { reservationRestoreInput } from "./leaf-form";
import { reservationCreateInput, reservationPatchInput, type Reservation } from "./types";

/**
 * #155 · Q4 A — `reservations.transport_kind`: what a transport booking IS.
 * Nullable, and null reads as the hop's own mode, so every row written before
 * #155 behaves exactly as it did. Only a flight or a ferry moves the hop's
 * clock; a shuttle never stretches it.
 */

const SEG = "6f1c5b4e-0000-4000-8000-0000000000b1";

const shuttle = (over: Partial<Reservation> = {}): Reservation => ({
  id: "res_shuttle",
  destinationId: null,
  segmentId: "seg_out",
  ideaId: null,
  type: "transport",
  name: "Airport shuttle · LIR → hotel",
  checkIn: null,
  checkOut: null,
  confirmationNumber: null,
  cost: null,
  rating: null,
  again: null,
  notes: null,
  startsAt: null,
  endsAt: null,
  startsTz: null,
  endsTz: null,
  lodgingKind: null,
  transportKind: "shuttle",
  lastChange: null,
  ...over,
});

describe("the write contract carries transportKind (vet HIGH)", () => {
  it("POST keeps it — `.pick()` would otherwise drop it and every shuttle would save as null", () => {
    const body = { segmentId: SEG, type: "transport", name: "Airport shuttle · LIR → hotel", transportKind: "shuttle" };
    const parsed = reservationCreateInput.parse(body);
    expect(parsed.transportKind).toBe("shuttle");
    // Omitted → null: a body from before #155 still parses, kind unset.
    expect(reservationCreateInput.parse({ ...body, transportKind: undefined }).transportKind).toBeNull();
  });

  it("PATCH keeps it, and an absent key stays absent", () => {
    expect(reservationPatchInput.parse({ transportKind: "train" })).toEqual({ transportKind: "train" });
    expect(reservationPatchInput.parse({ name: "x" })).not.toHaveProperty("transportKind");
    expect(reservationPatchInput.safeParse({ transportKind: "bus" }).success).toBe(false);
  });

  it("the Undo re-POST carries the kind back", () => {
    expect(reservationRestoreInput(shuttle()).transportKind).toBe("shuttle");
  });
});

describe("effective kind", () => {
  it("is the stored kind when set, and the hop's mode when null", () => {
    expect(effectiveTransportKind({ transportKind: "shuttle" }, "fly")).toBe("shuttle");
    expect(effectiveTransportKind({ transportKind: null }, "fly")).toBe("flight");
    expect(effectiveTransportKind({ transportKind: null }, "ferry")).toBe("ferry");
  });

  it("only flight and ferry count toward a layover or door to door", () => {
    expect(["flight", "ferry", "shuttle", "train", "car"].filter((k) => countsTowardClock(k as never))).toEqual([
      "flight",
      "ferry",
    ]);
  });
});

describe("retimedSegment ignores a timed shuttle (vet MED)", () => {
  it("the shuttle after LIR does not stretch seg_out's arrival", () => {
    const seg = costaRicaTrip().segments.find((s) => s.id === "seg_out")!;
    const late = shuttle({
      startsAt: "2027-01-17T00:15:00Z",
      startsTz: "America/Costa_Rica",
      endsAt: "2027-01-17T01:30:00Z",
      endsTz: "America/Costa_Rica",
    });
    const flights = seg.reservations.filter((r) => r.transportKind !== "shuttle");
    expect(retimedSegment(seg, [...flights, late])).toMatchObject({
      departAt: "2027-01-16T13:05:00.000Z",
      arriveAt: "2027-01-16T23:45:00.000Z",
    });
  });

  it("a hop with only a shuttle keeps the clock it has", () => {
    const home = costaRicaTrip().segments.find((s) => s.id === "seg_home")!;
    const early = shuttle({
      segmentId: "seg_home",
      startsAt: "2027-01-24T22:00:00Z",
      startsTz: "America/Costa_Rica",
      endsAt: "2027-01-24T23:00:00Z",
      endsTz: "America/Costa_Rica",
    });
    expect(retimedSegment(home, [early])).toBe(home);
  });

  it("so a timed shuttle can never raise a date clash", () => {
    const trip = costaRicaTrip();
    const late = {
      startsAt: "2027-01-19T00:15:00Z",
      startsTz: "America/Costa_Rica",
      endsAt: "2027-01-19T01:30:00Z",
      endsTz: "America/Costa_Rica",
      transportKind: "shuttle" as const,
    };
    expect(hopBookingClash(trip, "seg_out", late)).toBeNull();
  });
});

describe("the forms say what they book", () => {
  it("Add flight writes transportKind 'flight'", () => {
    const d = {
      ...blankHopDraft("flight"),
      label: "AA 1190",
      from: "LIR",
      to: "DFW",
      departs: "2027-01-24 19:30",
      arrives: "2027-01-24 23:55",
    };
    expect(hopBookingInput(SEG, d, hopDraftZones(d))?.transportKind).toBe("flight");
  });

  it("Add shuttle: the name is required, the times are optional", () => {
    expect(shuttleBookingInput(SEG, { name: "  ", departs: "", arrives: "" }, "America/Costa_Rica")).toBeNull();
    const untimed = shuttleBookingInput(SEG, { name: "Airport shuttle · LIR → hotel", departs: "", arrives: "" }, null);
    expect(untimed).toMatchObject({
      segmentId: SEG,
      type: "transport",
      transportKind: "shuttle",
      name: "Airport shuttle · LIR → hotel",
      startsAt: null,
      endsAt: null,
      startsTz: null,
      endsTz: null,
    });
    expect(reservationCreateInput.safeParse(untimed).success).toBe(true);
  });

  it("Add shuttle: a typed time is read in the hop's local zone, and needs one", () => {
    const timed = shuttleBookingInput(
      SEG,
      { name: "Airport shuttle", departs: "2027-01-16 18:15", arrives: "" },
      "America/Costa_Rica",
    );
    expect(timed).toMatchObject({ startsAt: "2027-01-17T00:15:00.000Z", startsTz: "America/Costa_Rica", endsAt: null });
    expect(reservationCreateInput.safeParse(timed).success).toBe(true);
    // No zone to read it in, or not a wall clock → not submittable.
    expect(shuttleBookingInput(SEG, { name: "x", departs: "2027-01-16 18:15", arrives: "" }, null)).toBeNull();
    expect(shuttleBookingInput(SEG, { name: "x", departs: "soon", arrives: "" }, "America/Costa_Rica")).toBeNull();
  });
});

describe("the shuttle form's zone and edit draft", () => {
  it("reads times in the hop's zone on the shuttle's side: the arrival out, the departure home", () => {
    const cr = costaRicaTrip();
    // seg_out is timed: it lands in America/Costa_Rica.
    expect(shuttleZone(cr, "seg_out")).toBe("America/Costa_Rica");
    expect(shuttleZone(cr, "seg_home")).toBe("America/Costa_Rica");
    // An untimed hop falls back to the zone near its destination's point.
    const untimed = {
      ...cr,
      segments: cr.segments.map((s) => ({ ...s, departAt: null, arriveAt: null, departTz: null, arriveTz: null })),
    };
    expect(shuttleZone(untimed, "seg_out")).toBe("America/Costa_Rica");
    expect(shuttleZone(cr, "nope")).toBeNull();
  });

  it("opens an edit on the booking's own name and local times", () => {
    expect(
      shuttleDraftFromBooking(
        shuttle({ startsAt: "2027-01-17T00:15:00Z", startsTz: "America/Costa_Rica" }),
      ),
    ).toEqual({ name: "Airport shuttle · LIR → hotel", departs: "2027-01-16 18:15", arrives: "" });
  });
});

