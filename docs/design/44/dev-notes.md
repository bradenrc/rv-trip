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
