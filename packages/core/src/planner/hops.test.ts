import { describe, it, expect } from "vitest";
import { costaRicaTrip, greeceTrip, pnwTrip } from "../seeds/index";
import { setSegmentMode } from "../domain/hops";
import { routeModel, timelineModel, type RouteHopBooking } from "./index";

/** #104 · the Route lens draws every non-drive hop as a travel card. */
describe("routeModel · hops", () => {
  it("Costa Rica: the outbound hop is two flights and a 2h 30m layover, plus the redeye home", () => {
    const [leg] = routeModel(costaRicaTrip());
    const out = leg!.leadingHop!;
    expect(out).toMatchObject({
      segmentId: "seg_out",
      mode: "fly",
      fromName: "Boise",
      toName: "Westin Reserva Conchal",
      dayLabel: "Sat Jan 16",
      doorToDoor: "10h 40m",
      meta: "Sat Jan 16 · 10h 40m door to door",
      bookings: 2,
    });
    expect(out.items.map((i) => i.kind)).toEqual(["booking", "layover", "booking"]);
    expect(out.items[1]).toEqual({ kind: "layover", label: "2h 30m layover at LAX" });
    const first = out.items[0] as RouteHopBooking;
    expect(first).toMatchObject({
      name: "AA 2451 BOI→LAX",
      departTime: "06:05",
      departAbbr: "MST",
      arriveTime: "07:10",
      arriveAbbr: "PST",
      duration: "2h 05m",
    });
    expect((out.items[2] as RouteHopBooking).arriveAbbr).toBe("CST");

    expect(leg!.returnHop).toMatchObject({
      segmentId: "seg_home",
      toName: "home",
      overnight: true,
      meta: "Sun Jan 24 → Mon Jan 25 · redeye",
      items: [],
    });
  });

  it("PNW: no hops at all — the drive trip's Route is unchanged", () => {
    for (const leg of routeModel(pnwTrip())) {
      expect(leg.leadingHop).toBeNull();
      expect(leg.returnHop).toBeNull();
      expect(leg.outboundHop).toBeNull();
      expect(leg.rows.every((r) => r.hop === null)).toBe(true);
    }
  });

  it("PNW: every drive names its segment — the ⋯ menu's PATCH target", () => {
    const [coast] = routeModel(pnwTrip());
    expect(coast!.rows[0]!.drive?.segmentId).toBe("seg_pnw_2");
  });

  it("PNW: 'Fly this hop instead' turns that one drive into a hop and nothing else", () => {
    const pnw = pnwTrip();
    const [coast] = routeModel(setSegmentMode(pnw, "seg_pnw_2", "fly"));
    expect(coast!.rows[0]!.drive).toBeNull();
    expect(coast!.rows[0]!.hop).toMatchObject({
      mode: "fly",
      fromName: "Astoria, OR",
      toName: "Newport, OR",
      dayLabel: "Wed Aug 5",
      items: [],
    });
  });

  it("Greece: a ferry hop out of Mykonos, inside its leg", () => {
    const legs = routeModel(greeceTrip());
    const cyclades = legs.find((l) => l.name === "Cyclades")!;
    const mykonos = cyclades.rows.find((r) => r.stop.id === "stp_mykonos")!;
    expect(mykonos.hop).toMatchObject({ segmentId: "seg_jmk_jnx", mode: "ferry", toName: "Naxos" });
  });

  it("Greece: the two flights that CROSS legs are each leg's outbound hop, under the seam (vet MED)", () => {
    const [athens, cyclades, back] = routeModel(greeceTrip());
    expect(athens!.outboundHop).toMatchObject({ segmentId: "seg_ath_jmk", mode: "fly", toName: "Mykonos" });
    expect(athens!.outboundSeam).toBe("Leg 1 → Leg 2");
    expect(cyclades!.outboundHop).toMatchObject({ segmentId: "seg_jnx_ath", mode: "fly", fromName: "Naxos" });
    expect(cyclades!.outboundSeam).toBe("Leg 2 → Leg 3");
    // No home base, no → home row: nothing leads or trails.
    expect(athens!.leadingHop).toBeNull();
    expect(back!.returnHop).toBeNull();
  });
});

describe("timelineModel · modes (klunk row 3)", () => {
  it("names only the modes a trip's rhythm has", () => {
    expect(timelineModel(pnwTrip()).modes).toEqual(["drive"]);
    expect(timelineModel(costaRicaTrip()).modes).toEqual(["fly"]);
    expect(timelineModel(greeceTrip()).modes).toEqual(["fly", "ferry"]);
  });

  it("a fly day carries its hop, so a click can open it on Route", () => {
    const cell = timelineModel(greeceTrip()).rhythm.find((c) => c.mode === "ferry")!;
    expect(cell.segmentId).toBe("seg_jmk_jnx");
  });
});
