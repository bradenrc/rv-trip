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

---

# dev notes — issue 40, item **i2** of 6

**Trip surface: /trips/new, settings dialog, delete, InlineText, rollback
wrapper.** Scope is i2 only; i1 is already on this branch (untouched below) and
i3–i6 are separate dispatches. Design read:
`mc/wireframe/issue-40-v0:docs/design/40/index.html` §1 (Q1/Q2/Q3/Q5), §2
(`/trips/new`), §3 (where editing lives), §4 (the trip-settings dialog), §5
(delete, tiered), §6 (the rollback wrapper + the failure-toast table), §9 (the
dashboard copy), §10 gap 1 (InlineText lives in the app) and gap 3 (no
destructive colour) — plus `plan.json` i2.

## What changed

### `packages/core` — the two decisions the forms make (so they execute)

`vitest` in `packages/core` is the only runner in the repo, so the parts of this
item that are logic rather than markup went there.

- **`src/domain/trip-form.ts`** (new).
  - `tripDayCount(start, end)` :24 — inclusive day count, `null` for a
    backwards/half-typed range. It is the create form's "14 days" line **and**
    its submit guard, so there is one rule, not two.
  - `TripDraft` :33 / `BLANK_TRIP_DRAFT` :40 / `tripDraftInput(draft)` :51 — the
    `POST /api/trips` body or `null`. Trims the title, turns a blank home base
    into `null`, and parses through i1's `tripCreateInput` so the client and the
    handler agree by construction.
  - `TripStatusChoice` :66 / `TripSettingsDraft` :70 / `tripSettingsDraft(trip)`
    :80 / `tripSettingsPatch(trip, draft)` :100 — the settings dialog's state
    and its **minimal** PATCH body. Status is the one pair: choosing a status
    sends `{ status, statusAuto: false }` together; choosing Automatic sends
    `{ statusAuto: true }` alone and leaves the stored `status` where it is (the
    derivation ignores it). An unchanged field is an **absent** key — i1's
    `tripPatchInput` is `.partial()`, so a sent `undefined` would be a phantom
    reset.
  - `CascadeCounts` :134 / `tripCascadeCounts(trip)` :142 /
    `cascadeLossSentence(counts)` :158 — the confirm's copy from real counts
    ("Its 2 legs, 2 stops, 3 reservations and 2 ideas are deleted with it. This
    can't be undone."), zero counts omitted, singulars singular. i4 reuses it
    for the leg and stop confirms.
  - **Deviation from the letter of i2's file list:** the plan names only
    `apps/web/**` files. Putting the two form decisions and the loss sentence in
    `packages/core` is the brief's TDD instruction ("push testable logic down
    into `packages/core`"); the alternative was three untestable helpers inside
    a React component. Nothing else moved.
- **`src/domain/trip-form.test.ts`** (new, 23 cases) — the day count (both ends,
  single day, backwards, unparseable), the create body (the design's worked
  example, trimming, blank home base → `null`, not-yet-submittable, backwards
  range), the dialog draft (auto reads as Automatic, pinned reads as its stored
  status), the patch (empty when untouched, one key when one field moved, blanks
  → `null`, the pin pair, the unpin, no re-send of a pin already in place, zero
  stars clears, a backwards range is dropped rather than shipped, and the built
  patch round-trips through `tripPatchInput.safeParse`), and the five loss
  sentences.
- **`src/domain/index.ts`:4** — re-exports `./trip-form`.

### `apps/web`

- **`src/components/ui/inline-text.tsx`** (new) — `InlineText`, the epic's one
  new primitive. In the app, not `packages/ui`: the DS is deliberately
  display-only (§10 gap 1). `className` carries the typography of the text it
  replaces and is applied to **both** renders, so entering/leaving the edit
  shifts nothing.
  **Enter · Esc · blur all go through one path:** Enter and Esc call
  `blur()`, and `onBlur` :93 is the only place that commits — so a save can
  never fire twice, which the naive "Enter saves *and* blur saves" shape does.
  Esc sets `cancelling` :45 first, because **Esc also fires blur** (the vet's
  render FLAG); without the flag the cancel would immediately re-save. Blank is
  a cancel, not a delete (`commit()` :47) — the grammar has no nameless trip.
- **`src/lib/trip-api.ts`:28,32,35** — `createTrip` (typed `Promise<Trip>`; the
  201 carries the whole tree, so the create page can redirect straight in),
  `updateTrip`, `deleteTrip`. Bodies are the core types (`TripCreateInput` /
  `TripPatchInput`), not re-typed shapes.
- **`src/app/trips/new/page.tsx`** — replaces `StubPage` whole with the real
  form: name, start, end (native `<input type="date">` — no date-picker
  dependency added), optional home base, the "14 days" hint, Create/Cancel, then
  `router.push('/trips/:id')`. A client component: it needs no server data, and
  making it one keeps the change to exactly the file the plan names.
- **`src/components/trip/TripPlanner.tsx`**
  - `persist(p, undo, msg)` :153 — the wireframe's resolved wrapper, moved
    inside the component so it can `setTrip`/`setRoutes`. `undoRoutes` is the
    `RouteMap` this render was holding, captured at call time (the optimistic
    update and the `persist()` happen in the same handler, so it is the
    pre-change map). No Retry — option C was not chosen.
  - **Every one of the 11 `persist()` call sites passes three arguments**
    (:218, :233, :247, :432, :460, :473, :491, :503, :517, :531, :543 —
    verified by a paren-balanced arg count, not by eye).
  - `noteUndo` :143 + `beginNoteEdit()` :169 / `takeNoteUndo()` :163 — a note is
    optimistic on **every keystroke** and persisted on blur, so the trip in hand
    at commit time already carries the typed text and would be a no-op rollback.
    The ref snapshots the trip the first keystroke landed on, so "the old note
    is back" is true. One ref is enough: only one note is ever open.
  - `renameTrip` :230, `saveSettings` :241, `deleteTrip` :259 — the three new
    trip writes. `saveSettings` sends `tripSettingsPatch(...)` and no-ops when it
    is empty. `deleteTrip` is the one write with nothing to be optimistic about
    (the surface it would roll back to is the page), so it awaits, then
    `router.push('/')` + `refresh()`; a failure toasts "Couldn't delete … —
    nothing was removed." and stays put.
  - Masthead: the title is now `InlineText` :348 inside the same `<h1>` with the
    same type classes; a ghost "⚙ Trip settings" button :375 (`onClick` :378) sits at the end of
    the meta row (`ml-auto`, the wireframe's `.spacer`).
  - `TripSettingsDialog` :588 / `TripSettingsFields` :619 — built on
    `components/ui/dialog.tsx`. **The fields are a separate component rendered
    only while `open`** (:607): Radix keeps the calling component mounted and
    only portals its content, so without this the draft would survive a close
    and Cancel would not really discard. Fields are start/end (native date),
    home base, the status select, `Stars` (the DS component, composed not
    restyled) and the note textarea — the title is deliberately **not** here.
  - The dialog **refuses out-of-range dates client-side** :639 with
    `stopsOutsideRange` + `orphanedStopsMessage` — i1's core helpers, so the
    warning in the dialog is the same sentence the server's
    `409 date_range_orphans_stops` carries. `deriveDays` would otherwise clamp
    the stop out of sight (§4's flag). Save is disabled while it stands.
  - `DeleteTripConfirm` :769 — `components/ui/alert-dialog.tsx`, copy from
    `cascadeLossSentence(tripCascadeCounts(trip))` :788. **No destructive
    variant anywhere:** the confirm action is `bg-rv-ember` (documented CTA),
    the loss line and the "Delete trip…" affordance are `rv-warning` (documented
    attention).
- **`src/app/page.tsx`:91** — "Reopen any to revisit or clone." → "Reopen any to
  revisit." `grep -rn clone apps/web/src` is now empty.

## Decisions, deviations and defaults — worth qa's eye

1. **Three toast lines are derived, not quoted.** The design's §6 table gives
   five verbatim: schedule, rename, reorder, cascading delete, trip settings —
   all five are used verbatim (straight apostrophes, matching the repo; the page
   uses typographic ones). The wrapper also had to cover the eight *pre-existing*
   call sites the table does not enumerate (stop/reservation/idea ratings, the
   three notes, the idea status cycle). Those use the design's stated pattern
   ("what failed, then what the screen did about it") with its own second
   clauses: "Couldn't save that rating — the old rating is back.", "Couldn't save
   that note — the old note is back.", "Couldn't save that status — put back the
   way it was." No "check your connection" survives anywhere.
2. **`text-rv-ink-subtle` on the two field qualifiers ("optional", "Traveled
   trips") was changed to `text-rv-ink-faded`.** The wireframe's `.subtle` maps
   to `rv-ink-subtle`, but `packages/core/src/theme/nightfall-tokens.test.ts:207`
   (the #19 palette guard) fails the build if `rv-ink-subtle` paints a text
   glyph. The shipped invariant wins; the words are unchanged and the case/weight
   carry the distinction instead.
3. **The status select has four options**, not three: "Automatic — set by the
   dates" plus the three `tripStatus` values as "… — set by me". The wireframe
   shows the closed state ("Planning — set by me") and the help line names
   Automatic; this is the smallest option set that can express both halves of
   i1's `statusAuto` contract.
4. **The create page redirects with `router.push`, not a server redirect.** The
   POST returns the tree, so the id is in hand; no server action is introduced
   (§10: "no new prop crosses the boundary").
5. **Not done, deliberately (later items):** the three dead "Add stop"/"Add leg"
   buttons still have no `onClick` (**i4**), the leg/stop row menus and the
   stop-dates dialog are **i4**, `scheduleFloating`'s gap argument is **i5**,
   and the reservation/idea forms + the undo-toast leaf deletes are **i6**.
   `InlineText` and `persist(p, undo, msg)` are the two grammar-wide pieces those
   items reuse — both land here, as the plan intends.

## Flagged for the walk

1. **Render-required: `InlineText`'s Esc-before-blur ordering.** The vet named
   this class of risk and it is still a runtime fact — the `cancelling` ref is
   the guard, but that Esc leaves the old title on screen (and fires no PATCH)
   is provable only in a browser. Same for Enter not double-saving.
2. **Render-required: the two Radix dialogs.** They are opened from the masthead,
   **not** from inside the hand-rolled `StopDetailSheet` overlay, so the vet's
   portal/backdrop collision does not apply to i2 — but the settings dialog's
   `Select` is a nested portal, and "the select closes without closing the
   dialog" is pointer behaviour. Worth one pass.
3. **`pnpm db:push` is still required** before any of this runs — i1's
   `status_auto` column (see i1's flag 1). Without it every trip read 500s and
   nothing here is reachable. Operator-owned; not run from this worktree.
4. **Claim for qa:** the acceptance clauses are verified as follows — the
   `persist()` arity by a paren-balanced count over the file (11/11 at three
   args), `StubPage` and `clone` by grep, and the two decisions behind the forms
   (`tripDraftInput`, `tripSettingsPatch`) by 23 executing tests. **That the
   dialog's Save actually issues `PATCH /api/trips/:id`, and the create page
   `POST /api/trips`, is argued from the code** (`tripApi.updateTrip` /
   `tripApi.createTrip` → `req(url, method)`), **not observed at runtime** —
   there is no handler- or DOM-level harness in this repo and no `.env` here.

## Checks run

| check | command | result |
|---|---|---|
| full gate | `pnpm turbo run lint typecheck test --force` | `Tasks: 8 successful, 8 total` |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files 17 passed (17)` · `Tests 229 passed (229)` |
| new tests | (same run) | `✓ src/domain/trip-form.test.ts (23 tests)` |
| persist arity | paren-balanced arg count over `TripPlanner.tsx` | 11 call sites, all 3 args |
| dead copy | `grep -rn "clone" apps/web/src` | no matches |
| stub gone | `grep -rn StubPage apps/web/src` | only `app/settings/*` (unrelated routes) |

`pnpm install` was run first — this worktree had no `node_modules`.

**SKIPPED (no env):** `pnpm db:push` / `pnpm db:seed` / `pnpm dev`, and every
browser-side behaviour above (InlineText's key handling, the two dialogs, the
redirect after create). No HTTP request in this item was observed at runtime.

---

# dev notes — issue 40, item **i3** of 6

**Leg + stop write contract.** Scope is i3 only: `packages/core` schemas + the
one guard, `packages/db` mutations/queries, and the five API route files. No
component, no `trip-api.ts` method (that is i4), no UI copy.

Design read: `mc/wireframe/issue-40-v0:docs/design/40/index.html` §8 (the
contract table, the mirror refusal at :948-949) + `plan.json` i3. Vet findings
from the brief are answered one by one below.

---

## What changed

### `packages/core` — the write contract the handlers parse against

- **`src/domain/types.ts`** — a new "leg + stop WRITE contract" block, derived
  from the grammar exactly the way i1 derived the trip one:
  - `legCreateInput` :171 — `leg.pick({ title }).extend({ tripId: uuid })`.
    `sortOrder` is **not** in it: the server appends.
  - `legPatchInput` :177 — `leg.pick({ title }).partial()` (the inline rename;
    order moves through reorder, never through PATCH).
  - `legReorderInput` :182 — `{ order: uuid[] }`, min 1.
  - `stopCreateInput` :189 —
    `stop.pick({ place, arriveDate, departDate }).extend({ legId: uuid })`; a
    stop is born floating unless the caller already has dates.
  - `stopPatchInput` :200 — the widened stop write:
    `stop.pick({ arriveDate, departDate, sortOrder, rating, notes })
     .extend({ placeName: place.shape.name, legId: uuid }).partial()`.
    `placeName` (not `place`) because the DB column and the rename affordance
    are the name alone.
  - **Decision — `.uuid()` on the id-shaped fields.** The grammar keeps
    `z.string()` for ids (a `Trip` read must not care), but these fields address
    a real `uuid` column: without the tightening a malformed id is a Postgres
    cast error (500) instead of a 400 at the boundary. Same convention the
    shipped handlers already use (`api/reservations/route.ts:7`).
- **`src/domain/trip-status.ts`** — the mirror of i1's one refusal:
  `TripDateRange` :130, `stopDatesOutsideTrip(range, dates)` :140 (a floating
  stop — either date null — is never "outside": that is a legal state, not a
  lost one) and `stopOutsideTripMessage()` :149, which reuses i1's
  `formatDateSpan`.
- **`src/domain/leg-stop-write-contract.test.ts`** (new, 21 cases) — the same
  technique as `trip-write-contract.test.ts`: the handlers parse bodies with
  these schemas, so what the schemas do IS the contract. Covers the append-only
  creates (`sortOrder`/`id` stripped), the absent-not-defaulted PATCH keys, the
  three widened stop fields, "Unschedule" as `{arriveDate: null, departDate:
  null}`, the rejections (blank name, non-ISO date, non-uuid id, fractional
  `sortOrder`, rating 9), and the 409 guard on both edges + its sentence.

### `packages/db`

- **`src/queries.ts`**
  - `getStopDateContext(owner, stopId)` :146 — **the data path the vet said the
    409 did not have.** One `stops -> legs -> trips` join scoped on
    `trips.owner_id`, returning the trip window *and the stop's current dates*
    (a PATCH may send only one of the pair, so the guard has to judge the pair
    the row will actually hold). `null` = the owner has no such stop = 404.
  - `mapLeg` :215 / `mapStop` :247 (+ `MapStopRow`) exported so a create can
    answer in the core `Leg`/`Stop` shape instead of a raw row — the same
    precedent as `mapRigRow`, which `mutations.ts` already imports.
- **`src/mutations.ts`** — a `// ── legs` block at :114 and `// ── stops` at
  :221.
  - `assertOwnedTrip` :116 / `assertOwnedLeg` :129 — the two prechecks, both
    the explicit select-then-throw of `createReservation:50-54`. `assertOwnedLeg`
    proves ownership **through the shared `ownedLegIds(owner)` subquery**, so
    the acceptance's "owner-scoped through the shared subquery helpers" is
    literally true of it. Both take the tx/db handle so a create can prove
    ownership inside the same transaction it writes in.
  - `createLeg` :147 — appends (`max(sortOrder) + 1`) and inserts in ONE
    transaction, so two concurrent adds cannot claim one position. Returns
    `Leg` with `stops: []`.
  - `updateLegFields` :170 / `deleteLeg` :185 — `boolean` (did the owner-scoped
    statement match?), scoped `and(eq(legs.id, id), inArray(legs.id,
    ownedLegIds(owner)))`. The empty-patch no-op falls back to an existence
    check, same as i1's `updateTripFields`.
  - `reorderTripLegs` :199 — `assertOwnedTrip`, then the renumber loop in a
    transaction, copied from `reorderLegStops`. Each statement also carries
    `eq(legs.tripId, tripId)`, so an id from another trip renumbers nothing.
  - `createStop` :223 — `assertOwnedLeg` on the **destination** leg, then
    append + insert in one transaction; returns the core `Stop`.
  - `updateStopFields` :264 — widened to `placeName`/`legId`/`sortOrder`, now
    returns `boolean`, and **checks the destination leg** :277 when the patch
    carries `legId`.
  - `deleteStop` :288.

### `apps/web` — five route files

- **`api/legs/route.ts`** (new) — POST, 201 with the `Leg`, 400 on `safeParse`,
  404 `trip not found`.
- **`api/legs/[id]/route.ts`** (new) — PATCH 204/404, DELETE 204/404.
- **`api/trips/[id]/legs/reorder/route.ts`** (new) — POST 204/400/404.
- **`api/stops/route.ts`** (new) — POST, 201 with the `Stop`, 404
  `leg not found`.
- **`api/stops/[id]/route.ts`** — the hand-rolled `patchSchema` replaced with
  `stopPatchInput`; the date guard at :27-45 (merge the patch over the stored
  pair, then 409 `{error, message, trip:{startDate,endDate}}`); 404 on a
  zero-row match :49; 404 `leg not found` :50-52 for a move into a leg the
  caller does not own; DELETE :59.
  Every `ctx.params` is awaited (Next 16).

---

## Vet findings — each one, and where it landed

- **HIGH · `legId` move was unvalidated.** Fixed at `mutations.ts:277`: the
  WHERE's `ownedLegIds` only proves where the stop IS, so the DESTINATION leg
  gets its own `assertOwnedLeg` (the `createReservation` pattern) and the write
  throws before it runs. `createStop:233` closes the mirror hole. **Verified at
  runtime** (see checks): owner A moving a stop into owner B's leg is refused
  and the row keeps its old `leg_id`.
- **MED · "owner-scoped through the subqueries" is not a thing an INSERT can
  do.** Agreed — the two creates use the explicit select-then-throw the vet
  named, and `assertOwnedLeg` runs it *through* `ownedLegIds` so both statements
  are true at once. Documented in the block comment at `mutations.ts:114-121`.
- **MED · the 409 had no data path.** `getStopDateContext` (`queries.ts:146`) is
  it. It returns the stop's own dates too, so a one-sided patch
  (`{departDate}` only) is judged against the pair the row will hold — verified:
  `PATCH {"departDate":"2026-08-31"}` on Bend (stored arrive Aug 12) refuses
  with `Aug 12–31 is outside the trip…`.
- The three fixture/typecheck findings and the `scheduleFloating` default are
  i1/i5 items and are untouched here.

## Decisions + things to flag

- **Authored copy (flag for the walk/qa).** The design fixes the 409's *code*
  and that it carries the trip's range, but quotes no sentence for the stop side
  (only the trip side's). Mine mirrors that sentence's shape — what is wrong,
  then the way out: `"Aug 30–Sep 2 is outside the trip, which runs Aug 1–28.
  Change the trip's dates first."` If the design owner wants different words,
  it is one string at `trip-status.ts:149` and one test assertion.
- **A move + a date change in one PATCH** is judged against the window of the
  trip the stop is in *now*. That is the same trip in every affordance the
  design draws ("Move to leg" lists the legs of this trip), so no cross-trip
  case exists to get wrong yet.
- **Deleting a leg leaves a gap in `sortOrder`** (0,1,2 → 1,2 after deleting the
  first). Ordering is by `sortOrder ASC`, so this is invisible; I did not add a
  renumber-after-delete because the design does not ask for one and it would be
  a second write on every delete.
- **`POST /api/legs` and `POST /api/stops` answer 201 with the core shape**
  (`Leg` with `stops: []`, `Stop` with empty `reservations`/`ideas`) rather than
  204, so i4 can splice the new row into the tree it holds without a re-fetch.
- **Not touched:** `trip-api.ts`, `api-client`, `RouteView.tsx`,
  `TripPlanner.tsx`, `api/legs/[id]/reorder/route.ts` (the *stop* reorder — the
  design says a hand-rolled body is converted only where an item already edits
  the file, never as a drive-by).
- **No migration.** No column, enum or table changed in this item — only new
  statements against the existing schema. `pnpm db:push` is still owed for i1's
  `trips.status_auto`, and that is operator-owned: the shared local DB
  (`rvtrip`) does not have the column yet, which is why the runtime checks below
  ran against a throwaway database instead.

## Checks run

| check | command | result |
|---|---|---|
| full gate | `pnpm turbo run lint typecheck test` | `Tasks: 8 successful, 8 total` |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files 18 passed (18)` · `Tests 250 passed (250)` |
| TDD red first | `pnpm --filter @rv-trip/core test` before implementing | `Tests 21 failed | 229 passed (250)` |
| mutations vs a real Postgres | scratch `tsx` script, 24 assertions, throwaway DB `rvtrip_i3_smoke` (drizzle-kit push + drop) | all `PASS`, incl. `updateStopFields REFUSES a move into another owner's leg` and `the refused move did not land` |
| handlers vs a real dev server | `next dev -p 3117` on the throwaway DB + `curl` | `POST /api/legs` 201/400/404 · `PATCH /api/legs/:id` 204/404/400 · `POST /api/trips/:id/legs/reorder` 204/404/400 · `POST /api/stops` 201/400/404 · `PATCH /api/stops/:id` 204/404 (stop) /404 (dest leg) /409 /400 · `DELETE` 204 then 404 for both nouns |

`pnpm install` was run first — this worktree had no `node_modules`.

The runtime checks used a **throwaway database** (created, `drizzle-kit push`,
seeded, exercised, dropped) so the operator's `rvtrip` dev DB was neither
migrated nor written to. The scratch script and the dev server are gone; nothing
from them is in the worktree.

**SKIPPED (no env):** nothing in this item — the two runtime checks above
replaced what i1/i2 had to argue from code.

---

# dev notes — issue 40, item **i4** of 6

**Leg + stop affordances in the planner.** Scope is i4 only: the two row menus
and the three dead buttons in `RouteView.tsx`, the handlers + the two new
dialogs in `TripPlanner.tsx`, the leg/stop methods on `trip-api.ts`, and the
pure helpers those need. No API/DB change (i3 shipped all of it), no gantt drop
(i5), no reservation/idea surface (i6).

Design read: `mc/wireframe/issue-40-v0:docs/design/40/index.html` §3 (the three
weights + both row menus, :465-535), §4 (the stop-dates dialog, :585-615), §5
(the cascade confirm and its copy, :620-655) + `plan.json` i4.

---

## What changed

### `packages/core` — the decisions, pushed down where `vitest` runs them

`vitest` only runs in `packages/core`, so every rule this item makes is a pure
function there and the components are the glue that calls it.

**`packages/core/src/planner/index.ts`** — the structural tree mutations, beside
the ones `TripPlanner` already used (`updateStop`, `reorderFloating`):

- `appendLeg:589` / `appendStop:594` — splice the row a 201 handed back. These
  two are deliberately NOT optimistic: only the server can mint the id.
- `renameLeg:601` / `renameStop:609` — `renameStop` rewrites `place.name` only;
  the coordinates belong to the place picker (#23), not to a text field.
- `removeLeg:614` (takes its stops, the way the FK cascade does) /
  `removeStop:619`.
- `legOrder:624` — the ids in render order, i.e. the whole body the reorder
  POST sends. `canMoveLeg:629` / `moveLeg:640` — a full renumber, never a swap,
  so a half-applied move cannot leave two legs sharing a `sortOrder`. Array
  position is left alone and `sortOrder` is rewritten, which is exactly what
  `reorderFloating` already does and what `routeModel` sorts on.
- `moveStopToLeg:654` — re-parents and appends to the end of the destination
  (the same "the server appends" rule a create follows, so the optimistic tree
  and the row the PATCH writes agree). A move into the leg it is already in
  returns the same trip, so the caller can skip the write.
- `setStopDates:670` — the dialog's save AND "Unschedule" (both dates null).

**`packages/core/src/domain/trip-form.ts`** — the copy and the form rules:

- `legCascadeCounts:176` / `stopCascadeCounts:186` — the counts the two new
  confirms name. A leg never counts itself: the sentence is about what goes
  *with* it. Both feed the shipped `cascadeLossSentence`, so trip, leg and stop
  all speak one sentence rather than three — the leg case renders the design's
  exact line, *"Its 2 stops, 3 reservations and 2 ideas are deleted with it.
  This can't be undone."*
- `nextLegTitle:195` — `"Leg N"` from the leg COUNT, so the name matches the
  `Leg N` kicker the route lens renders and the first one is `"Leg 1"`, exactly
  what `createTrip` seeds.
- `StopDatesDraft:202` + `stopDatesDraft:208` / `stopDatesHelp:218` /
  `stopDatesPatch:230` / `unscheduleStopPatch:238`. `stopDatesHelp` writes the
  design's line verbatim — `"5 days · Aug 12 is the drive day in"` — and the
  arrival day is the drive day because `deriveDays` classifies it that way
  (derive-days.ts:94ff). `stopDatesPatch` returns `null` for an unusable range
  (the same `null` that disables Save — one rule, not two) and `{}` when
  nothing moved.

Tests: `planner.test.ts:336-439` (11 cases incl. a no-mutation sweep) and
`trip-form.test.ts:265-404` (13 cases). Both were written first and were red
(`23 failed | 250 passed`) before any of the above existed.

### `apps/web/src/lib/trip-api.ts` — the leg + stop write methods

`createLeg:47`, `updateLeg:51`, `deleteLeg:54`, `reorderLegs:58`,
`createStop:62`, `deleteStop:74`, and `updateStop:71` widened from a hand-typed
patch to the core `StopPatchInput` (so `placeName`, `legId` and `sortOrder`
reach it). A 409 `stop_dates_outside_trip` arrives as a rejected promise like
any other non-2xx, so `persist()` rolls the optimistic change back.

### `apps/web/src/components/ui/inline-text.tsx` — `autoEdit` + `onEditEnd`

Two optional props (`:34-49`). `autoEdit` mounts it already editing; the caller
flips it by remounting on a changed `key`, so there is no second source of truth
for "am I editing", and `onEditEnd` (`:61`, `:111`) lets the caller drop it. That
is how the menu's **Rename** and a just-created row reach the SAME inline edit —
one rename path, not two, exactly as §3 argues.

### `apps/web/src/components/trip/RouteView.tsx`

- `RouteViewActions:52` — one `actions` prop carrying the fourteen callbacks,
  rather than fourteen sibling props.
- Leg header (`:114-169`): the title is now `InlineText`; the ⋯ menu is
  Rename / Move leg up / Move leg down / — / Delete leg…, with the two move
  items disabled at the ends of the list.
- Per-leg **Add stop** now has `onClick` (`:128`), **Add leg** has one
  (`:347`), and the masthead's is wired in `TripPlanner` — the three buttons the
  design called out. Every `<button>` this file renders has a handler.
- Stop row (`:172-300`): the name is `InlineText` and the ⋯ menu is
  Rename / Edit dates… / Unschedule / Move to leg ▸ / — / Delete stop….
  **Unschedule** is disabled on a floating stop; the Move-to-leg submenu is
  built from the `legs` prop and disables the leg the stop is already in.
- `RowMenu:383` / `MenuHint:408` / `MENU_SURFACE:374` / `MENU_ITEM:378` /
  `MENU_ITEM_WARN:380` — one trigger and one surface for both menus.

### `apps/web/src/components/trip/TripPlanner.tsx`

State: `renamingId:164`, `datesStopId`, `deleteLegId`, `deleteStopId`; the three
subjects are re-derived off the tree (`:250-254`) rather than snapshotted, so a
rollback under an open dialog corrects what it shows.

Handlers: `addLeg:283`, `doRenameLeg:294`, `doMoveLeg:306`, `doDeleteLeg:319`,
`addStop:338`, `doRenameStop:354`, `saveStopDates:366`, `doUnschedule:384`,
`doMoveStopToLeg:399`, `doDeleteStop:417`. Every one that mutates optimistically
passes its pre-change `trip` to `persist()` as the rollback snapshot, with a
message naming what was undone. The two deletes close the stop sheet first when
it is showing a stop that is about to vanish.

Dialogs: `CascadeDeleteConfirm:1037` — i2's `DeleteTripConfirm` generalised to
take a title, a `CascadeCounts` and a verb, and now used by all three cascading
deletes rather than copied twice. `StopDatesDialog:1091` / `StopDatesFields:1122`
— native `<input type="date">` (the app ships no date picker), the help line,
Save dates / Cancel / Unschedule, mounted only while a stop is open so Cancel
really discards.

---

## Decisions, deviations and defaults — worth qa's eye

1. **The stop row's click target is now a stretched overlay, not a wrapper
   button** (`RouteView.tsx:195-208`). The title line grew two real buttons (the
   inline rename and the ⋯ trigger) and a `<button>` inside a `<button>` is
   invalid HTML, so the open-the-sheet button is an `absolute inset-0` sibling
   UNDER the content; the content is `pointer-events-none` and only the two
   controls take the pointer back. Grip/Pin and the content wrapper are
   `relative` so they paint above it. **Claim for qa:** clicking a note, a
   reservation line or empty row space still opens the sheet; clicking the name
   edits it; clicking ⋯ opens the menu. This is pointer behaviour — see the
   walk flag below.

2. **"Add stop" names the stop `"New stop"`** (`TripPlanner.tsx:116`) and opens
   its inline rename focused. The design never gives copy for this; the
   alternative was a third dialog, which §3 explicitly rules out ("no fourth
   pattern"). `"Add leg"` needed no invention — `nextLegTitle` reproduces the
   `"Leg 1"` that `createTrip` already seeds. **Defaulted; flagged.**

3. **The masthead "Add stop" appends to the LAST leg** and switches the lens to
   Route so the new row (and its open rename) is actually on screen. The
   masthead has no leg in hand, and "goes on the end" is the rule every other
   create in this epic follows. It is disabled when the trip has no legs, which
   `createTrip` makes unreachable. **Defaulted.**

4. **The creates do not call `persist()`.** i4's acceptance says every new
   mutation call site passes a rollback snapshot; `addLeg`/`addStop` pass none
   because they are not optimistic — they await the 201 and splice the row it
   returns, so there is nothing on screen to roll back. A failure is a plain
   `toast.error` naming that nothing was created. Same shape as i2's
   `deleteTrip`. **Deliberate; call it out if qa reads the acceptance
   literally.**

5. **The wireframe paints the menu-item hint with the subtle ink; this uses
   `rv-ink-faded` instead** (`RouteView.tsx:395-409`). `nightfall-tokens.test.ts`
   enforces (as a vet HIGH) that the subtle token paints no text glyph — it is
   for empty stars and grip handles. The faded ink is the documented colour for
   mono meta text. The shipped role table beat the mock here; it is the only
   pixel deviation in the item. (The sweep greps raw source lines, so even
   naming the token in a comment reds it — hence the periphrasis in that
   comment.)

6. **No destructive variant anywhere**, per §5: the confirm action is
   `rv-ember`, the loss line and the two Delete… menu items are `rv-warning`.
   The shadcn dropdown's stock surface already resolves to the design's exact
   values (`--popover` is `#21374d` = `rv-navy-soft`), but its geometry is sized
   to the trigger — a 26px kebab — so `MENU_SURFACE` re-states the wireframe's
   `.menu` box in `rv-*` tokens.

7. **The stop-dates dialog refuses out-of-trip dates before the write leaves**
   (`StopDatesFields`, the `outside` guard). It composes i3's own
   `stopDatesOutsideTrip` + `stopOutsideTripMessage`, so the client says the
   *same sentence* the handler's 409 carries — the mirror of what i2 did with
   `orphanedStopsMessage` in trip settings. Save is disabled while it holds.

8. **The leg-delete confirm does not name the stops.** The wireframe's copy is
   *"Its 2 stops (Astoria, OR · Newport, OR), 3 reservations…"*; the epic plan
   quotes it without the names, and i2 already shipped `cascadeLossSentence`
   producing the un-named form for the trip. One sentence builder for all three
   beat a second one for the parenthetical. **Deviation from the wireframe's
   §5 frame; deliberate.**

---

## Flagged for the walk

Both are pointer/runtime facts static analysis cannot settle, and both were
called out in the vet:

- **The stretched-overlay stop row (decision 1).** That the overlay does not
  eat the ⋯ trigger or the inline editor, and that HTML5 drag from the grip
  still starts the floating reorder with the overlay in the box, is a render
  fact. `Timeline`'s gap drop (i5's flag) is a different surface and unchanged
  here.
- **Radix portals over the hand-rolled stop sheet.** `StopDetailSheet` is a
  `fixed inset-0 z-40` overlay whose backdrop closes it on click. The menus and
  both dialogs added here live in `RouteView`/`TripPlanner`, which the sheet
  covers while it is open, so they should never be dismissed through it — but
  the dialogs do portal to `document.body`, so the walk should confirm that
  closing the stop-dates dialog (Esc, Cancel, outside click) does not also close
  the sheet if one is open behind it.
- **`InlineText`'s Esc-then-blur ordering** now also runs in two more places
  (leg title, stop name) and fires `onEditEnd`, which remounts the component.
  Esc must cancel without saving and without re-opening the editor.

---

## Not done, deliberately

- No gantt-drop change (i5), no reservation/idea surface (i6), no API or DB
  change (i3 shipped every endpoint this item calls).
- `Timeline.tsx` is untouched: the row menus are the route lens's.
- No confirm on a reservation or an idea — those are leaves and get i6's undo
  toast, per the acceptance.

---

## Checks run

| check | command | result |
|---|---|---|
| TDD red first | `pnpm --filter @rv-trip/core test` before implementing | `Tests 23 failed | 250 passed (273)` |
| full gate | `pnpm turbo run lint typecheck test` | `Tasks: 8 successful, 8 total` |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files 18 passed (18)` · `Tests 273 passed (273)` |
| item acceptance | `pnpm turbo run lint typecheck` | `Tasks: 7 successful, 7 total` |

`pnpm install --frozen-lockfile` was run first — this worktree had no
`node_modules` (`Done in 6.2s`).

**SKIPPED (no env):** no browser/runtime check. Everything i4 adds is client
render + pointer behaviour, which is precisely what the walk gate is for; the
three items above are what it should look at. No database was touched (this item
adds no query or mutation).

---
---

# dev notes — issue 40, item **i5** of 6

**The gantt drop takes the gap it was dropped on.** Scope is i5 only; i1–i4 are
already on this branch and untouched, i6 is a separate dispatch.

Design read: `mc/wireframe/issue-40-v0:docs/design/40/index.html` §7 (the
resolved rule, the worked drop table, the toast, the "no `sortOrder` write"
note) and the epic plan's i5. Vet feedback: the one i5 finding — `gap` must
default so the five existing 2-arg call sites keep compiling — is honoured
(`gap = null` is the default, not a required positional).

---

## What changed

### 1 · `scheduleFloating` takes the gap

`packages/core/src/planner/index.ts:526` — new `longestOpenRun(days)` helper,
the old scan lifted verbatim out of the function so both branches read the same
day list.

`packages/core/src/planner/index.ts:557` — the new signature:

```ts
scheduleFloating(trip, stopId, gap: TimelineGap | null = null, nights = 3)
```

- `gap` is the **same `TimelineGap`** the gantt already renders (`startCol` is
  1-based into the very day list `deriveDays` rebuilds here), so nothing new is
  invented and no drag context is plumbed.
- `arriveDate = days[gap.startCol - 1].date`, `span = min(nights, gap.span)`,
  `departDate = addDays(arriveDate, span - 1)` — the design's rule literally.
- `gap === null` → `longestOpenRun()`, i.e. today's behaviour, byte-for-byte.
  It is the **default**, so `scheduleFloating(trip, id)` still compiles and
  still means what it meant. That is the vet's i5 finding, closed.
- Guard I added (the design does not name it): a `startCol` outside the trip
  window returns the SAME trip object, matching the existing "no open day" case
  which callers already test with `toBe(t)`. `span` is also clamped to
  `days.length - start` so a stale gap can never produce a date past `endDate`.

### 2 · the gap reaches the handler

`apps/web/src/components/trip/Timeline.tsx:31` — `onSchedule` is now
`(stopId, gap: TimelineGap | null) => void`.
`apps/web/src/components/trip/Timeline.tsx:76` — `OpenSpan`'s `onDrop` already
closed over `g` and threw it away; it now calls `onSchedule(draggedId, g)`.
That is the whole plumbing change — no new state.

### 3 · the write + the toast

`apps/web/src/components/trip/TripPlanner.tsx:273` — `doSchedule(id, gap = null)`:

- `scheduleFloating(trip, id, gap)`; an identity return (nothing to land on) is
  an early return, so a dead drop raises no toast and sends no PATCH.
- persists **two fields only** — `tripApi.updateStop(id, { arriveDate,
  departDate })`. No `sortOrder`: `orderedLegStops()` sorts scheduled stops by
  `arriveDate` (`route-order.ts:38`), so the dates alone move Crater Lake ahead
  of Bend in the gantt, the route list and the drive pairs. The test at
  `planner.test.ts:410` asserts exactly that (sortOrder unchanged, order flipped).
- raises `toast.success("Scheduled <name> · <arrive> – <depart>")` with an
  **Undo** action that puts the pre-drop trip back and writes
  `{ arriveDate: null, departDate: null }` — the same "both null is Unschedule"
  the i3 stop contract already accepts. The undo's own failure rolls forward to
  the scheduled trip via the existing `persist()`.
- `apps/web/src/components/trip/TripPlanner.tsx:711` — the stop sheet's
  "Schedule" button is unchanged (`doSchedule(selectedStop.id)`); it now gets
  the toast too, which the design's own drop-table row for it implies.

### 4 · tests — `packages/core/src/planner/planner.test.ts`

- `:62 seedTrip()` — the **real seed trip** (`packages/db/src/seed.ts`) as a
  plain fixture: Aug 1–28, Astoria 08-02–05, Newport 08-05–09, Bend 08-12–16,
  Crater Lake floating. `:126 crater()` reads its `[arrive, depart]`.
- `:367` asserts the seed's gaps really are `[{1,1},{10,2},{17,12}]` — so the
  three acceptance cases below are anchored on the trip, not on numbers I typed.
- `:379` the three acceptance drops: Aug 1 → `08-01/08-01`, Aug 10–11 →
  `08-10/08-11`, Aug 17–28 → `08-17/08-19`.
- `:384` the 1-day gap yields `arrive === depart`; `:389` the `gap === null`
  **and** the omitted-argument fallbacks both give `08-17/08-19`; `:401` the
  `nights` clamp both ways; `:414` the out-of-window gap is a no-op; `:421` no
  input mutation.
- The four pre-existing `scheduleFloating` tests (`:337`–`:349`) are untouched
  and still pass on the 2-arg form — that is the "unchanged" claim, executed.

---

## Decisions, deviations and defaults — worth qa's eye

1. **Toast date format is the wireframe's, not `dateRange()`.** §7's toast reads
   `Aug 10 – Aug 11` and its drop table reads `Aug 1 – Aug 1`, i.e. both
   endpoints always. `dateRange()` (the gantt bar's formatter) would collapse
   those to `Aug 10–11` and `Aug 1`. I matched the wireframe copy —
   `` `${monthDay(a)} – ${monthDay(b)}` ``, `monthDay` re-exported from
   `@/lib/trip-ui` — rather than the bar formatter. **Claim for qa:** this is
   the deliberate choice, not an oversight; flip it to `dateRange` if the vet
   reads §7's toast as illustrative.
2. **Out-of-window gap guard** is mine, not the design's. A drop can only carry
   a gap the current render produced, so it should be unreachable; it exists so
   a stale gap degrades to "nothing happened" instead of `addDays(undefined)`.
3. **The early `next === undo` return** in `doSchedule` is new. Previously a
   no-op schedule silently did nothing anyway (the `arriveDate && departDate`
   guard); now it also suppresses the toast, which would otherwise lie.
4. **Undo is a toast action, not a dialog.** The design puts it in the toast
   (§7) and i4's notes already reserve the pattern for leaves. It re-uses
   `persist()` so the rollback semantics are the file's existing ones.
5. **No `sortOrder` write, and no new endpoint.** i3's widened
   `PATCH /api/stops/:id` already accepts the two dates; nothing in
   `packages/db` or `apps/web/src/app/api` was touched by this item.

---

## Flagged for the walk

- **FLAG (carried from the vet, still live): the drop must land on the intended
  gap.** `OpenSpan` is an HTML5 drop target positioned by `grid-column` inside
  `OpenLane`. That the `drop` event fires on the gap element under the pointer —
  not on a sibling span or the lane — is pointer behaviour static analysis
  cannot prove. Now that the gap *decides the dates*, a mis-targeted drop is
  visible (wrong dates) rather than silent. **Walk check:** drag Crater Lake
  onto the Aug 10–11 span; the bar must land on Aug 10–11 and the toast must
  read `Scheduled Crater Lake NP · Aug 10 – Aug 11`. Then drop on Aug 1 (a
  single-column target — the hardest one to hit) and on the 12-day tail.
- **Walk check: the Undo action.** Clicking Undo must return the card to the
  "Not yet scheduled" rail and leave the gantt as it was.
- **Walk check: the sheet's "Schedule" button is unchanged** — it must still
  take the longest run (Aug 17–19 on the seed trip).

---

## Not done, deliberately

- No i6 surface (reservations/ideas), no i1–i4 rework.
- No drag-and-drop library, no drag context, no `OpenSpan`/`OpenLane` change in
  `packages/ui` — the design's §7 note is explicit that the gap already reaches
  the handler and only needs passing through.
- No `sortOrder` PATCH (see §3 above).

---

## Checks run

| check | command | result |
|---|---|---|
| TDD red first | `pnpm exec vitest run src/planner/planner.test.ts` (in `packages/core`, before implementing) | `Tests  9 failed | 33 passed (42)` |
| TDD green | same command after implementing | `Test Files  1 passed (1)` · `Tests  42 passed (42)` |
| full gate | `pnpm turbo run lint typecheck test` | `Tasks:    8 successful, 8 total` |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files  18 passed (18)` · `Tests  283 passed (283)` |

`pnpm install --prefer-offline` was run first — this worktree had no
`node_modules` (`Done in 6.5s`).

**SKIPPED (no env):** no browser/runtime check — the drop target, the toast and
the Undo click are exactly the render-required surface the walk gate owns (the
three walk checks above). No database was touched: this item adds no query,
mutation, schema column or migration.

---
---

# dev notes — issue 40, item **i6** of 6

**Reservations and ideas, complete.** Scope is i6 only. i1–i5 are already on
this branch and nothing below re-opens them.

Design read: `mc/wireframe/issue-40-v0:docs/design/40/index.html` (§3 the three
weights — the sheet is the "heavy" one and keeps both leaves; §5 the leaf/undo
tier; §8 the contract table + the promote panel) and `plan.json` i6. Vet
verdict: `mc/vet/issue-40-v0:docs/design/40/vet-verdict.json`.

---

## What changed

### `packages/core` — the leaf write contract + the two forms

- **`src/domain/types.ts`** — four new schemas, all derived from the `reservation`
  / `idea` grammar rather than re-typed:
  - `reservationCreateInput` :227 — `pick(type, name, checkIn, checkOut,
    confirmationNumber, cost, notes) + { stopId: uuid, rating }`. It carries the
    **whole** row, not the four fields the add form used to collect, because a
    create is also what an undone DELETE re-POSTs (§5: "Undo re-POSTs the row").
  - `reservationPatchInput` :242 — the same field set `.partial()`; the widened
    PATCH.
  - `ideaCreateInput` :257 — `pick(title, status, place, notes) + { stopId, rating }`.
    `sortOrder` is deliberately absent: the server appends.
  - `ideaPromoteInput` :268 — `{ type: reservationType.default("activity") }`.
    The default is what keeps a body-less POST working.
- **`src/domain/leaf-form.ts`** (new) — the pure decisions the sheet makes, in
  the one package with a test runner:
  - `UNDO_WINDOW_MS = 6000` :29 — the design's six-second window.
  - `ReservationDraft` :33 / `BLANK_RESERVATION_DRAFT` :42 — the form's state.
  - `reservationCost()` :56 — `""` → `null` ("no cost recorded"), a bad value →
    `undefined` (which is what disables Save). `0` is a real, free reservation.
  - `reservationDraftInput()` :104 — the POST body, or `null` when not
    submittable. One rule for the body and for the disabled Save.
  - `reservationDraft()` :128 / `reservationDraftPatch()` :144 — the edit form's
    opening state, and the patch of **only** what moved (a sent `undefined`
    over a `.partial()` schema would be a phantom reset).
  - `reservationRestoreInput()` :167, `ideaDraftInput()` :187,
    `ideaRestoreInput()` :195 — the create bodies, including the two an Undo sends.
- **`src/planner/index.ts`** — the tree helpers the sheet applies:
  `appendReservation` :466, `removeReservation` :471, `setReservationFields` :483,
  `appendIdea` :520, `removeIdea` :525, `applyPromotion` (below).
  - **Replaced** the two dead helpers this item obsoletes: `addReservation`
    (minted a client-side uuid and could not carry checkOut/confirmationNumber)
    became `appendReservation`, which takes the row the 201 handed back — the
    same convention `appendLeg`/`appendStop` follow. `promoteIdea` (which
    hardcoded `type: "activity"`, the very thing i6 removes) became
    `applyPromotion(trip, stopId, ideaId, reservation)`. Neither had a caller.
- **`src/domain/index.ts`** — exports `./leaf-form`.

### `packages/db` — the leaf mutations

- **`src/mutations.ts`**
  - `assertOwnedStop()` :306 — the `createReservation` select-then-throw pattern,
    lifted so both creates share it. An INSERT has no WHERE to match zero rows,
    so ownership on a create is an explicit check, exactly as the vet required
    for i3's inserts.
  - `createReservation()` :324 — widened to the full field set; returns the core
    `Reservation` (via `mapReservation`) rather than the raw row.
  - `updateReservationFields()` :361 — widened from `{rating, notes}` to the full
    editable set, now returning `boolean` so the handler can answer 404. `cost`
    is the one column whose wire type (number) is not its stored type (numeric
    string), so it is converted on the way in; every other key passes through.
  - `deleteReservation()` :396, `deleteIdea()` :457 — owner-scoped deletes
    reporting whether they matched.
  - `createIdea()` :409 — appends the `sortOrder` inside one transaction (the
    read path orders on it), maps the place columns off `input.place`.
  - `promoteIdeaToReservation()` :472 — takes `type: ReservationType = "activity"`.
    The default is why the old zero-arg call site could not break.
- **`src/queries.ts`** — `mapReservation` :278 and `mapIdea` :310 are now
  exported, so a create/promote hands back the same shape the read path maps.

### `apps/web` — handlers, client, sheet

- **`api/reservations/route.ts`** — POST now parses `reservationCreateInput`
  (the shape was hand-rolled here; §8's "converted only where an item already
  edits them" applies — i6 edits it).
- **`api/reservations/[id]/route.ts`** — widened PATCH (204/400/404) + new DELETE
  (204/404).
- **`api/ideas/route.ts`** (new) — POST, 201 with the core `Idea`, 404 on a stop
  that is not the caller's.
- **`api/ideas/[id]/route.ts`** — new DELETE (204/404); PATCH untouched.
- **`api/ideas/[id]/promote/route.ts`** — optional `{ type }`. The body is read
  as `await req.json().catch(() => ({}))` because a body-less POST has no JSON
  to parse and the design requires that caller to keep working.
- **`lib/trip-api.ts`** :85–:111 — `createReservation` (typed
  `ReservationCreateInput → Reservation`), widened `updateReservation`,
  `deleteReservation`, `createIdea`, `deleteIdea`, `promoteIdea(id, type)`.
- **`components/trip/row-menu.tsx`** (new) — `RowMenu` / `MenuHint` /
  `MENU_SURFACE` / `MENU_ITEM` / `MENU_ITEM_WARN` lifted **verbatim** out of
  `RouteView.tsx` so the sheet's two new menus are the same object as the leg
  and stop menus, not a second design. `RouteView.tsx` now imports them.
- **`packages/ui/src/DetailCards.tsx`** — `ReservationCard` :29 and `IdeaCard`
  :105 take an optional `actions?: ReactNode` slot (end of the meta line / end
  of the header line). This is composition, not restyling: the DS renders what
  it is handed and still knows nothing about the verbs. Nothing else moves when
  `actions` is omitted.
- **`components/trip/StopDetailSheet.tsx`** — the sheet grew:
  - `StopLeafActions` :63 — one bundled prop for every leaf verb, the way
    `RouteViewActions` bundles the row-menu verbs. It **replaces** five props
    (`addOpen`, `form`, `onToggleAdd`, `onFormChange`, `onSubmitAdd`,
    `onPromote`), so the signature got shorter, not longer.
  - One form, two jobs (:221) — the add form and the full edit, six fields:
    Type, Cost, Name, Check-in :265, Check-out :274, Confirmation # :284. Save
    reads "Save reservation" or "Save changes" (:300) and is disabled by the
    same function that builds the body.
  - Reservation row menu (:322): **Edit…** (hint "form") · **Delete** (amber,
    hint "undo"). Idea row menu (:399): **Delete**. No confirm dialog on either
    leaf, per §5.
  - Ideas section now always renders its header + "Add" (a stop with no ideas is
    exactly where you add the first one); "Save idea" at :381.
  - "Book" opens a **Book as** picker (:418) instead of promoting silently.
- **`components/trip/TripPlanner.tsx`** — the handlers:
  `formTarget` state :164, `resetLeafForms()` :247, `openAddReservation` :520,
  `openEditReservation` :526, `submitReservationForm` :533,
  `doDeleteReservation` :566, `restoreReservation` :588, `submitIdea` :597,
  `doDeleteIdea` :612, `restoreIdea` :627, `confirmPromote` :640.
  Deletes are optimistic + `persist(p, undo, msg)` (i2's rollback wrapper) +
  a `toast.success(..., { duration: UNDO_WINDOW_MS, action: { label: "Undo" }})`.
  The local `mapRes()` row-shim is gone: every handler now returns the core
  shape from the server.

### Tests (TDD, `packages/core` — the only package with a runner)

- **`src/domain/leaf-form.test.ts`** (new, 18 tests) — the cost tri-state, the
  full POST body, the "only what changed" patch, the two restore bodies, the
  six-second constant, and every not-submittable case.
- **`src/domain/leaf-write-contract.test.ts`** (new, 11 tests) — what the
  handlers actually enforce: promote's `"activity"` default, `.partial()` never
  inventing a key, unknown keys (`id`, `stopId`, `ideaId`, `sortOrder`) stripped.
- **`src/planner/planner.test.ts`** :605 — a new block for the five tree helpers,
  including the append-after-remove that *is* the Undo, and immutability.

---

## The vet findings this item owed

- **MED · "the promote type picker's option count is undefined"** — resolved the
  way the vet reads it: the picker offers the **eight** `ReservationType`
  values, in the shipped `RES_TYPES` order (`StopDetailSheet.tsx:43`), because
  `categoryMeta` is an 8→5 collapse that does not invert. The design's "same
  five-category vocabulary" is honoured **in the labels**: `typeLabel()` :491
  renders each option as `"Stay · Campground"` / `"Eat · Dining"` — the
  five-category word the cards paint, next to the type the row actually stores.
  The same labels are used by the add/edit form's Type select, so the field has
  one vocabulary, not two. The design's worked example (`"dining"`) is
  producible; a five-option picker would not have been.
- The other MED findings were owed by i1/i3/i5 and are already resolved on this
  branch; nothing here re-opens them.

---

## Decisions, deviations and defaults — worth qa's eye

1. **`AddForm.dates` → `checkIn` + `checkOut`.** The acceptance line is
   "AddForm.dates reaches the API instead of being discarded". `dates` was a
   single `string` in state that **no input ever rendered** and `submitAdd`
   dropped (it sent `checkIn: null`). A single string cannot carry both
   `checkIn` and `checkOut`, which the same acceptance also requires ("every
   field on the core `reservation` schema is editable"), and the design names no
   parse grammar for one. So the vestigial key became the two real date fields
   it stood for, and both reach the API. `AddForm` survives as an alias of the
   core `ReservationDraft` (`TripPlanner.tsx:142`) so the sheet's import is
   unchanged. **If qa reads the acceptance literally as "a key named `dates`
   must be POSTed", this is the deviation to rule on.**
2. **Cost stays behind the `costTracking` switch.** The Cost field renders only
   when cost tracking is on — the shipped gate the add form already used, and
   the same one that blanks the cost on `ReservationCard`. So "every field is
   editable" holds *when the cost surface is on*; with it off, cost is neither
   shown nor lost: `openEditReservation` seeds the draft from the real row, so
   an untouched hidden cost simply never appears in the patch. Deliberate
   deference to the shipped pref rather than a new always-on field.
3. **Delete is optimistic AND toasted.** The row leaves the tree immediately,
   `persist()` rolls it back with an error toast if the DELETE fails, and the
   success toast carries Undo for 6s. If both fire (a failed delete) you get an
   error toast and a stale Undo — same shape as i5's `doSchedule`, which qa
   accepted; Undo in that case just re-POSTs a row that already exists,
   producing a duplicate rather than a loss. Flagged rather than special-cased,
   because the design specifies no third state.
4. **`updateIdeaFields` still returns `void`** and its PATCH still answers 204
   unconditionally. That is pre-existing and outside i6's named scope (the plan
   widens the *reservation* update, not the idea one). Left alone deliberately.
5. **Promote is a two-step gesture now.** "Book" opens the picker; a second
   click commits. The design's §8 panel shows the type travelling in the body
   but does not draw the control; an inline picker was chosen over a dialog
   because §3 puts reservations and ideas at the "heavy" weight (the sheet) and
   §10 warns against a second surface on the right edge.
6. **`RowMenu` extraction touches `RouteView.tsx`.** Only the deletion of the
   local copies and the import — the JSX, the class strings and the comments are
   byte-identical to what i4 shipped.
7. No new `rv-*` token, no raw hex, no shadcn `destructive` variant: the leaf
   delete item is `MENU_ITEM_WARN` (rv-warning), the Save buttons are `rv-ember`,
   exactly as §5 resolves.
8. **No schema change, no migration.** Both leaf tables already carry every
   column this item writes (`schema.ts:106–145`).

---

## Flagged for the walk (render-required — static analysis cannot settle these)

- **Radix menus portalled from inside the hand-rolled sheet.** This is the vet's
  FLAG, now real: `StopDetailSheet` is a `fixed inset-0 z-40` overlay whose
  backdrop carries `onClick={onClose}`, and the two new `RowMenu`s portal to
  `document.body`. Radix's `DropdownMenu` is modal by default (it disables
  outside pointer events while open), so the dismissing click should not reach
  the backdrop — but that is a runtime fact. **Check: open a reservation's ⋯,
  click away, and confirm the sheet is still open.**
- **The undo toast.** That the 6s `duration` holds, that "Undo" re-POSTs, and
  that the restored row lands back in the same section (with a new id).
- **The `<select>` inside the sheet's scroll container** — the native picker
  over a `z-40` overlay.
- **Native `<input type="date">` for check-in/check-out** inside the sheet.

---

## Not done, deliberately

- No place picker on ideas (`place` is always `null` from the form) — that is #23.
- No reservation reorder, no drag between stops: not in the design.
- No change to `ReservationCard`/`IdeaCard` styling, only the `actions` slot.
- No `packages/core/src/api-client` write methods — §10 gap 4 says writes go in
  `apps/web/src/lib/trip-api.ts` only.

---

## Checks run

| check | command | result |
|---|---|---|
| TDD red first | `pnpm vitest run src/domain/leaf-form.test.ts` (in `packages/core`, before writing `leaf-form.ts`) | `Error: Failed to load url ./leaf-form … Does the file exist?` · `Test Files  1 failed (1)` |
| TDD green | same command after implementing | `Test Files  1 passed (1)` · `Tests  18 passed (18)` |
| contract tests | `pnpm vitest run src/domain/leaf-write-contract.test.ts` | `Test Files  1 passed (1)` · `Tests  11 passed (11)` |
| full gate | `pnpm turbo run lint typecheck test` | `Tasks:    8 successful, 8 total` |
| unit tests | (same run, `@rv-trip/core:test`) | `Test Files  20 passed (20)` · `Tests  318 passed (318)` |
| lint | (same run, `@rv-trip/web:lint`) | clean — 0 errors, 0 warnings |

`pnpm install --prefer-offline` was run first — this worktree had no
`node_modules` (`Done in 6.4s`).

**SKIPPED (no env):** no browser/runtime check and no database check. Every new
handler and mutation needs a live Postgres to exercise; the four items under
"Flagged for the walk" are exactly the render-required surface the walk gate
owns.
