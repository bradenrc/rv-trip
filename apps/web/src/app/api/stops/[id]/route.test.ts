import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/stops/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: the stop write scopes through `ownedLegIds`. */
describeDb("PATCH/DELETE /api/stops/[id]", () => {
  it("404s a PATCH on another owner's stop and leaves its dates and rating alone", async () => {
    const { astoria } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(
      req({ arriveDate: "2026-08-20", departDate: "2026-08-22", rating: 1 }, "PATCH"),
      ctx(astoria.id),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "stop not found" });
    const row = (await read.stop(astoria.id))!;
    expect(row.arriveDate).toBe("2026-08-02");
    expect(row.departDate).toBe("2026-08-05");
    expect(row.rating).toBe(5);
  });

  /**
   * #60 — the issue's central verb, end to end. `place` is NESTED on the wire
   * and there is no `place` column, so without the handler's flattening this
   * PATCH is a runtime SQL failure. The three columns and the name must all
   * move, in one write.
   */
  it("writes the whole place — name, coordinates and place id — from one nested key", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();

    const res = await PATCH(
      req(
        {
          place: {
            name: "Cape Lookout State Park",
            lat: 45.3612,
            lng: -123.9707,
            googlePlaceId: "ChIJlXc1RkoPlVQR",
          },
        },
        "PATCH",
      ),
      ctx(astoria.id),
    );

    expect(res.status).toBe(204);
    const row = (await read.stop(astoria.id))!;
    expect(row.placeName).toBe("Cape Lookout State Park");
    expect(row.lat).toBe(45.3612);
    expect(row.lng).toBe(-123.9707);
    expect(row.googlePlaceId).toBe("ChIJlXc1RkoPlVQR");
  });

  /** The escape row's honest outcome: re-picking a plain name CLEARS the
   * coordinates rather than leaving a pin at the old spot under a new label. */
  it("a coordless place clears the coordinates the row used to have", async () => {
    const { astoria } = await fx.pacificNorthwestLoop();

    const res = await PATCH(
      req({ place: { name: "rogue ales brewery" } }, "PATCH"),
      ctx(astoria.id),
    );

    expect(res.status).toBe(204);
    const row = (await read.stop(astoria.id))!;
    expect(row.placeName).toBe("rogue ales brewery");
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.googlePlaceId).toBeNull();
  });

  it("404s a DELETE on another owner's stop — its reservations and ideas survive", async () => {
    const { astoria } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(astoria.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "stop not found" });
    expect(await read.stop(astoria.id)).not.toBeNull();
    expect(await read.countReservations(astoria.id)).toBe(1);
    expect(await read.countIdeas(astoria.id)).toBe(1);
  });
});
