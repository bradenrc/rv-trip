import { describe, it, expect } from "vitest";
import { deriveDays, eachDateInclusive } from "./derive-days";
import { allDestinations } from "../planner/index";
import { costaRicaTrip, greeceTrip, pnwTrip } from "../seeds/index";
import type { Segment, Destination, TravelMode, Trip } from "./types";

function mkDestination(partial: Partial<Destination> & { id: string }): Destination {
  return {
    id: partial.id,
    chapterId: partial.chapterId ?? "chapter1",
    place: partial.place ?? { name: partial.id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: partial.arriveDate ?? null,
    departDate: partial.departDate ?? null,
    sortOrder: partial.sortOrder ?? 0,
    rating: partial.rating ?? null,
    notes: partial.notes ?? null,
    reservations: [],
    ideas: [],
    lastChange: null,
    again: null,
  };
}

/** One untimed segment per hop — the dense row set Q1 A makes every trip carry. */
function hops(pairs: [string | null, string | null][], mode: TravelMode = "drive"): Segment[] {
  return pairs.map(([fromDestinationId, toDestinationId], i) => ({
    id: `seg${i}`,
    tripId: "t",
    fromDestinationId,
    toDestinationId,
    mode,
    departAt: null,
    arriveAt: null,
    departTz: null,
    arriveTz: null,
    sortOrder: i,
    reservations: [],
  }));
}

/** A seed trip's days as `kind` (+ mode for travel), keyed by date. */
function drawn(trip: Trip): Record<string, string> {
  const { days } = deriveDays(trip, allDestinations(trip), trip.segments);
  return Object.fromEntries(
    days.map((d) => [d.date, d.kind === "travel" ? `travel:${d.mode}` : d.kind]),
  );
}

describe("eachDateInclusive", () => {
  it("includes both endpoints", () => {
    expect(eachDateInclusive("2026-07-01", "2026-07-03")).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
  });

  it("handles a single day", () => {
    expect(eachDateInclusive("2026-07-05", "2026-07-05")).toEqual(["2026-07-05"]);
  });

  it("does not drift across a DST boundary (US spring-forward)", () => {
    // 2026-03-08 is US DST start; plain-date math must stay exact.
    const days = eachDateInclusive("2026-03-07", "2026-03-09");
    expect(days).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });
});

describe("deriveDays — the v1 cases, one segment per hop", () => {
  it("classifies arrival as travel and the rest of the span as stay", () => {
    const destinations = [mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-04" })];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-04" },
      destinations,
      hops([[null, "A"]]),
    );
    expect(days.map((d) => d.kind)).toEqual(["travel", "stay", "stay", "stay"]);
    expect(days[0]).toMatchObject({
      kind: "travel",
      mode: "drive",
      segmentId: "seg0",
      fromDestinationId: null,
      toDestinationId: "A",
    });
    expect(days[1]).toMatchObject({ kind: "stay", destinationId: "A" });
  });

  it("makes a back-to-back shared day the travel from prev to next", () => {
    const destinations = [
      mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-04" }),
      mkDestination({ id: "B", arriveDate: "2026-07-04", departDate: "2026-07-07" }),
    ];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-07" },
      destinations,
      hops([
        [null, "A"],
        ["A", "B"],
      ]),
    );
    expect(days.map((d) => d.kind)).toEqual([
      "travel", // Jul 1 arrive A
      "stay", // Jul 2 A
      "stay", // Jul 3 A
      "travel", // Jul 4 shared -> A→B wins
      "stay", // Jul 5 B
      "stay", // Jul 6 B
      "stay", // Jul 7 B
    ]);
    expect(days[3]).toMatchObject({ kind: "travel", fromDestinationId: "A", toDestinationId: "B" });
  });

  it("marks a gap between destinations as empty (an unplanned hole)", () => {
    const destinations = [
      mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-03" }),
      mkDestination({ id: "B", arriveDate: "2026-07-06", departDate: "2026-07-08" }),
    ];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-08" },
      destinations,
      hops([
        [null, "A"],
        ["A", "B"],
      ]),
    );
    expect(days.map((d) => d.kind)).toEqual([
      "travel", // 1 arrive A
      "stay", // 2
      "stay", // 3
      "empty", // 4 gap
      "empty", // 5 gap
      "travel", // 6 arrive B
      "stay", // 7
      "stay", // 8
    ]);
  });

  it("treats a same-day pass-through destination (arrive === depart) as a single travel day", () => {
    const destinations = [mkDestination({ id: "P", arriveDate: "2026-07-05", departDate: "2026-07-05" })];
    const { days } = deriveDays(
      { startDate: "2026-07-05", endDate: "2026-07-05" },
      destinations,
      hops([[null, "P"]]),
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ kind: "travel", toDestinationId: "P" });
  });

  it("clamps destination spans to the trip window", () => {
    const destinations = [mkDestination({ id: "A", arriveDate: "2026-06-28", departDate: "2026-07-02" })];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-03" },
      destinations,
      hops([[null, "A"]]),
    );
    // Arrival (Jun 28) is outside the window; only Jul 1-2 are owned as stay.
    expect(days.map((d) => d.kind)).toEqual(["stay", "stay", "empty"]);
  });

  it("separates floating (dateless) destinations into unscheduledDestinationIds", () => {
    const destinations = [
      mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-02" }),
      mkDestination({ id: "F", arriveDate: null, departDate: null, sortOrder: 1 }),
    ];
    const { days, unscheduledDestinationIds } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-02" },
      destinations,
      hops([
        [null, "A"],
        ["A", "F"],
      ]),
    );
    expect(unscheduledDestinationIds).toEqual(["F"]);
    expect(days.every((d) => d.destinationId !== "F" && d.toDestinationId !== "F")).toBe(true);
  });
});

describe("deriveDays v2 — the segment rules (docs/design/110 §4)", () => {
  it("keeps a destination's arrival as a stay when NO segment arrives there", () => {
    const destinations = [mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-02" })];
    const { days } = deriveDays({ startDate: "2026-07-01", endDate: "2026-07-02" }, destinations, []);
    expect(days.map((d) => d.kind)).toEqual(["stay", "stay"]);
  });

  it("gives a floating endpoint no day (PNW Bend → Crater Lake)", () => {
    const destinations = [
      mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-02" }),
      mkDestination({ id: "F", sortOrder: 1 }),
    ];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-03" },
      destinations,
      hops([["A", "F"]]),
    );
    expect(days.map((d) => d.kind)).toEqual(["stay", "stay", "empty"]);
    expect(days.some((d) => d.segmentId === "seg0")).toBe(false);
  });

  it("lands an untimed to-home segment on the from-destination's departDate", () => {
    const destinations = [mkDestination({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-03" })];
    const { days } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-04" },
      destinations,
      hops([
        [null, "A"],
        ["A", null],
      ]),
    );
    expect(days.map((d) => d.kind)).toEqual(["travel", "stay", "travel", "empty"]);
    expect(days[2]).toMatchObject({ segmentId: "seg1", fromDestinationId: "A", toDestinationId: null });
  });

  it("spans every LOCAL date a timed segment touches — the redeye is two days (Q4 B)", () => {
    const destinations = [mkDestination({ id: "C", arriveDate: "2027-01-16", departDate: "2027-01-24" })];
    const seg: Segment = {
      ...hops([["C", null]], "fly")[0]!,
      departAt: "2027-01-25T01:30:00Z", // Sun 19:30 in Costa Rica
      departTz: "America/Costa_Rica",
      arriveAt: "2027-01-25T15:50:00Z", // Mon 08:50 in Boise
      arriveTz: "America/Boise",
    };
    const { days } = deriveDays({ startDate: "2027-01-23", endDate: "2027-01-25" }, destinations, [seg]);
    expect(days.map((d) => [d.date, d.kind, d.mode])).toEqual([
      ["2027-01-23", "stay", undefined],
      ["2027-01-24", "travel", "fly"],
      ["2027-01-25", "travel", "fly"],
    ]);
  });
});

describe("deriveDays — the three seeds, day by day (wireframe §1)", () => {
  it("PNW: Aug 1 empty; Aug 2 / 5 / 12 drive; Crater Lake floating adds no day", () => {
    const d = drawn(pnwTrip());
    expect(Object.keys(d)).toHaveLength(28);
    expect(d["2026-08-01"]).toBe("empty");
    expect(d["2026-08-02"]).toBe("travel:drive");
    for (const day of ["03", "04"]) expect(d[`2026-08-${day}`]).toBe("stay");
    expect(d["2026-08-05"]).toBe("travel:drive");
    for (const day of ["06", "07", "08", "09"]) expect(d[`2026-08-${day}`]).toBe("stay");
    for (const day of ["10", "11"]) expect(d[`2026-08-${day}`]).toBe("empty");
    expect(d["2026-08-12"]).toBe("travel:drive");
    for (const day of ["13", "14", "15", "16"]) expect(d[`2026-08-${day}`]).toBe("stay");
    for (let n = 17; n <= 28; n++) expect(d[`2026-08-${n}`]).toBe("empty");
  });

  it("Costa Rica: Jan 16 fly · Jan 17–23 stay · Jan 24 and 25 fly on seg_home", () => {
    const trip = costaRicaTrip();
    const { days } = deriveDays(trip, allDestinations(trip), trip.segments);
    const by = Object.fromEntries(days.map((c) => [c.date, c]));
    expect(days).toHaveLength(10);
    expect(by["2027-01-16"]).toMatchObject({
      kind: "travel",
      mode: "fly",
      segmentId: "seg_out",
      fromDestinationId: null,
      toDestinationId: "stp_conchal",
    });
    for (let n = 17; n <= 23; n++) {
      expect(by[`2027-01-${n}`]).toMatchObject({ kind: "stay", destinationId: "stp_conchal" });
    }
    for (const date of ["2027-01-24", "2027-01-25"]) {
      expect(by[date]).toMatchObject({
        kind: "travel",
        mode: "fly",
        segmentId: "seg_home",
        fromDestinationId: "stp_conchal",
        toDestinationId: null,
      });
    }
  });

  it("Greece: May 10 stay (no inbound segment) · 12 fly · 16 ferry · 19 fly", () => {
    const d = drawn(greeceTrip());
    expect(d).toEqual({
      "2027-05-10": "stay",
      "2027-05-11": "stay",
      "2027-05-12": "travel:fly",
      "2027-05-13": "stay",
      "2027-05-14": "stay",
      "2027-05-15": "stay",
      "2027-05-16": "travel:ferry",
      "2027-05-17": "stay",
      "2027-05-18": "stay",
      "2027-05-19": "travel:fly",
      "2027-05-20": "stay",
    });
  });
});
