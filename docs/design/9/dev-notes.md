# Issue 9 — RV-safe routing · dev notes

Implements the signed wireframe (`mc/wireframe/issue-9-v0`, `docs/design/9/index.html`)
in full — both passes of §7 (`#9a` no-network, `#9b` the vendor) on this one branch,
as §7 itself says they share ("Both passes share one branch and one walk"). The engine
dispatched issue 9, not 9a/9b, and splitting is orchestration.

---

## Round 2 — the mid-flight handoff change, and the qa findings

The human's mid-flight decision **dropped the via-waypoint handoff**: Google's
`dir/?api=1` scheme has no pass-through waypoint, so every sampled coordinate became a
destination snapped to an address (farm lanes, forest roads). What replaced it is the
minimal usable handoff, plus a caption that makes the loss of fidelity legible.

**Removed** (was ~60 lines of selection logic + 9 tests):

- `packages/core/src/providers/navigation.ts` — waypoint sampling, polyline-divergence
  selection, the `MAX_GOOGLE_WAYPOINTS` / `MIN_WAYPOINT_SEPARATION_METERS` caps, the
  travel-order re-sort, and all multi-waypoint URL construction. `NavigationHandoff.waypoints`
  is gone with them.
- `apps/web/src/lib/trip-logic.ts:276` — the second `estimateRoute` call and both
  `decodeFlexiblePolyline` calls that existed only to feed divergence selection.

**Built:**

- `packages/core/src/providers/navigation.ts:39` —
  `buildNavigationHandoff(origin, destination, options?): { url }`. Pure, network-free,
  positional endpoints with a **trailing options object** (`NavigationHandoffOptions:34`)
  that accepts nothing today — the seam exists so the fast-follow extends the object
  instead of churning call sites. Five tests at `navigation.test.ts`, including one that
  asserts the URL has exactly four params and never the substring `waypoints`, and one
  that asserts passing `{}` does not change the link.
- `apps/web/src/components/trip/RouteView.tsx:236` — the amber caption on the restricted
  drive card, directly under the Navigate action and above the notice rows:
  *"Navigation may not follow the RV-safe route — check notices."* Plain
  `text-rv-warning` at 11.5px, right-aligned to the button — amber because the
  restriction is real, but **not** a bordered row, so it reads as a caption on an action
  rather than a second error. State 1 (a clean drive) has no notices and so no caption.
- `packages/core/src/providers/polyline.ts:3-12` — the decoder is kept and documented as
  the deliberate **seam**, not as live code. `RouteResult.polyline` still comes back from
  HERE (`return=polyline,summary`) and the stub still encodes one, which is what the
  corridor-faithful fast-follow (server-side Google Routes API `via` intermediates
  validated against the HERE geometry, plus a WeGo option) and the Mapbox display layer
  will read. Flagged for qa: **`decodeFlexiblePolyline` now has zero production callers.**
  I kept it rather than deleting it because the human's note says "leave the seam"; if qa
  reads that as dead code instead, deleting it and its 6 tests is a one-line revert.

**qa findings from `mc/qa/issue-9-v0`:**

- **CN · the HERE degradation paths had no test.** Fixed — `here.test.ts:171-335` now
  constructs `HereRoutingProvider` against a scripted `globalThis.fetch` (no live call)
  and pins 11 behaviours: happy path, dead network, rejected grant, grant with no
  `access_token`, `/routes` 5xx, unreadable body, 401-then-200 re-grant, persistent 401
  degrading rather than looping, one grant per process across two drives, concurrent
  misses collapsing onto one grant, and a failed grant not poisoning the next call.
  **Mutation-proved, three ways:** replacing the `route()` catch body with
  `throw new Error("no degrade")` → 7 failed; deleting the token-cache hit at `here.ts:91`
  → 1 failed; disabling the 401 retry at `here.ts:81` → 2 failed. Restored → 25 passed.
- **CL · `RouteSummary.anyEstimated` was dead.** Removed from the interface and from the
  returned object (`trip-logic.ts`); no reader existed (`grep` finds none).
- **CL · a leg with zero stops mislabelled the seam.** `resolveDrives` now files the
  boundary drive as `{ drive, toLegId }` (`trip-logic.ts:307`) and `routeModel` resolves
  the label through a `legId → number` map (`trip-logic.ts:320`, `:356`), so an emptied
  leg in between renders `Leg 1 → Leg 3` rather than always `i → i + 1`.
- **CL · `routing.ts` is server-only by comment.** *Not fixed.* The `server-only` package
  is not in this lockfile (`find` for it returns nothing) and adding a dependency needs a
  network install this worktree should not do. Left as-is, with qa's own assessment
  standing: its only importers are `trips/[id]/page.tsx` and `api/routes/route.ts`, and
  Next does not expose non-`NEXT_PUBLIC` env to a client bundle.

---

## What changed

### `packages/core` — the pure, testable half (118 tests, all green)

| file | what |
| --- | --- |
| `src/domain/rig.ts` | `rigProfile` / `rigProfileInput` Zod schemas + `rigType` enum; imperial⇄metric converters; `RIG_PRESETS`; `rigHash` |
| `src/domain/route-order.ts` | `orderedStops` · `orderedLegStops` · `orderedPairs` · `routeCacheKey` |
| `src/providers/index.ts` | `RouteLeg` → **`RouteResult`** (G6); `RouteNotice`; sync `estimateRoute`; `StubRoutingProvider` now wraps it |
| `src/providers/polyline.ts` | HERE flexible-polyline encode (live, via the stub) + decode (**seam only** — no consumer since round 2) |
| `src/providers/navigation.ts` | `buildNavigationHandoff(origin, destination, options?)` — a plain origin/destination Google deep link. **No waypoints** (see round 2) |
| `src/providers/notices.ts` | `noticeKind` · `composeNoticeMessage` · `splitNoticeMessage` |
| `src/providers/route-format.ts` | `driveMiles` · `driveMinutes` · `formatDriveTime` · `driveLabel` |
| `src/providers/here.ts` | `HereRoutingProvider` — **server-only**, reachable only at the `@rv-trip/core/providers/here` subpath (`packages/core/package.json:10`), deliberately NOT re-exported from `providers/index.ts` so `fetch` + credentials never enter a client bundle |

- `packages/core/src/domain/rig.ts:45` — store at 0.1 mm (`roundMeters`), round **up**
  at the vendor boundary (`metersToVendorCm:67`, `kilogramsToVendorKg:73`). The §3 worked
  math is asserted verbatim in `rig.test.ts:18-100`, including a sweep at `rig.test.ts:86`
  proving `metersToVendorCm` never reports the rig smaller than it is.
- `packages/core/src/domain/rig.ts:139-166` — `rigHash` is sha256 (Web Crypto) over all
  seven fields, computed **once on the server** and passed to the client as a string, so
  no client render path awaits it.

### `packages/db`

- `src/schema.ts:48` `rig_type` pgEnum · `src/schema.ts:182-205` the `rigs` table
  (owner-scoped, `owner_id` **unique** — that constraint is what makes the upsert atomic).
  Dimensions are `numeric(6,4)` — never float, never whole cm.
- `src/queries.ts:282` `getRigByOwner` + `:288` `mapRigRow` (numeric-as-string → number).
- `src/mutations.ts:141` `upsertRig` via `onConflictDoUpdate`.

### `apps/web`

- `src/lib/trip-logic.ts:225-311` — `RouteRow.driveLabel` → `RouteRow.drive: RouteDrive | null`;
  `RouteLeg` gains `outboundDrive` + `outboundSeam` (G1). `resolveDrives:298` builds every
  drive once from `orderedPairs` and indexes it the two ways the screen needs.
- `src/lib/trip-logic.ts:313` / `:385` — **pinned signatures** (vet MED):
  `routeModel(trip, routes: RouteMap = {}, rigHash = NO_RIG_HASH)` and
  `routeSummary(trip, routes, rigHash)`; both memo dependencies updated at
  `TripPlanner.tsx:83-84`.
- `src/lib/trip-ui.tsx:35` — the duplicate haversine is **gone**; one implementation.
- `src/lib/routing.ts` — server-only `routeTrip` / `routePairs`, the provider selection
  (HERE if all three OAuth values are set, else the stub) and a bounded in-process cache.
- `src/app/trips/[id]/page.tsx:20-21` — resolves rig + routes before render; passes
  `routes`, `rigHash`, `hasRig`. The rig object itself never crosses to the client.
- `src/components/trip/RouteView.tsx:200` `Drive` (states 1/2/3), `:252` `EstimateChip`,
  `:260` `NavigateButton`; `:158-168` the leg seam; `:319` the rail restriction count and
  `:331` the rig nudge.
- `src/app/rig/page.tsx` — no longer a `StubPage`. `src/components/rig/RigForm.tsx` is §3.
- `src/app/api/rig/route.ts` — **PUT** (+ GET), local Zod schema, `getOwner()`.
- `src/app/api/routes/route.ts` — POST, local Zod schema, `getOwner()`, rig resolved from
  the caller and never from the body.
- `src/lib/trip-api.ts:53` `saveRig` / `:56` `routePairs` client entries.

### `packages/ui`

- `src/RouteNotice.tsx` (+ `index.ts:6`) — the new DS component. Composes `FloatingTag`'s
  amber pairing widened to a row; mono runs come from core's tested `splitNoticeMessage`.

---

## Every vet finding, and how it was resolved

1. **HIGH · what triggers state 3.** Resolved as directed: missing coordinates yield **no
   connector at all**. `orderedPairs` filters pairs to those where both stops have
   coordinates (`route-order.ts:58`), asserted at `route-order.test.ts:130`
   ("coordinates — not dates — are the precondition", and no pair is invented *across* a
   coordinate-less stop). State 3 now means only: no rig / no credentials / provider error.
2. **HIGH · `estimateDrive` sync vs async.** The pure sync haversine survives as
   `estimateRoute` (`providers/index.ts:86`), exported from core; `StubRoutingProvider.route`
   is a one-line async wrapper around it (`:109`). `route-format.test.ts:59` asserts the two
   are literally the same value — one implementation, not two. The key-miss path calls the
   sync one inside the `useMemo` (`trip-logic.ts:276`).
3. **MED · path for the `routes` map.** Pinned above; both functions take
   `(trip, routes, rigHash)` and both memos depend on all three.
4. **MED · the two new handlers.** `/api/rig` is **PUT** (singleton resource, idempotent
   upsert; GET added for symmetry). Both handlers declare their own local Zod schema and
   `safeParse` → `NextResponse.json({ error }, { status: 400 })`, and both are `getOwner()`-scoped.
   `/api/routes` resolves the rig from the caller, never the body. Client entries added.
5. **MED · rail data fidelity.** Nothing to fix in code — the rail already rendered real
   values; the wireframe's numbers were wrong. Confirmed live against the seed: the rail
   reads **28 days**, **15 days · 3 gaps**, hero **Aug 1 – 28, 2026** — exactly the vet's
   arithmetic, not the design's "27 / 10 · 2 / Aug 2–28".
6. **MED · ideas rendered in the reservation slot.** Cosmetic to the wireframe only. The
   shipped row anatomy is unchanged and renders correctly: Newport shows *South Beach State
   Park* as its reservation with the aquarium under the "Ideas" divider, and Astoria shows
   both its reservations (verified live).
7. **MED · undocumented `rv-travel` role.** Named, per the vet's first option:
   `.design-sync/conventions.md:21-24` now documents `rv-travel*` as the Travel category
   colour **and**, as a 3px `border-l` only, the structural accent marking a card as being
   about a drive. The design's accent is kept.
8. **MED · dev vocabulary in the save bar.** Rewritten to
   "Saving re-routes every drive on every trip." (`RigForm.tsx:234`). "Cache" and "seven
   fields" are gone.
9. **MED · no test home for `orderedPairs`.** Moved into `packages/core`
   (`src/domain/route-order.ts`) where vitest runs; 11 tests cover ordering, the leg
   boundary flag, the coordinate precondition and the cache key.
10. **MED · two off-by-N doc citations.** Noted; both are in the design document, not in
    code. No code depends on them. `conventions.md`'s green/CTA line is left alone — G7
    itself calls that out as its own tiny PR.
11. **FLAG · render-required at walk.** See "Unproven" below.

---

## Decisions and deviations worth your attention

- **`RouteResult.primaryRoad` is an addition to the §5 contract.** §1/§2 render
  `3h 12m · 136 mi · US-101`, but nothing in the stated contract carries a road name
  (notices carry a *per-notice* road). I added `primaryRoad: string | null` and request
  `spans=notices,names`; the stub returns null and the `· road` fragment simply doesn't
  render. **qa: check this addition is acceptable.**
- **The stub's nominal speed moved 80 → 75 km/h** (`ESTIMATE_AVG_KMH`). 75 is what the app
  has always actually shown, and it is what the design's own numbers are drawn at
  (Astoria→Newport `~2h 19m · 108 mi`; Newport→Bend `~3h 02m · 141 mi` — both asserted at
  `route-format.test.ts:25` and `:32`). Collapsing to 80 would have silently changed every
  rendered number.
- **`rv-ink-subtle` could not be used for the seam label or the `·` separator**, though the
  design specifies it for both. `packages/core/src/theme/nightfall-tokens.test.ts:193`
  (a prior vet HIGH) scopes `rv-ink-subtle` to non-text. Both use `rv-ink-faded` — the
  documented "mono kickers / meta" role. The seam therefore reads one step brighter than
  the wireframe. **Flagged for the walk.**
- **The ft/in inputs are one bordered mono box containing two number inputs**, not one text
  field. §3's form is explicitly a "NON-INTERACTIVE facsimile: divs, never `<input>`", so
  something had to give; this keeps `.fauxinput.mono`'s look ("11 ft 6 in" in a single box)
  while being typeable. Verified live: it round-trips 3.5052 m → `11 ft 6 in`.
- **No migration was committed, deliberately.** `pnpm db:generate` produced a `0000_` file
  covering **all seven** tables — this repo has never tracked a `drizzle/` directory and
  README documents `pnpm db:push` as the local flow. Committing a baseline would mislabel
  six pre-existing tables as new and break `drizzle-kit migrate` against any DB created by
  `push`. The `rigs` table lands via `pnpm db:push`, like every other table here.
  Introducing a migrations baseline is its own change.
- **`pnpm db:push` against the *existing* local `rvtrip` database fails** with
  `column "id" is in a primary key` — pre-existing drift, not this change: the same push
  applies cleanly to a fresh database (verified below). Whoever runs the walk may need to
  recreate the local DB.

## Unproven until the walk (vet FLAG — nothing here was exercised against live HERE)

No HERE call was made from this worktree; `HERE_ACCESS_KEY_ID` / `_SECRET` /
`_TOKEN_ENDPOINT` remain commented out in `.env.example`. Unverified against the vendor:
the OAuth 1.0-style HMAC-SHA256 `client_credentials` grant and its caching; `transportMode=truck`
with `vehicle[*]` in cm/kg; the `vehicle[shippedHazardousGoods]=flammable` enum value;
`spans=notices,names` and the notice/span shapes `parseRouteResponse` reads. All of it is
pinned by tests against a *synthetic* body (`here.test.ts`), and every failure path —
grant rejected, 401, 5xx, malformed body, network — degrades to `estimateRoute` and renders
state 3 (`here.ts:60-68`). **The graceful degradation is the thing that must hold.**

Two things are better than "shaped from docs":
- `decodeFlexiblePolyline` passes HERE's **published test vector** `BFoz5xJ67i1B1B7PzIhaxL7Y`
  (`polyline.test.ts:52`) as well as a 200-point round-trip.
- **State 2 (the restricted drive card) has never been rendered.** Its copy is unit-tested
  (`notices.test.ts`) but the card, the amber rows, the new amber Navigate caption and the
  rail restriction count all need real notices, so they are walk-only.
- The Navigate link itself is now trivially verifiable and *was* observed in the browser
  last round: a plain origin/destination `dir/?api=1` URL. That is the only shape it can
  emit now.

---

## Checks run

| check | command | result |
| --- | --- | --- |
| gate (round 2) | `pnpm turbo run lint typecheck test` | `Tasks: 7 successful, 7 total` — 0 lint problems, **118 core tests passed** |
| build | `pnpm build` (apps/web) | `✓ Compiled successfully`; `/api/rig` and `/api/routes` registered, `/rig` now `ƒ` |
| schema | `pnpm db:push` into a fresh `rvtrip_issue9` | `[✓] Changes applied`; `pnpm db:seed` → `Seeded Pacific Northwest Loop…` |
| route view | `next start` + browser, Route lens | Astoria→Newport `~2h 19m · 108 mi`, **`Leg 1 → Leg 2`** seam + `~3h 02m · 141 mi`, Bend→Crater `~1h 52m · 87 mi`; rail **336 mi / 7h 13m** = 108+141+87 — **the rail is exactly the sum of the connectors on screen (G1/G2)** |
| no-rig state | same page, no rig saved | every drive tagged `estimate`; rail carries the dashed "Set up your rig →" nudge |
| `PUT /api/rig` | curl, valid + invalid bodies | `200` with the rig echoed back at full precision (`3.5052`, `6577.09`); `400` with Zod `fieldErrors` |
| `POST /api/routes` | curl, valid + `{"pairs":[]}` | `200` with a map keyed `44.6365,-124.053\|44.0582,-121.3153\|<sha256>`; `400` |
| rig round-trip | reload `/rig` after saving | `11 ft 6 in`, `= 3.5052 m stored · sent as 351 cm`; `= 6,577.09 kg stored · sent as 6,578 kg` — §3's worked math, on screen |
| rig → re-route | trip page after saving | nudge gone; route keys now carry the sha256 rig hash |

**SKIPPED:** every live HERE interaction (no credentials) and therefore the whole of
state 2 — the restricted drive card, its amber notice rows, the new amber caption under
Navigate, and the rail restriction count. See "Unproven" above. The round-2
degradation tests stub `fetch`; they prove *our* side of the contract (degrade, retry
once, grant once), never that HERE accepts the request.

Round 2 re-ran only the gate. `pnpm build`, `db:push`/`db:seed`, the browser walk of the
Route lens and the two curl'd handlers are **from round 1** and were not repeated — no
handler, schema or query changed this round.
