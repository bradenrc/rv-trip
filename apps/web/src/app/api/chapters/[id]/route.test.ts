import { expect, it } from "vitest";
import { OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { DELETE, PATCH } from "@/app/api/chapters/[id]/route";
import { ctx, describeDb, req } from "@/test/db";

/** §7 breadth: both writes scope through the chapter -> trip join. */
describeDb("PATCH/DELETE /api/chapters/[id]", () => {
  it("404s a PATCH on another owner's chapter and leaves the title alone", async () => {
    const { chapterCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await PATCH(req({ title: "hijacked" }, "PATCH"), ctx(chapterCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "chapter not found" });
    expect((await read.chapter(chapterCoast.id))!.title).toBe("Oregon Coast");
  });

  it("404s a DELETE on another owner's chapter — its destinations must survive", async () => {
    const { chapterCoast } = await fx.pacificNorthwestLoop(OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(chapterCoast.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "chapter not found" });
    expect(await read.chapter(chapterCoast.id)).not.toBeNull();
    expect(await read.countDestinations(chapterCoast.id)).toBe(2);
  });
});
