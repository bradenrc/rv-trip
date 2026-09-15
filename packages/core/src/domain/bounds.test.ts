import { describe, it, expect } from "vitest";
import {
  boundsCovers,
  boundsFor,
  boundsKey,
  hasCoords,
  spiderfy,
  MIN_BOUNDS_SPAN,
  SPIDER_RADIUS_PX,
  type SpiderPoint,
} from "./bounds";

describe("boundsFor", () => {
  it("returns null for no points — there is nothing to fit", () => {
    expect(boundsFor([])).toBeNull();
  });

  it("pads a single point to a finite span (no infinite-zoom fit)", () => {
    const b = boundsFor([{ lat: 46.1879, lng: -123.8313 }])!;
    expect(b.north - b.south).toBeCloseTo(MIN_BOUNDS_SPAN, 10);
    expect(b.east - b.west).toBeCloseTo(MIN_BOUNDS_SPAN, 10);
    // still centred on the point
    expect((b.north + b.south) / 2).toBeCloseTo(46.1879, 10);
    expect((b.east + b.west) / 2).toBeCloseTo(-123.8313, 10);
  });

  it("pads several points that share one coordinate", () => {
    const b = boundsFor([
      { lat: 44.0582, lng: -121.3153 },
      { lat: 44.0582, lng: -121.3153 },
    ])!;
    expect(b.north - b.south).toBeCloseTo(MIN_BOUNDS_SPAN, 10);
  });

  it("encloses every point when the span is real", () => {
    // Astoria, Newport, Bend — the Pacific Northwest Loop's scheduled stops.
    const b = boundsFor([
      { lat: 46.1879, lng: -123.8313 },
      { lat: 44.6365, lng: -124.053 },
      { lat: 44.0582, lng: -121.3153 },
    ])!;
    expect(b).toEqual({ west: -124.053, south: 44.0582, east: -121.3153, north: 46.1879 });
  });

  it("does not pad an axis that already spans the minimum", () => {
    const b = boundsFor([
      { lat: 0, lng: 0 },
      { lat: MIN_BOUNDS_SPAN, lng: MIN_BOUNDS_SPAN },
    ])!;
    expect(b).toEqual({ west: 0, south: 0, east: MIN_BOUNDS_SPAN, north: MIN_BOUNDS_SPAN });
  });

  it("clamps padding to the legal latitude range", () => {
    const b = boundsFor([{ lat: 90, lng: 0 }])!;
    expect(b.north).toBe(90);
    expect(b.south).toBeCloseTo(90 - MIN_BOUNDS_SPAN / 2, 10);
  });
});

describe("hasCoords", () => {
  it("rejects a coordless place and accepts a located one", () => {
    expect(hasCoords({ lat: null, lng: null })).toBe(false);
    expect(hasCoords({ lat: 44.0582, lng: null })).toBe(false);
    expect(hasCoords({ lat: 44.0582, lng: -121.3153 })).toBe(true);
  });
});

describe("spiderfy", () => {
  const bend: SpiderPoint = { id: "stop-bend", lat: 44.0582, lng: -121.3153, anchor: true };
  const sunnys: SpiderPoint = { id: "place-sunnys", lat: 44.0582, lng: -121.3153 };

  it("leaves an uncontested point exactly where it is", () => {
    const [p] = spiderfy([bend]);
    expect(p).toEqual({ id: "stop-bend", lat: 44.0582, lng: -121.3153, dx: 0, dy: 0, spiderfied: false });
  });

  it("keeps the trip stop on its true point and moves the saved place", () => {
    const out = spiderfy([sunnys, bend]);
    const stop = out.find((p) => p.id === "stop-bend")!;
    const place = out.find((p) => p.id === "place-sunnys")!;
    expect(stop.spiderfied).toBe(false);
    expect(stop.dx).toBe(0);
    expect(stop.dy).toBe(0);
    expect(place.spiderfied).toBe(true);
    expect(Math.hypot(place.dx, place.dy)).toBeCloseTo(SPIDER_RADIUS_PX, 1);
    // the true coordinate is untouched — the leader line needs it
    expect(place.lat).toBe(44.0582);
    expect(place.lng).toBe(-121.3153);
  });

  it("is deterministic regardless of input order", () => {
    const a = spiderfy([sunnys, bend]).map((p) => `${p.id}:${p.dx}:${p.dy}`).sort();
    const b = spiderfy([bend, sunnys]).map((p) => `${p.id}:${p.dx}:${p.dy}`).sort();
    expect(a).toEqual(b);
  });

  it("preserves the caller's order in the result", () => {
    expect(spiderfy([sunnys, bend]).map((p) => p.id)).toEqual(["place-sunnys", "stop-bend"]);
  });

  it("falls back to the lowest id as anchor when no member is a trip stop", () => {
    const out = spiderfy([
      { id: "b", lat: 44.5647, lng: -110.3735 },
      { id: "a", lat: 44.5647, lng: -110.3735 },
    ]);
    expect(out.find((p) => p.id === "a")!.spiderfied).toBe(false);
    expect(out.find((p) => p.id === "b")!.spiderfied).toBe(true);
  });

  it("spreads three co-located pins at even angles", () => {
    const out = spiderfy([
      { id: "anchor", lat: 1, lng: 1, anchor: true },
      { id: "x", lat: 1, lng: 1 },
      { id: "y", lat: 1, lng: 1 },
    ]);
    const x = out.find((p) => p.id === "x")!;
    const y = out.find((p) => p.id === "y")!;
    const angle = (p: { dx: number; dy: number }) => Math.atan2(p.dy, p.dx);
    const delta = Math.abs(angle(y) - angle(x));
    expect(Math.min(delta, 2 * Math.PI - delta)).toBeCloseTo(Math.PI, 2);
  });

  it("groups at 5dp — a 6th-decimal difference collides, a 5th-decimal one does not", () => {
    const collide = spiderfy([
      { id: "a", lat: 44.05820, lng: -121.31530, anchor: true },
      { id: "b", lat: 44.058204, lng: -121.315301 },
    ]);
    expect(collide.find((p) => p.id === "b")!.spiderfied).toBe(true);

    const apart = spiderfy([
      { id: "a", lat: 44.05820, lng: -121.31530, anchor: true },
      { id: "b", lat: 44.05824, lng: -121.31530 },
    ]);
    expect(apart.every((p) => !p.spiderfied)).toBe(true);
  });

  it("resolves all four collisions the seed carries", () => {
    // Bend / Sunny's · Crater Lake / Rim Drive · Fishing Bridge stop / RV Park ·
    // Newport on two trips (packages/db/src/seed.ts).
    const out = spiderfy([
      { id: "stop-bend", lat: 44.0582, lng: -121.3153, anchor: true },
      { id: "place-sunnys", lat: 44.0582, lng: -121.3153 },
      { id: "stop-crater", lat: 42.9446, lng: -122.109, anchor: true },
      { id: "place-rim", lat: 42.9446, lng: -122.109 },
      { id: "stop-fishing-bridge", lat: 44.5647, lng: -110.3735, anchor: true },
      { id: "place-fb-rv", lat: 44.5647, lng: -110.3735 },
      { id: "stop-newport-pnw", lat: 44.6365, lng: -124.053, anchor: true },
      { id: "stop-newport-weekend", lat: 44.6365, lng: -124.053 },
    ]);
    const moved = out.filter((p) => p.spiderfied).map((p) => p.id);
    expect(moved).toEqual(["place-sunnys", "place-rim", "place-fb-rv", "stop-newport-weekend"]);
    // and every pair now sits SPIDER_RADIUS_PX apart on screen
    for (const p of out.filter((q) => q.spiderfied)) {
      expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(SPIDER_RADIUS_PX, 1);
    }
  });
});

/**
 * #80 i4 — the shelf lets an idea sit anywhere on the trip, not only beside a
 * stop, so the pin set can now grow a genuine outlier. These pin the two
 * properties the refit rests on: the box still holds EVERY pin, and it does not
 * collapse to the degenerate floor on the way.
 */
describe("boundsFor — a far-flung idea joins the pin set", () => {
  // The Pacific Northwest Loop's three scheduled stops.
  const trip = [
    { lat: 46.1879, lng: -123.8313 }, // Astoria
    { lat: 44.6365, lng: -124.053 }, // Newport
    { lat: 44.0582, lng: -121.3153 }, // Bend
  ];
  // A shelf idea parked a long way off — Moab, UT.
  const farFlung = { lat: 38.5733, lng: -109.5498 };

  it("still encloses every pin, the outlier included", () => {
    const b = boundsFor([...trip, farFlung])!;
    for (const p of [...trip, farFlung]) {
      expect(p.lat).toBeGreaterThanOrEqual(b.south);
      expect(p.lat).toBeLessThanOrEqual(b.north);
      expect(p.lng).toBeGreaterThanOrEqual(b.west);
      expect(p.lng).toBeLessThanOrEqual(b.east);
    }
    expect(b).toEqual({ west: -124.053, south: 38.5733, east: -109.5498, north: 46.1879 });
  });

  it("grows the fit rather than collapsing it", () => {
    const before = boundsFor(trip)!;
    const after = boundsFor([...trip, farFlung])!;
    const span = (b: typeof before) => ({ lat: b.north - b.south, lng: b.east - b.west });
    expect(span(after).lat).toBeGreaterThan(span(before).lat);
    expect(span(after).lng).toBeGreaterThan(span(before).lng);
    // and neither axis is anywhere near the degenerate floor
    expect(span(after).lat).toBeGreaterThan(MIN_BOUNDS_SPAN);
    expect(span(after).lng).toBeGreaterThan(MIN_BOUNDS_SPAN);
  });

  it("a near idea moves nothing the trip's own stops did not already cover", () => {
    // An idea a couple of miles from Bend, inside the box the stops already make.
    const near = { lat: 44.0601, lng: -121.3402 };
    expect(boundsFor([...trip, near])).toEqual(boundsFor(trip));
  });
});

describe("boundsKey", () => {
  it("is the same string for the same box and differs when the box moves", () => {
    const a = boundsFor([{ lat: 44, lng: -121 }, { lat: 46, lng: -123 }]);
    const b = boundsFor([{ lat: 44, lng: -121 }, { lat: 46, lng: -123 }]);
    const c = boundsFor([{ lat: 44, lng: -121 }, { lat: 47, lng: -123 }]);
    expect(boundsKey(a)).toBe(boundsKey(b));
    expect(boundsKey(a)).not.toBe(boundsKey(c));
  });

  it("is the empty string when there is nothing to fit", () => {
    expect(boundsKey(null)).toBe("");
  });
});

describe("boundsCovers — the refit guard", () => {
  const shown = { west: -125, south: 43, east: -120, north: 47 };

  it("is true when the box on screen already holds the new one", () => {
    expect(boundsCovers(shown, { west: -124, south: 44, east: -121, north: 46 })).toBe(true);
  });

  it("is true for an identical box — a refit would reveal nothing", () => {
    expect(boundsCovers(shown, { ...shown })).toBe(true);
  });

  it("is false when a far-flung idea pushes the new box outside", () => {
    // Moab is south and east of everything the camera is showing.
    expect(boundsCovers(shown, { west: -125, south: 38.5733, east: -109.5498, north: 47 })).toBe(
      false,
    );
  });

  it("is false when the boxes merely overlap", () => {
    expect(boundsCovers(shown, { west: -130, south: 44, east: -124, north: 46 })).toBe(false);
  });

  it("covers nothing when there is no camera box yet, and everything when there is nothing to show", () => {
    expect(boundsCovers(null, shown)).toBe(false);
    expect(boundsCovers(shown, null)).toBe(true);
    expect(boundsCovers(null, null)).toBe(true);
  });
});

/**
 * #80 i4 — an idea pinned at the very place its stop sits (the picker hands
 * back the campground's own coordinate often enough). `MapView` passes
 * `anchor: p.kind === "stop"`, so the commitment must keep the true point and
 * the maybe must be the one that moves.
 */
describe("spiderfy — an idea sharing a stop's exact coordinate", () => {
  const stop: SpiderPoint = { id: "stop-bend", lat: 44.0582, lng: -121.3153, anchor: true };
  const idea: SpiderPoint = { id: "idea-float", lat: 44.0582, lng: -121.3153 };

  it("resolves to two distinct screen points with the stop as the anchor", () => {
    const out = spiderfy([stop, idea]);
    const s = out.find((p) => p.id === "stop-bend")!;
    const i = out.find((p) => p.id === "idea-float")!;

    expect(s.spiderfied).toBe(false);
    expect([s.dx, s.dy]).toEqual([0, 0]);
    expect(i.spiderfied).toBe(true);
    // two points, not one: the drawn positions differ by the ring radius
    expect(Math.hypot(i.dx - s.dx, i.dy - s.dy)).toBeCloseTo(SPIDER_RADIUS_PX, 1);
    // both still hang off the one true coordinate — the leader needs it
    expect([i.lat, i.lng]).toEqual([stop.lat, stop.lng]);
  });

  it("anchors on the stop whichever order the pins arrive in", () => {
    const a = spiderfy([stop, idea]).find((p) => p.id === "idea-float")!;
    const b = spiderfy([idea, stop]).find((p) => p.id === "idea-float")!;
    expect([a.dx, a.dy]).toEqual([b.dx, b.dy]);
    expect(spiderfy([idea, stop]).find((p) => p.id === "stop-bend")!.spiderfied).toBe(false);
  });
});
