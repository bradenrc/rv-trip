import { describe, it, expect } from "vitest";
import { segmentDateConflicts, reconcileSegments } from "../domain/segments";
import { trip as tripSchema } from "../domain/types";
import { timelineModel } from "../planner/index";
import { costaRicaTrip, greeceTrip, pnwTrip, seedTrips } from "./index";

/**
 * The seeds every later pass is judged against (#110 §7). They are PURE data,
 * so this is where their invariants run — packages/db's seed.ts only writes
 * them (vet MED on #110: a DB-writing script has no test runner).
 */
describe("the seed trips", () => {
  it("parse as the domain grammar", () => {
    for (const t of seedTrips()) expect(() => tripSchema.parse(t)).not.toThrow();
  });

  it("carry ZERO segment/date conflicts (Q3 A: stop dates win)", () => {
    for (const t of seedTrips()) expect({ [t.title]: segmentDateConflicts(t) }).toEqual({ [t.title]: [] });
  });

  it("are already dense: reconciling them changes nothing", () => {
    for (const t of seedTrips()) {
      expect(reconcileSegments(t, () => "never")).toEqual(t.segments);
    }
  });

  it("PNW: 4 drive segments, untimed — home→Astoria · Astoria→Newport · Newport→Bend · Bend→Crater", () => {
    const t = pnwTrip();
    expect(t.segments.map((s) => [s.fromStopId, s.toStopId, s.mode, s.departAt])).toEqual([
      [null, "stp_astoria", "drive", null],
      ["stp_astoria", "stp_newport", "drive", null],
      ["stp_newport", "stp_bend", "drive", null],
      ["stp_bend", "stp_crater", "drive", null],
    ]);
    expect({ defaultMode: t.defaultMode, lodgingDefault: t.lodgingDefault, rigOn: t.rigOn }).toEqual({
      defaultMode: "drive",
      lodgingDefault: "campground",
      rigOn: true,
    });
  });

  it("Costa Rica: the two AA flights hang on seg_out, the stop keeps only the Westin", () => {
    const t = costaRicaTrip();
    const out = t.segments.find((s) => s.id === "seg_out")!;
    expect(out.reservations.map((r) => [r.name, r.stopId, r.segmentId])).toEqual([
      ["AA 2451 BOI→LAX", null, "seg_out"],
      ["AA 2208 LAX→LIR", null, "seg_out"],
    ]);
    const conchal = t.legs[0]!.stops[0]!;
    expect(conchal.reservations.map((r) => r.name)).toEqual(["Westin Reserva Conchal"]);
    expect(conchal.ideas.map((i) => i.title)).toEqual(["Playa Conchal snorkel", "Tamarindo surf lesson"]);
    expect(t.segments.map((s) => s.id)).toEqual(["seg_out", "seg_home"]);
    expect({ defaultMode: t.defaultMode, lodgingDefault: t.lodgingDefault, rigOn: t.rigOn }).toEqual({
      defaultMode: "fly",
      lodgingDefault: "hotel",
      rigOn: false,
    });
  });

  it("Greece: no home base — a fly, a ferry and a fly, one hotel per stop", () => {
    const t = greeceTrip();
    expect(t.homeBase).toBeNull();
    expect(t.legs.map((l) => l.title)).toEqual(["Athens", "Cyclades", "Back to Athens"]);
    expect(t.segments.map((s) => s.mode)).toEqual(["fly", "ferry", "fly"]);
    for (const l of t.legs) {
      for (const s of l.stops) expect(s.reservations.map((r) => r.type)).toEqual(["lodging"]);
    }
  });
});

describe("the seeds on the gantt (wireframe §1)", () => {
  it("PNW is today's timeline: Astoria cols 2–4, Newport 5–9, Bend 12–16, all arriving by drive", () => {
    const m = timelineModel(pnwTrip());
    const bars = m.legs.flatMap((l) => l.bars);
    expect(bars.map((b) => [b.name, b.startCol, b.span, b.arriveMode, b.resCount, b.ideaCount])).toEqual([
      ["Astoria, OR", 2, 3, "drive", 2, 0],
      ["Newport, OR", 5, 5, "drive", 1, 2],
      ["Bend, OR", 12, 5, "drive", 0, 1],
    ]);
    expect(m.gaps.map((g) => [g.startCol, g.span])).toEqual([
      [1, 1],
      [10, 2],
      [17, 12],
    ]);
    expect(m.rhythm[1]).toMatchObject({ kind: "travel", mode: "drive", title: "2026-08-02 — Drive → Astoria, OR" });
  });

  it("Costa Rica: Conchal's bar ends Jan 23 but reads its own dates, and arrives by air", () => {
    const m = timelineModel(costaRicaTrip());
    const [bar] = m.legs[0]!.bars;
    expect(bar).toMatchObject({
      name: "Westin Reserva Conchal",
      range: "Jan 16–24",
      startCol: 1,
      span: 8,
      arriveMode: "fly",
      resCount: 1,
      ideaCount: 2,
    });
    expect(m.openLabel).toBe("Every day planned");
    expect(m.rhythm[8]!.title).toBe("2027-01-24 — Fly → home");
    expect(m.rhythm[9]).toMatchObject({ kind: "travel", mode: "fly" });
  });

  it("Greece: the first Athens has no inbound segment, so no arrival edge", () => {
    const m = timelineModel(greeceTrip());
    const bars = m.legs.flatMap((l) => l.bars);
    expect(bars.map((b) => [b.name, b.range, b.startCol, b.span, b.arriveMode])).toEqual([
      ["Athens", "May 10–12", 1, 2, null],
      ["Mykonos", "May 12–16", 3, 4, "fly"],
      ["Naxos", "May 16–19", 7, 3, "ferry"],
      ["Athens", "May 19–20", 10, 2, "fly"],
    ]);
    expect(m.rhythm[6]!.title).toBe("2027-05-16 — Ferry → Naxos");
  });
});
