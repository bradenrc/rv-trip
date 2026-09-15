# Issue 81 · dev notes — item **i1 of 7** (households schema + migration + backfill)

Scope of this dispatch: `packages/db` only. Nothing in `apps/web/src/app/**`,
`apps/web/src/lib/owner.ts`, `packages/core` or `packages/ui` is touched — `getOwner()` still
returns `DEV_OWNER` (`"dev-user"`), which is i2's dispatch. Items i2–i7 are separate dispatches.

## What changed

| file:line | what |
| --- | --- |
| `packages/db/src/schema.ts:14-15` | `uniqueIndex`, `primaryKey` added to the `drizzle-orm/pg-core` import |
| `packages/db/src/schema.ts:363-367` | `households` — `id text pk`, `name text not null default 'My household'`, `created_at timestamptz` (doc comment from :345) |
| `packages/db/src/schema.ts:374` | `HouseholdRole = "owner" \| "member"` |
| `packages/db/src/schema.ts:390-404` | `household_members` — composite pk `(household_id, user_id)`, `user_id` unique, `role`, `joined_at`; FK → `households.id` on delete cascade |
| `packages/db/src/schema.ts:418-426` | `household_invites` — `token text pk`, `household_id` FK, `created_at`, `expires_at not null`, `redeemed_at` **nullable** |
| `packages/db/src/schema.ts:428-440` | three `relations()` declarations, matching the file's existing pattern |
| `packages/db/drizzle/0007_households.sql:1-25` | generated DDL (`pnpm drizzle-kit generate --name households`) |
| `packages/db/drizzle/0007_households.sql:26-66` | hand-appended backfill (the 0005 precedent for data statements in a migration) |
| `packages/db/drizzle/meta/0007_snapshot.json`, `meta/_journal.json` | drizzle's generated bookkeeping |
| `packages/db/src/reown.ts:29` | now **four** tables: `trips, savedPlaces, rigs, userPrefs` |
| `packages/db/src/reown.ts:31` | `.returning({ ownerId: t.ownerId })` — `user_prefs` has no `id` column (its owner IS the pk) |
| `packages/db/src/reown.ts:28` | default `--from` is now `dev-household` (see "defaulted" below) |
| `packages/db/src/seed.ts:5-17` | `HOUSEHOLD = "dev-household"`, `MEMBER = "dev-user"`, `OWNER = HOUSEHOLD` |
| `packages/db/src/seed.ts:26-33` | seeds the household + its one member row, both `onConflictDoNothing` |
| `packages/db/src/testing/truncate.ts:37` | the three new tables added to `truncateAll` |
| `apps/web/src/test/households-schema.test.ts` | new — 8 tests (2 file-level, 6 against the migrated database) |

## Key decisions

1. **The three tables are appended at the END of `schema.ts`, after `user_prefs`.** Not for
   style — so that every line number the design's dev notes cite (`trips :67`, `saved_places
   :194`, `rigs :226`, `user_prefs :336`, `saved_places.status :203`) stays valid for the i2–i7
   dispatches and for vet.

2. **No FK from the four `owner_id` columns to `households.id`.** Q2 = A is a value swap; a FK
   would be exactly the ALTER the survey rejected, and it would also require every route-test
   fixture's bare owner string to have a row first. `owner_id` stays a plain `text`.

3. **`households.id` is `text`, not `uuid`.** One household id has to be a literal the keyless
   app can name without a key (`dev-household`), which is what keeps walks and the apps/web
   route suite key-free. No DDL default: the creator supplies the id (i2/i3).

4. **The "index on user_id" IS the unique constraint.** The design asks for both `user_id
   UNIQUE` and an index on `user_id`; declared as one named `uniqueIndex`
   (`household_members_user_idx`) it is a single btree that satisfies both, and it follows the
   reasoning already written into this file at `rigs` — "a second index on a unique column is
   write cost for nothing". The generated DDL is `CREATE UNIQUE INDEX
   "household_members_user_idx" ON "household_members" USING btree ("user_id")`.

5. **`role` is `text` with `$type<HouseholdRole>()`, not a `pgEnum`.** The wireframe's column
   table says `role text not null 'owner' | 'member'`; this keeps the DDL literally that while
   TypeScript still narrows it. (The `user_prefs` comment is the in-file precedent.)

6. **The backfill is one `DO $$ … $$` block, not the four set-based statements the wireframe
   sketches.** The sketch is not executable as written: `gen_random_uuid()` cannot be correlated
   from the `households` INSERT back into the member row and the four UPDATEs across separate
   statements. The block does the same three steps per owner, in the migrator's transaction,
   and maps `dev-user → 'dev-household'` deterministically. **It repoints all four tables** —
   `trips`, `saved_places`, `rigs`, `user_prefs` — which is the §2 note about `reown.ts` having
   covered only three.

7. **The schema test lives in `apps/web`, not `packages/db`.** `packages/db` has no `test`
   script and no runner (design dev note 7), and adding vitest there would be scope creep
   against that note. `apps/web`'s harness creates a database and runs the **real**
   `packages/db/drizzle/` migrations (`src/test/global-setup.ts:44`), so it is the only runner in
   the repo where the shipped migration — not a hand-rolled `CREATE TABLE` — is what the
   assertions execute against.

## Defaulted / flagged

- **`reown.ts`'s default `--from` changed from `dev-user` to `dev-household`.** Strictly this is
  one token past "add `user_prefs`", but the seed now owns rows by the household id, so leaving
  the old default would make `pnpm db:reown <id>` silently report `0 re-owned` on every table.
  The CLI shape (positional target, `--from`) is unchanged.
- **`reown.ts` still takes a raw target id**, and post-#77 that id must be a *household* id, not
  a Clerk user id — the docstring now says so. Resolving a Clerk user id through
  `household_members` would need i2's lookup; **flagged for i2/i3** if the operator flow wants it.
- **`packages/db` typecheck only**, per the design: no test is claimed for that package.
- **`households` relations are declared but not yet consumed** — no query in `queries.ts` uses
  `db.query.households` until i3.
- **The shared local dev database at `localhost:5433` was deliberately NOT migrated or
  re-seeded.** Applying 0007 there would repoint every `owner_id` to `dev-household` while
  `getOwner()` still answers `dev-user` (that is i2), which would blank out every *other*
  issue's walk server running against the same database. `pnpm db:migrate && pnpm db:seed` on the
  dev DB is **operator-owned** and should be run once i2 has landed. Both were instead verified
  against throwaway databases (below), which were created and dropped by the check itself.

## Claims for qa to check

1. `0007_households.sql` contains **no `ALTER TABLE`** naming `trips`, `saved_places`, `rigs` or
   `user_prefs` — asserted in the test, and the only `ALTER`s in the file add the two FK
   constraints on the new tables.
2. The backfill repoints **four** tables, and `dev-user`'s rows land on the literal
   `dev-household`.
3. `truncateAll` now clears the three new tables, so tenancy rows cannot leak between test files
   (the last test in the new file asserts exactly that).
4. Nothing outside `packages/db` changed except the one new test file.

## Checks actually run

| command | result |
| --- | --- |
| `pnpm vitest run src/test/households-schema.test.ts` (in `apps/web`, **before** the schema) | `Tests 8 failed (8)` — RED, harness live (not skipped) |
| `pnpm drizzle-kit generate --name households` (in `packages/db`) | `[✓] Your SQL migration file ➜ drizzle/0007_households.sql` |
| `pnpm vitest run src/test/households-schema.test.ts` (after) | `Test Files 1 passed (1) · Tests 8 passed (8)` |
| backfill check — throwaway db `rvtrip_backfill_check_81`: migrate 0000–0006, plant `dev-user` + `user_2aBr` rows in all four owner tables, apply 0007 | `rows still owned by a PERSON: 0 OK` · `dev-user's trip now owned by: dev-household OK`; two households, two member rows |
| seed check — throwaway db `rvtrip_seed_check_81`: full migrate, then `tsx src/seed.ts` **twice** | `households [ { id: 'dev-household', name: 'My household' } ]` (one row after two passes) · `seeded owner_ids: [ { owner_id: 'dev-household' } ] OK` |
| `pnpm turbo run lint typecheck test` (repo root) | `Tasks: 10 successful, 10 total` · `Test Files 26 passed (26) · Tests 168 passed (168)` |

Both throwaway databases were dropped by their own check; `git status` shows only the files in
the table above.

---

# Issue 81 · dev notes — item **i2 of 7** (`getOwner()` answers the household; `getActor()` answers the member)

Scope of this dispatch: the tenancy seam only. **No file under `apps/web/src/app/**` is in the
diff** — the 37 `await getOwner()` call sites are untouched, which is the whole argument for
Q2 = A. Items i3–i7 are separate dispatches; nothing here renders, routes or migrates.

## What changed

| file:line | what |
| --- | --- |
| `apps/web/src/lib/owner.ts:14-15` | `DEV_OWNER` keeps its value `"dev-user"` — it is now the **person**, what `getActor()` answers |
| `apps/web/src/lib/owner.ts:17-25` | new `DEV_HOUSEHOLD = "dev-household"` — the **tenant**, what a keyless `getOwner()` answers |
| `apps/web/src/lib/owner.ts:50-54` | `getOwner()` → keyless returns `DEV_HOUSEHOLD`; keyed resolves `getActor()` through `ensureHouseholdForUser`. Still `Promise<string>`, still the same export name |
| `apps/web/src/lib/owner.ts:66-71` | new `getActor(): Promise<string>` — the Clerk `userId`, or `DEV_OWNER` keyless. It inherits the old `getOwner()` body verbatim, including the "no session" throw |
| `packages/db/src/mutations.ts:1` | `randomUUID` from `node:crypto` |
| `packages/db/src/mutations.ts:46-53` | the file header's "`owner` is the Clerk userId" corrected — it is the household id from #77 on |
| `packages/db/src/mutations.ts:850-908` | new tenancy section: `householdIdFor()` (private) + exported `ensureHouseholdForUser()` |
| `packages/db/src/testing/fixtures.ts:31-40` | `DEV_OWNER` **value** → `"dev-household"` (name and every import site unchanged) |
| `apps/web/src/lib/owner.test.ts` | new — 9 tests: 3 keyless (no database), 6 keyed against the real database |

## Key decisions

1. **The lookup lives in `packages/db`, not in `owner.ts`.** `apps/web` never touches drizzle
   outside its tests — every route imports a named function from `@rv-trip/db` — so
   `ensureHouseholdForUser()` is a mutation beside the ones i4 will add there
   (`redeemHouseholdInvite`, `householdIsEmpty`, per plan i3/i4). `owner.ts` stays the single
   seam: it is still the only place `apps/web` asks who the tenant is.

2. **`@rv-trip/db` is imported DYNAMICALLY, and only on the keyed branch** (`owner.ts:52`).
   `apps/web/src/proxy.ts:3` and `app/layout.tsx:9` import `clerkEnabled` from this module; a
   static import would drag the pg pool — and `packages/db/src/index.ts:6-8`'s module-scope
   `throw` on an unset `DATABASE_URL` — into the proxy bundle, which needs neither. The keyless
   branch therefore never loads the database module at all (asserted: "writes nothing on the
   keyless branch").

3. **`getOwner()` is wrapped in React's `cache`** — the vet's MED "undecided cost of the seam".
   It became a read-through-with-a-possible-write on a function called several times per request
   (`api/places/[id]` in both PATCH and DELETE, `api/prefs/route.ts:22` and `:30`,
   `trips/[id]/page.tsx:18` above every mutation under it), so the lookup is deduped **per
   request**. Verified against `react@19.2.4`: with no dispatcher — a direct handler call in
   vitest, or a non-React server path — `cache` calls straight through
   (`node_modules/react/cjs/react.react-server.development.js:575-578`), so nothing is memoized
   across tests or across requests, and a household joined in i4 is never served stale.

4. **The lazy create is idempotent and race-safe without a transaction** — the vet's other MED.
   SELECT; on a miss insert the household, then insert the member row with
   `.onConflictDoNothing().returning()`. The `user_id` unique index (`household_members_user_idx`,
   i1) is the arbiter: exactly one concurrent caller gets a row back. The loser **deletes the
   household it just minted** — nothing references it, since the member row was never written —
   and re-reads the winner's id. Both callers return the same string and no orphan household is
   left behind (asserted: "settles two concurrent first sights on ONE household").

5. **`fixtures.ts`'s `DEV_OWNER` changed VALUE, not name.** It is the string that goes in an
   `owner_id` column, and that column now holds a household — so `"dev-household"` is simply what
   it always meant. Keeping the name is what lets **every existing route test stay byte-for-byte
   unchanged**, `api/prefs/route.test.ts` included, and still key-free. Nothing in `apps/web`'s
   suite hard-codes `"dev-user"` (checked by grep); the four `"dev-user"` literals in
   `packages/core` tests are plain fixture strings in pure-logic tests and are unaffected.

6. **Bare `randomUUID()` for a new household id**, matching what 0007's backfill mints with
   `gen_random_uuid()`. The wireframe's `hh_7fd2…` is sample data, not a prefix to ship (design
   dev note 8) — a prefix here and none in the backfill would give one product two id shapes.

7. **The keyed branch is tested with the suite's ONE `vi.mock`.** `#30`'s "zero mocks" rule is
   about route handlers; the auth seam itself cannot be exercised without a key, and stubbing
   `auth()` in this one file is precisely what keeps keys out of every other file. The keys are
   set with `vi.stubEnv` and dropped in `afterEach` (`clerkEnabled()` is read per call, which
   `owner.ts:6-7` already documents as the supported way to flip it).

## Defaulted / flagged

- **FLAG · the per-owner search rate limit is now per-HOUSEHOLD.**
  `apps/web/src/app/api/places/search/route.ts:48` keys its 30-searches/60s token bucket on
  `getOwner()`, so two co-pilots now share one budget instead of having one each. That follows
  from the value change alone — the call site is untouched, as i2's acceptance requires. It is
  arguably the right meaning (the quota protects one Google bill), but it IS a behaviour change
  and the decision is not written anywhere in the design. If it should be per-person it is a
  one-word swap to `getActor()` — deliberately **not** made here, because it would edit a call
  site this item promises not to touch.
- **FLAG · the walk needs a migrated + re-seeded database.** Keyless `getOwner()` now answers
  `dev-household` while pre-0007 rows are still owned by `dev-user`, so a walk server pointed at
  a database that has not had 0007 applied will render an **empty world** — trips, places, rig
  and prefs all invisible. The fix is `pnpm db:migrate && pnpm db:seed` against that database.
  I did **not** run it on the shared `localhost:5433` dev database: 0007 repoints `dev-user` →
  `dev-household`, which would blank out every *other* issue's walk server still running pre-i2
  code (i1's note, same reasoning, and the machine-conduct rule). **Operator-owned**, and it is
  now due — i1 deferred it precisely until i2 landed.
- `apps/mobile/src/api.ts:16` and `auth.ts:12` describe the keyless API as serving "the seeded
  `dev-user`". Comments only, no code depends on it; left alone as out of this item's scope.
- **No `getActor()` consumer exists yet** — it is exported and tested, and i5 is what passes it
  into the four mutations. `lint`'s no-unused-exports is not configured, so nothing complains.

## Claims for qa to check

1. `git diff --name-only` contains **no path under `apps/web/src/app/`** — no call site was
   edited, and `apps/web/src/app/api/prefs/route.test.ts` is not in the diff at all.
2. `getOwner` is still exported with type `() => Promise<string>` (the `cache()` wrapper
   preserves it — `tsc --noEmit` passes with all 37 call sites unchanged), and `getActor` is
   exported alongside it.
3. The keyless branch performs **zero** database work: no import of `@rv-trip/db` is evaluated
   and no row is written (the "writes nothing on the keyless branch" test asserts both tables
   are still empty afterwards).
4. Nothing outside `apps/web/src/lib/owner.ts`, `packages/db/src/mutations.ts` and
   `packages/db/src/testing/fixtures.ts` changed, plus the one new test file.

## Checks actually run

| command | result |
| --- | --- |
| `pnpm vitest run src/lib/owner.test.ts` (in `apps/web`, **before** the implementation) | `Tests 9 failed (9)` — RED, harness live (e.g. `getActor is not a function`) |
| `pnpm vitest run src/lib/owner.test.ts` (after) | `Test Files 1 passed (1) · Tests 9 passed (9)` |
| `pnpm turbo run lint typecheck test` (repo root) | `Tasks: 10 successful, 10 total` · `Test Files 27 passed (27) · Tests 177 passed (177)` |
| `pnpm turbo run lint typecheck --force` (repo root, cache bypassed) | `Tasks: 7 successful, 7 total · Cached: 0 cached` |

Not run: `pnpm db:migrate` / `pnpm db:seed` against the shared dev database (flagged above as
operator-owned). The test suite creates and drops its own database per run.

---

# Issue 81 · dev notes — item **i3 of 7** (Settings → Household card + the invite endpoints)

Scope of this dispatch: the `/settings` surface and the three household routes. Items i4–i7 are
separate dispatches — nothing here touches `/join`, `change_log`, `lastChange` or `ChangeByline`,
and `apps/web/src/proxy.ts` is not in the diff.

## What changed

| file:line | what |
| --- | --- |
| `packages/db/src/queries.ts:563-643` | new household section: `HouseholdMemberRow`, `LiveHouseholdInvite`, `HouseholdOverview`, `DEFAULT_HOUSEHOLD_NAME:593`, `getHouseholdOverview():610` — the ONE read `/settings` makes |
| `packages/db/src/queries.ts:1` | `isNull` added to the `drizzle-orm` import |
| `packages/db/src/queries.ts:14-25` | the three household tables + `HouseholdRole` added to the schema imports |
| `packages/db/src/mutations.ts:914` | `INVITE_TTL_DAYS = 14` — the window the card's copy promises |
| `packages/db/src/mutations.ts:920` | `inviteToken()` — `randomBytes(8).toString("base64url")`, 11 URL-safe chars |
| `packages/db/src/mutations.ts:950` | `createHouseholdInvite()` |
| `packages/db/src/mutations.ts:975` | `cancelHouseholdInvite()` |
| `packages/db/src/mutations.ts:995` | `RemoveMemberResult` — `"removed" \| "not_a_member" \| "is_owner"` |
| `packages/db/src/mutations.ts:1007` | `removeHouseholdMember()` |
| `packages/db/src/mutations.ts:1-2` | `randomBytes` from `node:crypto`; `ne` from `drizzle-orm`; `householdInvites` imported |
| `packages/db/src/index.ts:17` | `export type { HouseholdRole }` — so a caller names a role without reaching into `schema` |
| `apps/web/src/app/api/household/invites/route.ts` | new — `POST` → `201 { token, expiresAt }` |
| `apps/web/src/app/api/household/invites/[token]/route.ts` | new — `DELETE` → `204` \| `404` |
| `apps/web/src/app/api/household/members/[userId]/route.ts` | new — `DELETE` → `204` \| `404` \| `409` |
| `apps/web/src/components/settings/household-view.ts` | new — the card's pure half: `householdCardState():35`, the wireframe's copy `:45-72`, the UTC date labels `:77-90`, `memberView():123`, `inviteView():163` |
| `apps/web/src/components/settings/HouseholdCard.tsx` | new — `"use client"`, `HouseholdCardProps:43`, `HouseholdCard():56`, `PILL_TONE:167`, `MemberLine:175`, `PendingLine:216` |
| `apps/web/src/lib/members.ts` | new — `describePeople()`, the Clerk seam that turns user ids into names + emails |
| `apps/web/src/components/settings/SettingsForm.tsx:8` | imports `HouseholdCard` |
| `apps/web/src/components/settings/SettingsForm.tsx:34-43` | takes a second prop, `household: HouseholdCardProps` |
| `apps/web/src/components/settings/SettingsForm.tsx:122` | `<HouseholdCard {...household} />` — the fourth group |
| `apps/web/src/components/settings/SettingsForm.tsx:140 · :148 · :160` | `GroupKicker` / `Card` / `Row` are now **exported** (bodies unchanged); `Row`'s `children` is optional `:167` |
| `apps/web/src/app/settings/page.tsx:35` | reads `getHouseholdOverview(await getOwner())` beside the prefs read |
| `apps/web/src/app/settings/page.tsx:41-63` | resolves names, builds the card's props |
| `apps/web/src/app/settings/page.tsx:75` | `requestOrigin()` — the invite link's host, from the request |
| `packages/core/src/settings-page.test.ts:66-80` | the existing source-text seam test, updated + extended (see "what I had to touch") |
| `apps/web/src/components/settings/household-view.test.ts` | new — 16 tests, the three states + the copy + the labels |
| `apps/web/src/test/household-overview.test.ts` | new — 7 tests against the real database |
| `apps/web/src/app/api/household/**/route.test.ts` | new — 16 tests across the three handlers |

## Key decisions

1. **The card's every DECISION is a pure function in `household-view.ts`, not a branch in the
   TSX.** This is the vet's MED "acceptance assumes a runner that isn't wired", answered for i3:
   there is no DOM environment anywhere in this repo (`apps/web/vitest.config.mts` is
   `environment: "node"`; no jsdom, no happy-dom, no @testing-library in any package.json), so
   "renders all three states purely from its props" cannot be proved by rendering. It is proved
   instead as `householdCardState({ memberCount, hasInvite })` plus the exported copy constants,
   all executed by `household-view.test.ts` on the runner that exists. `HouseholdCard.tsx` holds
   no conditional that file does not cover. **i7 should take the same shape** — the verb
   derivation as a pure function, the JSX as a thin shell.

2. **`GroupKicker` / `Card` / `Row` are exported from `SettingsForm.tsx` rather than copied.**
   Plan i3 says "composed with the GroupKicker/Card/Row shapes already in SettingsForm.tsx" —
   re-declaring them would let the fourth card drift from the other three on the next tweak. Their
   bodies are byte-identical; only `Row.children` became optional (`:167`), because two of the
   three states open with a label + help line and no control, and the old signature required a
   child. The empty `<div className="mt-[9px]">` is now skipped rather than rendered, so a
   label-only row does not carry 9px of phantom padding.
   **Note for vet/qa:** design dev note 6 cites `SettingsForm.tsx:126 · :136 · :154`. Those three
   are now `:140 · :148 · :160` — pushed down by the added import and the widened props object.
   Same code, new line numbers.

3. **Names and emails come from Clerk, in one place, and never fail the page.** The wireframe
   renders "Braden · braden@example.com", but `household_members` stores only the membership —
   no name column, by design. `apps/web/src/lib/members.ts` is the seam: `clerkEnabled()` false →
   no call at all and an empty map; keyed → one `clerkClient().users.getUserList({ userId })`;
   any throw → an empty map. `memberView()` then falls back to the **user id in both slots**, so
   every state still renders. A settings page whose other three cards need no network must not
   500 because the Backend API was slow. `@clerk/nextjs/server` is imported **dynamically**, the
   same care `owner.ts` takes with `@rv-trip/db`. **i6 needs `memberName` for the same people —
   it should reuse `describePeople()` rather than grow a second lookup.**

4. **Dates are formatted on the SERVER, in UTC, through core's `monthDay`.** The card is
   `"use client"`, so a `Date` formatted inside it with a local-time formatter would render one
   day on the server and possibly another in the browser — a hydration mismatch on a settings
   page. Every label ("joined Sep 13", "created Sep 12 · expires Sep 26") is a finished string by
   the time it crosses the boundary, and `joinedLabel(new Date("…T23:30:00Z"))` is asserted to
   stay on the 13th.

5. **"Live invite" is read with the APP's clock, not Postgres's.** `createHouseholdInvite` writes
   `created_at` explicitly and derives `expires_at` from that same `new Date()`, so "expires 14
   days after it was created" is a property of the row rather than of how long the insert took —
   and `getHouseholdOverview` filters `expires_at > new Date()` rather than `> now()`. Two clocks
   would disagree by exactly the amount `apps/web/src/test/setup.ts` freezes the JS one (this is
   what the first run of `returns the live invite` failed on: PINNED_NOW is 2026-08-15, Postgres's
   `now()` is today, so every fixture invite read as already expired).

6. **One live invite per household.** A second POST deletes the household's previous *unredeemed*
   invite inside the same transaction and inserts a fresh one. The card draws "the" invite, and a
   link that looks superseded but still redeems is the worse surprise. **Redeemed rows are left
   alone** — that timestamp is how the household knows the seat was taken and is what i4's
   one-use check reads.

7. **`createHouseholdInvite` lazily creates the `households` row.** Keyless, `getOwner()` answers
   the literal `dev-household` without ever looking it up (i2), so on a migrated-but-unseeded
   database the invite's foreign key has nothing to point at. Same lazy-create reasoning as
   `ensureHouseholdForUser`, and `getHouseholdOverview` is symmetrical: a missing household row is
   answered as a named, empty household, never a 500.

8. **Removing the owner is a 409, not a 404.** They plainly exist; the removal is refused because
   Q2 = A moved the rows to the HOUSEHOLD — a household with no members would still own every
   trip, place and rig, with nobody who could reach them. The role is read in the same
   `DELETE … WHERE role <> 'owner' RETURNING` statement (then one SELECT only to tell the two
   refusals apart), so the refusal cannot race a concurrent delete. Everything else — unknown
   token, another household's token, an already-redeemed token, a member of another household —
   is one indistinguishable 404, on purpose: the response must not tell whoever holds a URL that
   it names a real invite somewhere else.

9. **Two members beat a live invite.** `householdCardState` returns `"shared"` whenever
   `memberCount > 1`, even with an unredeemed invite outstanding. #77 is a couple, not a group
   (the v1 spec's exclusion stands), so once the second person is in there is no seat for a
   pending link to fill.

10. **Green appears exactly once.** Per the wireframe's own finding (`conventions.md` says green
    is the CTA; the shipped app says accent), the invite CTA is `bg-rv-accent-deep` /
    `text-rv-accent-ink` like every other CTA in the app, and `rv-green` is spent only on the
    "joined" pill — the verified/done meaning `StatusPill` already reserves it for. The two pill
    tones are written out as whole class strings in `PILL_TONE` (`HouseholdCard.tsx:167`) because
    Tailwind scans source text and would never generate a class name assembled from a variable.
    No raw hex anywhere; every colour is an `rv-*` utility named verbatim from
    `packages/ui/styles/entry.css`.

## What I had to touch outside the new files

`packages/core/src/settings-page.test.ts` (from #45/#38) asserts the settings page's SOURCE TEXT.
Two of its claims were made false by this item and are updated rather than deleted:

- `"<SettingsForm prefs={prefs} />"` → `"<SettingsForm prefs={prefs}"`. The component genuinely
  takes a second prop now; the assertion that the prefs row is threaded through is intact.
- `getPrefsByOwner(await getOwner())` is **unchanged and still literal in the page** — I
  deliberately did not hoist `const owner = await getOwner()`, so that guard keeps biting.
  `getOwner()` is memoized per request (i2), so asking twice costs one lookup.
- One test ADDED in the same describe: the household is read on the same server seam
  (`getHouseholdOverview(await getOwner())`, `household={{`, still no `"use client"`).

## Defaulted / flagged

- **FLAG · the token is 11 characters, not the wireframe's 8.** `7fD2QK4N` is sample data (design
  dev note 8). `randomBytes(8).toString("base64url")` gives 11 URL-safe characters over 64 bits —
  short enough to read out loud, long enough that a one-use link living 14 days cannot be found by
  guessing. The field wraps (`flex-wrap`), so the extra three characters do not change the row's
  shape. If the drawn width is load-bearing, say so and it is a one-line change.
- **FLAG · the invite link's origin comes from the request headers**
  (`settings/page.tsx:75`) — `x-forwarded-host` / `host`, with `x-forwarded-proto` and an
  http-for-localhost fallback. Not an env var: this app answers on preview URLs, on
  roadvalet.com and on localhost, and a link naming the wrong one is worse than no link.
  **Unverified behind Vercel's proxy** — that header pair is exactly what a walk on a preview
  deployment should look at.
- **FLAG · `describePeople()` is UNEXERCISED here.** It is typechecked against
  `@clerk/backend@3.17.1`'s `getUserList`/`User` and it cannot throw out of the page, but no test
  in this repo can hold a Clerk secret key, so the actual Backend API call has never run. Keyed
  QA/walk: a member whose name renders as `user_2abc…` rather than "Jess" means this call failed
  and fell back — the card is still correct, just unnamed.
- **FLAG · the Household card is render-required at the walk.** Nothing static can certify the
  three states side by side at 390px and 1280px, the disabled keyless CTA, `router.refresh()`
  redrawing after each action, or the clipboard write (which needs a secure context — on
  `http://` over a LAN IP `navigator.clipboard` is undefined and the toast fires instead).
- **The card was NOT rendered in a browser by this dispatch.** Same reason i1 and i2 gave: the
  shared dev database at `localhost:5433` is still pre-0007, and migrating it would repoint every
  `owner_id` to `dev-household` and blank out every other issue's walk server. `pnpm db:migrate &&
  pnpm db:seed` on that database remains **operator-owned** and is now overdue — i3's keyless
  solo state cannot look right until `dev-household` and its `dev-user` member row exist. A full
  `next build` was run instead (below), which is what proves the client-module cycle
  `SettingsForm → HouseholdCard → SettingsForm` resolves; it does, and all three routes register.
- **Not implemented, because the design names no surface for it:** renaming the household. The
  shared state renders `households.name`, which is `"My household"` until something writes it.
  The wireframe's "Callahan household" has no edit affordance drawn anywhere, so no endpoint was
  invented. Worth a later issue.
- **`DELETE /api/household/members/[userId]` is reachable by the co-pilot for the owner** only to
  be refused (409); a member removing *themselves* is allowed by the same route. That is a leave
  action rather than a remove, and the card never draws a button for it (`Remove` is suppressed on
  your own row) — flagged because the ROUTE permits what the UI does not offer.

## Claims for qa to check

1. `HouseholdCard.tsx` contains **no `fetch` on mount and no `useEffect`** — the only network
   calls are in click handlers, and every prop is finished by the server.
2. **No raw hex and no invented token** in `HouseholdCard.tsx`: every colour is `rv-*`, and every
   one of them appears in `entry.css`'s `@source inline(...)` list at `:12`.
3. The three routes each resolve the household through `getOwner()` and pass it into the WHERE —
   asserted by a test per route that plants a row under `OTHER_OWNER` and shows it survives.
4. `expiresAt - createdAt === 14 days` is asserted on the ROW, not on the response.
5. `git diff --name-only` contains no `apps/web/src/proxy.ts`, nothing under `packages/ui/`, and
   no `ds-bundle/`.

## Checks actually run

| command | result |
| --- | --- |
| `pnpm vitest run` on the 5 new test files (apps/web, **before** the implementation) | `Test Files 5 failed (5) · Tests 7 failed (7)` — RED, harness live (`getHouseholdOverview is not a function`) |
| `pnpm vitest run src/components/settings/household-view.test.ts` (after) | `Test Files 1 passed (1) · Tests 16 passed (16)` |
| `pnpm vitest run src/test/household-overview.test.ts src/app/api/household` (after) | `Test Files 4 passed (4) · Tests 23 passed (23)` |
| `pnpm turbo run lint typecheck test` (repo root) | `Tasks: 10 successful, 10 total · Cached: 0 cached` · apps/web `Test Files 32 passed (32) · Tests 216 passed (216)` |
| `DATABASE_URL=<placeholder> pnpm build` (apps/web) | build succeeded; `ƒ /api/household/invites`, `ƒ /api/household/invites/[token]`, `ƒ /api/household/members/[userId]`, `ƒ /settings` |

Not run: any browser render, and `pnpm db:migrate` / `pnpm db:seed` against the shared dev
database (flagged above as operator-owned). The route suite creates and drops its own database.
