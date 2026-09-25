import { describe, it, expect } from "vitest";
import {
  diffSegments,
  localDate,
  newSegmentDateConflicts,
  reconcileSegments,
  segmentDateConflicts,
  type SegmentTrip,
} from "./segments";
import type { Segment } from "./types";

type S = SegmentTrip["legs"][number]["stops"][number];

const stop = (id: string, legId: string, sortOrder: number, arrive?: string, depart?: string): S => ({
  id,
  legId,
  sortOrder,
  arriveDate: arrive ?? null,
  departDate: depart ?? null,
});

function seg(partial: Partial<Segment> & Pick<Segment, "id" | "fromStopId" | "toStopId">): Segment {
  return {
    tripId: "t",
    mode: "drive",
    departAt: null,
    arriveAt: null,
    departTz: null,
    arriveTz: null,
    sortOrder: 0,
    reservations: [],
    ...partial,
  };
}

function trip(partial: Partial<SegmentTrip> = {}): SegmentTrip {
  return {
    id: "t",
    homeBase: "Boise, ID",
    defaultMode: "drive",
    legs: [
      {
        sortOrder: 0,
        stops: [stop("A", "L1", 0, "2026-08-02", "2026-08-05"), stop("B", "L1", 1, "2026-08-05", "2026-08-09")],
      },
      { sortOrder: 1, stops: [stop("C", "L2", 0, "2026-08-12", "2026-08-16"), stop("F", "L2", 1)] },
    ],
    segments: [],
    ...partial,
  };
}

const ids = () => {
  let i = 0;
  return () => `new${++i}`;
};
const pairs = (segs: Segment[]) => segs.map((s) => [s.fromStopId, s.toStopId]);

describe("reconcileSegments", () => {
  it("makes one hop per adjacent pair — floating included — plus home → first", () => {
    const next = reconcileSegments(trip(), ids());
    expect(pairs(next)).toEqual([
      [null, "A"],
      ["A", "B"],
      ["B", "C"],
      ["C", "F"],
    ]);
    expect(next.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("adds no home hop when the trip has no home base", () => {
    expect(pairs(reconcileSegments(trip({ homeBase: null }), ids()))[0]).toEqual(["A", "B"]);
  });

  it("keeps a row whose (from, to) still matches — id, mode, times and reservations", () => {
    const kept = seg({
      id: "keep",
      fromStopId: "A",
      toStopId: "B",
      mode: "ferry",
      departAt: "2026-08-05T17:00:00Z",
      arriveAt: "2026-08-05T19:00:00Z",
      sortOrder: 7,
      reservations: [
        {
          id: "r",
          stopId: null,
          segmentId: "keep",
          ideaId: null,
          type: "transport",
          name: "Ferry",
          checkIn: null,
          checkOut: null,
          confirmationNumber: null,
          cost: null,
          rating: null,
          notes: null,
          startsAt: null,
          endsAt: null,
          startsTz: null,
          endsTz: null,
          lastChange: null,
        },
      ],
    });
    const next = reconcileSegments(trip({ segments: [kept] }), ids());
    const ab = next.find((s) => s.fromStopId === "A" && s.toStopId === "B")!;
    expect(ab).toMatchObject({
      id: "keep",
      mode: "ferry",
      departAt: "2026-08-05T17:00:00Z",
      sortOrder: 1,
    });
    expect(ab.reservations).toHaveLength(1);
  });

  it("gives a new hop the trip's default mode, untimed", () => {
    const next = reconcileSegments(trip({ defaultMode: "fly" }), ids());
    expect(next.every((s) => s.mode === "fly" && s.departAt === null && s.arriveAt === null)).toBe(
      true,
    );
    expect(next.map((s) => s.id)).toEqual(["new1", "new2", "new3", "new4"]);
  });

  it("drops an orphaned row", () => {
    const orphan = seg({ id: "orphan", fromStopId: "A", toStopId: "C" });
    const next = reconcileSegments(trip({ segments: [orphan] }), ids());
    expect(next.some((s) => s.id === "orphan")).toBe(false);
    expect(diffSegments([orphan], next).remove).toEqual(["orphan"]);
  });

  it("re-points an existing to-home row to the new last stop — and never invents one", () => {
    const home = seg({ id: "home", fromStopId: "C", toStopId: null, mode: "fly" });
    const noHome = reconcileSegments(trip(), ids());
    expect(noHome.some((s) => s.toStopId === null)).toBe(false);

    const next = reconcileSegments(trip({ segments: [home] }), ids());
    const last = next[next.length - 1]!;
    expect(last).toMatchObject({ id: "home", fromStopId: "F", toStopId: null, mode: "fly", sortOrder: 4 });
  });

  it("drops the to-home row only when no stop is left to leave from", () => {
    const home = seg({ id: "home", fromStopId: "A", toStopId: null });
    expect(reconcileSegments(trip({ legs: [], segments: [home] }), ids())).toEqual([]);
  });

  it("diffs into insert / update / remove", () => {
    const before = [
      seg({ id: "h", fromStopId: null, toStopId: "A", sortOrder: 0 }),
      seg({ id: "x", fromStopId: "A", toStopId: "C", sortOrder: 1 }),
      seg({ id: "home", fromStopId: "C", toStopId: null, sortOrder: 2 }),
    ];
    const after = reconcileSegments(trip({ segments: before }), ids());
    const diff = diffSegments(before, after);
    expect(diff.remove).toEqual(["x"]);
    expect(diff.insert.map((s) => [s.fromStopId, s.toStopId])).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["C", "F"],
    ]);
    expect(diff.update.map((s) => [s.id, s.fromStopId, s.sortOrder])).toEqual([["home", "F", 4]]);
  });
});

describe("localDate", () => {
  it("reads an instant's LOCAL calendar date in its zone", () => {
    expect(localDate("2027-01-25T01:30:00Z", "America/Costa_Rica")).toBe("2027-01-24");
    expect(localDate("2027-01-25T15:50:00Z", "America/Boise")).toBe("2027-01-25");
    expect(localDate("2027-05-12T22:30:00Z", "Europe/Athens")).toBe("2027-05-13");
  });

  it("reads a null zone as UTC", () => {
    expect(localDate("2027-01-25T01:30:00Z", null)).toBe("2027-01-25");
  });
});

describe("segmentDateConflicts (Q3 A — stop dates win)", () => {
  const timedInto = (arriveAt: string) =>
    seg({
      id: "in",
      fromStopId: null,
      toStopId: "A",
      mode: "fly",
      departAt: "2026-08-02T13:00:00Z",
      departTz: "America/Boise",
      arriveAt,
      arriveTz: "America/Los_Angeles",
    });

  it("is clean when a timed segment lands on its stop's arriveDate", () => {
    expect(segmentDateConflicts(trip({ segments: [timedInto("2026-08-02T20:00:00Z")] }))).toEqual([]);
  });

  it("flags a timed segment whose local arrival date is not the stop's arriveDate", () => {
    // 2026-08-03T05:00Z is Aug 2 22:00 in LA — fine; 2026-08-03T08:00Z is Aug 3 01:00.
    expect(segmentDateConflicts(trip({ segments: [timedInto("2026-08-03T08:00:00Z")] }))).toEqual([
      { segmentId: "in", expected: "2026-08-02", actual: "2026-08-03" },
    ]);
  });

  it("compares a to-home segment's local DEPARTURE against the from-stop's departDate", () => {
    const home = seg({
      id: "home",
      fromStopId: "C",
      toStopId: null,
      departAt: "2026-08-17T16:00:00Z",
      departTz: "America/Los_Angeles",
      arriveAt: "2026-08-17T20:00:00Z",
      arriveTz: "America/Boise",
    });
    expect(segmentDateConflicts(trip({ segments: [home] }))).toEqual([
      { segmentId: "home", expected: "2026-08-16", actual: "2026-08-17" },
    ]);
  });

  it("exempts a floating endpoint — Unschedule stays possible next to a flight", () => {
    const t = trip({ segments: [timedInto("2026-08-03T08:00:00Z")] });
    t.legs[0]!.stops[0] = stop("A", "L1", 0);
    expect(segmentDateConflicts(t)).toEqual([]);
  });

  it("never flags an untimed segment", () => {
    expect(segmentDateConflicts(trip({ segments: [seg({ id: "u", fromStopId: "A", toStopId: "B" })] }))).toEqual(
      [],
    );
  });

  it("newSegmentDateConflicts reports only what the write introduced", () => {
    const before = trip({ segments: [timedInto("2026-08-02T20:00:00Z")] });
    const after = trip({ segments: before.segments });
    after.legs[0]!.stops[0] = stop("A", "L1", 0, "2026-08-03", "2026-08-05");
    expect(newSegmentDateConflicts(before, after)).toEqual([
      { segmentId: "in", expected: "2026-08-03", actual: "2026-08-02" },
    ]);
    expect(newSegmentDateConflicts(after, after)).toEqual([]);
  });
});
