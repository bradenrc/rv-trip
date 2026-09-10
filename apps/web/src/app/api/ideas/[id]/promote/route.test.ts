import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/ideas/[id]/promote/route";
import { ctx, describeDb, req } from "@/test/db";

/** §6.3 promote — the idea becomes a reservation, in one transaction, exactly once. */
describeDb("POST /api/ideas/[id]/promote", () => {
  it("promotes once and rolls the replay back whole", async () => {
    const trip = await fx.trip();
    const leg = await fx.leg({ tripId: trip.id });
    const astoria = await fx.stop({ legId: leg.id });
    const idea = await fx.idea({ stopId: astoria.id, title: "Fort Stevens bike loop" });

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
