import { expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, fx } from "@rv-trip/db/testing";
import { POST } from "@/app/api/household/join/route";
import { describeDb, req } from "@/test/db";
import { PINNED_NOW } from "@/test/setup";

/**
 * `POST /api/household/join` (#77 · docs/design/81 §4, plan item i4) — the
 * button on `/join/<token>`.
 *
 * Keyless, `getOwner()` answers `dev-household` (= `DEV_OWNER` here) and
 * `getActor()` answers `dev-user`, so the VISITOR in every test below is the
 * dev tenant and the INVITING household is a second one seeded by hand. That
 * is the same "two real owners, zero vi.mock" shape the rest of this suite
 * uses.
 *
 * What is worth a real database: the three refusals in the order §4 states
 * them, that a refused join leaves `redeemed_at` NULL — the link has to keep
 * working for the right account — and that a successful redeem does all three
 * of its writes.
 */
const DAY_MS = 86_400_000;
const THEIRS = "their-household";
const DEV_USER = "dev-user"; // `getActor()`'s keyless answer (lib/owner.ts)

async function seedInvite(
  token: string,
  over: { expiresAt?: Date; redeemedAt?: Date | null; householdId?: string } = {},
) {
  const householdId = over.householdId ?? THEIRS;
  await db.insert(schema.households).values({ id: householdId }).onConflictDoNothing();
  await db
    .insert(schema.householdMembers)
    .values({ householdId, userId: "their-owner", role: "owner" })
    .onConflictDoNothing();
  await db.insert(schema.householdInvites).values({
    token,
    householdId,
    expiresAt: over.expiresAt ?? new Date(Date.parse(PINNED_NOW) + 14 * DAY_MS),
    redeemedAt: over.redeemedAt ?? null,
  });
}

const inviteRow = async (token: string) => {
  const rows = await db.select().from(schema.householdInvites);
  return rows.find((r) => r.token === token) ?? null;
};

const membersOf = async (householdId: string) => {
  const rows = await db.select().from(schema.householdMembers);
  return rows.filter((r) => r.householdId === householdId);
};

describeDb("POST /api/household/join", () => {
  it("400s on a body that names no token", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("404s on a token that is not an invite", async () => {
    const res = await POST(req({ token: "nope" }));
    expect(res.status).toBe(404);
  });

  it("refuses an EXPIRED invite, and does not consume it", async () => {
    await seedInvite("expired", { expiresAt: new Date(Date.parse(PINNED_NOW) - DAY_MS) });

    const res = await POST(req({ token: "expired" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invite_expired");
    expect((await inviteRow("expired"))!.redeemedAt).toBeNull();
    expect(await membersOf(THEIRS)).toHaveLength(1);
  });

  it("refuses an invite that was already USED", async () => {
    const usedAt = new Date(Date.parse(PINNED_NOW) - DAY_MS);
    await seedInvite("spent", { redeemedAt: usedAt });

    const res = await POST(req({ token: "spent" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("invite_used");
    // Still stamped with the ORIGINAL redemption, not re-stamped by this one.
    expect((await inviteRow("spent"))!.redeemedAt!.toISOString()).toBe(usedAt.toISOString());
  });

  it("checks expiry BEFORE use — an invite that is both reads as expired", async () => {
    await seedInvite("both", {
      expiresAt: new Date(Date.parse(PINNED_NOW) - DAY_MS),
      redeemedAt: new Date(Date.parse(PINNED_NOW) - 2 * DAY_MS),
    });

    const res = await POST(req({ token: "both" }));

    expect((await res.json()).error).toBe("invite_expired");
  });

  it("refuses an account that has already planned, and leaves redeemed_at NULL", async () => {
    await seedInvite("live");
    await fx.trip({ owner: DEV_OWNER }); // the visitor's own trip

    const res = await POST(req({ token: "live" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("account_not_empty");
    // The whole point of Q4 = A's "reversible": the link still works for the
    // right account.
    expect((await inviteRow("live"))!.redeemedAt).toBeNull();
    expect(await membersOf(THEIRS)).toHaveLength(1);
  });

  it("counts a saved place and a rig as 'already planned' too", async () => {
    await seedInvite("live");
    await fx.savedPlace({ owner: DEV_OWNER });
    expect((await POST(req({ token: "live" }))).status).toBe(409);

    await db.delete(schema.saves);
    await fx.rig({ owner: DEV_OWNER });
    expect((await POST(req({ token: "live" }))).status).toBe(409);
  });

  it("does NOT count a preferences row — flipping dark mode is not planning", async () => {
    await seedInvite("live");
    await fx.prefs({ owner: DEV_OWNER, theme: "light" });

    expect((await POST(req({ token: "live" }))).status).toBe(204);
  });

  it("joins: one member row, a stamped invite and the visitor's household gone", async () => {
    await seedInvite("live");
    await db.insert(schema.households).values({ id: DEV_OWNER });
    await db
      .insert(schema.householdMembers)
      .values({ householdId: DEV_OWNER, userId: DEV_USER, role: "owner" });

    const res = await POST(req({ token: "live" }));

    expect(res.status).toBe(204);

    const members = await membersOf(THEIRS);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === DEV_USER)!.role).toBe("member");

    expect((await inviteRow("live"))!.redeemedAt!.toISOString()).toBe(
      new Date(PINNED_NOW).toISOString(),
    );

    const households = await db.select().from(schema.households);
    expect(households.map((h) => h.id)).toEqual([THEIRS]);
    // The membership moved with the household row, so nobody is in two.
    expect(await membersOf(DEV_OWNER)).toHaveLength(0);
  });

  it("is a no-op when you are already in that household", async () => {
    await seedInvite("mine", { householdId: DEV_OWNER });

    const res = await POST(req({ token: "mine" }));

    expect(res.status).toBe(204);
    // Nothing was spent and nothing was deleted: there was nothing to do.
    expect((await inviteRow("mine"))!.redeemedAt).toBeNull();
    expect(await db.select().from(schema.households)).toHaveLength(1);
  });

  it("only ever spends the invite once", async () => {
    await seedInvite("live");

    expect((await POST(req({ token: "live" }))).status).toBe(204);
    const second = await POST(req({ token: "live" }));

    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("invite_used");
    expect(await membersOf(THEIRS)).toHaveLength(2);
  });
});
