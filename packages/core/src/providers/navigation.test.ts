import { describe, it, expect } from "vitest";
import { buildNavigationHandoff } from "./navigation";
import { CORRIDOR_TOLERANCE_METERS } from "./frechet";
import { haversineMeters, type LatLng } from "./index";

const NEWPORT = { lat: 44.6365, lng: -124.053 };
const BEND = { lat: 44.0582, lng: -121.3153 };

/** A synthetic HERE corridor: a west→east track between the two endpoints. */
const CORRIDOR: LatLng[] = Array.from({ length: 12 }, (_, i) => ({
  lat: 44.5,
  lng: -124.0 + i * 0.2,
}));
const METERS_PER_DEG_LAT = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
/** The same track, moved `meters` due north — a known deviation, in meters. */
function offsetNorth(points: LatLng[], meters: number): LatLng[] {
  return points.map((p) => ({ lat: p.lat + meters / METERS_PER_DEG_LAT, lng: p.lng }));
}

describe("buildNavigationHandoff", () => {
  it("is a plain origin/destination driving link", () => {
    expect(buildNavigationHandoff(NEWPORT, BEND).url).toBe(
      "https://www.google.com/maps/dir/?api=1&origin=44.6365,-124.0530&destination=44.0582,-121.3153&travelmode=driving",
    );
  });

  it("never carries an intermediate waypoint", () => {
    // Google's URL scheme has no pass-through waypoint: anything in
    // `waypoints=` becomes a destination and gets snapped to an address, which
    // testing showed lands drivers on farm lanes and forest roads. The
    // corridor-faithful handoff is a fast-follow, server-side; this link is
    // origin → destination and nothing else.
    const url = buildNavigationHandoff(NEWPORT, BEND).url;
    expect(url).not.toContain("waypoints");
    expect(url.split("&")).toHaveLength(4);
  });

  it("formats both coordinates to 4 decimal places", () => {
    const { url } = buildNavigationHandoff(
      { lat: 44.63651234, lng: -124.05299999 },
      { lat: 0, lng: 0 },
    );
    expect(url).toContain("origin=44.6365,-124.0530");
    expect(url).toContain("destination=0.0000,0.0000");
  });

  it("takes an options object without changing today's link (the v2 seam)", () => {
    // v2 (server-validated corridor intermediates, a HERE WeGo option) extends
    // the options object — call sites must not have to change again.
    expect(buildNavigationHandoff(NEWPORT, BEND, {}).url).toBe(
      buildNavigationHandoff(NEWPORT, BEND).url,
    );
  });

  it("is pure — same input, same link, no network", () => {
    expect(buildNavigationHandoff(NEWPORT, BEND)).toEqual(buildNavigationHandoff(NEWPORT, BEND));
  });
});

describe("buildNavigationHandoff · the corridor verdict", () => {
  /** Today's link, byte for byte — the thing every new case is held against. */
  const PLAIN_URL =
    "https://www.google.com/maps/dir/?api=1&origin=44.6365,-124.0530&destination=44.0582,-121.3153&travelmode=driving";

  it("is 'plain' with no corridor, and its Google url is byte-identical to today's", () => {
    const h = buildNavigationHandoff(NEWPORT, BEND);
    expect(h.verdict).toBe("plain");
    expect(h.deviationMeters).toBeNull();
    expect(h.url).toBe(PLAIN_URL);
  });

  it("is 'plain' with a corridor but no check — a corridor is not a verdict", () => {
    const h = buildNavigationHandoff(NEWPORT, BEND, { corridor: CORRIDOR });
    expect(h.verdict).toBe("plain");
    expect(h.deviationMeters).toBeNull();
    expect(h.url).toBe(PLAIN_URL);
  });

  it("is 'checked' given a corridor and a validated deviation, with both urls", () => {
    const h = buildNavigationHandoff(NEWPORT, BEND, {
      corridor: CORRIDOR,
      deviationMeters: 180,
    });
    expect(h.verdict).toBe("checked");
    expect(h.deviationMeters).toBe(180);
    expect(h.url).toBe(PLAIN_URL);
    expect(h.wegoUrl).toBe(
      "https://wego.here.com/directions/drive/44.6365,-124.0530/44.0582,-121.3153",
    );
  });

  it("measures the deviation itself when handed both geometries — pure, no network", () => {
    const inside = buildNavigationHandoff(NEWPORT, BEND, {
      corridor: CORRIDOR,
      googleCorridor: offsetNorth(CORRIDOR, 180),
    });
    expect(inside.deviationMeters).toBeCloseTo(180, 6);
    expect(inside.verdict).toBe("checked");

    const outside = buildNavigationHandoff(NEWPORT, BEND, {
      corridor: CORRIDOR,
      googleCorridor: offsetNorth(CORRIDOR, 1340),
    });
    expect(outside.deviationMeters).toBeCloseTo(1340, 6);
    expect(outside.verdict).toBe("plain");
  });

  it("applies the 400 m threshold on both sides, inclusively", () => {
    const verdict = (deviationMeters: number) =>
      buildNavigationHandoff(NEWPORT, BEND, { corridor: CORRIDOR, deviationMeters }).verdict;
    expect(verdict(CORRIDOR_TOLERANCE_METERS - 1)).toBe("checked");
    expect(verdict(CORRIDOR_TOLERANCE_METERS)).toBe("checked");
    expect(verdict(CORRIDOR_TOLERANCE_METERS + 1)).toBe("plain");
  });

  it("carries the WeGo url in every state — it is the alternative, not a reward", () => {
    for (const options of [
      {},
      { corridor: CORRIDOR },
      { corridor: CORRIDOR, deviationMeters: 2140 },
      { corridor: CORRIDOR, deviationMeters: 180 },
    ]) {
      expect(buildNavigationHandoff(NEWPORT, BEND, options).wegoUrl).toBe(
        "https://wego.here.com/directions/drive/44.6365,-124.0530/44.0582,-121.3153",
      );
    }
  });

  it("never says 'checked' on a degenerate corridor", () => {
    // One point is not a traversal; an empty one is not a corridor. Both are
    // "not checked" rather than a lucky 0.
    const single = [CORRIDOR[0]!];
    expect(
      buildNavigationHandoff(NEWPORT, BEND, { corridor: single, googleCorridor: single }).verdict,
    ).toBe("plain");
    expect(
      buildNavigationHandoff(NEWPORT, BEND, { corridor: [], googleCorridor: [] }).deviationMeters,
    ).toBeNull();
  });
});
