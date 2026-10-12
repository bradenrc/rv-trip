import { expect, it } from "vitest";
import { createApiKey, db, findLiveApiKey, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER } from "@rv-trip/db/testing";
import { POST } from "@/app/api/household/keys/route";
import { DELETE } from "@/app/api/household/keys/[id]/route";
import { ctx, describeDb, req } from "@/test/db";
import { household } from "@/test/mcp";

/**
 * Settings → API keys (#162 · Q8 A): mint once, revoke with proof of
 * ownership. Keyless, `getOwner()` is the dev household and `getActor()` the
 * seeded `dev-user` — a member, as the seed makes it.
 */
describeDb("POST /api/household/keys", () => {
  it("mints a live key for this household, as the actor, and answers no hash", async () => {
    await household(DEV_OWNER, "dev-user");
    const res = await POST(req({ name: "  Claude Code · laptop " }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["id", "key", "name", "prefix"]);
    expect(body).toMatchObject({ name: "Claude Code · laptop", prefix: body.key.slice(0, 12) });
    const live = await findLiveApiKey(body.key);
    expect(live).toMatchObject({ id: body.id, householdId: DEV_OWNER, createdBy: "dev-user" });
    expect(JSON.stringify(body)).not.toContain(live!.keyHash);
  });

  it("refuses a blank name (Mint is disabled while it is empty)", async () => {
    await household(DEV_OWNER, "dev-user");
    expect((await POST(req({ name: "   " }))).status).toBe(400);
    expect(await db.select().from(schema.apiKeys)).toEqual([]);
  });

  it("refuses an actor who is not a member", async () => {
    expect((await POST(req({ name: "k" }))).status).toBe(403);
  });
});

describeDb("DELETE /api/household/keys/:id", () => {
  it("revokes this household's key — its next lookup fails", async () => {
    await household(DEV_OWNER, "user_jess");
    const { key, row } = await createApiKey(DEV_OWNER, { name: "Claude API · research script", createdBy: "user_jess" });
    const res = await DELETE(req(undefined, "DELETE"), ctx(row.id));
    expect(res.status).toBe(204);
    expect(await findLiveApiKey(key)).toBeNull();
    // Already dead: still 204, still dead.
    expect((await DELETE(req(undefined, "DELETE"), ctx(row.id))).status).toBe(204);
  });

  it("404s another household's key and leaves it live", async () => {
    await household(OTHER_OWNER, "user_other");
    const { key, row } = await createApiKey(OTHER_OWNER, { name: "theirs", createdBy: "user_other" });
    expect((await DELETE(req(undefined, "DELETE"), ctx(row.id))).status).toBe(404);
    expect(await findLiveApiKey(key)).not.toBeNull();
    expect((await DELETE(req(undefined, "DELETE"), ctx("nope"))).status).toBe(404);
  });
});
