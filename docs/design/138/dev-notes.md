# #138 dev notes — item i1 of 5 (#140 · Q1 A): Android sheets ride up on the keyboard

Only item i1 is in this dispatch. Items i2 to i5 are separate dispatches.

## What changed

- `apps/mobile/src/hops.tsx:177`: in `Sheet`, the `KeyboardAvoidingView` `behavior` was
  `Platform.OS === "ios" ? "padding" : undefined`. It is now
  `Platform.OS === "ios" ? "padding" : "height"`. The `maxHeight: "88%"` cap, the inner
  `ScrollView` (`keyboardShouldPersistTaps="handled"`) and every Modal prop are unchanged. No new
  dependency.
- `apps/mobile/src/hops.tsx:153-161`: rewrote the doc comment. It used to say "Android already
  resizes the window (adjustResize), so it gets no behavior". It now says the RN Modal is its own
  window, adjustResize never reaches it, and so Android needs `height`.

Every Sheet-based form picks this up without its own change: How was it?, Add stay ×2, Round
trip, Hop booking, Add stop and Add idea.

## Tests / coverage

- No automated test covers this. `apps/mobile` has no vitest runner (the vet MED finding), and the
  change is a single platform-conditional prop in a component, with no pure logic that could move
  into `packages/core`. The evidence is typecheck plus the walk.
- `pnpm turbo run lint typecheck test` ran: `Tasks: 10 successful, 10 total`. The `--dry=json` run
  confirms that `@rv-trip/mobile#typecheck` is one of those tasks.
- `pnpm --filter @rv-trip/mobile exec tsc --noEmit` printed `MOBILE_TSC_OK`.

## For the walk (render-required, vet FLAG i1)

On the Android emulator, open the 9-field Round trip sheet and the Add stay search and focus the
lowest field. The sheet should lift above the IME, stay within the 88% cap, and let the inner
ScrollView reach every field. On iOS, check that nothing changed (still `padding`).

---

# #138 dev notes: item i2 of 5 (#141 · Q2 A · Q3 B). Silent save failures now show an alert

Only item i2 is in this dispatch. i1 (above) had already landed and was not changed.

## What changed

- `apps/mobile/src/hops.tsx:61`: `failed(what)` is now `export const failed`, with the same
  Alert text: "Didn’t save" / "<what> — check your connection and try again.". A one-line doc
  comment sits above it.
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/stops/[stopId].tsx:33`: this file imports `failed` from
  `src/hops` now. Its private copy (old :40) is deleted, and so is the `Alert` import on :3, which
  nothing else used. Call site :351 `failed("That stay")` is unchanged.
- `apps/mobile/src/itinerary.tsx`:
  - :27 imports `failed` from `./hops`.
  - :195 Add stop: `.catch(() => failed("That stop"))`
  - :216 Add idea: `.catch(() => failed("That idea"))`
  - :275-277 `AddStaySheetPhone.save` catch: runs `setSaving(false)` first and then
    `failed("That stay")`. The sheet stays open with its state kept, so retrying takes one tap.
  - :368 pinned Plan it, :388 Plan it at…, :408 Plan it for its nights: `.catch(() => failed("Plan it"))`
  - :67 is the search-degrade catch. It is not a save, so it stays as it was.

## Acceptance checks (ran)

- `grep -n "catch" apps/mobile/src/itinerary.tsx`: no `.catch(() => undefined)` is left. The :67
  search catch is the only one that doesn't show an alert.
- `grep -rn "const failed\|function failed" apps/mobile/src apps/mobile/app`: the only
  `failed(what)` definition is `hops.tsx:61`. `app/sign-in.tsx:53 function failed(e)` is a
  separate local Clerk-error handler that sets inline form error text. It is outside `src/` and is
  not a save alert, so it was left alone.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`.
- `pnpm --filter @rv-trip/mobile exec tsc --noEmit`: `MOBILE_TSC_OK`.

## Tests / coverage

- There is no new automated test. `apps/mobile` has no `test` script, and the change only wires an
  existing Alert helper into catch handlers, with no pure logic to move into `packages/core`. The
  evidence is typecheck, the greps above, and the walk.

## For the walk

- Take the device offline (or stop the API) and try Add stop, Add idea, Add stay (step 2 Save) and
  all three Plan it doors. Each should show "Didn’t save" with the matching noun. After Add stay
  fails, the sheet should still be open, with the Save button active again and the pick/dates kept.

---

# #138 dev notes: item i3 of 5 (#144 · Q9 B · Q10 A). A new stay takes its kind from Google, on a changeable chip

Only item i3 is in this dispatch. i1 and i2 (above) had already landed and were not changed.

## What changed

- `packages/core/src/domain/places.ts:307` adds `lodgingKindOfGoogle(primaryType, fallback)`, next to
  `reservationTypeOfGoogle`. It maps campground/rv_park to "campground" and lodging/hotel/motel to
  "hotel". Anything else goes to `fallback ?? "hotel"`. Two small helpers were added so the chip
  logic is tested in core and not only in the JSX:
  - `:322 stayKindIsFromGoogle(primaryType)`: returns true only when Google's type decided the
    kind.
  - `:332 stayKindChipLabel(kind, fromGoogle)`: returns "Hotel · from Google · change" or
    "<Kind> · change".

  All three are exported through the existing `domain/index` → core index barrel (`export * from
  "./places"`).
- `packages/core/src/providers/place-picker.ts:33`: `PickedPlace` gains a **required**
  `primaryType: string | null`. It is set in `pickedFromSummary` (:62, `summary.primaryType ?? null`)
  and set to null in `pickedFromFreeText` (:74) and `pickedFromPlace` (:241). Following the vet MED
  on widening the shape, I kept it required so typecheck would list every builder:
  - `place-form.ts:122` (`savePlaceFormFromSaved`) sets it to null.
  - `apps/web/src/components/trip/StopDetailSheet.tsx` `pickedName` sets it to null.
  - Test fixtures set it to null in `place-picker.test.ts`, `place-form.test.ts`,
    `place-mount.test.ts`, `trip-form.test.ts`, `dogfood-130.test.ts` and
    `apps/web/src/app/api/places/route.test.ts`.
- `apps/web/src/components/trip/stay-kinds.ts` (new) holds `KIND_OPTIONS` + its icons, lifted out of
  `StopDetailSheet.tsx`. The vet MED noted they were module-private. They can't be imported from
  StopDetailSheet, because StopDetailSheet already imports `StayPlaceField` from AddStaySheet.
  StopDetailSheet now imports them from this file and uses them the same way as before.
- `apps/web/src/components/trip/AddStaySheet.tsx`:
  - :121-132: `kind` / `fromGoogle` / `kindOpen` state. `pick(p)` seeds kind from
    `lodgingKindOfGoogle(p.primaryType, trip.lodgingDefault)`, and "Search again" re-seeds it.
  - :148: the draft is `withStayKind(stayDraft(kind), kind)`. It no longer uses
    `stayDraft(trip.lodgingDefault ?? "hotel")`.
  - :219: the place tile is `CategoryTile type={stayKindType(kind)}`.
  - :235-258: the chip button reuses StayPlaceField's anchor-chip classes (green when
    `fromGoogle`, plain otherwise). Tapping it toggles the DS `SegmentedControl` over
    `KIND_OPTIONS`. A manual pick clears `fromGoogle`, so the chip then reads "<Kind> · change".
- `apps/mobile/src/itinerary.tsx`:
  - :51 `Picked` gains `primaryType`.
  - :103-110: the result row's onPick carries `r.primaryType ?? null`.
  - :130: the as-typed escape carries null.
  - :149: `KIND_OPTIONS` over `STAY_KINDS`/`LODGING_KIND_LABEL`, the same as the stop screen.
  - `AddStaySheetPhone`: :265-276 has the same kind state and `pick`, and :288 builds the draft with
    `withStayKind(stayDraft(kind), kind)`. :331 sets the tile to `stayKindType(kind)`. :337-351 add
    the `<Chip on={fromGoogle}>`, and tapping it reveals the kit's `Segmented`.

## Decisions / defaults (for qa)

- **Friends hides conf # (+ cost on web) in Add stay step 2.** The wireframe says "Picking Friends
  drops conf # and cost (withStayKind)". The draft forces both to "", and the inputs hide, matching
  the stop screen's add form. Otherwise, text a user had typed would be silently discarded. This is
  the one UI change beyond the chip and the switch.
- Chip tone: `on` (green) only while the kind is Google's (wireframe caption: "green here means the
  app checked it"). A fallback or manual kind uses the plain chip.
- There is no backfill of existing rows (Q10 A).

## Tests / checks (ran)

- New core tests:
  - `places.test.ts` "lodgingKindOfGoogle (#144 · Q9 B)" covers hotel→hotel, lodging→hotel,
    motel→hotel, campground→campground, rv_park→campground (including on a hotel-default trip),
    park→fallback, null→fallback, and null or park with a null fallback→hotel.
  - "the Add-stay kind chip" covers `stayKindIsFromGoogle` + `stayKindChipLabel`.
  - `place-picker.test.ts` checks that "pickedFromSummary carries Google's primaryType".
- They failed first (red: 10 failed), then passed after the implementation.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total` (core 1301 passed, web 393
  passed, ui 48 passed).
- `apps/mobile` `npx tsc --noEmit`: `MOBILE_TSC_OK`.
- **Not covered by an executing test:** the sheet JSX (the chip toggle, the switch, the tile
  swap) on both platforms. `apps/mobile` has no test runner, and web has no component-test
  harness. The logic those sheets call is covered in core. The evidence for the JSX is typecheck
  plus the walk.

## For the walk

- Web and phone, on the PNW trip (default Campground): Add stay, then search for a hotel, e.g.
  Holiday Inn Express Bend.
  - Step 2 should show a BedDouble tile and a green "Hotel · from Google · change" chip.
  - Tap the chip. The switch should appear with Hotel selected. Pick Campground: the tile should
    become a Tent and the chip should read "Campground · change".
  - Save. The stop screen row should read Hotel, or Campground if you switched.
- An as-typed pick ("Use “Mom’s place” as typed") should read "Campground · change" (the trip
  default) on a plain chip.
- Vet FLAG i3 (render-required): this needs a live Places key that returns `primaryType` for real
  lodging, campground and rv_park results. If the key returns none, every pick falls back and the
  chip reads "<default> · change".

---

# #138 dev notes: item i4 of 5 (#142 · Q4 C · Q5 A). Home base: an amber chip in Add flight, a Home base row on the Rig screen, and honest 409 copy

Only item i4 is in this dispatch. i1–i3 (above) had already landed and were not changed.

## What changed

- `packages/core/src/domain/boundary-flights.ts`:
  - :164 `roundTripSavable(trip, body)`: true only when there is a savable body **and**
    `trip.homeBase !== null`.
  - :169 `NO_HOME_BASE_COPY = "Set a home base first."`.
  - :177 `isNoHomeBaseRefusal(e)`: true only for status 409 with body `{ error: "no_home_base" }`.
    It checks the shape structurally, so the domain never imports the api-client's `ApiError`. The
    test uses a real `ApiError`.
- `packages/core/src/domain/prefs.ts`:
  - :159 `homeBaseRowValue(prefs)` returns "Boise, ID ›", or "set one ›" when there is none.
  - :169 `householdHomeBasePatch(pick)` returns `{ homeBasePlace: {name, lat, lng, googlePlaceId} }`.
    A pick's extras (address, primaryType) are dropped.
- **`apps/mobile/src/round-trip.tsx` (new). RoundTripSheet moved here out of `hops.tsx`.** The
  sheet needs itinerary's `PlaceSearchField`, and `itinerary.tsx` already imports from `hops.tsx`.
  Importing it back into hops would create the app's first `src/` import cycle, which Metro flags
  with a "Require cycle" warning. The body is the old sheet unchanged, plus:
  - :118-133 when `trip.homeBase === null`: `<Chip warn>🏠 no home base yet · set one</Chip>` and
    the line "Round-trip flights start and end at home." sit under "Home ⇄ …". Tapping the chip
    swaps both for `<Label>Home base</Label>` + `PlaceSearchField anchor={null}`.
  - :71 `pickHome` calls `api.prefs.put(householdHomeBasePatch(p))`, then `loadBundle(trip.id)`.
    The trip then re-reads with the household home base, so the chip goes away and Save turns on.
    A failed PUT shows `failed("That home base")`.
  - :154 Save is `disabled={!savable || saving}`, where `savable = roundTripSavable(trip, body)`.
  - :67 catch: `isNoHomeBaseRefusal(e)` → `Alert.alert("Didn’t save", "Set a home base first.")`.
    Every other failure shows `failed("Those flights")`. The string "Set a home base first — those
    flights" no longer exists anywhere (grep checked).
- `apps/mobile/src/hops.tsx`: RoundTripSheet and its now-unused imports (`Switch`,
  `boundaryFlightsBody`, `mirrorReturnDraft`, `saveBoundaryFlights`) are removed. :497
  `export const sheetStyles = styles` lets round-trip.tsx reuse `leg`/`pm`/`st` without copying
  them.
- `apps/mobile/src/itinerary.tsx:51`: `type Picked` is now exported (it is the onPick argument
  type).
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/index.tsx:46`: RoundTripSheet is now imported from
  `src/round-trip`.
- `apps/mobile/app/rig.tsx`:
  - :81 `HomeBaseRow`: a row card reading "🏠 Home base" / `homeBaseRowValue(prefs)`, loaded with
    `api.prefs.get`. Tapping it toggles the same `Label` + `PlaceSearchField anchor={null}`, and a
    pick writes `api.prefs.put(householdHomeBasePatch(p))` and shows the returned row. A failed
    write shows `failed("That home base")`. The note under it reads "Where your trips start and
    end. A trip can override it in Edit ▸ Starts from." (mono 10.5 inkFaded, the sheet `pm`
    look).
  - :55 rig branch: `<HomeBaseRow />` sits directly under `<AccountCard />`.
  - :30-40 `rig === null` branch: this used to be only the centered "No rig yet" block. It is now
    a ScrollView with AccountCard, then HomeBaseRow, then the unchanged "No rig yet" copy
    (marginTop 28, as in frame ⑤).
  - The rig rows are still read-only.

## Decisions / defaults (for qa)

- **Frame ② is a crop.** Frame ① already leaves out the Round trip switch, so while the search is
  open I kept the switch and both legs rendered and swapped out only the chip and its line. Hiding
  them would lose nothing (state persists), but it would be a redesign the frames don't clearly
  ask for.
- Before prefs load, the Rig row shows no value (not "set one ›"), so a slow GET never falsely
  claims there is no home base. If the GET fails, the value stays blank and the row can still be
  tapped.
- Setting the household home base from the Rig screen doesn't refresh trip bundles that are already
  cached. The Add flight chip path does, through `loadBundle`. Trips re-read on their next load.

## Tests / checks (ran)

- New `packages/core/src/domain/home-base-142.test.ts` (11 tests). It covers `roundTripSavable`
  (no home base → false even with a body), `isNoHomeBaseRefusal` (409 no_home_base only; not another
  409, a 400, a network error or a null body), `NO_HOME_BASE_COPY`, `homeBaseRowValue` and
  `householdHomeBasePatch` (it parses against the `.strict()` `userPrefsPatch`). Red first:
  `Tests 11 failed (11)`. Then green.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total` (core 1312 passed, web 393,
  ui 48).
- `apps/mobile` `npx tsc --noEmit`: `MOBILE_TSC_OK`.
- **Not covered by an executing test:** the JSX, meaning chip render/tap, the dimmed Save, the Rig row
  in both branches, and the alert. `apps/mobile` has no test runner. The logic those parts call is in
  core and tested there. The evidence for the JSX is typecheck plus the walk.

## For the walk

- Phone, on a trip with no trip or household home base (e.g. clear the household one with
  `PUT /api/prefs {"homeBasePlace":null}` on a trip that has no override):
  - Open + Add ▸ Add flight. You should see the amber chip and the line, and "Save both flights"
    should be dimmed even with both legs filled.
  - Tap the chip, search "boise" and pick Boise. The chip should go away and Save should turn on.
- The Rig link should show "🏠 Home base · Boise, ID ›" under Account. Tap it and pick another place.
  The value should update.
- On a household with no rig, the Rig screen should show Account, Home base and then "No rig yet".
- The 409 safety net is hard to reach from the UI now that Save waits. To force it, clear the home
  base on the server while the sheet is open, then Save. You should see "Didn’t save / Set a home
  base first." and nothing else.

---

# #138 dev notes: item i5 of 5 (#143 · Q6 B · Q7 A · Q8 A). Re-edit on the phone

Only item i5 is in this dispatch. i1 to i4 (above) had already landed and were not changed.

## What changed

**Server + core (tested)**
- `packages/core/src/domain/types.ts:413-423`: `tripPatchInput` is now `.partial().extend({ destination: tripDestinationInput.nullable().optional() })`.
- `packages/db/src/mutations.ts:512-555`: `updateTripFields` takes `destination?: TripDestinationInput | null` (vet HIGH). The destination is split off the column patch. When `destination` or `homeBase` is present, the update runs in one transaction. The transaction checks ownership first, so another owner's trip id never plants a destinations row. It then calls the module-private `upsertTripDestination(tx, owner, d)` (null clears the pointer) and sets `destinationId`. `syncSegments` still runs only when `homeBase` moved. No stop is written.
- `apps/web/src/app/api/trips/[id]/route.ts:75-77`: comment only. `destination` passes through `fields` to the mutation, which now handles it, so it no longer reaches `.set()` as an unknown key.
- `packages/core/src/api-client/index.ts:209,335`: `reservations.remove(id)` → `DELETE /api/reservations/:id`.
- `packages/core/src/domain/trip-form.ts:278-370`: a new pure builder for the phone screen (vet MED: logic moved to core so it runs under vitest). `PhoneTripSettingsDraft`, `phoneTripSettingsDraft(t)` and `phoneTripSettingsPatch(t, d)` handle destination, dates, Starts from and the three defaults. Status, rating and note are not in the type. The dates and home-base diff was extracted into `rangeAndHomePatch`, which the web `tripSettingsPatch` now shares. That function returns the new `TripSettingsPatch = Omit<TripPatchInput, "destination">`, because the web dialog never edits the destination and its optimistic spread in TripPlanner.tsx:1157 would otherwise fail to typecheck.

**Phone (typecheck + walk only, since apps/mobile has no test runner)**
- `apps/mobile/src/stays.tsx` (new): `StaySheet` is the old `[stopId].tsx` AddStaySheet, moved without other changes, plus an optional `editing: Reservation`. Editing seeds from `reservationDraft(r)`, is titled "Edit stay", and saves `reservationDraftPatch` through the new store `editStay` (optimistic `setReservationFields`; on failure it re-reads the trip, then `failed("That stay")`). An amber `Button tone="warn"` "Delete stay" opens `Alert.alert("Are you sure?", undefined, [Cancel, {text:"Delete stay", style:"destructive"}])`. Confirming closes the sheet and runs `deleteStay` (optimistic `removeReservation` → `api.reservations.remove`; on failure it re-reads, then `failed("That stay")`).
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/stops/[stopId].tsx:292-305, 312-345`: the AddStaySheet and KIND_OPTIONS are removed and `StaySheet` is mounted for both Add and Edit. `ReservationCard` wraps only `isStayType` rows in a Pressable with a trailing `›`. "How was it?" is still its own inner Pressable, and non-stay rows render unchanged.
- `apps/mobile/src/hops.tsx:87-160`: `HopRow` takes `onEdit?(bookingId)`. Each booking line is a Pressable with `›`.
- `apps/mobile/src/hops.tsx:250-420`: `HopBookingSheet` takes `editing?: Reservation`. Editing seeds from `hopDraftFromBooking` (the effect re-seeds on `editing?.id`), is titled "Edit flight"/"Edit ferry", and saves `hopBookingPatch(...)` through the new store `editHopBooking` (optimistic `editSegmentBooking`). The clash check runs against the hop without the edited booking (the web HopCard.tsx:328 precedent). Following the web, the "move the stop" clash fix is hidden on an edit and only the date fix is offered. An amber "Delete flight"/"Delete ferry" gets the same "Are you sure?" confirm and then runs `deleteHopBooking` (`removeSegmentBooking` → `api.reservations.remove`).
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/index.tsx:124, 177-192, 495-507`: `editingBookingId` state. `onEdit` sets it and the hop, and the sheet's `editing` is looked up by id in `trip.segments[].reservations`. This is the vet MED about `HopRow`/`onEdit` threading.
- `apps/mobile/src/ui.tsx:94-120`: `Button` `tone="warn"` has a transparent fill with `C.warning` border and text (wireframe `.pbtn.warn`).
- `apps/mobile/src/store.ts:374-393, 427-492`: adds `editStay`, `deleteStay`, `editHopBooking` and `deleteHopBooking`. `patchTripDefaults` now maps an optimistic `destination` to `{...picked, id: null}` until the reload.
- `apps/mobile/app/(tabs)/(trips)/trips/new.tsx:300-480`: `TripDefaults` is now `TripSettings`, with the header title "Trip settings". A new block sits above "How it moves":
  - Destination: New trip's Input and Results, prefilled with `trip.destination?.name`. Emptying the box clears the destination. Typed text stays a search until you pick a result.
  - Dates: the RangePicker twin.
  - Starts from: labelled "Starts from · household default" when it is using the household place, otherwise "Starts from". The chip reads "🏠 <name> · change" and opens the place search. When the trip has its own override, "Use household default" sets `homeBasePlace` to null, which becomes `{homeBase: null, homeBasePlace: null}`, the same as on web.
  - Save sends `phoneTripSettingsPatch`. A 409 `date_range_orphans_stops` shows `Alert.alert("Didn’t save", body.message)`. Any other failure shows "Your trip settings — check your connection and try again."

## Tests (TDD: each was red first, then green)
- `packages/core/src/domain/trip-write-contract.test.ts:104-113`: `tripPatchInput` accepts a destination, null clears it, an absent key stays absent, and a blank name is refused.
- `apps/web/src/app/api/trips/[id]/route.test.ts:125-170` (real Postgres): PATCH `{destination}` upserts one destinations row, repoints `trips.destination_id`, keeps the stop and leg counts unchanged, and reuses the row when the same place is picked again. GET returns the destination and `{destination:null}` clears it. On another owner's trip it returns 404, writes no row and does not repoint. Red run before the fix: `expected [] to have a length of 1`.
- `packages/core/src/api-client/api-client.test.ts:222-229`: `reservations.remove("r 1")` sends DELETE to `/api/reservations/r%201`.
- `packages/core/src/domain/trip-settings-143.test.ts` (new, 6 tests): no-op on open; a new destination is sent as the picked place; null clears it; a pick without a Google id is not a change; only changed dates are sent and a backwards range never is; a Starts from pick writes the override and Use household default sends nulls; the defaults are folded in and status, rating and note are never sent.
- Not unit-testable: the StaySheet `editing` prop, the HopBookingSheet `editing` prop, `Button tone="warn"` and the "Trip settings" title and blocks all live in apps/mobile, which has no `test` script (vet MED). Their evidence is `@rv-trip/mobile#typecheck` plus the walk. I also ran `tsc --noEmit --noUnusedLocals` on apps/mobile and it reported nothing in the touched files.

## Gate (ran)
- `pnpm turbo run lint typecheck test --continue`: `Tasks: 10 successful, 10 total`. The counts were core `1320 passed`, web `395 passed` (the DB suite ran, not skipped) and ui `48 passed`.
- One earlier run failed `@rv-trip/web#typecheck` (TripPlanner.tsx:1166, destination in the optimistic spread). The `TripSettingsPatch` type above fixed it.

## Defaults / flags for the walk
- The wireframe's green left rule on the Trip settings block (`.newblk`) is treated as the design's "this is new" marker, like the dashed `.newt` outline, so it is not drawn. If it was meant as real chrome, it is a one-line style.
- After "Use household default" the chip shows the household's name, fetched from `api.prefs.get()` the same way New trip does, or "🏠 no home base yet · set one" when there is none. The wireframe has no frame for this.
- The Route card has no stay line (vet CHECKED Q6 B). Edit stay opens from the stop screen's Reservations row only.
- Walk checks: tap a stay row, change its kind to Hotel and save; the row should reprint "Hotel". Delete stay → Cancel should keep the row, Delete stay should remove it. Tap a flight line and check the title "Edit flight", the prefilled AS/BOI/BLI fields and the amber Delete flight. Editing its time must not raise a clash against itself. In Trip settings, pick a new destination; the masthead kicker should show it after Save and no new stop should appear. Shorten the dates so a stop is stranded; the alert should read "Didn’t save" with the server's sentence and the screen should stay open.
