import { describe, it, expect } from "vitest";
import { CORRIDOR_TOLERANCE_METERS, discreteFrechet, withinCorridor } from "./frechet";
import { haversineMeters, type LatLng } from "./index";

/**
 * The acceptance's test table (docs/design/43 §4). Every distance here is
 * arithmetic, not a vendor measurement — there are no HERE or Google
 * credentials in this worktree, so the corridors are synthetic tracks whose
 * offsets are known in meters before the assertion runs.
 */

/** A west→east track along a parallel; 0.01° of longitude apart per vertex. */
function track(lat: number, lng0: number, n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat, lng: lng0 + i * 0.01 }));
}

/** One degree of LATITUDE, in meters, on the sphere the codebase routes on. */
const METERS_PER_DEG_LAT = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });

/** A parallel offset: the same track, moved `meters` due north. */
function offsetNorth(points: LatLng[], meters: number): LatLng[] {
  const dLat = meters / METERS_PER_DEG_LAT;
  return points.map((p) => ({ lat: p.lat + dLat, lng: p.lng }));
}

const CORRIDOR = track(45, -123.9, 12);

describe("discreteFrechet", () => {
  it("is zero for identical traversals", () => {
    expect(discreteFrechet(CORRIDOR, CORRIDOR)).toBe(0);
    expect(discreteFrechet(CORRIDOR, [...CORRIDOR])).toBe(0);
  });

  it("is huge for a REVERSED traversal of the very same point set", () => {
    // The property the whole choice of metric rests on. Hausdorff compares
    // point SETS and would answer 0 here — it would happily certify a route
    // that drives the corridor backwards. Fréchet compares traversals.
    const reversed = [...CORRIDOR].reverse();
    const sameSet = [...reversed].sort((a, b) => a.lng - b.lng);
    expect(sameSet).toEqual(CORRIDOR);

    const d = discreteFrechet(CORRIDOR, reversed);
    expect(d).toBeGreaterThan(CORRIDOR_TOLERANCE_METERS * 10);
    // …and it is the end-to-end span of the track, which is what "drove it
    // backwards" means as a distance.
    expect(d).toBeCloseTo(haversineMeters(CORRIDOR[0]!, CORRIDOR[CORRIDOR.length - 1]!), 3);
  });

  it("is exactly its offset for a parallel track", () => {
    for (const meters of [50, 111.195, 389, 1200]) {
      expect(discreteFrechet(CORRIDOR, offsetNorth(CORRIDOR, meters))).toBeCloseTo(meters, 6);
    }
  });

  it("is symmetric, and a sparser traversal of the same ground still passes", () => {
    const other = offsetNorth(CORRIDOR, 250);
    expect(discreteFrechet(other, CORRIDOR)).toBeCloseTo(discreteFrechet(CORRIDOR, other), 9);

    // This is the DISCRETE Fréchet distance: the coupling runs over VERTICES,
    // so a differently sampled track of the same ground costs the leash the
    // vertex spacing as well as the offset. Google's polyline is denser than
    // HERE's, which is the everyday case and why the tolerance is 400 m rather
    // than tens of meters — a 0.01° gap at this latitude is ~786 m, and half of
    // one still leaves the 250 m track inside the corridor.
    const fine = Array.from({ length: 40 }, (_, i) => ({ lat: 45, lng: -123.9 + i * 0.002 }));
    const sparse = offsetNorth(fine, 250).filter((_, i) => i % 2 === 0);
    const d = discreteFrechet(fine, sparse);
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThanOrEqual(CORRIDOR_TOLERANCE_METERS);
  });

  it("answers Infinity when either traversal is empty — never 0", () => {
    // An absent corridor is "not checked", and it must never read as a
    // perfect match.
    expect(discreteFrechet([], CORRIDOR)).toBe(Infinity);
    expect(discreteFrechet(CORRIDOR, [])).toBe(Infinity);
    expect(discreteFrechet([], [])).toBe(Infinity);
  });
});

describe("CORRIDOR_TOLERANCE_METERS", () => {
  it("is 400 m", () => {
    expect(CORRIDOR_TOLERANCE_METERS).toBe(400);
  });

  it("is asserted on both sides of the boundary", () => {
    const inside = discreteFrechet(CORRIDOR, offsetNorth(CORRIDOR, 399));
    const outside = discreteFrechet(CORRIDOR, offsetNorth(CORRIDOR, 401));
    expect(inside).toBeLessThanOrEqual(CORRIDOR_TOLERANCE_METERS);
    expect(outside).toBeGreaterThan(CORRIDOR_TOLERANCE_METERS);
    expect(withinCorridor(inside)).toBe(true);
    expect(withinCorridor(outside)).toBe(false);
    // The boundary itself is inclusive: 400 m is still the corridor.
    expect(withinCorridor(CORRIDOR_TOLERANCE_METERS)).toBe(true);
    expect(withinCorridor(null)).toBe(false);
    expect(withinCorridor(Infinity)).toBe(false);
  });
});
