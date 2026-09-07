# RV Trip Hub — v1 (MVP) Design

**Date:** 2026-07-19
**Status:** Approved (brainstorming) — ready for implementation planning

## What we're building

A personal trip hub for **long RV / road trips measured in weeks, not days**. Couple-first
(no group/collaboration features). The core bet is a **trip grammar** — legs, stops,
drive-days vs stay-days, and a **month-at-a-glance** view — that stays legible at 4-week
scale, where a flat day-list UI (Wanderlog-style) collapses.

This is a **commercial, multi-tenant SaaS** intended to be sold to people who travel the
country / take long road trips. Real logins, real relational database, cross-platform.

### Target and positioning

"Wanderlog, but for a 4-week trip." The differentiator is the grammar and the two views
(Route/Sequence ⇄ Month-at-a-glance) projecting the same underlying stops — not the feature
count.

## Scope

### v1 (this spec)
- **Trip grammar**: Trip → Legs → Stops, with drive-day/stay-day **derived** from stop date-spans.
- **Two views** over the same data: **Route/Sequence** (ordered, dates optional) and
  **Month-at-a-glance** (calendar projection of scheduled stops).
- **Reservations per stop** — broad types (campground, lodging, dining, event, tour,
  activity, transport, other).
- **Ideas pool per stop** — backlog items, promotable into the plan.
- **Travel time between stops** — drive time/distance via a routing provider.
- **Ratings + notes** — 1–5★ and notes on stops, ideas, reservations (seeds the memory layer).

### Deliberate fast-follows (schema leaves room; NOT built in v1)
- **Light budget** — roll up reservation costs + rough per-stop estimates into a trip total.
- **Journal / memory layer** — "return visits start from what we loved"; builds on the
  ratings/notes already captured in v1.
- **Native mobile app** — Expo (React Native), importing `packages/core` verbatim.
- **Billing / subscriptions** — required to actually sell; its own cycle.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Usage context | Plan on laptop, glance on phone | No hard offline / live-collab requirement for v1. |
| Client strategy | Web + native (shared code), **web first** | Responsive web on a shared TS core; Expo native later consumes the same core. Parity by construction. |
| Substrate | **Vercel-first** | Fastest to a sellable v1, ~zero ops, still real/relational/multi-tenant. Portable to AWS later. |
| Database | **Neon Postgres** (Vercel Marketplace) | Relational grammar (trip→legs→stops→reservations/ideas) wants joins/ranges. Standard Postgres = portable. |
| Auth | **Clerk** (Vercel Marketplace) | Drop-in React + Expo components; multi-tenant from day one. |
| ORM | **Drizzle** | Lightweight, SQL-first, strong TS types. |
| Maps — routing | **HERE** (`RoutingProvider`) *(amended 2026-09-07; was Mapbox)* | RV-safe truck routing: vehicle profile (height/width/length/weight/propane) avoids low bridges, weight limits, restricted tunnels. Mapbox/Google directions accept no vehicle dimensions. |
| Maps — places | **Google Places** (`PlacesProvider`) | Best place search + details/reviews. |
| Maps — navigation | **Google Maps handoff** | Deep-link turn-by-turn along HERE's safe corridor via constrained via-waypoints; restriction notices shown in-app, never silently trusted. |
| Maps — display | **Mapbox GL** *(amended 2026-09-07)* | In-app map rendering (`/map`, stop detail). Only vendor with a truly styleable basemap — the map wears the product palette via a custom Studio style. Uses a publishable domain-restricted `pk.*` token (documented exception to server-side-keys; secrets stay server-side). |
| Photo storage (fast-follow) | Vercel Blob | Public + private; for the journal layer. |

The data vendors (routing, places) sit **behind interfaces in `packages/core`** so feature code
never touches a vendor and providers can be swapped/AB-tested. Display (Mapbox GL) is a UI
concern, not a core provider — it lives in the web app's map components.

## Architecture

Turborepo monorepo, TypeScript throughout.

```
rv-trip/
├─ apps/
│  └─ web/                # Next.js App Router — responsive + PWA. UI + API route handlers.
│     └─ app/api/…        # API lives here for v1 (Fluid Compute, full Node.js)
├─ packages/
│  ├─ core/               # THE SHARED CORE — no framework code
│  │  ├─ domain/          #   trip grammar: types + Zod schemas + invariants
│  │  ├─ api-client/      #   typed fetch client (web + Expo both import this)
│  │  └─ providers/       #   RoutingProvider (HERE) + PlacesProvider (Google) interfaces
│  ├─ db/                 # Drizzle schema + migrations (Neon Postgres)
│  └─ ui/                 # shared UI primitives (minimal in v1)
└─ (apps/mobile/          # Expo — later cycle; imports packages/core verbatim)
```

Multi-tenant from day one: every row scoped to an owner (Clerk `userId` as tenant key).
Web is the only client in v1; boundaries exist so native drops in without reshaping anything.

## Data model — the trip grammar

- **Trip** — the whole multi-week journey. `title`, `startDate`, `endDate`, `homeBase`, owner.
  Has many **Legs**.
- **Leg** — a named segment ("Pacific Coast", "Desert Southwest"), an ordered span grouping
  stops so a 4-week trip reads as ~4–6 legs, not 28 days. `title`, `sortOrder`. Has many **Stops**.
- **Stop** — a *place you go* (campground, town, park). The anchor.
  - `place` — name + coords + optional Google Place ref.
  - `arriveDate` / `departDate` — **OPTIONAL** (nullable).
  - `sortOrder` — **always present**; defines sequence within the leg.
  - `rating` (nullable 1–5), `notes`.
  - **Two states**: *Scheduled* (has dates → contributes to calendar + derived days) or
    *Floating* (ordered but dateless → sequence only, no calendar constraint). A trip freely
    mixes both; giving a floating stop dates "promotes" it.
- **Day** — **derived, not stored.** Every date in the trip is classified from the *scheduled*
  stops: **stay-day** (inside a stop's arrive→depart span) or **drive-day** (transition between
  stops). Computed by a pure function in `packages/core`. Storing day-type is the Wanderlog trap;
  deriving it means the grammar can never drift out of sync.
- **Reservation** — belongs to a **Stop**. `type` enum
  (`campground | lodging | dining | event | tour | activity | transport | other`), `name`,
  `checkIn`, `checkOut`, `confirmationNumber`, `cost`, `rating`, `notes`. Optional link to an **Idea**.
- **Idea** — belongs to a **Stop**. Backlog item; `title`, `status` (`idea | planned | done`),
  optional Google Place ref, `rating`, `notes`. Promotable into the plan; can become a Reservation.
- *(Reserved seams — schema leaves FKs/room, not built in v1): `BudgetItem` (budget fast-follow);
  `JournalEntry` + a "loved it" memory flag (journal/memory fast-follow).)*

### Load-bearing modeling decisions
1. **Drive-day vs stay-day is derived from stop date-spans**, never stored. Move a stop's dates
   and the whole calendar reflows automatically.
2. **Dates are optional; `sortOrder` is not.** This enables "lay out the places, take it as you
   go." Scheduled and floating stops coexist.
3. **One data set, two projections.** Route/Sequence = `sortOrder`; Month-at-a-glance = date-spans.
   Nothing is duplicated between the views.

## Key screens

- **Route / Sequence view** — ordered legs → stops, dates optional. Home for flexible planning;
  drag to reorder. A stop shows its dates or reads "floating." Reservations/ideas/rating visible.
- **Month-at-a-glance** — calendar projection. Renders **only scheduled stops** as stay-day spans
  with drive-days between. Floating stops sit in a "not yet scheduled" rail, draggable onto dates.
  The view where the grammar shines at 4-week scale.
- **Stop detail** — reservations (all types), ideas (with promote-to-plan), rating + notes,
  map/place info.
- **Route ⇄ Calendar toggle** — two lenses on the same trip; **Leg** is the organizing spine in both.

## API

REST route handlers under `apps/web/app/api`, typed against `packages/core` Zod schemas
(validate in and out), every query tenant-scoped by Clerk `userId`.

- `trips` CRUD; `trips/:id` returns the full nested tree (legs → stops → reservations/ideas) in
  one request, feeding both views.
- `stops` CRUD, plus first-class **reorder** (`sortOrder`) and **schedule/unschedule** (set/clear
  dates) operations — the load-bearing mutations for the two-view model.
- `reservations`, `ideas` CRUD nested under a stop.
- **No `derive-days` endpoint** — the calendar projection is a pure function in `packages/core`,
  computed client-side from the trip tree so Route ⇄ Calendar toggling is instant.

## Maps integration

*(Amended 2026-09-07: routing moved Mapbox → HERE for RV-safe truck routing; Google Maps
navigation handoff added. Nothing was ever built against Mapbox — only the local stub.)*

- `RoutingProvider` → **HERE Routing** (truck transport mode): drive time/distance between adjacent
  stops (scheduled or sequenced), routed under the **rig's vehicle profile** — height, width,
  length, gross weight, propane on board — so low bridges, weight-limited roads, and restricted
  tunnels are avoided, not discovered. Returns polyline + restriction notices, not just numbers.
- **Rig profile** — the `/rig` surface stores the vehicle profile (one rig per account in v1);
  it is the routing input, set once and applied to every drive.
- **Navigation handoff** → Google Maps deep-link (`google.com/maps/dir/?api=1&…`) with
  via-waypoints sampled where HERE's safe route *diverges* from the naive route (URL caps ~9
  waypoints). The app always shows HERE's restriction notices alongside the handoff — Google may
  reroute a deviating driver, so the corridor is guidance, never a guarantee.
- `PlacesProvider` → **Google Places**: place search/autocomplete + details/reviews when adding a
  stop or idea.
- **In-app map display** → **Mapbox GL** (`/map` surface, stop-detail map): custom Studio style
  matching the product palette; route polylines from HERE drawn on it. v1 ships the placeholder;
  display gets its own issue when the map surface is scheduled.
- Vendor **secret** keys (HERE, Google) stay **server-side**; clients call our API, never the
  vendors directly. Exception by design: Mapbox GL's publishable `pk.*` token is client-side,
  domain-restricted — it renders tiles and can do nothing else.

## Cross-cutting

- **Auth / multi-tenancy** — Clerk middleware guards all routes; every table carries an owner FK;
  cross-tenant reads impossible by construction.
- **Error handling** — provider calls are best-effort and degrade gracefully: a missing drive time
  is a missing value, **never a blocked save**. Core invariants (depart ≥ arrive, dates within trip
  bounds) enforced by Zod at the boundary.
- **Testing (TDD)** — the derived-days projection and reorder/reschedule logic are pure functions in
  `core` → unit-tested hard (correctness lives here). API handlers → integration tests against a test
  Neon branch.

## Out of scope for v1 (explicit)
- Group/collaboration/sharing features.
- Offline-first / live collaborative editing.
- Native mobile app (architecture supports it; not built).
- Billing/subscriptions.
- Budget rollups; journal/memory layer.
- RV-specific routing constraints (rig height/weight) — revisit with the routing provider later.
