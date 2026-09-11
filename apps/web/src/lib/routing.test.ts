import { beforeEach, expect, it, describe, vi } from "vitest";
import { routeCacheKey, type LatLng, type RouteResult } from "@rv-trip/core";
import type { CachedRoute } from "@rv-trip/db";

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
    polyline: "BG0y_pgDh_p",
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
