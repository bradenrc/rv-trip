import {
  NO_RIG_HASH,
  StubRoutingProvider,
  orderedPairs,
  rigHash,
  routeCacheKey,
  type LatLng,
  type RigProfile,
  type RouteResult,
  type RoutingProvider,
  type Trip,
} from "@rv-trip/core";
import { HereRoutingProvider, hereCredentialsFromEnv } from "@rv-trip/core/providers/here";
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
 * A route changes only when a stop or the rig does, so the key is enough to
 * cache on. In-process and bounded — a shared cache is a fast-follow, not this
 * issue; the point here is that opening the same trip twice does not re-bill.
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

/** Resolve a specific set of pairs — the post-reorder upgrade path. */
export async function routePairs(
  pairs: PairInput[],
  rig: RigProfile | null,
  hash?: string,
): Promise<RouteMap> {
  const rigKey = hash ?? (await rigHash(rig));
  const routes: RouteMap = {};
  await Promise.all(
    pairs.map(async ({ from, to }) => {
      const key = routeCacheKey(from, to, rigKey);
      const hit = cache.get(key);
      routes[key] = hit ?? remember(key, await provider().route(from, to, rig));
    }),
  );
  return routes;
}

/**
 * Every drive on the trip, resolved before first paint (Q5 = A). The rig hash
 * comes back with it because the client needs it to build the same keys — and
 * to build a key for a pair it invents by dragging, which will miss and fall to
 * the synchronous estimate.
 */
export async function routeTrip(
  trip: Trip,
  rig: RigProfile | null,
): Promise<{ routes: RouteMap; rigHash: string }> {
  const hash = rig ? await rigHash(rig) : NO_RIG_HASH;
  const routes = await routePairs(orderedPairs(trip), rig, hash);
  return { routes, rigHash: hash };
}
