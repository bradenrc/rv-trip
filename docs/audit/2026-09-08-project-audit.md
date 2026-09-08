# RV Trip Hub — project audit

**Date:** 2026-09-08
**Scope:** everything on `main` at `c6d18c4`, the open board
([bradenrc/projects/6](https://github.com/users/bradenrc/projects/6)), and the
MVP spec (`docs/superpowers/specs/2026-07-19-rv-trip-hub-mvp-design.md`).
**Method:** read every source file in `apps/web`, `packages/*`; ran the full
uncached `lint · typecheck · test` (7/7 tasks green, 154 core tests); smoke-ran
the dev app at `/`, `/trips/[id]`, `/map` with live Mapbox tiles and no console
errors.

The roadmap that falls out of this audit is the set of issues linked in
§5. This document is the "why"; the issues are the "what, in order".

---

## 1. Where the project stands

**Health: good.** The monorepo builds clean, the domain core is well tested,
and the three screens the MVP spec named (Timeline, Route, Stop detail) are
built and persisting to Postgres. The map stack (Mapbox GL display · HERE
RV-safe routing · Google Maps handoff) is wired end to end with real
credentials in `.env`.

**Shape: a very good read-mostly planner over seeded data.** Almost every
*write* path that would let a real user build a trip from nothing is missing.
The app cannot create a trip, a leg, a stop, an idea, or a saved place. It is a
demo of the grammar, not yet a tool for it.

**Substrate: local-dev only.** Auth is a hardcoded `dev-user`; there are no
migrations, no CI, no deployment, and the API routes are unauthenticated.
Nothing here is wrong — it was the deliberate local-dev-first plan — but it is
the wall between "works on Braden's laptop" and "sellable".

---

## 2. Feature status matrix

Legend: ✅ works · 🟡 partial · ⬜ stub / dead UI · ❌ missing

### Trips

| Feature | Status | Evidence |
|---|---|---|
| Dashboard by status (planning / upcoming / traveled) + stats | ✅ | `apps/web/src/app/page.tsx`, `listTripsForOwner` |
| Open a trip, Timeline lens (gantt) | ✅ | `components/trip/Timeline.tsx` |
| Route lens with drives, notices, rail summary | ✅ | `components/trip/RouteView.tsx` |
| Create a trip | ⬜ | `/trips/new` is a `StubPage`; no `POST /api/trips` |
| Edit trip title / dates / home base / status / rating / note | ❌ | no UI, no `PATCH /api/trips/:id` |
| Delete / archive / clone a trip | ❌ | dashboard copy promises "reopen to revisit or clone" |
| Trip status transitions | ❌ | `status` is only ever set by the seed |
| Dashboard miles | 🟡 | haversine in `queries.ts`; the planner rail uses HERE — the two disagree |

### Legs and stops (the grammar)

| Feature | Status | Evidence |
|---|---|---|
| Legs → stops → derived drive/stay/open days | ✅ | `deriveDays`, 9 tests |
| Floating vs scheduled stops, both lenses | ✅ | `orderedLegStops`, `timelineModel` |
| Add a leg | ⬜ | "Add leg" button has no handler (`RouteView.tsx:172`) |
| Add a stop | ⬜ | two "Add stop" buttons, no handler (`TripPlanner.tsx:243`, `RouteView.tsx:69`) |
| Rename / reorder / delete a leg | ❌ | no API |
| Delete a stop, move a stop between legs | ❌ | no API |
| Reorder floating stops (drag) | ✅ | `reorderLegStops` + `POST /api/legs/:id/reorder` |
| Schedule a floating stop | 🟡 | drop on *any* open span schedules into the *first* gap for a fixed 3 nights (`Timeline.tsx` `onDrop` ignores which gap; `scheduleFloating(trip, id, nights = 3)`) |
| Set arbitrary arrive/depart dates, unschedule | ❌ | `PATCH /api/stops/:id` accepts dates but no UI sends chosen ones |
| Drag/resize a bar on the gantt | ❌ | `StopBar` is display-only |
| Stop rating + notes | ✅ | persisted on click / blur |
| Place search when adding a stop | ❌ | `PlacesProvider` is the stub; `GOOGLE_API_KEY` is present but unused |
| Geocode backfill for coordless stops | ❌ | named as follow-up in #11; still open |

### Reservations and ideas

| Feature | Status | Evidence |
|---|---|---|
| List, rate, note reservations | ✅ | |
| Create a reservation | 🟡 | type/name/cost only; the form's `dates` field is collected and dropped (`checkIn: null`); no check-out, confirmation number |
| Edit reservation type / name / dates / confirmation / cost | ❌ | `PATCH` accepts rating+notes only |
| Delete a reservation | ❌ | |
| List, cycle status, rate, note ideas | ✅ | |
| Create an idea | ❌ | seed-only |
| Delete an idea | ❌ | |
| Promote idea → reservation | 🟡 | hardcodes `type: "activity"` and a canned note |

### Places library

| Feature | Status | Evidence |
|---|---|---|
| Two shelves (want / been), category chips, grid / map lens | ✅ | `PlacesLibrary.tsx` |
| Save a place | ⬜ | header button has no handler (`places/page.tsx:26`) |
| Edit / delete / graduate want → been | ❌ | no mutations for `saved_places` at all |
| Suggest "been" from rated stops on completed trips | ❌ | the memory-layer seed the spec describes |

### Map and routing

| Feature | Status | Evidence |
|---|---|---|
| Mapbox GL basemap, Night/Day/Sat, layer chips, spiderfy, rail | ✅ | #11, #12 |
| HERE truck routing under the rig profile, notices, cache | ✅ | #9, 28 provider tests |
| Google Maps navigate handoff | 🟡 | endpoints only, by design; corridor-faithful version is the documented fast-follow |
| Route polylines drawn on the map | ❌ | `RouteResult.polyline` is "carried, not yet consumed"; the map still draws great-circle `arcs` |
| Route cache survives a deploy / cold start | ❌ | in-process `Map` in `lib/routing.ts` — on Vercel every cold start re-bills HERE |
| Rig profile form + presets + upsert | ✅ | `/rig` |
| Stop-detail mini-map | ✅ | |

### Account and substrate

| Feature | Status | Evidence |
|---|---|---|
| Auth / multi-tenant | ⬜ | `getOwner()` returns `"dev-user"`; every API route is open; the avatar button is dead |
| Settings | ⬜ | `StubPage` |
| People & groups | ⬜ | `StubPage` — **and contradicts the spec** ("couple-first, no group features"); see §4 |
| Light theme | 🟡 | #19 is Ready to Dev; its dev worktree (`.claude/worktrees/19`, `1b0616f`) holds unshipped output with no PR |
| Responsive / PWA | ❌ | fixed-width desktop layout (`max-w-[1120px]`, 260px rail, 360px panels); no manifest; spec says "glance on phone" |
| Schema migrations | ❌ | `drizzle-kit push` only; no `drizzle/` folder; earlier columns were added by hand-`ALTER` |
| CI | ❌ | no `.github/workflows`; the pipeline's `test_cmd` runs only on this machine |
| Deployment (Vercel + Neon + Clerk) | ❌ | nothing provisioned |
| Tests beyond core | ❌ | no API handler tests, no component tests, no e2e |

---

## 3. Architecture gaps

Ordered by how much they block the rest.

### G1 · No write path for the grammar
The spec's own words: `stops` CRUD plus first-class **reorder** and
**schedule/unschedule** are "the load-bearing mutations for the two-view
model". Today only reorder exists. Trip, leg, stop, idea, and saved-place
*creation* is absent, and there is no delete anywhere. Until this lands, no
user can start from an empty account. Everything in §2 marked ⬜/❌ under
Trips, Legs and stops, Reservations and ideas, Places is one gap wearing five
hats.

### G2 · The planner's model logic lives in the web app, not the core
`apps/web/src/lib/trip-logic.ts` (597 lines: `timelineModel`, `routeModel`,
`routeSummary`, `scheduleFloating`, `reorderFloating`, every optimistic
mutation helper) and `trip-ui.tsx` (date formatting) are **pure TypeScript
with no framework imports** — they only import `@rv-trip/core`. They are
exactly what the spec says belongs in `packages/core` ("the derived-days
projection and reorder/reschedule logic are pure functions in core →
unit-tested hard"). They have **zero tests** and a native client cannot
import them. Moving them is mechanical and is the prerequisite for the native
app not duplicating the planner.

### G3 · No API surface for a second client
The web app reads the database directly from server components and only
*mutates* over REST. There is no `GET /api/trips`, `GET /api/trips/:id`, or
`GET /api/places`, and no `packages/core/api-client` (the spec's architecture
diagram lists it). A native app has nothing to call. The read endpoints are
small; the typed client is the piece that keeps web and native on one contract.

### G4 · Auth is a stub and the API is open
`getOwner()` is the Clerk seam and every query is already owner-scoped, so
the design is right — but nothing enforces it. Before any URL is public this
is the blocker, and it gates native sign-in too.

### G5 · Schema evolution is by hand
`db:push` is fine for one laptop. The memory notes that the `status`/`rating`
/`note` columns were added by direct `ALTER TABLE` because push choked on an
enum diff. Neon (and any teammate) needs checked-in migrations and a
`db:migrate` step in deploy.

### G6 · Routing cost model assumes a long-lived process
The HERE route cache is a bounded in-process `Map`. On Vercel Functions that
is per-instance and dies on every cold start, so a popular trip re-bills HERE
on every deploy. Routes only change when a stop or the rig changes, which is
exactly why a `routes` table keyed by `(from, to, rigHash)` is the right
shape.

### G7 · Polylines stop at the API boundary
`RouteResult.polyline` (HERE flexible polyline) is returned, cached, and then
ignored; the map draws estimated arcs. The decoder already exists and is
tested (`providers/polyline.ts`). This is a small, self-contained gap with a
big visible payoff: the map would show the corridor the rig was actually
cleared for.

### G8 · No verification outside the core
154 core tests are excellent. Every API handler, every screen, and the whole
persistence loop are verified only by hand. The spec asked for handler
integration tests. The mc-dev pipeline's `test_cmd` can only be as honest as
the tests it runs.

### G9 · Desktop-only layout vs "glance on phone"
The spec's usage model is "plan on laptop, glance on phone" and lists
"responsive + PWA" for `apps/web`. Layouts are fixed-width. The native app
(§5, Phase C) is the stronger answer for the phone, but the web app still
needs to not break at 390px.

### G10 · Scope drift into groups
`/settings/people` ("People & groups… trips share to a group") and issue #1
(Google Calendar for "the group/people") both assume collaboration, which the
spec puts explicitly out of scope for v1 (couple-first). Neither is built, so
the fix is a decision, not code — see §4.

---

## 4. Decisions this audit recommends

1. **Freeze v1 scope to the spec.** Retire the "People & groups" stub copy
   and move issue #1 (calendar sync) from *Ready to Dev* to *Todo / later*.
   It is far ahead of trip creation on the dependency chain, and its
   "group" framing needs a product decision first.
2. **Move the planner model into `packages/core`** before writing any native
   screen. One model, two clients — the spec's "parity by construction".
3. **Ship writes before substrate.** Trip/leg/stop/idea/place CRUD (G1) makes
   the product usable by its author *today*, on the local stack. Auth,
   migrations, and deploy (G4, G5) follow immediately after, because they
   are what makes it usable by anyone else.
4. **Native app = Expo, per the spec**, importing `@rv-trip/core` verbatim.
   A SwiftUI app would have to re-implement `deriveDays`, route ordering, rig
   math, polyline decoding, and the planner model (~1,300 lines of tested
   logic) and would drift. Design in
   `docs/superpowers/specs/2026-09-08-native-app-design.md`.
5. **Resolve the #19 worktree.** `.claude/worktrees/19` carries a full dev
   pass (theme.ts, entry.css revalue, 264-line dev notes) that never became
   a PR. Either the pipeline stalled at a gate or the walk was never signed;
   check the glass before re-dispatching.

---

## 5. Completion path

Four phases. Each phase is shippable on its own; each row is one issue on the
board. Phase C starts now (this audit's session) because it is where the
"native iOS app" request lands and because its first two rows (C0, C1) are
pure architecture fixes that every later phase benefits from.

### Phase A — make the grammar editable (closes G1)

| # | Issue | Depends on |
|---|---|---|
| A1 · [#21](https://github.com/bradenrc/rv-trip/issues/21) | Trip CRUD: real `/trips/new`, trip settings (title/dates/home/status/rating/note), delete | — |
| A2 · [#22](https://github.com/bradenrc/rv-trip/issues/22) | Leg + stop CRUD: add/rename/reorder/delete legs; add/delete/move stops; explicit date editor + unschedule; gantt drop targets the gap you dropped on | A1 |
| A3 · [#23](https://github.com/bradenrc/rv-trip/issues/23) | Google Places wiring: `PlacesProvider` server impl + `/api/places/search`; place picker in add-stop / add-idea / save-a-place; geocode backfill | — |
| A4 · [#24](https://github.com/bradenrc/rv-trip/issues/24) | Reservations + ideas complete: create idea; delete either; full reservation edit (type/name/dates/confirmation/cost); promote keeps a chosen type | A2 |
| A5 · [#25](https://github.com/bradenrc/rv-trip/issues/25) | Places library write path: save / edit / delete / graduate want→been; suggest "been" from rated stops on completed trips | A3 |

### Phase B — sellable substrate (closes G4, G5, G6, G8)

| # | Issue | Depends on |
|---|---|---|
| B1 · [#26](https://github.com/bradenrc/rv-trip/issues/26) | Auth: Clerk on web (middleware + `getOwner()` from session) and the API; dev-owner mapping for local | — |
| B2 · [#27](https://github.com/bradenrc/rv-trip/issues/27) | Migrations + Neon: checked-in `drizzle/` migrations, `db:migrate` in deploy, Neon branches for preview/prod | — |
| B3 · [#28](https://github.com/bradenrc/rv-trip/issues/28) | CI + Vercel: GitHub Actions running the pipeline's `test_cmd`; Vercel project + env; preview deploys | B2 |
| B4 · [#29](https://github.com/bradenrc/rv-trip/issues/29) | Persistent route cache: `routes` table keyed `(from, to, rigHash)` with TTL | — |
| B5 · [#30](https://github.com/bradenrc/rv-trip/issues/30) | API integration tests against the docker Postgres (and later a Neon branch) | — |

### Phase C — native app and phone (closes G2, G3, G9)

| # | Issue | Depends on |
|---|---|---|
| C0 · [#31](https://github.com/bradenrc/rv-trip/issues/31) | Shared planner core: move `trip-logic` + `trip-ui` into `packages/core/planner`, with tests; web re-exports | — |
| C1 · [#31](https://github.com/bradenrc/rv-trip/issues/31) | Read API + typed client: `GET /api/trips`, `/api/trips/:id`, `/api/places`; `packages/core/api-client` (Zod-validated) | — |
| C2 · [#31](https://github.com/bradenrc/rv-trip/issues/31) | Expo app `apps/mobile` v1 (iOS-first): trips → trip (route list with drives + day strip) → stop detail (read, rate, note) → navigate handoff; rig read-only; runs in the iOS Simulator | C0, C1 |
| C3 · [#32](https://github.com/bradenrc/rv-trip/issues/32) | Mobile map: `@rnmapbox/maps` dev build, corridors from polylines, stop mini-map | C2, D1 |
| C4 · [#33](https://github.com/bradenrc/rv-trip/issues/33) | Mobile auth: Clerk Expo, token into `api-client` | B1, C2 |
| C5 · [#34](https://github.com/bradenrc/rv-trip/issues/34) | Responsive web + PWA manifest (the "glance on phone" web path) | — |

### Phase D — known fast-follows (closes G7 and documented debts)

| # | Issue | Depends on |
|---|---|---|
| D1 · [#35](https://github.com/bradenrc/rv-trip/issues/35) | Draw HERE polylines as solid corridors on the map; arcs only for estimates | — |
| D2 · [#36](https://github.com/bradenrc/rv-trip/issues/36) | Corridor-faithful navigation handoff (Google Routes API `via` intermediates; HERE WeGo option) | — |
| D3 · [#37](https://github.com/bradenrc/rv-trip/issues/37) | Dashboard miles from routed drives (one number everywhere) | B4 |
| D4 · [#38](https://github.com/bradenrc/rv-trip/issues/38) | Trip status automation (planning → upcoming → complete by dates) + settings surface (units, theme, default map style) | A1 |

Already on the board and unchanged by this audit: **#19** (palette + light
theme, Ready to Dev — see §4.5) and **#1** (calendar sync — recommend Todo).

---

## 6. Small things noticed on the way

Not worth their own issue; fold into the nearest one.

- `getTripForOwner()` in `queries.ts` is unused (single-trip era). Delete with A1.
- `PATCH` handlers return `204` even when the owner-scoped `UPDATE` matched
  zero rows. Correct for tenancy, but the client cannot distinguish "saved"
  from "not yours". Return `404` on zero rows when B1 lands.
- `AddForm.dates` is collected and never sent. A4.
- `packages/core/src/theme/` contains only tests that read the web app's
  files by path. Works, but a native theme port wants the tokens as data in
  core, not CSS. C2 does this for the colour tokens.
- `.nvmrc` says 24; the machine runs Node 26. Harmless; pin in CI (B3).
- `README.md` still says maps are "Mapbox/Google, stubbed locally". Update
  with C1.
