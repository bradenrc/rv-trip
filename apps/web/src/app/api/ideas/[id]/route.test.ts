import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/ideas/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth, and the one asymmetry in the matrix — both in one file. */
describeDb("PATCH/DELETE /api/ideas/[id]", () => {
  it("answers 204 for another owner's idea, and changes nothing", async () => {
    // ⚠ SHIPPED INCONSISTENCY, asserted as it is rather than fixed (gap 2).
    // `updateIdeaFields` returns void (mutations.ts:455-464) and the handler
    // never checks a match (ideas/[id]/route.ts:18-19), so a foreign idea
    // answers 204 where every sibling leaf answers 404. The WRITE itself is
    // correctly scoped, so the invariant §7 asks for — a foreign id changes
    // nothing — still holds. Making this a 404 is a production change and a
    // client-visible contract change; it belongs to its own issue. This test
    // pins the current behaviour so the follow-up changes a test on purpose
    // instead of discovering one.
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(
      req({ status: "done", rating: 1, notes: "hijacked" }, "PATCH"),
      ctx(idea.id),
    );

    expect(res.status).toBe(204);
    const row = (await read.idea(idea.id))!;
    expect(row.status).toBe("idea");
    expect(row.rating).toBe(null);
    expect(row.notes).toBe(null);
  });

  it("404s a DELETE on another owner's idea — the asymmetry with the PATCH above", async () => {
    const { idea } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(idea.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "idea not found" });
    expect(await read.idea(idea.id)).not.toBeNull();
  });
});
