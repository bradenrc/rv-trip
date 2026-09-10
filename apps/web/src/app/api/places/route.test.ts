import { expect, it } from "vitest";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/places/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: `saved_places` is account-scoped, but attaching one to another
 * owner's trip must still be "trip not found". */
describeDb("POST /api/places", () => {
  it("404s when the body points at another owner's trip, and saves nothing", async () => {
    const theirs = await fx.trip({ owner: OTHER_OWNER });

    const res = await POST(
      req({
        name: "Cape Lookout State Park",
        status: "been",
        rating: 5,
        tripId: theirs.id,
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.countSavedPlaces(DEV_OWNER)).toBe(0);
    expect(await read.countSavedPlaces(OTHER_OWNER)).toBe(0);
  });
});
