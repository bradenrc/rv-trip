import { afterEach, expect, it } from "vitest";
import { createApiKey, db, revokeApiKey, schema } from "@rv-trip/db";
import { DEV_OWNER } from "@rv-trip/db/testing";
import { principalOf, verifyMcpBearer } from "@/lib/mcp-auth";
import { describeDb } from "@/test/db";

const req = (auth?: string) =>
  new Request("http://test.local/api/mcp", { method: "POST", headers: auth ? { authorization: auth } : {} });

/** Flip `clerkEnabled()` on without touching Clerk: it only checks the env. */
function clerkOn() {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
  process.env.CLERK_SECRET_KEY = "sk_test_dummy";
}
afterEach(() => {
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
});

describeDb("mcp auth seam (#161 substrate)", () => {
  it("keyless: no bearer → the dev household, acting as dev-user", async () => {
    const info = await verifyMcpBearer(req(), undefined);
    expect(info?.clientId).toBe("keyless");
    expect(principalOf(info)).toEqual({ keyId: null, householdId: "dev-household", actor: "dev-user" });
  });

  it("requires a bearer when Clerk is on", async () => {
    clerkOn();
    expect(await verifyMcpBearer(req(), undefined)).toBeUndefined();
    expect(await verifyMcpBearer(req("Bearer rvk_" + "x".repeat(43)), "rvk_" + "x".repeat(43))).toBeUndefined();
  });

  it("resolves a live key to its household + minting member, and touches it", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const { key, row } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    const info = await verifyMcpBearer(req(`Bearer ${key}`), key);
    expect(info?.clientId).toBe(row.id);
    expect(principalOf(info)).toEqual({ keyId: row.id, householdId: DEV_OWNER, actor: "user_braden" });
    await new Promise((r) => setTimeout(r, 20)); // the touch is fire-and-forget
    const [after] = await db.select().from(schema.apiKeys);
    expect(after!.lastUsedAt).not.toBeNull();
  });

  it("rejects a revoked key", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const { key, row } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "u" });
    await revokeApiKey(row.id);
    expect(await verifyMcpBearer(req(`Bearer ${key}`), key)).toBeUndefined();
  });

  it("a key still works when Clerk is off (keyless mode is a fallback, not a lock-out)", async () => {
    await db.insert(schema.households).values({ id: "hh_other" }).onConflictDoNothing();
    const { key } = await createApiKey("hh_other", { name: "k", createdBy: "u2" });
    expect(principalOf(await verifyMcpBearer(req(`Bearer ${key}`), key)).householdId).toBe("hh_other");
  });

  it("principalOf throws on a missing AuthInfo (a wiring error, never a tenant guess)", () => {
    expect(() => principalOf(undefined)).toThrow(/no auth/);
  });
});
