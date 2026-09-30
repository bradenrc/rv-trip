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
