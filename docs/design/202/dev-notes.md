# #202 · dev notes, item i1 (#198): the map-engine choice, the resolve seam and both pills

This covers item 1 of 4 only. The design is the wireframe on `mc/wireframe/issue-202-v0`
(`docs/design/202/index.html` + `plan.json`), with answers q1–q7 = A,A,B,A,A,A,A. The vet
findings are on `mc/vet/issue-202-v0`. In this item Google availability is `"not-built"` on
both clients, so Mapbox always draws. A `"google"` choice is kept and shows the amber note.

## What changed

**Core: the seam** (`packages/core/src/domain/prefs.ts`)
- `:46` adds `PREF_REMOTE["rv-map-engine"] = "mapEngine"`. Web `lib/pref.ts` write-through
  and `hydrate()` pick this up with no call-site change.
- `:77` adds `userPrefsPatch.mapEngine`, a nullable string (max 32), like `mapStyle`. The
  schema is `.strict()`, so without this the PUT would 400.
- `:98` adds `UserPrefs.mapEngine?`. It is optional so older rows and fixtures still type.
- `:190` onward adds `MapEngine`, `DEFAULT_MAP_ENGINE = "mapbox"`, `MAP_ENGINES` (Mapbox ·
  Google labels), `isMapEngine`, `GoogleFallbackReason`, `GoogleAvailability`, and
  `resolveMapEngine` (`:226`). It never rewrites the choice (q2 A), and an unknown stored
  value falls back to Mapbox.
- `:237` adds `MAP_ENGINE_FALLBACK_COPY`, the wireframe's three amber notes verbatim. `:248`
  adds `mapEngineFallbackLine`, the one-line "⚠ title. body" form used by the Settings and
  You-tab rows.

**DB** (`packages/db`)
- `src/schema.ts:529` adds `mapEngine: text("map_engine")`: nullable text, not a pgEnum,
  following the user_prefs rationale. The vet MED finding asked for this.
- `drizzle/0009_map_engine.sql` is the migration, made by `drizzle-kit generate`. It is one
  line: `ALTER TABLE "user_prefs" ADD COLUMN "map_engine" text;`. The journal and
  `meta/0009_snapshot.json` are also generated.
- `src/queries.ts:927` / `:940` adds `mapPrefsRow`'s param + return; `src/mutations.ts:1985`
  adds the `upsertPrefs` key loop; `src/testing/fixtures.ts:469` / `:484` adds `insertPrefs`.

**DS** (`packages/ui/src/Places.tsx:210`, `:245`)
- Adds an optional `SegmentOption.struck`. When set, the label renders
  `line-through decoration-rv-warning`, matching the wireframe's `.seg > span.off`. No
  existing caller passes it, so no shipped pill changes. The RN mirror is
  `apps/mobile/src/ui.tsx:135` / `:184` (`textDecorationLine` + `textDecorationColor:
  C.warning`).

**Web**
- In `apps/web/src/components/map/MapMount.tsx`:
  - `:64` adds `ENGINE_PREF_KEY = "rv-map-engine"`.
  - `:71` adds `WEB_GOOGLE_AVAILABILITY = { ok: false, reason: "not-built" }`. #199
    replaces this with the key + Map ID check.
  - `:76` adds `engineSegments(fallback)`.
  - `:86` adds `EngineFallbackNote`, using the warning roles only.
  - `:135` resolves the choice through core.
  - `:163` stacks the overlay as a column: style pill, then engine pill, then the amber note
    (q1 A). Each pill keeps its own `shadow-rv-lg` wrapper as shipped. Only the pill's own
    `onChange` writes, so a tap is the only write.
- In `apps/web/src/components/settings/SettingsForm.tsx`:
  - `:119` corrects the help copy to "What every map opens with. Day is the product default."
  - `:125` adds a new "Map engine" row under it, with help "Which map draws every map in the
    app. Your pins look the same on both." Its options come from MapMount's `engineSegments`.
    It shows the amber `fbline` when the choice falls back.
  - `:195` adds `engineFromPrefs`, the server row for the unresolved first render, like
    `styleFromPrefs`.

**Phone**
- In `apps/mobile/src/map.tsx`:
  - `:171` adds `usePhonePref(key, isValid, fallback)`. It reads AsyncStorage first, then
    `GET /api/prefs`; the row wins when it has a valid value and is written back to the
    device. A tap writes AsyncStorage, then `PUT /api/prefs` with core's `toRemotePatch`
    (one field).
  - A tap made before the row answers is never overwritten (a `chosen` ref).
  - Hooks that mount together share one GET (`readRemotePrefs`).
  - `useStyleMode` (`:225`) and the new `useMapEngine` (`:230`) both go through it (q3 B).
    There is still exactly one `getItem(` read site.
  - `:122` adds `ENGINE_PREF_KEY`, `:135` adds `PHONE_GOOGLE_AVAILABILITY` (`"not-built"`;
    #200 swaps in `loadGoogle()` → `"no-module"`), `:138` adds `engineSegments`, and `:235`
    adds `EngineFallbackNote`.
  - `TripMap` calls `useMapEngine()` (`:506`). Its over-canvas pill column (`stylePill`,
    `:766`) now stacks style pill, engine pill and amber note.
- In `apps/mobile/app/(tabs)/you.tsx`:
  - `:171` adds `MapsCard`: a "Maps" kicker, then a card with a "Map style" row (Night/Day/Sat)
    and a "Map engine" row ("Follows your account to the web.", Mapbox/Google, plus the amber
    line).
  - It is mounted under the Home base row in both rig branches (`:69`, `:91`).

## Tests
- `packages/core/src/domain/prefs.test.ts` has one case per resolution-table row: null,
  "mapbox", google + available, no-key, no-module, not-built. It also covers an unknown value,
  `toRemotePatch("rv-map-engine", …) → { mapEngine }`, `userPrefsPatch` accepting `mapEngine`
  (string or null) and rejecting a number, `toLocalEntries`, the round trip, and the verbatim
  fallback copy.
- `apps/web/src/app/api/prefs/route.test.ts` runs against real Postgres, with the test DB
  migrated through 0009. It checks that the PUT stores `mapEngine` without disturbing
  `mapStyle` and that GET returns it. The first-insert shape now includes `mapEngine: null`.
- `apps/web/src/components/map/map-engine.test.ts` is new. It executes `engineSegments` and
  the availability constant, and reads the pill stacking and write path from source.
- Source pins updated:
  - `settings-page.test.ts`: the Day copy, the Map engine row, `<SegmentedControl<MapEngine>`.
  - `prefs-account.test.ts`: `map_engine` is bare text, not a pgEnum.
  - `mobile-map.test.ts`: the one-read-site pin is now the generic narrow, plus new #198
    cases for usePhonePref ordering, the pill stack and the You Maps card.
- **Changed rule, please review:** `mobile-map.test.ts` used to forbid `/google/i` anywhere in
  `src/map.tsx`. The epic deliberately makes Google a second engine, so for `map.tsx` it now
  forbids only a Google Maps hand-off (`maps.google|google.com/maps|comgooglemaps|Linking`).
  The trip and destination screens still forbid `/google/i` outright.
- Order caveat: the core seam was written just before its tests were run, not strictly
  red-first. All tests listed run and pass.

## Local gate
- `pnpm turbo run lint typecheck test` exited 0: `Tasks: 10 successful, 10 total`. That is
  core 1680/1680, web 632/632, ui 56/56, and typecheck for core, db, ui, web and mobile.
- `pnpm install --frozen-lockfile` was run first, because the fresh worktree had no
  node_modules.
- `pnpm db:push` was **not** run against the shared local dev DB at :5433. The web suite
  migrates its own fresh test DB, which covers 0009, and deploys run migrate-in-build.

## Defaults and flags for the walk / qa
- **PinMap gets no engine pill.** The plan says "engine pill under the style pill in
  TripMap/PinMap", but `PinMap` (the capture pin sub-screen) has no style pill to stack under.
  I left it alone rather than invent a control. #200 will make PinMap engine-aware for
  rendering.
- **The "new" tag and accent inset bar on the wireframe's settings rows were read as
  annotation**, not UI copy, so neither is rendered.
- **The phone pill keeps the shipped RN `Segmented mono` sizing.** The wireframe draws the
  phone pill a step smaller (10px / 4×8). I did not restyle the shipped control.
- **The web Settings row also shows the amber line when Google falls back.** The wireframe
  draws the web row with Google working and no line. The caption "the amber line follows the
  engine row wherever the pill appears" drove this.
- **Walk states reachable in i1:**
  - Tap Google on /map, /places, a trip's Journal map, Settings, or a phone trip map / You
    tab. Google stays selected and struck in amber, the note reads "Google map is coming ·
    Showing Mapbox for now. Your choice is kept.", and Mapbox keeps drawing.
  - Tap Mapbox and the note disappears.
  - Engine and style chosen on the phone should appear on the web after a reload, and the
    other way round (phone: next map mount).
- The DestinationMiniMap passes `showStyleControl={false}`, so it shows no engine pill either,
  as the design says.
- Phone `TripMap` now mounts `useMapEngine()` on every map, including the mini map and
  journal. That costs one shared `GET /api/prefs` per mount burst. It fails silently with no
  network.

---

# #202 · dev notes, item i2 (#199): the web Google engine behind MapMount

This covers item 2 of 4 only. I1 (the choice, the seam, both pills) was already on the branch
and was not redone. The design is the same wireframe (`mc/wireframe/issue-202-v0`, §1 "The map
on Google", §3 "The seam" and the mode table). The answers are the same: q4 A means a Map ID
is required and the discs are Advanced Markers.

## What changed

**Core** (`packages/core/src/domain/prefs.ts`)
- `:264` adds `webGoogleAvailability(key, mapId)`. It returns `{ ok: true }` only when both
  values are non-blank. Otherwise it returns `{ ok: false, reason: "no-key" }`.
- `:283` adds `GOOGLE_WEB_BASEMAP`, the wireframe's mode table:
  - day → `roadmap` / `LIGHT`
  - night → `roadmap` / `DARK` (the Map ID's colour scheme)
  - sat → `hybrid` / `LIGHT`
- Both use string literals, not `google.maps` enums, so core stays vendor-free.

**Web**
- New file `apps/web/src/components/map/markers.tsx`. `PinMark`, `ArcLabel`, `markerTier`,
  `labelAt` and the private `SpiderLeader` / `DestinationDisc` / `PlaceDrop` / `IdeaRing`
  were moved here **unchanged** from `MapView.tsx`. The reason: Google has to draw the same
  HTML discs, and importing them from `MapView.tsx` would pull mapbox-gl into the Google
  chunk. `MapView.tsx:18`, `:293` and `:310-315` now render through these. The Mapbox output
  is unchanged.
- New file `apps/web/src/components/map/GoogleMapView.tsx`. Its props are
  `GoogleMapViewProps = Omit<MapViewProps, "token">` (`:40`), and it imports `MapView` as a
  type only.
  - `:413` `loadGoogleMaps()` injects the Maps JS script once per page (`v=weekly`,
    `loading=async`, callback), then calls `importLibrary("maps")` and `("marker")`. There
    is no runtime npm dependency.
  - `:127` creates the map: `mapId` = `NEXT_PUBLIC_GOOGLE_MAP_ID`, then `colorScheme` and
    `mapTypeId` from `GOOGLE_WEB_BASEMAP[mode]`. It also sets
    `gestureHandling: "cooperative"` (MapView's `cooperativeGestures`) and
    `disableDefaultUI: true` (MapView draws no nav controls). Google's logo and attribution
    are not controls, so they stay and are never hidden.
  - `colorScheme` can only be set when a map is built, so day ↔ night rebuilds the map at the
    camera the reader left. A switch to or from sat only calls `setMapTypeId`.
  - `GoogleMarker` (`:220`) is an `AdvancedMarkerElement` whose content is a React portal.
    It renders the same `PinMark` / `ArcLabel` in `MAP_PALETTE[mode]`. It is centred on the
    coordinate (Google anchors bottom-centre, Mapbox centre) and nudged by the spiderfy
    offset. A click goes through `gmp-click` to `onSelect`, and the z-tiers come from
    `markerTier`.
  - `ArcLines` (`:281`) draws a HERE corridor as a solid polyline at `CORRIDOR_WIDTH` 2.6
    over the `corridorCasing` casing.
  - An estimate is a dashed polyline at `palette.arcWidth` / `arcOpacity`. It is cased only
    where the mode cases it (sat), as MapView does. The dash is a repeated line symbol sized
    to MapView's `[2.2, 1.8]` × width (`dashed`, `:351`). The Journal `join` is the same
    dashed line (`DashedLine`, `:331`).
  - Camera: it fits on first build, then re-fits only when the new bounds are not already on
    screen (`boundsCovers`, MapView's #80 i4 rule). Padding is 56. Max zoom is clamped to 12
    after the fit, which is Google's equivalent of Mapbox's 11.
  - If the script fails or `gm_authFailure` fires (a rejected key or referrer), it falls
    back to `MapFrame state="unavailable"`.
- `apps/web/src/components/map/MapMount.tsx`:
  - `:55` adds a second lazy `dynamic(() => import("./GoogleMapView"), { ssr: false })`.
    Nothing Google-related is imported at module scope.
  - `:83` sets `WEB_GOOGLE_AVAILABILITY = webGoogleAvailability(...)`, with both
    `process.env.NEXT_PUBLIC_*` reads written out literally so Next inlines them. Settings
    reads the same constant, so its row's amber line now says "no-key" too.
  - `:153` adds `drawable`: Google needs no Mapbox token, and only a Mapbox draw without a
    token shows "unavailable".
  - `:161` makes the loading frame also wait for `engine`, so a Google reader never loads
    mapbox-gl first.
  - `:168` picks `LazyGoogleMapView` vs `LazyMapView` from `resolved.engine`.
- `.env.example` documents `NEXT_PUBLIC_GOOGLE_MAPS_KEY` + `NEXT_PUBLIC_GOOGLE_MAP_ID`
  (commented out, so walks and CI stay key-free).
- `apps/web/package.json` adds the devDependency `@types/google.maps` `3.66.8` (types only,
  pinned, ~3 weeks old). `pnpm-lock.yaml` was regenerated by `pnpm add`. pnpm also rewrote
  one existing `eslint-import-resolver-typescript` peer-suffix key in that file. That is
  pnpm's own normalisation, and I did not hand-edit it.

## Tests (red first for core)
- `packages/core/src/domain/prefs.test.ts:286` covers the web availability rule: key + Map
  ID → ok; either one undefined, empty or blank → `no-key`; and how it feeds
  `resolveMapEngine`.
- `prefs.test.ts:312` covers the mode → Google map-type mapping. Both tests failed before
  the implementation (4 failed) and pass after.
- `apps/web/src/components/map/map-engine.test.ts`:
  - The old `"not-built"` assertion is replaced by the literal env-read pin.
  - `:85` pins that MapMount has no module-scope Google import, only the lazy `dynamic()`.
    It also pins that Google gets no `token=`, that Google draws without a Mapbox token, and
    that loading waits on the engine.
  - `:114` pins GoogleMapView's type-only MapView import, the basemap from
    `GOOGLE_WEB_BASEMAP` + Map ID, the shared `PinMark` / `ArcLabel` in both engines, the
    solid/dashed widths pinned equal to MapView, and that nothing hides the attribution.
  - These are source reads: the web vitest has no DOM, and the Maps JS can't run in CI with
    no key.
- `map-filters.test.ts` and `journal-map.test.ts` now read the moved marker functions from
  `markers.tsx`. Their assertions are the same.

## Local gate
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. That is core
  1684 passed, web 641 passed and ui 56 passed, plus lint and typecheck for all packages.
- `next build` was **not** run; typecheck and lint cover the new files.
- **No live Google render was executed.** There is no browser key or Map ID in this
  environment, and the brief keeps walks key-free.

## For the walk / qa
- **Walkable here:** with no keys, tap Google on /map, /places, a trip's Journal map or
  Settings. Google stays selected and struck in amber, the note reads "Google isn’t set up
  here · Showing Mapbox. Your choice is kept.", and Mapbox draws.
  - This replaces i1's "Google map is coming" note on the web.
  - The phone still shows "not-built" until i3.
- **Needs Braden's key + Map ID to check, operator-owned:** set both in
  `apps/web/.env.development.local` (not `.env.local`, which is copied into walk worktrees),
  then check:
  - day = roadmap, night = dark scheme, sat = hybrid
  - the discs, drops, rings and labels match Mapbox's, and clicking a pin selects it
  - corridor solid, estimate dashed
  - Google attribution bottom-right
  - day ↔ night keeps the camera
- **Claims to verify:**
  - Mapbox rendering is unchanged by the markers.tsx move: it is the same JSX, now behind
    `PinMark`.
  - The Google chunk does not contain mapbox-gl: GoogleMapView imports MapView as a type
    only.
- **Default I chose:** Google business icons are left clickable with Google's own info
  window for now. Suppressing it (`e.stop()`) and the Save card are i4 (#201).
- **Edge case:** if the Mapbox token is missing but Google is set up and chosen, the SSR
  frame is "unavailable" for one render before the client resolves the engine to Google.

---

# #202 · dev notes, item i3 (#200): the phone Google engine behind TripMap and PinMap

This covers item 3 of 4 only. I1 (the choice, the seam, the pills) and i2 (the web Google
engine) were already on the branch and were not redone. The design is the same wireframe
(`mc/wireframe/issue-202-v0`, §3 "The seam" and the mode table's "Google · phone" column).
The answers are unchanged: A,A,B,A,A,A,A.

## What changed

**Core** (`packages/core/src/domain/prefs.ts`)
- `:297` adds `phoneGoogleAvailability(moduleLoaded)`. It returns `{ ok: true }` or
  `{ ok: false, reason: "no-module" }`.
- `:313` adds `GOOGLE_PHONE_BASEMAP`, the mode table:
  - day → `standard`
  - night → `standard` + `dark`
  - sat → `hybrid`
- Both use string literals, so core stays vendor-free, like i2's `GOOGLE_WEB_BASEMAP`.

**Dependency.** `apps/mobile/package.json` adds `react-native-maps` `1.27.2`.
- This is the exact version in Expo 57's `bundledNativeModules.json`. It was published
  2026-03-11.
- `pnpm-lock.yaml` was regenerated by `pnpm add`. Against `71fd84f`, the net lock diff is
  only the two new packages (`react-native-maps` here and i2's `@types/google.maps`). The
  eslint-resolver key that pnpm rewrote in i2 is back to its original form.

**Key slots** (new file `apps/mobile/app.config.ts`)
- It layers over `app.json`, which is unchanged, and appends
  `["react-native-maps", { iosGoogleMapsApiKey, androidGoogleMapsApiKey }]`.
- The keys come from `GOOGLE_MAPS_IOS_KEY` / `GOOGLE_MAPS_ANDROID_KEY` in the environment
  (EAS env vars or `.env.local`). The repo is public, so no key is committed.
- It publishes only `extra.googleMaps: { ios: boolean, android: boolean }` to the runtime,
  never the key.
- `apps/mobile/README.md:156` documents both variables.

**Phone** (`apps/mobile/src/map.tsx`)
- `:145` adds `loadGoogle()` beside `loadMapbox()`. It is a lazy
  `require("react-native-maps")` inside a try, resolved once, and returns null when the
  require throws. react-native-maps binds its TurboModule (`getEnforcing`) on first require,
  so a binary without the module throws there.
- It also returns null when `googleKeyConfigured()` (`:132`) is false for this platform.
  **The reason:** the plugin links the iOS `react-native-maps/Google` pod only when the iOS
  key is set. A keyless iOS build would have the module but no Google renderer.
- `:162` adds `googleAvailability()`, which is `phoneGoogleAvailability(loadGoogle() !==
  null)`. It replaces i1's `PHONE_GOOGLE_AVAILABILITY = "not-built"` constant. The constant
  was removed, and `app/(tabs)/you.tsx:174` now calls `googleAvailability()`.
- `:171` sets `GOOGLE_ZOOM_OFFSET = 1`. Google's zoom runs one level ahead of Mapbox's, so
  the fit max is 12 (the same as i2's web clamp) and the pin zoom is 15.
- `:178` adds `ANDROID_NIGHT_STYLE`, the Android night `customMapStyle`, built only from
  `C.*` (rv-*) tokens.
- In `TripMap`:
  - `:592` hoists the pill column into `pills`, unchanged, so both engines render the same
    style pill, engine pill and amber note.
  - `:609` takes the Google branch when `resolved.engine === "google"`, **before** the
    Mapbox token guard, because Google needs no Mapbox token. The empty frame still applies.
- `:759` adds `GoogleTripCanvas`, with `provider={maps.PROVIDER_GOOGLE}`, `mapType` and
  `userInterfaceStyle` set from `GOOGLE_PHONE_BASEMAP[mode]`. Android night gets the
  `customMapStyle` above. iOS always gets an explicit `"light"`/`"dark"`, because
  `app.json` sets the whole app to `userInterfaceStyle: "dark"`.
  - The grammar matches the Mapbox layers:
    - casing at `ARC_CASING_WIDTH` under every routed arc, and under estimates only when
      `palette.arcCasing` is set (sat)
    - corridor solid at `CORRIDOR_WIDTH`
    - estimate dashed at `palette.arcWidth`, with `ESTIMATE_DASH × width` and `arcOpacity`
      carried on the colour (`withOpacity`, `:745`, because Polyline has no opacity prop)
    - the Journal join dashed with no casing
  - Arc labels, entries and the same `DestinationDisc` are `Marker` children, anchored at
    centre like `MarkerView`. Taps use `Marker.onPress`, because Google markers are
    bitmaps and an inner Pressable gets no touches. A tap on the map ignores
    `marker-press`.
  - Camera: `initialRegion` from the bounds, then `fitToCoordinates` with no animation on
    `onMapReady`. It re-fits (animated) when the bounds change by value. Padding is 56.
  - `toolbarEnabled={false}` (`:839`): Android's marker toolbar is a hand-off to Google
    Maps, which the existing no-hand-off rule forbids. `showsCompass={false}`. Google's
    logo is left alone.
- `PinMap` (`:976`) resolves the account's engine (no pill, as i1 decided). With Google it
  draws a `PROVIDER_GOOGLE` map at the same basemap mapping, with `initialCamera` at the
  fix and `onRegionChangeComplete` → `onMove`. Otherwise it falls back to Mapbox, then the
  blank grid, as before.

## Tests (red first)
- `packages/core/src/domain/prefs.test.ts:324`:
  - **acceptance:** an absent module resolves `"google"` to
    `{ engine: "mapbox", fallback: "no-module" }`
  - present → google
  - mapbox or null → no note
  - `GOOGLE_PHONE_BASEMAP` (`:352`)
  - 4 failed before the core change and pass after.
- `packages/core/src/mobile-map.test.ts:519` is a new `#200` block of source pins. It failed
  before the changes (no `app.config.ts`) and passes after. It pins:
  - the dependency version
  - `loadGoogle` as a lazy try/require, checked after the key flag, beside `loadMapbox`,
    with a type-only import
  - two `PROVIDER_GOOGLE` paths, and Google taken before the Mapbox token guard
  - the basemap mapping, and the night style containing no hex
  - the widths, dash and casing rule, the shared `DestinationDisc`, and the fit padding
  - `toolbarEnabled={false}`
  - the env-read key slots, with no `AIza` literal and only a boolean in `extra`
  - the README lines
- `mobile-map.test.ts:467` replaces i1's `"not-built"` pin. `:286` now pins
  `resolveMapEngine(engine, googleAvailability())`.
- **Cannot execute here:** the Google render path itself. `apps/mobile` has no test runner,
  and react-native-maps is native. It is covered by `tsc` (the acceptance's "type-checks")
  and the source pins, not by a render.

## Local gate
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. That is core
  1695 passed, web 641 passed and ui 56 passed, plus typecheck for mobile, which includes
  `app.config.ts`.
- `npx tsc --noEmit` in `apps/mobile` was clean on its own as well.
- **Not run:** prebuild, a dev-client build, or any simulator render. There are no Maps SDK
  keys here, and walks stay key-free.

## For the walk / qa
- **Walkable here, key-free:** tap Google on a phone trip map or the You tab. Google stays
  selected and struck, the note reads "This version of the app has no Google map · Showing
  Mapbox until you update.", and Mapbox draws. That replaces i1's "Google map is coming".
  The capture pin map also keeps drawing Mapbox.
- **Operator-owned (needs Braden's keys and a new dev-client build):**
  1. Set `GOOGLE_MAPS_IOS_KEY` / `GOOGLE_MAPS_ANDROID_KEY` (EAS env or
     `apps/mobile/.env.local`).
  2. Run `pnpm --filter @rv-trip/mobile ios` / `android` (a prebuild plus a native build).
     The prebuild will add the Google pod and the manifest key.
  3. Check:
     - day = standard, night = dark (iOS through `userInterfaceStyle`, Android through
       the token style), sat = hybrid
     - discs, rings, labels, solid corridor and dashed estimate match Mapbox
     - tapping a pin or entry selects it
     - the Map tab's tap-off clears its card
     - the capture pin map follows the drag
     - the Google logo is visible
- **Executed:** with no keys, `npx expo config --type public --json` in `apps/mobile`
  evaluates `app.config.ts`. It prints `extra.googleMaps = {'ios': False, 'android': False}`
  and the plugin entry `['react-native-maps', {}]`.
- **Claims to verify:**
  1. With no keys, a prebuild runs the plugin's remove branches and does not fail. That
     needs `expo prebuild`, which was not run.
  2. Keyless walks never require react-native-maps at all, because the key flag
     short-circuits first.
- **Risk, flagged:** `extra.googleMaps` comes from the config the JS sees. In a dev client
  that is the Metro server's env at serve time, not the binary's build time. Running Metro
  *with* the keys against a binary built *without* them would pick Google, and on iOS hit
  the missing Google pod. The reverse case falls back safely. Build and serve with the same
  env.
- **Defaults I chose:**
  - Markers keep react-native-maps' default `tracksViewChanges`, so selection repaints on
    Android, at some cost in performance.
  - Engine resolution waits for the pref (null → Mapbox for one beat), as TripMap already
    did in i1. A Google reader may see Mapbox for an instant on mount.
  - PinMap now also mounts `useMapEngine()`, which shares the one `GET /api/prefs`.
- `onPoiClick` and the business card are i4 (#201), not built here.
