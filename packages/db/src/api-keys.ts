import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { apiKeyCalls, apiKeys, householdMembers } from "./schema";

/**
 * MCP API keys (#161 substrate): mint, verify, revoke, and the per-minute
 * rate-limit counter. The web app's auth seam (`apps/web/src/lib/mcp-auth.ts`)
 * and the `pnpm mcp:key` CLI are the two callers.
 */

export type ApiKeyRow = typeof apiKeys.$inferSelect;

/** Tool calls per key per minute. */
export const API_KEY_RATE_LIMIT = 60;

const PREFIX = "rvk_";
const PREFIX_DISPLAY_LEN = 12;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** `rvk_` + 32 random bytes as base64url (43 chars, no padding). */
export function mintApiKey(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

async function isMember(householdId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  return Boolean(m);
}

/**
 * Mint a key for `householdId` acting as `createdBy`, who must be a current
 * member: a key is that member's standing, and `findLiveApiKey` keeps
 * re-checking the membership, so leaving the household ends the key.
 */
export async function createApiKey(
  householdId: string,
  input: { name: string; createdBy: string },
): Promise<{ key: string; row: ApiKeyRow }> {
  if (!(await isMember(householdId, input.createdBy))) {
    throw new Error(`createApiKey: ${input.createdBy} is not a member of household ${householdId}`);
  }
  const key = mintApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      householdId,
      name: input.name,
      keyHash: hashApiKey(key),
      prefix: key.slice(0, PREFIX_DISPLAY_LEN),
      createdBy: input.createdBy,
    })
    .returning();
  return { key, row: row! };
}

/**
 * The live row for a plaintext key, or null. "Live" = not revoked AND its
 * minter is still a member of the household — removing a co-pilot ends the
 * access their keys carried, without anyone having to find and revoke them.
 *
 * Lookup is by sha256 (unique index). No constant-time compare: the row is
 * selected BY the hash, so there is nothing left to compare, and the 256-bit
 * key space makes a timing oracle on the index lookup useless.
 */
export async function findLiveApiKey(key: string): Promise<ApiKeyRow | null> {
  if (!key.startsWith(PREFIX)) return null;
  const [hit] = await db
    .select({ row: apiKeys })
    .from(apiKeys)
    .innerJoin(
      householdMembers,
      and(eq(householdMembers.householdId, apiKeys.householdId), eq(householdMembers.userId, apiKeys.createdBy)),
    )
    .where(and(eq(apiKeys.keyHash, hashApiKey(key)), isNull(apiKeys.revokedAt)));
  return hit?.row ?? null;
}

export async function touchApiKey(id: string): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

/** True when a live key was revoked by this call; false when none was. */
export async function revokeApiKey(id: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

export async function listApiKeys(householdId: string): Promise<ApiKeyRow[]> {
  return db.select().from(apiKeys).where(eq(apiKeys.householdId, householdId)).orderBy(desc(apiKeys.createdAt));
}

function minuteBucket(now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  return d;
}

/**
 * Count one call against this minute's bucket and say whether it was within
 * the limit. One upsert: the insert and the increment race safely because the
 * primary key is (key, bucket). Buckets older than two minutes for this key are
 * swept on the way through, so the table never grows past a few rows per key.
 */
export async function consumeApiKeyCall(
  keyId: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<{ allowed: boolean; count: number; retryAfterSec: number }> {
  const limit = opts.limit ?? API_KEY_RATE_LIMIT;
  const now = opts.now ?? new Date();
  const bucket = minuteBucket(now);
  const [row] = await db
    .insert(apiKeyCalls)
    .values({ keyId, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [apiKeyCalls.keyId, apiKeyCalls.bucket],
      set: { count: sql`${apiKeyCalls.count} + 1` },
    })
    .returning({ count: apiKeyCalls.count });
  const count = row!.count;
  const sweepBefore = new Date(bucket.getTime() - 2 * 60_000);
  await db
    .delete(apiKeyCalls)
    .where(and(eq(apiKeyCalls.keyId, keyId), sql`${apiKeyCalls.bucket} < ${sweepBefore}`));
  const retryAfterSec = Math.ceil((bucket.getTime() + 60_000 - now.getTime()) / 1000);
  return { allowed: count <= limit, count, retryAfterSec };
}
