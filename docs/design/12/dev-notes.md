# Issue 12 — Map style toggle (Night · Day · Satellite) · dev notes

The vetted wireframe (`mc/wireframe/issue-12-v0:docs/design/12/index.html`), built.
Q1·B, Q2·B, Q3·A, Q4·A, Q5·A as answered; the vet's one HIGH and six MEDs are each
resolved below.

## What changed

### New — `apps/web/src/components/map/palette.ts`

The resolved overlay table. Vendor-free by construction: it imports only
`type CategoryLabel`, so nothing about it can reach `mapbox-gl`.

- `palette.ts:43-53` — `STYLE_MODES` / `StyleMode` / `DEFAULT_STYLE_MODE` /
  `isStyleMode()`. **This is where the vet's HIGH lands**: the mode vocabulary
  is here, not on `MapView.tsx`, so `MapMount` can value-import the runtime
  validator without dragging `mapbox-gl` (which touches `window` at import
  time) into the server bundle. Only the `mapbox://` urls stayed on the vendor
  seam (`MapView.tsx:37`).
- `palette.ts:56-92` — `OverlayPalette`, the role interface.
- `palette.ts:95-133` `NIGHT` — every value is the literal its `rv-*` token
  resolves to, with the token named in a trailing comment, exactly as
  `NIGHTFALL_PAINT` does (`nightfall.ts:29`). Night is not a new palette.
- `palette.ts:135-171` `DAY` — the vetted map-only literals.
- `palette.ts:173-178` `SAT` — **a spread of `NIGHT`**, overriding only
  `arcOpacity`, `arcCasing` and `halo`. Night and Sat cannot fork by hand.
- `palette.ts:187` `ARC_CASING_WIDTH = 4`.
- `palette.ts:195-209` `markerShadow(depth, palette, selected)` — composes a DOM
  marker's full `box-shadow`: its own `var(--shadow-rv-*)` depth, then the sat
  halo ring, then the selection ring outside both.

### `apps/web/src/components/map/MapView.tsx`

- `:37-41` — `MAPBOX_STYLE` → `MAP_STYLES: Record<StyleMode, string>`
  (`dark-v11` / `outdoors-v12` / `satellite-streets-v12`). Sole consumer `:159`.
- `:55-57`, `:68`, `:71` — new required `mode: StyleMode` prop; `palette` is
  `MAP_PALETTE[mode]`.
- `:103-117` — **new effect**: `applyNightfall` moves to `map.on("style.load")`,
  guarded on `mode === "night"`, re-bound on mode change, detached on unmount.
- `:119-135` — `onLoad` keeps the `fitBounds` (moving it would re-frame the
  camera on every style swap) plus the first style's repaint.
- `:166-190` — arcs: a casing `<Layer>` rendered *before* (beneath) the line
  layer, only when `palette.arcCasing` is set; the line layer's `line-color`,
  `line-width` **and** `line-opacity` are all mode-keyed.
- `:199-209` — arc label: scrim, border and ink from the palette.
- `:229-245` — pin label: scrim + ink (selected/not) from the palette.
- `:255-270` `SpiderLeader` — takes `palette`, `borderTopColor` inline.
- `:278-338` `StopDisc` — every `rv-*` colour class becomes a palette-driven
  inline style; the layout classes (`size-[27px]`, `rounded-rv-pill`,
  `border-2`, `font-mono text-[12px] font-bold`, `border-dashed`, `text-[13px]`)
  do not move.
- `:343-372` `PlaceDrop` — `categoryMeta(pin.type).color` →
  `palette.category[pin.category]`. `categoryMeta` is no longer imported here;
  the mapping still runs, at `pins.ts:217`, so the five-category *meanings* are
  untouched.

### `apps/web/src/components/map/MapMount.tsx`

- `:41` `STYLE_PREF_KEY = "rv-map-style"`, `:43-47` the three segments
  (`Moon` / `Sun` / `Satellite` — all three confirmed exported by
  lucide-react@1.25.0, so no `Layers` fallback).
- `:62`, `:73` new `showStyleControl?: boolean` (default `true`).
- `:79` the mode, via `useStringPref`. `null` on the server and through
  hydration.
- `:88` `mode === null` → the **existing** `<MapFrame state="loading" />`, the
  same frame the lazy chunk already shows. Nothing new is invented, nothing
  reflows, and the browser never fetches a style it is about to discard.
- `:91` the map wrapper gains `relative`; `:104-106` the pill is
  `absolute right-3 top-3 z-[3]` with `shadow-rv-lg`, inside the `else` branch
  only — there is no style to toggle when there is no map.

### `apps/web/src/lib/pref.ts`

- `:68-89` new `useStringPref(key, isValid, fallback)`, same
  `useSyncExternalStore` discipline as `useBooleanPref`, `try/catch` on both
  read and write. Its one difference: the **server snapshot is `null`** —
  "not resolved yet" — which is precisely what Q4·A needs, without the
  read-in-effect + setState the file's own doc comment rejects.

### `packages/ui/src/Places.tsx`

- `:115-150` `SegmentedControl` gains `mono?: boolean` (default `false`).
  When true: `px-2.5 py-[5px] font-mono text-[11px]` and the active icon takes
  `text-rv-ink` instead of `text-rv-green`. Type only — the labels are content
  and stay title-case ("Night · Day · Sat"), as issue #12 spells them.
  `PlacesLibrary.tsx:84` is byte-identical.

### `apps/web/src/components/map/StopMiniMap.tsx:62`

`showStyleControl={false}`. It inherits the preference through `MapMount`.

### New — `packages/core/src/theme/map-palette.test.ts` (12 tests)

Source-text assertions against `palette.ts`, the same technique
`nightfall-tokens.test.ts` uses for exactly this shape of change (a restyle
with no domain logic to exercise) — and for the same reason: `packages/core` is
the only package with a runner, and `palette.ts` cannot be imported across the
boundary without dragging `@rv-trip/ui`'s React/lucide types into core's
DOM-less `tsc` program. It asserts the night column against the values resolved
live out of `entry.css`, the day column literal for literal, that `SAT` is a
spread of `NIGHT`, the mode-keyed arc geometry, and that the vocabulary is
homed vendor-free.

## Each vet finding

| finding | resolution |
|---|---|
| **HIGH** SSR seam | `StyleMode` + `STYLE_MODES` + `isStyleMode` live in `palette.ts:43-53`; `MapMount.tsx:7` value-imports from there and never from `MapView`. Only `MAP_STYLES` stayed on the vendor seam. |
| **MED** arc geometry | `arcWidth` / `arcOpacity` are palette fields: night 1.6/0.75, day 1.8/0.92, sat 1.6/1 — the three canvases now agree with the paint. `map-palette.test.ts` pins all six numbers. |
| **MED** sat halo seam | Every `shadow-rv-*` class on a marker is gone; all four branches build their shadow through `markerShadow()` (`palette.ts:195`), so the halo ring appends outside the depth shadow and the selection ring grows 5px → 6.5px to sit outside the halo. Each branch keeps its own depth (`lg` for planning, `md` for been/floating/place, `xl` when selected). |
| **MED** missing `:258` | `hollowGround` is documented as the been-disc, floating-disc **and** been-teardrop ground (`palette.ts:71-73`), and `PlaceDrop` uses it at `MapView.tsx:363`. No navy body on a day teardrop. |
| **MED** persistence | `pref.ts` generalised rather than forked — `useStringPref` at `:68`. Key settled as **`rv-map-style`**, matching the shipped flat dash-cased `rv-track-costs`, not the design's dotted `rv.map.style`. |
| **MED** `nightfall-tokens.test.ts` reach | All 16 of its assertions pass over the edited tree. The three named: `text-rv-navy` no longer appears in `MapView.tsx` at all (the ember disc is inline now); `color: … var(--color-rv-navy)` never appears — the palette holds hex literals, no colour `var()`; and `Places.tsx:146` keeps `size-3.5` on the same line as `rv-ink-subtle`. |
| **MED** category legend | The rule is now **stated**, at `palette.ts:26-39` and again at `MapView.tsx:352-354`: app chrome stays Nightfall in all three modes, only what is drawn on the canvas flips. `categoryMeta` and `FilterChip` are untouched, so on Day the chip row does read `rv-green` beside a `#2e8b4e` pin — deliberately. Flagged for the walk to look at. |
| **FLAG (1)** react-map-gl re-add | **Resolved statically now that `node_modules` exists.** `@vis.gl/react-mapbox@8.1.3` (what `react-map-gl/mapbox` re-exports): `Source` and `Layer` each subscribe to `styledata` and force a re-render, then re-create themselves when `map.getSource(id)` / `map.getLayer(id)` comes back empty — `dist/index.cjs` `function Source` / `function Layer`. So the declarative arcs are re-added after a `setStyle` and need no explicit re-add. Still worth *seeing* at walk. |
| **FLAG (2)** real-tile contrast | Untouched, still render-required: the Day literals over live `outdoors-v12` and the white halo over live imagery are not certifiable from source. |
| **INFO** lucide icons | Confirmed: `Moon`, `Sun`, `Satellite` all exported by lucide-react@1.25.0. No fallback used. |

## For qa / the walk

- **Claim to check:** the first style request is the right one. `MapMount`
  renders `MapFrame state="loading"` while `mode === null`, and `LazyMapView`
  is not mounted in that branch at all, so `MAP_STYLES[mode]` is only ever
  evaluated with a resolved mode.
- **Claim to check:** `boundsKey` does not change on a style swap, so the
  `fitBounds` effect does not re-fire and the camera is preserved by
  construction. Nothing in this change touches `bounds`.
- **Defaulted, and out of scope by the design's own words:** `StopMiniMap`
  still leaves `showLabels` unset, i.e. `true`. The wireframe's mini-map panel
  says labels stay off "(`showLabels` unset)", which mis-describes the shipped
  default; the same paragraph says "It passes `showStyleControl={false}` and
  nothing else changes", so nothing else changed. If labels on the mini-map are
  wrong, that is a separate one-line fix.
- **Not covered by an executing test:** everything above the palette — the
  `style.load` re-bind, the `mode === null` loading branch, the `mono` prop's
  rendered classes. There is no component runner in this repo (`vitest` lives
  only in `packages/core`), so these are typecheck + lint + walk, not test.

## Gate

`pnpm turbo run lint typecheck test` — 7/7 tasks successful. Core suite
re-run uncached: 4 files, **52 tests passed** (12 new).
