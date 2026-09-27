import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { describeDb } from "@/test/db";

/**
 * The household tenancy tables (#77 · docs/design/81 §2 "Migration 0007").
 *
 * This lives in apps/web rather than packages/db for one reason: packages/db
 * has no `test` script and no runner (docs/design/81 dev note 7), while
 * apps/web's suite creates a database and runs the REAL
 * `packages/db/drizzle/` migrations against it (src/test/global-setup.ts:44).
 * So this is the only place in the repo where the shipped migration — not a
 * hand-rolled `CREATE TABLE` — is what the assertions run against.
 *
 * What it pins: the three tables exist after 0007; the constraints Q4 = A
 * depends on (ONE household per person, one member row per pair, one-use
 * invites); and that 0007 changed no `owner_id` column, which is the whole of
 * Q2 = A — the four owner columns move by VALUE, never by DDL.
 */

const DRIZZLE_DIR = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));

/**
 * The ONE migration since the W0 reset (#110 §5, Q8 A): 0007's tables are in
 * 0000_v2 now, and its owner-id backfill is gone with the data it moved —
 * the reset carries nothing over.
 */
function migrationV2(): string {
  const file = readdirSync(DRIZZLE_DIR).find((f) => f.startsWith("0000_") && f.endsWith(".sql"));
  if (!file) throw new Error(`no 0000_*.sql in ${DRIZZLE_DIR}`);
  return readFileSync(`${DRIZZLE_DIR}/${file}`, "utf8");
}

describe("the v2 migration (no database needed)", () => {
  it("creates the three tenancy tables", () => {
    const text = migrationV2();
    expect(text).toMatch(/CREATE TABLE "households"/);
    expect(text).toMatch(/CREATE TABLE "household_members"/);
    expect(text).toMatch(/CREATE TABLE "household_invites"/);
  });
});

describeDb("household tenancy schema", () => {
  it("keys a member row on (household_id, user_id)", async () => {
    await db.insert(schema.households).values({ id: "h1" });
    await db.insert(schema.householdMembers).values({
      householdId: "h1",
      userId: "user_a",
      role: "owner",
    });

    await expect(
      db.insert(schema.householdMembers).values({ householdId: "h1", userId: "user_a", role: "member" }),
    ).rejects.toThrow();
  });

  it("allows ONE household per person — the premise of Q4 = A", async () => {
    await db.insert(schema.households).values([{ id: "h1" }, { id: "h2" }]);
    await db.insert(schema.householdMembers).values({
      householdId: "h1",
      userId: "user_a",
      role: "owner",
    });

    // user_a cannot also belong to h2: a second household would have to merge
    // two rigs and two prefs rows, and both are singletons per owner.
    await expect(
      db.insert(schema.householdMembers).values({ householdId: "h2", userId: "user_a", role: "member" }),
    ).rejects.toThrow();
  });

  it("refuses a member row for a household that does not exist", async () => {
    await expect(
      db.insert(schema.householdMembers).values({ householdId: "nope", userId: "user_a", role: "owner" }),
    ).rejects.toThrow();
  });

  it("defaults a household's name and stamps created_at", async () => {
    await db.insert(schema.households).values({ id: "h1" });

    const [row] = await db.select().from(schema.households);
    expect(row!.name).toBe("My household");
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it("keys an invite on its token and leaves redeemed_at null until it is used", async () => {
    await db.insert(schema.households).values({ id: "h1" });
    await db.insert(schema.householdInvites).values({
      token: "7fD2QK4N",
      householdId: "h1",
      expiresAt: new Date("2026-09-26T00:00:00Z"),
    });

    const [row] = await db.select().from(schema.householdInvites);
    expect(row!.redeemedAt).toBeNull(); // ONE use — stamped at redemption, not before
    expect(row!.expiresAt).toBeInstanceOf(Date);

    // The token IS the primary key: the /join/<token> path segment is unique.
    await expect(
      db.insert(schema.householdInvites).values({
        token: "7fD2QK4N",
        householdId: "h1",
        expiresAt: new Date("2026-10-10T00:00:00Z"),
      }),
    ).rejects.toThrow();
  });

  it("truncates the three tables between tests", async () => {
    // Every test above inserted into households; this one runs after them and
    // must still see an empty table, or the tenancy rows leak across files.
    expect(await db.select().from(schema.households)).toEqual([]);
    expect(await db.select().from(schema.householdMembers)).toEqual([]);
    expect(await db.select().from(schema.householdInvites)).toEqual([]);
  });
});
