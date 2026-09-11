# dev notes · issue 43 · i1 — persist the route cache behind one routing key

Implements **plan item i1 only** (`docs/design/43/plan.json`, issue #29). i2/i3/i4 are
separate dispatches; nothing here touches the map, the dashboard card or the Navigate
control.

## What changed

### The key — one name, one derivation
- `packages/core/src/domain/rig.ts:146` `NO_ROUTING_HASH = "no-rig"` — deliberately the
  SAME string as `NO_RIG_HASH`, so the rename changes no stored key and no echoed hash.
- `packages/core/src/domain/rig.ts:150` `sha256Hex()` extracted; `rigHash()` (`:164`) now
  calls it. Its body is otherwise unchanged and its seven-field sweep
  (`rig.test.ts:145-186`) is **unedited** and still green.
- `packages/core/src/domain/rig.ts:205` `routingHash()` — sha256 over the SIX routing
  fields (`type`, height, width, length, grossWeightKg, propaneOnBoard). `rig.name` is
  gone, per Q1 = B. `type` is kept even though `buildRoutesUrl`
  (`providers/here.ts:181-197`) sends a constant `transportMode: "truck"` today — the
  design's own correction to the mock, and the alternative is a silent wrong-profile hit.
- `packages/core/src/domain/route-order.ts:90` `routeCacheKey`'s third parameter renamed
  `rigHash` → `routingHash` (it is the same rename; the function that BUILDS the key).

### Migration 0001 · the `routes` table
- `packages/db/src/schema.ts:55` `routeSource = pgEnum("route_source", ["here"])`.
- `packages/db/src/schema.ts:229` the `routes` table (`key` PK, `result` jsonb typed
  `$type<RouteResult>()`, `source`, `fetched_at` default `now()`) + `routes_fetched_at_idx`.
  No `owner_id`, on purpose.
- `packages/db/drizzle/0001_route_cache.sql` (+ `meta/0001_snapshot.json`,
  `meta/_journal.json`). Generated with `pnpm db:generate`, then renamed from drizzle-kit's
  random tag to match `0000_baseline`'s convention (the journal is tag-driven —
  `baseline.ts:51` reads `${tag}.sql`). **Never pushed to the operator's `rvtrip` DB.**
- `packages/db/src/queries.ts:428` `ROUTE_CACHE_TTL_DAYS = 30` and `getCachedRoutes(keys)`
  — one batched `inArray` read filtered on `fetched_at > now() - '30 days'::interval`.
- `packages/db/src/mutations.ts:627` `putCachedRoutes(rows)` + the `CachedRoute` type.
  **Filed in `mutations.ts`, not `queries.ts`** — the vet's MED finding: every other write
  in that package lives there. Upserts on the key; `fetched_at` comes from the DATABASE
  clock on both paths (column default on insert, `now()` in the conflict `set`), because
  the TTL is read back as a SQL comparison against `now()`.
- `packages/db/src/testing/truncate.ts:23` `routes` added to the between-test truncate.
- `packages/db/src/testing/fixtures.ts` — `fx.ageCachedRoute(key, days)` (`:337`, defined `:326`),
  `read.routeRow` / `read.countRoutes` (`:392`), `RouteRow`.

### The read path
- `apps/web/src/lib/routing.ts:69` `routePairs` is now memory → table → provider:
  `:76-88` the in-process Map; `:90-102` one batched `getCachedRoutes`, every hit
  `remember()`-ed so the Map is warm; `:104-117` the vendor, then the write-through
  **gated on `result.source === "here"`** (`:117`). `:153` `routeTrip` returns
  `{ routes, routingHash }`.

### The rename across the seam
`apps/web/src/app/api/routes/route.ts:39-43` (handler + echoed field),
`apps/web/src/lib/trip-api.ts:130-136` (its caller),
`apps/web/src/app/trips/[id]/page.tsx:21-25`,
`apps/web/src/components/trip/TripPlanner.tsx:146,152,220-224,661,672`,
`packages/core/src/planner/index.ts:274,298,316,388` (`routeModel`/`routeSummary`
parameter, default now `NO_ROUTING_HASH`).

## Decisions worth checking

1. **`POST /api/routes` renames its wire field to `routingHash`; `GET /api/trips/:id` does
   NOT.** The design's chain is "page.tsx → TripPlanner → routeModel/routeSummary →
   trip-api → the handler", and that is the whole set of callers of `/api/routes`. The trip
   BUNDLE is different: `apps/mobile` parses it through `tripBundleSchema`
   (`packages/core/src/api-client/schemas.ts:36`) and ships on its own Expo cadence, so
   renaming that field would break every installed build — the same hazard the vet raised
   against i3's `milesEstimated`. `apps/web/src/app/api/trips/[id]/route.ts:20-24` therefore
   keeps `rigHash` as the wire name while carrying the routing hash, with a comment saying
   so. `packages/core/src/api-client/{schemas.ts:47,index.ts:101}` were updated because they
   are the OTHER HALF of the `/api/routes` field — leaving them stale would make
   `api.routes.pairs()` throw on parse. `apps/mobile` is untouched.
2. **The cache can never break a render.** `readCache`/`writeCache`
   (`apps/web/src/lib/routing.ts:124-141`) swallow a db failure with a warning and fall
   through to the provider. Without this, a tree whose `0001` has not been applied 500s the
   trip page instead of paying for a route. The design does not name this; flagging it.
3. **One log line per resolve**, `route.cache hit=N miss=N layer=memory|db|provider`
   (`routing.ts:143`) — the design's read-path table, as an actual line. Wording is the
   design's; the layer is the one that paid.
4. **`putCachedRoutes` filters on `source === "here"` as well as the caller.**
   `routes.source` is a one-value enum, so the belt-and-braces keeps the stored literal
   honest rather than trusting the call site.

## Tests

- `packages/core/src/domain/rig.test.ts:193-254` — `routingHash`: stable; **unchanged when
  only `name` changes** (and equal to the six-field-only object); a six-case
  `it.each` sweep, exhaustive by construction (`edits` keyed over the six); the `"no-rig"`
  sentinel; and `routingHash(rig) !== rigHash(rig)`.
- `apps/web/src/lib/routing.test.ts` (new, 6 cases, **no database**) — a fake
  `HereRoutingProvider` and a faked `getCachedRoutes`/`putCachedRoutes` (via
  `importOriginal` spread, so `truncateAll`'s `db` handle survives for the rest of the
  suite): a cold pair is billed once and written through; an `estimate` is served but
  **not** written; a second open is served from the Map with no db read and no vendor call;
  a **db hit makes zero provider calls and warms the Map**; mixed layers in one call; and a
  failing table still renders. Each case re-imports `./routing` through `vi.resetModules()`
  because the Map is module scope.
- `apps/web/src/lib/route-cache.test.ts` (new, 5 cases, **real Postgres** via the suite's
  throwaway database) — the layer routing.test.ts fakes: verbatim jsonb round-trip of a
  `RouteResult`, an `estimate` stores nothing, only asked-for keys answer, a row aged 31
  days reads as a miss and re-upserts to one fresh row, a row aged 29 days survives. It
  lives in apps/web because that is the only harness with a database (packages/db has no
  `test` script) — and it therefore also proves `0001_route_cache.sql` applies.

## Checks run

- `npx turbo run lint typecheck test` → `Tasks: 9 successful, 9 total`
  (core 503 tests / 27 files; web 39 tests / 18 files — a real Postgres was reachable, so
  no file skipped).
- `pnpm db:generate` (as `npx drizzle-kit generate` with a dummy `DATABASE_URL`) a second
  time → `No schema changes, nothing to migrate` — i.e. no drift for CI's check.
- NOT run: `pnpm db:migrate` / `db:push` against the operator's `rvtrip` database (barred).
  0001 was exercised only through the test harness's own throwaway database.

## For the walk

Nothing visual changed. The behaviour to see is in the server log on a trip open:
`route.cache hit=… layer=db` on a second open after a restart, where it used to say
`layer=provider`. `pnpm db:migrate` must be applied to the local database first (otherwise
the cache warns and degrades to the provider — the page still renders).
