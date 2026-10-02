import { expect, it, vi } from "vitest";
import type { ResolvedArea } from "@rv-trip/core";
import { forNextTimeResponse, nearbySavesResponse } from "@rv-trip/core";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST as POST_IDEA } from "@/app/api/ideas/route";
import { PATCH as PATCH_IDEA } from "@/app/api/ideas/[id]/route";
import { PATCH as PATCH_DESTINATION } from "@/app/api/destinations/[id]/route";
import { PATCH as PATCH_RES } from "@/app/api/reservations/[id]/route";
import { GET as GET_NEXT_TIME } from "@/app/api/trips/[id]/for-next-time/route";
import { GET as GET_NEARBY } from "@/app/api/trips/[id]/nearby-saves/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * W3 Journal (#113) through the REAL handlers: `again` on the three PATCHes,
 * the Been write-through (match-or-create, the area resolved with the
 * resolver the ROUTE hands in — vet HIGH), "Did it"'s idempotent POST, and
 * "Last time here" with its saves left out of the nearby banner.
 *
 * The resolver is a scripted fake: the handlers resolve through
 * `placesProvider()`, and this suite never bills Google.
 */
const resolver = vi.hoisted(() => ({
  calls: [] as [number, number][],
  answer: null as ResolvedArea | null,
}));
vi.mock("@/lib/places", () => ({
  placesProvider: () => ({
    configured: true,
    provider: {
      search: async () => [],
      details: async () => null,
      resolveArea: async (lat: number, lng: number) => {
        resolver.calls.push([lat, lng]);
        return resolver.answer;
      },
    },
  }),
  areaResolver: () => async (lat: number, lng: number) => {
    resolver.calls.push([lat, lng]);
    return resolver.answer;
  },
}));

const GUANACASTE: ResolvedArea = {
  googlePlaceId: "ChIJguanacaste",
  name: "Playa Flamingo, Costa Rica",
  region: "Costa Rica",
  lat: 10.4331,
  lng: -85.7836,
};
const NEWPORT: ResolvedArea = {
  googlePlaceId: "ChIJnewport",
  name: "Newport, OR",
  region: "Oregon",
  lat: 44.6368,
  lng: -124.0535,
};

function reset(answer: ResolvedArea | null = null) {
  resolver.calls = [];
  resolver.answer = answer;
}

const savesOf = async (owner: string) =>
  (await db.select().from(schema.saves)).filter((s) => s.ownerId === owner);

/** Costa Rica, the way the check-off wireframe starts: one destination, the Westin,
 * two ideas with places, and a flight on the hop out. */
async function costaRica(owner = DEV_OWNER) {
  const trip = await fx.trip({ owner, title: "Costa Rica Fly & Stay", startDate: "2027-01-16", endDate: "2027-01-25" });
  const chapter = await fx.chapter({ tripId: trip.id, title: "Guanacaste" });
  const conchal = await fx.destination({
    chapterId: chapter.id,
    placeName: "Westin Reserva Conchal",
    lat: 10.4047,
    lng: -85.8127,
    arriveDate: "2027-01-16",
    departDate: "2027-01-24",
  });
  const westin = await fx.reservation({ destinationId: conchal.id, type: "lodging", name: "Westin Reserva Conchal", rating: null, notes: null });
  const snorkel = await fx.idea({
    tripId: trip.id,
    destinationId: conchal.id,
    title: "Playa Conchal snorkel",
    placeName: "Playa Conchal",
    lat: 10.4012,
    lng: -85.8123,
  });
  return { trip, chapter, conchal, westin, snorkel };
}

describeDb("W3 · the check-off writes again, and writes through to a Been save", () => {
  it("a done idea ★5 Again lands on the idea and creates a Been save anchored to its area", async () => {
    reset(GUANACASTE);
    const { trip, snorkel } = await costaRica();

    const res = await PATCH_IDEA(
      req({ status: "done", rating: 5, again: true, notes: "Go at low tide." }, "PATCH"),
      ctx(snorkel.id),
    );
    expect(res.status).toBe(204);
    expect(await read.idea(snorkel.id)).toMatchObject({ status: "done", rating: 5, again: true });

    const saves = await savesOf(DEV_OWNER);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      name: "Playa Conchal",
      status: "been",
      rating: 5,
      again: true,
      note: "Go at low tide.",
      tripId: trip.id,
      type: "activity",
      lat: 10.4012,
      lng: -85.8123,
    });
    expect(saves[0]!.areaId).not.toBeNull();
    expect(resolver.calls).toEqual([[10.4012, -85.8123]]);
  });

  it("logs the again answer in the change log (the byline's 'marked')", async () => {
    reset();
    const { snorkel } = await costaRica();
    await PATCH_IDEA(req({ again: false }, "PATCH"), ctx(snorkel.id));
    const rows = (await db.select().from(schema.changeLog)).filter(
      (r) => r.entityId === snorkel.id && r.field === "again",
    );
    expect(rows.map((r) => [r.from, r.to])).toEqual([[null, "false"]]);
  });

  it("How was it? on the stay writes a NAME-ONLY save, its area resolved from the destination's point", async () => {
    reset(GUANACASTE);
    const { westin, conchal } = await costaRica();

    const res = await PATCH_RES(req({ rating: 4, again: true, notes: "Ocean side." }, "PATCH"), ctx(westin.id));
    expect(res.status).toBe(204);
    expect(await read.reservation(westin.id)).toMatchObject({ rating: 4, again: true });

    const [save] = await savesOf(DEV_OWNER);
    expect(save).toMatchObject({
      name: "Westin Reserva Conchal",
      lat: null,
      lng: null,
      type: "lodging",
      status: "been",
      again: true,
      region: "Westin Reserva Conchal",
    });
    expect(save!.areaId).not.toBeNull();
    expect(resolver.calls).toEqual([[conchal.lat, conchal.lng]]);
  });

  it("a flight on the hop is never written through, however it is rated", async () => {
    reset(GUANACASTE);
    const { trip, conchal } = await costaRica();
    const seg = await fx.segment({ tripId: trip.id, fromDestinationId: null, toDestinationId: conchal.id, mode: "fly" });
    const [flight] = await db
      .insert(schema.reservations)
      .values({ segmentId: seg.id, type: "transport", name: "AA 2451 BOI→LAX" })
      .returning();

    const res = await PATCH_RES(req({ rating: 5, again: false }, "PATCH"), ctx(flight!.id));
    expect(res.status).toBe(204);
    expect(await savesOf(DEV_OWNER)).toEqual([]);
  });

  it("a match graduates the existing save in place — and resolves the area it lacked", async () => {
    reset(NEWPORT);
    const { trip, newport } = await fx.pacificNorthwestLoop();
    const want = await fx.savedPlace({
      name: "Local Ocean Seafoods",
      lat: 44.6297,
      lng: -124.0526,
      type: "dining",
      status: "want",
      source: "Forum tip",
      note: "Bayfront.",
    });
    const idea = await fx.idea({
      tripId: trip.id,
      destinationId: newport.id,
      title: "Local Ocean Seafoods",
      category: "eat",
      placeName: "Local Ocean Seafoods",
      lat: 44.6299,
      lng: -124.0534,
    });

    await PATCH_IDEA(req({ status: "done", again: true }, "PATCH"), ctx(idea.id));

    const saves = await savesOf(DEV_OWNER);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      id: want.id,
      status: "been",
      again: true,
      source: null,
      // No note of its own: the save keeps the one it had.
      note: "Bayfront.",
      tripId: trip.id,
    });
    expect(saves[0]!.areaId).not.toBeNull();
  });

  it("an un-check leaves the Been save where it is — the write-through never deletes", async () => {
    reset();
    const { snorkel } = await costaRica();
    await PATCH_IDEA(req({ status: "done" }, "PATCH"), ctx(snorkel.id));
    expect(await savesOf(DEV_OWNER)).toHaveLength(1);
    await PATCH_IDEA(req({ status: "idea" }, "PATCH"), ctx(snorkel.id));
    expect(await read.idea(snorkel.id)).toMatchObject({ status: "idea" });
    expect(await savesOf(DEV_OWNER)).toHaveLength(1);
  });

  it("a rated destination writes through as an 'other' save; a rename writes nothing", async () => {
    reset();
    const { conchal } = await costaRica();
    await PATCH_DESTINATION(req({ placeName: "The Westin" }, "PATCH"), ctx(conchal.id));
    expect(await savesOf(DEV_OWNER)).toEqual([]);
    const res = await PATCH_DESTINATION(req({ rating: 5, again: true }, "PATCH"), ctx(conchal.id));
    expect(res.status).toBe(204);
    expect(await read.destination(conchal.id)).toMatchObject({ rating: 5, again: true });
    expect(await savesOf(DEV_OWNER)).toMatchObject([{ name: "The Westin", type: "other", status: "been" }]);
  });

  it("another owner's idea is a silent no-op: no field moves, no save is written", async () => {
    reset();
    const { snorkel } = await costaRica(OTHER_OWNER);
    const res = await PATCH_IDEA(req({ status: "done", rating: 5 }, "PATCH"), ctx(snorkel.id));
    expect(res.status).toBe(204);
    expect(await read.idea(snorkel.id)).toMatchObject({ status: "idea", rating: null });
    expect(await savesOf(DEV_OWNER)).toEqual([]);
    expect(await savesOf(OTHER_OWNER)).toEqual([]);
  });
});

describeDb("W3 · Did it — POST /api/ideas, born done, idempotent on clientId", () => {
  it("creates once (201), replays as 200 with the same row, and writes an AREA Been save", async () => {
    reset(GUANACASTE);
    const { trip, conchal } = await costaRica();
    const body = {
      clientId: "cap_didit_1",
      tripId: trip.id,
      destinationId: conchal.id,
      title: "Sunset at Playa Flamingo",
      status: "done",
      rating: 5,
      again: true,
      notes: null,
      place: { name: "Sunset at Playa Flamingo", lat: 10.4331, lng: -85.7836, googlePlaceId: null },
      areaLabel: "Playa Flamingo",
    };

    const first = await POST_IDEA(req(body));
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ status: "done", rating: 5, again: true, destinationId: conchal.id });

    const replay = await POST_IDEA(req(body));
    expect(replay.status).toBe(200);
    expect((await replay.json()).id).toBe(created.id);
    // The snorkel the fixture put there, plus ONE sunset — never two.
    expect(await read.countIdeas(conchal.id)).toBe(2);
    expect((await read.idea(created.id))!.clientId).toBe("cap_didit_1");

    const saves = await savesOf(DEV_OWNER);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ anchor: "area", areaLabel: "Playa Flamingo", status: "been", again: true });
  });

  it("a web idea (no clientId) is always a fresh 201", async () => {
    reset();
    const { trip } = await costaRica();
    const a = await POST_IDEA(req({ tripId: trip.id, title: "Tide pools" }));
    const b = await POST_IDEA(req({ tripId: trip.id, title: "Tide pools" }));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await read.countTripIdeas(trip.id)).toBe(3);
  });
});

describeDb("W3 · Last time here — and its saves left out of the nearby banner", () => {
  it("draws the Newport card on the phone's route and drops its saves from nearby-saves", async () => {
    reset();
    const { trip } = await fx.pacificNorthwestLoop();
    const coast = await fx.trip({
      title: "Oregon Coast Weekend",
      startDate: "2025-05-23",
      endDate: "2025-05-26",
      status: "complete",
      rating: 5,
      note: "South Beach yurts booked early next time.",
    });
    const dest = await fx.area({ googlePlaceId: "seed_loc_newport", name: "Newport, OR", lat: 44.6368, lng: -124.0535 });
    const southBeach = await fx.savedPlace({
      name: "South Beach State Park",
      lat: 44.6094,
      lng: -124.0631,
      status: "been",
      rating: 5,
      again: true,
      tripId: coast.id,
      areaId: dest.id,
    });

    const res = await GET_NEXT_TIME(req(undefined, "GET"), ctx(trip.id));
    expect(res.status).toBe(200);
    const nt = forNextTimeResponse.parse(await res.json());
    expect(nt.cards).toHaveLength(1);
    expect(nt.cards[0]).toMatchObject({
      area: { id: dest.id, name: "Newport, OR" },
      pastTrip: { id: coast.id, title: "Oregon Coast Weekend", rating: 5 },
      destination: { name: "Newport, OR", arriveDate: "2026-08-05", departDate: "2026-08-09" },
    });
    expect(nt.cards[0]!.again.map((r) => [r.name, r.again])).toEqual([["South Beach State Park", true]]);
    expect(nt.saveIds).toEqual([southBeach.id]);

    const nearby = nearbySavesResponse.parse(await (await GET_NEARBY(req(undefined, "GET"), ctx(trip.id))).json());
    expect(nearby.items.map((i) => i.saveId)).not.toContain(southBeach.id);
  });

  it("404s another owner's trip", async () => {
    const { trip } = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const res = await GET_NEXT_TIME(req(undefined, "GET"), ctx(trip.id));
    expect(res.status).toBe(404);
  });
});
