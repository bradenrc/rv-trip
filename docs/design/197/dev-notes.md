# #197 · dev notes — i1 (#193): core seam + the phone Place screen

This dispatch covers item **i1 of 4** only. i2 (edit/delete), i3 (entry points) and
i4 (web `/places/[id]`) are separate dispatches. The pixel target is
`docs/design/197/index.html` on `mc/wireframe/issue-197-v0` (§2 frames 1–4, §6 contract).

## What changed

**Core**
- `packages/core/src/providers/navigation.ts:164` adds `navigateLinksForPlace(place)` beside
  `navigateLinks` and reuses `coord()`. A Google id plus a point gives Google
  `destination=<name>&destination_place_id=<id>`, and Apple/Waze get the point plus `q=<name>`.
  Coordinates only gives the same result as `navigateLinks`. No lat/lng gives `null`.
- `packages/core/src/providers/drill.ts` (new) is `drillDoors` / `drillGroupLabel` / `DrillDoor` /
  `DrillGroup` / `DrillDoorId` / `DrillInput`, moved from `packages/ui/src/drill.ts`. Each door
  gains a visible `label` (`:50`): Google, AI Mode, Images, Reddit, Instagram, Facebook, Yelp,
  Tripadvisor, AllTrails, YouTube, The Dyrt, Campendium. Core reads the category word from its
  own `categoryOf` (`theme/tokens.ts`), not ui's `categoryMeta`. It is exported through
  `providers/index.ts`.
- `packages/ui/src/drill.ts` now re-exports those names from `@rv-trip/core`. `DRILL_MARKS` and
  `drillMarkId` stay there. Web imports of `drillDoors` from `@rv-trip/ui` are unchanged and
  compile.
- `packages/core/src/api-client/index.ts:196,319` adds `places.details(googlePlaceId)` for
  `GET /api/places/details/[id]`. The schema is `placeDetailsSchema` / `placeDetailsEnvelopeSchema`
  (`api-client/schemas.ts:96`). The four details fields default to `null`, so a row cached before
  #91 still parses.
- `packages/core/src/capture/place-screen.ts` (new, exported from `src/index.ts`) holds the
  screen's copy: `placeScreenMeta` ("Eat · Bellingham, WA"), `placeSourceLine` ("from Jane & Rick"
  / "dropped pin · Nov 13"), `placeTripLine` ("Bellingham · Nov 11–15 →"), `placeGoogleLine`
  ("G ★ 4.6 · 1,284 reviews") and `placeTelUrl`. This puts it where vitest runs, since
  `apps/mobile` has no runner (vet MED).

**Phone**
- `apps/mobile/app/place/[id].tsx` (new) is the Place screen. It finds the save in `useSaves()`,
  so no new route is needed. Top to bottom:
  - header: `CategoryTile` 40, the name, and the mono meta line;
  - **Go**: three navy-soft buttons, then Call and Website only when details carry them, then
    "On the map", which goes to `/map` with a `place` param;
  - the locate `Suggestion` in Go's slot when the links are `null` and the save has a suggestion;
  - **Yours**: the Been/Want switch writes `patchSave {status}`. On the been shelf, `Stars` with
    `onSet` writes `patchSave {rating}` (0 becomes null), and `AgainBadge` sits beside it. Then the
    note, the accent trip link (navigates to `/trips/<tripId>`, with dates from `useTrips()`), and
    the source line;
  - **What others say**: the phone twin of `GoogleLine`, with ① the line plus "Google Maps ↗",
    ② "G — checking…", ③/④ nothing. Then core's doors, grouped google · social · category word,
    as text chips with the ✦/▦ badge.
- `apps/mobile/app/_layout.tsx:43` registers `place/[id]` on the root Stack beside `capture`,
  with `headerShown: false`.
- `apps/mobile/src/places.tsx` (new) is the shipped `Suggestion` strip, moved out of
  `app/(tabs)/saves.tsx` so both screens share one component. Its behaviour and styles are
  unchanged.

**Tests**
- `providers/navigation.test.ts` pins the exact URLs for a Google-id place and a coordinates-only
  place, checks that the coordinates-only result equals `navigateLinks`, and checks `null` with no
  lat/lng (including an id with no point).
- `providers/drill.test.ts` (new) checks the counts Eat 8, Stay 9, Do 9 (Travel/Other 6), that
  every label is non-empty, the exact label lists, and the group words.
- `packages/ui/src/drill.test.ts` passes unchanged through the re-export. A new check asserts that
  core's category word equals `categoryMeta(type).cat` for every `reservationType`.
- `api-client/api-client.test.ts` covers the details URL and method, the degraded envelope, and
  the defaulting of an old cached row.
- `capture/place-screen.test.ts` (new) covers every copy helper.
- `mobile-place-screen.test.ts` (new) reads the route file as source. It checks that the file
  exists and is registered, that the blocks read core's helpers, the block order, and that no raw
  hex is used.
- `mobile-capture.test.ts` now reads the strip's `patchSave` calls from `src/places.tsx`.

## Decisions, defaults and deferrals
- **Edit and Delete are not on the screen yet.** Both are i2 (#194). Delete must come with its
  Undo toast, a host the toast can render on (vet HIGH) and `C.destructive`, which does not
  exist until i2 adds `RV.destructive`. Shipping Delete without Undo would lose data, so i1 ends
  at What others say. i2 adds Edit to the top bar and Delete at the end of the body.
- **Back label.** The design labels the back button with the screen you came from ("‹ Places",
  "‹ Map", "‹ Trip"). Entry points are i3, so the screen reads an optional `from` search param
  and falls back to **"‹ Back"**. i3's pushes should pass `from`.
- **"On the map"** navigates to `/map?place=<id>`. The Map tab starts reading that param in i3,
  in an effect keyed on the param, per the vet MED. Until then it lands on the Map tab with no
  pin selected.
- **Not-found copy** ("This place is no longer in your library.") was defaulted, because the
  design names the state but not its words. The loading and error states copy the Places tab.
- **An id without a point** returns `null`, so there is no Go block. Apple and Waze have nothing
  to navigate to, and the row is three equal buttons or none. This edge case is rare: Google
  saves normally carry coordinates.
- **Trip link.** If the trips list has not loaded, or the trip is not in it, the link reads
  "<tripName> →".
- **Area line** is chosen as `area.name ?? areaLabel ?? region`.
- **Door locality** is `save.region`, per the `DrillInput` doc.

## For qa / the walk
- The Go deep links need a render check (vet FLAG): Google's `destination_place_id` + name, and
  whether Apple and Waze honour `q=`. `Linking.openURL` hand-off was not exercised on a device
  here.
- The keyed G line, Call and Website need a real Places key. With no key the screen should look
  like frame 2: no G line, and "On the map" alone in the second row.
- No entry point pushes `/place/[id]` yet (that is i3). To walk it, open `/place/<saveId>`
  directly, for example with `npx uri-scheme open <scheme>://place/<id>` or an Expo Router link.

## Checks run
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. Core reported
  `Tests 1628 passed (1628)`, ui `Tests 56 passed (56)` and web `Tests 598 passed (598)`.
- `apps/mobile`: `npx tsc --noEmit` exited 0 (also part of the turbo typecheck).
- Not run: no simulator walk. The phone render is the walk's.

---

# #197 · dev notes — i2 (#194): Edit and Delete on the phone

This dispatch covers item **i2 of 4** only. The pixel target is `docs/design/197/index.html` on
`mc/wireframe/issue-197-v0` §3 frames 5–8, with the vet findings applied (below).

## What changed

**Core**
- `packages/core/src/theme/tokens.ts:52` adds `RV.destructive = "#ff6467"`. This is globals.css's
  dark `--destructive`, `oklch(0.704 0.191 22.216)` (Tailwind v4 red-400), converted to hex
  because React Native reads no oklch.
- `packages/core/src/theme/tokens.test.ts`: `MIRROR` is now
  `Record<Exclude<keyof typeof RV, "destructive">, string>`, because entry.css has no
  `--rv-destructive` (vet MED). A new test reads globals.css's `.dark` `--destructive`, converts
  the oklch with an inline OKLCH→sRGB function (Ottosson's matrices, clamped), and asserts it equals
  `RV.destructive`. A second assertion pins the literal `#ff6467`.
- `packages/core/src/capture/place-screen.ts:84-96` holds the copy:
  - `removedToast(name)` gives "Removed <name>";
  - `RESTORED_TOAST` is "Restored, with its rating, note and shelf";
  - `DELETE_OFFLINE_TOAST` is "Deleting needs a connection";
  - `EDIT_OFFLINE_NOTICE` is "Editing needs a connection. Nothing is saved offline."

  `capture/place-screen.test.ts` pins all four.

**Phone**
- `apps/mobile/src/store.ts:284` `deleteSave(id)` drops the row from `state.saves` at once (the
  web's ⋯ menu does the same), calls `api.places.remove`, then `loadSaves()` in a `finally`, so a
  refused delete puts the row back. It throws on failure.
- `apps/mobile/src/store.ts:299` `restoreSave(save)` calls
  `api.places.create(savedPlaceToCreate(save))`, then `loadSaves()`, and returns the **new** row.
- `apps/mobile/src/ui.tsx:283-330` `Toast` gains an optional `onView`, drawn as "View" before Undo
  in the same ink.
- `apps/mobile/src/capture.ts:61` `ToastTone` gains `removed`, `restored` and `needs-signal`. This
  third tone is Delete's offline refusal: frame 8 draws it amber with "!", which differs from
  `removed`'s ⌫. `CaptureToast.onView` is added. New exports at `:182-204`:
  `announceRemoved(name, undo)`, `announceRestored(view)` and `announceDeleteNeedsSignal()`.
- `apps/mobile/src/toast-host.tsx` (new) is `CaptureToastHost`, the toast host moved verbatim out of
  `app/(tabs)/_layout.tsx` with its `TOAST_GLYPH`. It adds ⌫ / ↺ / ! and an `AMBER` tone set. The
  full-area tap-to-dismiss now also stands down when the toast has View. `(tabs)/_layout.tsx:159`
  mounts it unchanged in behaviour.
- `apps/mobile/app/place/[id].tsx`:
  - The top bar gains **Edit** on the right (`:101-111`, `.ptop .edit`).
  - The body ends with **Delete place** in `C.destructive` (`:232-235`, `.del`).
  - `remove()` (`:77-93`): offline, it calls `announceDeleteNeedsSignal()` and stays. Online, it
    keeps the save drawn (`gone`, so there is no "no longer in your library" flash while the screen
    pops), then `back()`, then `deleteSave`. On success it shows "Removed <name>" with Undo. Undo
    calls `restoreSave`, then shows "Restored…" with View, which calls
    `router.push('/place/<new id>')`.
  - `EditSheet` (`:248`) is built on the shipped `Sheet` / `Label` / `Input` (`src/hops.tsx`). It
    is seeded by `savePlaceFormFromSaved` and saves `editPlacePatch(form)` through `patchSave`. It
    is mounted only while open, so every open re-seeds and Cancel discards.
  - `CaptureToastHost` is also mounted on this screen (`:136`, vet HIGH).
- `.design-sync/conventions.md:40-43` gains the destructive line: destructive is the colour of
  Delete and nothing else. On the web that is shadcn `destructive`; on the phone it is
  `C.destructive`.

**Tests**
- `packages/core/src/mobile-place-edit-delete.test.ts` (new) reads the phone source, because
  `apps/mobile` has no runner (vet MED). It checks:
  - `RV.destructive` exists and is the screen's only `C.destructive`, on Delete;
  - conventions.md names the role;
  - `deleteSave` and `restoreSave` have their shapes;
  - `Toast.onView` draws before Undo;
  - the tone union and the host's glyphs and amber set;
  - the host is mounted on both the tabs and the Place screen;
  - the Edit seed and patch path, and that the sheet has no Rating or Shelf;
  - both offline refusals, the online Delete order, and no raw hex.

  **Honest limit:** these tests show the code is wired. They do not run the store against a
  server. The store's behaviour on a device is the walk's.

## Vet findings → what I did
- **HIGH · Rating and Shelf on the Edit sheet:** left off. The sheet is Name · Category · Note,
  which are exactly the fields `editPlacePatch` sends. Rating and shelf are written by the Yours
  block (`patchSave`), as the web edit sheet does. Frame 5 draws them, so this is a deliberate
  departure from the drawing.
- **HIGH · the offline Delete toast under the Place screen:** the host is now its own component
  and is mounted on the Place screen too. While the Place screen is on top, the toast draws there.
  After `back()`, the tabs' host draws it.
- **MED · RV.destructive and the mirror test:** excluded from `MIRROR` and asserted separately
  against the oklch→hex conversion of globals.css:260. That conversion gives `#ff6467`, which I
  verified independently.
- **MED · test coverage claim:** the store has no runner. The coverage is source-level, as stated
  above.
- HIGH journal rows, HIGH/MED web cards and SheetShell, and MED map-param: these are i3 / i4, not
  touched here.

## Defaults and flags for qa / the walk
- **Category field.** Frame 5 draws a plain field box reading "Eat". I drew the web edit sheet's
  five-category row as `Chip neutral` over `SAVE_SHEET_TYPES`, using the same rule: the row picks the
  category, so a "lodging" row under Stay keeps its type. Name and Note are the shipped `Input`.
  Because `Input` fixes its own style, the Note field does not get frame 5's 44pt minimum height.
- **Save button.** The design says the accent pair (`rv-accent-deep` + `rv-accent-ink`). Core `RV`
  has no `accentInk`, so I used the phone's shipped accent `Button` (accent fill, navy text) rather
  than inventing a token. Offline it reads "Save · offline" (frame 8), disabled.
- **A failed online delete.** The design has no copy for this. The row comes back through the
  refetch, and the amber "Deleting needs a connection" toast shows on the tab you returned to. A
  failed Undo re-save shows nothing, and the library refetch is the truth.
- **The removed toast appears after DELETE answers**, not at the moment you tap. This avoids an
  Undo racing an in-flight delete. The row leaves the list immediately.
- **Offline detection** is the capture runtime's NetInfo `online` flag (`useCaptureState`).
- **View on the restored toast** pushes `/place/<new id>` with no `from`, so its back label reads
  "‹ Back".
- **Map tab selection after a delete.** `map.tsx` resolves the selected save from the refetched
  list, so a deleted pin's card simply disappears. No code change.
- **Walk checks:**
  - the sheet rides above the keyboard;
  - Edit → Save updates the screen;
  - Delete returns to the tab with the amber ⌫ toast;
  - Undo → green ↺ with View → the restored place;
  - in airplane mode, Delete shows the amber "!" toast **on the Place screen** and Edit shows the
    notice with Save dead.

## Checks run
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. Core reported
  `Tests 1644 passed (1644)`, ui `Tests 56 passed (56)` and web `Tests 598 passed (598)`.
- `apps/mobile`: `npx tsc --noEmit` exited 0 with no output. This is also part of the turbo
  typecheck.
- Not run: no simulator or device walk.

---

# #197 · dev notes — i3 (#195): every way into the Place screen on the phone

This dispatch covers item **i3 of 4** only. The pixel target is `docs/design/197/index.html` on
`mc/wireframe/issue-197-v0` §4 frames 9–12, with the vet findings applied (below). i4 (web) is
not touched.

## What changed

**Core**
- `packages/core/src/capture/place-screen.ts:107` adds `saveForJournalEntry(entry, saves)`. It
  returns the save a Journal entry opens, or `null`. A `JournalEntry` carries only a name, so
  this is `isAlreadySaved`'s rule applied by name only: it runs
  `isAlreadySaved({name, lat:null, lng:null, googlePlaceId:null}, [matchCandidateFromSaved(s)])`
  over each row and returns the first match in library order. It returns `null` while Places is
  unloaded.

**Phone**
- **Places rows** (`apps/mobile/app/(tabs)/saves.tsx:388-418`): each library row is a
  `Pressable` that pushes `{ pathname: "/place/[id]", params: { id, from: "Places" } }`.
  - Pressing a row gives it the `rv-navy-soft` press state (`rowPressed`, `:613`).
  - Each row ends with a `›` in `inkSubtle` at 14 (`.lrow.press` / `.lrow .chev`).
  - The suggestion strip stays outside the rows, with its own Upgrade and Dismiss buttons.
- **Map tab** (`apps/mobile/app/(tabs)/map.tsx`):
  - The saved-pin card is a `Pressable` (`:166-183`). It pushes `/place/[id]` with
    `from: "Map"` and ends with **Open →** in `C.accent` (`.mcard .go`, `:290`).
  - The destination card is unchanged and still shows **Trip →** in `greenInk`.
  - `:55-63` reads the `place` search param with `useLocalSearchParams`, in an effect keyed on
    the param rather than on mount (vet MED). The effect resets the filter to **All**, selects
    the pin, then clears the param with `router.setParams({ place: undefined })`.
  - `:117-120` clears `selectedId` once the selected pin has neither a destination nor a save
    behind it, for example after a delete.
- **Journal entries** (`apps/mobile/src/journal.tsx:562-630`), following the vet HIGH:
  - `EntryRows` reads `useSaves()` and calls `saveForJournalEntry(e, saves)` for each entry.
  - The **row tap is the shipped one**: it selects the pin (#179), then opens "How was it?".
  - A matched entry also draws a **›** as its own nested `Pressable`. It pushes `/place/[id]`
    with `from: "Trip"`, has `hitSlop` 10, and shows a navy-soft press state.
  - An unmatched entry draws no ›.
- **Saved capture toast** (`apps/mobile/src/capture.ts:281-289`): the green `saved` tone now
  passes `onView`. It dismisses the toast, then pushes `/place/[id]` with `id: mine.id`, which is
  the same id as its `undoId`. The toast shows "View · Undo". The host from i2 already forwards
  `onView`. The `queued`, `journal-queued` and `synced` tones get no View.

**Tests**
- `capture/place-screen.test.ts` adds `saveForJournalEntry` cases:
  - a normalized-name match;
  - a save with coordinates still matching an entry that has none;
  - no match, unloaded Places, and an empty library all return `null`;
  - with a duplicate name, the first row wins.
- `mobile-place-entry-points.test.ts` (new) reads the phone source, because `apps/mobile` has no
  runner. It checks:
  - each of saves/map/journal pushes `/place/[id]`, with its `from`;
  - the row press state and › tokens;
  - Open → in accent, and Trip → kept;
  - the place-param effect's shape (keyed on `place`, selects it, clears it);
  - the gone-selection clear;
  - the Journal › appears only on a match, and the shipped row tap is kept;
  - the saved toast's `onView`, and that no queued tone has View.

## Decisions, defaults and deferrals
- **The Journal row departs from frame 11 / the task's literal wording** ("push on the entry,
  no press state when unmatched"). I followed the vet HIGH instead. The row already opens the
  shipped log/edit sheet, so only the › goes to the Place screen. Unmatched rows keep the shipped
  row press (opacity) because that tap still opens "How was it?". The only thing they lack is the
  ›.
- **The Journal match is by name only.** Two saves with the same normalized name resolve to the
  first one in library order. A Journal entry whose name differs from its save's name (for
  example, edited later) gets no ›.
- **`EntryRows` calls `useSaves()`.** On a trip screen opened before Places has loaded, this
  starts one `GET /api/places`. The › appears once the library arrives.
- **"On the map" resets the Map filter to All.** That guarantees the pin is drawn, which the
  user's Been there / Want to go / One trip filter might not. If the place has no coordinates, it
  has no pin, and the gone-selection effect clears the selection, so the tab lands with no card.
- **Back labels:** Places → "‹ Places", Map → "‹ Map", Journal → "‹ Trip" (the design's words).
  The toast's View passes no `from`, so it reads "‹ Back", the same as i2's restored View.
- **Open → colour.** Open → is `C.accent` (wireframe `.mcard .go`). The shipped Trip → stays
  `greenInk`, so the two cards' arrows differ in colour, as drawn.

## For qa / the walk
- Places: tap a row and the Place screen opens with "‹ Places". Back returns to the same scroll
  position, shelf and chip. Tapping the suggestion strip still upgrades or dismisses it and does
  not open the place.
- Map: tap a save pin → the card reads "Open →" → the Place screen opens with "‹ Map". From the
  Place screen, "On the map" lands on the Map tab with that pin selected, including when the Map
  tab was already mounted and when a filter was hiding the pin. Deleting the selected place then
  returning to the Map tab shows no stale card.
- Journal: a logged entry whose name is in Places shows ›. Tapping › opens the place
  ("‹ Trip"). Tapping the row body still opens "How was it?". An entry not in Places shows no ›.
- Capture: an online save shows "Saved … · View · Undo", and View opens the new place. Offline,
  the save shows the amber queued toast with no View.
- `router.setParams({ place: undefined })` clearing the param on a tab screen is expo-router
  behaviour that needs a render check, because static analysis cannot prove it.

## Checks run
- Full `pnpm turbo run lint typecheck test` (first run): `Tasks: 9 successful, 10 total`.
  - Every lint and typecheck task passed, including `apps/mobile`'s typecheck.
  - Core reported `Tests 1661 passed (1661)`.
  - `@rv-trip/web:test` printed `Tests 598 passed (598)`, then `ELIFECYCLE`. That failure is
    mine: on a loaded machine the suite was quiet for more than 5 minutes, I took it for a hang
    and killed my own run by PID before vitest exited.
- `pnpm turbo run lint typecheck test --filter='!@rv-trip/web'`: `Tasks: 6 successful, 6 total`.
  Core reported `Tests 1661 passed (1661)` and ui `Tests 56 passed (56)`.
- `apps/web`, `npx vitest run`: `Test Files 65 passed (65)`, `Tests 598 passed (598)`, exit 0.
  It took 87 s of test time. This branch does not touch web code.
- `apps/mobile`, `npx tsc --noEmit`: exit 0, with no output.
- Not run: no simulator or device walk.
