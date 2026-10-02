import { expect, it } from "vitest";
import { NO_ROUTING_HASH, drivePairs, routeCacheKey, type RouteResult } from "@rv-trip/core";
import { tripBundleSchema } from "@rv-trip/core/api-client";
import { db, putCachedRoutes } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST as POST_TRIP } from "@/app/api/trips/route";
import { GET as GET_TRIP, PATCH as PATCH_TRIP } from "@/app/api/trips/[id]/route";
import { POST as POST_RES } from "@/app/api/reservations/route";
import { DELETE as DELETE_RES, PATCH as PATCH_RES } from "@/app/api/reservations/[id]/route";
import { PATCH as PATCH_SEGMENT } from "@/app/api/segments/[id]/route";
import { POST as POST_ROUTES } from "@/app/api/routes/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * W2 (#112) through the REAL handlers: the setup's three defaults (#103), a
 * hop's flights in local time and its mode switch (#104), and a stay's kind
 * (#105).
 */

/** Costa Rica Fly & Stay, as the seed has it (core/seeds costaRicaTrip): one
 * destination, the hop out (optionally without its flights) and the timed redeye home. */
async function costaRica(owner = DEV_OWNER) {
  const trip = await fx.trip({
    owner,
    title: "Costa Rica Fly & Stay",
    homeBase: "Boise, ID",
    startDate: "2027-01-16",
    endDate: "2027-01-25",
    defaultMode: "fly",
    lodgingDefault: "hotel",
    rigOn: false,
  });
  const chapter = await fx.chapter({ tripId: trip.id, title: "Guanacaste" });
  const conchal = await fx.destination({
    chapterId: chapter.id,
    placeName: "Westin Reserva Conchal",
    lat: 10.4047,
    lng: -85.8127,
    arriveDate: "2027-01-16",
    departDate: "2027-01-24",
  });
  const westin = await fx.reservation({
    destinationId: conchal.id,
    type: "lodging",
    name: "Westin Reserva Conchal",
    checkIn: "2027-01-16",
    checkOut: "2027-01-24",
    confirmationNumber: null,
    cost: null,
  });
  const out = await fx.segment({
    tripId: trip.id,
    fromDestinationId: null,
    toDestinationId: conchal.id,
    mode: "fly",
    sortOrder: 0,
  });
  const home = await fx.segment({
    tripId: trip.id,
    fromDestinationId: conchal.id,
    toDestinationId: null,
    mode: "fly",
    departAt: "2027-01-25T01:30:00Z",
    departTz: "America/Costa_Rica",
    arriveAt: "2027-01-25T15:50:00Z",
    arriveTz: "America/Boise",
    sortOrder: 1,
  });
  return { trip, chapter, conchal, westin, out, home };
}

const flight = (segmentId: string, name: string, startsAt: string, startsTz: string, endsAt: string, endsTz: string) => ({
  segmentId,
  type: "transport",
  name,
  startsAt,
  startsTz,
  endsAt,
  endsTz,
});

/** LIR 19:30 → DFW 23:55 on Jan 23 — the redeye typed a day early. */
const redeye23 = (segmentId: string) =>
  flight(
    segmentId,
    "AA 1190 LIR→DFW",
    "2027-01-24T01:30:00.000Z",
    "America/Costa_Rica",
    "2027-01-24T05:55:00.000Z",
    "America/Chicago",
  );

const segmentRes = async (segmentId: string) =>
  db.query.reservations.findMany({ where: (r, { eq }) => eq(r.segmentId, segmentId) });

describeDb("#103 · the trip's three defaults round-trip", () => {
  it("POST /api/trips writes defaultMode, lodgingDefault and rigOn (vet HIGH: createTrip's values)", async () => {
    const res = await POST_TRIP(
      req({
        title: "Costa Rica Fly & Stay",
        startDate: "2027-01-16",
        endDate: "2027-01-25",
        homeBase: null,
        defaultMode: "fly",
        lodgingDefault: "hotel",
        rigOn: false,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; defaultMode: string; lodgingDefault: string; rigOn: boolean };
    expect(body).toMatchObject({ defaultMode: "fly", lodgingDefault: "hotel", rigOn: false });
    expect(await read.trip(body.id)).toMatchObject({ defaultMode: "fly", lodgingDefault: "hotel", rigOn: false });
  });

  it("PATCH /api/trips/:id writes them, and GET reads them back", async () => {
    const trip = await fx.trip();
    const res = await PATCH_TRIP(
      req({ defaultMode: "fly", lodgingDefault: "friends", rigOn: false }, "PATCH"),
      ctx(trip.id),
    );
    expect(res.status).toBe(204);
    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip).toMatchObject({ defaultMode: "fly", lodgingDefault: "friends", rigOn: false });
  });
});

describeDb("#104 · a flight on a hop", () => {
  it("inserts the row and re-times the segment to min(startsAt) / max(endsAt)", async () => {
    const { out } = await costaRica();

    const a = await POST_RES(
      req(flight(out.id, "AA 2208 LAX→LIR", "2027-01-16T17:40:00.000Z", "America/Los_Angeles", "2027-01-16T23:45:00.000Z", "America/Costa_Rica")),
    );
    expect(a.status).toBe(201);
    const b = await POST_RES(
      req(flight(out.id, "AA 2451 BOI→LAX", "2027-01-16T13:05:00.000Z", "America/Boise", "2027-01-16T15:10:00.000Z", "America/Los_Angeles")),
    );
    expect(b.status).toBe(201);
    expect(await b.json()).toMatchObject({ segmentId: out.id, destinationId: null, startsTz: "America/Boise" });

    const [seg] = (await read.segments(out.tripId)).filter((s) => s.id === out.id);
    expect(seg!.departAt?.toISOString()).toBe("2027-01-16T13:05:00.000Z");
    expect(seg!.departTz).toBe("America/Boise");
    expect(seg!.arriveAt?.toISOString()).toBe("2027-01-16T23:45:00.000Z");
    expect(seg!.arriveTz).toBe("America/Costa_Rica");
    expect(await segmentRes(out.id)).toHaveLength(2);
  });

  it("a LIR flight on Jan 23 is 409 segment_date_mismatch and writes NOTHING", async () => {
    const { home, conchal } = await costaRica();

    const res = await POST_RES(req(redeye23(home.id)));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "segment_date_mismatch",
      segmentId: home.id,
      expected: "2027-01-24",
      actual: "2027-01-23",
    });
    expect(await segmentRes(home.id)).toHaveLength(0);
    const [seg] = (await read.segments(home.tripId)).filter((s) => s.id === home.id);
    expect(seg!.departAt?.toISOString()).toBe("2027-01-25T01:30:00.000Z");
    expect((await read.destination(conchal.id))!.departDate).toBe("2027-01-24");
  });

  it("the same body with moveDestination: true is 201 — the destination and its own stay move to Jan 23", async () => {
    const { home, conchal, westin } = await costaRica();

    const res = await POST_RES(req({ ...redeye23(home.id), moveDestination: true }));

    expect(res.status).toBe(201);
    expect((await read.destination(conchal.id))!.departDate).toBe("2027-01-23");
    expect((await read.reservation(westin.id))!.checkOut).toBe("2027-01-23");
    const [seg] = (await read.segments(home.tripId)).filter((s) => s.id === home.id);
    expect(seg!.departAt?.toISOString()).toBe("2027-01-24T01:30:00.000Z");
    expect(await segmentRes(home.id)).toHaveLength(1);
  });

  it("400s a body naming both parents, or neither", async () => {
    const { home, conchal } = await costaRica();
    expect((await POST_RES(req({ ...redeye23(home.id), destinationId: conchal.id }))).status).toBe(400);
    // JSON drops an undefined key: this body names no parent at all.
    expect((await POST_RES(req({ ...redeye23(home.id), segmentId: undefined }))).status).toBe(400);
  });

  it("404s another owner's hop and attaches nothing to it", async () => {
    const { home } = await costaRica(OTHER_OWNER);
    const res = await POST_RES(req(redeye23(home.id)));
    expect(res.status).toBe(404);
    expect(await segmentRes(home.id)).toHaveLength(0);
  });

  it("a flight can be edited and removed — its hop is owner-scoped too (vet MED)", async () => {
    const { out } = await costaRica();
    const created = (await (
      await POST_RES(
        req(flight(out.id, "AA 2451 BOI→LAX", "2027-01-16T13:05:00.000Z", "America/Boise", "2027-01-16T23:45:00.000Z", "America/Costa_Rica")),
      )
    ).json()) as { id: string };

    expect((await PATCH_RES(req({ name: "AA 2451 BOI→LIR" }, "PATCH"), ctx(created.id))).status).toBe(204);
    expect((await read.reservation(created.id))!.name).toBe("AA 2451 BOI→LIR");
    expect((await DELETE_RES(req(undefined, "DELETE"), ctx(created.id))).status).toBe(204);
    expect(await read.reservation(created.id)).toBeNull();
  });
});

describeDb("#104 · PATCH /api/segments/:id — the mode switch", () => {
  it("changes the mode, and drivePairs then excludes the pair", async () => {
    const { trip, astoria, newport } = await fx.pacificNorthwestLoop();
    const hop = await fx.segment({ tripId: trip.id, fromDestinationId: astoria.id, toDestinationId: newport.id, sortOrder: 1 });

    const res = await PATCH_SEGMENT(req({ mode: "fly" }, "PATCH"), ctx(hop.id));

    expect(res.status).toBe(204);
    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip.segments.find((s) => s.id === hop.id)?.mode).toBe("fly");
    expect(drivePairs(bundle.trip).some((p) => p.fromDestinationId === astoria.id)).toBe(false);
  });

  it("#129 · Drive with flights on the hop is no longer refused — no choice reads as keep; and 404s another owner's hop", async () => {
    const { out } = await costaRica();
    await POST_RES(
      req(flight(out.id, "AA 2451 BOI→LAX", "2027-01-16T13:05:00.000Z", "America/Boise", "2027-01-16T23:45:00.000Z", "America/Costa_Rica")),
    );
    const kept = await PATCH_SEGMENT(req({ mode: "drive" }, "PATCH"), ctx(out.id));
    expect(kept.status).toBe(204);
    expect((await read.segments(out.tripId)).find((s) => s.id === out.id)?.mode).toBe("drive");
    expect(await segmentRes(out.id)).toHaveLength(1);

    const theirs = await costaRica(OTHER_OWNER);
    expect((await PATCH_SEGMENT(req({ mode: "ferry" }, "PATCH"), ctx(theirs.home.id))).status).toBe(404);
    expect((await read.segments(theirs.trip.id)).find((s) => s.id === theirs.home.id)?.mode).toBe("fly");
  });

  it("an untouched hop switched back to Drive drops its clock", async () => {
    const { home } = await costaRica();
    expect((await PATCH_SEGMENT(req({ mode: "drive" }, "PATCH"), ctx(home.id))).status).toBe(204);
    const [seg] = (await read.segments(home.tripId)).filter((s) => s.id === home.id);
    expect(seg).toMatchObject({ mode: "drive", departAt: null, arriveAt: null });
  });
});

describeDb("#105 · a stay by kind", () => {
  it("a Friends stay with no cost round-trips through POST and GET", async () => {
    const { trip, bend } = await fx.pacificNorthwestLoop();
    const res = await POST_RES(
      req({
        destinationId: bend.id,
        type: "lodging",
        lodgingKind: "friends",
        name: "Jane & Rick",
        checkIn: "2026-08-12",
        checkOut: "2026-08-16",
        confirmationNumber: null,
        cost: null,
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };

    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    const stay = bundle.trip.chapters
      .flatMap((l) => l.destinations)
      .find((s) => s.id === bend.id)!
      .reservations.find((r) => r.id === created.id);
    expect(stay).toMatchObject({ lodgingKind: "friends", cost: null, type: "lodging", name: "Jane & Rick" });
  });

  it("the kind switch on edit is written (vet HIGH: PATCH carried no lodgingKind)", async () => {
    const { reservation } = await fx.pacificNorthwestLoop();
    expect((await PATCH_RES(req({ lodgingKind: "airbnb", type: "lodging" }, "PATCH"), ctx(reservation.id))).status).toBe(204);
    expect(await read.reservation(reservation.id)).toMatchObject({ lodgingKind: "airbnb", type: "lodging" });
  });
});

describeDb("#103 · rigOn gates the rig on every routing path (vet HIGH)", () => {
  const routed: RouteResult = {
    durationSeconds: 3600,
    distanceMeters: 100_000,
    polyline: null,
    primaryRoad: "US-101",
    source: "here",
    notices: [],
  };

  it("a trip that leaves the rig home keys on the no-rig hash — bundle AND post-reorder upgrade", async () => {
    await fx.rig();
    const { trip } = await costaRica();
    const bundle = tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.rigHash).toBe(NO_ROUTING_HASH);
    expect(bundle.hasRig).toBe(true);

    const from = { lat: 10.4047, lng: -85.8127 };
    const to = { lat: 10.6346, lng: -85.4407 };
    await putCachedRoutes([{ key: routeCacheKey(from, to, NO_ROUTING_HASH), result: routed }]);
    const res = await POST_ROUTES(req({ pairs: [{ from, to }], tripId: trip.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { routingHash: string; routes: Record<string, RouteResult> };
    expect(body.routingHash).toBe(NO_ROUTING_HASH);
    expect(body.routes[routeCacheKey(from, to, NO_ROUTING_HASH)]).toMatchObject({ primaryRoad: "US-101" });
  });

  it("404s a trip that is not the caller's", async () => {
    const { trip } = await costaRica(OTHER_OWNER);
    const res = await POST_ROUTES(
      req({ pairs: [{ from: { lat: 1, lng: 1 }, to: { lat: 2, lng: 2 } }], tripId: trip.id }),
    );
    expect(res.status).toBe(404);
  });
});
