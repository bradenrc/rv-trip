import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/ideas/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: `createIdea` proves the parent and throws.
 *
 * #80 moved that parent to the TRIP — an idea is owner-scoped through
 * `trip_id` whether or not it has a stop — so the foreign body now names the
 * foreign trip too, and the refusal names which of the two was not found. */
describeDb("POST /api/ideas", () => {
  it("404s on another owner's stop and attaches no idea to it", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(req({ tripId: trip.id, stopId: astoria.id, title: "Hijacked idea" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.countIdeas(astoria.id)).toBe(1); // the fixture's own
  });
});

/**
 * #80 — the SHELF create. An idea belongs to the trip; the stop is optional.
 *
 * The two arms that matter are here because they are the ones a wrong
 * ownership path would get silently wrong: a create with no stop at all must
 * still be proved against a trip, and a foreign trip must be a 404 rather than
 * a row planted on someone else's trip.
 */
describeDb("POST /api/ideas — the shelf (#80)", () => {
  it("creates an unattached idea from a trip and a category", async () => {
    const { trip } = await fx.pacificNorthwestLoop();

    const res = await POST(
      req({
        tripId: trip.id,
        stopId: null,
        category: "stay",
        title: "Coachland RV Park",
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      tripId: trip.id,
      stopId: null,
      category: "stay",
      title: "Coachland RV Park",
      status: "idea",
    });
    const row = (await read.idea(body.id))!;
    expect(row.stopId).toBeNull();
    expect(row.tripId).toBe(trip.id);
  });

  it("defaults the category to 'do' — every idea shipped before this was one", async () => {
    const { trip } = await fx.pacificNorthwestLoop();

    const res = await POST(req({ tripId: trip.id, title: "Rim Drive loop" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ category: "do", stopId: null });
  });

  it("404s on another owner's trip and plants nothing on it", async () => {
    const { trip } = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const before = await read.countTripIdeas(trip.id);

    const res = await POST(req({ tripId: trip.id, stopId: null, title: "Hijacked" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.countTripIdeas(trip.id)).toBe(before);
  });

  it("400s a create with no trip — there is no other ownership path", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();

    const res = await POST(req({ stopId: astoria.id, title: "Orphan" }));

    expect(res.status).toBe(400);
  });

  it("refuses a stop that is not on the trip the body claims", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    // A second trip of the SAME owner: ownership is not the question here, the
    // pair is — a stop's leg must belong to the idea's trip.
    const other = await fx.trip({ title: "Desert Southwest" });
    const otherLeg = await fx.leg({ tripId: other.id });
    const otherStop = await fx.stop({ legId: otherLeg.id });

    const res = await POST(req({ tripId: trip.id, stopId: otherStop.id, title: "Mismatched" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "stop not found" });
  });

  it("appends within the shelf's own list, not the stop's", async () => {
    const { trip } = await fx.pacificNorthwestLoop();

    const first = await (await POST(req({ tripId: trip.id, title: "First" }))).json();
    const second = await (await POST(req({ tripId: trip.id, title: "Second" }))).json();

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
  });
});
