import { describe, it, expect } from "vitest";
import { encodeFlexiblePolyline, decodeFlexiblePolyline } from "./polyline";

describe("flexible polyline", () => {
  it("round-trips a two-point straight line (the stub's polyline)", () => {
    const points = [
      { lat: 44.6365, lng: -124.053 },
      { lat: 44.0582, lng: -121.3153 },
    ];
    const decoded = decodeFlexiblePolyline(encodeFlexiblePolyline(points));
    expect(decoded).toHaveLength(2);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 5);
      expect(p.lng).toBeCloseTo(points[i]!.lng, 5);
    });
  });

  it("round-trips a many-point path without accumulating drift", () => {
    const points = Array.from({ length: 200 }, (_, i) => ({
      lat: 44.6365 + i * 0.0031,
      lng: -124.053 + i * 0.0047,
    }));
    const decoded = decodeFlexiblePolyline(encodeFlexiblePolyline(points));
    expect(decoded).toHaveLength(200);
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 5);
      expect(p.lng).toBeCloseTo(points[i]!.lng, 5);
    });
  });

  it("round-trips across the antimeridian and the equator", () => {
    const points = [
      { lat: -0.0001, lng: 179.9998 },
      { lat: 0.0001, lng: -179.9998 },
    ];
    const decoded = decodeFlexiblePolyline(encodeFlexiblePolyline(points));
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 5);
      expect(p.lng).toBeCloseTo(points[i]!.lng, 5);
    });
  });

  it("encodes an empty path as an empty string, and decodes it back", () => {
    expect(encodeFlexiblePolyline([])).toBe("");
    expect(decodeFlexiblePolyline("")).toEqual([]);
  });

  it("decodes garbage to nothing rather than throwing (a vendor response we can't read is a degradation, not a crash)", () => {
    expect(decodeFlexiblePolyline("!!!!")).toEqual([]);
  });

  it("decodes HERE's published test vector", () => {
    // From HERE's flexible-polyline reference implementation README. This is the
    // one assertion here that checks vendor compatibility rather than internal
    // consistency; no live HERE call was made from this worktree.
    const decoded = decodeFlexiblePolyline("BFoz5xJ67i1B1B7PzIhaxL7Y");
    expect(decoded).toHaveLength(4);
    expect(decoded[0]!.lat).toBeCloseTo(50.10228, 5);
    expect(decoded[0]!.lng).toBeCloseTo(8.69821, 5);
    expect(decoded[3]!.lat).toBeCloseTo(50.09878, 5);
    expect(decoded[3]!.lng).toBeCloseTo(8.68752, 5);
  });
});
