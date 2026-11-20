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
