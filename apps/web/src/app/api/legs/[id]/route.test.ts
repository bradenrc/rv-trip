import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/legs/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: both writes scope through the leg -> trip join. */
describeDb("PATCH/DELETE /api/legs/[id]", () => {
  it("404s a PATCH on another owner's leg and leaves the title alone", async () => {
    const { legCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(req({ title: "hijacked" }, "PATCH"), ctx(legCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "leg not found" });
    expect((await read.leg(legCoast.id))!.title).toBe("Oregon Coast");
  });

  it("404s a DELETE on another owner's leg — its stops must survive", async () => {
    const { legCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(legCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "leg not found" });
    expect(await read.leg(legCoast.id)).not.toBeNull();
    expect(await read.countStops(legCoast.id)).toBe(2);
  });
});
