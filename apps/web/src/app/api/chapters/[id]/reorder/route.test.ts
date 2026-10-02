import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/chapters/[id]/reorder/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: this is `reorderChapterDestinations` — the OTHER reorder route (C1), over
 * a chapter's destinations rather than a trip's chapters. */
describeDb("POST /api/chapters/[id]/reorder", () => {
  it("404s on another owner's chapter and leaves the destination sortOrders alone", async () => {
    const { chapterCoast, astoria, newport } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(req({ order: [newport.id, astoria.id] }), ctx(chapterCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "chapter not found" });
    expect(await read.destinationRows(chapterCoast.id)).toEqual([
      { id: astoria.id, sortOrder: 0 },
      { id: newport.id, sortOrder: 1 },
    ]);
  });
});
