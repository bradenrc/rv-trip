import { expect, it } from "vitest";
import { db, getHouseholdOverview, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER } from "@rv-trip/db/testing";
import { describeDb } from "@/test/db";
import { PINNED_NOW } from "@/test/setup";

/**
 * `getHouseholdOverview()` (#77 · docs/design/81 §3, plan item i3) — the ONE
 * read `/settings` makes on the server before handing the card its props
 * (dev note 3: household + members + the live invite, on the same seam the
 * page already uses for prefs).
 *
 * Lives in apps/web because that is the only package in the repo whose test
 * harness stands up a real Postgres and runs the shipped migrations;
 * `packages/db` has no `test` script (design dev note 7).
 */
const DAY_MS = 86_400_000;
const now = () => new Date(PINNED_NOW);

async function plantHousehold(id: string, name?: string) {
  await db
    .insert(schema.households)
    .values(name === undefined ? { id } : { id, name })
    .onConflictDoNothing();
}

async function plantInvite(token: string, household: string, over: Partial<{
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date;
}> = {}) {
  await db.insert(schema.householdInvites).values({
    token,
    householdId: household,
    expiresAt: new Date(now().getTime() + 14 * DAY_MS),
    ...over,
  });
}

describeDb("getHouseholdOverview", () => {
  it("answers a solo household: its name, one member, no invite", async () => {
    await plantHousehold(DEV_OWNER, "Callahan household");
    await db
      .insert(schema.householdMembers)
      .values({ householdId: DEV_OWNER, userId: "user_braden", role: "owner" });

    const view = await getHouseholdOverview(DEV_OWNER);

    expect(view.id).toBe(DEV_OWNER);
    expect(view.name).toBe("Callahan household");
    expect(view.members).toHaveLength(1);
    expect(view.members[0]).toMatchObject({ userId: "user_braden", role: "owner" });
    expect(view.invite).toBeNull();
  });

  it("does not 500 on a household row that was never seeded", async () => {
    // Keyless `getOwner()` answers the literal `dev-household` without a
    // lookup, so /settings can be asked about a household that has no row yet.
    const view = await getHouseholdOverview(DEV_OWNER);

    expect(view).toMatchObject({ id: DEV_OWNER, members: [], invite: null });
    expect(view.name).toEqual(expect.any(String));
  });

  it("orders members by when they joined — the owner first", async () => {
    await plantHousehold(DEV_OWNER);
    await db.insert(schema.householdMembers).values([
      {
        householdId: DEV_OWNER,
        userId: "user_jess",
        role: "member",
        joinedAt: new Date("2026-09-13T00:00:00Z"),
      },
      {
        householdId: DEV_OWNER,
        userId: "user_braden",
        role: "owner",
        joinedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ]);

    const view = await getHouseholdOverview(DEV_OWNER);

    expect(view.members.map((m) => m.userId)).toEqual(["user_braden", "user_jess"]);
  });

  it("returns the live invite", async () => {
    await plantHousehold(DEV_OWNER);
    await plantInvite("live", DEV_OWNER);

    const view = await getHouseholdOverview(DEV_OWNER);

    expect(view.invite).toMatchObject({ token: "live" });
    expect(view.invite!.expiresAt).toBeInstanceOf(Date);
  });

  it("ignores a redeemed invite — that seat is taken, not waiting", async () => {
    await plantHousehold(DEV_OWNER);
    await plantInvite("used", DEV_OWNER, { redeemedAt: now() });

    expect((await getHouseholdOverview(DEV_OWNER)).invite).toBeNull();
  });

  it("ignores an expired invite — the card must not offer a dead link", async () => {
    await plantHousehold(DEV_OWNER);
    await plantInvite("stale", DEV_OWNER, {
      createdAt: new Date(now().getTime() - 20 * DAY_MS),
      expiresAt: new Date(now().getTime() - 6 * DAY_MS),
    });

    expect((await getHouseholdOverview(DEV_OWNER)).invite).toBeNull();
  });

  it("is scoped to the household — another tenant's people and links are invisible", async () => {
    await plantHousehold(DEV_OWNER);
    await plantHousehold(OTHER_OWNER);
    await db
      .insert(schema.householdMembers)
      .values({ householdId: OTHER_OWNER, userId: "user_stranger", role: "owner" });
    await plantInvite("theirs", OTHER_OWNER);

    const view = await getHouseholdOverview(DEV_OWNER);

    expect(view.members).toEqual([]);
    expect(view.invite).toBeNull();
  });
});
