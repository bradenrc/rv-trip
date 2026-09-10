import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/legs/route";
import { describeDb, req } from "@/test/db";

/** §7 breadth: a foreign id changes nothing. `createLeg` throws
 * "trip not found" — an insert has no WHERE to match zero rows. */
describeDb("POST /api/legs", () => {
  it("404s on another owner's trip and creates no leg under it", async () => {
    const theirs = await fx.trip({ owner: OTHER_OWNER });

    const res = await POST(req({ tripId: theirs.id, title: "Hijacked leg" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    expect(await read.countLegs(theirs.id)).toBe(0);
  });
});
