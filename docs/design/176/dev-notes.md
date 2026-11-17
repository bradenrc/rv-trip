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

---

# #176 · dev notes — item i2 of 3 (phone)

Scope: **[i2] Phone: the capture sheet opens on Been here for the whole trip, logs travel days to the shelf, and checks off a matching idea** (#174 · Q1 A · Q2 A · Q3 B · Q4 A · Q5 A · Q6 A). This builds on the i1 core functions and does not change them. Web (i3) is a later dispatch.

## What changed

`apps/mobile/src/store.ts`
- `:170` `useTodaysDestination` is now `useCaptureTarget()`. The hydrate/load effects are unchanged, and it returns core's `captureTarget(heldTrips, localIsoDate())`. The `todaysDestination` import is now `captureTarget`.
- `:186` `addProvisionalIdea(tripId, destinationId: string | null, idea)`: a null destination calls `appendShelfIdea`, so the row shows under "Around the trip" with no signal.
- `:214` `replaceIdea` (**vet HIGH**): one `swap` now maps or filters `t.ideas` (the shelf) as well as every destination's `ideas`. A travel-day capture's `cap_` row is replaced when the POST lands, and removed on Undo, instead of leaving a ghost.

`apps/mobile/src/ui.tsx:196` `Chip` gains `neutral?: boolean`. When `on`, it draws AgainPair's `seg2On` tone (`C.ink` border, `C.navySoft` fill, `C.ink` text). Every other Chip is unchanged.

`apps/mobile/src/journal.tsx:166` `LogCta` gains `label = "Log it"` and renders `✓ {label}`. The ✓ is the phone's own (**vet MED**: core's `logCtaLabel` carries no ✓, and the web footer draws none). The How-was-it sheet at `:149` passes no label, so it still reads "✓ Log it".

`apps/mobile/app/capture.tsx` (Confirm):
- The `target` prop is renamed `subject` (`:188`), because `target` is now the capture target, as the plan names it.
- `:206` `const target = useCaptureTarget()`. Status starts as `"did"` when the target is non-null, else `"want"`.
- `:211` an effect re-evaluates the status when the target resolves (the bundles may hydrate after the sheet opens), until a chip is touched (`pick` sets `touched`).
- `:311` the chip row:
  - Mid-trip: Been here (`"did"`) · Want to go, both `neutral`.
  - Outside a trip: Want to go · Been there, as shipped.
  - The old "Did it" chip is gone.
- Under Been here:
  - `didItContext(trip.title, destination?.place.name ?? null)`.
  - Stars at size 28, "Do it again?" and AgainPair.
  - The note ("For next time…").
  - `<LogCta label={logCtaLabel(trip.title)}>`.
  - `logHelperLine(writesThrough)` below the CTA. `writesThrough` is true for a place hit or a note with a fix, so a note with no fix gets the short line.
  - The style is the wireframe's `.helper`: 11, `C.inkMuted`, centred (`:686`).
- `submit()` (`:235`):
  - The match candidate is either the place hit (name, location, googlePlaceId) or the note (trimmed text, fix, no gid).
  - It is matched against `destination ? destination.ideas : trip.ideas` with `matchingOpenIdea`.
  - **On a match:** `updateTrip(setIdeaFields(t, match.id, checkOffBody(answers)))`, then `queuePatch("idea", match.id, patch, { tripTitle, undo })`. Undo restores `{ status, rating, again, notes }` as they were, both locally and through `queuePatch`, following the destination screen's `log` precedent.
  - **No match:** today's `didItBody` with `destinationId: target.destination?.id ?? null`, plus `addProvisionalIdea(tripId, destination?.id ?? null, …)`.
- Want to go mid-trip is still today's library save (`placeCaptureBody` / `noteCaptureBody`), unchanged.

## Tests
`packages/core/src/mobile-capture.test.ts:148` (source-reading precedent: `apps/mobile` has no runner). It pins:
- `useCaptureTarget` is used and `useTodaysDestination` is gone.
- The initial `"did"`/`"want"` state and the untouched re-evaluation.
- The neutral Been here · Want to go pair mid-trip, and Been there only in the no-trip branch.
- `logCtaLabel` → LogCta, `logHelperLine` and `didItContext(…, destination?.place.name ?? null)`.
- On a match: `matchingOpenIdea` over destination-or-shelf ideas, `checkOffBody` → `queuePatch("idea", match.id, patch, …)`, and the Undo before-state.
- `destination?.id ?? null` passed to both `didItBody` and `addProvisionalIdea`.
- `addProvisionalIdea` accepts null and calls `appendShelfIdea`.
- `replaceIdea` swaps both `t.ideas` and `s.ideas` (the vet HIGH).
- LogCta's default is "Log it" with the ✓ inside.
- Chip's neutral tone.

These are wiring assertions, not behaviour. The matching and body rules themselves are i1's unit tests.

## Flags for qa / the walk
- **Render-required:**
  - Neutral chip tone on device.
  - Offline Aug-10 capture: the shelf row appears under "Around the trip", then is replaced on reconnect, and Undo removes it.
  - Match check-off: there is no second row, and Undo restores the idea.
- The check-off's Undo sends a full before-state PATCH, including a `notes: null` / `rating: null` the idea already held. That matches the destination screen's `log`.
- The `capture.tsx` prop rename `target` → `subject` is internal only.

## Checks run (i2)
- `npx vitest run src/mobile-capture.test.ts` (packages/core):
  - Before the implementation: 9 failed, 20 passed. The new assertions were red first.
  - After the implementation: `Tests  29 passed (29)`.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`. The web suite reported 496 passed.
- `npx tsc --noEmit` (apps/mobile): exit 0.
