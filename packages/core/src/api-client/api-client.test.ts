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
  destinations: 3,
  chapters: 2,
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
    await expect(api.destinations.patch("s1", { rating: 4 })).resolves.toBeUndefined();
    const { url, init } = f.calls[0]!;
    expect(url).toBe("http://x/api/destinations/s1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ rating: 4 });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("coerces a created reservation row into the domain shape", async () => {
    const f = fakeFetch(201, { id: "r1", destinationId: "s1", type: "dining", name: "Taco", cost: "42.50" });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const r = await api.reservations.create({ destinationId: "s1", type: "dining", name: "Taco", cost: 42.5, checkIn: null });
    expect(r).toEqual({
      id: "r1",
      destinationId: "s1",
      ideaId: null,
      type: "dining",
      name: "Taco",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: 42.5,
      rating: null,
      notes: null,
      // An older server's bare row: the segment half and the kind default null.
      segmentId: null,
      startsAt: null,
      endsAt: null,
      startsTz: null,
      endsTz: null,
      lodgingKind: null,
      transportKind: null,
      // A create carries no history: the byline is joined on the READ path
      // (#78 §6), so a just-made row comes back with `lastChange: null, again: null`.
      lastChange: null,
      again: null,
    });
  });

  it("keeps a flight's segment and clock, and a stay's kind (vet HIGH · #104/#105)", async () => {
    const flight = {
      id: "r2",
      destinationId: null,
      segmentId: "seg1",
      type: "transport" as const,
      name: "AA 1190 LIR→DFW",
      startsAt: "2027-01-25T01:30:00.000Z",
      startsTz: "America/Costa_Rica",
      endsAt: "2027-01-25T05:55:00.000Z",
      endsTz: "America/Chicago",
      lodgingKind: null,
    };
    const f = fakeFetch(201, flight);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const r = await api.reservations.create({ ...flight, moveDestination: true });
    expect(r).toMatchObject({ destinationId: null, segmentId: "seg1", startsTz: "America/Costa_Rica", endsTz: "America/Chicago" });
    expect(JSON.parse(f.calls[0]!.init.body as string).moveDestination).toBe(true);

    const g = fakeFetch(201, { id: "r3", destinationId: "s1", type: "lodging", name: "Jane & Rick", lodgingKind: "friends" });
    const stay = await createApiClient({ baseUrl: "http://x", fetch: g.fn }).reservations.create({
      destinationId: "s1",
      type: "lodging",
      name: "Jane & Rick",
      lodgingKind: "friends",
    });
    expect(stay.lodgingKind).toBe("friends");
  });

  it("creates a trip and patches a segment (#103 · #104)", async () => {
    const f = fakeFetch(201, {
      id: "t9",
      ownerId: "o",
      title: "Costa Rica Fly & Stay",
      startDate: "2027-01-16",
      endDate: "2027-01-25",
      defaultMode: "fly",
      lodgingDefault: "hotel",
      rigOn: false,
      rating: null,
      chapters: [],
    });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const trip = await api.trips.create({
      title: "Costa Rica Fly & Stay",
      startDate: "2027-01-16",
      endDate: "2027-01-25",
      homeBase: null,
      homeBasePlace: null,
      defaultMode: "fly",
      lodgingDefault: "hotel",
      rigOn: false,
    });
    expect(trip).toMatchObject({ id: "t9", defaultMode: "fly", rigOn: false });
    expect(f.calls[0]!.url).toBe("http://x/api/trips");

    const g = fakeFetch(204);
    await expect(
      createApiClient({ baseUrl: "http://x", fetch: g.fn }).segments.patch("seg1", { mode: "fly" }),
    ).resolves.toBeUndefined();
    expect(g.calls[0]!.url).toBe("http://x/api/segments/seg1");
    expect(JSON.parse(g.calls[0]!.init.body as string)).toEqual({ mode: "fly" });
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
        chapters: [],
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

  it("#113 · GETs for-next-time and validates it; DELETEs an idea for Did it's Undo", async () => {
    const f = fakeFetch(200, { cards: [], saveIds: [] });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.forNextTime("t1")).resolves.toEqual({ cards: [], saveIds: [] });
    expect(f.calls[0]!.url).toBe("http://x/api/trips/t1/for-next-time");
    const d = fakeFetch(204);
    await createApiClient({ baseUrl: "http://x", fetch: d.fn }).ideas.remove("i1");
    expect(d.calls[0]!.url).toBe("http://x/api/ideas/i1");
    expect(d.calls[0]!.init.method).toBe("DELETE");
    // A malformed answer is drift, and drift throws.
    const bad = fakeFetch(200, { cards: "nope" });
    await expect(createApiClient({ baseUrl: "http://x", fetch: bad.fn }).trips.forNextTime("t1")).rejects.toThrow();
  });

  it("#143 · DELETEs a reservation for Delete stay / Delete flight", async () => {
    const d = fakeFetch(204);
    await expect(
      createApiClient({ baseUrl: "http://x", fetch: d.fn }).reservations.remove("r 1"),
    ).resolves.toBeUndefined();
    expect(d.calls[0]!.url).toBe("http://x/api/reservations/r%201");
    expect(d.calls[0]!.init.method).toBe("DELETE");
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
  again: null,
  anchor: "place",
  areaLabel: null,
  area: {
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
  it("POSTs a save and reads the area off the answer", async () => {
    const f = fakeFetch(201, SAVED_ROW);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const body = { clientId: "cap_1", name: "El Chandelier", googlePlaceId: "ChIJchandelier", anchor: "place" as const };
    const saved = await api.places.create(body);
    expect(saved.area?.name).toBe("San José, Costa Rica");
    expect(f.calls[0]!.url).toBe("http://x/api/places");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual(body);
  });

  it("defaults the capture fields on a save from an older server", async () => {
    const { anchor, areaLabel, area, suggestedPlace, ...old } = SAVED_ROW;
    void anchor, void areaLabel, void area, void suggestedPlace;
    const api = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(200, old).fn });
    const saved = await api.places.create({ name: "El Chandelier" });
    expect(saved.area).toBeNull();
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

  it("PATCHes the Saves tab's upgrade and dismiss, answering nothing (#111 i2)", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.places.patch("s 1", { upgradeToSuggested: true })).resolves.toBeUndefined();
    await api.places.patch("s1", { suggestedPlace: null });
    expect(f.calls[0]!.url).toBe("http://x/api/places/s%201");
    expect(f.calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ upgradeToSuggested: true });
    expect(JSON.parse(f.calls[1]!.init.body as string)).toEqual({ suggestedPlace: null });
  });

  it("throws ApiError 409 when there was no suggestion to take", async () => {
    const api = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(409, { error: "no suggestion" }).fn });
    await expect(api.places.patch("s1", { upgradeToSuggested: true })).rejects.toMatchObject({ status: 409 });
  });

  it("DELETEs a save for Undo", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.places.remove("s 1")).resolves.toBeUndefined();
    expect(f.calls[0]!.url).toBe("http://x/api/places/s%201");
    expect(f.calls[0]!.init.method).toBe("DELETE");
  });

  it("resolves a point to its area, or null", async () => {
    const dest = { googlePlaceId: "ChIJsanjose", name: "San José, Costa Rica", region: "Costa Rica", lat: 9.9281, lng: -84.0907 };
    const f = fakeFetch(200, dest);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    expect(await api.areas.resolve({ lat: 9.9325, lng: -84.0521 })).toEqual(dest);
    expect(f.calls[0]!.url).toBe("http://x/api/areas/resolve?near=9.9325,-84.0521");
    const none = createApiClient({ baseUrl: "http://x", fetch: fakeFetch(200, null).fn });
    expect(await none.areas.resolve({ lat: 42.53, lng: -118.53 })).toBeNull();
  });
});

describe("createApiClient — trip surfacing (#111 i3)", () => {
  const item = {
    saveId: "s1",
    name: "Fort Stevens State Park",
    type: "campground",
    status: "want",
    rating: null,
    source: "Jane & Rick",
    place: { name: "Fort Stevens State Park", lat: 46.2045, lng: -123.958, googlePlaceId: null },
    nearestDestination: { id: "st1", name: "Astoria, OR" },
    distanceMi: 6.2,
  };

  it("GETs the nearby saves and validates them", async () => {
    const body = {
      radiusMi: 50,
      items: [item],
      beyond: { radiusMi: 100, count: 1, nearestMi: 50.3, nearestName: "Cape Lookout State Park" },
    };
    const f = fakeFetch(200, body);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.nearbySaves("t 1")).resolves.toEqual(body);
    expect(f.calls[0]!.url).toBe("http://x/api/trips/t%201/nearby-saves");
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("refuses a nearby item with no place — the Add path needs it", async () => {
    const { place: _omit, ...noPlace } = item;
    const f = fakeFetch(200, { radiusMi: 50, items: [noPlace], beyond: null });
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.nearbySaves("t1")).rejects.toBeInstanceOf(ZodError);
  });

  it("POSTs the dismissal and resolves void on 204", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.dismissSaves("t1", ["a", "b"])).resolves.toBeUndefined();
    expect(f.calls[0]!.url).toBe("http://x/api/trips/t1/dismissed-saves");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ saveIds: ["a", "b"] });
  });

  it("PATCHes the trip's radius", async () => {
    const f = fakeFetch(204);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    await expect(api.trips.patch("t1", { surfaceRadiusMi: 100 })).resolves.toBeUndefined();
    expect(f.calls[0]!.url).toBe("http://x/api/trips/t1");
    expect(f.calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ surfaceRadiusMi: 100 });
  });

  it("POSTs an idea and reads back the created Idea", async () => {
    const created = {
      id: "i1",
      tripId: "t1",
      destinationId: null,
      title: "Fort Stevens State Park",
      category: "stay",
      status: "idea",
      place: item.place,
      rating: null,
      notes: "Jane & Rick",
      sortOrder: 0,
      lastChange: null,
      again: null,
    };
    const f = fakeFetch(201, created);
    const api = createApiClient({ baseUrl: "http://x", fetch: f.fn });
    const body = {
      tripId: "t1",
      destinationId: null,
      category: "stay" as const,
      title: "Fort Stevens State Park",
      status: "idea" as const,
      place: item.place,
      rating: null,
      notes: "Jane & Rick",
    };
    await expect(api.ideas.create(body)).resolves.toEqual(created);
    expect(f.calls[0]!.url).toBe("http://x/api/ideas");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual(body);
  });
});
