# MCP substrate — API keys, auth seam, endpoint, ops (epic #161)

**Status:** draft for Braden's review · **Owner:** devops persona · **Date:** 2026-10-10

## Why this slice

Epic #161 orders its children 162 → 163 → 164, and #163 is "the devops half".
But #163 hardens an endpoint that only exists once #162 ships, and #162 mixes
plumbing (auth, transport) with product surface (ten tools, a Settings card).
This spec cuts by **layer** instead: devops builds the substrate — keys, the
auth seam, the endpoint with a proof-of-life tool set, and the ops around it —
so the pipeline's #162 shrinks to the tool surface and the Settings UI, and
#163's hardening lands with the endpoint rather than after it.

Out of scope here: `get_context`'s shape and the other seven grammar tools
(#162, mock stage decides), the Settings card for keys (#162), OAuth and
per-member identity via tokens (#164), an `mcp.roadvalet.com` subdomain
(the path under the main domain works; a second domain adds CORS + DNS for
nothing yet).

## What ships

### 1. API keys (`api_keys` table, migration `0007_api_keys`)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `household_id` | text → households.id, cascade | the key's tenant = `owner` |
| `name` | text | "Claude Code on the Mac" — shown in the app later |
| `key_hash` | text, unique | sha256 of the full key; the key is never stored |
| `prefix` | text | first 12 chars of the key (`rvk_a1b2c3d4`) for display |
| `created_by` | text | the member who minted it = the `actor` for every write |
| `created_at`, `last_used_at`, `revoked_at` | timestamptz | `revoked_at` set = dead |

Key format: `rvk_` + 32 bytes base64url (43 chars). Shown once at mint.
Lookup is by hash, so a leaked DB row is not a leaked key.

Minting and revoking are a script for now — `pnpm mcp:key` — because the
Settings card is a design decision for the pipeline:

```
pnpm mcp:key mint --household <id> --by <userId> --name "Claude Code"   # prints the key ONCE
pnpm mcp:key list --household <id>
pnpm mcp:key revoke <keyId>
```

### 2. Auth seam (`apps/web/src/lib/mcp-auth.ts`)

`resolveApiKey(authorizationHeader) → { keyId, householdId, actor } | null`:
constant-time compare of the sha256, rejects revoked, stamps `last_used_at`
(fire-and-forget). The MCP endpoint is the ONLY consumer in v1; the REST
routes keep Clerk-only. The proxy lets `/api/mcp` through so a bearer `rvk_`
key never reaches `clerkMiddleware` (which would 401 it); the endpoint does
its own 401.

**Keyless mode** (no Clerk keys in the process, i.e. walks + CI + local
default): the endpoint accepts requests with no bearer and resolves to
`DEV_HOUSEHOLD` / `DEV_OWNER`, exactly like `getOwner()`/`getActor()` do
today. With Clerk keys set, a bearer is required. This is the same switch the
app already has; no new flag.

### 3. Endpoint (`apps/web/src/app/api/mcp/route.ts`)

`mcp-handler@1.x` (the zod-3 line; 2.x requires zod 4 and this repo is on 3)
over `@modelcontextprotocol/sdk@1.x`, streamable HTTP only (`disableSse`),
no Redis. Tool input schemas reuse `@rv-trip/core`'s zod input schemas.

Proof-of-life tools — enough to prove reads, a write, validation, attribution
and change_log from a real Claude Code session:

| tool | calls | returns |
|---|---|---|
| `list_trips` | `listTripsForOwner(owner)` | `TripSummary[]` |
| `get_trip` `{ tripId }` | `getTripById(owner, tripId)` | the full `Trip` tree (chapters → destinations → ideas/reservations, segments) |
| `add_idea` `{ tripId, destinationId?, title, category, notes?, sourceUrl? }` | `createIdea(owner, input, { actor, resolveArea })` — the same call `POST /api/ideas` makes | the created idea + `replayed` |

Every write goes through the existing mutation, so household scoping,
validation, idempotent replay and `change_log` attribution come for free. The
`actor` is the key's `created_by`, so the app shows "edited by Braden" for a
key Braden minted. Tool errors return MCP `isError` content with the
mutation's message — never a thrown 500.

### 4. Ops

- **Rate limit:** per key, 60 tool calls per minute, enforced in Postgres
  (`api_key_calls` — key id, minute bucket, count; upsert + check in one
  statement) because Vercel function memory does not persist. Over the limit
  → a tool-level error naming the retry window. Keyless mode is unlimited.
- **Logging:** one JSON line per tool call to stdout → Vercel runtime logs:
  `{ at, keyId, householdId, tool, ok, ms, error? }`. Arguments are NOT
  logged (they can carry notes and URLs the user considers private).
- **Vercel:** `export const maxDuration = 60` as route segment config in the
  route file (Next's supported form for app-router handlers; a `functions`
  pattern in `vercel.json` errors when it matches no file) — Hobby cap.
- **Docs:** `docs/mcp.md` — exact setup for Claude Code (`.mcp.json` with an
  `Authorization` header), the Claude API `mcp_servers` block, a claude.ai
  custom connector, plus one smoke-test prompt per client. ChatGPT waits for
  #164.
- **CI:** the endpoint is exercised keyless by a route-handler test
  (initialize → list tools → `list_trips` against the seeded DB) in
  `apps/web`'s existing integration suite.

## Acceptance

From a Claude Code session with `.mcp.json` pointing at
`https://roadvalet.com/api/mcp` and a minted key:
1. "what trips do I have" → the seeded trips, scoped to the key's household.
2. "add an idea to <trip>: eat at X, note Y, source <url>" → the idea appears
   in the app within seconds, attributed to the minting member in history.
3. A revoked key gets 401 on the next call; a key over 60/min gets a rate
   limit error; a key from another household cannot see this one's trips.
4. `pnpm turbo run lint typecheck test` green, including the keyless endpoint
   test; a pipeline walk can call the endpoint with no key.

## Follow-ups this creates

- #162 (pipeline): `get_context`, `create_trip`, `add_destination`,
  `add_segment`, `add_reservation`, `add_save`, `journal_entry`, idempotency
  rules per tool; Settings card: mint/list/revoke keys.
- #164 unchanged. When tokens arrive, `resolveApiKey` gains a sibling and
  the endpoint accepts either.
