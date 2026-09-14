# Issue #69 · Locate for ideas — dev notes

The vetted wireframe (`mc/wireframe/issue-69-v0:docs/design/69/index.html`) built in one pass, with
the vet's ten findings resolved in code rather than deferred: the locate enum widens to three kinds,
an idea becomes a third `MapPin`, and every idea row in the stop sheet grows a place line that can
also *set* the place.

**Twelve production files, no migration.** `ideas` already carries `place_name` / `lat` / `lng` /
`google_place_id` (`packages/db/src/schema.ts:120-137`). The design's hero chip says "6 files"; the
vet's HIGH #2 was right that `TripPlanner.tsx` and the `StopLeafActions` interface are edit sites
seven and eight, and core's patch grammar (`ideaPatchInput` / `ideaPatchColumns`) plus the planner
helper make twelve.

> Provenance, so qa is not surprised by the diff's polish: this is the same implementation the
> earlier `mc/dev/issue-69-v0` pass produced. I re-read it against the wireframe, the ten vet
> findings and the real code before adopting it, and re-ran the whole gate here from a clean
> `pnpm install` (below). Nothing was taken on faith.

## The contract

- **`packages/core/src/providers/places-locate.ts:44`** — `locateRowKind` is
  `z.enum(["place","stop","idea"])`. `LocateRow` / `LocateRequest` / `LOCATE_MAX_ROWS` /
  `dedupeLocateRows` / `locatePlaces` are untouched: `rowKey` is already `${kind}:${id}` (:111), so
  dedupe spans three kinds for free. The doc comments at :8, :16 and :36 that asserted the two-kind
  derivation and that `UnmappedRow` "never has to widen" are corrected rather than left lying, and
  `LocateTarget.name` (:66) now names an idea's title as its search text.
- **`packages/core/src/domain/types.ts:307`** — **new** `ideaPatchInput`, derived from the `idea`
  grammar as `.pick({status,rating,notes,place}).partial()`. The route used to hand-roll an inline
  zod object; deriving it keeps types.ts the single source of truth and makes the shape testable in
  core. `.partial()` strips the `.default(null)`s, so an unsent key stays **absent** — asserted, not
  assumed (`leaf-write-contract.test.ts`).
- **`packages/core/src/domain/leaf-form.ts:240`** — **new** `ideaPatchColumns`, the mirror of
  `stopPatchColumns`. **This is the vet's HIGH #1.** `ideas` has no `place` column and
  `updateIdeaFields` spreads its patch into `.set()`, so the route flattens through this; it tests
  `patch.place === undefined`, so an **absent** key leaves all four columns alone and only an
  **explicit `null`** clears them. Without that, every `{status}` / `{rating}` / `{notes}` patch —
  which is every shipped idea write (`TripPlanner.tsx:1039/:1053/:1065`) — would have wiped a
  located idea.
- **`apps/web/src/app/api/ideas/[id]/route.ts:16`** — parses `ideaPatchInput`, calls
  `updateIdeaFields(await getOwner(), id, ideaPatchColumns(parsed.data))`. `ctx.params` still
  awaited; 400 is still `NextResponse.json({ error }, { status: 400 })`.
- **`packages/db/src/mutations.ts:497`** — `updateIdeaFields`' patch type widens by the four place
  *columns* (never by `place`), and returns early on an empty patch: `{}` is a legal "nothing
  changed" on the wire and drizzle throws on `.set({})`.
- **`apps/web/src/lib/trip-api.ts:109`** — `updateIdea`'s patch type is now `IdeaPatchInput`.
- **`packages/core/src/planner/index.ts:677`** — **new** `setIdeaPlace`, the optimistic half, taking
  the same `Place | null` the PATCH body carries.

## The store

- **`packages/db/src/locate.ts:46`** — `ownedStopIds` mirrored locally (the vet's MED #1: it is
  module-private in `mutations.ts:58`, and locate.ts:32-33 documents exactly this idiom for
  `ownedLegIds`). **:79** `loadIdeas` scopes idea → stop → leg → trip → owner and returns coordless
  rows only. **:96** `listLocateTargetsForOwner` learns ideas, so `pnpm backfill:places` does not
  silently skip them. **:176** `writeIdeaPin`. **:196** `dbLocateStore` fans out to three loaders
  and switches three save arms.
- **`writeIdeaPin` writes `coalesce(ideas.place_name, <google name>)`, not an overwrite** — the
  vet's MED on silent renaming. Writing `place_name` is *required* (`mapIdea` keys the whole nested
  `place` off that column, so coordinates alone would be invisible to every reader), but the
  picker's free-text escape row means an idea can already carry a name the human typed, and a batch
  button must not rename their row. Google's name fills the column only when it is empty, which is
  the case the batch exists for. Covered both ways.

## The map

- **`apps/web/src/components/map/pins.ts:105`** — `IdeaPin` joins the union (layer, title, status,
  stopName, tripId, tripTitle; no category — G1). `UnmappedRow.kind: LocateRowKind` (:128) is set at
  all **three** `unmapped.push` sites (:241, :293, :351) and `locateRowOf` (:143) is a passthrough
  of it. `pushIdeas` (:228) walks `stop.ideas` inside the existing stop loop — **and on the
  coordless-stop `continue` path too**, because an idea's coordinates are its own, not borrowed from
  the stop it hangs under. Q4 = A: every status counts into unmapped.
- **`MapView.tsx:450`** — `IdeaRing`: 11px, 2px stroke, no fill, no number, `palette.category.Do`
  (no new palette key, no `map-palette.test` churn). Marker `zIndex` (:272) is now four tiers —
  selected 4, stop 3, place 2, idea 1 — so an idea can never cover its stop. Ideas are not spiderfy
  anchors (`anchor: p.kind === "stop"` unchanged).
- **`MapOverview.tsx`** — G1's filter arm is `p.kind !== "place" || …` (:96), so ideas stay visible
  under their layer and never enter a Do count `categoryCounts(places)` does not describe.
  `SelectedIdea` (:430, kicker `Idea · <status>`, title, `<tripTitle> · <stopName>`,
  `formatCoords`), `RailGlyph`'s idea arm (:466, the canvas ring at the rail's 15px), `railMeta`'s
  (:513), and one new `LegendKey` (:266) whose swatch colour is the **className**
  `border-rv-info-ink` — an inline `var(--color-rv-*)` inside that `.dark` bar would resolve the
  document half.
- **`api/places/locate/route.ts`** — **no code change**, only the stale :15 sentence.

## The sheet

- **`packages/ui/src/DetailCards.tsx:116`** — `IdeaCard` gains `onLocate?: () => void` and a
  `picker?: ReactNode` slot, composed exactly like the existing `actions` slot. `IdeaPlaceLine`
  (:205) resolves **three** states, per the vet's HIGH #3, because the data has three:
  1. no place → `No place yet` + the Locate pill
  2. a name with no coords → the name + `PICKED_COORDLESS_LABEL` (the DS's own shipped copy) + the
     Locate pill — the normal outcome of the picker's escape row, which the design's two-state line
     would have erased
  3. a name with coords → the name + `On the map`, nothing to press

  The line renders **the bare `idea.place.name`** — the wireframe's `Tumalo Falls Trailhead, Bend,
  OR` is a string the schema cannot produce (no region column; `PickedPlace.address` is never
  persisted), the vet's MED. With no `onLocate` the line is read-only; with neither place nor
  handler it renders nothing. `IdeaCard` is used in exactly one place (`StopDetailSheet.tsx:482`),
  so nothing else re-renders from this.
- **`StopDetailSheet.tsx`** — `onLocateIdea(ideaId, picked)` on `StopLeafActions` (:103); the sheet
  owns one-at-a-time open state (`locatingIdeaId`) and mounts `IdeaPlacePicker` (:613) into the
  card's slot (:491-503). **The search bias is `nearOf(stop.place, placeNear)` (:183), not
  `placeNear`** — the vet's MED: `placeNear` is `stopAbove(...)`, right for "where is the next stop"
  and wrong for a thing that happens *here* (the wireframe's own frame shows the bug: a Bend sheet
  reading "Near Crater Lake NP"). The previous stop / home base stays the fallback for a stop with
  no coordinates. The picker draws `nearLabel(near)` — the shipped string, not the wireframe's
  invented one.
- **`TripPlanner.tsx:964`** — `onLocateIdea` is the write path: optimistic `setIdeaPlace(...)` then
  `persist(tripApi.updateIdea(ideaId, { place }), undo, …)`, using `ideaPlace(picked)`
  (`packages/core/src/domain/leaf-form.ts:212`, core's existing `PickedPlace → Place` mapper) so the
  row picker and the Add-idea form write identical rows.

## Tests

| where | what |
| --- | --- |
| `packages/core/src/domain/leaf-write-contract.test.ts` | `ideaPatchInput`: empty patch invents nothing; `place` stays **absent** on a status patch; whole place, coordless place, explicit null; blank name refused |
| `packages/core/src/domain/leaf-form.test.ts` | `ideaPatchColumns`: absent leaves the four columns alone (status/rating/notes/empty); flattens a picked place; writes a coordless name; clears on explicit null; never emits `place` |
| `packages/core/src/providers/places-locate.test.ts` | the third enum member is accepted (the old test asserting `"idea"` is *rejected* is flipped, deliberately); dedupe spans three kinds |
| `packages/core/src/planner/planner.test.ts` | `setIdeaPlace` sets and clears, touches nothing else, does not mutate |
| `apps/web/src/components/map/pins.test.ts` | located idea → `IdeaPin` with stop/trip/status; the pin is named by the idea's **title**; coordless at every status → unmapped (Q4); named-but-coordless → unmapped; `kind` on all three push sites and `locateRowOf` round-tripping all three; `layerCounts` growing (G4); no idea reaches the `saved` layer |
| `apps/web/src/app/api/ideas/[id]/route.test.ts` | PATCH writes the four columns; takes the free-text escape; **three single-field patches in a row leave a located idea's place untouched**; explicit null clears; blank name 400s and writes nothing; a foreign idea is never written; `{}` is a 204, not a SQL error |
| `apps/web/src/app/api/places/locate/route.test.ts` (**new**) | the vet's MED about where the `loadIdeas` owner-scope test can live — `packages/db` has no runner, `apps/web` has both the runner and the database. A foreign idea loads nothing / is never asked about / is never written; an already-pinned idea loads nothing; the pin is written and an empty `place_name` filled; **a human-typed `place_name` survives a batch press**; Google is asked the idea's title; one batch spans three kinds |

## Checks actually run (this worktree, after `pnpm install --frozen-lockfile`)

- `pnpm turbo run lint typecheck test --force` → `Tasks: 9 successful, 9 total` · `Cached: 0 cached, 9 total`
- `@rv-trip/core:test` → `Test Files 42 passed (42) · Tests 876 passed (876)`
- `@rv-trip/web:test` → `Test Files 22 passed (22) · Tests 109 passed (109)` — a real Postgres was
  reachable on 5433, so nothing was skipped by the `describeDb` gate
- `pnpm --filter @rv-trip/mobile typecheck` → `tsc --noEmit`, exit 0 (run separately to confirm the
  core type widening does not reach the phone)

## Flagged for the walk (render-required — static analysis cannot certify these)

- The 11px hollow `IdeaRing` at real zoom: whether a maybe reads quieter than a commitment, and
  whether it survives the declutter / `spiderfy` placement beside a stop on the same coordinate.
- **The auto-fit moves, not only the chip counts** (the vet's MED on G4): `boundsFor` is computed
  over the pin set (`MapView.tsx:104-113`) and refits on `boundsKey`, so idea pins change /map's
  initial camera. Expected — worth a look at whether a far-flung idea over-zooms out.
- `PlacePicker` mounted inline inside the scrolling stop sheet: debounced live search against a
  provider key, the escape row, and the sheet's scroll position when the list opens under a row.
- The Planning-now chip going 4 → 9 on the seeded trip (G4, accepted in the design).

## Claims for qa to check

1. `ideaPatchColumns`' `undefined` test is the only thing standing between a status cycle and data
   loss. The api test exercises it through the real handler and the real database, not just the pure
   function.
2. `writeIdeaPin`'s `coalesce` is a deliberate departure from the design's `placeName: found.name`,
   taken to resolve the vet's MED on silent renaming. It is the one behavioural choice here the
   wireframe does not state; the alternative (overwrite) is a one-word change.
3. An idea's Locate **search text is its `title`**, exactly as the design pins it, even when the row
   carries a free-text `place_name`. `coalesce(place_name, title)` would geocode more rows, but the
   design's callout is explicit, so that is left for a follow-up rather than taken here.
4. The row picker can only *set* a place, never clear one — `IdeaPlacePicker` calls `onPick` only on
   a truthy pick, and a located row shows "On the map" with nothing to press (state 3, per the
   design). The `null` clear path exists on the contract end-to-end (`ideaPatchColumns`,
   `setIdeaPlace`, the PATCH) and is covered, but has no UI entrance yet. That is faithful to the
   wireframe; naming it here so it is a decision rather than an omission.
