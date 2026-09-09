import { describe, it, expect } from "vitest";
import {
  deriveTripStatus,
  daysUntil,
  formatDateSpan,
  orphanedStopsMessage,
  stopsOutsideRange,
  UPCOMING_WINDOW_DAYS,
} from "./trip-status";
import type { Stop, TripStatus } from "./types";

/** Evaluated as of 2026-09-08 — the date the design's worked table uses. */
const TODAY = "2026-09-08";

function mkTrip(partial: {
  startDate: string;
  endDate: string;
  status?: TripStatus;
  statusAuto?: boolean;
}) {
  return {
    startDate: partial.startDate,
    endDate: partial.endDate,
    status: partial.status ?? ("planning" as TripStatus),
    statusAuto: partial.statusAuto ?? true,
  };
}

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

describe("daysUntil", () => {
  it("counts whole days forward and backward", () => {
    expect(daysUntil("2026-09-20", TODAY)).toBe(12);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
    expect(daysUntil("2026-09-01", TODAY)).toBe(-7);
  });

  it("does not drift across a DST boundary", () => {
    // 2026-03-08 is US DST start; plain-date math must stay exact.
    expect(daysUntil("2026-03-09", "2026-03-07")).toBe(2);
  });
});

describe("deriveTripStatus", () => {
  it("reads a finished trip as complete", () => {
    expect(deriveTripStatus(mkTrip({ startDate: "2024-09-08", endDate: "2024-09-19" }), TODAY)).toBe(
      "complete",
    );
  });

  it("reads a trip starting within 30 days as upcoming", () => {
    // Redwoods Run: start - today = 12 days <= 30.
    expect(deriveTripStatus(mkTrip({ startDate: "2026-09-20", endDate: "2026-10-04" }), TODAY)).toBe(
      "upcoming",
    );
  });

  it("reads a trip starting beyond 30 days as planning", () => {
    // Baja Winter: start - today = 57 days > 30.
    expect(deriveTripStatus(mkTrip({ startDate: "2026-11-04", endDate: "2026-12-02" }), TODAY)).toBe(
      "planning",
    );
  });

  it("holds the 30-day boundary inclusive", () => {
    const onTheEdge = mkTrip({ startDate: "2026-10-08", endDate: "2026-10-20" });
    expect(daysUntil(onTheEdge.startDate, TODAY)).toBe(UPCOMING_WINDOW_DAYS);
    expect(deriveTripStatus(onTheEdge, TODAY)).toBe("upcoming");
    expect(
      deriveTripStatus(mkTrip({ startDate: "2026-10-09", endDate: "2026-10-20" }), TODAY),
    ).toBe("planning");
  });

  it("reads an in-progress trip as upcoming — the enum has no 'traveling'", () => {
    // start <= today <= end: daysUntil is negative, so it satisfies <= 30.
    expect(deriveTripStatus(mkTrip({ startDate: "2026-09-01", endDate: "2026-09-14" }), TODAY)).toBe(
      "upcoming",
    );
  });

  it("treats a trip ending today as still running, not complete", () => {
    expect(deriveTripStatus(mkTrip({ startDate: "2026-09-01", endDate: TODAY }), TODAY)).toBe(
      "upcoming",
    );
  });

  it("lets a manual choice win — statusAuto:false pins the stored status", () => {
    // The seeded Pacific Northwest Loop: its dates have passed, but it is pinned.
    const pinned = mkTrip({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      status: "planning",
      statusAuto: false,
    });
    expect(deriveTripStatus(pinned, TODAY)).toBe("planning");
    // …and the same trip derives to complete the moment the pin comes off.
    expect(deriveTripStatus({ ...pinned, statusAuto: true }, TODAY)).toBe("complete");
  });
});

describe("stopsOutsideRange", () => {
  const bend = mkStop({
    id: "bend",
    place: { name: "Bend, OR", lat: null, lng: null, googlePlaceId: null },
    arriveDate: "2026-08-12",
    departDate: "2026-08-16",
  });
  const floating = mkStop({ id: "crater" });

  it("finds a stop the new end date would cut in half", () => {
    expect(
      stopsOutsideRange({ startDate: "2026-08-01", endDate: "2026-08-14" }, [bend, floating]),
    ).toEqual([
      { id: "bend", name: "Bend, OR", arriveDate: "2026-08-12", departDate: "2026-08-16" },
    ]);
  });

  it("finds a stop the new start date would cut off", () => {
    expect(
      stopsOutsideRange({ startDate: "2026-08-13", endDate: "2026-08-28" }, [bend]),
    ).toHaveLength(1);
  });

  it("accepts a range that fully contains every scheduled stop", () => {
    expect(stopsOutsideRange({ startDate: "2026-08-12", endDate: "2026-08-16" }, [bend])).toEqual(
      [],
    );
  });

  it("ignores floating stops — they are not on the calendar to orphan", () => {
    expect(stopsOutsideRange({ startDate: "2026-01-01", endDate: "2026-01-02" }, [floating])).toEqual(
      [],
    );
  });
});

describe("formatDateSpan / orphanedStopsMessage", () => {
  it("formats a span inside one month, across months, and a single day", () => {
    expect(formatDateSpan("2026-08-12", "2026-08-16")).toBe("Aug 12–16");
    expect(formatDateSpan("2026-08-28", "2026-09-02")).toBe("Aug 28–Sep 2");
    expect(formatDateSpan("2026-08-01", "2026-08-01")).toBe("Aug 1");
  });

  it("writes the refusal sentence the design specifies", () => {
    expect(
      orphanedStopsMessage([
        { id: "bend", name: "Bend, OR", arriveDate: "2026-08-12", departDate: "2026-08-16" },
      ]),
    ).toBe("Bend, OR is scheduled Aug 12–16, outside the new range. Move or unschedule it first.");
  });
});
