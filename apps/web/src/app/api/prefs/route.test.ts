import { expect, it } from "vitest";
import { DEV_OWNER, OTHER_OWNER, fx, read } from "@rv-trip/db/testing";
import { GET, PUT } from "@/app/api/prefs/route";
import { describeDb, req } from "@/test/db";
import { PINNED_NOW } from "@/test/setup";

/**
 * `/api/prefs` (issue #45 item 4 · #38) — the account's preference singleton.
 *
 * Worth a database rather than a unit test for three reasons a fake cannot
 * check: that `owner_id` really is the primary key the upsert conflicts on;
 * that a PARTIAL PUT leaves the columns it did not name ALONE (the failure mode
 * is silent — a theme toggle nulling a units choice made on another device);
 * and that a nullable column round-trips as `null` rather than as the string
 * "null" or a dropped key.
 */
describeDb("/api/prefs", () => {
  it("answers null for an account that has never chosen anything", async () => {
    const res = await GET();

    expect(res.status).toBe(200); // not a 404 — nothing is missing
    expect(await res.json()).toBeNull();
    expect(await read.countPrefs(DEV_OWNER)).toBe(0); // a GET creates no row
  });

  it("inserts on the first choice and returns the row with its nulls intact", async () => {
    const res = await PUT(req({ theme: "light" }, "PUT"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ownerId: DEV_OWNER,
      theme: "light",
      units: null, // never chosen — NOT "null", NOT absent
      mapStyle: null,
      trackCosts: null,
      updatedAt: expect.any(String),
    });
    expect(await read.countPrefs(DEV_OWNER)).toBe(1);
  });

  it("PUTs a PARTIAL — the three fields it did not name keep their values", async () => {
    await PUT(req({ units: "metric", mapStyle: "sat", trackCosts: true }, "PUT"));

    // The write-through every setter makes: ONE field.
    const res = await PUT(req({ theme: "dark" }, "PUT"));

    expect(await res.json()).toMatchObject({
      theme: "dark",
      units: "metric", // still there — this is the whole point
      mapStyle: "sat",
      trackCosts: true,
    });
    expect(await read.countPrefs(DEV_OWNER)).toBe(1); // owner_id is the PK
  });

  it("stores trackCosts as a real boolean and reads it back as one", async () => {
    await PUT(req({ trackCosts: true }, "PUT"));
    expect((await read.prefsRow(DEV_OWNER))!.trackCosts).toBe(true);

    await PUT(req({ trackCosts: false }, "PUT"));
    expect((await read.prefsRow(DEV_OWNER))!.trackCosts).toBe(false); // not null
  });

  it("accepts an explicit null — putting a preference back to never-chosen", async () => {
    await PUT(req({ theme: "light" }, "PUT"));

    const res = await PUT(req({ theme: null }, "PUT"));

    expect(await res.json()).toMatchObject({ theme: null });
    expect((await read.prefsRow(DEV_OWNER))!.theme).toBeNull();
  });

  it("touches updated_at on the conflict branch", async () => {
    await PUT(req({ theme: "light" }, "PUT"));
    const before = (await read.prefsRow(DEV_OWNER))!;

    await PUT(req({ units: "metric" }, "PUT"));

    // The insert's `updated_at` comes from `defaultNow()` — the POSTGRES clock —
    // while the conflict branch sets `new Date()`, the JS clock Q5 freezes. So
    // the touch is visible as the row carrying the PINNED instant, exactly as
    // api/rig/route.test.ts asserts it.
    const after = (await read.prefsRow(DEV_OWNER))!;
    expect(after.updatedAt.getTime()).not.toBe(before.updatedAt.getTime());
    expect(after.updatedAt.toISOString()).toBe(new Date(PINNED_NOW).toISOString());
  });

  it("rejects an unknown field, and writes nothing", async () => {
    const res = await PUT(req({ theme: "light", colour: "puce" }, "PUT"));

    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(await read.countPrefs(DEV_OWNER)).toBe(0);
  });

  it("rejects an attempt to name the owner, and writes nothing", async () => {
    // `.strict()` is what stops a body reaching past getOwner().
    const res = await PUT(req({ ownerId: OTHER_OWNER, theme: "light" }, "PUT"));

    expect(res.status).toBe(400);
    expect(await read.countPrefs(DEV_OWNER)).toBe(0);
    expect(await read.countPrefs(OTHER_OWNER)).toBe(0);
  });

  it("rejects a wrongly-typed field — the '1' localStorage stores is not a boolean", async () => {
    const res = await PUT(req({ trackCosts: "1" }, "PUT"));

    expect(res.status).toBe(400);
    expect(await read.countPrefs(DEV_OWNER)).toBe(0);
  });

  it("is partitioned by owner — GET and PUT both see only getOwner()'s row", async () => {
    const theirs = await fx.prefs({ owner: OTHER_OWNER, theme: "light", units: "metric" });

    expect(await GET()).toBeTruthy();
    expect(await (await GET()).json()).toBeNull(); // theirs is not ours

    await PUT(req({ theme: "dark" }, "PUT"));

    expect(await read.countPrefs(DEV_OWNER)).toBe(1);
    expect(await read.countPrefs(OTHER_OWNER)).toBe(1);
    expect(await read.prefsRow(OTHER_OWNER)).toEqual(theirs); // byte-identical
  });

  it("round-trips what it wrote — GET returns the PUT's own answer", async () => {
    const put = await (await PUT(req({ theme: "light", trackCosts: true }, "PUT"))).json();

    expect(await (await GET()).json()).toEqual(put);
  });
});
