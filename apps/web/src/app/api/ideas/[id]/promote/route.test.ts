import { expect, it } from "vitest";
import { promoteIdeaToReservation } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/ideas/[id]/promote/route";
import { PATCH } from "@/app/api/ideas/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §6.3 promote — the idea becomes a reservation, in one transaction, exactly once. */
describeDb("POST /api/ideas/[id]/promote", () => {
  it("promotes once and rolls the replay back whole", async () => {
    const trip = await fx.trip();
    const leg = await fx.leg({ tripId: trip.id });
    const astoria = await fx.stop({ legId: leg.id });
    const idea = await fx.idea({ tripId: trip.id, stopId: astoria.id, title: "Fort Stevens bike loop" });

    // body-less POST — exercises the handler's `.catch(() => ({}))` and
    // ideaPromoteInput's `.default("activity")` (types.ts:268) together
    const res = await POST(req(undefined), ctx(idea.id));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      stopId: astoria.id,
      type: "activity", // the schema default
      name: "Fort Stevens bike loop", // idea.title carries over
      notes: "Promoted from idea",
    });
    expect(await read.idea(idea.id)).toBe(null); // same txn

    // replay → 404, and NO orphan reservation from the rolled-back half
    expect((await POST(req(undefined), ctx(idea.id))).status).toBe(404);
    expect(await read.countReservations(astoria.id)).toBe(1);
  });

  it("404s on another owner's idea and promotes nothing", async () => {
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(req(undefined), ctx(theirs.idea.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "idea not found" });
    expect(await read.idea(theirs.idea.id)).not.toBeNull();
    // the fixture's own reservation, and no second one
    expect(await read.countReservations(theirs.astoria.id)).toBe(1);
  });
});

/**
 * #80 · a SHELF idea is not bookable.
 *
 * `reservations.stop_id` is NOT NULL, so an unattached idea has nothing to
 * become a reservation ON. The shelf card renders no Book action at all; this
 * is the server half of the same rule, so a hand-rolled POST answers the same
 * 404 every other missing idea gets rather than a constraint error — and, the
 * part that matters, the idea SURVIVES (promote deletes the row it promotes).
 */
describeDb("POST /api/ideas/[id]/promote — a shelf idea (#80)", () => {
  it("404s an idea with no stop, and does not consume it", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, title: "Coachland RV Park" });

    const res = await POST(req(undefined), ctx(idea.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "idea not found" });
    // The whole transaction rolled back: the idea is still on the shelf.
    const row = (await read.idea(idea.id))!;
    expect(row).not.toBeNull();
    expect(row.stopId).toBeNull();
  });

  /**
   * …and the guard itself, at the MUTATION, because the handler cannot see it.
   *
   * `reservations.stop_id` is NOT NULL, so removing the guard still answers 404
   * — the insert just fails on the constraint instead, and the handler's
   * blanket catch renders the same body. The only place the two differ is the
   * error the mutation throws, so that is what this asserts: delete the guard
   * and this REDs on a Postgres "null value in column" message. (The same
   * direct-import shape `places/locate/route.test.ts` already uses for a
   * packages/db assertion — packages/db has no `test` script of its own.)
   */
  it("throws the handler's OWN 'idea not found', not a constraint violation", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, title: "Coachland RV Park" });

    await expect(promoteIdeaToReservation(DEV_OWNER, idea.id)).rejects.toThrow(
      /^idea not found$/,
    );
  });

  it("books it once it HAS been dropped onto a stop", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, title: "Coachland RV Park" });
    await PATCH(req({ stopId: astoria.id }, "PATCH"), ctx(idea.id));

    const res = await POST(req(undefined), ctx(idea.id));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ stopId: astoria.id, name: "Coachland RV Park" });
  });
});
