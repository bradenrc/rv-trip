# #147 dev notes: the phone moves to `@clerk/expo` (core-3)

Implements the resolved wireframe (`mc/wireframe/issue-147-v0`, Q1 B · Q2 A · Q3 B · Q4 B)
with every vet finding (`mc/vet/issue-147-v0`) applied.

## What changed

| file | change |
|---|---|
| `apps/mobile/package.json:6` | `@clerk/clerk-expo ^2.20.0` removed; `@clerk/expo ^4.7.2` (current `latest`) added. Native peers unchanged after re-derive (below). |
| `apps/mobile/app.json:34-39` | **New (vet HIGH 2).** Adds the `["@clerk/expo", { "appleSignIn": false }]` config plugin. Its `app.plugin.js` raises the iOS deployment target to 17.0 in `Podfile.properties.json` and the Xcode project, which `ios/ClerkExpo.podspec` (`:ios => '17.0'`) needs. On Android it adds the META-INF packaging exclusion and the hosted-callback intent filter. I set `appleSignIn: false` because the app is email-code only. Otherwise the plugin adds a `com.apple.developer.applesignin` entitlement that the app doesn't use. |
| `apps/mobile/app/_layout.tsx:4,78-83` | Imports from `@clerk/expo`. `SignedIn`/`SignedOut` become `<Show when="signed-in">` / `<Show when="signed-out">` (Q2 A). The doc comments are updated. The keyless short-circuit and `TokenBridge` are unchanged. |
| `apps/mobile/app/sign-in.tsx:12` | `import { isClerkAPIResponseError, useSignIn } from "@clerk/expo"`, from the root and not `/errors`, which doesn't exist (vet HIGH 1). It isn't `/legacy`, so Q1 B holds. |
| `apps/mobile/app/sign-in.tsx:44-50` | `messageFor(e)` is lifted to module scope. The precedence is unchanged: `longMessage` → `message` → `GENERIC_ERROR`. |
| `apps/mobile/app/sign-in.tsx:53,58` | `const { signIn, fetchStatus } = useSignIn(); const busy = fetchStatus === "fetching";` All `setBusy` calls and `isLoaded`/`!signIn` guards are gone. |
| `apps/mobile/app/sign-in.tsx:70-81` | `sendCode()` calls `signIn.emailCode.sendCode({ emailAddress })`. The returned `error` goes through `messageFor`. |
| `apps/mobile/app/sign-in.tsx:83-105` | `verify()` calls `signIn.emailCode.verifyCode({ code })`, then on `status === "complete"` calls `signIn.finalize()`. **The error that finalize returns is now shown through `messageFor` (vet MED 3)**, so a failed finalize no longer leaves step 2 silent. |
| `apps/mobile/app/sign-in.tsx:177` | "Use a different email" calls `void signIn.reset()` before going back to step 1. |
| `apps/mobile/app/sign-in.tsx:16-35` | The file doc comment is updated (`setActive flips <SignedOut>` → `signIn.finalize() flips <Show when="signed-out">`). |
| `apps/mobile/app/rig.tsx:5` | Import path only. |
| `apps/mobile/README.md:107` | `<SignedIn>` → `<Show when="signed-in">`. |
| `packages/core/src/mobile-auth.test.ts` | See the tests section. |
| `pnpm-lock.yaml` | Regenerated. `@clerk/clerk-expo@2.20.0`, `clerk-react@5`, `clerk-js@5`, `@clerk/types`, and the emotion/localizations tree drop out. `@clerk/expo@4.7.2`, `@clerk/react@6.17.3`, `@clerk/shared@4.37.0`, and `@clerk/clerk-js@6.35.0` come in. There are 0 `clerk-expo` entries left. |

Everything the person sees on the screen is byte-identical: all copy, the six cells, `RESEND_SECONDS`, `GENERIC_ERROR`, the styles, and auto-verify on the sixth digit. `src/auth.ts` and the `secureStoreTokenCache` aren't touched (Q4 B).

## Native-peer re-derive (Q4 B, the #44-finding-2 procedure)

I walked the static `require("…")` graph from `@clerk/expo@4.7.2/dist/index.js`, the only entry the app imports, with Metro's `.ios.js` / `.android.js` / `.native.js` resolution on each platform. It reaches these native modules:

- `expo`: `dist/specs/NativeClerkModule.js:1` (iOS) and `dist/specs/NativeClerkModule.android.js:1`. It's already declared.
- `expo-auth-session`: `dist/hooks/ssoDependencies.js:9`
- `expo-web-browser`: `dist/hooks/ssoDependencies.js:10`

These two are reached through `useSSO`, which `dist/hooks/index.js` re-exports. The requires now sit inside a lazy `try/catch`. Metro still resolves string-literal requires at bundle time, so both stay in the graph and stay declared at `~57.x`. Nothing new comes in. These modules are in the dist but not reachable from the root entry: `expo-crypto`, `expo-constants` (`useHostedAuth`, the `/hosted-auth` subpath), `expo-local-authentication`, `expo-secure-store` (`/local-credentials`, `/token-cache`, `/resource-cache`), and `@clerk/expo-passkeys` (`/passkeys`). `react-native-url-polyfill@4.0.0` is pure JS and a regular dependency of `@clerk/expo`.

**The piece the old grep couldn't see (vet HIGH 2):** `@clerk/expo` is an autolinked native module itself. `expo-module.config.json` registers `ClerkExpoModule` plus 3 view modules and `ClerkAppDelegateSubscriber`, and its podspec requires iOS 17.0. The config plugin in `app.json` handles that.

**Peer skew from #44 finding 3:** it's still there. `pnpm install` warns `react-dom 19.2.4 ✕ unmet peer react@^19.2.4: found 19.2.3`. It's unchanged by this issue. The other warnings (`utf-8-validate`, `react-native-worklets`, `@react-native/metro-config`, `@solana/*` typescript) were there before. The `@solana/*` tree already came in through `clerk-js@5` and still comes in through `clerk-js@6`.

## Tests (TDD: red first, then green)

`packages/core/src/mobile-auth.test.ts`. I wrote all of these before the code, and 4 failed as expected:

- Header comment: `:21` and `:30` are renamed (vet LOW 4).
- `:68` `NATIVE_PEERS` holds the re-derived set. The comment cites the 4.7.2 dist paths above.
- Declares `@clerk/expo`, and **asserts `@clerk/clerk-expo` is absent**.
- **New:** `app.json` plugins include `@clerk/expo` (the iOS 17.0 floor, vet HIGH 2).
- The gate regex is now `/<Show when="signed-in">\s*<Shell \/>\s*<\/Show>/` plus the signed-out twin, with no `<SignedIn>|<SignedOut>` left.
- The strategy assertion is now `signIn.emailCode.sendCode`, `signIn.emailCode.verifyCode`, and `signIn.finalize(`. The password and `useSSO|useOAuth` negatives stay.
- **New** `one SDK, no shim`: no `@clerk/clerk-expo` and no `@clerk/expo/legacy` in any source file, and the three Clerk-using files import from `"@clerk/expo"`.

## Checks run

- `npx vitest run src/mobile-auth.test.ts` (packages/core): before the code, `Tests 4 failed | 26 passed (30)`. After, `Tests 30 passed (30)`.
- `npx tsc --noEmit` (apps/mobile) against core-3 types: clean, with no output.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total` (core 1296 tests, web 393, ui 48). The first run hit a one-off `@rv-trip/web#lint` ENOENT on vitest's temporary `vitest.config.mts.timestamp-*.mjs` file, a race between lint and test in the same package. The rerun was green.
- `npx expo config --type introspect` (apps/mobile): the plugin loads, the Info.plist gets `ClerkExpoVersion: 4.7.2`, and `entitlements: {}`, so there's no Apple sign-in entitlement. The Podfile deployment-target bump is a dangerous mod that only runs at prebuild, so I didn't check it here.
- SKIPPED: dev-client rebuild and the walks. That's the walk gate's job, and the native dependency changed.

## For qa and the walk (Q3 B: keyless and keyed walks on both iOS and Android)

- **Rebuild both dev clients** before walking. Prebuild should write `ios.deploymentTarget: "17.0"` to `ios/Podfile.properties.json`. If `pod install` still complains about ClerkExpo's platform, the plugin didn't apply. Revert anything prebuild adds to `package.json` that isn't in the set above.
- Render-required, from vet FLAG 6:
  - Does `isClerkAPIResponseError` narrow the returned `ClerkError`, so the wrong-code step shows Clerk's `longMessage`? If it doesn't, the step shows `GENERIC_ERROR`.
  - Does `signIn.status` read `'complete'` right after the awaited `verifyCode`?
  - Does `finalize()` flip `<Show>`?
  - Does the Keychain session survive a relaunch?
  - Does Sign out return to the sign-in screen?
- Keyless: confirm there's no DEPRECATION WARNING or LogBox toast. The provider never mounts there, but `@clerk/expo` is still imported at module load.
