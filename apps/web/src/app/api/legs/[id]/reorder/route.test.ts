import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { POST } from "@/app/api/legs/[id]/reorder/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: this is `reorderLegStops` — the OTHER reorder route (C1), over
 * a leg's stops rather than a trip's legs. */
describeDb("POST /api/legs/[id]/reorder", () => {
  it("404s on another owner's leg and leaves the stop sortOrders alone", async () => {
    const { legCoast, astoria, newport } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await POST(req({ order: [newport.id, astoria.id] }), ctx(legCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "leg not found" });
    expect(await read.stopRows(legCoast.id)).toEqual([
      { id: astoria.id, sortOrder: 0 },
      { id: newport.id, sortOrder: 1 },
    ]);
  });
});
