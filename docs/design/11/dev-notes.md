# Issue 11 — Map rendering (Nightfall basemap) · dev notes

Implements the signed wireframe (`mc/wireframe/issue-11-v0:docs/design/11/index.html`) —
one `MapView` in three modes, the Nightfall repaint of `dark-v11`, the four layer chips,
the docked 360px rail, the deterministic spiderfy and the three no-map frames.

## What changed

### New — pure geometry, unit-tested in `packages/core`
- `packages/core/src/domain/bounds.ts:44` `boundsFor(points)` — fit box over the union of
  visible pins; `null` on empty input; a degenerate axis is padded to
  `MIN_BOUNDS_SPAN` (`:30`, 0.05°) and clamped to the legal lat/lng range, so a single
  point cannot ask the map for infinite zoom.
- `packages/core/src/domain/bounds.ts:33` `hasCoords()` — the one narrowing for
  `lat`/`lng` being `.nullable()` (`types.ts:38-39`).
- `packages/core/src/domain/bounds.ts:115` `spiderfy()` — G6. Groups on the coordinate
  rounded to 5dp (`SPIDER_PRECISION`, `:84`), orders members by `id`, lets the first
  `anchor` (a trip stop; else the lowest id) keep the true point, and lays the rest on a
  26px ring (`SPIDER_RADIUS_PX`, `:80`) starting up-and-right at even angles. Returns
  screen-space `dx/dy` plus the untouched true coordinate, so the leader line has both ends.
- `packages/core/src/domain/bounds.test.ts` — 15 tests. Empty input and the single point
  are pinned explicitly (the two cases the design named), plus the 5dp grouping boundary,
  input-order independence, and all four seeded collisions resolving at once.
- `packages/core/src/domain/index.ts:3` — re-export (the barrel `packages/core/src/index.ts`
  already re-exports `./domain/index`).

### New — the DS's map-absent frames
- `packages/ui/src/MapFrame.tsx:12` `MapFrame({ state, count, height })` renders the three
  frames the wireframe draws: `loading` (grid-on-gradient, "Map view / Loading tiles…"),
  `unavailable` (`border-rv-warning bg-rv-warning-soft`, "Map unavailable / The map token
  isn't configured for this environment…") and `empty` (dashed `border-rv-border-hi`,
  "Nothing to map yet / None of these N places has coordinates…"). Exported at
  `packages/ui/src/index.ts:21-22`.

### New — the app's map layer (`apps/web/src/components/map/`, vendor code lives only here)
- `pins.ts:145` `buildMapModel(trips, places)` — the one flat pin list, the coordless rows,
  and the drive arcs. Ordinals and arcs both come off the **trip-wide scheduled stops sorted
  by `arriveDate`** (`pins.ts:112`), the ordering `routeSummary()` already uses
  (`trip-logic.ts:294`), and the miles come from the shipped `estimateDrive()` — no fourth
  haversine (G7). Arcs are skipped for `been` trips (`pins.ts:186`).
- `pins.ts:235` `categoryCounts(places)` — over **all** saved places, not the active shelf.
- `pins.ts:245` `layerCounts()`.
- `nightfall.ts:29` `NIGHTFALL_PAINT` — the six paint rows, each literal carrying its
  `rv-*` token name as a provenance comment. `nightfall.ts:80` `applyNightfall(map)` resolves
  the colour property from the layer's own `type` and **skips any layer the style doesn't
  have**, so a renamed/absent `dark-v11` layer degrades instead of throwing at load.
- `MapView.tsx:37` — the one map component. `react-map-gl/mapbox` `<Map>`, `<Source>/<Layer>`
  for the dashed ember arcs, DOM `<Marker>`s for pins (category colours are
  `var(--color-rv-*)` strings, which only work on DOM markers, not GL symbol layers) and for
  the `~N mi · est.` arc labels. Pin grammar: numbered green disc for a trip stop
  (`StopBar`'s `bg-rv-green-soft`/`border-rv-green`/`text-rv-green-ink`), hollow for
  been-there, amber dashed `◇` for floating, ember for selected; category teardrop for a
  saved place, filled = want / hollow = been. `SpiderLeader` (`MapView.tsx:187`) draws the
  1px dashed `rv-border-hi` leader. Re-fits on every change of the visible set.
- `MapMount.tsx:37` — the single `"use client"` seam that owns
  `next/dynamic(..., { ssr: false })` and picks between the three `MapFrame` states and the
  real map. All three modes mount through it.
- `MapOverview.tsx:47` — `/map`: layer chips, category chips, the quiet "N unmapped" chip,
  the canvas + 360px rail (`gridTemplateColumns: "1fr 360px"`, `MapOverview.tsx:131`) and the
  legend.
- `StopMiniMap.tsx:15` — mode 2 at exactly 150px (`STOP_MINI_MAP_HEIGHT`, `:13`).

### Wired in
- `apps/web/src/app/map/page.tsx` — was `StubPage`; now a Server Component with
  `export const dynamic = "force-dynamic"` that awaits `listTripsWithStopsForOwner()` +
  `listSavedPlacesForOwner()` under `getOwner()` and renders `<MapOverview />` (read-only —
  no API surface added, no schema/enum change).
- `packages/db/src/queries.ts:101` `listTripsWithStopsForOwner(ownerId): Promise<Trip[]>` —
  G2. Same `TRIP_WITH` load as `listTripsForOwner`, `rows.map(mapTripRow)` instead of
  `summarize()`. Existing export untouched; the barrel already re-exports `./queries`.
- `apps/web/src/components/trip/StopDetailSheet.tsx:130` — `<MapPlaceholder>` → `<StopMiniMap>`.
- `apps/web/src/components/trip/TripPlanner.tsx:74,245` — computes the trip-wide scheduled
  ordinal and passes it as `stopOrdinal`, so the sheet's disc and /map's disc show the same
  number.
- `apps/web/src/components/places/PlacesLibrary.tsx:125` — `<PlacesMapPanel>` → `<MapMount>`
  fed `lens` (`:66`), built from `list` (`:59`) — the already-filtered array. It never filters
  again. Adds the "N places hidden by the {cat} filter" line the wireframe draws (`:129`).
- `.env.example:20` — G9: `NEXT_PUBLIC_MAPBOX_TOKEN` uncommented, comment corrected.
- `apps/web/package.json:20,26` — `mapbox-gl 3.30.0` and `react-map-gl 8.1.3`, pinned exact.

## How each vet finding was resolved

- **HIGH · reuse claim fails (the three no-map frames).** Took the DS path the design's own
  dev footer implies: a new `packages/ui/src/MapFrame.tsx` renders all three frames exactly
  as drawn. `MapPlaceholder` (`DetailCards.tsx:10`) and `PlacesMapPanel` (`Places.tsx:236`)
  are left **byte-identical** — no restyle, no breaking prop change; they simply stop being
  the call target at the two sites that now mount a real map. So every state has a named
  render target, in the DS, with no vendor code in `packages/ui`.
- **MED · provenance claim fails (chip counts).** `/map` uses its own
  `categoryCounts(places)` (`pins.ts:235`) over both shelves — All 8 · Stay 3 · Eat 2 · Do 2
  · Travel 1. `PlacesLibrary`'s shelf-scoped memo (`:49-56`) is deliberately **not** reused;
  the comment on `pins.ts:230-234` says why.
- **MED · wrong data fact ("15 stops").** That string lives only in the wireframe's own hero
  strip; no code carries it. The seed's real 11 stops (4 planning + 4 upcoming + 3 been) are
  what `layerCounts()` computes, so the number cannot become an acceptance criterion.
- **MED · G6 citations slide by one.** Followed the collisions, not the line numbers.
  Verified against the seed: Sunny's Smokehouse ≡ Bend `44.0582,-121.3153`; Crater Lake Rim
  Drive ≡ Crater Lake NP `42.9446,-122.109`; Fishing Bridge RV Park ≡ Fishing Bridge stop
  `44.5647,-110.3735`; Oregon Coast Weekend's Newport ≡ PNW Newport `44.6365,-124.053`. All
  four are asserted by name in `bounds.test.ts` ("resolves all four collisions the seed
  carries").
- **MED · citation drift elsewhere.** Comments in the new code cite what was re-checked in
  this worktree, not the design's numbers.
- **MED · misattributed role (ember = selected).** No `conventions.md` citation was carried
  over; ember-for-selected is applied per `packages/ui/styles/entry.css:32`.
- **MED · unnamed render targets (rail line item, "N unmapped" chip).** Both are built as
  token-styled layout glue and say so in code: `SelectedCard` (`MapOverview.tsx:235`) carries
  a note that it is *not* `ReservationLineItem` (no room for the mono meta line), and the
  unmapped chip (`MapOverview.tsx:121-127`) carries a note that it is *not* `FilterChip`
  (nothing to press, no `count`/`onClick`/`aria-pressed`).
- **FLAG · render-required: the paint contract.** Cannot be verified statically and was not
  claimed. Mitigated rather than asserted: `applyNightfall()` guards on `map.getLayer(id)`
  and resolves the property from the layer's `type`, and wraps the write in `try/catch`, so a
  renamed or missing layer costs that one colour instead of blanking the route. The six rows
  still need confirming against the live style at walk.
- **FLAG · render-required: the spiderfy.** The pure math is unit-tested (deterministic
  ordering, ring radius, 5dp grouping, all four seed collisions). Pointer targeting at real
  zooms is untested — needs walk.

## Decisions / defaults worth checking

- **Ordinals and arcs are trip-wide-scheduled**, matching `routeSummary()`. Verified offline
  that `estimateDrive()` over the seed reproduces the design's four arcs exactly:
  Astoria→Newport **108 mi**, Newport→Bend **141 mi** (PNW sum 249, as G7 claims),
  Moab→Sedona **284 mi**, Sedona→Tucson **188 mi**.
- **Default selection** is the first visible pin (for the seed: Astoria), which is what the
  wireframe draws. A selection hidden by a chip toggle falls back to the first visible pin
  rather than emptying the rail.
- **Mode 3 has no selection state.** The wireframe's green emphasis ring on the single lens
  pin is not implemented — `PlacesLibrary` passes no `selectedId`, and the right column is
  still its shipped `PlaceCard` list. Flagged for the walk as a deliberate scope call.
- **`pins.ts` is not covered by an executing test runner.** Only `packages/core` has a `test`
  script, and `pins.ts` must live in the app because it calls `estimateDrive()` from
  `@/lib/trip-ui` (G7: do not write a fourth haversine). The pure, portable parts —
  `boundsFor` and `spiderfy` — were pushed into `packages/core` and are tested there. The
  arc mileage was verified offline (numbers above) but not by a committed test.
- **`rv-ink-subtle` is non-text only.** The shipped guard at
  `packages/core/src/theme/nightfall-tokens.test.ts:193` failed on two lines that copied the
  wireframe's `--rv-ink-subtle` onto text. Both were moved to `rv-ink-faded` (the documented
  "mono kickers" role) / a sized `CircleDashed` icon. The repo's enforced token rule wins
  over the wireframe's CSS mirror; noted so it doesn't read as drift.
- **`maplibre-gl` is an unmet optional peer** of `react-map-gl` (it ships both adapters). We
  import `react-map-gl/mapbox` only; pnpm logs a peer warning and nothing else.

## Checks run

- `pnpm turbo run lint typecheck test` → `Tasks: 7 successful, 7 total` (green).
- `pnpm --filter @rv-trip/core test` → `Test Files 3 passed (3) · Tests 40 passed (40)`
  (15 of them new in `bounds.test.ts`).
- Mutation check: with `boundsFor`'s padding removed, 3 of the new tests fail
  (`Tests 3 failed | 37 passed`) — the tests do exercise the code.
- `DATABASE_URL=… pnpm --filter @rv-trip/web build` → production build succeeds; `/map` is
  listed `ƒ (Dynamic)`. This is what proves G1: the `ssr: false` dynamic import compiles from
  a client component under a Server Component route on Next 16.2.10.
- **SKIPPED — no live Mapbox token in this environment:** nothing about the GL render path
  was executed. The Nightfall paint rows, the spiderfy's pointer behaviour at several zooms,
  the arc geometry on a real projection and the attribution control are all walk work.
