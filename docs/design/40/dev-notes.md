# dev notes — issue 40, item **i1** of 6

**Trip write contract + derived status.** Scope is i1 only; i2–i6 are separate
dispatches and nothing below touches their files.

Design read: `mc/wireframe/issue-40-v0:docs/design/40/index.html` (§2 the create +
status rule, §8 the contract table and the one refusal) and `plan.json` i1.
Vet verdict: `mc/vet/issue-40-v0:docs/design/40/vet-verdict.json`.

---

## What changed

### `packages/core` — the derivation and the write contract

- **`src/domain/trip-status.ts`** (new).
  - `deriveTripStatus(t, today)` :48 — the design's rule verbatim: a manual
    choice wins (`statusAuto === false` → the stored `status`), then
    `endDate < today` → `complete`, then `daysUntil(startDate) <= 30` →
    `upcoming`, else `planning`.
  - `UPCOMING_WINDOW_DAYS = 30` :16, `todayIso()` :22, `daysUntil()` :27 — UTC
    plain-date math, same technique as `derive-days.ts`, so no tz/DST drift.
  - `stopsOutsideRange(range, stops)` :72 and `orphanedStopsMessage()` :113 /
    `formatDateSpan()` :103 — the data + copy behind the 409. **Deviation from
    the letter of i1's file list:** the plan names only `deriveTripStatus` for
    this file, but the 409's predicate and message are pure, testable logic, and
    the brief says testable logic belongs in `packages/core` (the only package
    with a test runner). I put it in `trip-status.ts` rather than adding a file
    or amending `derive-days.ts`, to keep i1 to exactly the files the plan names.
- **`src/domain/types.ts`**
  - `trip.statusAuto` :117 — `z.boolean().default(true)`, so the existing
    "bundle defaults included" api-client test keeps passing and old payloads
    still parse.
  - `tripSummary.statusAuto` :206 — required (matching the rest of `tripSummary`,
    which carries no defaults) so the dashboard row and the trip cannot disagree.
  - `tripCreateInput` :131 and `tripPatchInput` :143 — the POST/PATCH bodies,
    derived with `trip.pick(...)` / `.partial()` and **exported**, so the
    handlers import them instead of re-deriving them inline. This is what makes
    the "handlers parse their bodies from the core schemas" acceptance
    *executable* — see the test below.
- **`src/domain/index.ts`** — re-exports `./trip-status`.
- **`src/domain/trip-status.test.ts`** (new, 15 cases) — `complete`, `upcoming`,
  `planning`, the 30-day boundary on both sides, an in-progress trip
  (`start <= today <= end` → `upcoming`), a trip ending *today*,
  `statusAuto:false` pinning the stored status (and the same trip flipping to
  `complete` once unpinned), `stopsOutsideRange` (cut at the end, cut at the
  start, fully contained, floating stops ignored), and the exact refusal
  sentence from the design.
- **`src/domain/trip-write-contract.test.ts`** (new, 6 cases) — pins the handler
  contract on the real exported schemas: `homeBase` defaults to `null`, blank
  title / non-ISO date refused, an empty patch stays `{}`, unknown keys
  (`legs`, `ownerId`) are stripped, the status pin round-trips, and bad values
  still fail. The middle one is load-bearing: `.partial()` over a `.default()`
  field must yield an **absent** key, not the default — a phantom default would
  silently reset a field the settings dialog never sent.

### `packages/db`

- **`src/schema.ts`:62** — `statusAuto: boolean("status_auto").notNull().default(true)`.
- **`src/queries.ts`**
  - `mapTripRow(row, today = todayIso())` :49 — derives `status` here, the one
    seam both `Trip` and `TripSummary` pass through, and passes `statusAuto`
    through. `today` is threaded so every row of one listing is evaluated
    against the same date (`listTripsForOwner` :90, `listTripsWithStopsForOwner`
    :105).
  - `summarize()` :127 carries `statusAuto` onto the dashboard row.
  - **`getTripForOwner()` deleted** — zero callers (re-confirmed:
    `grep -rn getTripForOwner apps packages` is empty).
- **`src/mutations.ts`** — new `// ── trips` block at :31.
  - `createTrip` :38 — inserts the trip and one `"Leg 1"` (`sortOrder: 0`) in
    the **same transaction**, per the design's empty-state rule.
  - `updateTripFields` :65 — returns `boolean` (did the owner-scoped statement
    match a row?) via `.returning({ id })`. An empty patch is a legal no-op but
    `.set({})` is not a legal statement, so it falls back to an existence check
    and still answers 204-vs-404 correctly. Also bumps `updatedAt`, matching
    `upsertRig`.
  - `deleteTrip` :94 — same `boolean` contract; children cascade from the FKs.
  - A trip is the **ownership root** (it carries `ownerId` itself), so these
    three scope on `trips.owner_id` directly rather than through
    `ownedLegIds`/`ownedStopIds`. See "vet findings" below.
- **`src/seed.ts`:25** — `statusAuto: false` on the Pacific Northwest Loop.

### `apps/web`

- **`src/app/api/trips/route.ts`** — `POST` :17. Parses `tripCreateInput` :18,
  400 on `safeParse` failure, then returns the **full tree** at 201 (re-read via
  `getTripById`, so `status` is already derived and `legs: [{ title: "Leg 1",
  stops: [] }]` is present) — the shape the design's 201 example shows and
  what i2's `/trips/new` redirect will consume.
- **`src/app/api/trips/[id]/route.ts`** — `PATCH` :29 and `DELETE` :67.
  `ctx.params` awaited (Next 16). PATCH: 400 on a bad body; when the body
  touches `startDate`/`endDate` it loads the tree, merges the proposed range,
  and refuses with **409 `date_range_orphans_stops`** :56 carrying
  `{ error, message, stops[] }` — a scheduled stop is "orphaned" when it is not
  *fully* contained by the new range, which is exactly the design's worked
  example (Bend, Aug 12–16, new end Aug 14 → refused even though it partly
  overlaps). Otherwise 204, or **404** :62 when the owner-scoped statement
  matched no row. DELETE is 204 / 404 :70.
  `GET` is unchanged except that its local `const trip` no longer collides with
  an imported schema name (the handler imports `tripPatchInput`, not `trip`).

### Fallout the vet predicted, fixed here

Three fixture files the plan did not list, each broken by `statusAuto` becoming
part of the grammar (vet findings 3 and 4):

- `packages/core/src/api-client/api-client.test.ts:25` — `statusAuto: true` on
  the `summary` fixture (a required `tripSummary` field would otherwise throw a
  ZodError, and a defaulted one would break `toEqual`). Also added
  `expect(b.trip.statusAuto).toBe(true)` at :127 so the bundle test's
  "defaults included" claim now covers the new field.
- `packages/core/src/planner/planner.test.ts:53` — `statusAuto: true` on the
  typed `fixture(): Trip`.
- `packages/core/src/domain/route-order.test.ts:30` — same on `seedTrip(): Trip`.

---

## Vet findings — what i1 owed, and what it does not

- **Findings 3 and 4 (`test`/`typecheck` fallout): fixed**, listed above. The
  gate is green (evidence at the bottom).
- **Finding 2 (INSERTs cannot be "owner-scoped through the existing
  ownedLegIds/ownedStopIds subqueries"): does not bite `createTrip`, and the
  code says so.** A trip has no owned parent to check — `ownerId` is a column on
  the row being inserted, taken from `getOwner()`, so there is no foreign id to
  validate and nothing for the `createReservation` select-then-throw pattern to
  do. `mutations.ts:32-36` documents that. The finding stands for i3's
  `createLeg`/`createStop`/`createIdea`, which are **not in this dispatch**.
- **Findings 1, 5, 6, 7 and both render FLAGs belong to i3/i5/i6** — the `legId`
  move, `scheduleFloating`'s default, the promote type picker, the
  `stop_dates_outside_trip` data path, the gap-targeted drop, the Radix portals.
  Nothing here touches those files. The *trip*-side refusal (finding 7's
  parenthetical: "the mirror refusal on PATCH /api/trips/:id is fine —
  `getTripById` already returns the tree") is the one implemented above, and it
  does exactly that.

## Flagged for the walk / for qa

1. **`pnpm db:push` is required before the app will run.** `status_auto` is a
   new column and there is still no tracked `drizzle/` directory (same call as
   docs/design/9/dev-notes.md: `db:generate` would emit a baseline mislabelling
   every pre-existing table as new). Without it every trip read 500s. Ready to
   execute — **operator-owned**, I did not run it, because it mutates a database
   outside this worktree:

   ```
   pnpm db:push          # from the repo root, with .env present
   ```

   docs/design/9 recorded pre-existing drift (`column "id" is in a primary key`)
   that makes `db:push` fail against the *existing* local `rvtrip` DB. If that
   recurs, the equivalent single statement is additive and safe:

   ```sql
   alter table trips add column status_auto boolean not null default true;
   ```

   `pnpm db:seed` afterwards is only needed to pick up the pinned PNW loop.

2. **The seed's demo dashboard loses its "Upcoming" shelf, by design.** Only the
   Pacific Northwest Loop is pinned (that is what plan i1 specifies). The other
   three seeded trips now derive: "Desert Southwest Winter" is stored
   `"upcoming"` but ran 2026-01-06 → 2026-03-30, so as of today it derives to
   **complete**. Net dashboard after `db:seed`: 1 planning (pinned) + 3 complete,
   and nothing under Upcoming. That is the design's rule working, not a bug —
   but it is walk-visible, and I did **not** unilaterally re-date the seed or pin
   a second trip, because which trip should read as upcoming is a design call.
   One-line fix if the human wants the shelf back: move that trip's dates
   forward in `packages/db/src/seed.ts:163-165`.

3. **`today` is read from the process clock** (`todayIso()`, UTC). A trip
   therefore crosses `planning → upcoming → complete` between two requests with
   no write, exactly as the design intends — but it also means a rendered page
   can be one day stale relative to a viewer west of UTC late in the evening.
   Nothing in i1 caches, so this is a display nuance, not a correctness bug.

4. **Claim for qa to check:** every acceptance clause of i1 is covered by an
   *executing* test except the HTTP status codes themselves. `deriveTripStatus`,
   the orphan predicate, the refusal copy and both handler body schemas run in
   `packages/core` (206 tests green). The **status codes and the DB writes do
   not** — `packages/core` is the only package with a test runner, there is no
   handler-level harness in this repo, and standing one up is its own change.
   The 201/204/404/409 paths are argued from the code, not executed; they are
   walk-provable in one pass with `curl` once `db:push` has run.

## Not done, deliberately

No migration file, no `ds-bundle/` edit, no client-side work (the settings
dialog, `/trips/new`, `trip-api.ts` are **i2**), no leg/stop/idea/reservation
mutations (**i3**, **i6**), no `scheduleFloating` change (**i5**). `getOwner()`
is untouched — every new write goes through it.

## Checks run

| check | command | result |
|---|---|---|
| full gate | `pnpm turbo run lint typecheck test --force` | `Tasks: 8 successful, 8 total` (`Time: 4.238s`) |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files 16 passed (16)` · `Tests 206 passed (206)` |
| new tests | (same run) | `✓ src/domain/trip-status.test.ts (15 tests)` · `✓ src/domain/trip-write-contract.test.ts (6 tests)` |
| dead code | `grep -rn getTripForOwner apps packages` | no matches |

The 8 turbo tasks are `@rv-trip/{ui}#build`, `#typecheck` for core/db/ui/web/mobile,
`@rv-trip/web#lint` and `@rv-trip/core#test` (`--dry=json` enumerated them);
`pnpm install` was run first — this worktree had no `node_modules`.

**SKIPPED (no env):** `pnpm db:push` / `pnpm db:seed` / `pnpm dev` and any live
`curl` of the new handlers. This worktree has no `.env`, and pushing schema would
mutate the shared local database outside it — see flag 1. **No HTTP status code
below was observed at runtime.**
