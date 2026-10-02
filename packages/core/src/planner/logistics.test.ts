import { describe, it, expect } from "vitest";
import { costaRicaTrip, greeceTrip, pnwTrip } from "../seeds/index";
import { setSegmentMode } from "../domain/hops";
import type { Reservation, Trip } from "../domain/types";
import {
  areaSubtitle,
  hopChip,
  logisticsModel,
  routeCountKicker,
  routeModel,
  routeSummary,
  timelineModel,
  type LogisticsBooking,
} from "./index";

/**
 * #155 — the vocabulary pass's planner output: optional Chapters (Q1 A), the
 * hop chip and the Logistics section (Q3 B), and the flight-or-ferry-only clock
 * (Q4 A). Every frame is the real seed.
 */

const unnamed = (trip: Trip): Trip => ({
  ...trip,
  chapters: trip.chapters.map((c) => ({ ...c, title: null })),
});

describe("optional chapters (Q1 A)", () => {
  it("PNW: both named, so each renders CHAPTER N and its name", () => {
    const [coast, cascades] = routeModel(pnwTrip());
    expect([coast!.kicker, coast!.name]).toEqual(["Chapter 1", "Oregon Coast"]);
    expect([cascades!.kicker, cascades!.name]).toEqual(["Chapter 2", "Cascades & Home"]);
  });

  it("Costa Rica: one unnamed chapter renders no header", () => {
    const [only] = routeModel(costaRicaTrip());
    expect(only).toMatchObject({ kicker: null, name: null });
  });

  it("N counts NAMED chapters only", () => {
    const pnw = pnwTrip();
    const mixed: Trip = {
      ...pnw,
      chapters: [{ ...pnw.chapters[0]!, title: null }, pnw.chapters[1]!],
    };
    const [first, second] = routeModel(mixed);
    expect(first!.kicker).toBeNull();
    expect([second!.kicker, second!.name]).toEqual(["Chapter 1", "Cascades & Home"]);
    const tl = timelineModel(mixed).chapters;
    expect(tl.map((c) => [c.kicker, c.name])).toEqual([
      [null, null],
      ["Chapter 1", "Cascades & Home"],
    ]);
  });

  it("the old 'LEG 1 → LEG 2' seam is gone — the crossing drive stands on its own", () => {
    const [coast] = routeModel(pnwTrip());
    expect(coast).not.toHaveProperty("outboundSeam");
    expect(coast!.outboundDrive).not.toBeNull();
  });

  it("the count kicker: '3 destinations' when no chapter is named, else nothing", () => {
    expect(routeCountKicker(costaRicaTrip())).toBe("1 destination");
    expect(routeCountKicker(unnamed(pnwTrip()))).toBe("4 destinations");
    expect(routeCountKicker(pnwTrip())).toBeNull();
  });

  it("the rail's Chapters block lists named chapters only", () => {
    expect(routeSummary(pnwTrip()).chapters.map((c) => [c.name, c.destinations])).toEqual([
      ["Oregon Coast", 2],
      ["Cascades & Home", 2],
    ]);
    expect(routeSummary(costaRicaTrip()).chapters).toEqual([]);
  });
});

describe("the hop chip (Q3 B)", () => {
  it("Costa Rica: the hop card drops its booking rows for a count chip", () => {
    const [only] = routeModel(costaRicaTrip());
    expect(only!.leadingHop).toMatchObject({ chip: "2 flights · 1 shuttle → Logistics", items: [] });
    expect(only!.returnHop).toMatchObject({ chip: "1 shuttle → Logistics", items: [] });
  });

  it("names non-zero kinds in order flight · ferry · shuttle · train · car, with plurals", () => {
    const b = (transportKind: Reservation["transportKind"]) => ({ transportKind });
    expect(hopChip("fly", [b("car"), b(null), b("train"), b("train"), b("shuttle")])).toBe(
      "1 flight · 1 shuttle · 2 trains · 1 car → Logistics",
    );
    expect(hopChip("ferry", [b(null), b("ferry")])).toBe("2 ferries → Logistics");
  });

  it("a hop with no booking reads 'no flight added' (a ferry hop, 'no ferry added')", () => {
    expect(hopChip("fly", [])).toBe("no flight added → Logistics");
    const cyclades = routeModel(greeceTrip()).find((c) => c.name === "Cyclades")!;
    const mykonos = cyclades.rows.find((r) => r.destination.id === "stp_mykonos")!;
    expect(mykonos.hop!.chip).toBe("no ferry added → Logistics");
  });

  it("a parked hop (a drive that kept its flights, #129) is unchanged and has no chip", () => {
    const [only] = routeModel(setSegmentMode(costaRicaTrip(), "seg_out", "drive"));
    expect(only!.leadingHop).toMatchObject({ parked: 3, chip: null });
  });
});

describe("Logistics (Q3 B · Q4 A)", () => {
  it("is absent on a trip with no fly or ferry hop", () => {
    expect(logisticsModel(pnwTrip())).toBeNull();
  });

  it("Costa Rica: one group per hop, in segment order, headed like the hop", () => {
    const groups = logisticsModel(costaRicaTrip())!.groups;
    expect(groups.map((g) => [g.segmentId, g.dayLabel, g.fromName, g.toName, g.meta, g.mode])).toEqual([
      ["seg_out", "Sat Jan 16", "Boise", "Westin Reserva Conchal", "10h 40m door to door", "fly"],
      ["seg_home", "Sun Jan 24 → Mon Jan 25", "Westin Reserva Conchal", "home", "redeye", "fly"],
    ]);
  });

  it("outbound: the flights, the layover between them, then the shuttle after the arrival", () => {
    const [out] = logisticsModel(costaRicaTrip())!.groups;
    expect(out!.items.map((i) => (i.kind === "booking" ? `${i.transportKind}:${i.name}` : i.kind))).toEqual([
      "flight:AA 2451 BOI→LAX",
      "layover",
      "flight:AA 2208 LAX→LIR",
      "shuttle:Airport shuttle · LIR → hotel",
    ]);
    expect(out!.items[1]).toEqual({ kind: "layover", label: "2h 30m layover at LAX" });
    expect(out!.items[0]).toMatchObject({ departTime: "06:05", departAbbr: "MST", arriveAbbr: "PST" });
  });

  it("home: the shuttle BEFORE the departure, then a ghost row with the segment's own clock", () => {
    const [, home] = logisticsModel(costaRicaTrip())!.groups;
    expect(home!.items).toEqual([
      expect.objectContaining({ kind: "booking", transportKind: "shuttle", name: "Airport shuttle · hotel → LIR" }),
      {
        kind: "empty",
        label: "no flight added",
        departTime: "19:30",
        departAbbr: "CST",
        arriveTime: "08:50",
        arriveAbbr: "MST",
      },
    ]);
  });

  it("Greece: every hop is a group; an empty ferry hop reads 'no ferry added'", () => {
    const groups = logisticsModel(greeceTrip())!.groups;
    expect(groups.map((g) => g.segmentId)).toEqual(["seg_ath_jmk", "seg_jmk_jnx", "seg_jnx_ath"]);
    expect(groups[1]!.items).toEqual([
      expect.objectContaining({ kind: "empty", label: "no ferry added", departTime: "10:30", arriveTime: "11:15" }),
    ]);
  });

  it("a parked hop is not a Logistics group — it drives", () => {
    const groups = logisticsModel(setSegmentMode(costaRicaTrip(), "seg_out", "drive"))!.groups;
    expect(groups.map((g) => g.segmentId)).toEqual(["seg_home"]);
  });
});

describe("door to door and layover count flights and ferries only (Q4 A)", () => {
  /** Costa Rica with seg_out down to ONE flight plus a timed shuttle. */
  function oneFlightAndATimedShuttle(): Trip {
    const cr = costaRicaTrip();
    return {
      ...cr,
      segments: cr.segments.map((s) =>
        s.id !== "seg_out"
          ? s
          : {
              ...s,
              departAt: "2027-01-16T17:40:00Z",
              departTz: "America/Los_Angeles",
              reservations: s.reservations
                .filter((r) => r.id !== "res_aa2451")
                .map((r) =>
                  r.transportKind === "shuttle"
                    ? {
                        ...r,
                        startsAt: "2027-01-17T00:15:00Z",
                        startsTz: "America/Costa_Rica",
                        endsAt: "2027-01-17T01:30:00Z",
                        endsTz: "America/Costa_Rica",
                      }
                    : r,
                ),
            },
      ),
    };
  }

  it("a shuttle never makes a connection — one flight is not 'door to door'", () => {
    const [only] = routeModel(oneFlightAndATimedShuttle());
    expect(only!.leadingHop).toMatchObject({ doorToDoor: null, meta: "Sat Jan 16" });
  });

  it("and never prints 'layover at LIR'", () => {
    const [out] = logisticsModel(oneFlightAndATimedShuttle())!.groups;
    expect(out!.items.some((i) => i.kind === "layover")).toBe(false);
    const shuttle = out!.items.find((i): i is LogisticsBooking => i.kind === "booking" && i.transportKind === "shuttle");
    expect(shuttle).toMatchObject({ departTime: "18:15", departAbbr: "CST" });
  });
});

describe("the destination card's area subtitle (Q2 A)", () => {
  it("is the trip's area when it is set and the name does not already say it", () => {
    const cr = costaRicaTrip();
    expect(areaSubtitle(cr, "Westin Reserva Conchal")).toBe("Guanacaste");
    expect(areaSubtitle(cr, "Playa Guanacaste lodge")).toBeNull();
    expect(areaSubtitle(pnwTrip(), "Astoria, OR")).toBeNull();
    expect(areaSubtitle({ ...pnwTrip(), area: { id: null, name: "Oregon", googlePlaceId: "x", lat: null, lng: null } }, "Astoria, OR")).toBe("Oregon");
  });
});

