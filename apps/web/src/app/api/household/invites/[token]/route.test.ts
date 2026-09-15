import { expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER } from "@rv-trip/db/testing";
import { DELETE } from "@/app/api/household/invites/[token]/route";
import { describeDb, req } from "@/test/db";

/**
 * `DELETE /api/household/invites/<token>` (#77 · plan item i3) — "Cancel
 * invite", the second row of the card's invite-out state.
 *
 * The one thing a fake could not check: that the WHERE really carries the
 * household, so a token someone else pasted cannot be revoked by whoever
 * happens to hold the URL.
 */
const DAY_MS = 86_400_000;
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

async function plantInvite(token: string, household: string, redeemed = false) {
  await db.insert(schema.households).values({ id: household }).onConflictDoNothing();
  await db.insert(schema.householdInvites).values({
    token,
    householdId: household,
    expiresAt: new Date(Date.now() + 14 * DAY_MS),
    ...(redeemed ? { redeemedAt: new Date() } : {}),
  });
}

async function invite(token: string) {
  const rows = await db.select().from(schema.householdInvites);
  return rows.find((r) => r.token === token) ?? null;
}

describeDb("DELETE /api/household/invites/[token]", () => {
  it("revokes this household's live invite", async () => {
    await plantInvite("ours", DEV_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx("ours"));

    expect(res.status).toBe(204);
    expect(await invite("ours")).toBeNull();
  });

  it("404s on another household's token, and leaves the row alone", async () => {
    await plantInvite("theirs", OTHER_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx("theirs"));

    expect(res.status).toBe(404);
    expect(await invite("theirs")).not.toBeNull(); // the WHERE carries the household
  });

  it("404s on a token that never existed", async () => {
    const res = await DELETE(req(undefined, "DELETE"), ctx("no-such-token"));
    expect(res.status).toBe(404);
  });

  it("refuses to erase an invite that was already redeemed", async () => {
    // Cancelling is for a link still in flight. A redeemed row is how the
    // household knows the seat was taken (and what /join's "one use" reads).
    await plantInvite("used", DEV_OWNER, true);

    const res = await DELETE(req(undefined, "DELETE"), ctx("used"));

    expect(res.status).toBe(404);
    expect(await invite("used")).not.toBeNull();
  });

  it("404s on an empty token rather than deleting by a blank WHERE", async () => {
    await plantInvite("ours", DEV_OWNER);

    const res = await DELETE(req(undefined, "DELETE"), ctx(""));

    expect(res.status).toBe(404);
    expect(await invite("ours")).not.toBeNull();
  });
});
