import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/reservations/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: both writes scope through `ownedStopIds(owner)`. */
describeDb("PATCH/DELETE /api/reservations/[id]", () => {
  it("404s a PATCH on another owner's reservation and leaves rating and notes alone", async () => {
    const { reservation } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(req({ rating: 1, notes: "hijacked" }, "PATCH"), ctx(reservation.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "reservation not found" });
    const row = (await read.reservation(reservation.id))!;
    expect(row.rating).toBe(5);
    expect(row.notes).toBe("Full hookups, site A12 backs to the trees.");
  });

  it("404s a DELETE on another owner's reservation", async () => {
    const { reservation } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(reservation.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "reservation not found" });
    expect(await read.reservation(reservation.id)).not.toBeNull();
  });
});
