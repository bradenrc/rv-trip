import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { PATCH as PATCH_IDEA } from "@/app/api/ideas/[id]/route";
import { PATCH as PATCH_PLACE } from "@/app/api/places/[id]/route";
import { PATCH as PATCH_RES } from "@/app/api/reservations/[id]/route";
import { PATCH as PATCH_STOP } from "@/app/api/stops/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * `change_log` and the four write sites (#78 · docs/design/81 §6, plan item i5).
 *
 * Lives in apps/web for the reason every other schema/handler test does:
 * `packages/db` has no `test` script and no runner, while this suite stands up
 * a database, runs the SHIPPED `packages/db/drizzle/` migrations against it and
 * calls the real route handlers — so the assertions exercise the whole path
 * body → zod → mutation → row, with no mock anywhere (#30).
 *
 * What it pins: exactly the acceptance of i5 — a row per CHANGED logged field,
 * nothing for a no-op save, nothing for a field outside the three, nothing for
 * a patch the owner scope refuses, and `change_log` written from ONE place in
 * mutations.ts.
 */

const DB_SRC = fileURLToPath(new URL("../../../../packages/db/src", import.meta.url));
const DRIZZLE_DIR = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));

/** The 0008 migration's text, found by prefix — drizzle names the suffix. */
function migration0008(): string {
  const file = readdirSync(DRIZZLE_DIR).find((f) => f.startsWith("0008_") && f.endsWith(".sql"));
  if (!file) throw new Error(`no 0008_*.sql in ${DRIZZLE_DIR}`);
  return readFileSync(`${DRIZZLE_DIR}/${file}`, "utf8");
}

/** Every logged row, newest last. `at` is the statement's `now()`, identical
 * for two rows written by one patch, so nothing here orders ON it. */
async function logged(entityId?: string) {
  const rows = await db.select().from(schema.changeLog);
  const mine = entityId === undefined ? rows : rows.filter((r) => r.entityId === entityId);
  return mine.sort((a, b) => a.field.localeCompare(b.field));
}

describe("migration 0008 (no database needed)", () => {
  it("creates change_log and nothing else", () => {
    const text = migration0008();

    expect(text).toMatch(/CREATE TABLE "change_log"/);
    // #78 rides #77's member id and adds ONE table. A migration that also
    // altered a shipped table would be a second, unreviewed change riding along.
    expect(text.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(text).not.toMatch(/ALTER TABLE/i);
  });
});

describe("mutations.ts writes the log from one place", () => {
  it("has exactly one insert into changeLog", () => {
    const text = readFileSync(`${DB_SRC}/mutations.ts`, "utf8");

    // i5's acceptance: "no other function in mutations.ts writes to
    // change_log". One shared helper is the only writer; the four functions
    // call it.
    expect(text.match(/\.insert\(changeLog\)/g)).toHaveLength(1);
  });
});

describeDb("change_log · stops", () => {
  it("logs a rating change with the old and the new value", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: loop.legCoast.id, rating: 3, sortOrder: 9 });

    const res = await PATCH_STOP(req({ rating: 5 }, "PATCH"), ctx(stop.id));

    expect(res.status).toBe(204);
    expect(await logged(stop.id)).toMatchObject([
      {
        householdId: DEV_OWNER,
        entity: "stop",
        entityId: stop.id,
        field: "rating",
        from: "3",
        to: "5",
        // getActor(), NOT getOwner() — the PERSON, which keyless is dev-user.
        memberId: "dev-user",
      },
    ]);
  });

  it("writes nothing for a no-op save", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: loop.legCoast.id, rating: 4, notes: "windy", sortOrder: 9 });

    const res = await PATCH_STOP(req({ rating: 4, notes: "windy" }, "PATCH"), ctx(stop.id));

    expect(res.status).toBe(204);
    expect(await logged()).toEqual([]);
  });

  it("writes nothing for a field outside the three", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: loop.legCoast.id, sortOrder: 9 });

    const res = await PATCH_STOP(req({ placeName: "Cannon Beach, OR" }, "PATCH"), ctx(stop.id));

    expect(res.status).toBe(204);
    expect((await read.stop(stop.id))!.placeName).toBe("Cannon Beach, OR");
    expect(await logged()).toEqual([]);
  });

  it("logs one row per changed field when a body carries two", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: loop.legCoast.id, rating: 3, notes: null, sortOrder: 9 });

    await PATCH_STOP(req({ rating: 4, notes: "Riverfront sites 41–48" }, "PATCH"), ctx(stop.id));

    expect(await logged(stop.id)).toMatchObject([
      { field: "notes", from: null, to: "Riverfront sites 41–48" },
      { field: "rating", from: "3", to: "4" },
    ]);
  });

  it("logs a cleared rating as a null `to`", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const stop = await fx.stop({ legId: loop.legCoast.id, rating: 5, sortOrder: 9 });

    await PATCH_STOP(req({ rating: null }, "PATCH"), ctx(stop.id));

    expect(await logged(stop.id)).toMatchObject([{ field: "rating", from: "5", to: null }]);
  });

  it("writes nothing when the owner scope refuses the patch", async () => {
    // The fixture rates Astoria 5, so 2 is a real move — a refusal, not a no-op.
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH_STOP(req({ rating: 2 }, "PATCH"), ctx(theirs.astoria.id));

    expect(res.status).toBe(404);
    expect((await read.stop(theirs.astoria.id))!.rating).toBe(5);
    expect(await logged()).toEqual([]);
  });
});

describeDb("change_log · reservations", () => {
  it("logs a note change", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const row = await fx.reservation({ stopId: loop.astoria.id, notes: null });

    const res = await PATCH_RES(req({ notes: "Ask for a pull-through" }, "PATCH"), ctx(row.id));

    expect(res.status).toBe(204);
    expect(await logged(row.id)).toMatchObject([
      { entity: "reservation", field: "notes", from: null, to: "Ask for a pull-through" },
    ]);
  });

  it("writes nothing when only the cost moves", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const row = await fx.reservation({ stopId: loop.astoria.id, cost: 204 });

    await PATCH_RES(req({ cost: 219.5 }, "PATCH"), ctx(row.id));

    expect((await read.reservation(row.id))!.cost).toBe("219.50");
    expect(await logged()).toEqual([]);
  });
});

describeDb("change_log · ideas", () => {
  it("logs the status cycle", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const row = await fx.idea({ tripId: loop.trip.id, stopId: null, status: "idea" });

    const res = await PATCH_IDEA(req({ status: "planned" }, "PATCH"), ctx(row.id));

    expect(res.status).toBe(204);
    expect(await logged(row.id)).toMatchObject([
      { entity: "idea", field: "status", from: "idea", to: "planned" },
    ]);
  });

  it("logs a rating alongside an attach", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const row = await fx.idea({ tripId: loop.trip.id, stopId: null, rating: null });

    await PATCH_IDEA(req({ rating: 5, stopId: loop.newport.id }, "PATCH"), ctx(row.id));

    expect((await read.idea(row.id))!.stopId).toBe(loop.newport.id);
    expect(await logged(row.id)).toMatchObject([{ field: "rating", from: null, to: "5" }]);
  });

  it("writes nothing when the attach is refused", async () => {
    const loop = await fx.pacificNorthwestLoop();
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const row = await fx.idea({ tripId: loop.trip.id, stopId: null, rating: null });

    const res = await PATCH_IDEA(req({ rating: 5, stopId: theirs.astoria.id }, "PATCH"), ctx(row.id));

    expect(res.status).toBe(404);
    expect((await read.idea(row.id))!.rating).toBe(null);
    expect(await logged()).toEqual([]);
  });
});

describeDb("change_log · saved places", () => {
  /**
   * The vet's two HIGHs against §6, both settled here:
   *  1. the column is `note`, SINGULAR — it is logged under the canonical
   *     `notes`, or the /places byline in §5 could never render;
   *  2. `saved_places` DOES carry `status` (schema.ts:203), so the want → been
   *     graduation is logged like any other shared-voice status change.
   */
  it("logs a note change under the canonical `notes` field", async () => {
    const place = await fx.savedPlace({ note: null });

    const res = await PATCH_PLACE(req({ note: "Riverfront sites 41–48" }, "PATCH"), ctx(place.id));

    expect(res.status).toBe(204);
    expect(await logged(place.id)).toMatchObject([
      { entity: "savedPlace", field: "notes", from: null, to: "Riverfront sites 41–48" },
    ]);
  });

  it("logs the want → been graduation", async () => {
    const trip = await fx.trip();
    const place = await fx.savedPlace({ status: "want", rating: null });

    await PATCH_PLACE(req({ status: "been", rating: 5, tripId: trip.id }, "PATCH"), ctx(place.id));

    expect(await logged(place.id)).toMatchObject([
      { field: "rating", from: null, to: "5" },
      { field: "status", from: "want", to: "been" },
    ]);
  });

  it("writes nothing when the patch only re-points the trip", async () => {
    const trip = await fx.trip();
    const place = await fx.savedPlace({ status: "been", rating: 4 });

    await PATCH_PLACE(req({ tripId: trip.id }, "PATCH"), ctx(place.id));

    expect((await read.savedPlace(place.id))!.tripId).toBe(trip.id);
    expect(await logged()).toEqual([]);
  });

  it("writes nothing when the owner scope refuses the patch", async () => {
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, note: null });

    const res = await PATCH_PLACE(req({ note: "hijacked" }, "PATCH"), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await logged()).toEqual([]);
  });
});
