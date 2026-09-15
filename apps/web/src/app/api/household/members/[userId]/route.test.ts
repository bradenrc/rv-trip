import { expect, it } from "vitest";
import { db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER } from "@rv-trip/db/testing";
import { DELETE } from "@/app/api/household/members/[userId]/route";
import { describeDb, req } from "@/test/db";

/**
 * `DELETE /api/household/members/<userId>` (#77 · plan item i3) — the "Remove"
 * button beside the co-pilot in the card's two-of-you state.
 *
 * Removing a member does NOT move any rows: the trips, the library and the rig
 * belong to the HOUSEHOLD (Q2 = A), so this only takes away the person's way
 * in. Which is exactly why the owner row must not be removable — a household
 * with no owner would still own every row and nobody could reach them.
 */
const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });

async function plantMember(userId: string, household: string, role: "owner" | "member") {
  await db.insert(schema.households).values({ id: household }).onConflictDoNothing();
  await db.insert(schema.householdMembers).values({ householdId: household, userId, role });
}

async function members() {
  return db.select().from(schema.householdMembers);
}

describeDb("DELETE /api/household/members/[userId]", () => {
  it("removes this household's co-pilot", async () => {
    await plantMember("user_braden", DEV_OWNER, "owner");
    await plantMember("user_jess", DEV_OWNER, "member");

    const res = await DELETE(req(undefined, "DELETE"), ctx("user_jess"));

    expect(res.status).toBe(204);
    expect((await members()).map((m) => m.userId)).toEqual(["user_braden"]);
  });

  it("refuses to remove the owner — the household would still own every row", async () => {
    await plantMember("user_braden", DEV_OWNER, "owner");

    const res = await DELETE(req(undefined, "DELETE"), ctx("user_braden"));

    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty("error");
    expect(await members()).toHaveLength(1);
  });

  it("404s on a member of another household, and leaves them in it", async () => {
    await plantMember("user_jess", OTHER_OWNER, "member");

    const res = await DELETE(req(undefined, "DELETE"), ctx("user_jess"));

    expect(res.status).toBe(404);
    expect(await members()).toHaveLength(1);
  });

  it("404s on somebody who is in no household at all", async () => {
    const res = await DELETE(req(undefined, "DELETE"), ctx("user_nobody"));
    expect(res.status).toBe(404);
  });

  it("404s on an empty id rather than deleting by a blank WHERE", async () => {
    await plantMember("user_braden", DEV_OWNER, "owner");
    await plantMember("user_jess", DEV_OWNER, "member");

    const res = await DELETE(req(undefined, "DELETE"), ctx(""));

    expect(res.status).toBe(404);
    expect(await members()).toHaveLength(2);
  });
});
