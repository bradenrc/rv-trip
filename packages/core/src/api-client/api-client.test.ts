import { describe, it, expect, vi } from "vitest";
import { ZodError } from "zod";
import { createApiClient, ApiError, bearerAuthHeader } from "./index";

/** A fetch double that records the call and replies with a canned response. */
function fakeFetch(status: number, body: unknown = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const summary = {
  id: "t1",
  title: "Loop",
  homeBase: null,
  startDate: "2026-08-01",
  endDate: "2026-08-10",
  status: "planning",
  statusAuto: true,
  rating: null,
  note: null,
  days: 10,
  stops: 3,
  legs: 2,
  miles: 412,
  milesEstimated: false,
  open: 3,
};

describe("createApiClient", () => {
  it("GETs /api/trips and validates the rows", async () => {
    const f = fakeFetch(200, [summary]);
    const api = createApiClient({ baseUrl: "http://x/", fetch: f.fn });
    const rows = await api.trips.list();
    expect(rows).toEqual([summary]);
    expect(f.calls[0]!.url).toBe("http://x/api/trips");
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("throws a ZodError when the server drifts from the contract", async () => {
    const f = fakeFetch(200, [{ ...summary, days: "ten" }]);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.list()).rejects.toBeInstanceOf(ZodError);
  });

  it("throws ApiError with the status and body on non-2xx", async () => {
    const f = fakeFetch(404, { error: "trip not found" });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const err = await api.trips.get("nope").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, method: "GET", path: "/api/trips/nope", body: { error: "trip not found" } });
  });

  it("sends the Authorization header when the seam provides one", async () => {
    const f = fakeFetch(200, null);
    const api = createApiClient({
      baseUrl: "http://x",
      fetch: f.fn,
      getAuthHeader: async () => "Bearer jwt",
    });
    await api.rig.get();
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer jwt");
  });

  it("PATCHes JSON and resolves void on 204", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.stops.patch("s1", { rating: 4 })).resolves.toBeUndefined();
    const { url, init } = f.calls[0]!;
    expect(url).toBe("http://x/api/stops/s1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ rating: 4 });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("coerces a created reservation row into the domain shape", async () => {
    const f = fakeFetch(201, { id: "r1", stopId: "s1", type: "dining", name: "Taco", cost: "42.50" });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const r = await api.reservations.create({ stopId: "s1", type: "dining", name: "Taco", cost: 42.5, checkIn: null });
    expect(r).toEqual({
      id: "r1",
      stopId: "s1",
      ideaId: null,
      type: "dining",
      name: "Taco",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: 42.5,
      rating: null,
      notes: null,
      // Every W0 create is stop-attached (#110 Q2 A): the segment half is empty.
      segmentId: null,
      startsAt: null,
      endsAt: null,
      startsTz: null,
      endsTz: null,
      // A create carries no history: the byline is joined on the READ path
      // (#78 §6), so a just-made row comes back with `lastChange: null`.
      lastChange: null,
    });
  });

  it("validates the trip bundle, defaults included", async () => {
    const f = fakeFetch(200, {
      trip: {
        id: "t1",
        ownerId: "o",
        title: "Loop",
        startDate: "2026-08-01",
        endDate: "2026-08-10",
        rating: null,
        legs: [],
      },
      routes: {
        "1,2|3,4|no-rig": {
          durationSeconds: 60,
          distanceMeters: 1000,
          polyline: null,
          primaryRoad: null,
          source: "estimate",
          notices: [],
        },
      },
      rigHash: "no-rig",
      hasRig: false,
    });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const b = await api.trips.get("t1");
    expect(b.trip.status).toBe("planning");
    expect(b.trip.statusAuto).toBe(true);
    expect(b.trip.homeBase).toBeNull();
    expect(Object.keys(b.routes)).toEqual(["1,2|3,4|no-rig"]);
  });

  it("URL-encodes ids", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await api.ideas.patch("a/b", { status: "done" });
    expect(f.calls[0]!.url).toBe("http://x/api/ideas/a%2Fb");
  });
});

describe("bearerAuthHeader", () => {
  it("resolves null when there is no token getter at all — the keyless build", async () => {
    expect(await bearerAuthHeader(null)()).toBeNull();
    expect(await bearerAuthHeader(undefined)()).toBeNull();
  });

  it("builds no Authorization header through the client when it resolves null", async () => {
    const f = fakeFetch(200, null);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn, getAuthHeader: bearerAuthHeader(null) });
    await api.rig.get();
    expect(f.calls[0]!.init.headers as Record<string, string>).not.toHaveProperty("authorization");
  });

  it("prefixes the token with Bearer", async () => {
    expect(await bearerAuthHeader(() => "jwt")()).toBe("Bearer jwt");
    expect(await bearerAuthHeader(async () => "jwt")()).toBe("Bearer jwt");
  });

  it("resolves null for every empty token a session can hand back", async () => {
    expect(await bearerAuthHeader(() => null)()).toBeNull();
    expect(await bearerAuthHeader(() => undefined)()).toBeNull();
    expect(await bearerAuthHeader(async () => "")()).toBeNull();
  });

  it("asks for the token on every request, so a rotated session is picked up", async () => {
    let n = 0;
    const f = fakeFetch(200, null);
    const api = createApiClient({
      baseUrl: "http://x",
      fetch: f.fn,
      getAuthHeader: bearerAuthHeader(() => `t${++n}`),
    });
    await api.rig.get();
    await api.rig.get();
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer t1");
    expect((f.calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer t2");
  });

  it("survives a getter that throws — an offline token refresh must not break the read", async () => {
    await expect(
      bearerAuthHeader(() => {
        throw new Error("network down");
      })(),
    ).resolves.toBeNull();
  });
});

// ── #111 · the capture calls ──────────────────────────────────────────────

const SAVED_ROW = {
  id: "5b1e0000-0000-4000-8000-000000000001",
  ownerId: "dev-user",
  place: { name: "El Chandelier", lat: 9.93, lng: -84.07, googlePlaceId: "ChIJchandelier" },
  region: null,
  type: "dining",
  status: "want",
  note: null,
  source: "Marcy",
  rating: null,
  tripId: null,
  tripName: null,
  lastChange: null,
  anchor: "place",
  areaLabel: null,
  destination: {
    id: "d7a00000-0000-4000-8000-000000000001",
    name: "San José, Costa Rica",
    region: "Costa Rica",
    googlePlaceId: "ChIJsanjose",
    lat: 9.9281,
    lng: -84.0907,
  },
  suggestedPlace: null,
};

describe("createApiClient — capture (#111)", () => {
  it("POSTs a save and reads the destination off the answer", async () => {
    const f = fakeFetch(201, SAVED_ROW);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const body = { clientId: "cap_1", name: "El Chandelier", googlePlaceId: "ChIJchandelier", anchor: "place" as const };
    const saved = await api.places.create(body);
    expect(saved.destination?.name).toBe("San José, Costa Rica");
    expect(f.calls[0]!.url).toBe("http://x/api/places");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual(body);
  });

  it("defaults the capture fields on a save from an older server", async () => {
    const { anchor, areaLabel, destination, suggestedPlace, ...old } = SAVED_ROW;
    void anchor, void areaLabel, void destination, void suggestedPlace;
    const api = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(200, old).fn });
    const saved = await api.places.create({ name: "El Chandelier" });
    expect(saved.destination).toBeNull();
    expect(saved.suggestedPlace).toBeNull();
  });

  it("throws ApiError with the status on a refused save — the queue keys off it", async () => {
    const api = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(400, { error: "bad" }).fn });
    await expect(api.places.create({ name: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("searches with q and near, and reads a throttled 429 as the degraded envelope", async () => {
    const hit = {
      googlePlaceId: "ChIJchandelier",
      name: "El Chandelier",
      location: { lat: 9.93, lng: -84.07 },
      rating: 4.6,
      address: "San José, Costa Rica",
      primaryType: "restaurant",
      primaryTypeDisplayName: "Restaurant",
    };
    const f = fakeFetch(200, { results: [hit], degraded: false });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const env = await api.places.search("chandel", { lat: 9.9325, lng: -84.0521 });
    expect(env.results[0]?.primaryType).toBe("restaurant");
    expect(f.calls[0]!.url).toBe("http://x/api/places/search?q=chandel&near=9.9325%2C-84.0521");

    const limited = { results: [], degraded: true, reason: "rate_limited", retryAfterMs: 2000 };
    const api429 = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(429, limited).fn });
    await expect(api429.places.search("chandel")).resolves.toEqual(limited);
  });

  it("DELETEs a save for Undo", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.places.remove("s 1")).resolves.toBeUndefined();
    expect(f.calls[0]!.url).toBe("http://x/api/places/s%201");
    expect(f.calls[0]!.init.method).toBe("DELETE");
  });

  it("resolves a point to its destination, or null", async () => {
    const dest = { googlePlaceId: "ChIJsanjose", name: "San José, Costa Rica", region: "Costa Rica", lat: 9.9281, lng: -84.0907 };
    const f = fakeFetch(200, dest);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    expect(await api.destinations.resolve({ lat: 9.9325, lng: -84.0521 })).toEqual(dest);
    expect(f.calls[0]!.url).toBe("http://x/api/destinations/resolve?near=9.9325,-84.0521");
    const none = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(200, null).fn });
    expect(await none.destinations.resolve({ lat: 42.53, lng: -118.53 })).toBeNull();
  });
});
