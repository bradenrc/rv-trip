import { beforeEach, expect, it, describe, vi } from "vitest";
import {
  encodeFlexiblePolyline,
  routeCacheKey,
  type LatLng,
  type NavCheck,
  type RouteResult,
} from "@rv-trip/core";
import type { CachedNavCheck, CachedRoute } from "@rv-trip/db";

/**
 * The three-layer read path (docs/design/43 §1): in-process Map → `routes`
 * table → vendor. This is the only apps/web test with NO database: both seams
 * it exercises — the table and HERE — are the two things the issue exists to
 * stop calling, so they are the two things this file fakes. The real db suite
 * covers `getCachedRoutes`/`putCachedRoutes` (packages/db) against Postgres.
 *
 * Every case re-imports ./routing through `vi.resetModules()`, because the
 * in-process Map is module scope — a shared one would make "a db hit warms the
 * Map" pass on the previous test's leftovers.
 */

const seam = vi.hoisted(() => ({
  /** What the table answers with, per test. */
  persisted: new Map<string, RouteResult>(),
  reads: [] as string[][],
  writes: [] as { key: string; result: RouteResult }[][],
  /** Every vendor call — the number this whole issue is about. */
  providerCalls: [] as string[],
  /** What the fake vendor answers with, per test. */
  vendorSource: "here" as "here" | "estimate",
  /** The nav half: the `nav` column, its reads and writes, and every BILLABLE
   * Google check — the call this item must never make on /map. */
  navPersisted: new Map<string, NavCheck>(),
  navReads: [] as string[][],
  navWrites: [] as CachedNavCheck[][],
  navCalls: [] as string[],
  /** What the fake Google client concludes, per test. */
  navDeviation: 180 as number | null,
  /** Whether GOOGLE_API_KEY is configured, per test. */
  googleKey: true,
}));

/**
 * Only the two cache functions are faked. The rest of the module is the real
 * one (`importOriginal`), because `@rv-trip/db`'s own path is also how
 * `truncateAll` reaches the `db` handle from src/test/setup.ts — replacing the
 * whole module would break every other file's reset.
 */
vi.mock("@rv-trip/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@rv-trip/db")>()),
  getCachedRoutes: vi.fn(async (keys: string[]) => {
    seam.reads.push(keys);
    const map: Record<string, RouteResult> = {};
    for (const key of keys) {
      const hit = seam.persisted.get(key);
      if (hit) map[key] = hit;
    }
    return map;
  }),
  putCachedRoutes: vi.fn(async (rows: CachedRoute[]) => {
    seam.writes.push(rows);
    for (const row of rows) seam.persisted.set(row.key, row.result);
  }),
  getCachedNav: vi.fn(async (keys: string[]) => {
    seam.navReads.push(keys);
    const map: Record<string, NavCheck> = {};
    for (const key of keys) {
      const hit = seam.navPersisted.get(key);
      if (hit) map[key] = hit;
    }
    return map;
  }),
  putCachedNav: vi.fn(async (rows: CachedNavCheck[]) => {
    seam.navWrites.push(rows);
    for (const row of rows) seam.navPersisted.set(row.key, row.nav);
  }),
}));

vi.mock("@rv-trip/core/providers/google-places", () => ({
  googleCredentialsFromEnv: () => (seam.googleKey ? { apiKey: "fake" } : null),
}));

vi.mock("@rv-trip/core/providers/google-routes", () => ({
  GoogleRoutesProvider: class {
    async checkCorridor(from: LatLng, to: LatLng, corridor: LatLng[]): Promise<NavCheck> {
      seam.navCalls.push(`${from.lat},${from.lng}|${to.lat},${to.lng}|${corridor.length}`);
      return { deviationMeters: seam.navDeviation, intermediates: [] };
    }
  },
}));

vi.mock("@rv-trip/core/providers/here", () => ({
  // Credentials present, so routing.ts builds the HERE provider rather than
  // the straight-line stub — this fake stands in its place.
  hereCredentialsFromEnv: () => ({
    accessKeyId: "fake",
    accessKeySecret: "fake",
    tokenEndpoint: "https://fake.invalid/token",
  }),
  HereRoutingProvider: class {
    async route(from: LatLng, to: LatLng): Promise<RouteResult> {
      seam.providerCalls.push(`${from.lat},${from.lng}|${to.lat},${to.lng}`);
      return { ...result(218_866), source: seam.vendorSource };
    }
  },
}));

function result(distanceMeters: number): RouteResult {
  return {
    durationSeconds: 11_520,
    distanceMeters,
    // A real 4-vertex HERE corridor, because the nav cases below decode it.
    polyline: CORRIDOR,
    primaryRoad: "US-101",
    source: "here",
    notices: [],
  };
}

const HASH = "4f2ac1";
const astoria = { lat: 46.1879, lng: -123.8313 };
const newport = { lat: 44.6365, lng: -124.053 };
const KEY = routeCacheKey(astoria, newport, HASH);
const PAIRS = [{ from: astoria, to: newport }];
const CORRIDOR = encodeFlexiblePolyline([
  astoria,
  { lat: 45.7208, lng: -123.9377 },
  { lat: 45.2019, lng: -123.9611 },
  newport,
]);

/** A fresh module instance, so the in-process Map starts empty. */
async function freshRoutePairs() {
  vi.resetModules();
  return (await import("./routing")).routePairs;
}

beforeEach(() => {
  seam.persisted.clear();
  seam.reads.length = 0;
  seam.writes.length = 0;
  seam.providerCalls.length = 0;
  seam.vendorSource = "here";
  seam.navPersisted.clear();
  seam.navReads.length = 0;
  seam.navWrites.length = 0;
  seam.navCalls.length = 0;
  seam.navDeviation = 180;
  seam.googleKey = true;
});

describe("routePairs: memory → db → provider", () => {
  it("routes a cold pair, then writes the `here` result through", async () => {
    const routePairs = await freshRoutePairs();

    const routes = await routePairs(PAIRS, null, HASH);

    expect(Object.keys(routes)).toEqual([KEY]);
    expect(routes[KEY]!.distanceMeters).toBe(218_866);
    expect(seam.reads).toEqual([[KEY]]); // the table was asked, and missed
    expect(seam.providerCalls).toHaveLength(1); // billed exactly once
    expect(seam.writes).toEqual([[{ key: KEY, result: routes[KEY] }]]);
  });

  it("does NOT write an `estimate` through — a failed vendor call must not poison the key", async () => {
    seam.vendorSource = "estimate";
    const routePairs = await freshRoutePairs();

    const routes = await routePairs(PAIRS, null, HASH);

    expect(routes[KEY]!.source).toBe("estimate"); // honestly tagged, still served
    expect(seam.providerCalls).toHaveLength(1);
    expect(seam.writes).toEqual([]); // nothing reached the table
  });

  it("serves the second open from the in-process Map — no db read, no vendor call", async () => {
    const routePairs = await freshRoutePairs();
    await routePairs(PAIRS, null, HASH);

    await routePairs(PAIRS, null, HASH);

    expect(seam.reads).toHaveLength(1); // layer=memory: the table is not touched
    expect(seam.providerCalls).toHaveLength(1);
  });

  /** The whole bug: a new instance after a deploy has an empty Map. */
  it("serves a db hit without calling the provider, and warms the Map with it", async () => {
    seam.persisted.set(KEY, result(218_866));
    const routePairs = await freshRoutePairs();

    const first = await routePairs(PAIRS, null, HASH);

    expect(first[KEY]!.distanceMeters).toBe(218_866);
    expect(seam.providerCalls).toEqual([]); // layer=db — nothing billed
    expect(seam.writes).toEqual([]); // and nothing re-written

    const second = await routePairs(PAIRS, null, HASH);

    expect(second[KEY]).toEqual(first[KEY]);
    expect(seam.reads).toHaveLength(1); // warmed: the Map answered the second
    expect(seam.providerCalls).toEqual([]);
  });

  it("mixes layers in one call: one db hit, one vendor call", async () => {
    const bend = { lat: 44.0582, lng: -121.3153 };
    const secondKey = routeCacheKey(newport, bend, HASH);
    seam.persisted.set(KEY, result(218_866));
    const routePairs = await freshRoutePairs();

    const routes = await routePairs(
      [...PAIRS, { from: newport, to: bend }],
      null,
      HASH,
    );

    expect(Object.keys(routes).sort()).toEqual([KEY, secondKey].sort());
    expect(seam.reads).toEqual([[KEY, secondKey]]); // one batched read
    expect(seam.providerCalls).toHaveLength(1); // only the miss was billed
    expect(seam.writes).toEqual([[{ key: secondKey, result: routes[secondKey] }]]);
  });

  it("survives a table that is not there — the cache may never break a render", async () => {
    const routePairs = await freshRoutePairs();
    const { getCachedRoutes } = await import("@rv-trip/db");
    vi.mocked(getCachedRoutes).mockRejectedValueOnce(
      new Error('relation "routes" does not exist'),
    );

    const routes = await routePairs(PAIRS, null, HASH);

    expect(routes[KEY]!.distanceMeters).toBe(218_866);
    expect(seam.providerCalls).toHaveLength(1);
  });
});

/**
 * The nav half (docs/design/43 §4). Same fakes, one more seam: the BILLABLE
 * Google check. The cases that matter most are the ones asserting it did NOT
 * happen — the vet's HIGH was that a nav resolution on the shared routePairs
 * seam would bill a computeRoutes call per drive on every /map load.
 */
async function freshRouting() {
  vi.resetModules();
  return await import("./routing");
}

const ROUTED: RouteResult = result(218_866);

describe("navPairs: the billable check, opt-in and cached on the route's key", () => {
  it("checks a cold corridor once and caches the conclusion", async () => {
    const { navPairs } = await freshRouting();

    const nav = await navPairs(PAIRS, { [KEY]: ROUTED }, HASH);

    expect(nav[KEY]).toEqual({ deviationMeters: 180, intermediates: [] });
    expect(seam.navReads).toEqual([[KEY]]);
    // The corridor handed to Google is the DECODED HERE polyline, all 4 vertices.
    expect(seam.navCalls).toEqual([`${astoria.lat},${astoria.lng}|${newport.lat},${newport.lng}|4`]);
    expect(seam.navWrites).toEqual([[{ key: KEY, nav: nav[KEY] }]]);
  });

  it("serves a cached verdict with NO Google call", async () => {
    seam.navPersisted.set(KEY, { deviationMeters: 1340, intermediates: [] });
    const { navPairs } = await freshRouting();

    const nav = await navPairs(PAIRS, { [KEY]: ROUTED }, HASH);

    expect(nav[KEY]!.deviationMeters).toBe(1340);
    expect(seam.navCalls).toEqual([]); // nothing billed
    expect(seam.navWrites).toEqual([]);
  });

  it("does not cache a check that could not conclude — one retry, not 30 days of plain", async () => {
    seam.navDeviation = null;
    const { navPairs } = await freshRouting();

    const nav = await navPairs(PAIRS, { [KEY]: ROUTED }, HASH);

    expect(nav[KEY]).toEqual({ deviationMeters: null, intermediates: [] });
    expect(seam.navCalls).toHaveLength(1);
    expect(seam.navWrites).toEqual([]);
  });

  it("never spends a call on a drive with no corridor to hold", async () => {
    const { navPairs } = await freshRouting();
    const estimate: RouteResult = { ...result(218_866), source: "estimate" };

    // an estimate, a `here` result with no polyline, an unreadable polyline,
    // and a pair the RouteMap has never heard of
    expect(await navPairs(PAIRS, { [KEY]: estimate }, HASH)).toEqual({});
    expect(await navPairs(PAIRS, { [KEY]: { ...ROUTED, polyline: null } }, HASH)).toEqual({});
    expect(await navPairs(PAIRS, { [KEY]: { ...ROUTED, polyline: "!!!" } }, HASH)).toEqual({});
    expect(await navPairs(PAIRS, {}, HASH)).toEqual({});
    expect(seam.navCalls).toEqual([]);
    expect(seam.navReads).toEqual([]); // not even a table read
  });

  it("is 'unchecked' with no GOOGLE_API_KEY — the local case, and every pipeline stage", async () => {
    seam.googleKey = false;
    const { navPairs } = await freshRouting();

    const nav = await navPairs(PAIRS, { [KEY]: ROUTED }, HASH);

    expect(nav).toEqual({}); // verdict "plain", downstream
    expect(seam.navCalls).toEqual([]);
    expect(seam.navReads).toEqual([[KEY]]); // a cached verdict would still be used
  });

  it("survives a nav column that is not there — the check may never break a render", async () => {
    const { navPairs } = await freshRouting();
    const { getCachedNav } = await import("@rv-trip/db");
    vi.mocked(getCachedNav).mockRejectedValueOnce(
      new Error('column "nav" does not exist'),
    );

    const nav = await navPairs(PAIRS, { [KEY]: ROUTED }, HASH);

    expect(nav[KEY]!.deviationMeters).toBe(180);
  });
});

describe("routeTrip: the nav resolution is opt-in per caller", () => {
  const trip = {
    id: "t1",
    ownerId: "dev-user",
    title: "Pacific NW Loop",
    homeBase: null,
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    status: "planning" as const,
    statusAuto: true,
    rating: null,
    note: null,
    legs: [
      {
        id: "l1",
        tripId: "t1",
        title: "Coast",
        sortOrder: 0,
        stops: [
          {
            id: "s1",
            legId: "l1",
            sortOrder: 0,
            place: { name: "Astoria", lat: astoria.lat, lng: astoria.lng, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-03",
            rating: null,
            notes: null,
            reservations: [],
            ideas: [],
          },
          {
            id: "s2",
            legId: "l1",
            sortOrder: 1,
            place: { name: "Newport", lat: newport.lat, lng: newport.lng, googlePlaceId: null },
            arriveDate: "2026-08-04",
            departDate: "2026-08-06",
            rating: null,
            notes: null,
            reservations: [],
            ideas: [],
          },
        ],
      },
    ],
  };

  it("bills nothing without the flag — this is what /map and the dashboard call", async () => {
    const { routeTrip } = await freshRouting();

    const { routes, nav } = await routeTrip(trip, null);

    expect(Object.keys(routes)).toHaveLength(1); // the drive was routed…
    expect(nav).toEqual({}); // …and no verdict was bought
    expect(seam.navCalls).toEqual([]);
    expect(seam.navReads).toEqual([]);
  });

  it("resolves the verdict with it — this is what the trip page calls", async () => {
    const { routeTrip } = await freshRouting();

    const { routes, routingHash, nav } = await routeTrip(trip, null, { nav: true });

    const key = Object.keys(routes)[0]!;
    expect(routingHash).toBe("no-rig");
    expect(nav[key]!.deviationMeters).toBe(180);
    expect(seam.navCalls).toHaveLength(1);
  });
});
