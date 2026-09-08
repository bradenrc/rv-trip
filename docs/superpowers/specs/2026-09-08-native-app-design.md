# RV Trip Hub — Native app (iOS-first) design

**Date:** 2026-09-08
**Status:** C0 · C1 · C2 built 2026-09-08 (issue #31); C3–C5 open
**Parent:** `2026-07-19-rv-trip-hub-mvp-design.md` (the MVP spec, which
already names this app as a fast-follow: "Expo (React Native), importing
`packages/core` verbatim")
**Audit:** `docs/audit/2026-09-08-project-audit.md` §3 G2, G3, G9

## What we're building

The phone half of "plan on laptop, glance on phone". A native iOS app (Android
falls out of Expo for free but is not a v1 target) that shows the trip you are
*on*: where you are, where you're going next, the drive between them, the
reservations you'll need at the gate, and the notes you promised yourself
you'd read. It is the **glance** surface; the laptop stays the **plan**
surface. Writes in v1 are the on-the-road ones — rating and noting a stop,
ticking an idea — not building the trip.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **Expo (React Native), Expo Router, TypeScript** | The MVP spec's decision. `@rv-trip/core` (Zod schemas, `deriveDays`, route ordering, rig math, polyline decoding, drive formatting, navigation handoff — 154 tests) is imported verbatim. A SwiftUI app would re-implement all of it and drift. |
| Platform order | iOS first; Android untested but not blocked | The author's phone; the simulator toolchain is on the machine. |
| Data access | **Only over the REST API**, through `@rv-trip/core/api-client` | The web app talks to the DB directly from server components; the phone cannot. The typed client is the one contract both clients share, and the web app migrates to it for client-side fetches over time. |
| Shared model logic | `packages/core/planner` (moved from `apps/web/src/lib/trip-logic.ts` + `trip-ui.tsx`) | Pure functions; one Route/Timeline model for both clients. |
| Styling | **RN `StyleSheet` over the `rv-*` token values exported as data from `@rv-trip/core/theme`** *(amended during C2: NativeWind was the first pick; a second Tailwind toolchain in the monorepo bought nothing at v1's screen count. Revisit if the screen count grows.)* | The design system's vocabulary (Stay/Eat/Do/Travel, ember/navy/ink) carries over without a second palette — and `tokens.test.ts` fails if `entry.css` and the token file drift. `packages/ui` (DOM components) is *not* reused. |
| Dev loop | **Expo Go** (SDK 57) on the iOS Simulator; `npx expo start` against the local Next API | No native modules in v1 → no CocoaPods, no dev build, sub-minute reloads. Mapbox (`@rnmapbox/maps`) needs a dev-client build and is Phase C3. |
| API discovery | `EXPO_PUBLIC_API_URL` → the host Metro serves from (`Constants.expoConfig.hostUri`) on port 3000 → `localhost` | The simulator could not reach `localhost:3000` through Expo's fetch; the Metro host is the Mac's LAN address and works for the simulator and a phone on the same Wi-Fi alike. |
| Auth | v1 talks to the unauthenticated local API as `dev-user` (same seam as the web). Clerk Expo lands with Phase B1/C4 through the `api-client`'s token hook. | Nothing to authenticate against yet. The seam is an `Authorization` header provider on the client. |
| Maps in v1 | None in-app. The **Navigate** action opens Google Maps via `Linking` with the same `buildNavigationHandoff` URL the web uses. | Ships the road-value without a native build. Map surface is C3. |
| Offline | Not v1. Last-fetched trip is cached in memory only. | Spec: no hard offline requirement. Persisted cache (SQLite/MMKV) is a later cycle. |

## Architecture

```
rv-trip/
├─ apps/
│  ├─ web/                      # unchanged; lib/trip-logic.ts becomes a re-export
│  └─ mobile/                   # NEW — Expo + Expo Router
│     ├─ app/                   #   file-based routes
│     │  ├─ _layout.tsx         #   the dark Stack (no providers needed in v1)
│     │  ├─ index.tsx           #   Trips list
│     │  ├─ trips/[id]/index.tsx #   Trip: day strip + route list with drives
│     │  ├─ trips/[id]/stops/[stopId].tsx   # Stop detail (rate, note, ideas, reservations)
│     │  └─ rig.tsx             #   Rig (read-only in v1)
│     ├─ src/api.ts             #   the configured api-client instance
│     ├─ src/store.ts           #   in-memory bundle store (useSyncExternalStore)
│     ├─ src/theme.ts · src/ui.tsx #   tokens from @rv-trip/core + the small shared pieces
│     └─ app.json
└─ packages/core/src/
   ├─ planner/                  # NEW (moved): timelineModel, routeModel, routeSummary,
   │                            #   schedule/reorder helpers, date formatting — with tests
   ├─ api-client/               # NEW: typed fetch client, Zod-validated responses
   └─ theme/tokens.ts           # NEW: the rv-* colour tokens as data
```

**Monorepo mechanics.** Expo's Metro config auto-detects the pnpm workspace
root. `@rv-trip/core` exports TypeScript source (`./src/index.ts`);
`babel-preset-expo` transpiles it like any app file. `packages/core` must
stay free of Node-only imports on its public entry — the HERE provider is
already quarantined behind the `./providers/here` subpath for exactly this
reason.

## API contract (Phase C1)

All responses are validated in the client against `@rv-trip/core` schemas,
so a drift on either side fails loudly in development.

| Method | Path | Returns | Notes |
|---|---|---|---|
| `GET` | `/api/trips` | `TripSummary[]` | the dashboard rows |
| `GET` | `/api/trips/:id` | `{ trip: Trip, routes: RouteMap, rigHash, hasRig }` | the full tree **plus** the server-resolved drives — the same payload `trips/[id]/page.tsx` hands `TripPlanner`, so both clients render identical drives |
| `GET` | `/api/places` | `SavedPlace[]` | |
| `GET` | `/api/rig` | `RigProfile \| null` | exists |
| `PATCH` | `/api/stops/:id`, `/api/reservations/:id`, `/api/ideas/:id` | `204` | exist |
| `POST` | `/api/ideas/:id/promote`, `/api/legs/:id/reorder`, `/api/routes` | | exist |

`api-client` shape:

```ts
const api = createApiClient({ baseUrl, getAuthHeader?: () => Promise<string | null> });
api.trips.list()            // TripSummary[]
api.trips.get(id)           // TripBundle
api.places.list()           // SavedPlace[]
api.rig.get()               // RigProfile | null
api.stops.patch(id, patch)  // void
api.ideas.patch(id, patch) / api.ideas.promote(id)
api.reservations.patch(id, patch)
```

Errors are `ApiError { status, body }`; a network failure is a thrown
`TypeError` from `fetch`, left as-is. No retries in the client — the screen
decides.

## Screens (v1)

1. **Trips** — the dashboard's three groups, one list. Planning trip first
   and featured. Tap → Trip.
2. **Trip** — masthead (title, dates, open-day count), a horizontal **day
   strip** (the RhythmStrip idea: one cell per day, drive/stay/open colour,
   today highlighted when the trip is live), then the **route list**: legs as
   section headers, stops as rows (name, dates or *Floating*, rating,
   reservation count), **drives between rows** with the same three renderings
   as the web (clean · restricted with amber notices · estimate chip) and a
   **Navigate** button. This list is `routeModel()` from core — the web's
   exact model.
3. **Stop detail** — dates, mini stats, reservations (type tile, name, dates,
   confirmation number if any), ideas (tap to cycle status), **Our take**
   (stars + notes, saved on blur), all through the existing `PATCH` routes.
4. **Rig** — read-only card of the profile in imperial. Editing stays on the
   web in v1.

Not in v1: creating anything, map surfaces, places library beyond a list,
settings, auth UI.

## Phases

| Phase | Deliverable | Gate |
|---|---|---|
| **C0** | `packages/core/planner` with the moved model + first tests; web re-exports; nothing visible changes | web typecheck + all three views render identically |
| **C1** | read endpoints + `api-client` with tests (fake `fetch`) | `curl` the three GETs; client tests green |
| **C2** | `apps/mobile` running in the iOS Simulator with Trips → Trip → Stop detail → Navigate; rate/note persists | screenshot in the simulator; a rating set on the phone shows on the web after reload |
| C3 | Mapbox dev build; corridors from polylines | separate issue |
| C4 | Clerk Expo | after B1 |

## Out of scope (guards)

- Building trips on the phone (creation/deletion of anything).
- Offline persistence, background sync, push notifications.
- Android QA (it may work; it is not tested).
- Reusing `packages/ui` DOM components in RN.
- App Store submission, EAS Build/Submit configuration.
