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
