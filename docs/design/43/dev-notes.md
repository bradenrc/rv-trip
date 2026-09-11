# dev notes · issue 43 · i1 — persist the route cache behind one routing key

Implements **plan item i1 only** (`docs/design/43/plan.json`, issue #29). i2/i3/i4 are
separate dispatches; nothing here touches the map, the dashboard card or the Navigate
control.

## What changed

### The key — one name, one derivation
- `packages/core/src/domain/rig.ts:146` `NO_ROUTING_HASH = "no-rig"` — deliberately the
  SAME string as `NO_RIG_HASH`, so the rename changes no stored key and no echoed hash.
- `packages/core/src/domain/rig.ts:150` `sha256Hex()` extracted; `rigHash()` (`:164`) now
  calls it. Its body is otherwise unchanged and its seven-field sweep
  (`rig.test.ts:145-186`) is **unedited** and still green.
- `packages/core/src/domain/rig.ts:205` `routingHash()` — sha256 over the SIX routing
  fields (`type`, height, width, length, grossWeightKg, propaneOnBoard). `rig.name` is
  gone, per Q1 = B. `type` is kept even though `buildRoutesUrl`
  (`providers/here.ts:181-197`) sends a constant `transportMode: "truck"` today — the
  design's own correction to the mock, and the alternative is a silent wrong-profile hit.
- `packages/core/src/domain/route-order.ts:90` `routeCacheKey`'s third parameter renamed
  `rigHash` → `routingHash` (it is the same rename; the function that BUILDS the key).

### Migration 0001 · the `routes` table
- `packages/db/src/schema.ts:55` `routeSource = pgEnum("route_source", ["here"])`.
- `packages/db/src/schema.ts:229` the `routes` table (`key` PK, `result` jsonb typed
  `$type<RouteResult>()`, `source`, `fetched_at` default `now()`) + `routes_fetched_at_idx`.
  No `owner_id`, on purpose.
- `packages/db/drizzle/0001_route_cache.sql` (+ `meta/0001_snapshot.json`,
  `meta/_journal.json`). Generated with `pnpm db:generate`, then renamed from drizzle-kit's
  random tag to match `0000_baseline`'s convention (the journal is tag-driven —
  `baseline.ts:51` reads `${tag}.sql`). **Never pushed to the operator's `rvtrip` DB.**
- `packages/db/src/queries.ts:428` `ROUTE_CACHE_TTL_DAYS = 30` and `getCachedRoutes(keys)`
  — one batched `inArray` read filtered on `fetched_at > now() - '30 days'::interval`.
- `packages/db/src/mutations.ts:627` `putCachedRoutes(rows)` + the `CachedRoute` type.
  **Filed in `mutations.ts`, not `queries.ts`** — the vet's MED finding: every other write
  in that package lives there. Upserts on the key; `fetched_at` comes from the DATABASE
  clock on both paths (column default on insert, `now()` in the conflict `set`), because
  the TTL is read back as a SQL comparison against `now()`.
- `packages/db/src/testing/truncate.ts:23` `routes` added to the between-test truncate.
- `packages/db/src/testing/fixtures.ts` — `fx.ageCachedRoute(key, days)` (`:337`, defined `:326`),
  `read.routeRow` / `read.countRoutes` (`:392`), `RouteRow`.

### The read path
- `apps/web/src/lib/routing.ts:69` `routePairs` is now memory → table → provider:
  `:76-88` the in-process Map; `:90-102` one batched `getCachedRoutes`, every hit
  `remember()`-ed so the Map is warm; `:104-117` the vendor, then the write-through
  **gated on `result.source === "here"`** (`:117`). `:153` `routeTrip` returns
  `{ routes, routingHash }`.

### The rename across the seam
`apps/web/src/app/api/routes/route.ts:39-43` (handler + echoed field),
`apps/web/src/lib/trip-api.ts:130-136` (its caller),
`apps/web/src/app/trips/[id]/page.tsx:21-25`,
`apps/web/src/components/trip/TripPlanner.tsx:146,152,220-224,661,672`,
`packages/core/src/planner/index.ts:274,298,316,388` (`routeModel`/`routeSummary`
parameter, default now `NO_ROUTING_HASH`).

## Decisions worth checking

1. **`POST /api/routes` renames its wire field to `routingHash`; `GET /api/trips/:id` does
   NOT.** The design's chain is "page.tsx → TripPlanner → routeModel/routeSummary →
   trip-api → the handler", and that is the whole set of callers of `/api/routes`. The trip
   BUNDLE is different: `apps/mobile` parses it through `tripBundleSchema`
   (`packages/core/src/api-client/schemas.ts:36`) and ships on its own Expo cadence, so
   renaming that field would break every installed build — the same hazard the vet raised
   against i3's `milesEstimated`. `apps/web/src/app/api/trips/[id]/route.ts:20-24` therefore
   keeps `rigHash` as the wire name while carrying the routing hash, with a comment saying
   so. `packages/core/src/api-client/{schemas.ts:47,index.ts:101}` were updated because they
   are the OTHER HALF of the `/api/routes` field — leaving them stale would make
   `api.routes.pairs()` throw on parse. `apps/mobile` is untouched.
2. **The cache can never break a render.** `readCache`/`writeCache`
   (`apps/web/src/lib/routing.ts:124-141`) swallow a db failure with a warning and fall
   through to the provider. Without this, a tree whose `0001` has not been applied 500s the
   trip page instead of paying for a route. The design does not name this; flagging it.
3. **One log line per resolve**, `route.cache hit=N miss=N layer=memory|db|provider`
   (`routing.ts:143`) — the design's read-path table, as an actual line. Wording is the
   design's; the layer is the one that paid.
4. **`putCachedRoutes` filters on `source === "here"` as well as the caller.**
   `routes.source` is a one-value enum, so the belt-and-braces keeps the stored literal
   honest rather than trusting the call site.

## Tests

- `packages/core/src/domain/rig.test.ts:193-254` — `routingHash`: stable; **unchanged when
  only `name` changes** (and equal to the six-field-only object); a six-case
  `it.each` sweep, exhaustive by construction (`edits` keyed over the six); the `"no-rig"`
  sentinel; and `routingHash(rig) !== rigHash(rig)`.
- `apps/web/src/lib/routing.test.ts` (new, 6 cases, **no database**) — a fake
  `HereRoutingProvider` and a faked `getCachedRoutes`/`putCachedRoutes` (via
  `importOriginal` spread, so `truncateAll`'s `db` handle survives for the rest of the
  suite): a cold pair is billed once and written through; an `estimate` is served but
  **not** written; a second open is served from the Map with no db read and no vendor call;
  a **db hit makes zero provider calls and warms the Map**; mixed layers in one call; and a
  failing table still renders. Each case re-imports `./routing` through `vi.resetModules()`
  because the Map is module scope.
- `apps/web/src/lib/route-cache.test.ts` (new, 5 cases, **real Postgres** via the suite's
  throwaway database) — the layer routing.test.ts fakes: verbatim jsonb round-trip of a
  `RouteResult`, an `estimate` stores nothing, only asked-for keys answer, a row aged 31
  days reads as a miss and re-upserts to one fresh row, a row aged 29 days survives. It
  lives in apps/web because that is the only harness with a database (packages/db has no
  `test` script) — and it therefore also proves `0001_route_cache.sql` applies.

## Checks run

- `npx turbo run lint typecheck test` → `Tasks: 9 successful, 9 total`
  (core 503 tests / 27 files; web 39 tests / 18 files — a real Postgres was reachable, so
  no file skipped).
- `pnpm db:generate` (as `npx drizzle-kit generate` with a dummy `DATABASE_URL`) a second
  time → `No schema changes, nothing to migrate` — i.e. no drift for CI's check.
- NOT run: `pnpm db:migrate` / `db:push` against the operator's `rvtrip` database (barred).
  0001 was exercised only through the test harness's own throwaway database.

## For the walk

Nothing visual changed. The behaviour to see is in the server log on a trip open:
`route.cache hit=… layer=db` on a second open after a restart, where it used to say
`layer=provider`. `pnpm db:migrate` must be applied to the local database first (otherwise
the cache warns and degrades to the provider — the page still renders).

---

# dev notes · issue 43 · i2 — draw the HERE corridor as one source painted by property

Implements **plan item i2 only** (`docs/design/43/plan.json` §2, issue #35). i3/i4 are
separate dispatches; nothing here touches the dashboard card, the Navigate control, the
`navigation.ts` handoff or `packages/db`.

## What changed

### The geometry (core, pure, tested)
- `packages/core/src/providers/polyline.ts:102` `routeToGeoJSON(result, from, to)` →
  `RouteLineString` (`:83`), decoding to `[lng, lat]` positions. Three decisions:
  - **`from`/`to` are parameters.** The design's signature is `routeToGeoJSON(r: RouteResult)`
    with "polyline === null falls back to the two endpoints" — but a `RouteResult`
    (`providers/index.ts:38-52`) carries no endpoints, so the fallback the acceptance asks
    for is unreachable from `r` alone. The pair's two points are passed in; every caller
    already holds them (`pins.ts` has the `OrderedPair`).
  - **The return type is declared locally**, `RouteLineString`, not `GeoJSON.LineString` —
    the vet's MED: `@types/geojson` is in no lockfile entry and
    `packages/core/tsconfig.json` pins `types` to `["node", "vitest/globals"]`, so that
    namespace does not exist in this package. The shape is the object `MapView.tsx:137-153`
    built inline.
  - **An unreadable polyline also falls back.** `decodeFlexiblePolyline` degrades garbage
    to `[]` (`:71-75`), and `< 2` vertices is not a line, so both that and `polyline: null`
    take the endpoints. An estimate needs no branch at all: the stub encodes its own two
    points (`providers/index.ts:94`) and decodes back to the same chord.
- `packages/core/src/providers/polyline.ts:4-11` — the header's "`decode` has NO consumer
  today" is now false and says so.
- It rides the existing `export * from "./polyline"` on `providers/index.ts:139`, so it is
  reachable as `@rv-trip/core` (what `pins.ts` imports) and as `@rv-trip/core/providers`
  (what the mobile map, #32, will). **Nothing keyed or network-touching was added to that
  barrel** — the vendor-client quarantine the vet raised against i4 is untouched here.

### The casing role
- `apps/web/src/components/map/palette.ts:87` `corridorCasing: string` on `OverlayPalette`
  (never null, unlike `arcCasing`), `:122` NIGHT `"rgba(2, 6, 23, 0.8)" // rv-navy at 80%`,
  `:164` DAY `"rgba(255, 255, 255, 0.9)"`, and SAT inherits it through `...NIGHT` (`:185`,
  comment at `:181`). Both values already existed in the file; no new colour, no new `rv-*`
  token, so `apps/web/src/app/globals.css` and `packages/ui/styles/entry.css` did NOT need
  mirroring.
- `packages/core/src/theme/map-palette.test.ts:122` `corridorCasing` added to `DAY_COLORS`
  (`:175`'s `toEqual` is strict over every quoted day value) and `:202` one new assertion
  naming the three corridor casings — night, day, and sat-by-inheritance (it asserts sat
  does NOT restate it). `arcCasing: null` for night/day (`:218`), the sat
  halo+arcCasing-only override (`:179`) and `tokenComments(block("NIGHT"))` (`:164`) are all
  unedited and still green: the new comment is `// rv-navy at 80%`, not `// --color-rv-…`,
  so the token-provenance regex cannot see it.

### The model
- `apps/web/src/components/map/pins.ts:119-141` `DriveArc` gains `source: RouteSource` and
  `path: [number, number][]` (its decoded geometry), and its doc comment stops calling
  itself "the dashed estimate".
- `apps/web/src/components/map/pins.ts:193-198` `buildMapModel(trips, places, routes = {},
  routingHash = NO_ROUTING_HASH)`. The two new parameters are **defaulted**, so the Places
  map lens (`PlacesLibrary.tsx:82`, `buildMapModel([], list)`) is untouched.
- `apps/web/src/components/map/pins.ts:239-262` the arc loop now walks `orderedPairs(trip)`
  instead of `scheduledSequence`, resolves `routes[routeCacheKey(from, to, routingHash)] ??
  estimateRoute(from, to)` — the same expression `toDrive` uses
  (`packages/core/src/planner/index.ts:274-277`) — and carries `source` + `path` out.
  `hasCoords` guards are gone from that loop because `orderedPairs` already drops any pair
  touching a coordless stop. `if (layer === "been") continue;` is unchanged, so a
  `status: "complete"` trip still contributes no arc.
- **The label copy changed**, which the vet flagged as rendered-but-unscoped (MED): the
  frame draws `136 mi · US-101`, so a routed arc joins the miles and
  `result.primaryRoad` with " · " (dropping a null road), and an un-routed one keeps the
  shipped `~N mi · est.` verbatim. A routed drive the vendor named no road for is
  `136 mi` — no tilde, because it is not a guess. Asserted three ways in the new test.
- **`orderedPairs` is per-leg, not `[...scheduled, ...floating]` trip-wide** (the vet's MED
  on the design's `route-order.ts:40-46` citation — that line is `orderedLegStops`). The new
  test's fixture is built on the real semantics: the floating Crater Lake sits at the end of
  ITS leg, so the seed-shaped trip yields three pairs (`astoria->newport`,
  `newport->bend`, `bend->crater`), not the two the old scheduled-only sequence drew.

### The paint
- `apps/web/src/components/map/MapView.tsx:44-54` `ROUTED` (`:50`) — the one
  `["==", ["get","source"], "here"]` expression the whole grammar cases on — and
  `CORRIDOR_WIDTH = 2.6`.
- `:163-180` the one `rv-drive-arcs` Source: one Feature per pair, `properties: { id,
  source }`, `geometry.coordinates: a.path`.
- `:191-234` three layers (`:199`, `:211`, `:225`), per the design's spec with the vet's HIGH correction applied:
  - `rv-drive-arcs-casing` — `corridorCasing` at `ARC_CASING_WIDTH`, opacity
    `["case", ROUTED, 1, palette.arcCasing ? 1 : 0]`. The design's `…, 1, 0]` would have
    silently removed the casing the SAT estimate dash has today (`palette.arcCasing`,
    `palette.ts:179`, is the only casing shipped and every arc shipped so far is an
    estimate). Because SAT's inherited `corridorCasing` is the SAME literal as its
    `arcCasing`, deferring to `palette.arcCasing` for estimates keeps sat pixel-identical
    and still gives night/day estimates no casing, which is what the design wanted.
  - `rv-drive-arcs-line` — `arcLine`, width `["case", ROUTED, 2.6, palette.arcWidth]`,
    opacity **`["case", ROUTED, 1, 0]`**. The design's `…, 1, palette.arcOpacity]` was the
    vet's other HIGH: it drew a full-length SOLID line under every estimate's dash, filling
    the gaps, so an estimate would have read solid. Zero for estimates (the alternative the
    vet named) rather than a `filter`, so the data-driven expression the walk is asked to
    certify is still on the layer.
  - `rv-drive-arcs-dash` — `filter: ["==", ["get","source"], "estimate"]`, and
    `arcWidth`/`arcOpacity`/`[2.2, 1.8]` copied byte for byte from the shipped layer.
- `:239-255` the label Marker sits at `labelAt(a)` (`:297-310`): a routed drive's corridor
  MIDDLE VERTEX, an estimate's chord midpoint (unchanged — a 2-point path has no third
  vertex to prefer).
- `:100-112` `bounds` is now `boundsFor([...pins, ...every corridor vertex])`, so
  `boundsKey` and both `fitBounds` calls fold the corridor in. An estimate contributes
  exactly its two endpoints, so a map with no routed drive on it does not move.

### The server seam
- `apps/web/src/app/map/page.tsx:10-26` — `getRigByOwner` joins the existing
  `Promise.all`, then `Promise.all(routeTrip)` over every trip whose `status !== "complete"`
  (a been trip draws no arc, so it is not routed and nothing is billed for a drive nobody
  sees). The per-trip `RouteMap`s merge with `Object.assign` — safe because every pair is
  keyed on the same `routingHash` — and `routed[0]?.routingHash ?? NO_ROUTING_HASH` is the
  hash handed down. Identical seam to `trips/[id]/page.tsx:20-21`.
- `apps/web/src/components/map/MapOverview.tsx:53-70` takes `routes` + `routingHash` as
  required props and passes both into `buildMapModel` inside the existing `useMemo`.

## Decisions worth checking

1. **`routeToGeoJSON` takes the endpoints** (above). Without them the acceptance's own
   null-polyline case cannot be written; qa should confirm the signature change is the right
   resolution rather than a deviation.
2. **The casing's estimate branch is `palette.arcCasing ? 1 : 0`, not `0`** (above) — one
   character of extra logic to avoid a sat-only regression on the path this epic is not
   fixing.
3. **The solid line is zero-opacity for estimates, not filtered** — same pixels either way;
   this keeps the data-driven `["case", …]` on `line-width` AND `line-opacity` that the
   design's layer table names and the walk FLAG expects to see.
4. **`line-dasharray` may actually be data-driven in mapbox-gl 3.30** — its type in
   `mapbox-gl.d.ts:4359` is `DataDrivenPropertyValueSpecification<Array<number>>`, which
   contradicts the design's justification for a third layer. The separate filtered dash
   layer was kept anyway: it is the vet-approved shape, and it is the one that cannot
   regress the shipped estimate. Flagging the claim, not the resolution.
5. **/map now pays for routing on load.** This is Q4 = A, and i1's `routes` table is what
   makes it a bounded one-time cost per `(pair, routingHash)`. Note for i4: the billable
   Google/nav check must NOT ride this seam (the vet's HIGH) — nothing in i2 resolves a
   NavMap, and `routePairs` is unchanged.

## Not done, deliberately

- **The /map legend still says only "Estimated drive — straight-line, not a road route"**
  (`MapOverview.tsx:252-254`). The wireframe's `corridor · routed` / `chord · est.` chips
  are its own `.maplegend` annotation row (it also labels the two fitBounds rectangles), not
  app copy, and i2's scope names `MapOverview.tsx` for props only. So a routed corridor
  currently draws with no legend key of its own. **Operator/design decision**, not a dev
  guess — it needs one line of real copy from the design.

## Tests

- `packages/core/src/providers/polyline.test.ts:66-132` — `routeToGeoJSON`, 4 cases: HERE's
  published test vector decodes to 4 `[lng, lat]` positions in traversal order (asserted
  `> 2` as the acceptance words it, and on the exact first/last vertex); a real
  `StubRoutingProvider` estimate yields exactly 2, equal to its endpoints; `polyline: null`
  falls back to the two endpoints; an unreadable polyline does too.
- `packages/core/src/theme/map-palette.test.ts:202-216` — the three corridor casings, and
  that sat inherits rather than restates. `DAY_COLORS` gained the one line `:175`'s strict
  `toEqual` requires.
- `apps/web/src/components/map/pins.test.ts` (new, 9 cases, pure TS / node env, no
  database) — one arc per `orderedPairs` pair with the ids in order (three, the floating
  drive included); each arc's `source`; a routed arc's decoded 4-vertex path vs an
  estimate's exact 2-point chord; the routed label `136 mi · US-101`, the estimate's
  `~N mi · est.`, and `136 mi` with no road named; a `routingHash` mismatch is a clean miss
  (every arc falls to `estimate`); a `complete` trip contributes **no arcs while keeping all
  four pins**; a coordless stop kills the pairs on both sides of it rather than inventing
  one; and a stub-shaped `estimate` result decodes to its chord rather than being
  special-cased.
- **Not covered by a test:** the Mapbox paint itself. `apps/web`'s vitest is
  `environment: "node"` with `include: ["src/**/*.test.ts"]` and no jsdom / testing-library
  in the workspace (the vet's HIGH against i4's render test applies here too), so the three
  layers, the `["case", …]` expressions, the corridor-midpoint Marker and the widened
  `fitBounds` are **render-required at the walk**. Claimed for qa: every value in those
  layers is either a `palette` role or a literal the design's layer table names.

## Checks run

- `npx turbo run lint typecheck test` → `Tasks: 9 successful, 9 total`.
- `pnpm --filter @rv-trip/core test` → `Test Files 27 passed / Tests 508 passed` (was 503;
  +4 polyline, +1 palette).
- `apps/web` suite inside the turbo run → `Test Files 19 passed (19) / Tests 48 passed (48)`
  (was 18/39; +1 file, +9 pins cases). A real Postgres was reachable, so no db file skipped.
- NOT run: `pnpm db:push` / `db:migrate` (barred, and i2 touches no schema); no HERE or
  Google credentials exist in this worktree, so every corridor asserted here is the
  published HERE test vector or the stub's own encoding — no live vendor call was made.

## For the walk

`/map`, with the local stub (no HERE key): every drive still draws **dashed**, but there are
now MORE of them — the drives to floating stops appear, and the camera fits a little wider.
With a HERE key configured, the routed drives should draw solid at 2.6px with a casing, the
dash surviving only where routing failed, and each routed label should sit ON the corridor
rather than on the chord. The three-mode toggle is the thing to eyeball: night/day estimates
must show **no** casing, and sat's estimate dash must look exactly as it does today.

---

# dev notes · issue 43 · i3 — make the dashboard card call the rail's own miles function

Implements **plan item i3 only** (`docs/design/43/plan.json` §3, issue #37). i4 is a
separate dispatch; nothing here touches `navigation.ts`, `frechet.ts`, the Navigate control
or the map.

## What changed

### The wire contract grows one field
- `packages/core/src/domain/types.ts:389` `milesEstimated: z.boolean()` on `tripSummary`,
  right after `miles`, with the doc comment naming the rule (neutral chip, never amber).
  **Required, not defaulted** — the acceptance's own words ("rejects one without it"), and
  see the ship-order note below.
- `packages/core/src/api-client/api-client.test.ts:33` — the existing fake row gained the
  field, because `tripSummaryListSchema` validates it on the way in.

### One number, one expression
- `packages/db/src/queries.ts:104-120` `listTripsForOwner` — the trips query and
  `getRigByOwner` in one `Promise.all`, then **one** `routingHash(rig)` for the whole
  listing, `orderedPairs` over every mapped trip flattened into **one** batched
  `getCachedRoutes`, and `summarize(trip, routes, hash)` per row. It reads the cache and
  **never the provider**, so landing on the dashboard cannot bill anything.
- `packages/db/src/queries.ts:138-175` `summarize(trip, routes, hash)` —
  `miles: routeSummary(trip, routes, hash).driveMiles` (`:171`), and
  `milesEstimated = orderedPairs(trip).some((p) => !routes[routeCacheKey(p.from, p.to, hash)])`
  (`:154-156`). The parameter is named `hash`, not `routingHash`, so it cannot shadow the
  imported function.
- `packages/db/src/queries.ts` — `haversineMiles` and `deg` are **deleted** (they were at
  `:256-268` before this change), and `isScheduled` dropped from the import list with them.
  `grep -rn "haversineMiles" packages/db/src` and `grep -rn '\bdeg\b' packages/db/src` both
  return nothing.

### The chip, lifted
- `packages/ui/src/EstimateChip.tsx:13` — markup and token classes **byte-identical** to the
  old private helper (`rounded-rv-pill border border-rv-border-hi px-2 py-px font-mono
  text-[9px] uppercase tracking-[0.08em] text-rv-ink-faded`, copy `estimate`), which is also
  exactly the wireframe's `.chip-est` rule (`index.html:197-202`). The doc comment keeps the
  RouteNotice contrast the design cites as the precedent.
- `packages/ui/src/index.ts:7` exports it beside `RouteNotice`.
- `apps/web/src/components/trip/RouteView.tsx:25` imports it from `@rv-trip/ui`; the local
  `function EstimateChip()` is gone. Its two call sites (`:393`, `:408`) are otherwise
  untouched.
- `apps/web/src/components/dashboard/TripCard.tsx:19,131-136` — the miles `Chip` now renders
  `{trip.miles} mi` plus `{trip.milesEstimated && <EstimateChip />}`. `Chip`'s own
  `gap-[5px]` is the spacing; no new Tailwind, no restyle of the pill.

## Decisions worth checking

1. **`milesEstimated` is REQUIRED, so the ship order is pinned — API before mobile.** The
   vet's MED: `apps/mobile` parses the identical `tripSummaryListSchema`
   (`apps/mobile/src/store.ts:13`) and ships on its own Expo cadence, so a mobile build that
   lands *before* this API deploy would reject every dashboard row. Defaulting the field was
   the alternative, and it is what the acceptance explicitly forbids ("rejects one without
   it") — a row from a server that cannot tell you whether the number is a road distance
   must not be rendered as measured. Web and the API deploy together in one Vercel build, so
   the only rule the operator has to hold is: **do not cut a mobile build from this core
   until this is merged and deployed.** `apps/mobile` itself is untouched here.
2. **`apps/mobile/app/index.tsx:109` renders `trip.miles` and gains no chip.** Mobile has its
   own react-native `EstimateChip` (`apps/mobile/src/ui.tsx:29`) but the dashboard `Stat`
   there has no slot for it, and i3's scope names only the two web files. So the number moves
   on mobile (249 → 427 on the seed trip) with nothing beside it saying "estimate". Flagged,
   not fixed — it is a one-line follow-up on the mobile surface, not this item's scope.
3. **`summarize` still calls `deriveDays` itself** for `days`/`open`, even though
   `routeSummary` returns `days`/`openCount` too. The design's pseudocode replaces only the
   miles arithmetic, so `days` and `open` are byte-for-byte the shipped derivation; folding
   them into `summary` as well would have been an unscoped behaviour change on two more
   fields. Cost is one extra `deriveDays` per row.
4. **A trip with no routable pair is `miles: 0, milesEstimated: false`** — `.some()` over an
   empty pair list. Nothing fell back because nothing was asked for, so no chip on a card
   with no drives. Asserted.

## Tests

- `packages/core/src/planner/planner.test.ts:333-416` — a new `describe` inside
  `routeSummary`, over the **existing `seedTrip()` fixture** (the Pacific NW Loop, Crater
  Lake floating in `Cascades & Home`): the pair set is exactly
  `astoria→newport`, `newport→bend`, `bend→crater` and `driveMiles` is the sum over **all
  three** (and strictly greater than the scheduled-only two); a **partially populated**
  `RouteMap` (one hit) yields `136` for the hit plus `estimateRoute` for the two misses,
  with the `some(!routes[key])` flag computed off the same map; a fully populated map
  estimates nothing; and a `routingHash` mismatch is a clean miss rather than a wrong
  number. `driveMiles`/`estimateRoute` are imported rather than hardcoded, so the assertion
  is "the same expression", not "this constant".
- `packages/core/src/domain/types.test.ts:182-203` — `tripSummary.parse` accepts a row
  carrying `milesEstimated`, carries the wireframe's cold-cache row (`336 mi`, flag true)
  through verbatim, and `safeParse` **rejects** the same row with the key omitted.
- `apps/web/src/app/api/trips/route.test.ts:72-186` (4 new cases, real Postgres through the
  suite's throwaway database) — the **db seam end to end**, which is the half no core test
  can reach: `GET /api/trips` on a seed loop plus a floating Crater Lake counts the floating
  drive and flags the row; with all three pairs cached it returns `136 + 185 + 106 = 427`
  and **no** flag; one hit and two misses mixes the two on one row and still flags it; and a
  one-stop trip is `0` miles, unflagged. The routed rows are written with the real
  `putCachedRoutes`, and the key's routing half is `NO_ROUTING_HASH` because the fixture
  account has no rig — the same key the page would read.
- **Not covered by a test:** the rendered card. `apps/web`'s vitest is `environment: "node"`
  with `include: ["src/**/*.test.ts"]` and the workspace has no jsdom / testing-library
  (the vet's HIGH against i4's render test), so `TripCard.tsx`'s chip placement is
  **render-required at the walk**. Claimed for qa instead: the lifted `EstimateChip` markup
  is character-identical to the helper it replaced and to `.chip-est` in the wireframe, and
  the only new JSX on the card is the `{trip.milesEstimated && …}` guard inside the existing
  miles `Chip`.

## Checks run

- `npx turbo run lint typecheck test` → `Tasks: 9 successful, 9 total`.
- `pnpm --filter @rv-trip/core test` inside that run → `Test Files 27 passed / Tests 515
  passed` (was 508; +4 routeSummary, +3 tripSummary).
- `apps/web` inside that run → `Test Files 19 passed (19) / Tests 52 passed (52)` (was 48;
  +4 GET /api/trips). A real Postgres was reachable, so no db file skipped.
- `grep -rn "haversineMiles" packages/db/src` → no output; `grep -rn '\bdeg\b'
  packages/db/src` → no output.
- `pnpm install --frozen-lockfile` was needed first (fresh worktree, no `node_modules`) →
  `Done in 6.3s`; the lockfile is unchanged.
- NOT run: `pnpm db:push` / `db:migrate` (barred, and i3 adds no migration — `milesEstimated`
  is a DERIVED field, no column).

## For the walk

The dashboard, `/`. Every card's miles number **changes** — the seed trip goes
**249 → 427 mi** — because both the metric and the pair set changed. That is the bug being
fixed, not a regression. With a cold `routes` table (or no HERE key) each card shows the
estimate total with a small neutral **estimate** pill immediately right of the miles chip;
open a trip so the rail fills the cache, come back, and the number should become the routed
one **and the pill should disappear**. The card's number and the rail's total must read the
same on the same trip — that is the whole point of the item.
