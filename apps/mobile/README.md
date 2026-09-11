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
- **The Mapbox SDK download token** — needed from #32 onward, when
  `@rnmapbox/maps` joins the build: the Mapbox iOS SDK is fetched from a
  private registry with a **secret** token (`sk.*`, scope `DOWNLOADS:READ`).
  It lives in `~/.netrc` on your machine and never in the repo, in `.env`, or
  in `app.json`:

  ```
  machine api.mapbox.com
    login mapbox
    password sk.YOUR_SECRET_DOWNLOAD_TOKEN
  ```

  then `chmod 600 ~/.netrc`. That token is read at **build** time only; the
  runtime map key is a separate public `pk.*` token and arrives with #32.

No Apple Developer account and no provisioning are needed for the Simulator.

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

## What's here (v1)

- `app/index.tsx` — Trips (planning / upcoming / traveled)
- `app/trips/[id]/index.tsx` — the trip: day strip + route list with drives and Navigate
- `app/trips/[id]/stops/[stopId].tsx` — stop detail: reservations, ideas (tap to cycle), rating + notes (persist)
- `app/rig.tsx` — the rig, read-only
- `src/api.ts` · `src/store.ts` · `src/theme.ts` · `src/ui.tsx`

Not in v1: creating anything, in-app maps (#32), sign-in (#33).
