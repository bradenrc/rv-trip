# MCP Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/api/mcp` on the Next app — household API keys, the bearer auth seam, three proof-of-life tools over the existing mutations, per-key rate limiting, tool-call logging, and the client setup doc — so a Claude Code session can read and write a household's trips.

**Architecture:** Keys live in `packages/db` (table + hash/mint/verify/rate-limit functions, re-exported from `@rv-trip/db`) because both the CLI and the web app need them. The web app owns the auth seam (`lib/mcp-auth.ts` → an SDK `AuthInfo` whose `extra` carries `{ keyId, householdId, actor }`), the tool wrapper (`lib/mcp-tools.ts`: rate limit → run → log → map errors), the tool registrations (`lib/mcp-server.ts`), and the route (`app/api/mcp/route.ts`). Every tool calls the same `@rv-trip/db` query/mutation its REST route calls, with `owner = householdId` and `actor` from the key. Keyless (no Clerk keys in the process) resolves to `dev-household` / `dev-user`, so walks and CI run the endpoint with no key.

**Tech Stack:** `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0` (the zod-3 line; the handler is stateless per request and never touches Redis with `disableSse: true`), zod 3, drizzle, vitest (apps/web's DB-backed suite).

**Spec:** `docs/superpowers/specs/2026-10-10-mcp-substrate-design.md`

## Global Constraints

- Adapter pins: `mcp-handler@1.1.0`, `@modelcontextprotocol/sdk@1.26.0` (exact — 1.1.0's peer is `1.26.0`). Never `mcp-handler@2` (needs zod 4; the repo is on zod 3).
- Key format: `rvk_` + 43 chars base64url of 32 random bytes. Stored as sha256 hex only. `prefix` = first 12 chars of the full key.
- Rate limit: 60 tool calls per key per minute, counted in Postgres. Keyless mode is never limited.
- Logging: one JSON line per tool call `{ at, keyId, householdId, tool, ok, ms, error? }`. Never log tool arguments.
- Tool errors are returned as `{ isError: true, content: [{ type: "text", text }] }`, never thrown.
- Migration tag: `0007_api_keys` (migrations 0000–0006 exist). Generate with `pnpm db:generate`; CI's drift check requires the snapshot to be committed.
- `truncateAll` in `packages/db/src/testing/truncate.ts` must include the two new tables or the DB suite leaks rows between tests.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A revoked key: `revoked_at` set → verify returns `undefined` → 401 on the very next call, even mid-session. (Task 3 test "rejects a revoked key".)
2. A key from household A calling `get_trip` with household B's trip id → `isError` "trip not found", never B's data. (Task 4 test "scopes get_trip to the key's household".)
3. The 61st call in one minute → `isError` naming the retry window; the 60th succeeds. (Task 1 test "consumeApiKeyCall" + Task 4 test "rate limit".)
4. Clerk configured + no `Authorization` header → 401 with a `WWW-Authenticate` challenge (not a redirect to sign-in — the proxy must bypass `/api/mcp`). (Task 3 test "requires a bearer when Clerk is on".)
5. `add_idea` with a malformed `tripId` (not a uuid) → `isError` with zod's message, and nothing inserted. (Task 4 test "rejects a non-uuid tripId".)

---

### Task 1: `api_keys` + `api_key_calls` tables and the key module

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `householdInvites`)
- Create: `packages/db/src/api-keys.ts`
- Modify: `packages/db/src/index.ts` (add `export * from "./api-keys";`)
- Modify: `packages/db/src/testing/truncate.ts:41` (add the two tables)
- Create: `packages/db/drizzle/0007_api_keys.sql` + `meta/0007_snapshot.json` + journal entry (generated)
- Test: `apps/web/src/test/api-keys.test.ts`

**Interfaces:**
- Produces (all exported from `@rv-trip/db`):
  - `hashApiKey(key: string): string` — sha256 hex.
  - `mintApiKey(): string` — `rvk_` + 43 base64url chars.
  - `createApiKey(householdId: string, input: { name: string; createdBy: string }): Promise<{ key: string; row: ApiKeyRow }>` — inserts, returns the plaintext ONCE.
  - `findLiveApiKey(key: string): Promise<ApiKeyRow | null>` — by hash, `revoked_at IS NULL`.
  - `touchApiKey(id: string): Promise<void>` — sets `last_used_at = now()`.
  - `revokeApiKey(id: string): Promise<boolean>` — sets `revoked_at`; false when no such live key.
  - `listApiKeys(householdId: string): Promise<ApiKeyRow[]>`.
  - `consumeApiKeyCall(keyId: string, opts?: { limit?: number; now?: Date }): Promise<{ allowed: boolean; count: number; retryAfterSec: number }>` — increments this minute's bucket; `allowed = count <= limit` (default 60).
  - `ApiKeyRow` type = `typeof schema.apiKeys.$inferSelect`.
  - `API_KEY_RATE_LIMIT = 60`.

- [ ] **Step 1: Add the tables to the schema**

Append to `packages/db/src/schema.ts` (after `householdInvites`, before the relations block):

```ts
/**
 * MCP API keys (#161 substrate). One key = one household's tenant (`owner`)
 * plus the member who minted it (`created_by` = the `actor` on every write it
 * makes, so change_log reads "edited by Braden" for a key Braden minted). The
 * key itself is never stored: `key_hash` is sha256 of the full `rvk_…` string,
 * `prefix` its first 12 chars for display. `revoked_at` set = dead.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_household_idx").on(t.householdId)],
);

/**
 * Per-key, per-minute call counter for the MCP rate limit. Postgres rather
 * than function memory because Vercel functions do not share or keep state.
 * `bucket` is the minute (truncated) the calls fall in.
 */
export const apiKeyCalls = pgTable(
  "api_key_calls",
  {
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.bucket] })],
);
```

Check the imports at the top of `schema.ts` already include `uuid, text, timestamp, integer, index, uniqueIndex, primaryKey` (they do — `householdMembers` uses `primaryKey` and `uniqueIndex`, `trips` uses `index`).

- [ ] **Step 2: Generate the migration**

Run from the repo root:

```bash
pnpm db:generate -- --name api_keys
```

Expected: `packages/db/drizzle/0007_api_keys.sql` created with two `CREATE TABLE` statements, two indexes, and the FKs; `meta/0007_snapshot.json` and a new `_journal.json` entry. Open the SQL and confirm it contains `CREATE TABLE "api_keys"` and `CREATE TABLE "api_key_calls"`.

- [ ] **Step 3: Add the tables to `truncateAll`**

In `packages/db/src/testing/truncate.ts`, import `apiKeys, apiKeyCalls` from `../schema` alongside the others and extend the statement at line 41 so it reads:

```ts
    sql`truncate table ${trips}, ${chapters}, ${destinations}, ${ideas}, ${reservations}, ${saves}, ${tripDismissedSaves}, ${travelSegments}, ${areas}, ${rigs}, ${routes}, ${places}, ${userPrefs}, ${changeLog}, ${households}, ${householdMembers}, ${householdInvites}, ${apiKeys}, ${apiKeyCalls} restart identity cascade`,
```

- [ ] **Step 4: Write the failing tests**

Create `apps/web/src/test/api-keys.test.ts`:

```ts
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

/** The household row the FK needs. Fixtures never insert one (trips have no FK). */
async function household(id = DEV_OWNER) {
  await db.insert(schema.households).values({ id }).onConflictDoNothing();
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
    const hh = await household();
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
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/api-keys.test.ts`
Expected: FAIL — `@rv-trip/db` has no export `mintApiKey` (a module error, every test red).

- [ ] **Step 6: Write the key module**

Create `packages/db/src/api-keys.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index";
import { apiKeyCalls, apiKeys } from "./schema";

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

export async function createApiKey(
  householdId: string,
  input: { name: string; createdBy: string },
): Promise<{ key: string; row: ApiKeyRow }> {
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
 * The live row for a plaintext key, or null. Lookup is by hash (indexed); the
 * constant-time compare afterwards is belt and braces against a hash-prefix
 * oracle, not the primary defence.
 */
export async function findLiveApiKey(key: string): Promise<ApiKeyRow | null> {
  if (!key.startsWith(PREFIX)) return null;
  const hash = hashApiKey(key);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
  if (!row) return null;
  const a = Buffer.from(row.keyHash, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? row : null;
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
```

Add to `packages/db/src/index.ts` after `export * from "./places-cache";`:

```ts
export * from "./api-keys";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/api-keys.test.ts`
Expected: PASS, 5 tests. (The DB suite needs the docker Postgres up: `pnpm db:up`.)

- [ ] **Step 8: Typecheck + drift check**

Run: `pnpm turbo run typecheck --filter=@rv-trip/db --filter=@rv-trip/web` → `Tasks: 2 successful`.
Run: `pnpm db:generate` → `No schema changes, nothing to migrate` (proves the snapshot matches `schema.ts`; CI runs the same check).

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/api-keys.ts packages/db/src/index.ts packages/db/src/testing/truncate.ts packages/db/drizzle apps/web/src/test/api-keys.test.ts
git commit -m "db(161): api_keys + api_key_calls — mint/verify/revoke + per-minute counter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `pnpm mcp:key` — mint, list, revoke from the terminal

**Files:**
- Create: `packages/db/src/api-keys-cli.ts`
- Modify: `packages/db/package.json` (scripts: `"keys": "tsx src/api-keys-cli.ts"`)
- Modify: `package.json` (root scripts: `"mcp:key": "pnpm --filter @rv-trip/db keys"`)
- Modify: `README.md:38` (the "Other scripts" line)

**Interfaces:**
- Consumes: `createApiKey`, `listApiKeys`, `revokeApiKey` from Task 1.
- Produces: the CLI. `mint` prints the key once on stdout as the LAST line, so `pnpm mcp:key mint … | tail -1` captures it.

- [ ] **Step 1: Write the CLI**

Create `packages/db/src/api-keys-cli.ts`:

```ts
import "./load-env";
import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys";

/**
 * MCP API keys from the terminal (#161 substrate). The Settings card is #162's;
 * until it ships this is how a key is minted.
 *
 *   pnpm mcp:key mint --household <id> --by <clerkUserId> --name "Claude Code"
 *   pnpm mcp:key list --household <id>
 *   pnpm mcp:key revoke <keyId>
 *
 * `mint` prints the key ONCE, as the last line. It is not stored anywhere.
 * `--by` is the member the key acts as: every write through it is attributed
 * to that user in change_log, exactly like the app.
 */
const USAGE = `usage:
  pnpm mcp:key mint --household <id> --by <userId> --name "<label>"
  pnpm mcp:key list --household <id>
  pnpm mcp:key revoke <keyId>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "mint") {
    const householdId = flag(rest, "--household");
    const createdBy = flag(rest, "--by");
    const name = flag(rest, "--name") ?? "MCP key";
    if (!householdId || !createdBy) {
      console.error(USAGE);
      return 2;
    }
    const { key, row } = await createApiKey(householdId, { name, createdBy });
    console.error(`minted ${row.prefix}… (${row.id}) for household ${householdId}, acting as ${createdBy}`);
    console.error("the key is shown ONCE — store it in your MCP client config now:");
    console.log(key);
    return 0;
  }
  if (cmd === "list") {
    const householdId = flag(rest, "--household");
    if (!householdId) {
      console.error(USAGE);
      return 2;
    }
    const rows = await listApiKeys(householdId);
    if (rows.length === 0) console.log("(no keys)");
    for (const k of rows) {
      const state = k.revokedAt ? `revoked ${k.revokedAt.toISOString()}` : `last used ${k.lastUsedAt?.toISOString() ?? "never"}`;
      console.log(`${k.id}  ${k.prefix}…  ${k.name}  by ${k.createdBy}  ${state}`);
    }
    return 0;
  }
  if (cmd === "revoke") {
    const [id] = rest;
    if (!id) {
      console.error(USAGE);
      return 2;
    }
    const ok = await revokeApiKey(id);
    console.log(ok ? `revoked ${id}` : `no live key ${id}`);
    return ok ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
```

- [ ] **Step 2: Wire the scripts**

In `packages/db/package.json` add to `scripts` after `"reown"`: `"keys": "tsx src/api-keys-cli.ts",`.
In the root `package.json` add after `"db:reown"`: `"mcp:key": "pnpm --filter @rv-trip/db keys",`.
In `README.md` line 38, extend the "Other scripts" sentence with `` `pnpm mcp:key` (mint/list/revoke MCP API keys — see docs/mcp.md) ``.

- [ ] **Step 3: Exercise it against the local DB**

```bash
pnpm mcp:key mint --household dev-household --by dev-user --name "smoke" | tail -1
```
Expected: one line starting `rvk_`, 47 chars. (`dev-household` exists after `pnpm db:seed`.)

```bash
pnpm mcp:key list --household dev-household
```
Expected: one row, `last used never`.

```bash
pnpm mcp:key revoke <the id from list>
```
Expected: `revoked <id>`. Running it again prints `no live key` and exits 1.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/api-keys-cli.ts packages/db/package.json package.json README.md
git commit -m "db(161): pnpm mcp:key — mint / list / revoke MCP API keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: the auth seam + proxy bypass

**Files:**
- Create: `apps/web/src/lib/mcp-auth.ts`
- Modify: `apps/web/src/proxy.ts:14-22`
- Test: `apps/web/src/test/mcp-auth.test.ts`

**Interfaces:**
- Consumes: `findLiveApiKey`, `touchApiKey` (Task 1); `clerkEnabled`, `DEV_HOUSEHOLD`, `DEV_OWNER` from `@/lib/owner`.
- Produces:
  - `type McpPrincipal = { keyId: string | null; householdId: string; actor: string }` — `keyId === null` is keyless mode.
  - `verifyMcpBearer(req: Request, bearer?: string): Promise<AuthInfo | undefined>` — the `verifyToken` for `withMcpAuth`. `AuthInfo.extra` is an `McpPrincipal`; `clientId` is the key id or `"keyless"`.
  - `principalOf(authInfo: AuthInfo | undefined): McpPrincipal` — throws when missing (a wiring error, like `getActor`).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/test/mcp-auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/mcp-auth.test.ts`
Expected: FAIL — cannot resolve `@/lib/mcp-auth`.

- [ ] **Step 3: Write the seam**

Create `apps/web/src/lib/mcp-auth.ts`:

```ts
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { findLiveApiKey, touchApiKey } from "@rv-trip/db";
import { clerkEnabled, DEV_HOUSEHOLD, DEV_OWNER } from "@/lib/owner";

/**
 * Who an MCP request acts as (#161 substrate). The same two ids the REST
 * routes resolve through `getOwner()` / `getActor()`, carried on the SDK's
 * `AuthInfo.extra` so every tool reads them from its `extra.authInfo` instead
 * of a request-scoped Clerk session (there is none — the client is Claude
 * Code, not a browser).
 *
 *   keyId        null in keyless mode; otherwise the api_keys row id
 *   householdId  the tenant every query is scoped by (`owner`)
 *   actor        the member attributed in change_log — the key's minter
 */
export interface McpPrincipal {
  keyId: string | null;
  householdId: string;
  actor: string;
}

const KEYLESS_CLIENT = "keyless";

/**
 * The `verifyToken` for mcp-handler's `withMcpAuth`. Returning `undefined`
 * makes the wrapper answer 401 with a WWW-Authenticate challenge.
 *
 * Keyless (no Clerk keys in this process — walks, CI, a bare `pnpm dev`):
 * a request with no bearer is the dev household, the same switch the app
 * uses everywhere. A bearer is honoured in either mode; it is only REQUIRED
 * when Clerk is on.
 */
export async function verifyMcpBearer(_req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  if (bearer) {
    const row = await findLiveApiKey(bearer);
    if (!row) return undefined;
    void touchApiKey(row.id).catch(() => {}); // best-effort; never blocks the call
    const extra: McpPrincipal = { keyId: row.id, householdId: row.householdId, actor: row.createdBy };
    return { token: bearer, clientId: row.id, scopes: [], extra: { ...extra } };
  }
  if (clerkEnabled()) return undefined;
  const extra: McpPrincipal = { keyId: null, householdId: DEV_HOUSEHOLD, actor: DEV_OWNER };
  return { token: "", clientId: KEYLESS_CLIENT, scopes: [], extra: { ...extra } };
}

/** The principal a tool runs as. Missing = the route is mis-wired; throw, never guess a tenant. */
export function principalOf(authInfo: AuthInfo | undefined): McpPrincipal {
  const p = authInfo?.extra as McpPrincipal | undefined;
  if (!p || typeof p.householdId !== "string" || typeof p.actor !== "string") {
    throw new Error("mcp: no auth principal on the request — withMcpAuth must wrap the handler");
  }
  return { keyId: p.keyId ?? null, householdId: p.householdId, actor: p.actor };
}
```

Install the SDK types now so the import resolves (the route in Task 4 needs the same packages):

```bash
pnpm --filter @rv-trip/web add mcp-handler@1.1.0 @modelcontextprotocol/sdk@1.26.0
```

- [ ] **Step 4: Bypass the proxy for `/api/mcp`**

In `apps/web/src/proxy.ts` replace the `withClerk` definition and the `proxy` function with:

```ts
/** The MCP endpoint does its own bearer auth (`lib/mcp-auth.ts`); a `rvk_` key must never reach Clerk, which would 401 it. */
const isMcp = (req: NextRequest) => req.nextUrl.pathname === "/api/mcp";

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isMcp(req)) return;
  const { isAuthenticated } = await auth();
  if (isAuthenticated) return;
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await auth.protect(); // document request → redirect to sign-in
});

export default function proxy(req: NextRequest, event: Parameters<typeof withClerk>[1]) {
  return clerkEnabled() ? withClerk(req, event) : NextResponse.next();
}
```

Add `export { isMcp };` is NOT needed — keep it module-private.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/mcp-auth.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm turbo run lint typecheck --filter=@rv-trip/web` → both successful.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/mcp-auth.ts apps/web/src/proxy.ts apps/web/src/test/mcp-auth.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "web(161): MCP auth seam — rvk_ bearer → household + actor; keyless → dev household; proxy bypass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: the endpoint — tool wrapper, three tools, route, in-process test

**Files:**
- Create: `apps/web/src/lib/mcp-tools.ts` (wrapper: principal → rate limit → run → log → errors)
- Create: `apps/web/src/lib/mcp-server.ts` (registers `list_trips`, `get_trip`, `add_idea`)
- Create: `apps/web/src/app/api/mcp/route.ts`
- Test: `apps/web/src/test/mcp-endpoint.test.ts`

**Interfaces:**
- Consumes: `verifyMcpBearer`, `principalOf`, `McpPrincipal` (Task 3); `consumeApiKeyCall`, `API_KEY_RATE_LIMIT` (Task 1); `listTripsForOwner(owner)`, `getTripById(owner, tripId)`, `createIdea(owner, input, { actor, resolveArea })` from `@rv-trip/db`; `areaResolver()` from `@/lib/places`; `ideaCategory` from `@rv-trip/core`.
- Produces:
  - `defineTool(server, name, { title, description, inputSchema }, run: (args, p: McpPrincipal) => Promise<unknown>)` — registers a tool whose result is `JSON.stringify(result)` as one text block; errors → `isError`.
  - `registerTools(server: McpServer): void`.
  - Route exports `GET`, `POST`, `DELETE` (the handler answers 405 to GET/DELETE) and `maxDuration = 60`.

- [ ] **Step 1: Write the failing endpoint test**

Create `apps/web/src/test/mcp-endpoint.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { API_KEY_RATE_LIMIT, consumeApiKeyCall, createApiKey, db, schema } from "@rv-trip/db";
import { DEV_OWNER, OTHER_OWNER, fx } from "@rv-trip/db/testing";
import { POST } from "@/app/api/mcp/route";
import { describeDb } from "@/test/db";

/**
 * The endpoint through the REAL SDK client, in-process: the transport's
 * `fetch` is the route handler, so there is no server and no port.
 */
vi.mock("@/lib/places", () => ({
  areaResolver: () => async () => null,
  placesProvider: () => ({ configured: false, provider: null }),
}));

async function connect(bearer?: string) {
  const transport = new StreamableHTTPClientTransport(new URL("http://test.local/api/mcp"), {
    fetch: (url, init) => POST(new Request(url, init)),
    requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : undefined,
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

function clerkOn() {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_dummy";
  process.env.CLERK_SECRET_KEY = "sk_test_dummy";
}
afterEach(() => {
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
});

const text = (r: Awaited<ReturnType<Client["callTool"]>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("");
const json = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse(text(r));

describeDb("MCP endpoint (#161 substrate)", () => {
  it("keyless: lists the three tools and reads the dev household's trips", async () => {
    const { trip } = await fx.pacificNorthwestLoop();
    const client = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["add_idea", "get_trip", "list_trips"]);
    const list = json(await client.callTool({ name: "list_trips", arguments: {} }));
    expect(list.map((t: { id: string }) => t.id)).toEqual([trip.id]);
    const full = json(await client.callTool({ name: "get_trip", arguments: { tripId: trip.id } }));
    expect(full.title).toBe("Pacific Northwest Loop");
    expect(full.chapters.length).toBeGreaterThan(0);
  });

  it("requires a bearer when Clerk is on (401 challenge, not a redirect)", async () => {
    clerkOn();
    const res = await POST(
      new Request("http://test.local/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });

  it("scopes get_trip to the key's household", async () => {
    clerkOn();
    await db.insert(schema.households).values([{ id: DEV_OWNER }, { id: OTHER_OWNER }]).onConflictDoNothing();
    const mine = await fx.trip({ owner: DEV_OWNER, title: "Mine" });
    const theirs = await fx.trip({ owner: OTHER_OWNER, title: "Theirs" });
    const { key } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    const client = await connect(key);
    expect(json(await client.callTool({ name: "list_trips", arguments: {} })).map((t: { title: string }) => t.title)).toEqual(["Mine"]);
    expect(json(await client.callTool({ name: "get_trip", arguments: { tripId: mine.id } })).title).toBe("Mine");
    const other = await client.callTool({ name: "get_trip", arguments: { tripId: theirs.id } });
    expect(other.isError).toBe(true);
    expect(text(other)).toMatch(/trip not found/);
  });

  it("add_idea writes through createIdea: attributed to the key's minter, source link in the notes", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const trip = await fx.trip({ owner: DEV_OWNER });
    const { key } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "user_braden" });
    const client = await connect(key);
    const r = await client.callTool({
      name: "add_idea",
      arguments: { tripId: trip.id, title: "Drayton Harbor Oyster Co.", category: "eat", notes: "best oysters near Blaine", sourceUrl: "https://example.com/oysters" },
    });
    expect(r.isError).toBeFalsy();
    const { idea, replayed } = json(r);
    expect(replayed).toBe(false);
    expect(idea.title).toBe("Drayton Harbor Oyster Co.");
    expect(idea.notes).toBe("best oysters near Blaine\n\nSource: https://example.com/oysters");
    const [row] = await db.select().from(schema.ideas);
    expect(row!.tripId).toBe(trip.id);
    const log = await db.select().from(schema.changeLog);
    expect(log.length).toBeGreaterThan(0);
    expect(new Set(log.map((l) => l.memberId))).toEqual(new Set(["user_braden"]));
  });

  it("rejects a non-uuid tripId with zod's message and inserts nothing", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "add_idea", arguments: { tripId: "nope", title: "x", category: "do" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/uuid/i);
    expect(await db.select().from(schema.ideas)).toEqual([]);
  });

  it("rate limits a key at 60 calls per minute, and never limits keyless", async () => {
    clerkOn();
    await db.insert(schema.households).values({ id: DEV_OWNER }).onConflictDoNothing();
    const { key, row } = await createApiKey(DEV_OWNER, { name: "k", createdBy: "u" });
    for (let i = 0; i < API_KEY_RATE_LIMIT; i++) await consumeApiKeyCall(row.id); // pre-fill this minute
    const client = await connect(key);
    const r = await client.callTool({ name: "list_trips", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/rate limit.*retry in \d+s/i);
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    const keyless = await connect();
    for (let i = 0; i < 3; i++) expect((await keyless.callTool({ name: "list_trips", arguments: {} })).isError).toBeFalsy();
  });

  it("logs one JSON line per tool call without the arguments", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => void lines.push(String(s)));
    try {
      const client = await connect();
      await client.callTool({ name: "add_idea", arguments: { tripId: "nope", title: "SECRET-TITLE", category: "do" } });
    } finally {
      spy.mockRestore();
    }
    const entries = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    const call = entries.find((e) => e.tool === "add_idea");
    expect(call).toMatchObject({ keyId: null, householdId: "dev-household", ok: false });
    expect(typeof call.ms).toBe("number");
    expect(JSON.stringify(call)).not.toContain("SECRET-TITLE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/mcp-endpoint.test.ts`
Expected: FAIL — cannot resolve `@/app/api/mcp/route`.

- [ ] **Step 3: Write the tool wrapper**

Create `apps/web/src/lib/mcp-tools.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { ZodError } from "zod";
import { API_KEY_RATE_LIMIT, consumeApiKeyCall } from "@rv-trip/db";
import { principalOf, type McpPrincipal } from "@/lib/mcp-auth";

/**
 * One wrapper every MCP tool goes through (#161 substrate): resolve the
 * principal, charge the rate limit, run, log one line, and turn every failure
 * into an `isError` result the model can read — never a thrown 500.
 *
 * Results are JSON text: one `text` content block holding `JSON.stringify`.
 * Arguments are NOT logged — notes and URLs can be things the user considers
 * private; the log says who called what, whether it worked, and how long.
 */
type ToolRun<Shape extends ZodRawShape> = (
  args: { [K in keyof Shape]: Shape[K]["_output"] },
  principal: McpPrincipal,
) => Promise<unknown>;

export function defineTool<Shape extends ZodRawShape>(
  server: McpServer,
  name: string,
  meta: { title: string; description: string; inputSchema: Shape },
  run: ToolRun<Shape>,
): void {
  server.registerTool(name, meta, async (args, extra) => {
    const started = Date.now();
    const principal = principalOf(extra.authInfo);
    const base = { at: new Date().toISOString(), keyId: principal.keyId, householdId: principal.householdId, tool: name };
    try {
      if (principal.keyId) {
        const gate = await consumeApiKeyCall(principal.keyId);
        if (!gate.allowed) {
          const error = `rate limit: ${API_KEY_RATE_LIMIT} calls per minute per key — retry in ${gate.retryAfterSec}s`;
          console.log(JSON.stringify({ ...base, ok: false, ms: Date.now() - started, error }));
          return { isError: true, content: [{ type: "text", text: error }] };
        }
      }
      const result = await run(args as Parameters<ToolRun<Shape>>[0], principal);
      console.log(JSON.stringify({ ...base, ok: true, ms: Date.now() - started }));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (e) {
      const error = e instanceof ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e);
      console.log(JSON.stringify({ ...base, ok: false, ms: Date.now() - started, error }));
      return { isError: true, content: [{ type: "text", text: error }] };
    }
  });
}
```

- [ ] **Step 4: Write the three tools**

Create `apps/web/src/lib/mcp-server.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ideaCategory } from "@rv-trip/core";
import { createIdea, getTripById, listTripsForOwner } from "@rv-trip/db";
import { defineTool } from "@/lib/mcp-tools";
import { areaResolver } from "@/lib/places";

/**
 * The proof-of-life tool set (#161 substrate): a read, a deep read, a write.
 * Each calls the SAME query/mutation its REST route calls, with `owner` and
 * `actor` from the key — so household scoping, validation, idempotent replay
 * and change_log attribution are the app's, not a second copy. The rest of
 * the grammar (`get_context`, `create_trip`, `add_save`, …) is #162's.
 */
export function registerTools(server: McpServer): void {
  defineTool(
    server,
    "list_trips",
    {
      title: "List trips",
      description: "Every trip in this household: id, title, dates, status, home base, counts. Call this first to find a trip id.",
      inputSchema: {},
    },
    async (_args, p) => listTripsForOwner(p.householdId),
  );

  defineTool(
    server,
    "get_trip",
    {
      title: "Get a trip",
      description: "The full trip: chapters → destinations (with their ideas and reservations), travel segments, dates, rig/mode defaults.",
      inputSchema: { tripId: z.string().uuid() },
    },
    async ({ tripId }, p) => {
      const trip = await getTripById(p.householdId, tripId);
      if (!trip) throw new Error("trip not found");
      return trip;
    },
  );

  defineTool(
    server,
    "add_idea",
    {
      title: "Add an idea",
      description:
        "Add an idea (something to do, eat, or stay at) to a trip, optionally under one of its destinations. Notes and a source link are kept with it. Re-running with the same clientId returns the existing idea instead of a duplicate.",
      inputSchema: {
        tripId: z.string().uuid(),
        destinationId: z.string().uuid().nullable().default(null),
        title: z.string().min(1).max(200),
        category: ideaCategory,
        notes: z.string().max(4000).optional(),
        sourceUrl: z.string().url().optional(),
        clientId: z.string().min(1).max(64).optional(),
      },
    },
    async ({ tripId, destinationId, title, category, notes, sourceUrl, clientId }, p) => {
      const body = [notes?.trim() || null, sourceUrl ? `Source: ${sourceUrl}` : null].filter(Boolean).join("\n\n") || null;
      return createIdea(
        p.householdId,
        { tripId, destinationId, title, category, status: "idea", place: null, rating: null, notes: body, clientId },
        { actor: p.actor, resolveArea: areaResolver() },
      );
    },
  );
}
```

- [ ] **Step 5: Write the route**

Create `apps/web/src/app/api/mcp/route.ts`:

```ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyMcpBearer } from "@/lib/mcp-auth";
import { registerTools } from "@/lib/mcp-server";

/**
 * The MCP endpoint (#161 substrate): streamable HTTP at POST /api/mcp,
 * stateless per request (the adapter builds a fresh McpServer each call, so a
 * Vercel function needs no session store), SSE off (so no Redis).
 *
 * Auth: `withMcpAuth` reads the bearer and answers 401 + WWW-Authenticate
 * when `verifyMcpBearer` returns nothing. `required: true` is what makes a
 * missing key a 401 when Clerk is on; keyless mode still passes because the
 * verifier returns the dev principal for a bare request.
 *
 * The proxy (`src/proxy.ts`) skips this path, so a `rvk_` bearer never meets
 * Clerk's middleware.
 */
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "tripcaddie", version: "0.1.0" } },
  { basePath: "/api", disableSse: true, maxDuration },
);

const authed = withMcpAuth(handler, verifyMcpBearer, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
```

- [ ] **Step 6: Run the endpoint test to verify it passes**

Run: `pnpm --filter @rv-trip/web exec vitest run src/test/mcp-endpoint.test.ts`
Expected: PASS, 7 tests. If the client transport rejects the in-process response, check two things first: the request `accept` header must include both `application/json` and `text/event-stream` (the SDK client sets it; the hand-built 401 test sets it explicitly), and the route must receive a `Request` whose `url` pathname is exactly `/api/mcp` (the handler compares `url.pathname` to `basePath + "/mcp"`).

- [ ] **Step 7: Run the whole web suite + lint + typecheck**

Run: `pnpm turbo run lint typecheck test --filter=@rv-trip/web --force`
Expected: all green; the pre-existing route suite is unaffected (the proxy change only adds a path check).

- [ ] **Step 8: Smoke it against the real dev server**

With `pnpm db:up && pnpm db:seed` done and `pnpm dev` running (keyless):

```bash
curl -s http://localhost:3000/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```
Expected: a JSON-RPC result listing `list_trips`, `get_trip`, `add_idea` (possibly as an SSE `data:` line — both are valid).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/mcp-tools.ts apps/web/src/lib/mcp-server.ts apps/web/src/app/api/mcp/route.ts apps/web/src/test/mcp-endpoint.test.ts
git commit -m "web(161): /api/mcp — list_trips, get_trip, add_idea over the app's own mutations; rate limit + call log

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: client onboarding doc + production smoke

**Files:**
- Create: `docs/mcp.md`
- Modify: `README.md` (one line in "Local-dev accommodations" pointing at it)

**Interfaces:**
- Consumes: the endpoint URL `https://roadvalet.com/api/mcp`, the `pnpm mcp:key` CLI.

- [ ] **Step 1: Write the doc**

Create `docs/mcp.md`:

````markdown
# TripCaddie MCP — connect an AI session to your household

The app's trip grammar as MCP tools at `https://roadvalet.com/api/mcp`
(streamable HTTP). An AI session pulls your trips, researches, and pushes
ideas back through the same owner-scoped mutations the app uses — every
write is validated, household-scoped, and attributed in History to the
member whose key made it.

## 1. Mint a key

Keys are per household; the member who mints one is the `actor` on every
write it makes. Until the Settings card ships (#162), mint from a checkout
with production's `DATABASE_URL` in the environment:

```bash
pnpm mcp:key mint --household <householdId> --by <yourClerkUserId> --name "Claude Code"
```

The last line is the key (`rvk_…`). It is shown once. `pnpm mcp:key list
--household <id>` and `pnpm mcp:key revoke <keyId>` manage it; a revoked
key fails on its next call.

## 2. Connect a client

**Claude Code** — `.mcp.json` in any project (or `~/.claude.json` for all):

```json
{
  "mcpServers": {
    "tripcaddie": {
      "type": "http",
      "url": "https://roadvalet.com/api/mcp",
      "headers": { "Authorization": "Bearer rvk_…" }
    }
  }
}
```

**Claude API** — the MCP connector in a Messages request:

```json
"mcp_servers": [
  { "type": "url", "url": "https://roadvalet.com/api/mcp", "name": "tripcaddie", "authorization_token": "rvk_…" }
]
```

**claude.ai custom connector** — Settings → Connectors → Add custom
connector → URL `https://roadvalet.com/api/mcp`; where the dialog offers an
OAuth client id/secret, leave them blank and paste the key as a bearer if
the field is offered. If your plan's connector dialog only accepts OAuth,
that is #164.

**ChatGPT** — waits for OAuth (#164).

## 3. Smoke test

In the connected session:

> What trips do I have?

→ the household's trips with ids.

> Add an idea to <trip title>: eat at Drayton Harbor Oyster Co., note "best
> oysters near Blaine", source https://example.com/oysters

→ the idea appears on the trip in the app within seconds; History shows it
under your name.

## Tools (v1)

| tool | does |
|---|---|
| `list_trips` | every trip in the household — call first to get ids |
| `get_trip { tripId }` | the full trip tree |
| `add_idea { tripId, destinationId?, title, category: do\|eat\|stay, notes?, sourceUrl?, clientId? }` | adds an idea; same `clientId` twice returns the existing one |

Limits: 60 tool calls per key per minute. Errors come back as tool results
the model can read, never as HTTP 500s.

## Local / walks

With no Clerk keys in the process the endpoint needs no bearer and acts as
the seeded `dev-household`: `curl -s localhost:3000/api/mcp -H
'content-type: application/json' -H 'accept: application/json,
text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.
````

- [ ] **Step 2: Link it from the README**

In `README.md`'s "Local-dev accommodations" list add a bullet:

```markdown
- **MCP:** `/api/mcp` exposes the trip grammar as tools for an AI session;
  keyless locally, `rvk_` keys in production — see `docs/mcp.md`.
```

- [ ] **Step 3: Full pipeline check, then commit**

Run: `pnpm turbo run lint typecheck test --force` → every task green.

```bash
git add docs/mcp.md README.md
git commit -m "docs(161): docs/mcp.md — keys, Claude Code / Claude API / claude.ai setup, smoke test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: PR + production smoke (after merge)**

Open the PR against `main` (title `feat(161): MCP substrate — api keys, auth seam, /api/mcp, ops`). Once merged and deployed, mint a production key (`vercel env pull` for the URL, as the reset procedure did), put it in a local `.mcp.json`, and run the two smoke prompts from `docs/mcp.md` from a Claude Code session. Confirm the idea shows on the trip on roadvalet.com. (History attribution of creates is #162's: the app logs field changes only — see the ledger's Task 4 ruling.)
