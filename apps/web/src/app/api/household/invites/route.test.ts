import { expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER } from "@rv-trip/db/testing";
import { POST } from "@/app/api/household/invites/route";
import { describeDb } from "@/test/db";
import { PINNED_NOW } from "@/test/setup";

/**
 * `POST /api/household/invites` (#77 · docs/design/81 §3, plan item i3) — the
 * button in the Household card's solo state.
 *
 * Q3 = B: no mailer and no webhook. One `household_invites` row IS the link, so
 * the two things worth a database rather than a fake are that the row really is
 * scoped to `getOwner()`'s household, and that `expires_at` is written by the
 * app (created_at + 14 days) rather than left to a DDL default that does not
 * exist.
 */
const DAY_MS = 86_400_000;

// Read the whole (truncated) table and filter here rather than in SQL:
// `drizzle-orm` is not a dependency of apps/web, and the handler tests are
// deliberately thin on query-building of their own.
async function invitesFor(household: string) {
  const rows = await db.select().from(schema.householdInvites);
  return rows.filter((r) => r.householdId === household);
}

describeDb("POST /api/household/invites", () => {
  it("answers the token and the expiry, and writes exactly one row", async () => {
    const res = await POST();

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.token.length).toBeGreaterThanOrEqual(8);

    const rows = await invitesFor(DEV_OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(body.token);
    expect(rows[0]!.redeemedAt).toBeNull(); // "one use" is this null
  });

  it("expires exactly 14 days after it was created", async () => {
    const res = await POST();
    const { expiresAt } = await res.json();

    const [row] = await invitesFor(DEV_OWNER);
    // Both stamps come from the app's clock, not Postgres's, so the 14 days is
    // a property of the row rather than of how fast the insert ran.
    expect(row!.createdAt.toISOString()).toBe(new Date(PINNED_NOW).toISOString());
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(14 * DAY_MS);
    expect(expiresAt).toBe(row!.expiresAt.toISOString());
  });

  it("lazily creates the household row it hangs off", async () => {
    // Keyless, `getOwner()` answers the literal `dev-household` without ever
    // looking it up — so on a database that was migrated but never seeded there
    // is no row for the invite's foreign key to reference.
    expect(await db.select().from(schema.households)).toEqual([]);

    await POST();

    const households = await db.select().from(schema.households);
    expect(households).toHaveLength(1);
    expect(households[0]!.id).toBe(DEV_OWNER);
  });

  it("keeps ONE live invite — a second press replaces the first", async () => {
    const first = await (await POST()).json();
    const second = await (await POST()).json();

    expect(second.token).not.toBe(first.token);
    const rows = await invitesFor(DEV_OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(second.token);
  });

  it("leaves a REDEEMED invite alone — the log of who joined is not a draft", async () => {
    await db.insert(schema.households).values({ id: DEV_OWNER });
    await db.insert(schema.householdInvites).values({
      token: "already-used",
      householdId: DEV_OWNER,
      expiresAt: new Date(Date.now() + 14 * DAY_MS),
      redeemedAt: new Date(),
    });

    await POST();

    const rows = await invitesFor(DEV_OWNER);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.token)).toContain("already-used");
  });

  it("never touches another household's invite", async () => {
    await db.insert(schema.households).values({ id: OTHER_OWNER });
    await db.insert(schema.householdInvites).values({
      token: "theirs",
      householdId: OTHER_OWNER,
      expiresAt: new Date(Date.now() + 14 * DAY_MS),
    });

    await POST();

    expect(await invitesFor(OTHER_OWNER)).toHaveLength(1);
    expect(await invitesFor(DEV_OWNER)).toHaveLength(1);
  });
});
