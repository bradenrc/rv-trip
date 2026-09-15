import { z } from "zod";
import type { LatLng, PlaceDetails, PlaceSummary, PlacesProvider } from "./index";

/**
 * The place-search WIRE — docs/design/41 §3.
 *
 * Healthy and degraded share ONE envelope, so the picker renders one shape and
 * "no key" is a normal 200 rather than an error the UI has to special-case. The
 * whole decision tree lives here, pure and testable: the two route handlers in
 * apps/web (`api/places/search`, `api/places/details/[id]`) are thin adapters
 * that read the request, call one of these, and hand the result to
 * `NextResponse.json`. That split is deliberate — `packages/core` is the only
 * workspace with a test runner, so logic that lives here is logic that is
 * actually covered.
 *
 * Pure and client-safe (no key, no `fetch`), so it is re-exported from
 * providers/index.ts — unlike google-places.ts, which is quarantined behind its
 * own subpath.
 */

/** Why the results are empty when it is not simply "Google had nothing". */
export type PlacesDegradedReason = "no_provider" | "upstream_error" | "rate_limited";

/**
 * The one shape both routes answer with. `results` is 0..n for search and 0..1
 * for details.
 *
 * `sessionToken` is declared because §3 draws it, but is NEVER populated today:
 * a session token is a Google Autocomplete↔Details pairing, and the search leg
 * is `places:searchText` (billed per request, no token accepted). Issue #41's
 * i1 flagged this and it is still undecided — either the picker drops the token
 * or the search leg moves to Autocomplete (a different result shape). Echoing a
 * token that buys nothing would be a lie in a payload.
 */
export interface PlacesEnvelope<T extends PlaceSummary = PlaceSummary> {
  results: T[];
  degraded: boolean;
  reason?: PlacesDegradedReason;
  retryAfterMs?: number;
  sessionToken?: string;
}

/** 30 searches per 60 s, per owner (§3, and the "Dev notes" list). */
export const SEARCH_RATE_LIMIT = 30;
export const SEARCH_RATE_WINDOW_MS = 60_000;

/** How many owners the bucket remembers before it starts over. */
const BUCKET_OWNER_LIMIT = 1_000;

export interface RateDecision {
  allowed: boolean;
  /** 0 when allowed; otherwise the wait until one token exists. */
  retryAfterMs: number;
}

/**
 * A per-owner token bucket. Steady refill rather than a fixed window, so a user
 * who hits the cap gets a search back every two seconds instead of staring at a
 * wall until the minute rolls over — and `retryAfterMs` is a real number to
 * count down rather than a guess.
 *
 * In-process, like the route cache in apps/web/src/lib/routing.ts. Correct for
 * one instance; a multi-instance deploy needs a shared store. The design
 * records that as accepted, not solved (§"Dev notes").
 */
export class OwnerTokenBucket {
  private readonly owners = new Map<string, { tokens: number; atMs: number }>();

  constructor(
    private readonly limit: number = SEARCH_RATE_LIMIT,
    private readonly windowMs: number = SEARCH_RATE_WINDOW_MS,
  ) {}

  /** Tokens earned per millisecond. */
  private get refillPerMs(): number {
    return this.limit / this.windowMs;
  }

  take(owner: string, now: number = Date.now()): RateDecision {
    // Unbounded growth is the only way this leaks; one owner today, and a
    // reset is a cheap, correct-enough answer for an in-process bucket.
    if (this.owners.size >= BUCKET_OWNER_LIMIT && !this.owners.has(owner)) this.owners.clear();
    const entry = this.owners.get(owner) ?? { tokens: this.limit, atMs: now };
    const tokens = Math.min(this.limit, entry.tokens + (now - entry.atMs) * this.refillPerMs);
    if (tokens < 1) {
      this.owners.set(owner, { tokens, atMs: now });
      return { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / this.refillPerMs) };
    }
    this.owners.set(owner, { tokens: tokens - 1, atMs: now });
    return { allowed: true, retryAfterMs: 0 };
  }
}

// ── the query string ───────────────────────────────────────────────────────

/** "47.61,-124.38" — the map centre the picker leans its search toward. */
const nearSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/, 'near must be "lat,lng"')
  .transform((raw): LatLng => {
    // The regex above guarantees exactly one comma and two numbers.
    const parts = raw.split(",");
    return { lat: Number(parts[0]), lng: Number(parts[1]) };
  })
  .refine(
    ({ lat, lng }) => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
    "near is off the globe",
  );

/**
 * `q` is required and non-blank: a blank box is not a question, and the picker
 * debounces before it ever gets here. A malformed query string is a client bug,
 * not a degradation — the route answers 400 with the shipped `{ error }` shape.
 */
export const placesSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  near: nearSchema.optional(),
});
export type PlacesSearchQuery = z.infer<typeof placesSearchQuerySchema>;

/** The `[id]` segment of the details route. */
export const googlePlaceIdSchema = z.string().trim().min(1);

// ── the envelopes ──────────────────────────────────────────────────────────

function healthy<T extends PlaceSummary>(results: T[]): PlacesEnvelope<T> {
  return { results, degraded: false };
}

function degraded<T extends PlaceSummary>(
  reason: PlacesDegradedReason,
  retryAfterMs?: number,
): PlacesEnvelope<T> {
  return retryAfterMs === undefined
    ? { results: [], degraded: true, reason }
    : { results: [], degraded: true, reason, retryAfterMs };
}

/**
 * The only envelope that is not a 200. A throttled caller still sees the
 * free-text row rather than a red toast (§4 state 5), so the BODY is the same
 * degraded shape; the status is the honest HTTP word for it, per §3's
 * "429 · owner token bucket".
 */
export function placesEnvelopeStatus(envelope: PlacesEnvelope<PlaceSummary>): number {
  return envelope.reason === "rate_limited" ? 429 : 200;
}

export interface PlacesSearchInput {
  provider: PlacesProvider;
  /**
   * Whether a real Google key backs `provider`. False means the caller handed
   * us StubPlacesProvider, whose empty answer must be reported as
   * `no_provider` rather than as "Google had nothing".
   */
  configured: boolean;
  owner: string;
  query: string;
  near?: LatLng;
  limiter: OwnerTokenBucket;
  now?: number;
}

/**
 * GET /api/places/search.
 *
 * The cap is checked FIRST, before the key — so the 30/60 s behaviour is
 * provable locally, where there is no key and every search would otherwise
 * short-circuit to `no_provider` and never reach the bucket.
 */
export async function searchPlacesEnvelope(input: PlacesSearchInput): Promise<PlacesEnvelope> {
  const { provider, configured, owner, query, near, limiter, now } = input;
  const rate = limiter.take(owner, now);
  if (!rate.allowed) return degraded("rate_limited", rate.retryAfterMs);
  let results: PlaceSummary[];
  try {
    results = await provider.search(query, near);
  } catch {
    // The provider throws on an upstream failure ON PURPOSE, so that "Google
    // is down" and "Google had nothing" stay different answers. This is where
    // that distinction is spent.
    return degraded("upstream_error");
  }
  if (!configured) return { results, degraded: true, reason: "no_provider" };
  return healthy(results);
}

/**
 * How long a cached Google row stands — the issue's 30-day refresh (#82 Q3 → A).
 * A READ filter, not a sweeper: a stale row is simply re-fetched and upserted
 * over, exactly as the route cache ages (packages/db/src/queries.ts).
 */
export const PLACE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The cache seam. Core DECLARES it, packages/db implements it — the same split
 * `LocateStore` / `dbLocateStore` already keeps, so nothing here imports Drizzle
 * and the decision tree stays unit-testable.
 *
 * NOT owner-scoped: a real-world place is not anybody's, for the same reason a
 * route between two coordinates isn't.
 */
export interface PlacesCacheStore {
  get(googlePlaceId: string): Promise<{ details: PlaceDetails; fetchedAt: Date } | null>;
  put(details: PlaceDetails): Promise<void>;
}

export interface PlacesDetailsInput {
  provider: PlacesProvider;
  configured: boolean;
  googlePlaceId: string;
  /** Absent → every open asks Google. Present → a fresh row answers for free. */
  cache?: PlacesCacheStore;
  /** Injectable clock, so the TTL is provable without waiting 30 days. */
  now?: number;
}

/**
 * GET /api/places/details/[id] — the same envelope, with at most one result.
 *
 * Not rate limited: details is one call per pick, not a keystroke.
 *
 * An id Google has retired comes back as `{ results: [], degraded: false }` —
 * we asked and there is nothing there. That is an answer, not an outage, and it
 * is the reason this is not a 404: the picker's degraded branch must not light
 * up for it.
 */
export async function detailsPlacesEnvelope(
  input: PlacesDetailsInput,
): Promise<PlacesEnvelope<PlaceDetails>> {
  const { provider, configured, googlePlaceId, cache, now = Date.now() } = input;

  // A fresh row answers outright — no Google call at all (#82 §7⑤). A cache
  // READ that throws is swallowed for the same reason a write is: a cache is
  // never allowed to fail a read it is only supposed to speed up.
  if (cache) {
    try {
      const hit = await cache.get(googlePlaceId);
      if (hit && now - hit.fetchedAt.getTime() < PLACE_CACHE_TTL_MS) {
        return healthy([hit.details]);
      }
    } catch {
      // fall through to the provider
    }
  }

  let place: PlaceDetails | null;
  try {
    place = await provider.details(googlePlaceId);
  } catch {
    return degraded("upstream_error");
  }
  const results = place ? [place] : [];
  // A miss against the stub is not worth remembering: `configured` false means
  // nobody looked, and caching "nothing" would answer for it for 30 days.
  if (!configured) return { results, degraded: true, reason: "no_provider" };
  if (cache && place) {
    try {
      await cache.put(place);
    } catch {
      // The answer is already in hand.
    }
  }
  return healthy(results);
}
