import { expect, it } from "vitest";
import { tripBundleSchema } from "@rv-trip/core/api-client";
import { changeHistoryRow, savedPlace } from "@rv-trip/core";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx } from "@rv-trip/db/testing";
import { GET as GET_HISTORY } from "@/app/api/history/route";
import { GET as GET_PLACES } from "@/app/api/places/route";
import { GET as GET_TRIP } from "@/app/api/trips/[id]/route";
import { PATCH as PATCH_STOP } from "@/app/api/stops/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * The two reads of the change log (#78 · docs/design/81 §6, plan item i6):
 * the ONE joined row that rides along on a list read as `lastChange`, and the
 * five-row audit behind `GET /api/history`.
 *
 * Same shape as every other suite here: a real database migrated with the
 * shipped `packages/db/drizzle/` files, the real route handlers called
 * directly, and no mock anywhere (#30).
 *
 * The rows are planted with an explicit `at` wherever ORDER matters. `at`
 * defaults to the database's `now()` — the transaction clock — so two rows
 * written by two quick handler calls can tie, and an ordering test that relied
 * on them would be flaky by construction.
 */

type Entity = "stop" | "idea" | "reservation" | "save";

/** One planted change_log row. `at` is minutes into 2026-09-12, so "newest
 * first" is readable in the assertion rather than inferred from a clock. */
async function log(
  entity: Entity,
  entityId: string,
  p: {
    field?: "rating" | "notes" | "status";
    from?: string | null;
    to?: string | null;
    member?: string;
    household?: string;
    minute: number;
  },
) {
  await db.insert(schema.changeLog).values({
    householdId: p.household ?? DEV_OWNER,
    entity,
    entityId,
    field: p.field ?? "rating",
    from: p.from ?? null,
    to: p.to ?? null,
    memberId: p.member ?? "dev-user",
    at: new Date(Date.UTC(2026, 8, 12, 18, p.minute, 0)),
  });
}

const history = (entity: string, id: string) =>
  GET_HISTORY(new Request(`http://test.local/api/history?entity=${entity}&id=${id}`));

const bundle = async (tripId: string) =>
  tripBundleSchema.parse(await (await GET_TRIP(req(undefined, "GET"), ctx(tripId))).json());

const NO_SUCH_UUID = "8c2b2c1e-6a4e-4f0e-9a0b-6f2b1d0a7c31";

describeDb("GET /api/history", () => {
  it("returns at most five rows, newest first", async () => {
    const loop = await fx.pacificNorthwestLoop();
    for (const minute of [1, 2, 3, 4, 5, 6, 7]) {
      await log("stop", loop.astoria.id, { minute, to: String(minute) });
    }

    const res = await history("stop", loop.astoria.id);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(5);
    // 7 is the newest of the seven; 3, 2 and 1 fell off the end.
    expect(rows.map((r: { to: string }) => r.to)).toEqual(["7", "6", "5", "4", "3"]);
  });

  it("answers the wire shape the popover renders", async () => {
    const loop = await fx.pacificNorthwestLoop();
    await log("stop", loop.astoria.id, { field: "notes", from: null, to: "Nice riverwalk", minute: 4 });

    const [row] = await (await history("stop", loop.astoria.id)).json();

    expect(changeHistoryRow.parse(row)).toEqual({
      field: "notes",
      from: null,
      to: "Nice riverwalk",
      // Keyless, the person IS `dev-user` — `getActor()`, not `getOwner()`.
      memberName: "dev-user",
      at: "2026-09-12T18:04:00.000Z",
    });
  });

  it("answers an empty list for an owned entity nothing has ever changed", async () => {
    const loop = await fx.pacificNorthwestLoop();

    const res = await history("stop", loop.newport.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("404s a stop that belongs to another household", async () => {
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);
    await log("stop", theirs.astoria.id, { household: OTHER_OWNER, minute: 1 });

    const res = await history("stop", theirs.astoria.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("404s a well-formed id that is no entity at all", async () => {
    expect((await history("stop", NO_SUCH_UUID)).status).toBe(404);
  });

  it("refuses a malformed id and an unknown entity at the parse", async () => {
    const loop = await fx.pacificNorthwestLoop();
    // A non-uuid would reach a uuid column and 500 at the driver, so it is
    // turned away here — the shipped precedent is api/places/[id]'s `placeId`.
    expect((await history("stop", "not-a-uuid")).status).toBe(400);
    expect((await history("trip", loop.trip.id)).status).toBe(400);
    expect((await GET_HISTORY(new Request("http://test.local/api/history"))).status).toBe(400);
  });

  it("never serves another household's rows about MY stop", async () => {
    const loop = await fx.pacificNorthwestLoop();
    await log("stop", loop.astoria.id, { household: OTHER_OWNER, minute: 9, to: "5" });

    const res = await history("stop", loop.astoria.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("resolves all four entities — idea, reservation and saved place too", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const place = await fx.savedPlace({ owner: DEV_OWNER });
    await log("idea", loop.idea.id, { minute: 1, to: "4" });
    await log("reservation", loop.reservation.id, { minute: 2, to: "5" });
    await log("save", place.id, { minute: 3, to: "3" });

    expect(await (await history("idea", loop.idea.id)).json()).toMatchObject([{ to: "4" }]);
    expect(await (await history("reservation", loop.reservation.id)).json()).toMatchObject([
      { to: "5" },
    ]);
    expect(await (await history("save", place.id)).json()).toMatchObject([{ to: "3" }]);
  });

  it("404s each of the other three when they are not the household's", async () => {
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const theirPlace = await fx.savedPlace({ owner: OTHER_OWNER });

    expect((await history("idea", theirs.idea.id)).status).toBe(404);
    expect((await history("reservation", theirs.reservation.id)).status).toBe(404);
    expect((await history("save", theirPlace.id)).status).toBe(404);
  });

  it("scopes the household through getOwner(), never through the query", async () => {
    // There is no way to ASK for another household: the only two inputs are the
    // entity and its id, and a shelf idea of theirs is refused above. This pins
    // the absence — a `household` parameter must never start working.
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const res = await GET_HISTORY(
      new Request(
        `http://test.local/api/history?entity=stop&id=${theirs.astoria.id}&household=${OTHER_OWNER}`,
      ),
    );
    expect(res.status).toBe(404);
  });
});

describeDb("lastChange on the wire", () => {
  it("rides along on GET /api/trips/:id after a real PATCH", async () => {
    const loop = await fx.pacificNorthwestLoop();

    // Newport is seeded at 4 stars, so 4 again would be the no-op that writes
    // nothing (i5) — the byline only appears when a value actually moved.
    const patched = await PATCH_STOP(req({ rating: 2 }, "PATCH"), ctx(loop.newport.id));
    expect(patched.status).toBe(204);

    const stop = (await bundle(loop.trip.id)).trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === loop.newport.id)!;

    expect(stop.lastChange).toMatchObject({ field: "rating", memberName: "dev-user" });
    expect(Date.parse(stop.lastChange!.at)).not.toBeNaN();
  });

  it("is null on a stop nothing has ever changed", async () => {
    const loop = await fx.pacificNorthwestLoop();

    const stop = (await bundle(loop.trip.id)).trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === loop.bend.id)!;

    expect(stop.lastChange).toBeNull();
  });

  it("carries the NEWEST row, not the first one written", async () => {
    const loop = await fx.pacificNorthwestLoop();
    await log("stop", loop.astoria.id, { field: "rating", minute: 1, member: "braden" });
    await log("stop", loop.astoria.id, { field: "notes", minute: 40, member: "jess" });

    const stop = (await bundle(loop.trip.id)).trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === loop.astoria.id)!;

    expect(stop.lastChange).toEqual({
      field: "notes",
      memberName: "jess",
      at: "2026-09-12T18:40:00.000Z",
    });
  });

  it("rides on the reservation and the attached idea too", async () => {
    const loop = await fx.pacificNorthwestLoop();
    await log("reservation", loop.reservation.id, { field: "notes", minute: 5 });
    await log("idea", loop.idea.id, { field: "status", minute: 6 });

    const stop = (await bundle(loop.trip.id)).trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === loop.astoria.id)!;

    expect(stop.reservations[0]!.lastChange).toMatchObject({ field: "notes" });
    expect(stop.ideas[0]!.lastChange).toMatchObject({ field: "status" });
  });

  it("rides on a SHELF idea, which hangs off the trip and not a stop", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const shelf = await fx.idea({ tripId: loop.trip.id, stopId: null, title: "Blue Scorcher" });
    await log("idea", shelf.id, { field: "rating", minute: 7 });

    const trip = (await bundle(loop.trip.id)).trip;

    expect(trip.ideas.find((i) => i.id === shelf.id)!.lastChange).toMatchObject({
      field: "rating",
    });
  });

  it("rides on a saved place, on GET /api/places", async () => {
    const place = await fx.savedPlace({ owner: DEV_OWNER });
    await log("save", place.id, { field: "status", from: "want", to: "been", minute: 8 });

    const rows = savedPlace.array().parse(await (await GET_PLACES()).json());

    expect(rows.find((r) => r.id === place.id)!.lastChange).toEqual({
      field: "status",
      memberName: "dev-user",
      at: "2026-09-12T18:08:00.000Z",
    });
  });

  it("never joins another household's row onto my stop", async () => {
    const loop = await fx.pacificNorthwestLoop();
    await log("stop", loop.astoria.id, { household: OTHER_OWNER, minute: 50 });

    const stop = (await bundle(loop.trip.id)).trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === loop.astoria.id)!;

    expect(stop.lastChange).toBeNull();
  });
});
