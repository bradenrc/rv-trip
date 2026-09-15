import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/ideas/[id]/route";
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
    const idea = await fx.idea({ tripId: trip.id, stopId: astoria.id, ...locatedColumns() });

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
    const idea = await fx.idea({ tripId: trip.id, stopId: astoria.id, ...locatedColumns() });

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
 * `inArray(ideas.stopId, ownedStopIds(owner))`, and a NULL `stop_id` is in no
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

  it("a status PATCH reaches a row with a null stop_id", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, title: "Coachland" });

    const res = await PATCH(req({ status: "planned" }, "PATCH"), ctx(idea.id));

    expect(res.status).toBe(204);
    expect((await read.idea(idea.id))!.status).toBe("planned");
  });

  it("a { place: null } PATCH clears all four columns on a shelf idea", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, ...LOCATED });

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
    const idea = await fx.idea({ tripId: trip.id, stopId: null });

    const res = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(res.status).toBe(204);
    expect(await read.idea(idea.id)).toBeNull();
  });

  it("a foreign owner's shelf idea still matches nothing", async () => {
    const { trip } = await fx.pacificNorthwestLoop(OTHER_OWNER);
    const idea = await fx.idea({ tripId: trip.id, stopId: null, title: "Theirs" });

    await PATCH(req({ status: "done", notes: "hijacked" }, "PATCH"), ctx(idea.id));
    const del = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(del.status).toBe(404);
    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("idea");
    expect(row.notes).toBeNull();
  });

  /** The three drop gestures, on the wire. `stop_id` is a real column, so it
   * passes through `ideaPatchColumns` unflattened — including the explicit
   * null that sends a row back to the shelf. */
  it("attaches with a stopId and detaches with an explicit null", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, ...LOCATED });

    expect((await PATCH(req({ stopId: astoria.id }, "PATCH"), ctx(idea.id))).status).toBe(204);
    expect((await read.idea(idea.id))!.stopId).toBe(astoria.id);

    expect((await PATCH(req({ stopId: null }, "PATCH"), ctx(idea.id))).status).toBe(204);
    expect((await read.idea(idea.id))!.stopId).toBeNull();
  });

  it("the drop never disturbs the place it is carrying", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const idea = await fx.idea({ tripId: trip.id, stopId: null, ...LOCATED });

    await PATCH(req({ stopId: astoria.id }, "PATCH"), ctx(idea.id));

    const row = (await read.idea(idea.id))!;
    expect(row.placeName).toBe("Coachland RV Park");
    expect(row.lat).toBe(39.3438);
    expect(row.googlePlaceId).toBe("ChIJcoachland");
  });
});
