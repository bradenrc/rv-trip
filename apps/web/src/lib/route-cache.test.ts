import { expect, it } from "vitest";
import { routeCacheKey, type RouteResult } from "@rv-trip/core";
import { getCachedRoutes, putCachedRoutes } from "@rv-trip/db";
import { fx, read } from "@rv-trip/db/testing";
import { describeDb } from "@/test/db";

/**
 * Layer 2 of the route cache against real Postgres (docs/design/43 §1) — the
 * half routing.test.ts fakes. It lives in this suite because apps/web owns the
 * only harness with a database: global-setup builds a throwaway one from the
 * checked-in migrations, so this also proves `0001_route_cache.sql` applies.
 *
 * The TTL is the reason it is worth a real database: `fetched_at > now() - 30
 * days` is a SQL comparison on the SQL clock, and a fake db cannot check that
 * a row written today survives it while one written 31 days ago does not.
 */

const HASH = "4f2ac1";
const astoria = { lat: 46.1879, lng: -123.8313 };
const newport = { lat: 44.6365, lng: -124.053 };
const KEY = routeCacheKey(astoria, newport, HASH);

/** The design's own worked row: Astoria → Newport, Class A. */
const ASTORIA_NEWPORT: RouteResult = {
  durationSeconds: 11_520,
  distanceMeters: 218_866,
  polyline: "BG0y_pgDh_p",
  primaryRoad: "US-101",
  source: "here",
  notices: [],
};

describeDb("the routes cache", () => {
  it("round-trips a RouteResult verbatim through jsonb", async () => {
    await putCachedRoutes([{ key: KEY, result: ASTORIA_NEWPORT }]);

    const hit = await getCachedRoutes([KEY]);

    // Verbatim is the contract #35 depends on: the polyline it draws has been
    // arriving since #9 and must survive the cache untouched.
    expect(hit[KEY]).toEqual(ASTORIA_NEWPORT);
  });

  it("stores nothing for an `estimate` — a failed vendor call must not poison the key", async () => {
    await putCachedRoutes([
      { key: KEY, result: { ...ASTORIA_NEWPORT, source: "estimate", polyline: null } },
    ]);

    expect(await getCachedRoutes([KEY])).toEqual({});
  });

  it("answers only for the keys asked for, and misses are simply absent", async () => {
    await putCachedRoutes([{ key: KEY, result: ASTORIA_NEWPORT }]);

    const hit = await getCachedRoutes([KEY, routeCacheKey(newport, astoria, HASH)]);

    expect(Object.keys(hit)).toEqual([KEY]);
    expect(await getCachedRoutes([])).toEqual({}); // no keys, no query
  });

  it("expires a row past the 30-day TTL rather than sweeping it", async () => {
    await putCachedRoutes([{ key: KEY, result: ASTORIA_NEWPORT }]);
    await fx.ageCachedRoute(KEY, 31);

    expect(await getCachedRoutes([KEY])).toEqual({}); // read as a miss…

    // …and re-fetching upserts the same row back to fresh, which is why the
    // epic ships no deleter.
    await putCachedRoutes([{ key: KEY, result: { ...ASTORIA_NEWPORT, distanceMeters: 219_000 } }]);

    expect((await getCachedRoutes([KEY]))[KEY]!.distanceMeters).toBe(219_000);
    expect(await read.countRoutes()).toBe(1); // one key, one row
  });

  it("keeps a row that is inside the window", async () => {
    await putCachedRoutes([{ key: KEY, result: ASTORIA_NEWPORT }]);
    await fx.ageCachedRoute(KEY, 29);

    expect((await getCachedRoutes([KEY]))[KEY]).toEqual(ASTORIA_NEWPORT);
  });
});
