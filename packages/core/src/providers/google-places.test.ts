import { describe, it, expect, afterEach } from "vitest";
import {
  GooglePlacesProvider,
  DETAILS_FIELD_MASK,
  GEOCODE_URL,
  SEARCH_FIELD_MASK,
  SEARCH_URL,
  buildSearchBody,
  googleCredentialsFromEnv,
  parseDetailsResponse,
  parseReverseGeocode,
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
          primaryType: "campground",
          primaryTypeDisplayName: { text: "Campground", languageCode: "en" },
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
        primaryType: "campground",
        primaryTypeDisplayName: "Campground",
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
        primaryType: null,
        primaryTypeDisplayName: null,
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
        primaryType: null,
        primaryTypeDisplayName: null,
      },
    ]);
  });

  it("reads no matches as an empty list — Google omits `places` entirely", () => {
    expect(parseSearchResponse({})).toEqual([]);
  });

  it("maps a details payload (one place, unwrapped) onto one PlaceDetails", () => {
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
      // The four details-only fields are always PRESENT, and null when Google
      // did not send them (#82 §7②) — the whole point of the mapper fork.
      userRatingCount: null,
      websiteUri: null,
      nationalPhoneNumber: null,
      googleMapsUri: null,
    });
  });

  it("carries the four G-line fields through instead of dropping them (#82, #91)", () => {
    expect(
      parseDetailsResponse({
        id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        displayName: { text: "Astoria/Warrenton KOA" },
        rating: 4.6,
        userRatingCount: 812,
        websiteUri: "https://koa.com/campgrounds/astoria/",
        nationalPhoneNumber: "(503) 325-0013",
        googleMapsUri: "https://maps.google.com/?cid=10281119596374313554",
      }),
    ).toEqual({
      googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      name: "Astoria/Warrenton KOA",
      location: null,
      rating: 4.6,
      address: null,
      userRatingCount: 812,
      websiteUri: "https://koa.com/campgrounds/astoria/",
      nationalPhoneNumber: "(503) 325-0013",
      googleMapsUri: "https://maps.google.com/?cid=10281119596374313554",
    });
  });

  it("still drops a row with no id or no name, four extra fields or not", () => {
    expect(parseDetailsResponse({ displayName: { text: "Nameless id" }, userRatingCount: 9 })).toBeNull();
    expect(parseDetailsResponse({ id: "ChIJ_no_name", websiteUri: "https://x.test" })).toBeNull();
  });

  it("the masks FORK — the details-only fields are on details and NOT on search", () => {
    for (const field of ["userRatingCount", "websiteUri", "nationalPhoneNumber", "googleMapsUri"]) {
      expect(DETAILS_FIELD_MASK.split(",")).toContain(field);
      expect(SEARCH_FIELD_MASK).not.toContain(field);
    }
    // Search keeps its cheap five, each under `places.`, plus the two type
    // fields the capture sheet's tile and subline need (#111).
    expect(SEARCH_FIELD_MASK).toBe(
      "places.id,places.displayName,places.location,places.rating,places.formattedAddress," +
        "places.primaryType,places.primaryTypeDisplayName",
    );
    expect(DETAILS_FIELD_MASK).not.toContain("primaryType");
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

// ── #111 · resolveArea, against mocked Geocoding answers ────────────

/** One `result_type=locality` answer, shaped like Google's. */
function geocodeAnswer(p: {
  placeId: string;
  locality: string;
  admin: [long: string, short: string] | null;
  country: [long: string, short: string];
  at: { lat: number; lng: number };
}) {
  const comps = [
    { long_name: p.locality, short_name: p.locality, types: ["locality", "political"] },
    ...(p.admin
      ? [{ long_name: p.admin[0], short_name: p.admin[1], types: ["administrative_area_level_1", "political"] }]
      : []),
    { long_name: p.country[0], short_name: p.country[1], types: ["country", "political"] },
  ];
  return {
    status: "OK",
    results: [
      {
        place_id: p.placeId,
        address_components: comps,
        geometry: { location: p.at },
        types: ["locality", "political"],
      },
    ],
  };
}

const BANDON = geocodeAnswer({
  placeId: "ChIJbandon",
  locality: "Bandon",
  admin: ["Oregon", "OR"],
  country: ["United States", "US"],
  at: { lat: 43.119, lng: -124.4084 },
});
const SAN_JOSE = geocodeAnswer({
  placeId: "ChIJsanjose",
  locality: "San José",
  admin: ["San José Province", "San José Province"],
  country: ["Costa Rica", "CR"],
  at: { lat: 9.9281, lng: -84.0907 },
});
// The Alvord pin's nearest "locality" by Google's reckoning — Burns, 70+ mi off.
const BURNS = geocodeAnswer({
  placeId: "ChIJburns",
  locality: "Burns",
  admin: ["Oregon", "OR"],
  country: ["United States", "US"],
  at: { lat: 43.5862, lng: -119.0541 },
});

const BLM_PIN = { lat: 43.05, lng: -124.33 };
const CAPTURE_SAN_JOSE = { lat: 9.9325, lng: -84.0521 };
const ALVORD_PIN = { lat: 42.53, lng: -118.53 };

describe("parseReverseGeocode — the one naming rule", () => {
  it("names a US locality 'Locality, ST' under the state's long name", () => {
    expect(parseReverseGeocode(BANDON, BLM_PIN)).toEqual({
      googlePlaceId: "ChIJbandon",
      name: "Bandon, OR",
      region: "Oregon",
      lat: 43.119,
      lng: -124.4084,
    });
  });

  it("names anywhere else 'Locality, Country' under the country", () => {
    expect(parseReverseGeocode(SAN_JOSE, CAPTURE_SAN_JOSE)).toEqual({
      googlePlaceId: "ChIJsanjose",
      name: "San José, Costa Rica",
      region: "Costa Rica",
      lat: 9.9281,
      lng: -84.0907,
    });
  });

  it("is null for a locality more than 25 mi from the point", () => {
    expect(parseReverseGeocode(BURNS, ALVORD_PIN)).toBeNull();
  });

  it("is null when there is no locality at all", () => {
    expect(parseReverseGeocode({ status: "OK", results: [] }, ALVORD_PIN)).toBeNull();
    expect(parseReverseGeocode({}, ALVORD_PIN)).toBeNull();
  });
});

describe("GooglePlacesProvider.resolveArea", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("asks the Geocoding API for a locality at the point, and names it", async () => {
    const stub = stubFetch(() => ({ json: BANDON }));
    restore = stub.restore;

    const dest = await PROVIDER().resolveArea(BLM_PIN.lat, BLM_PIN.lng);

    expect(dest?.name).toBe("Bandon, OR");
    expect(dest?.region).toBe("Oregon");
    const url = new URL(stub.calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(GEOCODE_URL);
    expect(url.searchParams.get("latlng")).toBe("43.05,-124.33");
    expect(url.searchParams.get("result_type")).toBe("locality");
    expect(url.searchParams.get("key")).toBe("k");
  });

  it("resolves San José, Costa Rica", async () => {
    const stub = stubFetch(() => ({ json: SAN_JOSE }));
    restore = stub.restore;
    const dest = await PROVIDER().resolveArea(CAPTURE_SAN_JOSE.lat, CAPTURE_SAN_JOSE.lng);
    expect(dest).toMatchObject({ name: "San José, Costa Rica", region: "Costa Rica" });
  });

  it("is null past 25 mi and on ZERO_RESULTS", async () => {
    let stub = stubFetch(() => ({ json: BURNS }));
    restore = stub.restore;
    expect(await PROVIDER().resolveArea(ALVORD_PIN.lat, ALVORD_PIN.lng)).toBeNull();
    restore();
    stub = stubFetch(() => ({ json: { status: "ZERO_RESULTS", results: [] } }));
    restore = stub.restore;
    expect(await PROVIDER().resolveArea(ALVORD_PIN.lat, ALVORD_PIN.lng)).toBeNull();
  });

  it("throws on a refused key or an HTTP failure — the caller decides", async () => {
    let stub = stubFetch(() => ({ json: { status: "REQUEST_DENIED", results: [] } }));
    restore = stub.restore;
    await expect(PROVIDER().resolveArea(1, 2)).rejects.toThrow(/REQUEST_DENIED/);
    restore();
    stub = stubFetch(() => ({ status: 500 }));
    restore = stub.restore;
    await expect(PROVIDER().resolveArea(1, 2)).rejects.toThrow(/500/);
  });
});
