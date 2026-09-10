import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/places/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth. PATCH carries TWO refusals in one handler, and both are asserted. */
describeDb("PATCH/DELETE /api/places/[id]", () => {
  it("404s a PATCH on another owner's place and leaves the note alone", async () => {
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, name: "Their spot", note: null });

    const res = await PATCH(req({ note: "hijacked" }, "PATCH"), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "place not found" });
    expect((await read.savedPlace(theirs.id))!.note).toBe(null);
  });

  it("404s a PATCH that re-points an owned place at another owner's trip", async () => {
    const mine = await fx.savedPlace({ name: "My spot" });
    const theirTrip = await fx.trip({ owner: OTHER_OWNER });

    const res = await PATCH(
      req({ status: "been", rating: 5, tripId: theirTrip.id }, "PATCH"),
      ctx(mine.id),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "trip not found" });
    const row = (await read.savedPlace(mine.id))!;
    expect(row.tripId).toBe(null);
    expect(row.status).toBe("want");
    expect(row.rating).toBe(null);
  });

  it("404s a DELETE on another owner's place", async () => {
    const theirs = await fx.savedPlace({ owner: OTHER_OWNER, name: "Their spot" });

    const res = await DELETE(req(undefined, "DELETE"), ctx(theirs.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "place not found" });
    expect(await read.savedPlace(theirs.id)).not.toBeNull();
  });
});
