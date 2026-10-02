import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/ideas/[id]/route";
import { DELETE as DELETE_DESTINATION } from "@/app/api/destinations/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth, and the one asymmetry in the matrix — both in one file. */
describeDb("PATCH/DELETE /api/ideas/[id]", () => {
  it("answers 204 for another owner's idea, and changes nothing", async () => {
    // ⚠ SHIPPED INCONSISTENCY, asserted as it is rather than fixed (gap 2).
    // `updateIdeaFields` returns void (mutations.ts:455-464) and the handler
    // never checks a match (ideas/[id]/route.ts:18-19), so a foreign idea
    // answers 204 where every sibling leaf answers 404. The WRITE itself is
    // correctly scoped, so the invariant §7 asks for — a foreign id changes
    // nothing — still holds. Making this a 404 is a production change and a
    // client-visible contract change; it belongs to its own issue. This test
    // pins the current behaviour so the follow-up changes a test on purpose
    // instead of discovering one.
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(
      req({ status: "done", rating: 1, notes: "hijacked" }, "PATCH"),
      ctx(idea.id),
    );

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("idea");
    expect(row.rating).toBe(null);
    expect(row.notes).toBe(null);
  });

  it("404s a DELETE on another owner's idea — the asymmetry with the PATCH above", async () => {
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "idea not found" });
    expect(await read.idea(idea.id)).not.toBeNull();
  });
});

/**
 * #69 — the idea PATCH can carry a PLACE, and a patch that does not carry one
 * must leave the four place columns exactly where they are.
 *
 * That is the whole risk of widening this body: `updateIdeaFields` spreads its
 * patch into `.set()`, and every shipped idea write is a single field — the
 * status pill, the stars, the note. Mapping the place unconditionally would
 * erase a located idea on each of them.
 */
describeDb("PATCH /api/ideas/[id] — the place (#69)", () => {
  const TUMALO = {
    name: "Tumalo Falls Trailhead",
    lat: 44.0317,
    lng: -121.5678,
    googlePlaceId: "ChIJtumalo",
  };

  /** The same place, as the four COLUMNS a seeded row carries. */
  const locatedColumns = () => ({
    placeName: TUMALO.name,
    lat: TUMALO.lat,
    lng: TUMALO.lng,
    googlePlaceId: TUMALO.googlePlaceId,
  });

  it("writes the picked place onto the four columns", async () => {
    const { idea } = await fx.pacificNorthwestLoop();

    const res = await PATCH(req({ place: TUMALO }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBe("Tumalo Falls Trailhead");
    expect(row.lat).toBe(44.0317);
    expect(row.lng).toBe(-121.5678);
    expect(row.googlePlaceId).toBe("ChIJtumalo");
    // …and nothing else on the row moved.
    expect(row.title).toBe(idea.title);
    expect(row.status).toBe(idea.status);
  });

  it("takes the picker's free-text escape — a name with no coordinates", async () => {
    const { idea } = await fx.pacificNorthwestLoop();

    const res = await PATCH(
      req({ place: { name: "Deschutes River float" } }, "PATCH"),
      ctx(idea.id),
    );

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBe("Deschutes River float");
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
  });

  it("does NOT touch the place when the patch is a status cycle", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: astoria.id, ...locatedColumns() });

    await PATCH(req({ status: "planned" }, "PATCH"), ctx(idea.id));
    await PATCH(req({ rating: 4 }, "PATCH"), ctx(idea.id));
    await PATCH(req({ notes: "Go early." }, "PATCH"), ctx(idea.id));

    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("planned");
    expect(row.rating).toBe(4);
    expect(row.notes).toBe("Go early.");
    // The four columns the three patches never named.
    expect(row.placeName).toBe("Tumalo Falls Trailhead");
    expect(row.lat).toBe(44.0317);
    expect(row.lng).toBe(-121.5678);
    expect(row.googlePlaceId).toBe("ChIJtumalo");
  });

  it("clears all four on an EXPLICIT null", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: astoria.id, ...locatedColumns() });

    const res = await PATCH(req({ place: null }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBeNull();
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.googlePlaceId).toBeNull();
  });

  it("400s a place with no name, and writes nothing", async () => {
    const { idea } = await fx.pacificNorthwestLoop();

    const res = await PATCH(req({ place: { name: "" } }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(400);
    expect((await read.idea(idea.id))!.placeName).toBeNull();
  });

  it("never writes a place onto ANOTHER owner's idea", async () => {
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(req({ place: TUMALO }, "PATCH"), ctx(idea.id));

    // The shipped 204-not-404 asymmetry above still holds; the WRITE does not.
    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBeNull();
    expect(row.lat).toBeNull();
  });

  it("answers an empty patch without a SQL error", async () => {
    const { idea } = await fx.pacificNorthwestLoop();
    const res = await PATCH(req({}, "PATCH"), ctx(idea.id));
    expect(res.status).toBe(204);
  });
});

/**
 * #80 — the writes that reach a SHELF idea at all.
 *
 * This is Gap 1 in one file. Every idea write used to be scoped
 * `inArray(ideas.destinationId, ownedDestinationIds(owner))`, and a NULL `destination_id` is in no
 * IN list — so shipping the nullable column without re-scoping would make the
 * status pill, the note, the place clear and the delete silent no-ops on
 * exactly the rows this epic exists to create. The re-scope is to `trip_id`,
 * and these prove both halves: the owner's shelf idea is writable, and another
 * owner's still is not.
 */
describeDb("PATCH/DELETE /api/ideas/[id] — a shelf idea (#80)", () => {
  const LOCATED = {
    placeName: "Coachland RV Park",
    lat: 39.3438,
    lng: -120.2046,
    googlePlaceId: "ChIJcoachland",
  };

  it("a status PATCH reaches a row with a null destination_id", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, title: "Coachland" });

    const res = await PATCH(req({ status: "planned" }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    expect((await read.idea(idea.id))!.status).toBe("planned");
  });

  it("a { place: null } PATCH clears all four columns on a shelf idea", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, ...LOCATED });

    const res = await PATCH(req({ place: null }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBeNull();
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.googlePlaceId).toBeNull();
  });

  it("a DELETE removes a shelf idea", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null });

    const res = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(res.status).toBe(204);
    expect(await read.idea(idea.id)).toBeNull();
  });

  it("a foreign owner's shelf idea still matches nothing", async () => {
    const { trip } = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, title: "Theirs" });

    await PATCH(req({ status: "done", notes: "hijacked" }, "PATCH"), ctx(idea.id));
    const del = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(del.status).toBe(404);
    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("idea");
    expect(row.notes).toBeNull();
  });

  /** The three drop gestures, on the wire. `destination_id` is a real column, so it
   * passes through `ideaPatchColumns` unflattened — including the explicit
   * null that sends a row back to the shelf. */
  it("attaches with a destinationId and detaches with an explicit null", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, ...LOCATED });

    expect((await PATCH(req({ destinationId: astoria.id }, "PATCH"), ctx(idea.id))).status).toBe(204);
    expect((await read.idea(idea.id))!.destinationId).toBe(astoria.id);

    expect((await PATCH(req({ destinationId: null }, "PATCH"), ctx(idea.id))).status).toBe(204);
    expect((await read.idea(idea.id))!.destinationId).toBeNull();
  });

  it("the drop never disturbs the place it is carrying", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, ...LOCATED });

    await PATCH(req({ destinationId: astoria.id }, "PATCH"), ctx(idea.id));

    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBe("Coachland RV Park");
    expect(row.lat).toBe(39.3438);
    expect(row.googlePlaceId).toBe("ChIJcoachland");
  });
});

/**
 * #80 rework · the PATCH proves the PAIR, not just the tenancy.
 *
 * The drop gesture this epic adds is the first write that lets the CLIENT name
 * a destination on an existing idea, and the write is scoped on the IDEA
 * (`ideas.tripId in ownedTripIds`) — which says nothing at all about the destination
 * the body points at. Without a check on the target, a hand-rolled PATCH plants
 * a row under a destination on someone else's trip: `getTripById` renders it, and
 * `deleteIdea` (scoped the same way) leaves the victim no way to remove it.
 * `schema.ts:134` states the invariant — "when destination_id is set, that destination's chapter
 * must belong to trip_id" — and `createIdea` already proves it with
 * `assertDestinationInTrip`. These are the PATCH's half of that same proof.
 */
describeDb("PATCH /api/ideas/[id] — the destination it attaches to (#80)", () => {
  it("refuses a destination on another trip of the SAME owner", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, title: "Coachland" });
    // Ownership is not the question here — the PAIR is.
    const other = await fx.trip({ title: "Desert Southwest" });
    const otherChapter = await fx.chapter({ tripId: other.id });
    const otherDestination = await fx.destination({ chapterId: otherChapter.id });

    const res = await PATCH(req({ destinationId: otherDestination.id }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "destination not found" });
    expect((await read.idea(idea.id))!.destinationId).toBeNull();
  });

  it("refuses ANOTHER owner's destination and plants nothing under it", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({
      tripId: trip.id,
      destinationId: null,
      title: "Injected by attacker",
    });
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(req({ destinationId: theirs.astoria.id }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(404);
    expect((await read.idea(idea.id))!.destinationId).toBeNull();
    expect(await read.countIdeas(theirs.astoria.id)).toBe(1); // the fixture's own
  });

  it("rolls the WHOLE patch back — a refused destination moves no other column either", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, title: "Coachland" });
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);

    await PATCH(req({ destinationId: theirs.astoria.id, status: "planned" }, "PATCH"), ctx(idea.id));

    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("idea");
    expect(row.destinationId).toBeNull();
  });

  it("still takes a destination that IS on the idea's trip", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: null, title: "Coachland" });

    const res = await PATCH(req({ destinationId: astoria.id, status: "planned" }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.destinationId).toBe(astoria.id);
    expect(row.status).toBe("planned");
  });

  it("keeps the shipped 204 no-op for another owner's idea, destination or no destination", async () => {
    // The asymmetry pinned at the top of this file is unchanged by the guard:
    // a foreign IDEA is still a silent 204, because the guard only fires once
    // an owned idea has been found.
    const theirs = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const mine = await fx.pacificNorthwestLoop();

    const res = await PATCH(req({ destinationId: mine.astoria.id }, "PATCH"), ctx(theirs.idea.id));

    expect(res.status).toBe(204);
    expect((await read.idea(theirs.idea.id))!.destinationId).toBe(theirs.astoria.id);
  });
});

/**
 * #80 rework · gesture 1's UNDO, as a sequence of real requests.
 *
 * `ideas.destination_id` is ON DELETE CASCADE (schema.ts:133), so "undo the plan" by
 * deleting the destination the plan created DESTROYS the idea the plan attached — the
 * shelf shows the row again until the next load, and then it is gone. The undo
 * has to DETACH first. Both arms are here so the order is a tested fact rather
 * than a comment.
 */
describeDb("the plan-undo order (#80)", () => {
  it("deleting the destination FIRST cascades the idea away — the hazard", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: astoria.id, title: "Coachland" });

    const res = await DELETE_DESTINATION(req(undefined, "DELETE"), ctx(astoria.id));

    expect(res.status).toBe(204);
    expect(await read.idea(idea.id)).toBeNull();
  });

  it("detaching first, THEN deleting the destination, leaves the idea on the shelf", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, destinationId: astoria.id, title: "Coachland" });

    const detach = await PATCH(req({ destinationId: null, status: "idea" }, "PATCH"), ctx(idea.id));
    const del = await DELETE_DESTINATION(req(undefined, "DELETE"), ctx(astoria.id));

    expect(detach.status).toBe(204);
    expect(del.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row).not.toBeNull();
    expect(row.destinationId).toBeNull();
    expect(row.status).toBe("idea");
  });
});
