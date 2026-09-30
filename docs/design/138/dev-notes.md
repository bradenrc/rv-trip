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
