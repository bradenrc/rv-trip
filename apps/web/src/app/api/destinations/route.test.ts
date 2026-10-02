import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/destinations/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: `createDestination` checks the AREA chapter explicitly — an insert
 * has no WHERE to match zero rows. */
describeDb("POST /api/destinations", () => {
  it("404s on another owner's chapter and creates no destination under it", async () => {
    const { chapterCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(
      req({
        chapterId: chapterCoast.id,
        place: { name: "Cannon Beach, OR", lat: 45.8918, lng: -123.9615 },
        arriveDate: null,
        departDate: null,
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "chapter not found" });
    expect(await read.countDestinations(chapterCoast.id)).toBe(2);
  });
});
