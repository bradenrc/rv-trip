# #123 · Apple + Google one-tap sign-in on the phone — dev notes

Implements the vetted wireframe (`docs/design/123/index.html` on `mc/wireframe/issue-123-v0`), resolved q1–q6 = A.

## What changed

- `apps/mobile/app/sign-in.tsx`
  - Header comment (:27-40) now reads "email code, Apple (iOS), Google".
  - `GOOGLE_G` asset (:48), `ErrorFrom` type (:54), `WebBrowser.maybeCompleteAuthSession()` at module scope (:57).
  - Hooks: `useSignUp`, `useSignInWithApple`, `useSSO` next to the existing `useSignIn`. New state: `errorFrom`, `via` (which provider is in flight), `appleAvailable`.
  - `isAvailableAsync()` is checked once on mount, iOS only (:84-95). Apple renders only when `Platform.OS === "ios" && appleAvailable` (q2·A, G2).
  - `failed(e, from = "email")` picks the error slot. `runProvider` (:112) is shared by both providers: it sets the shared `busy`, clears the error, calls `setActive` on a session, shows nothing on a cancel, and shows `GENERIC_ERROR` on an incomplete result. `continueWithGoogle` (:148) calls `startSSOFlow({ strategy: "oauth_google", redirectUrl: AuthSession.makeRedirectUri({ scheme: "tripcaddie" }) })`.
  - JSX (:215-262): the provider stack goes between the lede and the form, in the email step only. It holds the native `AppleAuthenticationButton` (CONTINUE / WHITE, `cornerRadius={R.md}`, `{ height: 40, width: "100%" }`), which dims to 0.5 with `pointerEvents="none"` while busy and keeps its label (G4). Below it is the Google `Pressable`, labelled "Opening Google…" while Google is in flight. Then comes the provider error slot, then the "or" divider. The email form is unchanged apart from its error line, which now shows only when `errorFrom === "email"`.
  - Styles (:328-353): `providers`, `dim`, `google`, `googleMark`, `googleText`, `or`, `orLine`, `orText`, measured to the §2 redlines. Google uses `RV_LIGHT_ISLAND` colours and the divider uses `C.border` / `C.inkFaded` / `F.mono`. There is no raw hex in the file.
- `apps/mobile/app.json`: adds `ios.usesAppleSignIn: true` and the `"expo-apple-authentication"` plugin.
- `apps/mobile/package.json` + `pnpm-lock.yaml`: `expo-apple-authentication ~57.0.2` and `expo-crypto ~57.0.3`, added with `expo install` (G1). The lockfile also re-serialised a few `eslint-import-resolver-typescript` peer keys. That was pnpm's own churn with no version change.
- `apps/mobile/assets/google-g.png`: Google's official "G" (200×204, from developers.google.com/identity/images/g-logo.png), drawn at 16×16 with `resizeMode="contain"`.
- `packages/core/src/theme/tokens.ts:60`: `RV_LIGHT_ISLAND = { surface, ink, borderHi }`, mirrored from entry.css `.rv-light-island` (G3).
- `packages/core/src/auth/provider-outcome.ts` (new, exported from `index.ts`): `providerOutcome()`, the pure session / cancelled / incomplete classifier. It addresses the vet's MED finding.

## Key decisions

- **Cancel vs. incomplete (vet MED).** Clerk returns `createdSessionId: null` both on a cancel and on e.g. a sign-up transfer left at `missing_requirements`. `runProvider` snapshots `signIn.id` / `signUp.id` before the flow; Clerk resources mutate in place on `create`.
  - Apple: if an id changed, a Clerk call happened, so a null result is incomplete and shows `GENERIC_ERROR` in the provider slot. If nothing changed, the sheet was cancelled and no error shows.
  - Google: `signIn.create` always runs before the browser opens, so `authSessionResult.type` decides instead. Anything other than `success` counts as a cancel. `success` without a session counts as incomplete.
- **Busy.** All three controls share one `busy` flag, as the design specifies. The Apple wrapper uses the `pointerEvents` prop as specified.
- **Error clearing.** Any provider tap or email Continue clears the error, because both paths call `setError("")`.
- **No change** to `_layout.tsx` (the keyless `<Shell />` short-circuit, path ⑤), web, or server code, matching the design.

## Tests (TDD, all in `packages/core`, the only vitest runner that reaches mobile)

- `theme/tokens.test.ts`: new "mirror the .rv-light-island half" case, which reads the island block from entry.css. I watched it fail before `RV_LIGHT_ISLAND` existed.
- `auth/provider-outcome.test.ts`: 6 cases covering the Apple and Google cancel / incomplete / session matrix.
- `mobile-sso.test.ts`: a structural contract against the source text, in the same pattern as `mobile-auth.test.ts`. It checks deps, app.json, the asset, the stack order Apple → Google → "or" → form, email copy kept verbatim, no provider UI on the code step, the iOS gate, the CONTINUE / WHITE / radius / size props, the busy `pointerEvents`, `useSSO` + redirect + `maybeCompleteAuthSession`, the Google copy including "Opening Google…", the light-island tokens with no hex literal, `providerOutcome` wiring, both error slots, and the keyless `<Shell />`.
- `mobile-auth.test.ts`: the #44 assertion "no OAuth / no useSSO" was relaxed to "no password, no useOAuth", because #123 deliberately adds `useSSO`.
- **Not executable here:** the real Apple sheet, the Google browser round-trip, `setActive`, and the render. `apps/mobile` has no test runner and these need a native runtime. They are render-required at the walk.

## Gate (ran)

- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`. That covers core at 1317 tests passed and web at 393 tests passed.
- `apps/mobile` `pnpm typecheck` (`tsc --noEmit`): exit 0.

## Flags for the walk / qa

- **Operator step first:** Braden must enable Apple in the Clerk dashboard and register the native app (bundle `com.groupcaddie.tripcaddie`, redirect `tripcaddie://`). The Google redirect `makeRedirectUri({ scheme: "tripcaddie" })` must also be allow-listed. Until that is done, Apple renders but fails at the exchange, and the failure shows the provider error line.
- **Dev-client rebuild required.** The new native modules and `usesAppleSignIn` need a prebuild. I did not run prebuild, so any `package.json` / `ios/` changes it makes still need to be committed deliberately.
- **Walk:** iOS sim with Apple (Share My Email) and Google, checking 1a–1d and 1f. Android emulator with Google only, checking 1e/1f: no Apple slot and no gap. Web: one keyed check that the Clerk modal on `/join` shows both providers (path ②).
- qa check: a cancel on either provider must leave **no** error text. A provider error must render under the buttons, not inside the form.
- Seen, out of scope (per design): the H1 still reads "RV Trip Hub" while the Apple sheet says "TripCaddie".

## Production milestone (q4·A, G5)

- **Hide My Email splits people.** An Apple sign-up that chooses Hide My Email gets a `…@privaterelay.appleid.com` address. A later Google sign-in with her real email becomes a second Clerk user, and so a second household. This follows Clerk's default, and there is no UI for it.
- **Dev vs. native Apple `sub`.** Dev-instance web Apple (Clerk's shared credentials) and native Apple (the app's own team and bundle id) can yield different Apple `sub` values for the same person. Share My Email is what lines them up, by matching on email. Before production, move web Apple onto the app's own Apple credentials.
