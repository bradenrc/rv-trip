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
