import { describe, it, expect } from "vitest";
import { encodeFlexiblePolyline, decodeFlexiblePolyline, routeToGeoJSON } from "./polyline";
import { StubRoutingProvider, type RouteResult } from "./index";

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

describe("routeToGeoJSON — the corridor the map draws", () => {
  const ASTORIA = { lat: 46.1879, lng: -123.8313 };
  const NEWPORT = { lat: 44.6365, lng: -124.053 };

  /** A RouteResult carrying only what the geometry depends on. */
  function result(partial: Partial<RouteResult>): RouteResult {
    return {
      durationSeconds: 0,
      distanceMeters: 0,
      polyline: null,
      primaryRoad: null,
      source: "here",
      notices: [],
      ...partial,
    };
  }

  it("decodes a HERE polyline to N [lng,lat] positions in traversal order", () => {
    // HERE's published test vector — the same one the codec test above reads,
    // so this asserts the GeoJSON wrapper, not the decoder a second time.
    const line = routeToGeoJSON(
      result({ polyline: "BFoz5xJ67i1B1B7PzIhaxL7Y" }),
      ASTORIA,
      NEWPORT,
    );
    expect(line.type).toBe("LineString");
    expect(line.coordinates.length).toBeGreaterThan(2);
    expect(line.coordinates).toHaveLength(4);
    // [lng, lat] — GeoJSON's order, which is the REVERSE of LatLng's.
    expect(line.coordinates[0]![0]).toBeCloseTo(8.69821, 5);
    expect(line.coordinates[0]![1]).toBeCloseTo(50.10228, 5);
    expect(line.coordinates[3]![0]).toBeCloseTo(8.68752, 5);
    expect(line.coordinates[3]![1]).toBeCloseTo(50.09878, 5);
  });

  it("keeps a StubRoutingProvider estimate at exactly two positions — the chord", async () => {
    // The estimate path is unchanged BY CONSTRUCTION: the stub encodes its two
    // endpoints, so the decode gives the same two-point straight segment the
    // map has always drawn.
    const estimate = await new StubRoutingProvider().route(ASTORIA, NEWPORT);
    const line = routeToGeoJSON(estimate, ASTORIA, NEWPORT);
    expect(line.coordinates).toHaveLength(2);
    expect(line.coordinates[0]![0]).toBeCloseTo(ASTORIA.lng, 5);
    expect(line.coordinates[0]![1]).toBeCloseTo(ASTORIA.lat, 5);
    expect(line.coordinates[1]![0]).toBeCloseTo(NEWPORT.lng, 5);
    expect(line.coordinates[1]![1]).toBeCloseTo(NEWPORT.lat, 5);
  });

  it("falls back to the two endpoints when the result carries no polyline", () => {
    expect(routeToGeoJSON(result({ polyline: null }), ASTORIA, NEWPORT)).toEqual({
      type: "LineString",
      coordinates: [
        [ASTORIA.lng, ASTORIA.lat],
        [NEWPORT.lng, NEWPORT.lat],
      ],
    });
  });

  it("falls back to the two endpoints when the vendor's polyline is unreadable", () => {
    // decodeFlexiblePolyline degrades garbage to [] rather than throwing; a
    // corridor we cannot read is a chord, never a missing line.
    expect(routeToGeoJSON(result({ polyline: "!!!!" }), ASTORIA, NEWPORT).coordinates).toEqual([
      [ASTORIA.lng, ASTORIA.lat],
      [NEWPORT.lng, NEWPORT.lat],
    ]);
  });
});
