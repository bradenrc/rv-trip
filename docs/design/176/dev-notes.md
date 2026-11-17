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

---

# #176 · dev notes — item i3 of 3 (web)

Scope: **[i3] Web: + Capture opens the PlaceSheet in capture mode over any page** (#175 · Q7 B · Q1 A · Q2 A · Q3 B · Q4 A · Q5 A · Q6 A). This builds on i1's core functions and leaves the phone (i2) untouched.

## What changed

`packages/core/src/capture/sheet.ts`
- `:274` `pickedDidItBody(where, picked, answers)`: the web's Been here `POST /api/ideas` body, built from a `PickedPlace`.
  - title is `placeOf(picked).name`.
  - category is `ideaCategoryOfSaveType(reservationTypeOfGoogle(primaryType))`; a typed name has no type, so it files as a Do.
  - `place` is `placeOf(picked)`.
  - `destinationId` may be null (the shelf).
  - There is no `clientId`. The plan described this as "didItBody-shaped fields"; I put it in core so it is unit-tested.
- `:294` `checkOffUndo(idea)`: the before-state `{ status, rating, again, notes }` that the check-off's Undo PATCHes back.

`apps/web/src/lib/trip-api.ts:59,66`: adds `listTrips(): TripSummary[]` and `getTrip(id): { trip, routes, rigHash, hasRig }` (**vet MED**: the client contract was missing). Note that `GET /api/trips/:id` runs `routeTrip` (cache-backed) on every sheet open.

`apps/web/src/lib/captured.ts` (new): the `CapturedDetail` union. It carries one more kind than the plan named:
- `idea`
- `idea-patch`
- **`idea-removed`** `{ tripId, id, destinationId }`, added for the vet MED about Undo (see below)
- `place`

`apps/web/src/components/places/SheetShell.tsx:13`: the `SUBMIT_TONE` map, with `accent` (`bg-rv-accent-deep text-rv-accent-ink`) and `green` (`bg-rv-green text-rv-navy`).
- Each fill and its ink sit on one source line, because the nightfall sweeps are line-based (**vet MED**).
- `:36`: `submitTone = "accent"` is the default, so the /places sheets are unchanged.

`apps/web/src/components/places/PlaceSheet.tsx`
- `:23` `CaptureContext`, and `:64` `capture?: CaptureContext | null`, plus `logging`, `answers`, `onLogging` and `onAnswers`. Absent `capture` means the /places sheet, byte-for-byte as before, with no switch.
- `:89` the status switch, the DS `SegmentedControl`, under Place:
  - Mid-trip it is Been here · Want to go. Choosing Want to go also resets `form.status` to want.
  - With `capture === null` it is Want to go · Been there, bound to `form.status`, so the footer hint follows it.
- `:117` the Been here body:
  - Place, then the switch.
  - The mono `didItContext(trip.title, destination?.name ?? null)` line, at `-mt-2`, as the frame's `margin-top:-8px`.
  - "How was it": `<Stars size={26} onSet>`. 0 maps to null.
  - "Do it again?" with `AgainPair`.
  - Note, with the placeholder "For next time…".
- The Been here copy comes from the §3 frames (**vet MED**): kicker = trip title, title "Capture", hint "saves to · journal", submit `logCtaLabel(trip.title)` with no ✓, `submitTone="green"`.
- `:163` the library body: kicker is the trip title and the title is "Capture" mid-trip. With no trip it is "Your saves" and "Save a place", per the Sep 3 frame. The submit is "Save to library", accent.
- `:245` `AgainPair`: two buttons through `toggleAgain`. Off is `border-rv-border-hi bg-rv-surface text-rv-ink-muted`. Again on is `border-rv-ink bg-rv-navy-soft text-rv-ink`. Once was enough on is `border-rv-warning bg-rv-warning-soft text-rv-warning`. The labels are the wireframe's: "↻ Again", "⊖ Once was enough".

`apps/web/src/components/places/CaptureSheet.tsx` (new, `"use client"`)
- `:63` on open:
  - `activeTrip(await listTrips(), localIsoDate())`.
  - Then `captureTarget([bundle.trip], localIsoDate())` over `getTrip`.
  - When a target arrives it switches to Been here, unless the switch was already touched (the phone's i2 rule).
  - A failed fetch leaves the no-trip library form.
- `:91` `submitLog`:
  - It runs `matchingOpenIdea(destination ? destination.ideas : trip.ideas, placeOf(picked))`.
  - **On a match:** `PATCH checkOffBody`. Undo PATCHes `checkOffUndo(match)` back.
  - **No match:** `POST pickedDidItBody({ destinationId: destination?.id ?? null })`. Undo DELETEs the created idea.
  - Both paths show `toast.success(journalToast.title, { description: trip.title, action: Undo })`.
- `:141` `submitLibrary`:
  - It sends `savePlaceBody(form, areaLabel)`.
  - The area-label logic is **duplicated** from PlacesWorkspace: asked once, on a free-text pick.
  - Then it emits `place` and shows a `savedToast(place)` toast.
- Every write and every Undo then dispatches `rv:captured`. The sheet closes on success, and nothing navigates.

`apps/web/src/components/nav/Nav.tsx`
- `:112` + Capture is now a `<button type="button">` with the same classes, plus `cursor-pointer border-none`.
- `:46` the TABS Capture entry is `href: null`, rendered as a `<button>` (`:142`). `LINKS` is typed `href: string` (`:33`).
- `:156` `<CaptureSheet>` is mounted as a **sibling after both `dark` `<nav>`s**, never inside one (**vet MED**).

`apps/web/src/components/trip/TripPlanner.tsx:~285-304`: a listener that applies changes only when `d.tripId === t.id`:
- `idea` → `appendIdea` / `appendShelfIdea`
- `idea-patch` → `setIdeaFields`
- `idea-removed` → `removeIdea` / `removeShelfIdea`

`apps/web/src/components/places/PlacesWorkspace.tsx:~84-95`: a listener that **appends** the place (**vet MED**: shipped is append, not the wireframe's "prepend") and de-dupes by id.

## Decisions on the vet findings
- **Undo stale page (MED):** fixed. Undo dispatches `idea-removed` for a create, or `idea-patch` with the before-state for a check-off.
- **Library save toast (MED):** I chose to show a `savedToast` copy toast ("Saved X" · "→ area · Want to go"), with **no Undo**. The capture sheet closes over a page that may not show the library, so it needs a confirmation; the /places island's own sheet still shows none. The save logic is duplicated in CaptureSheet, not extracted, so PlacesWorkspace is left as it was.
- **Copy (MED):** threaded through `capture`, as listed above.
- **logCtaLabel ✓ (MED):** the web footer renders no ✓, as the frame shows.
- **Sweep-safe tone (MED):** each pair is on one line, and the nightfall-tokens suite passes.

## Flags for qa / the walk (render-required)
- The sheet over /trips/:id, /map and /places, in both themes.
  - The sheet is mounted outside the dark islands. The SheetShell header is still the shipped `bg-rv-navy text-rv-ink`, which this item does not change.
- sonner's Undo action on both paths, and the planner's Journal row appearing, then disappearing on Undo.
- **Loading flip:** until the two GETs answer, the sheet draws the no-trip form ("Your saves" / "Save a place"). It then switches to Been here and the trip kicker. A brief flip is expected.
- **Edge:** if Been there is picked before the trip resolves, the mid-trip switch then shows "Want to go" while `form.status` is still `been`, so the hint reads "saves to · been".
- A check-off's Undo does not remove the Been there write-through that the PATCH route made. This matches the phone.
- A Been here capture of a typed name (free-text pick) is a coordless Do with no `areaLabel`.

## Tests
- `packages/core/src/capture/sheet.test.ts:242`: `pickedDidItBody` (Google pick on a destination; typed name on the shelf; both parse through `ideaCreateInput`) and `checkOffUndo` (parses through `ideaPatchInput`). Red first: 3 failed before the implementation.
- `apps/web/src/components/nav/nav.test.ts:74,83,132,142`:
  - Capture is `href: null` and renders as a `<button>` calling `setCapturing(true)`.
  - + Capture is a `<button>` (not a `Link` to /places) carrying `bg-rv-green` and `text-rv-navy`.
  - `CaptureSheet` is mounted once, after the last `</nav>`.
  - The two old assertions failed before they were updated.
- `packages/core/src/web-shell.test.ts:96`: the TABS hrefs are now 4 and Capture is `href: null`.
- `apps/web/src/components/places/capture-sheet.test.ts` (new, 24 source-reading tests). It covers:
  - `activeTrip(list, localIsoDate())` and `captureTarget([bundle.trip], localIsoDate())`.
  - `matchingOpenIdea` before PATCH vs POST.
  - `destinationId: destination?.id ?? null`.
  - Both Undos, and `rv:captured` for every write and Undo.
  - The two `SegmentedControl` option sets, and the Been here body and copy.
  - SheetShell's default accent and the one-line pairs.
  - The TripPlanner and PlacesWorkspace listeners, and the trip-api reads.
  - I mutation-checked one: changing `?? null` turns it red.
- These are wiring assertions; nothing renders. Behaviour is proven by core's unit tests plus the walk.

## Checks run (i3)
- `npx vitest run src/capture/sheet.test.ts` (packages/core):
  - Before the implementation: `3 failed | 23 passed`.
  - After the implementation: `26 passed (26)`.
- `npx vitest run src/components/nav/nav.test.ts` (apps/web): the 2 old Capture assertions failed after the Nav change. After the update: `23 passed (23)`.
- `npx vitest run src/components/places/capture-sheet.test.ts` (apps/web): `24 passed (24)`. With `?? null` mutated it gives `1 failed`; the mutation was reverted.
- `npx tsc --noEmit` (apps/web and packages/core): clean.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`.
  - core: 1448 passed.
  - web: 522 passed.
  - ui: 55 passed.
- Not run: any render or browser walk. The walk flags above cover it.
