import { expect, it, vi } from "vitest";
import type { ResolvedDestination } from "@rv-trip/core";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/places/route";
import { describeDb, req } from "@/test/db";

/**
 * The route resolves destinations through whatever `placesProvider()` answers.
 * That is the stub in CI and the real Google provider on a laptop whose .env
 * carries a key — so the suite pins it to a scripted fake and never bills.
 */
const resolver = vi.hoisted(() => ({
  calls: [] as [number, number][],
  answer: null as ResolvedDestination | null | "throw",
}));
vi.mock("@/lib/places", () => ({
  placesProvider: () => ({
    configured: true,
    provider: {
      search: async () => [],
      details: async () => null,
      resolveDestination: async (lat: number, lng: number) => {
        resolver.calls.push([lat, lng]);
        if (resolver.answer === "throw") throw new Error("Google geocode → 500");
        return resolver.answer;
      },
    },
  }),
}));

const BANDON: ResolvedDestination = {
  googlePlaceId: "ChIJbandon",
  name: "Bandon, OR",
  region: "Oregon",
  lat: 43.119,
  lng: -124.4084,
};

function reset(answer: ResolvedDestination | null | "throw" = null) {
  resolver.calls = [];
  resolver.answer = answer;
}

/** §7 breadth: `saved_places` is account-scoped, but attaching one to another
 * owner's trip must still be "trip not found". */
describeDb("POST /api/places", () => {
  it("404s when the body points at another owner's trip, and saves nothing", async () => {
    reset();
    const theirs = await fx.trip({ owner: OTHER_OWNER });

    const res = await POST(
      req({
        name: "Cape Lookout State Park",
        status: "been",
        rating: 5,
        tripId: theirs.id,
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(0);
    expect(await read.countSavedPlaces(OTHER_OWNER)).toBe(0);
  });
});

// ── #111 · capture ────────────────────────────────────────────────────────

const PIN_BODY = {
  clientId: "cap_01JBX7Q2M4",
  capturedAt: "2026-09-25T17:10:04-07:00",
  anchor: "pin",
  capturedOffline: false,
  lat: 43.05,
  lng: -124.33,
  areaLabel: null,
  name: "great BLM camp spot",
  type: "campground",
  status: "want",
  source: null,
  note: null,
};

describeDb("POST /api/places — capture (#111)", () => {
  it("answers 201 for a new capture and 200 with the SAME row for a replayed clientId", async () => {
    reset(BANDON);

    const first = await POST(req(PIN_BODY));
    expect(first.status).toBe(201);
    const created = await first.json();

    const replay = await POST(req(PIN_BODY));
    expect(replay.status).toBe(200);
    const again = await replay.json();

    expect(again.id).toBe(created.id);
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(1);
    // The replay short-circuits before the resolver: Google is asked once.
    expect(resolver.calls).toEqual([[43.05, -124.33]]);
  });

  it("scopes the clientId to the household — another owner's same id is a new row", async () => {
    reset();
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, clientId: PIN_BODY.clientId });
    const res = await POST(req(PIN_BODY));
    expect(res.status).toBe(201);
    expect((await res.json()).id).not.toBe(theirs.id);
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(1);
    expect(await read.countSavedPlaces(OTHER_OWNER)).toBe(1);
  });

  it("stores an explicit anchor 'area' as area even though the body carries lat/lng", async () => {
    reset(BANDON);
    const res = await POST(
      req({
        clientId: "cap_note_chandel",
        anchor: "area",
        capturedOffline: true,
        lat: 43.0512,
        lng: -124.329,
        name: "chandel",
      }),
    );
    expect(res.status).toBe(201);
    const saved = await res.json();
    const row = (await read.savedPlace(saved.id))!;
    // saveAnchorOf alone would have called this a pin.
    expect(row.anchor).toBe("area");
    expect(saved.anchor).toBe("area");
    // No label sent: the area is named by the locality it resolved to.
    expect(row.areaLabel).toBe("Bandon, OR");
  });

  it("keeps the derived anchor when the body sends none (the web's saves)", async () => {
    reset();
    const res = await POST(req({ name: "Beverly Beach State Park", lat: 44.7262, lng: -124.0578 }));
    expect((await res.json()).anchor).toBe("pin");
  });

  it("400s a pin anchor with no coordinates, and a bad capturedAt", async () => {
    reset();
    expect((await POST(req({ name: "x", anchor: "pin" }))).status).toBe(400);
    expect((await POST(req({ name: "x", capturedAt: "yesterday" }))).status).toBe(400);
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(0);
  });

  it("writes capturedAt to created_at", async () => {
    reset();
    const res = await POST(req(PIN_BODY));
    const row = (await read.savedPlace((await res.json()).id))!;
    expect(row.createdAt.toISOString()).toBe("2026-09-26T00:10:04.000Z");
    expect(row.clientId).toBe("cap_01JBX7Q2M4");
  });

  it("resolves the destination, answers it on the 201, and REUSES the row for the next save", async () => {
    reset(BANDON);
    const first = await (await POST(req(PIN_BODY))).json();
    expect(first.destination).toEqual({
      id: expect.any(String),
      name: "Bandon, OR",
      region: "Oregon",
      googlePlaceId: "ChIJbandon",
      lat: 43.119,
      lng: -124.4084,
    });

    const second = await (
      await POST(req({ ...PIN_BODY, clientId: "cap_second", name: "chandel", anchor: "area" }))
    ).json();
    expect(second.destination.id).toBe(first.destination.id);

    const rows = await read.destinations(DEV_OWNER);
    expect(rows).toHaveLength(1);
    // The locality's own point is stored — an area save with no coordinates is
    // measured from it (the vet's HIGH finding).
    expect(rows[0]).toMatchObject({ region: "Oregon", lat: 43.119, lng: -124.4084 });
    expect((await read.savedPlace(first.id))!.destinationId).toBe(first.destination.id);
  });

  it("writes the save with a null destination when nothing is within 25 mi", async () => {
    reset(null);
    const res = await POST(req({ ...PIN_BODY, name: "pin in the Alvord Desert", lat: 42.53, lng: -118.53 }));
    expect(res.status).toBe(201);
    expect((await res.json()).destination).toBeNull();
    expect(await read.destinations(DEV_OWNER)).toEqual([]);
  });

  it("still saves when Google fails — a null destination, never a failed save", async () => {
    reset("throw");
    const res = await POST(req(PIN_BODY));
    expect(res.status).toBe(201);
    expect((await res.json()).destination).toBeNull();
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(1);
  });

  it("asks nothing for a save with no point", async () => {
    reset(BANDON);
    const res = await POST(req({ name: "taco truck Dana said", anchor: "area" }));
    expect(res.status).toBe(201);
    expect(resolver.calls).toEqual([]);
    expect((await res.json()).destination).toBeNull();
  });
});
