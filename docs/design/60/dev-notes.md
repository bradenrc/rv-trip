# Issue #60 · Mount the place picker in the planner — dev notes

The signed wireframe (`mc/wireframe/issue-60-v0:docs/design/60/index.html`) built in one
pass (Q6 → A). Every mount composes the shipped `PlacePicker` unchanged; nothing here
restyles a DS component, and no new `rv-*` token was invented.

## 1 · Contract — one key on the wire, flat columns underneath

- `packages/core/src/domain/types.ts:237` — `stopPatchInput` gains `place` (the whole
  `place` schema). Coordinates were unreachable before, which is exactly why a
  `"New stop"` row could never be repaired by a patch.
- `packages/core/src/domain/types.ts:120` — `trip.homeBasePlace: place.nullable()`.
  `homeBase` stays the NAME column, so `tripSummary`, `TripCard` and the phone are
  untouched.
- **Vet HIGH #1 addressed** — `.pick()` is a closed list, so the anchor is named
  explicitly in both write contracts: `types.ts:149` (`tripCreateInput`) and `:161`
  (`tripPatchInput`). Pinned by `trip-write-contract.test.ts` ("carries the home-base
  ANCHOR, not just the name").

Mappers, all in `packages/core/src/domain/place-form.ts` where core's vitest reaches them:

| fn | line | what it decides |
| --- | --- | --- |
| `placeOf` | `:263` | picked → the four persisted fields (drops Google's address/rating) |
| `stopPlaceCreate` | `:277` | `POST /api/stops` — the pick IS the create |
| `stopPlacePatch` | `:291` | `PATCH /api/stops/:id` — one key, never three |
| `stopPatchColumns` | `:314` | the handler's flattening; **`place` outranks `placeName`** |
| `homeBasePatch` | `:336` | name + anchor travel together; clearing clears both |
| `homeBaseColumns` | `:351` | → `home_base_lat/_lng/_place_id` |
| `homeBasePlaceOf` | `:361` | the three columns read back as one object, or null |

- `packages/core/src/domain/leaf-form.ts:192` — `ideaDraftInput(stopId, title, picked?)`,
  plus `ideaPlace` at `:212`. Still `place: null` when nothing was picked; Save is
  disabled on an empty **title** only.
- `packages/core/src/providers/place-picker.ts:222` `pickedFromPlace`, `:253` `nearOf`,
  `:267` `nearLabel` (`near · Newport, OR · 44.6083, −124.0640` — the one new
  user-facing string, in the picker's own U+2212 typography).

**Vet MED (which key wins)** is pinned rather than left to key order:
`place-mount.test.ts` → "the whole place OUTRANKS placeName when a body carries both".

## 2 · The three flattening sites the design never named

**Vet HIGH #3** — `updateStopFields` spreads its patch into `db.update(stops).set()` and
there is no `place` column, so the handler flattens first:

- `apps/web/src/app/api/stops/[id]/route.ts:60` — `updateStopFields(owner, id, stopPatchColumns(patch))`
- `apps/web/src/app/api/trips/route.ts:28` — create: `...homeBaseColumns(homeBasePlace ?? null)`
- `apps/web/src/app/api/trips/[id]/route.ts:74` — patch: an ABSENT `homeBasePlace` stays
  absent, so a patch that never mentions home base leaves the anchor alone.

**Vet HIGH #2** — the round-trip's other three sites:

- `packages/db/src/mutations.ts:77,93` `createTrip`; `:109` `updateTripFields`;
  `:310` `updateStopFields` learns `lat` / `lng` / `googlePlaceId`.
- `packages/db/src/queries.ts:72` — `mapTripRow` maps `homeBasePlace: homeBasePlaceOf(row)`.
  Without this half `trip.homeBasePlace` is silently always null and the first stop of a
  leg gets no bias at all.
- `packages/db/src/schema.ts:68` + `packages/db/drizzle/0004_home_base_place.sql`
  (generated with `pnpm db:generate`; three nullable columns, no backfill — byte-identical
  to the design's migration panel).

## 3 · Add stop = pick a place (Q1 → A)

- `apps/web/src/components/trip/TripPlanner.tsx:426` `openDraftStop` — "Add stop" no
  longer creates anything: it opens a **draft row**. `:434` `createStopFromPick` posts on
  the pick and calls `upgradeRoutes(next)` so the connector resolves without a reload.
  `NEW_STOP_NAME` and the old coordless POST are deleted.
- `apps/web/src/components/trip/RouteView.tsx:466` — the draft row (dashed
  `border-rv-border-hi`), grip + bias line + picker.
- `RouteView.tsx:233` — `near = nearOf(leg.rows[i-1]?.stop.place, homeBasePlace)`: the row
  above in the rendered order, else the trip's home base. `TripPlanner.tsx:870` passes
  `homeBasePlace={trip.homeBasePlace}`.

## 4 · Change place… ×2 + Set place (Q2 → C, Q3 → A)

- **Mount A** `RouteView.tsx:347` — one `DropdownMenuItem` under Rename, `MenuHint`
  `inline`. **The wireframe's `NEW` pill is NOT shipped** (vet MED: it is an annotation
  inside the frame with no DS counterpart).
- **Mount B** — `apps/web/src/components/map/StopMiniMap.tsx:36` grows an optional
  `onChangePlace`; when given it renders a footer (coordinate line via `pickedCoordLabel`
  + "◉ Change place") under the `MapMount`. **Vet MED addressed**: the footer did not
  exist, so it is built here rather than assumed. Mounted at
  `StopDetailSheet.tsx:229`, with the editor beneath it at `:231` — in the sheet BODY, not
  the sticky navy header.
- **Mount C** `RouteView.tsx:414` — the amber coordless chip's "Set place". The sentence is
  `PICKED_COORDLESS_LABEL` verbatim, so the row and the picker never disagree.
- All three open one editor: `RouteView.tsx:537` `PlaceEditor` (and its sheet twin
  `StopDetailSheet.tsx:569` `SheetPlacePicker`). Write path:
  `TripPlanner.tsx:454` `doChangeStopPlace` → optimistic `setStopPlace` →
  `PATCH` → `upgradeRoutes`.

## 5 · The rail's count + Locate (Q3 → A)

- `packages/core/src/planner/index.ts:514` `RouteSummary.unmapped: number` and `:522`
  `unmappedStops: {id,name}[]`. **Vet MED addressed**: the count alone cannot feed Locate —
  `tripApi.locatePlaces` needs the ids and `locateToastMessage` needs the NAMES, and the
  planner has no `/map` model to borrow them from. Both come from `:548`.
- `RouteView.tsx:854` — the amber row + Locate button, rendered only when `> 0` (the
  rail's own `restrictionCount` rule). `:752` `locateBatchSize` slices to `LOCATE_MAX_ROWS`.
- `TripPlanner.tsx:480` `locateUnmapped` — `kind: "stop"` rows, `locateToastMessage`, then
  `router.refresh()` (not a local echo: `LocateResponse` has no `googlePlaceId`).

## 6 · Home base + ideas (Q4 → B, Q5 → A)

- `apps/web/src/app/trips/new/page.tsx:97` and `TripPlanner.tsx:1235` (settings dialog) —
  both `Input`s swapped for `PlacePicker`. The "the place picker arrives with #23" helper
  line is deleted.
- `TripDraft` / `TripSettingsDraft` now hold `homeBasePlace: PickedPlace | null` instead of
  `homeBase: string` (`packages/core/src/domain/trip-form.ts`). A pre-#60 trip opens the
  picker on the name it has, and `tripSettingsPatch` compares against the value the dialog
  OPENED on so a render is never mistaken for a change.
- `StopDetailSheet.tsx:437` — the Add-idea form's optional Place field. Locate does **not**
  learn a third kind.

## Decisions / defaults I had to make

1. **Dismissal affordance (vet MED).** The design leans on "dismissing the picker removes
   the draft row" but drew no control, and `PlacePicker`'s own ✕ only clears the chosen
   place (state 6 → 1). I added one bordered ✕ beside the picker in both editors —
   `Discard this stop` on a draft row, `Stop changing the place for …` on an existing one.
   This is the only affordance in the diff the wireframe does not draw. **qa: check the
   copy and the placement.**
2. **`place` beats `placeName`** when a body carries both (test-pinned). The rename is the
   cheap path; it must not outrank the key that carries coordinates.
3. **A coordless re-pick CLEARS the old coordinates** (`setStopPlace` replaces rather than
   merges, and `stopPatchColumns` sends explicit nulls). The alternative — keeping a pin at
   the old spot under a new name — is a fabricated location.
4. **Drag and the overlay are turned OFF while the editor is open**
   (`RouteView.tsx:233-260`, and the stretched click-overlay is not rendered at all when
   `placing`). The vet FLAGged text selection / drag capture / focus inside that stack as
   render-only facts; rather than argue the `pointer-events-auto` wrapper, the row simply
   stops being draggable and stops being a link while it is an editor.
5. **`unmapped: number` AND `unmappedStops`** — the design named only the count; the rows
   are additive and are what Locate actually needs.
6. **Q5 discrepancy, flagged not guessed.** The survey answer relayed in the brief is
   `q5: B` (widen Locate to an `"idea"` kind), but the **signed wireframe's** resolved
   answers table and its Surface 5 both say **Q5 → A** ("Locate does not learn a third
   kind"). I built the signed wireframe. If B was meant, `locateRowKind`, `dbLocateStore`,
   `writeIdeaPin` and the map's unmapped model are a follow-up slice — none of it is
   started here.

## For the walk (render-only, per the vet's two FLAGs)

- The inline picker inside a stop row: text selection, focus and (with drag disabled)
  ordering. Also that the row still opens the sheet normally when the editor is closed.
- The picker's `absolute z-10` list against the sheet's single `overflow-y-auto` column and
  the `MapMount` WebGL canvas directly above Mount B — clipping and stacking must be seen.
- The dark halves: the picker on `/trips/new` and inside the settings dialog's `.dark`
  navy surface (it is unstyled by both forms and relies on the `rv-*` names re-resolving).

## Checks run

```
pnpm turbo run lint typecheck test        → Tasks: 9 successful, 9 total
  @rv-trip/core:test   Tests  860 passed (860)
  @rv-trip/web:test    Tests   87 passed (87)   (real Postgres; migrations incl. 0004)
  @rv-trip/web:lint    0 problems
  typecheck: core, db, ui, web, mobile — clean
pnpm --filter @rv-trip/db exec drizzle-kit generate --name=home_base_place
                                          → drizzle/0004_home_base_place.sql
```
