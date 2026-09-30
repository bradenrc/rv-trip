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
