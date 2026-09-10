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
