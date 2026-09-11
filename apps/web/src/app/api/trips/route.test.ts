import { expect, it } from "vitest";
import {
  NO_ROUTING_HASH,
  driveMiles,
  estimateRoute,
  routeCacheKey,
  type RouteResult,
} from "@rv-trip/core";
import { tripSummaryListSchema } from "@rv-trip/core/api-client";
import { putCachedRoutes } from "@rv-trip/db";
import { fx } from "@rv-trip/db/testing";
import { GET } from "@/app/api/trips/route";
import { describeDb } from "@/test/db";

/**
 * §6 the four derivation cases, from the same pinned clock — the cheapest way
 * to prove `deriveTripStatus` at the handler level. `today` is "2026-08-15" in
 * every timezone, because `todayIso()` slices `toISOString()`.
 */
describeDb("GET /api/trips — derived status", () => {
  it("derives every row's status from the pinned clock", async () => {
    // endDate >= today, and daysUntil(start) = -14 <= 30 — the window test is
    // a one-sided <=, so a trip already under way reads "upcoming".
    const underway = await fx.trip({
      title: "Pacific Northwest Loop",
      startDate: "2026-08-01",
      endDate: "2026-08-28",
    });
    // endDate < today — the first branch.
    const ended = await fx.trip({
      title: "June shakedown",
      startDate: "2026-06-01",
      endDate: "2026-06-20",
    });
    // daysUntil(start) = 47 > UPCOMING_WINDOW_DAYS (30).
    const far = await fx.trip({
      title: "October canyons",
      startDate: "2026-10-01",
      endDate: "2026-10-20",
    });
    // The pin wins outright — this is what seed.ts:24 does to keep the demo
    // trip live.
    const pinned = await fx.trip({
      title: "Pinned demo",
      startDate: "2026-06-01",
      endDate: "2026-06-20",
      status: "planning",
      statusAuto: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const rows = tripSummaryListSchema.parse(await res.json());
    const status = new Map(rows.map((r) => [r.id, r.status]));

    expect(status.get(underway.id)).toBe("upcoming");
    expect(status.get(ended.id)).toBe("complete");
    expect(status.get(far.id)).toBe("planning");
    expect(status.get(pinned.id)).toBe("planning");
  });
});

/**
 * §3 the card's miles number, end to end: `listTripsForOwner` reads the route
 * cache (never the provider — landing on the dashboard cannot cost money) and
 * takes its number from `routeSummary().driveMiles` over `orderedPairs`.
 *
 * The two gaps this closes are both asserted on the real listing: the pair set
 * (the drive to a FLOATING stop was never counted) and the metric (a chord,
 * not the road HERE routed).
 */
describeDb("GET /api/trips — the miles chip", () => {
  const ASTORIA = { lat: 46.1879, lng: -123.8313 };
  const NEWPORT = { lat: 44.6365, lng: -124.053 };
  const BEND = { lat: 44.0582, lng: -121.3153 };
  const CRATER = { lat: 42.9446, lng: -122.109 };
  // No rig fixture on this account, so the routing half of the key is the
  // sentinel — the same key the page would read.
  const key = (from: typeof ASTORIA, to: typeof ASTORIA) =>
    routeCacheKey(from, to, NO_ROUTING_HASH);
  const routed = (meters: number): RouteResult => ({
    durationSeconds: 11_520,
    distanceMeters: meters,
    polyline: null,
    primaryRoad: "US-101",
    source: "here",
    notices: [],
  });

  /** The seed trip plus its floating stop: 3 pairs, the last one floating. */
  async function loopWithFloatingStop() {
    const loop = await fx.pacificNorthwestLoop();
    await fx.stop({
      legId: loop.legMountains.id,
      placeName: "Crater Lake NP",
      lat: CRATER.lat,
      lng: CRATER.lng,
      arriveDate: null,
      departDate: null,
      sortOrder: 1,
    });
    return loop;
  }

  async function row(id: string) {
    const res = await GET();
    expect(res.status).toBe(200);
    const rows = tripSummaryListSchema.parse(await res.json());
    return rows.find((r) => r.id === id)!;
  }

  it("counts the drive to the floating stop, and says it is estimating", async () => {
    const loop = await loopWithFloatingStop();

    const summary = await row(loop.trip.id);

    const allThree =
      driveMiles(estimateRoute(ASTORIA, NEWPORT)) +
      driveMiles(estimateRoute(NEWPORT, BEND)) +
      driveMiles(estimateRoute(BEND, CRATER));
    expect(summary.miles).toBe(allThree);
    // The scheduled-only pair set the card used to sum is strictly smaller.
    expect(summary.miles).toBeGreaterThan(
      driveMiles(estimateRoute(ASTORIA, NEWPORT)) + driveMiles(estimateRoute(NEWPORT, BEND)),
    );
    expect(summary.milesEstimated).toBe(true);
  });

  it("takes the ROUTED distance for every pair the cache answers", async () => {
    const loop = await loopWithFloatingStop();
    // 136 mi of US-101, 185 of US-20, 106 to Crater Lake — every pair cached,
    // so nothing falls back and the chip goes away.
    await putCachedRoutes([
      { key: key(ASTORIA, NEWPORT), result: routed(218_866) },
      { key: key(NEWPORT, BEND), result: routed(297_729) },
      { key: key(BEND, CRATER), result: routed(170_589) },
    ]);

    const summary = await row(loop.trip.id);

    expect(summary.miles).toBe(136 + 185 + 106);
    expect(summary.milesEstimated).toBe(false);
  });

  it("mixes layers on one row — one hit, two misses, still flagged", async () => {
    const loop = await loopWithFloatingStop();
    await putCachedRoutes([{ key: key(ASTORIA, NEWPORT), result: routed(218_866) }]);

    const summary = await row(loop.trip.id);

    expect(summary.miles).toBe(
      136 +
        driveMiles(estimateRoute(NEWPORT, BEND)) +
        driveMiles(estimateRoute(BEND, CRATER)),
    );
    expect(summary.milesEstimated).toBe(true);
  });

  it("a trip with no routable pair is zero miles and is NOT estimating", async () => {
    // One stop, so `orderedPairs` is empty: nothing fell back, because nothing
    // was asked for. No chip on a card with no drives.
    const trip = await fx.trip({ title: "One-stop overnight" });
    const leg = await fx.leg({ tripId: trip.id });
    await fx.stop({ legId: leg.id });

    const summary = await row(trip.id);

    expect(summary.miles).toBe(0);
    expect(summary.milesEstimated).toBe(false);
  });
});
