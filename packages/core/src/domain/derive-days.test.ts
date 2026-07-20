import { describe, it, expect } from "vitest";
import { deriveDays, eachDateInclusive } from "./derive-days";
import type { Stop } from "./types";

function mkStop(partial: Partial<Stop> & { id: string }): Stop {
  return {
    id: partial.id,
    legId: partial.legId ?? "leg1",
    place: partial.place ?? { name: partial.id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: partial.arriveDate ?? null,
    departDate: partial.departDate ?? null,
    sortOrder: partial.sortOrder ?? 0,
    rating: partial.rating ?? null,
    notes: partial.notes ?? null,
    reservations: [],
    ideas: [],
  };
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

describe("deriveDays", () => {
  it("classifies arrival as drive and the rest of the span as stay", () => {
    const stops = [mkStop({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-04" })];
    const { days } = deriveDays({ startDate: "2026-07-01", endDate: "2026-07-04" }, stops);
    expect(days.map((d) => d.kind)).toEqual(["drive", "stay", "stay", "stay"]);
    expect(days[0]).toMatchObject({ kind: "drive", fromStopId: null, toStopId: "A" });
    expect(days[1]).toMatchObject({ kind: "stay", stopId: "A" });
  });

  it("makes a back-to-back shared day a drive from prev to next", () => {
    const stops = [
      mkStop({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-04" }),
      mkStop({ id: "B", arriveDate: "2026-07-04", departDate: "2026-07-07" }),
    ];
    const { days } = deriveDays({ startDate: "2026-07-01", endDate: "2026-07-07" }, stops);
    expect(days.map((d) => d.kind)).toEqual([
      "drive", // Jul 1 arrive A
      "stay", // Jul 2 A
      "stay", // Jul 3 A
      "drive", // Jul 4 shared -> A→B wins
      "stay", // Jul 5 B
      "stay", // Jul 6 B
      "stay", // Jul 7 B
    ]);
    expect(days[3]).toMatchObject({ kind: "drive", fromStopId: "A", toStopId: "B" });
  });

  it("marks a gap between stops as empty (an unplanned hole)", () => {
    const stops = [
      mkStop({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-03" }),
      mkStop({ id: "B", arriveDate: "2026-07-06", departDate: "2026-07-08" }),
    ];
    const { days } = deriveDays({ startDate: "2026-07-01", endDate: "2026-07-08" }, stops);
    expect(days.map((d) => d.kind)).toEqual([
      "drive", // 1 arrive A
      "stay", // 2
      "stay", // 3
      "empty", // 4 gap
      "empty", // 5 gap
      "drive", // 6 arrive B
      "stay", // 7
      "stay", // 8
    ]);
  });

  it("treats a same-day pass-through stop (arrive === depart) as a single drive day", () => {
    const stops = [mkStop({ id: "P", arriveDate: "2026-07-05", departDate: "2026-07-05" })];
    const { days } = deriveDays({ startDate: "2026-07-05", endDate: "2026-07-05" }, stops);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ kind: "drive", toStopId: "P" });
  });

  it("clamps stop spans to the trip window", () => {
    const stops = [mkStop({ id: "A", arriveDate: "2026-06-28", departDate: "2026-07-02" })];
    const { days } = deriveDays({ startDate: "2026-07-01", endDate: "2026-07-03" }, stops);
    // Arrival (Jun 28) is outside the window; only Jul 1-2 are owned as stay.
    expect(days.map((d) => d.kind)).toEqual(["stay", "stay", "empty"]);
  });

  it("separates floating (dateless) stops into unscheduledStopIds", () => {
    const stops = [
      mkStop({ id: "A", arriveDate: "2026-07-01", departDate: "2026-07-02" }),
      mkStop({ id: "F", arriveDate: null, departDate: null, sortOrder: 1 }),
    ];
    const { days, unscheduledStopIds } = deriveDays(
      { startDate: "2026-07-01", endDate: "2026-07-02" },
      stops,
    );
    expect(unscheduledStopIds).toEqual(["F"]);
    expect(days.every((d) => d.stopId !== "F")).toBe(true);
  });
});
