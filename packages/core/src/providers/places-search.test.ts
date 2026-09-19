import { describe, expect, it } from "vitest";
import type { LatLng, PlaceDetails, PlaceSummary, PlacesProvider } from "./index";
import { StubPlacesProvider } from "./index";
import {
  OwnerTokenBucket,
  PLACE_CACHE_TTL_MS,
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  detailsPlacesEnvelope,
  googlePlaceIdSchema,
  placesEnvelopeStatus,
  placesSearchQuerySchema,
  searchPlacesEnvelope,
  type PlacesCacheStore,
} from "./places-search";

/**
 * The envelope is the whole contract of docs/design/41 §3: healthy and degraded
 * are ONE shape, so the picker renders one thing and "no key" is a normal 200.
 * These tests are the route handlers' real coverage — apps/web ships no test
 * runner (see docs/design/41/dev-notes.md), so every decision the handler makes
 * lives here and the handler itself is a five-line adapter.
 */

const KALALOCH: PlaceSummary = {
  googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
  name: "Kalaloch Campground",
  location: { lat: 47.6118, lng: -124.3762 },
  rating: 4.4,
  address: "156954 US-101, Forks, WA 98331",
};

/**
 * The same place as a DETAILS answer (#82 §7①): search and details no longer
 * share one shape, so the fixture has a second, wider form.
 */
const KALALOCH_DETAILS: PlaceDetails = {
  ...KALALOCH,
  userRatingCount: 812,
  websiteUri: "https://www.fs.usda.gov/olympic",
  nationalPhoneNumber: "(360) 962-2271",
  googleMapsUri: "https://maps.google.com/?cid=10281119596374313554",
};

/** Answers with the fixture and records what it was asked. */
class FakeProvider implements PlacesProvider {
  readonly searches: { query: string; near?: LatLng }[] = [];
  readonly detailsCalls: string[] = [];
  constructor(private readonly rows: PlaceSummary[] = [KALALOCH]) {}
  async search(query: string, near?: LatLng): Promise<PlaceSummary[]> {
    this.searches.push({ query, near });
    return this.rows;
  }
  async details(googlePlaceId: string): Promise<PlaceDetails | null> {
    this.detailsCalls.push(googlePlaceId);
    return this.rows.length > 0 ? KALALOCH_DETAILS : null;
  }
}

/** Google answered with a 500, or the socket died. */
class BrokenProvider implements PlacesProvider {
  async search(): Promise<PlaceSummary[]> {
    throw new Error("Google places:searchText → 500");
  }
  async details(): Promise<PlaceDetails | null> {
    throw new Error("Google places/details → 500");
  }
}

/** An in-memory `PlacesCacheStore`, with the two failure modes scriptable. */
class FakeCache implements PlacesCacheStore {
  readonly puts: PlaceDetails[] = [];
  readonly gets: string[] = [];
  constructor(
    private row: { details: PlaceDetails; fetchedAt: Date } | null = null,
    private readonly mode: "ok" | "get-throws" | "put-throws" = "ok",
  ) {}
  async get(googlePlaceId: string) {
    this.gets.push(googlePlaceId);
    if (this.mode === "get-throws") throw new Error("cache read blew up");
    return this.row;
  }
  async put(details: PlaceDetails) {
    if (this.mode === "put-throws") throw new Error("cache write blew up");
    this.puts.push(details);
    this.row = { details, fetchedAt: new Date() };
  }
}

const fresh = () => new OwnerTokenBucket();

// ── the query string ───────────────────────────────────────────────────────
describe("placesSearchQuerySchema", () => {
  it("takes q alone", () => {
    const parsed = placesSearchQuerySchema.safeParse({ q: "kalaloch" });
    expect(parsed.success && parsed.data).toEqual({ q: "kalaloch" });
  });

  it("parses near=lat,lng into a LatLng", () => {
    const parsed = placesSearchQuerySchema.safeParse({ q: "kalaloch", near: "47.61,-124.38" });
    expect(parsed.success && parsed.data.near).toEqual({ lat: 47.61, lng: -124.38 });
  });

  it("rejects a blank q — a blank box is not a billed question", () => {
    expect(placesSearchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
    expect(placesSearchQuerySchema.safeParse({}).success).toBe(false);
  });

  it("rejects a malformed or out-of-range near", () => {
    expect(placesSearchQuerySchema.safeParse({ q: "k", near: "47.61" }).success).toBe(false);
    expect(placesSearchQuerySchema.safeParse({ q: "k", near: "boston" }).success).toBe(false);
    expect(placesSearchQuerySchema.safeParse({ q: "k", near: "97.61,-124.38" }).success).toBe(false);
  });

  it("rejects an empty place id", () => {
    expect(googlePlaceIdSchema.safeParse("").success).toBe(false);
    expect(googlePlaceIdSchema.safeParse(KALALOCH.googlePlaceId).success).toBe(true);
  });
});

// ── the per-owner token bucket ─────────────────────────────────────────────
describe("OwnerTokenBucket", () => {
  it("allows 30 searches in a minute and throttles the 31st", () => {
    const bucket = fresh();
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) {
      expect(bucket.take("dev-user", 1_000).allowed).toBe(true);
    }
    const denied = bucket.take("dev-user", 1_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(Number.isFinite(denied.retryAfterMs)).toBe(true);
  });

  it("counts each owner separately", () => {
    const bucket = fresh();
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) bucket.take("dev-user", 1_000);
    expect(bucket.take("dev-user", 1_000).allowed).toBe(false);
    expect(bucket.take("other-user", 1_000).allowed).toBe(true);
  });

  it("refills steadily — one token per window/limit", () => {
    const bucket = fresh();
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) bucket.take("dev-user", 1_000);
    const perToken = SEARCH_RATE_WINDOW_MS / SEARCH_RATE_LIMIT;
    expect(bucket.take("dev-user", 1_000 + perToken).allowed).toBe(true);
    expect(bucket.take("dev-user", 1_000 + perToken).allowed).toBe(false);
  });

  it("reports how long until the next token", () => {
    const bucket = fresh();
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) bucket.take("dev-user", 1_000);
    const perToken = SEARCH_RATE_WINDOW_MS / SEARCH_RATE_LIMIT;
    expect(bucket.take("dev-user", 1_000).retryAfterMs).toBe(perToken);
    // half a token has refilled, so half the wait is left
    expect(bucket.take("dev-user", 1_000 + perToken / 2).retryAfterMs).toBe(perToken / 2);
  });

  it("never banks more than a full window of tokens", () => {
    const bucket = fresh();
    bucket.take("dev-user", 1_000);
    const later = 1_000 + SEARCH_RATE_WINDOW_MS * 10;
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) {
      expect(bucket.take("dev-user", later).allowed).toBe(true);
    }
    expect(bucket.take("dev-user", later).allowed).toBe(false);
  });
});

// ── GET /api/places/search ─────────────────────────────────────────────────
describe("searchPlacesEnvelope", () => {
  it("the healthy path — results, degraded:false, no reason", async () => {
    const provider = new FakeProvider();
    const envelope = await searchPlacesEnvelope({
      provider,
      configured: true,
      owner: "dev-user",
      query: "kalaloch",
      near: { lat: 47.61, lng: -124.38 },
      limiter: fresh(),
    });
    expect(envelope).toEqual({ results: [KALALOCH], degraded: false });
    expect(envelope.reason).toBeUndefined();
    expect(placesEnvelopeStatus(envelope)).toBe(200);
    expect(provider.searches).toEqual([{ query: "kalaloch", near: { lat: 47.61, lng: -124.38 } }]);
  });

  it("Google answered and had nothing — empty, but NOT degraded", async () => {
    const envelope = await searchPlacesEnvelope({
      provider: new FakeProvider([]),
      configured: true,
      owner: "dev-user",
      query: "forest road 25 pullout",
      limiter: fresh(),
    });
    expect(envelope).toEqual({ results: [], degraded: false });
  });

  it("no GOOGLE_API_KEY — the stub answers, the envelope says no_provider, status is 200", async () => {
    const envelope = await searchPlacesEnvelope({
      provider: new StubPlacesProvider(),
      configured: false,
      owner: "dev-user",
      query: "kalaloch",
      limiter: fresh(),
    });
    expect(envelope).toEqual({ results: [], degraded: true, reason: "no_provider" });
    expect(placesEnvelopeStatus(envelope)).toBe(200);
  });

  it("an upstream failure is caught and reported, never thrown", async () => {
    const envelope = await searchPlacesEnvelope({
      provider: new BrokenProvider(),
      configured: true,
      owner: "dev-user",
      query: "kalaloch",
      limiter: fresh(),
    });
    expect(envelope).toEqual({ results: [], degraded: true, reason: "upstream_error" });
    expect(placesEnvelopeStatus(envelope)).toBe(200);
  });

  it("the 31st search in 60s is throttled on the same envelope, with a numeric retryAfterMs", async () => {
    const provider = new FakeProvider();
    const limiter = fresh();
    const call = (now: number) =>
      searchPlacesEnvelope({
        provider,
        configured: true,
        owner: "dev-user",
        query: "kalaloch",
        limiter,
        now,
      });
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) {
      expect((await call(1_000)).degraded).toBe(false);
    }
    const throttled = await call(1_000);
    expect(throttled.results).toEqual([]);
    expect(throttled.degraded).toBe(true);
    expect(throttled.reason).toBe("rate_limited");
    expect(typeof throttled.retryAfterMs).toBe("number");
    expect(throttled.retryAfterMs).toBeGreaterThan(0);
    expect(placesEnvelopeStatus(throttled)).toBe(429);
    // and the vendor was never asked the 31st time
    expect(provider.searches).toHaveLength(SEARCH_RATE_LIMIT);
  });

  it("throttles before it looks at the key, so the cap is provable with no key", async () => {
    const limiter = fresh();
    const call = () =>
      searchPlacesEnvelope({
        provider: new StubPlacesProvider(),
        configured: false,
        owner: "dev-user",
        query: "kalaloch",
        limiter,
        now: 1_000,
      });
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) expect((await call()).reason).toBe("no_provider");
    expect((await call()).reason).toBe("rate_limited");
  });

  it("scopes the cap to the owner", async () => {
    const limiter = fresh();
    const call = (owner: string) =>
      searchPlacesEnvelope({
        provider: new FakeProvider(),
        configured: true,
        owner,
        query: "kalaloch",
        limiter,
        now: 1_000,
      });
    for (let i = 0; i < SEARCH_RATE_LIMIT; i += 1) await call("dev-user");
    expect((await call("dev-user")).reason).toBe("rate_limited");
    expect((await call("someone-else")).degraded).toBe(false);
  });
});

// ── GET /api/places/details/[id] ───────────────────────────────────────────
describe("detailsPlacesEnvelope", () => {
  it("the healthy path — the one place, on the same envelope", async () => {
    const provider = new FakeProvider();
    const envelope = await detailsPlacesEnvelope({
      provider,
      configured: true,
      googlePlaceId: KALALOCH.googlePlaceId,
    });
    expect(envelope).toEqual({ results: [KALALOCH_DETAILS], degraded: false });
    expect(provider.detailsCalls).toEqual([KALALOCH.googlePlaceId]);
  });

  it("an id Google has retired is an answer, not a degradation", async () => {
    const envelope = await detailsPlacesEnvelope({
      provider: new FakeProvider([]),
      configured: true,
      googlePlaceId: "ChIJretired",
    });
    expect(envelope).toEqual({ results: [], degraded: false });
  });

  it("no GOOGLE_API_KEY — 200 with results:[] and no_provider, never an error status", async () => {
    const envelope = await detailsPlacesEnvelope({
      provider: new StubPlacesProvider(),
      configured: false,
      googlePlaceId: KALALOCH.googlePlaceId,
    });
    expect(envelope).toEqual({ results: [], degraded: true, reason: "no_provider" });
    expect(placesEnvelopeStatus(envelope)).toBe(200);
  });

  it("an upstream failure is caught and reported", async () => {
    const envelope = await detailsPlacesEnvelope({
      provider: new BrokenProvider(),
      configured: true,
      googlePlaceId: KALALOCH.googlePlaceId,
    });
    expect(envelope).toEqual({ results: [], degraded: true, reason: "upstream_error" });
  });

  it("is never rate limited — one details call per pick is not a search", async () => {
    const provider = new FakeProvider();
    for (let i = 0; i < SEARCH_RATE_LIMIT + 5; i += 1) {
      const envelope = await detailsPlacesEnvelope({
        provider,
        configured: true,
        googlePlaceId: KALALOCH.googlePlaceId,
      });
      expect(envelope.degraded).toBe(false);
    }
  });
});

// ── the 30-day cache (#82 Q3 → A) ──────────────────────────────────────────
describe("detailsPlacesEnvelope · the places cache", () => {
  const NOW = Date.UTC(2026, 8, 15);
  const fresh = (ageMs: number) => ({
    details: KALALOCH_DETAILS,
    fetchedAt: new Date(NOW - ageMs),
  });

  it("a fresh row answers outright — Google is never called", async () => {
    const provider = new FakeProvider();
    const cache = new FakeCache(fresh(29 * 24 * 60 * 60 * 1000));
    const envelope = await detailsPlacesEnvelope({
      provider,
      configured: true,
      googlePlaceId: KALALOCH.googlePlaceId,
      cache,
      now: NOW,
    });
    expect(envelope).toEqual({ results: [KALALOCH_DETAILS], degraded: false });
    expect(provider.detailsCalls).toEqual([]);
    expect(cache.puts).toEqual([]);
  });

  it("a row past the 30-day TTL is a miss — refetched and written back", async () => {
    const provider = new FakeProvider();
    const cache = new FakeCache(fresh(PLACE_CACHE_TTL_MS + 1));
    const envelope = await detailsPlacesEnvelope({
      provider,
      configured: true,
      googlePlaceId: KALALOCH.googlePlaceId,
      cache,
      now: NOW,
    });
    expect(envelope.results).toEqual([KALALOCH_DETAILS]);
    expect(provider.detailsCalls).toEqual([KALALOCH.googlePlaceId]);
    expect(cache.puts).toEqual([KALALOCH_DETAILS]);
  });

  it("a miss fetches and writes through", async () => {
    const cache = new FakeCache(null);
    await detailsPlacesEnvelope({
      provider: new FakeProvider(),
      configured: true,
      googlePlaceId: KALALOCH.googlePlaceId,
      cache,
      now: NOW,
    });
    expect(cache.puts).toEqual([KALALOCH_DETAILS]);
  });

  it("a cache that throws never fails the read — on either side", async () => {
    for (const mode of ["get-throws", "put-throws"] as const) {
      const cache = new FakeCache(null, mode);
      const envelope = await detailsPlacesEnvelope({
        provider: new FakeProvider(),
        configured: true,
        googlePlaceId: KALALOCH.googlePlaceId,
        cache,
        now: NOW,
      });
      expect(envelope).toEqual({ results: [KALALOCH_DETAILS], degraded: false });
    }
  });

  it("never caches what the stub did not look up — state ④ stays empty", async () => {
    const cache = new FakeCache(null);
    const envelope = await detailsPlacesEnvelope({
      provider: new StubPlacesProvider(),
      configured: false,
      googlePlaceId: KALALOCH.googlePlaceId,
      cache,
      now: NOW,
    });
    expect(envelope).toEqual({ results: [], degraded: true, reason: "no_provider" });
    expect(cache.puts).toEqual([]);
  });

  it("caches nothing for an id Google has retired — no row to remember", async () => {
    const cache = new FakeCache(null);
    const envelope = await detailsPlacesEnvelope({
      provider: new FakeProvider([]),
      configured: true,
      googlePlaceId: "ChIJretired",
      cache,
      now: NOW,
    });
    expect(envelope).toEqual({ results: [], degraded: false });
    expect(cache.puts).toEqual([]);
  });

  it("is 30 days, to the millisecond", () => {
    expect(PLACE_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
