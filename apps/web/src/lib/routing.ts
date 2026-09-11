import {
  NO_ROUTING_HASH,
  StubRoutingProvider,
  decodeFlexiblePolyline,
  orderedPairs,
  routeCacheKey,
  routingHash,
  type LatLng,
  type NavCheck,
  type RigProfile,
  type RouteResult,
  type RoutingProvider,
  type Trip,
} from "@rv-trip/core";
import { HereRoutingProvider, hereCredentialsFromEnv } from "@rv-trip/core/providers/here";
import { googleCredentialsFromEnv } from "@rv-trip/core/providers/google-places";
import { GoogleRoutesProvider } from "@rv-trip/core/providers/google-routes";
import { getCachedNav, getCachedRoutes, putCachedNav, putCachedRoutes } from "@rv-trip/db";
import type { NavMap, RouteMap } from "./trip-logic";

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
 * The corridor validator's client, or `null` with no Google key — which is the
 * local case and every pipeline stage. There is no stub: an unchecked corridor
 * is the honest "plain" verdict, and a stubbed verdict would be a lie the UI
 * renders in green.
 */
let cachedNavProvider: GoogleRoutesProvider | null = null;

function navProvider(): GoogleRoutesProvider | null {
  if (!cachedNavProvider) {
    const credentials = googleCredentialsFromEnv();
    if (!credentials) return null;
    cachedNavProvider = new GoogleRoutesProvider(credentials);
  }
  return cachedNavProvider;
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
 * The corridor checks for a resolved set of pairs — table, then vendor, on
 * exactly the same key (docs/design/43 §4).
 *
 * OPT-IN, never on the shared seam. The Google call is billable and per drive,
 * so only a screen that actually renders a Navigate control may ask for it:
 * `routeTrip(trip, rig, { nav: true })` on the trip page. /map and the
 * dashboard resolve routes and no verdicts, and therefore bill nothing — the
 * vet's HIGH against putting this inside `routePairs`.
 *
 * Only a `here` result with a readable polyline is a candidate: the validator
 * measures Google against the HERE corridor, and there is no corridor in an
 * estimate. A check that could not conclude is NOT cached, so a transient
 * vendor failure costs one retry rather than thirty days of "plain".
 */
export async function navPairs(
  pairs: PairInput[],
  routes: RouteMap,
  hash: string,
): Promise<NavMap> {
  const candidates: { key: string; from: LatLng; to: LatLng; corridor: LatLng[] }[] = [];
  for (const { from, to } of pairs) {
    const key = routeCacheKey(from, to, hash);
    const result = routes[key];
    if (!result || result.source !== "here" || !result.polyline) continue;
    const corridor = decodeFlexiblePolyline(result.polyline);
    if (corridor.length < 2) continue;
    if (!candidates.some((c) => c.key === key)) candidates.push({ key, from, to, corridor });
  }
  if (candidates.length === 0) return {};

  const nav: NavMap = await readNavCache(candidates.map((c) => c.key));
  const client = navProvider();
  const missing = candidates.filter((c) => !nav[c.key]);
  if (!client || missing.length === 0) {
    logNav(Object.keys(nav).length, 0, client ? "db" : "unchecked");
    return nav;
  }

  const checked = await Promise.all(
    missing.map(async (c) => ({
      key: c.key,
      nav: await client.checkCorridor(c.from, c.to, c.corridor),
    })),
  );
  for (const row of checked) nav[row.key] = row.nav;
  await writeNavCache(checked.filter((row) => row.nav.deviationMeters !== null));

  logNav(Object.keys(nav).length - checked.length, checked.length, "provider");
  return nav;
}

/**
 * Every drive on the trip, resolved before first paint (Q5 = A). The routing
 * hash comes back with it because the client needs it to build the same keys —
 * and to build a key for a pair it invents by dragging, which will miss and
 * fall to the synchronous estimate.
 *
 * `nav` is `{}` unless the caller asks for it: see navPairs.
 */
export async function routeTrip(
  trip: Trip,
  rig: RigProfile | null,
  options: { nav?: boolean } = {},
): Promise<{ routes: RouteMap; routingHash: string; nav: NavMap }> {
  const hash = rig ? await routingHash(rig) : NO_ROUTING_HASH;
  const pairs = orderedPairs(trip);
  const routes = await routePairs(pairs, rig, hash);
  const nav = options.nav ? await navPairs(pairs, routes, hash) : {};
  return { routes, routingHash: hash, nav };
}

/** Same policy as the route cache: a broken table costs a check, not a render. */
async function readNavCache(keys: string[]): Promise<Record<string, NavCheck>> {
  try {
    return await getCachedNav(keys);
  } catch (error) {
    console.warn("route.nav read failed — the verdict falls back to plain", error);
    return {};
  }
}

async function writeNavCache(rows: { key: string; nav: NavCheck }[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await putCachedNav(rows);
  } catch (error) {
    console.warn("route.nav write failed — the verdict is used, not stored", error);
  }
}

/** One line per resolve, naming the layer that paid for it. */
function logNav(hit: number, miss: number, layer: "db" | "provider" | "unchecked"): void {
  console.log(`route.nav hit=${hit} miss=${miss} layer=${layer}`);
}
