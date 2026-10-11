import { expect, it } from "vitest";
import {
  API_KEY_RATE_LIMIT,
  consumeApiKeyCall,
  createApiKey,
  db,
  findLiveApiKey,
  hashApiKey,
  listApiKeys,
  mintApiKey,
  revokeApiKey,
  schema,
  touchApiKey,
} from "@rv-trip/db";
import { DEV_OWNER } from "@rv-trip/db/testing";
import { describeDb } from "@/test/db";

/** A household with `userId` as a member — a key can only be minted BY a member. */
async function household(id = DEV_OWNER, userId = "u") {
  await db.insert(schema.households).values({ id }).onConflictDoNothing();
  await db.insert(schema.householdMembers).values({ householdId: id, userId, role: "owner" }).onConflictDoNothing();
  return id;
}

describeDb("api keys (#161 substrate)", () => {
  it("mints rvk_ keys of the documented shape and hashes them stably", () => {
    const key = mintApiKey();
    expect(key).toMatch(/^rvk_[A-Za-z0-9_-]{43}$/);
    expect(mintApiKey()).not.toBe(key);
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("creates a key, returns the plaintext once, stores only the hash + prefix", async () => {
    const hh = await household(DEV_OWNER, "user_braden");
    const { key, row } = await createApiKey(hh, { name: "Claude Code", createdBy: "user_braden" });
    expect(row.keyHash).toBe(hashApiKey(key));
    expect(row.prefix).toBe(key.slice(0, 12));
    expect(row.createdBy).toBe("user_braden");
    expect(row.revokedAt).toBeNull();
    const [stored] = await db.select().from(schema.apiKeys);
    expect(JSON.stringify(stored)).not.toContain(key);
  });

  it("finds a live key by plaintext and touches last_used_at", async () => {
    const hh = await household();
    const { key, row } = await createApiKey(hh, { name: "k", createdBy: "u" });
    const found = await findLiveApiKey(key);
    expect(found?.id).toBe(row.id);
    expect(found?.householdId).toBe(hh);
    expect(await findLiveApiKey("rvk_" + "x".repeat(43))).toBeNull();
    await touchApiKey(row.id);
    const [after] = await db.select().from(schema.apiKeys);
    expect(after!.lastUsedAt).not.toBeNull();
  });

  it("revokes: a revoked key is no longer found, and revoking twice reports false", async () => {
    const hh = await household();
    const { key, row } = await createApiKey(hh, { name: "k", createdBy: "u" });
    expect(await revokeApiKey(row.id)).toBe(true);
    expect(await findLiveApiKey(key)).toBeNull();
    expect(await revokeApiKey(row.id)).toBe(false);
    expect((await listApiKeys(hh)).map((k) => k.revokedAt !== null)).toEqual([true]);
  });

  it("consumeApiKeyCall allows the 60th call in a minute and refuses the 61st", async () => {
    const hh = await household();
    const { row } = await createApiKey(hh, { name: "k", createdBy: "u" });
    const now = new Date("2026-08-15T12:00:30Z");
    let last = { allowed: true, count: 0, retryAfterSec: 0 };
    for (let i = 0; i < API_KEY_RATE_LIMIT; i++) last = await consumeApiKeyCall(row.id, { now });
    expect(last).toMatchObject({ allowed: true, count: 60 });
    const over = await consumeApiKeyCall(row.id, { now });
    expect(over.allowed).toBe(false);
    expect(over.count).toBe(61);
    expect(over.retryAfterSec).toBe(30); // 12:00:30 → the next minute starts in 30s
    // A new minute is a fresh bucket.
    const next = await consumeApiKeyCall(row.id, { now: new Date("2026-08-15T12:01:00Z") });
    expect(next).toMatchObject({ allowed: true, count: 1 });
  });

  it("refuses to mint for someone who is not a member of the household", async () => {
    const hh = await household();
    await expect(createApiKey(hh, { name: "k", createdBy: "stranger" })).rejects.toThrow(/not a member/);
    expect(await listApiKeys(hh)).toEqual([]);
  });

  it("a key whose minter has left the household is no longer live", async () => {
    const hh = await household(DEV_OWNER, "user_braden");
    const { key } = await createApiKey(hh, { name: "k", createdBy: "user_braden" });
    expect(await findLiveApiKey(key)).not.toBeNull();
    await db.delete(schema.householdMembers); // the only member in this test
    expect(await findLiveApiKey(key)).toBeNull();
  });
});
