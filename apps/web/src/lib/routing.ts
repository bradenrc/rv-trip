import {
  NO_ROUTING_HASH,
  StubRoutingProvider,
  orderedPairs,
  routeCacheKey,
  routingHash,
  type LatLng,
  type RigProfile,
  type RouteResult,
  type RoutingProvider,
  type Trip,
} from "@rv-trip/core";
import { HereRoutingProvider, hereCredentialsFromEnv } from "@rv-trip/core/providers/here";
import { getCachedRoutes, putCachedRoutes } from "@rv-trip/db";
import type { RouteMap } from "./trip-logic";

/**
 * SERVER-SIDE ONLY. HERE is server-side only and the drive label is computed
 * inside a "use client" tree that cannot await a vendor, so routes are resolved
 * here — before render — and handed down as a plain keyed map.
 *
 * With no HERE credentials configured (the local case, and every pipeline
 * stage) this silently becomes the straight-line stub. Nothing breaks; the
 * numbers are just honestly tagged `estimate`.
 */

let cachedProvider: RoutingProvider | null = null;

function provider(): RoutingProvider {
  if (!cachedProvider) {
    const credentials = hereCredentialsFromEnv();
    cachedProvider = credentials ? new HereRoutingProvider(credentials) : new StubRoutingProvider();
  }
  return cachedProvider;
}

/**
 * Layer 1 of the cache: in-process, per instance, bounded. It is the cheapest
 * hit there is and the only one that costs no round trip — but on Vercel
 * Functions it is also per-instance and gone on every cold start, which is why
 * the `routes` table now sits behind it (docs/design/43 §1).
 */
const CACHE_LIMIT = 500;
const cache = new Map<string, RouteResult>();

function remember(key: string, result: RouteResult): RouteResult {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

export interface PairInput {
  from: LatLng;
  to: LatLng;
}

interface KeyedPair extends PairInput {
  key: string;
}

/**
 * Resolve a specific set of pairs — the post-reorder upgrade path — through
 * memory → table → vendor, in that order.
 *
 * The table read and the write-through are both guarded: this cache is an
 * optimisation, so a database that is unreachable (or a tree whose migration
 * has not been applied) costs a vendor call, never the render.
 */
export async function routePairs(
  pairs: PairInput[],
  rig: RigProfile | null,
  hash?: string,
): Promise<RouteMap> {
  const routingKey = hash ?? (await routingHash(rig));
  const routes: RouteMap = {};

  // ① the in-process Map.
  const unresolved: KeyedPair[] = [];
  for (const { from, to } of pairs) {
    const key = routeCacheKey(from, to, routingKey);
    const hit = cache.get(key);
    if (hit) routes[key] = hit;
    else if (!unresolved.some((p) => p.key === key)) unresolved.push({ from, to, key });
  }
  const memoryHits = Object.keys(routes).length;
  if (unresolved.length === 0) {
    log(memoryHits, 0, "memory");
    return routes;
  }

  // ② the `routes` table — one batched read, and every hit WARMS the Map, so a
  // second open on this instance never gets this far.
  const persisted = await readCache(unresolved.map((p) => p.key));
  const missing: KeyedPair[] = [];
  for (const pair of unresolved) {
    const row = persisted[pair.key];
    if (row) routes[pair.key] = remember(pair.key, row);
    else missing.push(pair);
  }
  const dbHits = Object.keys(routes).length - memoryHits;
  if (missing.length === 0) {
    log(memoryHits + dbHits, 0, "db");
    return routes;
  }

  // ③ the vendor. Billed, so written through — but only where it answered.
  const fetched = await Promise.all(
    missing.map(async (pair) => ({
      key: pair.key,
      result: await provider().route(pair.from, pair.to, rig),
    })),
  );
  for (const { key, result } of fetched) routes[key] = remember(key, result);

  // An `estimate` is a failed or keyless call, not a route: caching one would
  // poison the key for the whole 30-day TTL (docs/design/43 §1 ④).
  await writeCache(fetched.filter(({ result }) => result.source === "here"));

  log(memoryHits + dbHits, fetched.length, "provider");
  return routes;
}

/** The cache is never load-bearing: a broken table degrades to the vendor. */
async function readCache(keys: string[]): Promise<Record<string, RouteResult>> {
  try {
    return await getCachedRoutes(keys);
  } catch (error) {
    console.warn("route.cache read failed — falling through to the provider", error);
    return {};
  }
}

async function writeCache(rows: { key: string; result: RouteResult }[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await putCachedRoutes(rows);
  } catch (error) {
    console.warn("route.cache write failed — the route is served, not stored", error);
  }
}

/** One line per resolve, naming the layer that paid for it. */
function log(hit: number, miss: number, layer: "memory" | "db" | "provider"): void {
  console.log(`route.cache hit=${hit} miss=${miss} layer=${layer}`);
}

/**
 * Every drive on the trip, resolved before first paint (Q5 = A). The routing
 * hash comes back with it because the client needs it to build the same keys —
 * and to build a key for a pair it invents by dragging, which will miss and
 * fall to the synchronous estimate.
 */
export async function routeTrip(
  trip: Trip,
  rig: RigProfile | null,
): Promise<{ routes: RouteMap; routingHash: string }> {
  const hash = rig ? await routingHash(rig) : NO_ROUTING_HASH;
  const routes = await routePairs(orderedPairs(trip), rig, hash);
  return { routes, routingHash: hash };
}
