import { expect, it } from "vitest";
import { NO_RIG_HASH, estimateRoute, routeCacheKey } from "@rv-trip/core";
import { tripBundleSchema } from "@rv-trip/core/api-client";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, GET, PATCH } from "@/app/api/trips/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/**
 * §6.1 owner scoping (the 404 AND the no-op) and §6.5 the trip bundle, both
 * against the real handler and the real database. Plus the §7 breadth row for
 * DELETE, whose damage is the cascade rather than the row.
 */
describeDb("GET/PATCH/DELETE /api/trips/[id]", () => {
  /**
   * #60 Q4 → B, end to end. `homeBasePlace` is one object on the wire and three
   * nullable columns underneath, and `getTripById` has to read them back — the
   * half without which `trip.homeBasePlace` is silently always null and the
   * first stop of a leg gets no search bias at all.
   */
  it("round-trips the home-base ANCHOR, not just the name", async () => {
    const trip = await fx.trip({ owner: DEV_OWNER, homeBase: "Boise, ID" });

    const res = await PATCH(
      req(
        {
          homeBase: "Bend, OR",
          homeBasePlace: {
            name: "Bend, OR",
            lat: 44.0582,
            lng: -121.3153,
            googlePlaceId: "ChIJbend",
          },
        },
        "PATCH",
      ),
      ctx(trip.id),
    );
    expect(res.status).toBe(204);

    const row = (await read.trip(trip.id))!;
    expect(row.homeBase).toBe("Bend, OR");
    expect(row.homeBaseLat).toBe(44.0582);
    expect(row.homeBaseLng).toBe(-121.3153);
    expect(row.homeBasePlaceId).toBe("ChIJbend");

    const bundle = tripBundleSchema.parse(await (await GET(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip.homeBasePlace).toEqual({
      name: "Bend, OR",
      lat: 44.0582,
      lng: -121.3153,
      googlePlaceId: "ChIJbend",
    });
  });

  /** A pre-#60 row has a name and no anchor: it reads back as a null place
   * rather than as a place that cannot be drawn. */
  it("reads a trip with no anchor as homeBasePlace: null", async () => {
    const trip = await fx.trip({ owner: DEV_OWNER, homeBase: "Boise, ID" });
    const bundle = tripBundleSchema.parse(await (await GET(req(undefined, "GET"), ctx(trip.id))).json());
    expect(bundle.trip.homeBase).toBe("Boise, ID");
    expect(bundle.trip.homeBasePlace).toBeNull();
  });

  it("refuses a PATCH on another owner's trip — 404, and the row is unchanged", async () => {
    const theirs = await fx.trip({ owner: OTHER_OWNER, title: "Someone else's loop" });

    const res = await PATCH(
      req({ title: "hijacked" }, "PATCH"),
      ctx(theirs.id), // params is a PROMISE (Next 16)
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });

    // the half a status code cannot tell you:
    expect((await read.trip(theirs.id))!.title).toBe("Someone else's loop");
  });

  it("refuses a DELETE on another owner's trip — the cascade is the damage", async () => {
    const { trip, legCoast, astoria } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(trip.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.trip(trip.id)).not.toBeNull();
    expect(await read.countLegs(trip.id)).toBe(2);
    expect(await read.countStops(legCoast.id)).toBe(2);
    expect(await read.countReservations(astoria.id)).toBe(1);
  });

  it("returns the trip bundle the native client validates", async () => {
    const { trip, astoria, newport } = await fx.pacificNorthwestLoop();

    const res = await GET(req(undefined, "GET"), ctx(trip.id));
    expect(res.status).toBe(200);

    // the assertion IS the parse — any drift throws a ZodError
    const bundle = tripBundleSchema.parse(await res.json());

    expect(bundle.hasRig).toBe(false);
    expect(bundle.rigHash).toBe(NO_RIG_HASH); // "no-rig"
    expect(bundle.trip.ownerId).toBe(DEV_OWNER);
    expect(bundle.trip.homeBase).toBe("Boise, ID");
    expect(bundle.trip.legs).toHaveLength(2);
    // `placeName` is the WRITE shape only; the read shape nests `place`.
    expect(bundle.trip.legs[0]!.stops[0]!.place.name).toBe("Astoria, OR");

    // Q5: the clock is pinned, so the DERIVED status is a constant.
    // statusAuto=true, endDate >= today, daysUntil(start, today) = -14 <= 30
    // → deriveTripStatus returns "upcoming" (trip-status.ts:48-53).
    expect(bundle.trip.statusAuto).toBe(true);
    expect(bundle.trip.status).toBe("upcoming");

    // routes: orderedPairs pairs ADJACENT STOPS trip-wide — home base is never
    // a waypoint, and COORDINATES (not dates) gate a pair. Three
    // coordinate-bearing stops → exactly two keys.
    expect(Object.keys(bundle.routes)).toHaveLength(2);
    const key = routeCacheKey(astoria, newport, NO_RIG_HASH);
    // Assert against the arithmetic, not against magic numbers: estimateRoute
    // is a pure haversine at 75 km/h rounded to whole minutes.
    expect(bundle.routes[key]).toEqual(estimateRoute(astoria, newport));
  });

  it("404s a GET on another owner's trip, which never reaches the schema", async () => {
    const theirs = await fx.trip({ owner: OTHER_OWNER });
    const res = await GET(req(undefined, "GET"), ctx(theirs.id));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
  });
});

/**
 * #80 — the trip tree carries the SHELF.
 *
 * `trip.ideas[]` is the trip's UNATTACHED maybes and only those: an idea with a
 * stop already arrives under that stop, and loading it twice would draw it
 * twice. The bundle schema is the phone's parse of the same payload, so this
 * also proves the wire did not drift.
 */
describeDb("GET /api/trips/[id] — the idea shelf (#80)", () => {
  it("returns the unattached ideas beside the legs, and only those", async () => {
    const { trip, astoria } = await fx.pacificNorthwestLoop();
    const shelf = await fx.idea({
      tripId: trip.id,
      stopId: null,
      category: "stay",
      title: "Coachland RV Park",
    });

    const bundle = tripBundleSchema.parse(
      await (await GET(req(undefined, "GET"), ctx(trip.id))).json(),
    );

    expect(bundle.trip.ideas.map((i) => i.id)).toEqual([shelf.id]);
    expect(bundle.trip.ideas[0]).toMatchObject({ stopId: null, category: "stay" });
    // …and the fixture's ATTACHED idea is still where it always was.
    const attached = bundle.trip.legs
      .flatMap((l) => l.stops)
      .find((s) => s.id === astoria.id)!.ideas;
    expect(attached).toHaveLength(1);
    expect(attached[0]!.stopId).toBe(astoria.id);
    expect(bundle.trip.ideas.map((i) => i.id)).not.toContain(attached[0]!.id);
  });

  it("is an empty array on a trip with nothing on its shelf", async () => {
    const { trip } = await fx.pacificNorthwestLoop();

    const bundle = tripBundleSchema.parse(
      await (await GET(req(undefined, "GET"), ctx(trip.id))).json(),
    );

    expect(bundle.trip.ideas).toEqual([]);
  });
});
