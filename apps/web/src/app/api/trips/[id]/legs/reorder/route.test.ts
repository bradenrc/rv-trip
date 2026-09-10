import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/trips/[id]/legs/reorder/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * §6.2 the leg-reorder transaction.
 *
 * NOTE the path: `reorderTripLegs` is mounted at
 *   /api/trips/[id]/legs/reorder      <- legs of a trip  (this test)
 *   /api/legs/[id]/reorder            <- stops of a leg  (reorderLegStops)
 * Importing the wrong one would test the wrong contract and still go green.
 */
describeDb("POST /api/trips/[id]/legs/reorder", () => {
  it("renumbers this trip's legs and nothing else", async () => {
    const trip = await fx.trip();
    const a = await fx.leg({ tripId: trip.id, title: "Oregon Coast", sortOrder: 0 });
    const b = await fx.leg({ tripId: trip.id, title: "Cascades & Home", sortOrder: 1 });
    const otherTrip = await fx.trip({ title: "Utah Parks" });
    const c = await fx.leg({ tripId: otherTrip.id, title: "Zion", sortOrder: 0 });

    const res = await POST(req({ order: [b.id, a.id, c.id] }), ctx(trip.id));

    expect(res.status).toBe(204);
    expect(await read.legOrder(trip.id)).toEqual([b.id, a.id]);
    // untouched — each UPDATE carries eq(legs.tripId, tripId) as well as the id
    expect((await read.leg(c.id))!.sortOrder).toBe(0);

    // the invariant the transaction actually buys:
    const sorts = (await read.legRows(trip.id)).map((l) => l.sortOrder);
    expect(new Set(sorts).size).toBe(sorts.length);
  });

  it("404s on another owner's trip and renumbers nothing", async () => {
    const theirs = await fx.trip({ owner: OTHER_OWNER });
    const x = await fx.leg({ tripId: theirs.id, title: "Their leg", sortOrder: 0 });
    const y = await fx.leg({ tripId: theirs.id, title: "Their other leg", sortOrder: 1 });

    // the ownership root: assertOwnedTrip throws -> caught -> 404
    const res = await POST(req({ order: [y.id, x.id] }), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.legOrder(theirs.id)).toEqual([x.id, y.id]);
  });
});
