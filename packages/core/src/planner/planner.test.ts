import { describe, it, expect } from "vitest";
import type { Trip, Stop } from "../domain/types";
import { routeCacheKey } from "../domain/route-order";
import type { RouteResult } from "../providers/index";
import {
  timelineModel,
  routeModel,
  routeSummary,
  scheduleFloating,
  reorderFloating,
  cycleIdeaStatus,
  setStopRating,
  dateRange,
  fullRange,
  addDays,
  type RouteMap,
} from "./index";

/**
 * A ten-day trip, hand-classified so every expectation below is arithmetic
 * you can check on paper:
 *
 *   08-01 open · 08-02 drive→S1 · 08-03 stay S1 · 08-04 drive→S2 (arrival
 *   wins the shared day) · 08-05 stay · 08-06 stay · 08-07 open · 08-08
 *   drive→S3 · 08-09 stay S3 · 08-10 open
 *
 * S4 is floating with coordinates; S5 is floating WITHOUT coordinates, so the
 * S4→S5 pair yields no drive at all (coordinates, not dates, are the
 * precondition for a connector).
 */
function stop(partial: Partial<Stop> & Pick<Stop, "id" | "legId" | "sortOrder">): Stop {
  return {
    place: { name: partial.id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    ...partial,
  };
}

function fixture(endDate = "2026-08-10"): Trip {
  return {
    id: "t",
    ownerId: "o",
    title: "Ten days",
    homeBase: null,
    startDate: "2026-08-01",
    endDate,
    status: "planning",
    rating: null,
    note: null,
    legs: [
      {
        id: "A",
        tripId: "t",
        title: "Coast",
        sortOrder: 0,
        stops: [
          stop({
            id: "S1",
            legId: "A",
            sortOrder: 0,
            place: { name: "S1", lat: 46.18, lng: -123.83, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-04",
            rating: 5,
            reservations: [
              {
                id: "r1",
                stopId: "S1",
                ideaId: null,
                type: "campground",
                name: "KOA",
                checkIn: "2026-08-02",
                checkOut: "2026-08-04",
                confirmationNumber: null,
                cost: 120,
                rating: null,
                notes: null,
              },
            ],
          }),
          stop({
            id: "S2",
            legId: "A",
            sortOrder: 1,
            place: { name: "S2", lat: 44.63, lng: -124.05, googlePlaceId: null },
            arriveDate: "2026-08-04",
            departDate: "2026-08-06",
          }),
        ],
      },
      {
        id: "B",
        tripId: "t",
        title: "Mountains",
        sortOrder: 1,
        stops: [
          stop({
            id: "S3",
            legId: "B",
            sortOrder: 0,
            place: { name: "S3", lat: 44.05, lng: -121.31, googlePlaceId: null },
            arriveDate: "2026-08-08",
            departDate: "2026-08-09",
            ideas: [
              {
                id: "i1",
                stopId: "S3",
                title: "Float",
                status: "idea",
                place: null,
                rating: null,
                notes: null,
                sortOrder: 0,
              },
            ],
          }),
          stop({
            id: "S4",
            legId: "B",
            sortOrder: 1,
            place: { name: "S4", lat: 42.94, lng: -122.1, googlePlaceId: null },
          }),
          stop({ id: "S5", legId: "B", sortOrder: 2 }),
        ],
      },
    ],
  };
}

describe("timelineModel", () => {
  const m = timelineModel(fixture());

  it("has one rhythm cell per trip day, classified", () => {
    expect(m.rhythm).toHaveLength(10);
    expect(m.rhythm.map((c) => c.kind)).toEqual([
      "empty", "drive", "stay", "drive", "stay", "stay", "empty", "drive", "stay", "empty",
    ]);
  });

  it("turns contiguous same-stop runs into bars (1-based columns)", () => {
    expect(m.legs.map((l) => l.bars.map((b) => [b.stopId, b.startCol, b.span]))).toEqual([
      [["S1", 2, 2], ["S2", 4, 3]],
      [["S3", 8, 2]],
    ]);
    expect(m.legs[0]!.bars[0]).toMatchObject({ range: "Aug 2–4", rating: 5, resCount: 1, showMeta: true });
  });

  it("turns contiguous open runs into gaps and counts them", () => {
    expect(m.gaps).toEqual([
      { startCol: 1, span: 1 },
      { startCol: 7, span: 1 },
      { startCol: 10, span: 1 },
    ]);
    expect(m.openCount).toBe(3);
    expect(m.gapCount).toBe(3);
    expect(m.openLabel).toBe("3 open days across 3 gaps");
  });

  it("lists floating stops in sortOrder, off the calendar", () => {
    expect(m.floating.map((f) => f.id)).toEqual(["S4", "S5"]);
    expect(m.allScheduled).toBe(false);
  });

  it("says every day is planned when nothing is open", () => {
    const t = fixture("2026-08-09");
    t.legs[0]!.stops[0]!.arriveDate = "2026-08-01";
    t.legs[0]!.stops[1]!.departDate = "2026-08-08";
    expect(timelineModel(t).openLabel).toBe("Every day planned");
  });
});

describe("routeModel", () => {
  it("draws a drive out of every stop that has a routable successor in the same leg", () => {
    const legs = routeModel(fixture());
    expect(legs[0]!.rows.map((r) => r.drive !== null)).toEqual([true, false]);
    // S3→S4 is a drive (both have coords); S4→S5 is not (S5 has none).
    expect(legs[1]!.rows.map((r) => r.drive !== null)).toEqual([true, false, false]);
  });

  it("hangs the leg-crossing drive on the leg it leaves, with its seam label", () => {
    const legs = routeModel(fixture());
    expect(legs[0]!.outboundDrive).not.toBeNull();
    expect(legs[0]!.outboundSeam).toBe("Leg 1 → Leg 2");
    expect(legs[1]!.outboundDrive).toBeNull();
  });

  it("labels an un-routed pair as an estimate and a routed one as real", () => {
    const trip = fixture();
    const from = { lat: 46.18, lng: -123.83 };
    const to = { lat: 44.63, lng: -124.05 };
    const here: RouteResult = {
      durationSeconds: 3 * 3600,
      distanceMeters: 200_000,
      polyline: null,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const routes: RouteMap = { [routeCacheKey(from, to, "rig-x")]: here };
    const legs = routeModel(trip, routes, "rig-x");
    expect(legs[0]!.rows[0]!.drive).toMatchObject({ estimate: false, primaryRoad: "US-101" });
    expect(legs[0]!.outboundDrive).toMatchObject({ estimate: true });
  });

  it("gives every drive a Google Maps handoff URL", () => {
    const d = routeModel(fixture())[0]!.rows[0]!.drive!;
    expect(d.navUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=46\.18/);
  });
});

describe("routeSummary", () => {
  it("is exactly the sum of the drives the route view shows", () => {
    const trip = fixture();
    const legs = routeModel(trip);
    const visible = legs.flatMap((l) => [
      ...l.rows.map((r) => r.drive).filter((d) => d !== null),
      ...(l.outboundDrive ? [l.outboundDrive] : []),
    ]);
    const s = routeSummary(trip);
    expect(visible).toHaveLength(3);
    expect(s.driveMiles).toBe(visible.reduce((a, d) => a + d.miles, 0));
  });

  it("counts stops, days, gaps and cost", () => {
    const s = routeSummary(fixture());
    expect(s).toMatchObject({
      stops: 5,
      scheduled: 3,
      floating: 2,
      days: 10,
      openCount: 3,
      gapCount: 3,
      totalCost: 120,
      restrictionCount: 0,
    });
    expect(s.legs.map((l) => [l.name, l.stops, l.cost])).toEqual([
      ["Coast", 2, 120],
      ["Mountains", 3, 0],
    ]);
  });
});

describe("pure mutations", () => {
  it("scheduleFloating drops the stop into the LARGEST open run, up to `nights`", () => {
    // 08-10..08-12 is the longest open run (3 days) once the trip runs to 08-12.
    const next = scheduleFloating(fixture("2026-08-12"), "S4");
    const s4 = next.legs[1]!.stops.find((s) => s.id === "S4")!;
    expect([s4.arriveDate, s4.departDate]).toEqual(["2026-08-10", "2026-08-12"]);
  });

  it("scheduleFloating clamps to the run when it is shorter than `nights`", () => {
    // Every open run is a single day; the first one wins ties.
    const next = scheduleFloating(fixture(), "S4");
    const s4 = next.legs[1]!.stops.find((s) => s.id === "S4")!;
    expect([s4.arriveDate, s4.departDate]).toEqual(["2026-08-01", "2026-08-01"]);
  });

  it("scheduleFloating is a no-op with no open day", () => {
    const t = fixture("2026-08-09");
    t.legs[0]!.stops[0]!.arriveDate = "2026-08-01";
    t.legs[0]!.stops[1]!.departDate = "2026-08-08";
    expect(scheduleFloating(t, "S4")).toBe(t);
  });

  it("reorderFloating moves the dragged stop before the target and renumbers the leg", () => {
    const next = reorderFloating(fixture(), "B", "S5", "S4");
    const order = [...next.legs[1]!.stops].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
    expect(order).toEqual(["S3", "S5", "S4"]);
  });

  it("does not mutate its input", () => {
    const t = fixture();
    const before = JSON.stringify(t);
    reorderFloating(t, "B", "S5", "S4");
    scheduleFloating(t, "S4");
    setStopRating(t, "S1", 3);
    expect(JSON.stringify(t)).toBe(before);
  });

  it("cycleIdeaStatus walks idea → planned → done → idea", () => {
    let t = fixture();
    const status = () => t.legs[1]!.stops[0]!.ideas[0]!.status;
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("planned");
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("done");
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("idea");
  });

  it("setStopRating(0) clears the rating", () => {
    const t = setStopRating(fixture(), "S1", 0);
    expect(t.legs[0]!.stops[0]!.rating).toBeNull();
  });
});

describe("dates", () => {
  it("formats ranges the way the planner reads them", () => {
    expect(dateRange("2026-08-02", "2026-08-05")).toBe("Aug 2–5");
    expect(dateRange("2026-08-30", "2026-09-02")).toBe("Aug 30 – Sep 2");
    expect(dateRange("2026-08-02", "2026-08-02")).toBe("Aug 2");
    expect(fullRange("2026-08-01", "2026-08-10")).toBe("Aug 1 – 10, 2026");
    expect(fullRange("2026-08-25", "2026-09-03")).toBe("Aug 25 – Sep 3, 2026");
  });

  it("adds days across a month boundary in UTC", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // a DST Sunday in the US; plain dates don't care
  });
});
