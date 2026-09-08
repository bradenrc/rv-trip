import { describe, it, expect } from "vitest";
import { estimateRoute, StubRoutingProvider } from "./index";
import { driveLabel, driveMiles, driveMinutes, formatDriveTime } from "./route-format";

// The seed fixture's coordinates (packages/db/src/seed.ts).
const ASTORIA = { lat: 46.1879, lng: -123.8313 };
const NEWPORT = { lat: 44.6365, lng: -124.053 };
const BEND = { lat: 44.0582, lng: -121.3153 };
const CRATER = { lat: 42.9446, lng: -122.109 };

describe("formatDriveTime", () => {
  it("pads the minutes beside an hour", () => {
    expect(formatDriveTime(182)).toBe("3h 02m");
    expect(formatDriveTime(192)).toBe("3h 12m");
    expect(formatDriveTime(601)).toBe("10h 01m");
  });

  it("drops the hour when there isn't one", () => {
    expect(formatDriveTime(45)).toBe("45m");
    expect(formatDriveTime(0)).toBe("0m");
  });
});

describe("estimateRoute — the one surviving haversine", () => {
  it("is the fixture's Astoria → Newport drive", () => {
    const r = estimateRoute(ASTORIA, NEWPORT);
    expect(driveMiles(r)).toBe(108);
    expect(driveMinutes(r)).toBe(139);
    expect(driveLabel(r)).toBe("~2h 19m · 108 mi");
  });

  it("is the fixture's Newport → Bend drive", () => {
    const r = estimateRoute(NEWPORT, BEND);
    expect(driveMiles(r)).toBe(141);
    expect(driveMinutes(r)).toBe(182);
    expect(driveLabel(r)).toBe("~3h 02m · 141 mi");
  });

  it("tags itself as an estimate and carries no notices", () => {
    const r = estimateRoute(BEND, CRATER);
    expect(r.source).toBe("estimate");
    expect(r.notices).toEqual([]);
    expect(r.primaryRoad).toBeNull();
  });

  it("emits a two-point straight-line polyline", () => {
    expect(estimateRoute(NEWPORT, BEND).polyline).toBeTruthy();
  });

  it("is symmetric and zero for a stop routed to itself", () => {
    expect(estimateRoute(BEND, BEND).distanceMeters).toBe(0);
    expect(driveMiles(estimateRoute(NEWPORT, BEND))).toBe(driveMiles(estimateRoute(BEND, NEWPORT)));
  });
});

describe("StubRoutingProvider", () => {
  it("is the same arithmetic as estimateRoute — one implementation, not two", async () => {
    const stub = new StubRoutingProvider();
    expect(await stub.route(NEWPORT, BEND)).toEqual(estimateRoute(NEWPORT, BEND));
  });
});

describe("driveLabel", () => {
  it("drops the ~ once the drive is really routed", () => {
    expect(
      driveLabel({
        durationSeconds: 11_520,
        distanceMeters: 218_866,
        polyline: null,
        primaryRoad: "US-101",
        source: "here",
        notices: [],
      }),
    ).toBe("3h 12m · 136 mi");
  });
});
