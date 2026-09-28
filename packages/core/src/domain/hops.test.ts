import { describe, it, expect } from "vitest";
import { costaRicaTrip, greeceTrip, pnwTrip } from "../seeds/index";
import {
  applyHopBooking,
  blankHopDraft,
  fixHopDraftDates,
  hopBookingClash,
  hopBookingInput,
  hopClashCopy,
  hopDraftZones,
  retimedSegment,
  setSegmentMode,
} from "./hops";
import { reservationCreateInput, type Reservation } from "./types";
import { drivePairs } from "./route-order";

const SEG_UUID = "6f1c5b4e-0000-4000-8000-0000000000b1";

describe("retimedSegment — the hop's clock follows its bookings", () => {
  it("departs with the earliest booking and lands with the latest (the seed's seg_out)", () => {
    const seg = costaRicaTrip().segments.find((s) => s.id === "seg_out")!;
    const untimed = { ...seg, departAt: null, arriveAt: null, departTz: null, arriveTz: null };
    expect(retimedSegment(untimed, seg.reservations)).toMatchObject({
      departAt: "2027-01-16T13:05:00.000Z",
      departTz: "America/Boise",
      arriveAt: "2027-01-16T23:45:00.000Z",
      arriveTz: "America/Costa_Rica",
    });
  });

  it("keeps the clock it has when nothing on it is timed", () => {
    const home = costaRicaTrip().segments.find((s) => s.id === "seg_home")!;
    expect(retimedSegment(home, [])).toBe(home);
  });
});

describe("the Add flight form (#104)", () => {
  const redeye = { ...blankHopDraft("flight"), label: "AA 1190", from: "LIR", to: "DFW" };

  it("fills the zones from the codes — green only when the table knew them", () => {
    const z = hopDraftZones(redeye);
    expect(z.from).toEqual({ zone: "America/Costa_Rica", verified: true, code: "LIR" });
    expect(z.to).toEqual({ zone: "America/Chicago", verified: true, code: "DFW" });
    const unknown = hopDraftZones({ ...redeye, to: "XYZ" });
    expect(unknown.to).toEqual({ zone: null, verified: false, code: "XYZ" });
    // A picked zone fills the chip but is never "verified".
    expect(hopDraftZones({ ...redeye, to: "XYZ", toZone: "America/Denver" }).to).toEqual({
      zone: "America/Denver",
      verified: false,
      code: "XYZ",
    });
  });

  it("builds the segment-parented body in local time", () => {
    const d = { ...redeye, departs: "2027-01-24 19:30", arrives: "2027-01-24 23:55" };
    const body = hopBookingInput(SEG_UUID, d, hopDraftZones(d));
    expect(body).toMatchObject({
      segmentId: SEG_UUID,
      type: "transport",
      name: "AA 1190 LIR→DFW",
      startsAt: "2027-01-25T01:30:00.000Z",
      startsTz: "America/Costa_Rica",
      endsAt: "2027-01-25T05:55:00.000Z",
      endsTz: "America/Chicago",
    });
    expect(reservationCreateInput.safeParse(body).success).toBe(true);
  });

  it("is null (Save disabled) until both ends have a zone", () => {
    const d = { ...redeye, to: "XYZ", departs: "2027-01-24 19:30", arrives: "2027-01-24 23:55" };
    expect(hopBookingInput(SEG_UUID, d, hopDraftZones(d))).toBeNull();
    const picked = { ...d, toZone: "America/Chicago" };
    expect(hopBookingInput(SEG_UUID, picked, hopDraftZones(picked))).not.toBeNull();
  });

  it("a ferry's zone comes from its port stops", () => {
    const gr = greeceTrip();
    const stops = gr.legs.flatMap((l) => l.stops);
    const myk = stops.find((s) => s.id === "stp_mykonos")!;
    const nax = stops.find((s) => s.id === "stp_naxos")!;
    const d = {
      ...blankHopDraft("ferry", { from: "Mykonos", to: "Naxos" }),
      label: "SeaJets",
      departs: "2027-05-16 10:30",
      arrives: "2027-05-16 11:15",
    };
    const z = hopDraftZones(d, { from: myk.place, to: nax.place });
    expect(z.from.zone).toBe("Europe/Athens");
    expect(hopBookingInput(SEG_UUID, d, z)?.name).toBe("SeaJets Mykonos→Naxos");
  });
});

describe("the date clash (Q8 A)", () => {
  const redeye23 = {
    startsAt: "2027-01-24T01:30:00.000Z", // 01/23 19:30 in Costa Rica
    startsTz: "America/Costa_Rica",
    endsAt: "2027-01-24T05:55:00.000Z",
    endsTz: "America/Chicago",
  };

  it("names the stop and both dates, before any POST", () => {
    const clash = hopBookingClash(costaRicaTrip(), "seg_home", redeye23)!;
    expect(clash).toMatchObject({
      side: "checkout",
      stopId: "stp_conchal",
      conflict: { segmentId: "seg_home", expected: "2027-01-24", actual: "2027-01-23" },
    });
    expect(hopClashCopy(clash, "flight")).toEqual({
      headline: "This flight leaves 01/23, but Westin Reserva Conchal runs to 01/24.",
      sub: "Stop dates win, so nothing is saved until they agree.",
      move: "Check out of Westin Reserva Conchal on 01/23 instead",
      keep: "Keep the stop, and fix the flight date",
    });
  });

  it("is quiet when the flight agrees with the stop", () => {
    expect(
      hopBookingClash(costaRicaTrip(), "seg_home", {
        ...redeye23,
        startsAt: "2027-01-25T01:30:00.000Z",
        endsAt: "2027-01-25T05:55:00.000Z",
      }),
    ).toBeNull();
  });

  it("has check-in copy for a hop INTO a stop (vet MED a)", () => {
    // seg_out with its seeded flights taken off, so the new one alone times it.
    const cr = costaRicaTrip();
    const bare = { ...cr, segments: cr.segments.map((s) => ({ ...s, reservations: [] })) };
    const clash = hopBookingClash(bare, "seg_out", {
      startsAt: "2027-01-15T13:05:00.000Z",
      startsTz: "America/Boise",
      endsAt: "2027-01-15T23:45:00.000Z",
      endsTz: "America/Costa_Rica",
    })!;
    expect(clash.side).toBe("checkin");
    expect(hopClashCopy(clash, "flight").move).toBe("Check in to Westin Reserva Conchal on 01/15 instead");
  });

  it("'Keep the stop' rewrites the form's dates and nothing else", () => {
    const clash = hopBookingClash(costaRicaTrip(), "seg_home", redeye23)!;
    const d = { ...blankHopDraft("flight"), departs: "2027-01-23 19:30", arrives: "2027-01-23 23:55" };
    expect(fixHopDraftDates(d, clash)).toMatchObject({ departs: "2027-01-24 19:30", arrives: "2027-01-24 23:55" });
  });

  it("'Check out … instead' moves the stop AND its own stay (vet MED c)", () => {
    const r: Reservation = {
      id: "r_new",
      stopId: null,
      segmentId: "seg_home",
      ideaId: null,
      type: "transport",
      name: "AA 1190 LIR→DFW",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: null,
      rating: null,
      notes: null,
      lodgingKind: null,
      lastChange: null,
      again: null,
      ...redeye23,
    };
    const next = applyHopBooking(costaRicaTrip(), r, true);
    const conchal = next.legs[0]!.stops[0]!;
    expect(conchal.departDate).toBe("2027-01-23");
    expect(conchal.reservations.find((x) => x.id === "res_westin")?.checkOut).toBe("2027-01-23");
    expect(next.segments.find((s) => s.id === "seg_home")?.reservations).toHaveLength(1);
  });
});

describe("setSegmentMode — the switch", () => {
  it("drops the pair out of drivePairs when a drive hop flies", () => {
    const pnw = pnwTrip();
    const hop = pnw.segments.find((s) => s.fromStopId === "stp_astoria")!;
    expect(drivePairs(pnw).some((p) => p.fromStopId === "stp_astoria")).toBe(true);
    const flown = setSegmentMode(pnw, hop.id, "fly");
    expect(drivePairs(flown).some((p) => p.fromStopId === "stp_astoria")).toBe(false);
  });

  it("a hop switched back to Drive drops its clock", () => {
    const gr = greeceTrip();
    const next = setSegmentMode(gr, "seg_jmk_jnx", "drive");
    expect(next.segments.find((s) => s.id === "seg_jmk_jnx")).toMatchObject({ mode: "drive", departAt: null });
  });
});
