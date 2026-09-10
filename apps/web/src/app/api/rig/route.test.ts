import { expect, it } from "vitest";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { PUT } from "@/app/api/rig/route";
import { describeDb, req } from "@/test/db";
import { PINNED_NOW } from "@/test/setup";

const BIG_BLUE = {
  name: "Big Blue",
  type: "motorhome" as const,
  heightMeters: 3.5052,
  widthMeters: 2.591,
  lengthMeters: 10.972,
  grossWeightKg: 11793.4,
  propaneOnBoard: true,
};

/**
 * §6.4 the rig upsert. Worth depth because the millimetre round-trip out
 * through `String()`, into `numeric(6,4)` and back through `Number()` is
 * exactly what a unit test with a fake db cannot check — and 11'6" = 3.5052 m
 * is a bridge-clearance number.
 */
describeDb("PUT /api/rig", () => {
  it("is idempotent, keeps one row, and round-trips the millimetres", async () => {
    expect((await PUT(req(BIG_BLUE, "PUT"))).status).toBe(200);
    const before = (await read.rigRow(DEV_OWNER))!;

    const second = await PUT(req({ ...BIG_BLUE, heightMeters: 3.61 }, "PUT"));

    expect(second.status).toBe(200); // json(), not 204
    expect(await read.countRigs(DEV_OWNER)).toBe(1); // unique(owner_id)

    const rig = await second.json();
    expect(rig.heightMeters).toBe(3.61); // numeric(6,4) → Number(),
    expect(rig.grossWeightKg).toBe(11793.4); // not the "3.6100" string
    expect(rig.id).toBe(before.id); // the same row, updated

    // updatedAt is NOT on the response — mapRigRow (queries.ts:396-417) maps
    // seven fields + id + ownerId, and RigProfile has no timestamp (C3). So
    // the touch is asserted on the ROW, not on the payload.
    //
    // And it is asserted as an EQUALITY, not as `>`: the first PUT is an
    // INSERT, so `updated_at` comes from `defaultNow()` — the POSTGRES clock,
    // real wall time — while the conflict branch sets `new Date()`
    // (mutations.ts:552), the JS clock that Q5 freezes. The touch is therefore
    // visible as the row carrying the PINNED instant, which the insert cannot.
    const after = (await read.rigRow(DEV_OWNER))!;
    expect(after.updatedAt.getTime()).not.toBe(before.updatedAt.getTime());
    expect(after.updatedAt.toISOString()).toBe(new Date(PINNED_NOW).toISOString());
  });

  it("is partitioned by owner — the rig is a singleton with no foreign id to send", async () => {
    // The partition variant of the §7 breadth row: rigs are keyed on owner_id,
    // so seed one for the other owner and PUT as dev-user.
    const theirs = await fx.rig({
      owner: OTHER_OWNER,
      name: "Their Rig",
      type: "trailer",
      heightMeters: 3.2004,
    });

    expect((await PUT(req(BIG_BLUE, "PUT"))).status).toBe(200);

    expect(await read.countRigs(DEV_OWNER)).toBe(1);
    expect(await read.countRigs(OTHER_OWNER)).toBe(1);
    expect(await read.rigRow(OTHER_OWNER)).toEqual(theirs); // byte-identical
  });
});
