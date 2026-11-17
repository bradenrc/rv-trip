# #176 · dev notes — item i1 of 3 (core only)

Scope: **[i1] Core: captureTarget, the shelf-aware Did-it body, and the open-idea match** (#174 · Q1 A · Q2 A · Q3 B · Q5 A).
Items i2 (phone) and i3 (web) are later dispatches. This change touches only `packages/core`. There is no schema change: `IdeaCreateInput.destinationId` is already nullable.

## What changed

`packages/core/src/planner/journal.ts`
- `:13`: imports `isAlreadySaved` / `MatchCandidate` from `domain/places` (no cycle; `places.ts` does not import from `planner`).
- `:400` `captureTarget(trips, today)`: `activeTrip(trips, today)`, then `todaysDestination([trip], today)?.destination ?? null`. A null trip gives null. A changeover keeps the arriving destination and a floating destination never matches, both inherited from `todaysDestination`. Same generic bound as `todaysDestination`.
- `:410` `candidateOfIdea` (private): `idea.place ?? { name: idea.title, lat: null, lng: null, googlePlaceId: null }`.
- `:420` `matchingOpenIdea(ideas, c)`: filters out `status === "done"`, sorts a copy by `sortOrder` (stable, so input order breaks ties), and returns the first that `isAlreadySaved(c, [candidateOfIdea(i)])` matches, else null.
- `:429` `didItContext(tripTitle, destinationName: string | null)`: null reads `JOURNAL_AROUND_HEADING` and gives "Pacific Northwest Loop · Around the trip · today". The existing caller (`apps/mobile/app/capture.tsx:278`) passes a string and is unchanged.

`packages/core/src/capture/sheet.ts`
- `:210` `didItBody`'s `where.destinationId` widens to `string | null` (null means a shelf idea). The body logic is unchanged and passes it through.
- `:256` `checkOffBody(a): IdeaPatchInput` is `{ status: "done" }`. It adds `rating` and `again` only when non-null, and `notes` (trimmed) only when non-blank.
- `:266` `logCtaLabel(tripTitle)` returns "Save to <tripTitle>". There is no ✓: per vet MED, the ✓ prefix is the phone's to add (i2).
- `:271` `CAPTURE_MIDTRIP_CHIPS = ["Been here", "Want to go"] as const`.
- `:277` `logHelperLine(writesThrough)` returns "In the trip’s Journal today, and on your Been there shelf." or "In the trip’s Journal today.".
- Exports: both files are already `export *`'d from the core index (`planner/index.ts` → `./journal`, `src/index.ts` → `./capture/sheet`), so every new symbol is exported from `@rv-trip/core` without an index edit.

## Tests
- `packages/core/src/planner/journal.test.ts:292`: `captureTarget` runs over the §1 table on the `pnwTrip()` seed (Astoria Aug 2–5, Newport Aug 5–9, Bend Aug 12–16, Crater Lake floating):
  - Aug 7 → (trip, Newport)
  - Aug 5 → Newport (arriving)
  - Aug 10 → (trip, null)
  - Aug 20 → (trip, null)
  - Sep 3 → null
- `:325`: `didItContext` with a name, and with null.
- `:332`: `matchingOpenIdea`:
  - a gid match on an open idea returns it
  - the same idea once done returns null
  - a name-only match on a coordless idea returns it (a different name does not)
  - two matches return the lower sortOrder, in either input order
- `packages/core/src/capture/sheet.test.ts:212`:
  - `didItBody` with `destinationId: null` parses through `ideaCreateInput` with `destinationId` null.
  - `checkOffBody({rating:null, again:null, note:"  "})` is exactly `{ status: "done" }`. A full answer trims the note and parses through `ideaPatchInput`.
  - `logCtaLabel`, `CAPTURE_MIDTRIP_CHIPS` and both `logHelperLine` strings match.

## Decisions / flags
- **Apostrophe**: the helper line uses the curly `’` ("trip’s"), as the task text spells it and as the other sheet copy does ("you’re"). The wireframe HTML (§2 frames, lines ~463/512) shows a straight `'`. qa: confirm the curly one is wanted.
- **TDD order (honest)**: I wrote the implementation and the tests in the same pass rather than watching each test fail first. The tests do exercise the new code; the vitest run below covers them.
- No vet finding in the feedback targets i1. The HIGH (`replaceIdea` over `trip.ideas`) and the MED web findings belong to i2 and i3.

## Checks run
- `npx vitest run src/planner/journal.test.ts src/capture/sheet.test.ts` (packages/core): 57 passed.
- `pnpm install --frozen-lockfile` was needed first, because the fresh worktree had no node_modules.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`.
  - core: 1436 tests passed.
  - web: 496 tests passed.
  - ui: 55 tests passed.
