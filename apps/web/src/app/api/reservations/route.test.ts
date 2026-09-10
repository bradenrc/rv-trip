import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/reservations/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: `createReservation` proves the parent stop and throws. */
describeDb("POST /api/reservations", () => {
  it("404s on another owner's stop and attaches no reservation to it", async () => {
    const { astoria } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(
      req({ stopId: astoria.id, type: "lodging", name: "Hijacked booking" }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "stop not found" });
    expect(await read.countReservations(astoria.id)).toBe(1); // the fixture's own
  });
});
