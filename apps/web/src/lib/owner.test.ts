import { afterEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@rv-trip/db";
import { describeDb } from "@/test/db";

/**
 * The tenancy seam (#77 · docs/design/81 §2, plan item i2).
 *
 * `getOwner()` used to answer a PERSON (a Clerk user id) and that string went
 * into four `owner_id` columns. From #77 on it answers a HOUSEHOLD, and a new
 * `getActor()` answers the person — the split #78's change log needs, since
 * "who owns this" and "who just edited it" stopped being the same question.
 *
 * Two branches, and both are covered here rather than in the route suite
 * because only this file may hold a Clerk key:
 *
 *   keyless  — the constants, no database touched at all. Every other test
 *              file and every walk runs on this branch, which is why it must
 *              stay a pure return (apps/web/src/test/setup.ts:31).
 *   keyed    — `auth()` is stubbed, the ONE `vi.mock` in the suite. The
 *              route-handler tests' "zero mocks" rule (#30 Q3 = A) is about
 *              handlers; the auth seam itself cannot be exercised without a
 *              key, and a mock here is what keeps keys out of every other file.
 */

// Hoisted so the factory below can close over it — `vi.mock` is lifted above
// the imports, so a plain `const` declared here would still be in its TDZ.
const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(async (): Promise<{ userId: string | null }> => ({ userId: null })),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

// AFTER the mock, and dynamic: `clerkEnabled()` is read per call, but the
// module still has to evaluate with the stub in place.
const { DEV_HOUSEHOLD, DEV_OWNER, getActor, getOwner } = await import("@/lib/owner");

/** Turn Clerk ON for one test, as `clerkEnabled()` sees it (owner.ts:10). */
function signedInAs(userId: string | null): void {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_owner_spec");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_owner_spec");
  authMock.mockResolvedValue({ userId });
}

afterEach(() => {
  // Both matter: an unrestored key would make EVERY later file in this worker
  // take the Clerk branch, and the suite's whole premise is that it is
  // key-free.
  vi.unstubAllEnvs();
  authMock.mockReset();
  authMock.mockResolvedValue({ userId: null });
});

describe("keyless — the branch every other test and every walk runs on", () => {
  it("answers the dev HOUSEHOLD, not the dev user", async () => {
    expect(await getOwner()).toBe("dev-household");
    expect(await getOwner()).toBe(DEV_HOUSEHOLD);
    // The seed owns its rows by this id (packages/db/src/seed.ts) and
    // migration 0007 backfills dev-user's rows onto it.
    expect(DEV_HOUSEHOLD).not.toBe(DEV_OWNER);
  });

  it("answers the dev MEMBER from getActor()", async () => {
    expect(await getActor()).toBe("dev-user");
    expect(await getActor()).toBe(DEV_OWNER);
  });

  it("never asks Clerk anything", async () => {
    await getOwner();
    await getActor();
    expect(authMock).not.toHaveBeenCalled();
  });
});

describeDb("keyed — the household lookup", () => {
  it("resolves a seeded member to their household", async () => {
    await db.insert(schema.households).values({ id: "hh_callahan", name: "Callahan" });
    await db
      .insert(schema.householdMembers)
      .values({ householdId: "hh_callahan", userId: "user_jess", role: "member" });
    signedInAs("user_jess");

    expect(await getOwner()).toBe("hh_callahan");
    expect(await getActor()).toBe("user_jess"); // the person, unchanged
  });

  it("mints a 1-member household the first time it sees a user", async () => {
    signedInAs("user_new");

    const household = await getOwner();

    expect(household).toEqual(expect.any(String));
    expect(household).not.toBe(DEV_HOUSEHOLD);
    // No `where`: truncateAll runs before every test (src/test/setup.ts), so
    // whatever is in the table is what this call put there.
    const members = await db.select().from(schema.householdMembers);
    expect(members).toHaveLength(1);
    expect(members[0]!.householdId).toBe(household);
    expect(members[0]!.userId).toBe("user_new");
    expect(members[0]!.role).toBe("owner"); // their own household — they own it
  });

  it("is idempotent — a second call returns the SAME household, not a second one", async () => {
    signedInAs("user_new");

    const first = await getOwner();
    const second = await getOwner();

    expect(second).toBe(first);
    expect(await db.select().from(schema.households)).toHaveLength(1);
  });

  it("settles two concurrent first sights on ONE household, leaving no orphan", async () => {
    // getOwner() is called several times per request (api/places/[id] in both
    // PATCH and DELETE; trips/[id]/page.tsx and every mutation under it), and
    // React's per-request `cache` does not span two in-flight requests. So the
    // lazy create has to be safe when it genuinely runs twice at once.
    signedInAs("user_new");

    const [a, b] = await Promise.all([getOwner(), getOwner()]);

    expect(b).toBe(a);
    // Exactly one household row: the loser of the race unwinds the one it
    // minted rather than leaving an unreferenced household behind.
    expect(await db.select().from(schema.households)).toHaveLength(1);
    expect(await db.select().from(schema.householdMembers)).toHaveLength(1);
  });

  it("writes nothing on the keyless branch", async () => {
    expect(await getOwner()).toBe(DEV_HOUSEHOLD);

    // No key, no lookup, no lazy create — the dev household is a constant, and
    // that is what lets a walk run against a database it never migrated.
    expect(await db.select().from(schema.households)).toEqual([]);
    expect(await db.select().from(schema.householdMembers)).toEqual([]);
  });

  it("throws rather than guessing when Clerk is on and the session is missing", async () => {
    signedInAs(null);

    await expect(getOwner()).rejects.toThrow(/no session/);
    await expect(getActor()).rejects.toThrow(/no session/);
    expect(await db.select().from(schema.households)).toEqual([]);
  });
});
