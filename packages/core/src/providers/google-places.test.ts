import { describe, it, expect, afterEach } from "vitest";
import {
  GooglePlacesProvider,
  DETAILS_FIELD_MASK,
  SEARCH_FIELD_MASK,
  SEARCH_URL,
  buildSearchBody,
  googleCredentialsFromEnv,
  parseDetailsResponse,
  parseSearchResponse,
} from "./google-places";

// Offline tests: `fetch` is stubbed. What is pinned here is OUR side of the
// contract — the request we build, the mapping we apply, and which failures the
// provider hands upward for the route to turn into a degraded envelope. Whether
// Google accepts the request is the walk's job (no GOOGLE_API_KEY locally, so
// every local path still resolves through StubPlacesProvider).

const KALALOCH = { lat: 47.6118, lng: -124.3762 };

describe("googleCredentialsFromEnv", () => {
  it("is null when GOOGLE_API_KEY is absent (the local case)", () => {
    expect(googleCredentialsFromEnv({})).toBeNull();
    expect(googleCredentialsFromEnv({ GOOGLE_API_KEY: "" })).toBeNull();
  });

  it("carries the key when it is configured", () => {
    expect(googleCredentialsFromEnv({ GOOGLE_API_KEY: "k" })).toEqual({ apiKey: "k" });
  });
});

describe("buildSearchBody", () => {
  it("sends the query alone when there is nothing to bias toward", () => {
    expect(buildSearchBody("kalaloch")).toEqual({ textQuery: "kalaloch" });
  });

  it("biases — never restricts — toward the map's centre when one is given", () => {
    expect(buildSearchBody("kalaloch", KALALOCH)).toEqual({
      textQuery: "kalaloch",
      locationBias: {
        circle: { center: { latitude: 47.6118, longitude: -124.3762 }, radius: 50_000 },
      },
    });
  });
});

describe("response mapping", () => {
  it("maps a healthy search payload onto PlaceSummary", () => {
    const results = parseSearchResponse({
      places: [
        {
          id: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
          displayName: { text: "Kalaloch Campground", languageCode: "en" },
          location: { latitude: 47.6118, longitude: -124.3762 },
          rating: 4.4,
          formattedAddress: "156954 US-101, Forks, WA 98331",
        },
      ],
    });
    expect(results).toEqual([
      {
        googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
        name: "Kalaloch Campground",
        location: { lat: 47.6118, lng: -124.3762 },
        rating: 4.4,
        address: "156954 US-101, Forks, WA 98331",
      },
    ]);
  });

  it("nulls location, rating and address when the payload omits them", () => {
    expect(
      parseSearchResponse({
        places: [{ id: "ChIJ_sparse", displayName: { text: "Forest Road 25 pullout" } }],
      }),
    ).toEqual([
      {
        googlePlaceId: "ChIJ_sparse",
        name: "Forest Road 25 pullout",
        location: null,
        rating: null,
        address: null,
      },
    ]);
  });

  it("drops a row with no id or no name — there is nothing to save against", () => {
    expect(
      parseSearchResponse({
        places: [
          { displayName: { text: "nameless id" } },
          { id: "ChIJ_no_name" },
          { id: "ChIJ_partial_location", displayName: { text: "Half a pin" }, location: { latitude: 47.6 } },
        ],
      }),
    ).toEqual([
      {
        googlePlaceId: "ChIJ_partial_location",
        name: "Half a pin",
        location: null,
        rating: null,
        address: null,
      },
    ]);
  });

  it("reads no matches as an empty list — Google omits `places` entirely", () => {
    expect(parseSearchResponse({})).toEqual([]);
  });

  it("maps a details payload (one place, unwrapped) onto one PlaceSummary", () => {
    expect(
      parseDetailsResponse({
        id: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
        displayName: { text: "Kalaloch Campground" },
        location: { latitude: 47.6118, longitude: -124.3762 },
        rating: 4.4,
        formattedAddress: "156954 US-101, Forks, WA 98331",
      }),
    ).toEqual({
      googlePlaceId: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      name: "Kalaloch Campground",
      location: { lat: 47.6118, lng: -124.3762 },
      rating: 4.4,
      address: "156954 US-101, Forks, WA 98331",
    });
  });
});

type Reply = { status?: number; json?: unknown; throws?: boolean };
type Call = { url: string; init: RequestInit | undefined };

/** Installs a scripted `fetch`; returns the calls it recorded. */
function stubFetch(script: (url: string) => Reply): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const reply = script(url);
    if (reply.throws) throw new Error("network down");
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.json ?? {},
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const PROVIDER = () => new GooglePlacesProvider({ apiKey: "k" });
const SEARCH_BODY = {
  places: [
    {
      id: "ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
      displayName: { text: "Kalaloch Campground" },
      location: { latitude: 47.6118, longitude: -124.3762 },
      rating: 4.4,
      formattedAddress: "156954 US-101, Forks, WA 98331",
    },
  ],
};

describe("GooglePlacesProvider", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("posts the text query with the key and the field mask in headers", async () => {
    const stub = stubFetch(() => ({ json: SEARCH_BODY }));
    restore = stub.restore;

    const results = await PROVIDER().search("kalaloch", KALALOCH);

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Kalaloch Campground");
    const call = stub.calls[0];
    expect(call?.url).toBe(SEARCH_URL);
    expect(call?.init?.method).toBe("POST");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    expect(headers["X-Goog-FieldMask"]).toBe(SEARCH_FIELD_MASK);
    expect(JSON.parse(String(call?.init?.body))).toEqual(buildSearchBody("kalaloch", KALALOCH));
  });

  it("never asks Google about an empty query", async () => {
    const stub = stubFetch(() => ({ json: SEARCH_BODY }));
    restore = stub.restore;
    expect(await PROVIDER().search("   ")).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it("gets one place by id, key and mask in headers", async () => {
    const stub = stubFetch(() => ({ json: SEARCH_BODY.places[0] }));
    restore = stub.restore;

    const place = await PROVIDER().details("ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q");

    expect(place?.googlePlaceId).toBe("ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q");
    expect(stub.calls[0]?.url).toBe(
      "https://places.googleapis.com/v1/places/ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q",
    );
    const headers = stub.calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toBe(DETAILS_FIELD_MASK);
  });

  it("returns null for an id Google no longer knows — not a failure", async () => {
    const stub = stubFetch(() => ({ status: 404 }));
    restore = stub.restore;
    expect(await PROVIDER().details("ChIJ_gone")).toBeNull();
  });

  // The provider does NOT swallow an upstream failure: the route needs it to
  // tell reason:"upstream_error" apart from a genuinely empty result list.
  it("throws on an upstream failure so the route can report it", async () => {
    const stub = stubFetch(() => ({ status: 500 }));
    restore = stub.restore;
    await expect(PROVIDER().search("kalaloch")).rejects.toThrow(/500/);
    await expect(PROVIDER().details("ChIJvT2R")).rejects.toThrow(/500/);
  });

  it("lets a network error propagate for the same reason", async () => {
    const stub = stubFetch(() => ({ throws: true }));
    restore = stub.restore;
    await expect(PROVIDER().search("kalaloch")).rejects.toThrow("network down");
  });
});
