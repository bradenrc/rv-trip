import { expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { fx, read } from "@rv-trip/db/testing";
import { POST as POST_STOP } from "@/app/api/stops/route";
import { DELETE as DELETE_STOP, PATCH as PATCH_STOP } from "@/app/api/stops/[id]/route";
import { DELETE as DELETE_LEG } from "@/app/api/legs/[id]/route";
import { POST as REORDER_LEGS } from "@/app/api/trips/[id]/legs/reorder/route";
import { GET as GET_TRIP, PATCH as PATCH_TRIP } from "@/app/api/trips/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * The journey's hops, through the REAL handlers (#110 · docs/design/110 §6).
 *
 * Every write that moves the route sequence persists `reconcileSegments` in
 * the same transaction — the five the design named (stop create/delete, leg
 * reorder/delete, stop reorder) AND the two the vet added: `updateStopFields`
 * (re-date, Unschedule, "Move to leg") and `updateTripFields` (home base).
 * `PATCH /api/stops/:id` refuses a date that would put a timed segment out of
 * step with its stop (Q3 A) with 409 `segment_date_mismatch`, writing nothing.
 */

type Hop = [string | null, string | null];
const hops = async (tripId: string): Promise<Hop[]> =>
  (await read.segments(tripId)).map((s) => [s.fromStopId, s.toStopId]);

/** A timed flight INTO Astoria landing on its arriveDate (Aug 2, local). */
async function flightIntoAstoria(tripId: string, astoriaId: string) {
  return fx.segment({
    tripId,
    fromStopId: null,
    toStopId: astoriaId,
    mode: "fly",
    departAt: "2026-08-02T14:00:00Z", // 08:00 in Boise
    departTz: "America/Boise",
    arriveAt: "2026-08-02T19:00:00Z", // 12:00 in Astoria
    arriveTz: "America/Los_Angeles",
  });
}

describeDb("travel segments · the writers keep them dense", () => {
  it("a created stop reconciles the whole trip: one hop per pair + home → first, in the default mode", async () => {
    const { trip, legMountains, astoria, newport, bend } = await fx.pacificNorthwestLoop();

    const res = await POST_STOP(
      req({
        legId: legMountains.id,
        place: { name: "Crater Lake NP", lat: 42.9446, lng: -122.109 },
        arriveDate: null,
        departDate: null,
      }),
    );

    expect(res.status).toBe(201);
    const crater = (await res.json()) as { id: string };
    expect(await hops(trip.id)).toEqual([
      [null, astoria.id],
      [astoria.id, newport.id],
      [newport.id, bend.id],
      [bend.id, crater.id],
    ]);
    const rows = await read.segments(trip.id);
    expect(rows.every((s) => s.mode === "drive" && s.departAt === null)).toBe(true);
    expect(rows.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("a kept hop keeps its row — id, mode and times survive an unrelated write", async () => {
    const { trip, legMountains, astoria } = await fx.pacificNorthwestLoop();
    const flight = await flightIntoAstoria(trip.id, astoria.id);

    await POST_STOP(
      req({ legId: legMountains.id, place: { name: "Sisters, OR" }, arriveDate: null, departDate: null }),
    );

    const first = (await read.segments(trip.id))[0]!;
    expect(first.id).toBe(flight.id);
    expect(first.mode).toBe("fly");
    expect(first.arriveAt?.toISOString()).toBe("2026-08-02T19:00:00.000Z");
  });

  it("a deleted stop joins its neighbours and re-points the → home row instead of cascading it", async () => {
    const { trip, astoria, newport, bend } = await fx.pacificNorthwestLoop();
    await fx.segment({ tripId: trip.id, fromStopId: null, toStopId: astoria.id, sortOrder: 0 });
    await fx.segment({ tripId: trip.id, fromStopId: astoria.id, toStopId: newport.id, sortOrder: 1 });
    await fx.segment({ tripId: trip.id, fromStopId: newport.id, toStopId: bend.id, sortOrder: 2 });
    const home = await fx.segment({
      tripId: trip.id,
      fromStopId: bend.id,
      toStopId: null,
      mode: "fly",
      sortOrder: 3,
    });

    expect((await DELETE_STOP(req(undefined, "DELETE"), ctx(bend.id))).status).toBe(204);

    const rows = await read.segments(trip.id);
    expect(rows.map((s) => [s.fromStopId, s.toStopId])).toEqual([
      [null, astoria.id],
      [astoria.id, newport.id],
      [newport.id, null],
    ]);
    expect(rows[2]).toMatchObject({ id: home.id, mode: "fly", sortOrder: 2 });
  });

  it("a leg reorder and a leg delete both reconcile", async () => {
    const { trip, legCoast, legMountains, astoria, newport, bend } = await fx.pacificNorthwestLoop();

    const reordered = await REORDER_LEGS(req({ order: [legMountains.id, legCoast.id] }), ctx(trip.id));
    expect(reordered.status).toBe(204);
    expect(await hops(trip.id)).toEqual([
      [null, bend.id],
      [bend.id, astoria.id],
      [astoria.id, newport.id],
    ]);

    expect((await DELETE_LEG(req(undefined, "DELETE"), ctx(legCoast.id))).status).toBe(204);
    expect(await hops(trip.id)).toEqual([[null, bend.id]]);
  });

  it("re-dating a stop reorders the sequence and reconciles (vet HIGH: updateStopFields)", async () => {
    const { trip, astoria, newport, bend } = await fx.pacificNorthwestLoop();

    // Newport moves before Astoria: the leg sorts scheduled stops by arriveDate.
    const res = await PATCH_STOP(
      req({ arriveDate: "2026-08-01", departDate: "2026-08-02" }, "PATCH"),
      ctx(newport.id),
    );

    expect(res.status).toBe(204);
    expect(await hops(trip.id)).toEqual([
      [null, newport.id],
      [newport.id, astoria.id],
      [astoria.id, bend.id],
    ]);
  });

  it("\"Move to leg\" reconciles too", async () => {
    const { trip, legMountains, astoria, newport, bend } = await fx.pacificNorthwestLoop();

    const res = await PATCH_STOP(req({ legId: legMountains.id, sortOrder: 9 }, "PATCH"), ctx(astoria.id));

    expect(res.status).toBe(204);
    // Astoria is still scheduled (Aug 2), so it sorts first in its new leg.
    expect(await hops(trip.id)).toEqual([
      [null, newport.id],
      [newport.id, astoria.id],
      [astoria.id, bend.id],
    ]);
  });

  it("clearing the home base drops the home → first hop (vet HIGH: updateTripFields)", async () => {
    const { trip, astoria, newport, bend } = await fx.pacificNorthwestLoop();
    await POST_STOP(req({ legId: (await read.legOrder(trip.id))[1]!, place: { name: "Sisters" } }));
    expect((await hops(trip.id))[0]).toEqual([null, astoria.id]);

    const res = await PATCH_TRIP(req({ homeBase: null }, "PATCH"), ctx(trip.id));

    expect(res.status).toBe(204);
    const now = await hops(trip.id);
    expect(now.slice(0, 2)).toEqual([
      [astoria.id, newport.id],
      [newport.id, bend.id],
    ]);
    expect(now.some(([from]) => from === null)).toBe(false);
  });
});

describeDb("PATCH /api/stops/[id] · segment_date_mismatch (Q3 A — stop dates win)", () => {
  it("409s a re-date that would put a timed flight out of step, and writes nothing", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const flight = await flightIntoAstoria(trip.id, astoria.id);

    const res = await PATCH_STOP(req({ arriveDate: "2026-08-03" }, "PATCH"), ctx(astoria.id));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "segment_date_mismatch",
      segmentId: flight.id,
      expected: "2026-08-03",
      actual: "2026-08-02",
    });
    expect((await read.stop(astoria.id))!.arriveDate).toBe("2026-08-02");
    // Nothing was reconciled either: the flight is still the only hop.
    expect(await hops(trip.id)).toEqual([[null, astoria.id]]);
  });

  it("lets a date through that keeps the flight in step", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    await flightIntoAstoria(trip.id, astoria.id);

    const res = await PATCH_STOP(req({ departDate: "2026-08-04" }, "PATCH"), ctx(astoria.id));

    expect(res.status).toBe(204);
    expect((await read.stop(astoria.id))!.departDate).toBe("2026-08-04");
  });

  it("exempts a floating endpoint: Unschedule next to a flight is allowed", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    await flightIntoAstoria(trip.id, astoria.id);

    const res = await PATCH_STOP(req({ arriveDate: null, departDate: null }, "PATCH"), ctx(astoria.id));

    expect(res.status).toBe(204);
    expect((await read.stop(astoria.id))!.arriveDate).toBeNull();
  });
});

describeDb("GET /api/trips/[id] · the segments on the wire", () => {
  it("carries segments with their own reservations; a stop keeps only its own", async () => {
    const { trip, astoria, reservation } = await fx.pacificNorthwestLoop();
    const flight = await flightIntoAstoria(trip.id, astoria.id);
    await db.insert(schema.reservations).values({
      segmentId: flight.id,
      type: "transport",
      name: "AA 2451 BOI→PDX",
      startsAt: new Date("2026-08-02T14:00:00Z"),
      startsTz: "America/Boise",
    });

    const res = await GET_TRIP(req(undefined, "GET"), ctx(trip.id));
    const { trip: body } = (await res.json()) as {
      trip: {
        defaultMode: string;
        rigOn: boolean;
        lodgingDefault: string | null;
        segments: { id: string; mode: string; departAt: string; reservations: { name: string; stopId: string | null; startsAt: string }[] }[];
        legs: { stops: { id: string; reservations: { id: string }[] }[] }[];
      };
    };

    expect(body).toMatchObject({ defaultMode: "drive", rigOn: true, lodgingDefault: null });
    expect(body.segments).toHaveLength(1);
    expect(body.segments[0]).toMatchObject({
      id: flight.id,
      mode: "fly",
      departAt: "2026-08-02T14:00:00.000Z",
      reservations: [{ name: "AA 2451 BOI→PDX", stopId: null, startsAt: "2026-08-02T14:00:00.000Z" }],
    });
    const astoriaOut = body.legs[0]!.stops.find((s) => s.id === astoria.id)!;
    expect(astoriaOut.reservations.map((r) => r.id)).toEqual([reservation.id]);
  });

  it("refuses a reservation with no parent, or two (CHECK num_nonnulls = 1)", async () => {
    const { astoria, trip } = await fx.pacificNorthwestLoop();
    const flight = await flightIntoAstoria(trip.id, astoria.id);
    await expect(db.insert(schema.reservations).values({ type: "other", name: "orphan" })).rejects.toThrow();
    await expect(
      db
        .insert(schema.reservations)
        .values({ stopId: astoria.id, segmentId: flight.id, type: "other", name: "both" }),
    ).rejects.toThrow();
  });
});
