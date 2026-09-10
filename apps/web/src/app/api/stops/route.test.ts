import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/stops/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: `createStop` checks the DESTINATION leg explicitly — an insert
 * has no WHERE to match zero rows. */
describeDb("POST /api/stops", () => {
  it("404s on another owner's leg and creates no stop under it", async () => {
    const { legCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(
      req({
        legId: legCoast.id,
        place: { name: "Cannon Beach, OR", lat: 45.8918, lng: -123.9615 },
        arriveDate: null,
        departDate: null,
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "leg not found" });
    expect(await read.countStops(legCoast.id)).toBe(2);
  });
});
