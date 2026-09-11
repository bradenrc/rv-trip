# Issue 44 · item 1 of 4 — retire Expo Go, document the dev-client loop

Scope: `apps/mobile/README.md` + `apps/mobile/package.json` only. No source and
no `app.json` change (confirmed below). Items 2–4 (#35's function, the map lens,
the Clerk gate) are separate dispatches.

## What changed

- `apps/mobile/package.json:24` — `ios` is now `expo run:ios` (was
  `expo start --ios`, the Expo Go launcher). `start` stays `expo start` (:23) —
  `start` is the JS-only loop that attaches Metro to the already-installed dev
  client. `android` (:25, `expo start --android`) is **untouched** — out of this
  item's stated scope, and this repo is iOS-first; flagged below.
- `apps/mobile/README.md:1-102` — rewritten run section. No Expo Go path
  anywhere: the three remaining mentions of the name all say it is gone
  (`:10` heading "there is no Expo Go path", `:14` "retired as a supported loop
  (#44)", `:15-16` "which Expo Go cannot load at all"). New sections:
  - `:19-42` **Once per machine** — Xcode (+ the `xcode-select -p` /
    `CommandLineTools` trap), CocoaPods via brew, and the Mapbox `sk.*`
    `DOWNLOADS:READ` token in `~/.netrc` with `chmod 600`, stated as
    build-time-only and **needed from #32 onward** (there is no Mapbox pod in
    the build today, so being honest about when it becomes load-bearing beats
    implying a fresh clone needs it now).
  - `:44-62` **Every day** — `pnpm dev` + `pnpm --filter @rv-trip/mobile ios`,
    the ~4–8 min first build with `expo prebuild` + `pod install`, and when to
    use `start` instead of `ios`.
  - `:64-79` **What is cached between worktrees** (see the vet finding below).
  - `:81-96` **How the app finds the API** — the `src/api.ts` order, and why the
    Metro-host rule still holds on a dev client.
- `README.md:42-44` (repo root) — the one other Expo Go instruction in the repo
  ("Expo Go on the iOS Simulator") now reads "a native dev client", names the
  ~4–8 min first build, and points at `apps/mobile/README.md`. Strictly a
  consistency fix forced by the `ios` script change, not new scope.
- `packages/core/src/mobile-dev-loop.test.ts` — new, 9 assertions (see below).

## Tests

TDD, red → green: the test went in first and failed 8/8 against the old README
and the old `ios` script, then passed once both landed.

`packages/core` is the only package with a `test` script, and this item's
deliverable is two config/doc files in `apps/mobile` — so there is no runtime
behaviour to cover. Instead the test asserts the contract against the source
text, exactly the technique `packages/core/src/theme/nightfall-tokens.test.ts`
(two duplicated stylesheets) and `theme/map-palette.test.ts` (an app module core
cannot import) already use. It guards:

1. `ios === "expo run:ios"` and `start === "expo start"`.
2. The README instructs no Expo Go path — nothing inside a ``` fence mentions
   it, no `expo start --ios|--android` anywhere, and every prose *sentence* that
   names it matches `/retired|cannot|no Expo Go/`. The root README's `Phone:`
   line is held to the same rule.
3. The one-time setup is named: Xcode, CocoaPods, `pod install`, `~/.netrc`,
   `sk.`, `DOWNLOADS:READ` — plus a secret-leak guard: the README must not
   contain `sk.eyJ…` (a real Mapbox token is a JWT) and the netrc `password`
   line must stay a SHOUTING placeholder.
4. The cache guidance names `~/Library/Developer/Xcode/DerivedData` and a
   CocoaPods cache, and the "per worktree" premise is asserted against
   `apps/mobile/.gitignore` actually ignoring `/ios` — un-ignore it and the test
   reds instead of the doc going quietly stale.

One mid-flight test correction, called out for honesty: the Expo-Go check was
first written line-by-line and failed on a *correct* README because the sentence
"which Expo Go / cannot load at all" hard-wraps across two lines. The check is
now sentence-granular (fences stripped, whitespace collapsed). Intent unchanged;
the granularity was a defect in the test, not in the doc.

## Vet findings addressed in this item

- **MED · "the dev-loop cache guidance is not achievable as written"** — agreed,
  and the design's phrasing (`ios/Pods` + DerivedData, "per machine, not per
  worktree") is not what actually happens. `apps/mobile/.gitignore:40` ignores
  `/ios`, so `expo prebuild` + `pod install` are per worktree. README `:64-79`
  therefore claims only what is really shared: `~/Library/Caches/CocoaPods` +
  `~/.cocoapods` (the spec repo and pod archives, so a second tree unpacks
  instead of re-downloading) and DerivedData's shared `ModuleCache.noindex`. It
  states plainly that Xcode *build products* are **not** reused, because
  DerivedData is keyed by project path — so a second worktree skips the
  downloads, not the compile — and recommends one long-lived checkout for native
  work. **Claim for qa:** the path-keyed-DerivedData mechanism is documented
  Xcode behaviour I could not measure in this dispatch (no native build allowed
  here); it is the one factual claim in the table worth a second pair of eyes,
  and the first walk on a second worktree will confirm or refute the "cheaper
  but not free" prediction.
- **MED · "EXPO_PUBLIC_MAPBOX_TOKEN … the README line 'restricted to
  com.bradenrc.rvtriphub (app.json:11)' asserts a scoping mechanism I could not
  verify"** — not written. Mapbox public-token URL restrictions are a web
  mechanism and do not apply to a native app, so the README says only that the
  runtime key is "a separate public `pk.*` token and arrives with #32" and makes
  no restriction claim. `EXPO_PUBLIC_MAPBOX_TOKEN` is deliberately not mentioned
  yet: it does not exist in the repo and provisioning it belongs to #32.
- **MED · "i1 claims 'No source or app.json change in this item', but the API
  base URL is discovered from `Constants.expoConfig?.hostUri`"** — checked
  `apps/mobile/src/api.ts:14-20`: no change is needed. A development build loads
  its manifest from the Metro dev server, so `hostUri` is populated under
  `expo run:ios` the same way it is under `expo start`; only a build with no dev
  server (a release/TestFlight build) falls through to `http://localhost:3000`,
  which is why the README `:81-96` now says a device off the Wi-Fi path or any
  non-dev build must set `EXPO_PUBLIC_API_URL`. **Flagged for the walk:** that
  `hostUri` is non-null in the dev client is a runtime fact I cannot execute
  here (native builds are barred in this dispatch) — if it comes back null on
  the simulator, the fix is a one-line fallback in `src/api.ts`, a separate item.
- The remaining HIGH/MED findings (the mini-map label claim, `boundsFor` over
  `[lng, lat]` tuples, the casing `lineOpacity` third term + `line-cap`, the stop
  screen's ordinal, the Segmented metrics, the Route-lens notice sentence, the
  three `MapFrame` states, the sign-in failure copy) all belong to items 2–4.
  Untouched here, on purpose.

## Flagged / defaulted

- `apps/mobile/package.json`'s `android` script is still `expo start --android`,
  i.e. still an Expo Go launcher on Android. The item's acceptance names only
  the `ios` script and the repo is iOS-first, so I left it; it is a one-word
  change (`expo run:android`) whenever Android becomes real.
- `docs/superpowers/specs/2026-09-08-native-app-design.md` still describes the
  Expo Go loop. It is a dated spec, not an instruction page, and editing it is
  not in this item — worth a sweep when the epic closes.
- Nothing in this item is operator-owned: no `gh`, no board, no push. The
  package-script change is the whole executable surface.

---

# Issue 44 · item 2 of 4 — mobile auth, Clerk Expo behind the keyless gate

Scope: `apps/mobile` (deps, `src/auth.ts`, `src/api.ts`, `src/ui.tsx`,
`app/_layout.tsx`, `app/sign-in.tsx`, `app/rig.tsx`, `README.md`) plus one
testable seam in `packages/core`. Items 3–4 (the core map lift, the map lens)
are separate dispatches and are untouched.

## What changed

**The seam, in core — the one piece that actually executes under test**

- `packages/core/src/api-client/index.ts:42` `TokenGetter`, `:58`
  `bearerAuthHeader(getToken)` — returns the `getAuthHeader` function the client
  already declares at `:66`. `Bearer <jwt>` when the getter answers with a token;
  `null` for no getter, `null`/`undefined`/`""`, **or** a getter that throws. The
  getter is asked per request, never cached, so a rotated session token is picked
  up without rebuilding the client.
  - Why in core and not inlined in `app`: this is the item's whole acceptance
    ("getAuthHeader resolves null so no Authorization header is built"), and core
    is the only package with a `test` script. Inlined in `apps/mobile` it would
    be assertable only as source text. The shape on the phone is the design's
    (`src/auth.ts:73`), just built by a named helper instead of an inline arrow.

**The phone**

- `apps/mobile/src/auth.ts` (new, 73 lines) — the mobile mirror of
  `apps/web/src/lib/owner.ts`. `:18` `CLERK_KEY` from
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `:19` `clerkEnabled = Boolean(CLERK_KEY)`,
  `:31` `secureStoreTokenCache` (Keychain via `expo-secure-store`; every call
  defensive — an unreadable item is deleted and read as "no session" rather than
  crashing at launch), `:66` `tokenGetter` + `:68` `setTokenGetter` (the
  React↔singleton box), `:73` `getAuthHeader`.
  Read at module load, not per call as the web does: Expo inlines
  `EXPO_PUBLIC_*` at bundle time, so it cannot change while the app runs.
- `apps/mobile/src/api.ts:3,30` — the whole client change: `getAuthHeader` is
  imported from `./auth` and passed to `createApiClient`. No Clerk import and no
  hook in this file, by design and by test (`mobile-auth.test.ts`).
- `apps/mobile/app/_layout.tsx:14` `Shell` — today's `<Stack>` and its four
  registered screens, verbatim, lifted. `:44` `TokenBridge` — the one place
  `useAuth()` runs, inside the provider, handing `getToken` to the seam. `:65`
  `if (!clerkEnabled) return <Shell />;` — keyless mounts no provider at all.
  `:67-75` the keyed path: `<ClerkProvider publishableKey tokenCache>` with
  `<SignedIn><Shell /></SignedIn>` / `<SignedOut><SignInScreen /></SignedOut>`,
  so the navigator is unreachable without a session.
- `apps/mobile/app/sign-in.tsx` (new, 235 lines) — the two-step screen from the
  wireframe. Copy verbatim ("Plan on the laptop, glance on the phone. Use the
  same account you use on the web.", "We'll email you a 6-digit code.", "Check
  your email", "Use a different email", "Didn't arrive? Resend in Ns"). Clerk's
  `email_code` strategy only: `:67` `signIn.create({ strategy: "email_code" })`,
  `:83` `attemptFirstFactor`, `:85` `setActive` — no password, no OAuth, no
  dashboard work. Metrics are the wireframe's `.field` / `.code i` / `.ghost` /
  `.cta` at the DS's `C`/`F`/`R` tokens; the CTA is the kit's `Button`
  (tone accent) and both kickers are `Kicker`.
- `apps/mobile/src/ui.tsx:85,91,97-103` — `Button` gains an optional `disabled`
  (dim to 0.5, `accessibilityState`). The vet flagged its absence; the in-flight
  "Continue" needs it. Additive: the enabled rendering is byte-identical.
- `apps/mobile/app/rig.tsx:46` `<AccountCard />` above the rig card; `:73`
  `AccountCard` branches on the module constant (exactly as the web's
  `Account.tsx:15` does, so hook order never varies within a build), `:78`
  `ClerkAccountCard` (34px green initial disc, `user?.fullName ??
  user?.primaryEmailAddress?.emailAddress`, "signed in on this device", a ghost
  **Sign out**), `:107` `DevAccountCard` (the web's dashed pill, 26px "D",
  `dev-user`, and the keyless sentence verbatim). The rig rows, the copy and the
  read-only footer are untouched.
- `apps/mobile/README.md:94-125` — the Sign-in section: the env var, that it goes
  in `apps/mobile/.env.local`, that it must be the **same instance** as the web
  or you are a different tenant on the phone, and the keyless behaviour (no
  provider, no sign-in screen, no `Authorization`, `dev-user`). The "What's here"
  list gains `app/sign-in.tsx` + `src/auth.ts`; "Not in v1" no longer claims
  sign-in is missing.

## Tests

TDD, red → green. Both files went in first: 6 `bearerAuthHeader` cases failed
`TypeError: bearerAuthHeader is not a function` and `mobile-auth.test.ts` failed
to collect (no `src/auth.ts`). Final: **592 core tests pass (31 files)**.

- `packages/core/src/api-client/api-client.test.ts:151-188` — `bearerAuthHeader`
  for real, executing: no getter → `null` **and** the client builds no
  `authorization` header (asserted through `createApiClient` with the file's
  existing fetch double); a token → `Bearer <t>`; `null`/`undefined`/`""` → null;
  two requests see a rotated token; a throwing getter degrades to `null`.
- `packages/core/src/mobile-auth.test.ts` (new, 26 assertions) — the wiring, as
  source text, for the same reason item 1's `mobile-dev-loop.test.ts` does it:
  `apps/mobile` has no test runner and every file here needs a native runtime.
  It guards, criterion for criterion: the deps; that `src/auth.ts` is the *only*
  file reading the key; that `src/api.ts` contains no `@clerk/` import and no
  `use…(` call at all; that `<Stack` occurs exactly once and only inside `Shell`;
  that the keyless `return <Shell />` precedes `<ClerkProvider>` in the file;
  the `<SignedIn>`/`<SignedOut>` bodies; the sign-in copy and the `email_code`
  strategy with no `password`/`useSSO`/`useOAuth`; that `<AccountCard />` renders
  before the "Routing input" kicker, both branches exist, the name is never
  composed locally; and the README's env var + keyless claims with no real key.

Two mid-flight test corrections, for honesty: the copy check initially wanted
`We&apos;ll` (I had written the JSX entity; plain apostrophes are valid in JSX
text and read better, so the *source* changed), and the Account-ordering check
first compared `indexOf("Account</Kicker>")` against the rig kicker — wrong,
because the helper components are *defined* below the render. It now compares
`<AccountCard />`'s position, which is the thing that actually orders the screen.

## Vet findings addressed in this item

- **MED · "the sign-in screen pins no failure copy"** — now pinned, and
  deliberately thin. Clerk's own `longMessage`/`message` is shown whenever the
  error is a `ClerkAPIResponseError` (`sign-in.tsx:52-59`), because Clerk already
  ships product-grade strings for a wrong code, an expired code and a
  rate-limited resend, and inventing parallel copy would drift from them.
  Exactly **one** string is authored here: `GENERIC_ERROR` at `:34`,
  "Something went wrong — check your connection and try again." — the network /
  unknown case. **Flagged as a design default**, not something the wireframe
  said.
- **MED · "`Button` has no `disabled`/pending state for the in-flight
  'Continue'"** — added (`ui.tsx:85`). Continue is also disabled until the field
  contains an `@`, rather than round-tripping an obviously bad address.
- **MED · "'Resend in 24s' names a countdown derivable from nothing"** — 24s is a
  *snapshot of a countdown in progress*, so the real decision is where it starts.
  `RESEND_SECONDS = 30` (`sign-in.tsx:31`), i.e. the drawn frame is six seconds
  in. **Defaulted**, stated in the code comment; if Braden wants Clerk's own
  throttle window instead, it is one constant.
- **MED · "i1 claims 'no source or app.json change', but the API base URL comes
  from `Constants.expoConfig?.hostUri`"** — re-confirmed no change needed here
  either; `app.json` is untouched by this item (`scheme: "rvtrip"` already
  exists, and the email-code flow needs no deep link).
- The step-2 screen has **no Continue button** in the wireframe — only "Use a
  different email" and the resend line. That is only coherent if the sixth digit
  submits, so `onCodeChange` (`:96-100`) verifies at length 6. Reading the
  drawing, not inventing chrome it does not show.
- The other HIGH/MED findings (the mini-map label claim, `boundsFor` over
  `[lng, lat]`, the casing `lineOpacity`/`line-cap`, the stop ordinal, the
  `Segmented` metrics, the Route-lens notice sentence, the three `MapFrame`
  states) are items 3–4. Untouched on purpose.

## Flagged / defaulted — please read before the walk

1. **`@clerk/clerk-expo` is deprecated, and the web is already a major ahead.**
   The installed `@clerk/clerk-expo@2.20.0` prints a `warnOnce` at import:
   "DEPRECATION WARNING: @clerk/clerk-expo is deprecated. Please migrate to
   `@clerk/expo`" (core-3). Meanwhile `apps/web/package.json:16` is
   `@clerk/nextjs@^7.9.1` — which **is** core-3, whose Expo counterpart is
   `@clerk/expo@4.6.6`. So as vetted, the phone ships the core-2 SDK against a
   core-3 web half. I implemented the package the signed design names rather than
   swapping SDK generations on my own judgement — that is a design call, not a
   dev one. It functions (both talk to the same Frontend API), but it logs that
   warning on every launch and the migration is inevitable. **The swap is small**:
   the four imports in `src/auth.ts`, `app/_layout.tsx`, `app/sign-in.tsx`,
   `app/rig.tsx`. Recommend a decision before item 4 rather than after.
2. **Two extra native deps, and why they are not scope creep.**
   `@clerk/clerk-expo` *statically* `require`s `expo-web-browser`
   (`dist/provider/ClerkProvider.js:37`) and `expo-auth-session`
   (`dist/hooks/useSSO.js:35`, re-exported from `dist/hooks/index.js`), so both
   are in the runtime module graph the moment anything is imported from the
   package — even though this app uses neither flow. They are native modules and
   must autolink into the iOS build, so they are declared explicitly at
   SDK-aligned versions (`expo-web-browser@~57.0.3`,
   `expo-auth-session@~57.0.12`) instead of sitting undeclared in pnpm's store.
   `mobile-auth.test.ts` guards that. `expo-crypto` is only `await import()`ed by
   the Apple hook, so it is deliberately **not** declared.
3. **`react-dom` version skew.** pnpm auto-installed `react-dom@19.2.4` as a
   required peer of `@clerk/clerk-expo` against this app's pinned
   `react@19.2.3`, so `pnpm install` reports `unmet peer react@^19.2.4`. It is a
   warning, not an error, and `react-dom` is only reachable from clerk-react's
   web target — but if the native build trips on it, pinning `react` to `19.2.4`
   (or declaring `react-dom@19.2.3`) is the fix.
4. **Render-required at walk (unchanged from the vet's two FLAGs).** Nothing
   below is certifiable statically, and `scripts/mc-walk-env.sh:229` boots
   `pnpm dev` in `apps/web` only:
   - the keyed path end to end — a real `pk_test_…`, the email-code round trip,
     `setActive` flipping `<SignedOut>` → `<SignedIn>`, and `Bearer <jwt>`
     actually reaching the API;
   - `expo-secure-store` writing to the Keychain on the Simulator (and therefore
     that the code screen is seen once per device);
   - that a root layout rendering **no navigator** while signed out is accepted
     by expo-router 57 without a "Root Layout" warning. This is the structure the
     design draws; if expo-router objects, the equivalent is a `Stack.Protected`
     / redirect gate and the copy is unaffected;
   - that `app/sign-in.tsx` being a route file (it is auto-discovered, and only
     `<Stack.Screen>` *options* are declared for the four) causes no visible
     stray screen while signed in. It is never navigated to.
5. **Not verified, and out of scope:** whether the mobile Clerk instance allows
   `email_code` as a first factor and whether the sign-in *creates* users. The
   screen is sign-in only, per the design's "Use the same account you use on the
   web" — an unknown email raises Clerk's own "Couldn't find your account"
   message via the path in finding 1 above. Also note `<SignedOut>` only ever
   shows sign-in: there is no sign-up path on the phone by design.
6. **Nothing here is operator-owned.** No `gh`, no board, no push, no schema or
   migration (no new endpoint and no Zod/`pgEnum` change is implied — the server
   already accepts `Authorization: Bearer`, `apps/web/src/proxy.ts:5-8`). The
   only environment action is Braden putting a `pk_test_…` in
   `apps/mobile/.env.local` when he wants the keyed half; the keyless half is the
   default and needs nothing.

## Claims for qa

- That `bearerAuthHeader` is the honest home for this logic — it is the only
  version of the item's central acceptance criterion that *executes* in a test
  rather than being matched as source text.
- That `expo-web-browser` + `expo-auth-session` belong in `package.json`
  (finding 2) rather than being left to pnpm's auto-installed peers. I read the
  `require`s in the shipped `dist/`; a second pair of eyes on whether declaring
  them is completion-of-install or scope is welcome.
- That keeping the deprecated `@clerk/clerk-expo` (finding 1) was the right call
  under "implement the vetted design only". If qa reads the contract the other
  way, the swap to `@clerk/expo` is four import lines.
