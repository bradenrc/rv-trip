import { expect, it } from "vitest";
import { tripBundleSchema } from "@rv-trip/core/api-client";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { GET } from "@/app/api/trips/[id]/nearby-saves/route";
import { POST as DISMISS } from "@/app/api/trips/[id]/dismissed-saves/route";
import { GET as GET_TRIP, PATCH } from "@/app/api/trips/[id]/route";
import { POST as ADD_IDEA } from "@/app/api/ideas/route";
import { nearbyIdeaBody, nearbySavesResponse } from "@rv-trip/core";
import { ctx, describeDb, req } from "@/test/db";

/**
 * Trip surfacing end to end (#111 i3): the nearby-saves read, the per-trip
 * dismissals, and the radius on the trip PATCH — real handlers, real Postgres.
 */

/** The Oregon Coast trip: Astoria + Newport, both floating. */
async function coastTrip(owner = DEV_OWNER) {
  const trip = await fx.trip({ owner, title: "Oregon Coast, summer '27", homeBase: null });
  const leg = await fx.leg({ tripId: trip.id, title: "Coast" });
  await fx.stop({ legId: leg.id, placeName: "Astoria, OR", lat: 46.1879, lng: -123.8313, arriveDate: null, departDate: null, sortOrder: 0 });
  await fx.stop({ legId: leg.id, placeName: "Newport, OR", lat: 44.6365, lng: -124.053, arriveDate: null, departDate: null, sortOrder: 1 });
  return trip;
}

async function coastSaves(owner = DEV_OWNER) {
  const s = (name: string, lat: number, lng: number, extra: Parameters<typeof fx.savedPlace>[0] = {}) =>
    fx.savedPlace({ owner, name, lat, lng, region: null, ...extra });
  return {
    south: await s("South Beach State Park", 44.6094, -124.0631, { status: "been", rating: 5 }),
    fort: await s("Fort Stevens State Park", 46.2045, -123.958, { source: "Jane & Rick" }),
    bev: await s("Beverly Beach State Park", 44.7262, -124.0578, { source: "Jane & Rick" }),
    neh: await s("Nehalem Bay State Park", 45.6967, -123.9335, { source: "Jane & Rick" }),
    cape: await s("Cape Lookout State Park", 45.3623, -123.9728, { source: "Marcy" }),
  };
}

const nearby = async (tripId: string) => {
  const res = await GET(req(undefined, "GET"), ctx(tripId));
  expect(res.status).toBe(200);
  return nearbySavesResponse.parse(await res.json());
};

describeDb("GET /api/trips/[id]/nearby-saves · POST dismissed-saves · PATCH surfaceRadiusMi", () => {
  it("answers the saves within the default 50 mi, nearest first, with the next ring", async () => {
    const trip = await coastTrip();
    await coastSaves();
    const body = await nearby(trip.id);
    expect(body.radiusMi).toBe(50);
    expect(body.items.map((i) => [i.name, i.nearestStop.name, i.distanceMi])).toEqual([
      ["South Beach State Park", "Newport, OR", 1.9],
      ["Fort Stevens State Park", "Astoria, OR", 6.2],
      ["Beverly Beach State Park", "Newport, OR", 6.2],
      ["Nehalem Bay State Park", "Astoria, OR", 34],
    ]);
    expect(body.beyond).toEqual({ radiusMi: 100, count: 1, nearestMi: 50.3, nearestName: "Cape Lookout State Park" });
  });

  it("measures an area save with no coordinates from its destination", async () => {
    const trip = await coastTrip();
    const newport = await fx.destination({ googlePlaceId: "ChIJnewport", name: "Newport, OR", lat: 44.6368, lng: -124.0535 });
    await fx.savedPlace({ name: "taco stand", anchor: "area", areaLabel: "Newport, OR", destinationId: newport.id, type: "dining" });
    const body = await nearby(trip.id);
    expect(body.items.map((i) => [i.name, i.nearestStop.name])).toEqual([["taco stand", "Newport, OR"]]);
  });

  it("never surfaces another owner's saves", async () => {
    const trip = await coastTrip();
    await coastSaves(OTHER_OWNER);
    expect((await nearby(trip.id)).items).toEqual([]);
  });

  it("404s another owner's trip", async () => {
    const theirs = await coastTrip(OTHER_OWNER);
    const res = await GET(req(undefined, "GET"), ctx(theirs.id));
    expect(res.status).toBe(404);
  });

  it("a dismissal persists: the dismissed saves are gone from every later GET", async () => {
    const trip = await coastTrip();
    const s = await coastSaves();

    const res = await DISMISS(req({ saveIds: [s.fort.id, s.neh.id] }), ctx(trip.id));
    expect(res.status).toBe(204);
    expect(await read.dismissedSaveIds(trip.id)).toEqual([s.fort.id, s.neh.id].sort());

    const again = await nearby(trip.id);
    expect(again.items.map((i) => i.name)).toEqual(["South Beach State Park", "Beverly Beach State Park"]);
    // …and a second GET still agrees: it is stored, not session state.
    expect((await nearby(trip.id)).items).toHaveLength(2);

    // Idempotent: dismissing the same save again is one row, still 204.
    expect((await DISMISS(req({ saveIds: [s.fort.id] }), ctx(trip.id))).status).toBe(204);
    expect(await read.dismissedSaveIds(trip.id)).toHaveLength(2);
  });

  it("dismissals are per trip — another trip still surfaces the same save", async () => {
    const a = await coastTrip();
    const b = await coastTrip();
    const s = await coastSaves();
    await DISMISS(req({ saveIds: [s.fort.id] }), ctx(a.id));
    expect((await nearby(a.id)).items.map((i) => i.name)).not.toContain("Fort Stevens State Park");
    expect((await nearby(b.id)).items.map((i) => i.name)).toContain("Fort Stevens State Park");
  });

  it("refuses a dismissal on another owner's trip (404, nothing written) and a bad body (400)", async () => {
    const theirs = await coastTrip(OTHER_OWNER);
    const s = await coastSaves();
    const res = await DISMISS(req({ saveIds: [s.fort.id] }), ctx(theirs.id));
    expect(res.status).toBe(404);
    expect(await read.dismissedSaveIds(theirs.id)).toEqual([]);

    const mine = await coastTrip();
    expect((await DISMISS(req({ saveIds: [] }), ctx(mine.id))).status).toBe(400);
    expect((await DISMISS(req({ saveIds: ["nope"] }), ctx(mine.id))).status).toBe(400);
  });

  it("drops another owner's save ids rather than recording them against my trip", async () => {
    const mine = await coastTrip();
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, name: "Their spot", lat: 46.2, lng: -123.9 });
    expect((await DISMISS(req({ saveIds: [theirs.id] }), ctx(mine.id))).status).toBe(204);
    expect(await read.dismissedSaveIds(mine.id)).toEqual([]);
  });

  it("surfaceRadiusMi round-trips through PATCH and GET, drives nearby-saves, and rejects 75", async () => {
    const trip = await coastTrip();
    await coastSaves();

    const res = await PATCH(req({ surfaceRadiusMi: 100 }, "PATCH"), ctx(trip.id));
    expect(res.status).toBe(204);
    expect((await read.trip(trip.id))!.surfaceRadiusMi).toBe(100);
    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip.surfaceRadiusMi).toBe(100);

    const wide = await nearby(trip.id);
    expect(wide.radiusMi).toBe(100);
    expect(wide.items.map((i) => i.name)).toContain("Cape Lookout State Park");
    expect(wide.beyond).toBeNull();

    const bad = await PATCH(req({ surfaceRadiusMi: 75 }, "PATCH"), ctx(trip.id));
    expect(bad.status).toBe(400);
    expect((await read.trip(trip.id))!.surfaceRadiusMi).toBe(100);

    // null clears it back to the default.
    expect((await PATCH(req({ surfaceRadiusMi: null }, "PATCH"), ctx(trip.id))).status).toBe(204);
    expect((await read.trip(trip.id))!.surfaceRadiusMi).toBeNull();
    expect((await nearby(trip.id)).radiusMi).toBe(50);
  });

  it("the database CHECK refuses a radius the grammar would", async () => {
    const trip = await coastTrip();
    const { db } = await import("@rv-trip/db");
    await expect(
      db.$client.query("update trips set surface_radius_mi = 75 where id = $1", [trip.id]),
    ).rejects.toThrow(/trips_surface_radius_mi_ck/);
  });

  it("Add (POST /api/ideas with nearbyIdeaBody) copies the save — and it stops surfacing", async () => {
    const trip = await coastTrip();
    await coastSaves();
    const [south] = (await nearby(trip.id)).items;
    const res = await ADD_IDEA(req(nearbyIdeaBody(trip.id, south!)));
    expect(res.status).toBe(201);
    const idea = await res.json();
    expect(idea).toMatchObject({
      tripId: trip.id,
      stopId: null,
      title: "South Beach State Park",
      category: "stay",
      place: { name: "South Beach State Park", lat: 44.6094, lng: -124.0631 },
    });
    expect((await nearby(trip.id)).items.map((i) => i.name)).not.toContain("South Beach State Park");
  });
});
