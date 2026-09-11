# RV Trip Hub — mobile (Expo, iOS-first)

The phone half of "plan on laptop, glance on phone". Design:
`docs/superpowers/specs/2026-09-08-native-app-design.md`.

It imports `@rv-trip/core` verbatim (the trip grammar, the planner models,
the typed API client, the colour tokens) and talks **only** to the web app's
REST API — never to the database or a map vendor directly.

## Run it (a native dev client — there is no Expo Go path)

The phone runs as a **development build**: a real app compiled out of
`apps/mobile/ios/` onto the Simulator, with Metro serving the JS into it.
Expo Go is retired as a supported loop (#44). The in-app map (#32) is
`@rnmapbox/maps` — a native module behind an Expo config plugin, which Expo Go
cannot load at all — so the dev client is the one loop for every screen, and
there is no second loop to keep working.

### Once per machine

- **Xcode**, from the App Store. Open it once to accept the licence and let it
  install the iOS platform + a Simulator runtime. `xcode-select -p` has to
  point inside `Xcode.app` — if it answers `/Library/Developer/CommandLineTools`,
  run `sudo xcode-select -s /Applications/Xcode.app`.
- **CocoaPods** — `brew install cocoapods`, then `pod --version` should answer.
  The native build runs `pod install` for you; it just needs the tool.
- **No Mapbox download token.** Earlier Mapbox iOS SDKs came from a private
  registry behind a secret `sk.*` / `DOWNLOADS:READ` token in `~/.netrc`. That
  is no longer true for the SDK we build against: `@rnmapbox/maps@10.3.5` pulls
  **MapboxMaps iOS `~> 11.23.1`** from the public CocoaPods registry, and its own
  podspec says so — `$RNMapboxMapsDownloadToken` is *deprecated, download token
  is no longer required* (`rnmapbox-maps.podspec:15`), and passing it through the
  config plugin would only write the secret into the generated `Podfile`
  (`plugin/src/withMapbox.ts:108-117`). So the plugin is registered with **no
  props**, nothing goes in `~/.netrc`, and the only Mapbox credential this repo
  needs is the public runtime key in [The map](#the-map) below. If a future SDK
  bump reintroduces the requirement it is read from the
  `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` environment variable — never from `app.json`.

No Apple Developer account and no provisioning are needed for the Simulator.

`@rnmapbox/maps` 10.3+ **requires** React Native's New Architecture and refuses
to build without it (`rnmapbox-maps.podspec:39-42`). `app.json` already has
`newArchEnabled: true`, so there is nothing to do — just don't turn it off.

### Every day

```bash
pnpm dev                            # repo root: the web app + API on http://localhost:3000
pnpm --filter @rv-trip/mobile ios   # expo run:ios — build (first time), install, boot, attach Metro
```

The first `ios` in a tree is a real Xcode build: **~4–8 minutes**. It runs
`expo prebuild` to generate `ios/`, `pod install` inside it, then compiles and
installs the app. After that the loop is what it always was — Fast Refresh
under a second — and

```bash
pnpm --filter @rv-trip/mobile start   # expo start: attach Metro to the installed dev client
```

is enough for JS-only work. Reach for `ios` again only after a **native**
change: a new native dependency, an `app.json` plugin or config edit, or an
Expo SDK bump.

### What is cached between worktrees, and what is not

`apps/mobile/ios/` is a generated folder and `.gitignore`d, so **every worktree
prebuilds and pod-installs its own** — there is no shared `ios/Pods` to keep.
What survives across trees is the download and module caching underneath:

| Machine-global (never clear it) | Per worktree (regenerated) |
| --- | --- |
| `~/Library/Caches/CocoaPods` + `~/.cocoapods` — the spec repo and the downloaded pod archives, so `pod install` in a second tree unpacks instead of re-downloading the SDKs | `apps/mobile/ios/` and `ios/Pods/` — `.gitignore`d, recreated by `expo prebuild` / `pod install` |
| `~/Library/Developer/Xcode/DerivedData` — in particular its shared `ModuleCache.noindex` | Xcode's **build products**: DerivedData is keyed by the project's path, so a new worktree path compiles its own objects |

Net effect: a second worktree is cheaper than the first but not free — it skips
the downloads, not the compile. If you are doing native work, do it in one
long-lived checkout rather than a fresh tree per change, and don't wipe those
two caches between trees. Delete `apps/mobile/ios/` deliberately (then re-run
`ios`) when a native config change needs a clean prebuild.

### How the app finds the API

In order: `EXPO_PUBLIC_API_URL` → the host Metro is serving from, on the web
app's port 3000 → `http://localhost:3000` (`src/api.ts`). A dev client loads
its manifest from the Metro dev server, so the middle rule keeps working —
the Simulator and a phone on the same Wi-Fi both reach the Mac that way. For a
physical device off that path, or any build with no dev server, set the URL
explicitly in `apps/mobile/.env.local`:

```
EXPO_PUBLIC_API_URL=http://192.168.x.y:3000
```

### Sign-in, and why a fresh clone needs no keys

Auth is Clerk, behind the same keyless gate the web keeps
(`apps/web/src/lib/owner.ts`). One env var decides which half you get, and
`src/auth.ts` is the only file that reads it:

```
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY   # apps/mobile/.env.local
```

**With the key** `app/_layout.tsx` mounts `<ClerkProvider>` and the navigator
lives inside `<SignedIn>`, so nothing but `app/sign-in.tsx` renders until there
is a session: email → a 6-digit code → in. The session token is cached in the
Keychain (`expo-secure-store`), so that is once per device, not once per launch.
Every API call then carries `Authorization: Bearer <session jwt>`, which is what
the web app's proxy already verifies.

**Without it** — a fresh clone, CI, an mc-dev walk worktree — the provider never
mounts, no sign-in screen renders at all, no `Authorization` header is built, and
the app runs against the seeded `dev-user` exactly as it did before. That is the
default, on purpose: the pipeline must never need a provider key.

Use the same instance as the web app (the same `pk_test_…`) or you will be a
different tenant on the phone than in the browser and see no trips. It is a
*publishable* key: it belongs in `.env.local`, never the secret one.

`app/rig.tsx` shows which half you are in — the Account card above the rig is
your name plus **Sign out** with a session, and the web's dashed `dev-user` pill
without one.

## The map

The in-app map is `@rnmapbox/maps` (issue #32), registered as an Expo config
plugin in `app.json` — which is why a map change is a **native** change and
needs `pnpm --filter @rv-trip/mobile ios`, not `start`.

One env var, and it is public:

```
EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_PUBLIC_TOKEN   # apps/mobile/.env.local
```

Scope it `styles:read` + `fonts:read` + `tiles:read` and nothing else. Note what
a public token on a **native** app can and cannot be protected by: Mapbox's URL
restrictions are a browser mechanism (an HTTP `Referer` check) and do **not**
apply to an app, so there is no equivalent of "restricted to
`com.bradenrc.rvtriphub`" to set. Rotate it if it leaks, and watch the usage
dashboard; that is the whole control surface. The web's key
(`NEXT_PUBLIC_MAPBOX_TOKEN`) is a separate token for the same reason — one
client's leak should not cost the other.

**Without the token** — a fresh clone, CI, an mc-dev walk worktree — every map
surface draws the "Map unavailable" frame and everything else on the screen keeps
working. `mapAvailable()` (`src/map.tsx`) is the guard: a lazy `require` of the
native module plus the token check. It is graceful degradation only — not a
second supported loop, and **no screen offers a Google Maps fallback in its
place**. (Navigate still opens Google Maps, as it always has; that is a drive's
turn-by-turn hand-off, not a map fallback.)

Two things to know about what you see:

- **Night is the stock `dark-v11` basemap on the phone.** The web repaints night
  layer by layer through `mapbox-gl`'s `setPaintProperty`
  (`apps/web/src/components/map/nightfall.ts`), an API `@rnmapbox/maps` does not
  expose the same way. What carries the product's identity over the tiles — the
  *overlay* palette: discs, corridors, labels — is identical on both clients
  (`@rv-trip/core`'s `MAP_PALETTE`). The app opens on **Day**, which is stock on
  both, so the default path is pixel-comparable.
- **The Night / Day / Sat choice is per device**, stored by AsyncStorage under
  `"rv-map-style"` — the same key the web writes to `localStorage`
  (`apps/web/src/components/map/MapMount.tsx:41`). Every read is narrowed by
  core's `isStyleMode`, so a value from a future release cannot hand the
  renderer a palette column that does not exist.

## What's here (v1)

- `app/index.tsx` — Trips (planning / upcoming / traveled)
- `app/trips/[id]/index.tsx` — the trip, under a **Route ⇄ Map** lens: the day
  strip + route list with drives and Navigate, or the same drives as corridors
- `app/trips/[id]/stops/[stopId].tsx` — stop detail: the mini-map, reservations, ideas (tap to cycle), rating + notes (persist)
- `app/rig.tsx` — you (the Account card) and the rig, read-only
- `app/sign-in.tsx` — email → 6-digit code, rendered only when Clerk is keyed
- `src/api.ts` · `src/auth.ts` · `src/map.tsx` · `src/store.ts` · `src/theme.ts` · `src/ui.tsx`

Not in v1: creating anything.
