# Issue 9 — RV-safe routing · dev notes

Implements the signed wireframe (`mc/wireframe/issue-9-v0`, `docs/design/9/index.html`)
in full — both passes of §7 (`#9a` no-network, `#9b` the vendor) on this one branch,
as §7 itself says they share ("Both passes share one branch and one walk"). The engine
dispatched issue 9, not 9a/9b, and splitting is orchestration.

---

## What changed

### `packages/core` — the pure, testable half (111 tests, all green)

| file | what |
| --- | --- |
| `src/domain/rig.ts` | `rigProfile` / `rigProfileInput` Zod schemas + `rigType` enum; imperial⇄metric converters; `RIG_PRESETS`; `rigHash` |
| `src/domain/route-order.ts` | `orderedStops` · `orderedLegStops` · `orderedPairs` · `routeCacheKey` |
| `src/providers/index.ts` | `RouteLeg` → **`RouteResult`** (G6); `RouteNotice`; sync `estimateRoute`; `StubRoutingProvider` now wraps it |
| `src/providers/polyline.ts` | HERE flexible-polyline encode + decode |
| `src/providers/navigation.ts` | `buildNavigationHandoff` — waypoint selection + the Google deep link |
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

- `src/lib/trip-logic.ts:226-312` — `RouteRow.driveLabel` → `RouteRow.drive: RouteDrive | null`;
  `RouteLeg` gains `outboundDrive` + `outboundSeam` (G1). `resolveDrives:301` builds every
  drive once from `orderedPairs` and indexes it the two ways the screen needs.
- `src/lib/trip-logic.ts:314` / `:385` — **pinned signatures** (vet MED):
  `routeModel(trip, routes: RouteMap = {}, rigHash = NO_RIG_HASH)` and
  `routeSummary(trip, routes, rigHash)`; both memo dependencies updated at
  `TripPlanner.tsx:83-84`.
- `src/lib/trip-ui.tsx:35` — the duplicate haversine is **gone**; one implementation.
- `src/lib/routing.ts` — server-only `routeTrip` / `routePairs`, the provider selection
  (HERE if all three OAuth values are set, else the stub) and a bounded in-process cache.
- `src/app/trips/[id]/page.tsx:20-21` — resolves rig + routes before render; passes
  `routes`, `rigHash`, `hasRig`. The rig object itself never crosses to the client.
- `src/components/trip/RouteView.tsx:197` `Drive` (states 1/2/3), `:242` `EstimateChip`,
  `:250` `NavigateButton`; `:158-168` the leg seam; `:309` the rail restriction count and
  `:321` the rig nudge.
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
   `estimateRoute` (`providers/index.ts:84`), exported from core; `StubRoutingProvider.route`
   is a one-line async wrapper around it (`:107`). `route-format.test.ts:57` asserts the two
   are literally the same value — one implementation, not two. The key-miss path calls the
   sync one inside the `useMemo` (`trip-logic.ts:276-277`).
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
  (`notices.test.ts`) but the card, the amber rows and the rail restriction count need real
  notices, so they are walk-only. So is a Navigate link that actually carries waypoints —
  every link observed had zero divergence and correctly emitted a plain origin/destination URL.

---

## Checks run

| check | command | result |
| --- | --- | --- |
| gate | `pnpm turbo run lint typecheck test` | `Tasks: 7 successful, 7 total` — 0 lint problems, 111 core tests |
| build | `pnpm build` (apps/web) | `✓ Compiled successfully`; `/api/rig` and `/api/routes` registered, `/rig` now `ƒ` |
| schema | `pnpm db:push` into a fresh `rvtrip_issue9` | `[✓] Changes applied`; `pnpm db:seed` → `Seeded Pacific Northwest Loop…` |
| route view | `next start` + browser, Route lens | Astoria→Newport `~2h 19m · 108 mi`, **`Leg 1 → Leg 2`** seam + `~3h 02m · 141 mi`, Bend→Crater `~1h 52m · 87 mi`; rail **336 mi / 7h 13m** = 108+141+87 — **the rail is exactly the sum of the connectors on screen (G1/G2)** |
| no-rig state | same page, no rig saved | every drive tagged `estimate`; rail carries the dashed "Set up your rig →" nudge |
| `PUT /api/rig` | curl, valid + invalid bodies | `200` with the rig echoed back at full precision (`3.5052`, `6577.09`); `400` with Zod `fieldErrors` |
| `POST /api/routes` | curl, valid + `{"pairs":[]}` | `200` with a map keyed `44.6365,-124.053\|44.0582,-121.3153\|<sha256>`; `400` |
| rig round-trip | reload `/rig` after saving | `11 ft 6 in`, `= 3.5052 m stored · sent as 351 cm`; `= 6,577.09 kg stored · sent as 6,578 kg` — §3's worked math, on screen |
| rig → re-route | trip page after saving | nudge gone; route keys now carry the sha256 rig hash |

**SKIPPED:** every live HERE interaction (no credentials) and therefore the whole of
state 2 and the waypoint-bearing Navigate link — see "Unproven" above.
