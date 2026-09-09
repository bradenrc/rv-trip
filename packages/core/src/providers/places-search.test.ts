import { describe, expect, it } from "vitest";
import type { LatLng, PlaceSummary, PlacesProvider } from "./index";
import { StubPlacesProvider } from "./index";
import {
  OwnerTokenBucket,
  SEARCH_RATE_LIMIT,
  SEARCH_RATE_WINDOW_MS,
  detailsPlacesEnvelope,
  googlePlaceIdSchema,
  placesEnvelopeStatus,
  placesSearchQuerySchema,
  searchPlacesEnvelope,
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

/** Answers with the fixture and records what it was asked. */
class FakeProvider implements PlacesProvider {
  readonly searches: { query: string; near?: LatLng }[] = [];
  readonly detailsCalls: string[] = [];
  constructor(private readonly rows: PlaceSummary[] = [KALALOCH]) {}
  async search(query: string, near?: LatLng): Promise<PlaceSummary[]> {
    this.searches.push({ query, near });
    return this.rows;
  }
  async details(googlePlaceId: string): Promise<PlaceSummary | null> {
    this.detailsCalls.push(googlePlaceId);
    return this.rows[0] ?? null;
  }
}

/** Google answered with a 500, or the socket died. */
class BrokenProvider implements PlacesProvider {
  async search(): Promise<PlaceSummary[]> {
    throw new Error("Google places:searchText → 500");
  }
  async details(): Promise<PlaceSummary | null> {
    throw new Error("Google places/details → 500");
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
    expect(envelope).toEqual({ results: [KALALOCH], degraded: false });
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
