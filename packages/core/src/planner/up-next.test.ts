import { describe, expect, it } from "vitest";
import type { Destination, Reservation, Segment, Trip } from "../domain/types";
import { pnwTrip } from "../seeds/index";
import { upNext, upNextThenLine } from "./up-next";

/**
 * #178 · #181 i3 — the wireframe's Up next table, over the two worked trips:
 * the Pacific Northwest Loop (Astoria Aug 2–5 · Newport Aug 5–9 · Bend
 * Aug 12–16, untimed drives) and Bellingham (Seattle Nov 11–12 · Blaine
 * Nov 12–15 · SeaTac Rental Car Facility Nov 15, untimed drives, then the
 * SEA → BOI flight at 6:10 PM). America/Los_Angeles is -07:00 in August and
 * -08:00 in November.
 *
 * A drive's kind is asserted with `.kind).toBe("drive")`, not inside an
 * object literal: w0-reset.test.ts bans that literal pairing repo-wide
 * (it guards DayKind, which this is not).
 */
const LA = "America/Los_Angeles";

function res(r: Pick<Reservation, "id" | "type" | "name"> & Partial<Reservation>): Reservation {
  return {
    destinationId: null,
    segmentId: null,
    ideaId: null,
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
    transportKind: null,
    lastChange: null,
    ...r,
  };
}

function patchRes(trip: Trip, id: string, patch: Partial<Reservation>): Trip {
  return {
    ...trip,
    chapters: trip.chapters.map((c) => ({
      ...c,
      destinations: c.destinations.map((d) => ({
        ...d,
        reservations: d.reservations.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      })),
    })),
  };
}

function loop(): Trip {
  let t = pnwTrip();
  t = patchRes(t, "res_koa", { endsAt: "2026-08-05T11:00:00-07:00", endsTz: LA });
  t = patchRes(t, "res_southbeach", {
    startsAt: "2026-08-05T16:00:00-07:00",
    startsTz: LA,
    endsAt: "2026-08-09T11:00:00-07:00",
    endsTz: LA,
  });
  return t;
}

function dest(d: Pick<Destination, "id" | "place" | "arriveDate" | "departDate" | "sortOrder"> & Partial<Destination>): Destination {
  return {
    chapterId: "ch_bham",
    rating: null,
    again: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
    ...d,
  };
}

function seg(s: Pick<Segment, "id" | "fromDestinationId" | "toDestinationId" | "mode" | "sortOrder"> & Partial<Segment>): Segment {
  return {
    tripId: "trip_bham",
    departAt: null,
    arriveAt: null,
    departTz: null,
    arriveTz: null,
    reservations: [],
    ...s,
  };
}

function bellingham(): Trip {
  const seattle = dest({
    id: "d_sea",
    place: { name: "Seattle, WA", lat: 47.6062, lng: -122.3321, googlePlaceId: null },
    arriveDate: "2026-11-11",
    departDate: "2026-11-12",
    sortOrder: 0,
  });
  const blaine = dest({
    id: "d_blaine",
    place: { name: "Blaine, WA", lat: 48.9937, lng: -122.7471, googlePlaceId: null },
    arriveDate: "2026-11-12",
    departDate: "2026-11-15",
    sortOrder: 1,
    reservations: [
      res({
        id: "r_airbnb",
        destinationId: "d_blaine",
        type: "lodging",
        lodgingKind: "airbnb",
        name: "Semiahmoo Airbnb",
        checkIn: "2026-11-12",
        checkOut: "2026-11-15",
        endsAt: "2026-11-15T11:00:00-08:00",
        endsTz: LA,
      }),
    ],
  });
  const seatac = dest({
    id: "d_seatac",
    place: { name: "SeaTac Rental Car Facility", lat: 47.4436, lng: -122.2961, googlePlaceId: null },
    arriveDate: "2026-11-15",
    departDate: "2026-11-15",
    sortOrder: 2,
  });
  return {
    id: "trip_bham",
    ownerId: "o",
    title: "Bellingham",
    homeBase: "Boise, ID",
    homeBasePlace: null,
    startDate: "2026-11-11",
    endDate: "2026-11-15",
    status: "upcoming",
    statusAuto: true,
    rating: null,
    note: null,
    defaultMode: "drive",
    lodgingDefault: null,
    rigOn: false,
    surfaceRadiusMi: null,
    ideas: [],
    chapters: [{ id: "ch_bham", tripId: "trip_bham", title: null, sortOrder: 0, destinations: [seattle, blaine, seatac] }],
    segments: [
      seg({
        id: "s_in",
        fromDestinationId: null,
        toDestinationId: "d_sea",
        mode: "fly",
        sortOrder: 0,
        departAt: "2026-11-11T08:00:00-07:00",
        departTz: "America/Boise",
        arriveAt: "2026-11-11T08:30:00-08:00",
        arriveTz: LA,
      }),
      seg({ id: "s_sea_blaine", fromDestinationId: "d_sea", toDestinationId: "d_blaine", mode: "drive", sortOrder: 1 }),
      seg({ id: "s_blaine_seatac", fromDestinationId: "d_blaine", toDestinationId: "d_seatac", mode: "drive", sortOrder: 2 }),
      seg({
        id: "s_home",
        fromDestinationId: "d_seatac",
        toDestinationId: null,
        mode: "fly",
        sortOrder: 3,
        reservations: [
          res({
            id: "r_flight",
            segmentId: "s_home",
            type: "transport",
            transportKind: "flight",
            name: "SEA → BOI",
            startsAt: "2026-11-15T18:10:00-08:00",
            startsTz: LA,
            endsAt: "2026-11-15T21:05:00-07:00",
            endsTz: "America/Boise",
          }),
        ],
      }),
    ],
  };
}

describe("upNext (#178 · the wireframe's table)", () => {
  it("Aug 5 09:00 PDT → check out of the KOA today, then the drive to Newport", () => {
    const u = upNext(loop(), new Date("2026-08-05T09:00:00-07:00"), "2026-08-05")!;
    expect(u.next).toMatchObject({
      kind: "check-out",
      title: "Check out of Astoria/Warrenton KOA",
      when: "TODAY · OUT BY 11:00 AM",
      date: "2026-08-05",
      sameDay: true,
      segmentId: null,
      navTo: null,
    });
    expect(u.then?.kind).toBe("drive");
    expect(u.then).toMatchObject({ title: "Drive to Newport, OR", when: "TODAY" });
    expect(u.then!.navTo).toEqual({ lat: 44.6365, lng: -124.053 });
  });

  it("Aug 7 14:00 → South Beach's check-out on Sunday, and nothing after it that day", () => {
    const u = upNext(loop(), new Date("2026-08-07T14:00:00-07:00"), "2026-08-07")!;
    expect(u.next).toMatchObject({
      kind: "check-out",
      title: "Check out of South Beach State Park",
      when: "SUN AUG 9 · OUT BY 11:00 AM",
      sameDay: false,
    });
    expect(u.then).toBeNull();
  });

  it("Aug 10 10:00 → the drive to Bend on Wednesday, with somewhere to navigate to", () => {
    const u = upNext(loop(), new Date("2026-08-10T10:00:00-07:00"), "2026-08-10")!;
    expect(u.next?.kind).toBe("drive");
    expect(u.next).toMatchObject({ title: "Drive to Bend, OR", when: "WED AUG 12", date: "2026-08-12" });
    expect(u.next.navTo).toEqual({ lat: 44.0582, lng: -121.3153 });
    expect(u.next.segmentId).toMatch(/^seg_pnw_/);
  });

  it("Nov 14 19:00 PST → the Airbnb check-out, then the drive to SeaTac", () => {
    const u = upNext(bellingham(), new Date("2026-11-14T19:00:00-08:00"), "2026-11-14")!;
    expect(u.next).toMatchObject({
      kind: "check-out",
      title: "Check out of Semiahmoo Airbnb",
      when: "SUN NOV 15 · OUT BY 11:00 AM",
    });
    expect(u.then?.kind).toBe("drive");
    expect(u.then).toMatchObject({ title: "Drive to SeaTac Rental Car Facility", segmentId: "s_blaine_seatac" });
  });

  it("Nov 15 12:30 PST → the drive today, then the 6:10 PM PST flight", () => {
    const u = upNext(bellingham(), new Date("2026-11-15T12:30:00-08:00"), "2026-11-15")!;
    expect(u.next?.kind).toBe("drive");
    expect(u.next).toMatchObject({ when: "TODAY", sameDay: true });
    expect(u.then).toMatchObject({
      kind: "fly",
      title: "Fly SEA → BOI",
      when: "TODAY · 6:10 PM PST",
      segmentId: "s_home",
      navTo: null,
    });
  });

  it("Aug 29 → nothing is next", () => {
    expect(upNext(loop(), new Date("2026-08-29T09:00:00-07:00"), "2026-08-29")).toBeNull();
  });

  it("an untimed stay opens and closes its days; a fly hop with no booking reads 'Fly to'", () => {
    // The seed as shipped: every stay untimed.
    const u = upNext(pnwTrip(), new Date("2026-08-05T09:00:00-07:00"), "2026-08-05")!;
    expect(u.next).toMatchObject({ kind: "check-out", when: "TODAY", title: "Check out of Astoria/Warrenton KOA" });
    expect(u.then?.kind).toBe("drive");
    expect(u.then).toMatchObject({ title: "Drive to Newport, OR" });

    const t = bellingham();
    const flightless = { ...t, segments: t.segments.map((s) => (s.id === "s_home" ? { ...s, reservations: [] } : s)) };
    const v = upNext(flightless, new Date("2026-11-15T12:30:00-08:00"), "2026-11-15")!;
    expect(v.then).toMatchObject({ kind: "fly", title: "Fly to Boise, ID", when: "TODAY" });
  });

  it("a timed non-stay destination booking is a 'booking'", () => {
    const t = patchRes(loop(), "res_maritime", { startsAt: "2026-08-03T10:00:00-07:00", startsTz: LA });
    const u = upNext(t, new Date("2026-08-03T08:00:00-07:00"), "2026-08-03")!;
    expect(u.next).toMatchObject({ kind: "booking", title: "Columbia River Maritime Museum", when: "TODAY · 10:00 AM" });
  });
});

describe("upNextThenLine (#178 · #181 i4 · the card's 'Then ·' line)", () => {
  it("names the hop, and adds its clock only when it is timed — the day is next's", () => {
    const a = upNext(loop(), new Date("2026-08-05T09:00:00-07:00"), "2026-08-05")!;
    expect(upNextThenLine(a.then!)).toBe("Then · Drive to Newport, OR");
    const b = upNext(bellingham(), new Date("2026-11-15T12:30:00-08:00"), "2026-11-15")!;
    expect(upNextThenLine(b.then!)).toBe("Then · Fly SEA → BOI · 6:10 PM PST");
  });
});
