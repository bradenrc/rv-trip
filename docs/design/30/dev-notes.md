# Issue #30 — API integration tests against the docker Postgres · dev notes

The vetted wireframe (`mc/wireframe/issue-30-v0:docs/design/30/index.html`)
implemented as written, with every one of the vet's five HIGH and four MED
findings resolved in code. No production behaviour changed: the only edits to
existing files are three wiring edits (`turbo.json`, the two `package.json`s)
plus `pnpm-lock.yaml`. Nothing under `apps/web/src/app/*/route.ts`,
`apps/web/src/lib`, `packages/db/src/{queries,mutations,schema}.ts` or
`packages/core/src` was touched (DoD #6).

## What landed

### `packages/db` — the harness's database half (Q2 = C)

| file | what it holds |
| --- | --- |
| `packages/db/src/testing/lifecycle.ts` (180 lines) | `adminUrlFrom` :41 · `NO_DB_MESSAGE` :74 · `probe` :84 · `createTestDatabase` :115 · `dropTestDatabase` :138 · `reapOrphans` :164. Own `pg` Pool from an explicit URL throughout; **never** imports `../index`. |
| `packages/db/src/testing/truncate.ts` (25 lines) | `truncateAll` :21 — the one `TRUNCATE … RESTART IDENTITY CASCADE` over the seven tables. Uses the **shipped** `db` handle, which is why it is its own file. |
| `packages/db/src/testing/fixtures.ts` (434 lines) | `PlacedStopRow` :35 · `pacificNorthwestLoop` :281 · `fx` :334 · `read` :350. Also shipped-handle-side. |
| `packages/db/src/testing/index.ts` (13 lines) | the barrel behind `"./testing"` — re-exports all three, so it is worker-only. |
| `packages/db/package.json:9-11` | new exports `"./load-env"`, `"./testing"`, **`"./testing/lifecycle"`**. |

### `apps/web` — the harness's vitest half

| file | what it holds |
| --- | --- |
| `apps/web/vitest.config.mts` (36 lines) | `environment:"node"` · globalSetup · setupFiles · `include: src/**/*.test.ts` · `fileParallelism:false` · `server.deps.inline: [/@rv-trip\//]` · `vite-tsconfig-paths()` for `"@/…"`. |
| `apps/web/src/test/global-setup.ts` (48 lines) | probe → create+migrate → `provide("databaseUrl", …)` :40 → teardown drop :46. Reaps orphans first :38. |
| `apps/web/src/test/setup.ts` (41 lines) | `process.env.DATABASE_URL = …` :23 · `vi.useFakeTimers({ toFake:["Date"] })` :28 · the `beforeEach` truncate behind `await import(…)` :39. Exports `PINNED_NOW`. |
| `apps/web/src/test/db.ts` (25 lines) | `describeDb` :15 · `req` :18 · `ctx` :25. |
| `apps/web/src/test/vitest.d.ts` (12 lines) | the `ProvidedContext` augmentation — without it `inject()` is `unknown` and `turbo typecheck` fails (DoD #2). |
| `apps/web/package.json` | `test` / `test:watch` scripts + `vitest ^2.1.8`, `vite-tsconfig-paths ^5`. |
| `turbo.json:20-24` | `test` gets `passThroughEnv: ["DATABASE_URL","CI"]` and `cache: false`. |

### The suite — 16 files, 28 tests, co-located with each `route.ts`

Five deep contracts (§6) and every one of §7's 21 handler+method rows:

- `trips/[id]/route.test.ts` — §6.1 owner scoping (404 **and** the no-op read-back), §6.5 the bundle through `tripBundleSchema.parse`, the DELETE breadth row (the cascade is the damage), the 404 GET.
- `trips/[id]/legs/reorder/route.test.ts` — §6.2 `reorderTripLegs` (note the path: **not** `legs/[id]/reorder`), the foreign-id no-op, the distinct-sortOrder invariant.
- `ideas/[id]/promote/route.test.ts` — §6.3 promote once, replay 404, no orphan reservation; plus the foreign-idea row.
- `rig/route.test.ts` — §6.4 idempotency, `unique(owner_id)`, the millimetre round-trip, the row-level touch; plus the owner-partition row.
- `trips/route.test.ts` — the four derivation cases off the pinned clock.
- Ten breadth files: `legs`, `legs/[id]`, `legs/[id]/reorder`, `stops`, `stops/[id]`, `ideas`, `ideas/[id]`, `reservations`, `reservations/[id]`, `places`, `places/[id]`.

## The five HIGH findings — how each is resolved

1. **`lifecycle.ts` cannot hold both halves.** Split at the module, and the seam
   is named in the export map: `truncateAll` lives in
   `packages/db/src/testing/truncate.ts` and the fixtures in `fixtures.ts`; the
   `"./testing"` barrel re-exports all three (safe from a test file, whose
   imports evaluate *after* its setupFiles), while **globalSetup imports
   `@rv-trip/db/testing/lifecycle` directly** — a new export key added for
   exactly this. Nothing on that path reaches `packages/db/src/index.ts`.
2. **ESM hoisting in `setup.ts`.** The truncate is reached through
   `await import("@rv-trip/db/testing")` inside the `beforeEach`
   (`setup.ts:39`), i.e. after the `process.env.DATABASE_URL` assignment on
   line 23. A static import would be hoisted above it.
3. **The Q4 skip path crashed.** `global-setup.ts` no longer touches the barrel,
   so `index.ts:5-8`'s module-scope `throw` is unreachable from it. The `.env`
   fallback is now a real path, not dead code: `import "@rv-trip/db/load-env"`
   is the **first** import in the file, so dotenv runs before
   `lifecycle.ts` evaluates. And an *unset* `DATABASE_URL` is now the same
   verdict as an unreachable one (`global-setup.ts:29-30`) rather than a throw
   out of `adminUrlFrom`. Verified: with `DATABASE_URL` unset the suite still
   ran 28/28 green off the repo-root `.env`.
4. **The rig `updatedAt` assertion could not pass.** Correct — the insert stamps
   `defaultNow()` (the *Postgres* clock, real wall time) and the conflict branch
   sets `new Date()` (the *JS* clock, frozen 26 days earlier). The touch is
   asserted as an **equality against the pin** plus a `not.toBe(before)`, which
   is the only form that both holds under Q5 = A and proves the conflict branch
   ran: only the update can put the pinned instant in that column.
   `rig/route.test.ts` carries the reasoning in a comment.
5. **`.placeName` is not on the read shape.** Asserted as
   `bundle.trip.legs[0]!.stops[0]!.place.name`.

## The four MED findings

- **`turbo typecheck` reachability.** No `vitest/globals` and no tsconfig edit:
  every test and harness file imports `describe`/`it`/`expect`/`vi`/`inject`
  explicitly from `"vitest"`, which is also what `packages/core`'s 27 suites do.
  `inject`'s type comes from `apps/web/src/test/vitest.d.ts`.
  `@rv-trip/web:typecheck` runs `tsc --noEmit` over all of it and is green.
- **The missing `dotenv` devDep.** Avoided rather than added: apps/web imports
  `@rv-trip/db/load-env` (a new export of the package that already depends on
  dotenv), so the resolution happens inside `packages/db`. `load-env.ts`'s path
  is relative to the cwd, which under `pnpm --filter`/turbo is `apps/web` — so
  `../../.env` is the repo root, as intended.
- **Nullable coordinates vs the route helpers.** `LoopFixture`'s three
  coordinate-bearing stops are typed `PlacedStopRow = StopRow & { lat: number;
  lng: number }` (`fixtures.ts:35`), narrowed by a throwing `placed()` guard, so
  `routeCacheKey(astoria, newport, NO_RIG_HASH)` and
  `estimateRoute(astoria, newport)` typecheck.
- **`NO_DB_MESSAGE` misdirected.** The `pnpm db:migrate` line is gone; the
  notice now names `pnpm db:up` only, and renders the address from
  `DATABASE_URL` with the credentials redacted.

## The two FLAGs, now settled by execution rather than by reading

- **The handlers evaluate outside a Next runtime.** They do. `next/server` and
  `@clerk/nextjs/server` both import cleanly into `environment: "node"`,
  `clerkEnabled()` is false keyless, and the real `getOwner()` returns
  `dev-user` — 28 tests over 21 handler entry points, zero `vi.mock`.
- **The harness's runtime behaviours.** All confirmed live: `provide`/`inject`
  across the globalSetup→worker boundary; `toFake: ["Date"]` coexisting with
  pg's timeouts (no hang); `DROP DATABASE … WITH (FORCE)` against pools the run
  still holds; and vitest resolving the workspace packages whose `exports` point
  at raw TypeScript (`server.deps.inline` is declared, though linked workspace
  packages are inlined by default anyway).

## Decisions and deviations worth qa's eye

1. **`vitest.config.mts`, not `.ts`.** `apps/web` is a CJS package (no
   `"type": "module"`) and `vite-tsconfig-paths` v5 is ESM-only, so vite
   `require`s a `.ts` config and fails to load it at all — verified, that was
   the first run's error. `.mts` is already in `apps/web/tsconfig.json`'s
   `include`. Mechanical; the design's substance (the plugin, so the alias comes
   from tsconfig) is unchanged.
2. **The skip placeholder is not the developer's URL.** §3's snippet reads
   `url || process.env.DATABASE_URL || PLACEHOLDER_URL`; the middle term names
   the dev database in a connection string, which DoD #5 forbids and which buys
   nothing (`new Pool()` does not connect eagerly). Implemented as
   `url || PLACEHOLDER_URL` (`setup.ts:23`), pointing at
   `127.0.0.1:1/rvtrip_test_placeholder`.
3. **`createTestDatabase` drops before it creates.** `DROP DATABASE IF EXISTS …
   WITH (FORCE)` on the same name first, so a rerun that recycles a pid cannot
   collide. `dropTestDatabase` also refuses any name that is not
   `rvtrip_test_*` (`lifecycle.ts:139-141`) — a belt on top of the braces.
4. **28 tests, not the design's "≈33".** Every one of §6's five contracts, all
   four derivation rows and all 21 §7 rows are present; the difference is
   packing, not coverage — where the design's own table pairs a status and a
   read-back they are one `it` with both assertions, and the leg-reorder happy
   path carries its set-size invariant in the same test.
5. **`GET /api/trips` owner scoping is NOT asserted**, deliberately. §7 puts
   read paths outside round one, so `trips/route.test.ts` asserts derivation
   only. One line would add it; it is a second-round item, not this issue's.
6. **The three recorded gaps stay gaps.** `PATCH /api/ideas/[id]`'s 204 is
   *pinned* by a test with the reasoning in a comment, so the follow-up issue
   changes a test on purpose. The 401 in `proxy.ts` and the module-level
   provider caches in `lib/places.ts` / `lib/routing.ts` are untouched.
7. **The brief's "push testable logic into `packages/core`" does not apply
   here.** The unit under test *is* the composition of a Next route handler,
   `getOwner()`, Drizzle and a live Postgres — there is nothing to push down.
   This is why the issue adds the repo's first `test` script outside
   `packages/core`.

## Definition of done — what was actually run

| # | check | result |
| --- | --- | --- |
| 1 | `pnpm db:up && pnpm test` runs the new suite | 16 files / 28 tests passed |
| 2 | `pnpm turbo run lint typecheck test` | 9/9 tasks successful (core 493 tests, web 28) |
| 3 | container unreachable, no `CI` | `NO_DB_MESSAGE` printed, 16 files / 28 tests **skipped**, exit 0 |
| 4 | container unreachable, `CI=1` | exit **1**, `Error: API integration tests SKIPPED — no Postgres on …` |
| 5 | two runs back to back | no `rvtrip_test_*` left; a planted orphan `rvtrip_test_zzzz` was reaped; the dev `rvtrip` database byte-unchanged (trips=4 legs=7 stops=11 ideas=4 res=3 places=8 rigs=1 before and after) |
| 6 | no production file modified | `git status`: three wiring edits + `pnpm-lock.yaml`, everything else new |

`pnpm turbo run build` was also run: `next build` succeeds and the route
manifest is unchanged, so the co-located `*.test.ts` files add no routes.
