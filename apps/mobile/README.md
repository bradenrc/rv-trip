# RV Trip Hub — mobile (Expo, iOS-first)

The phone half of "plan on laptop, glance on phone". Design:
`docs/superpowers/specs/2026-09-08-native-app-design.md`.

It imports `@rv-trip/core` verbatim (the trip grammar, the planner models,
the typed API client, the colour tokens) and talks **only** to the web app's
REST API — never to the database or a map vendor directly.

## Run it (Expo Go, no native build)

```bash
pnpm dev                       # the web app + API on http://localhost:3000 (from the repo root)
pnpm --filter @rv-trip/mobile ios   # Expo dev server; installs/opens Expo Go on the booted iOS Simulator
```

The simulator reaches the Mac's `localhost`. A physical phone needs the Mac's
LAN address: create `apps/mobile/.env.local` with
`EXPO_PUBLIC_API_URL=http://192.168.x.y:3000`.

## What's here (v1)

- `app/index.tsx` — Trips (planning / upcoming / traveled)
- `app/trips/[id]/index.tsx` — the trip: day strip + route list with drives and Navigate
- `app/trips/[id]/stops/[stopId].tsx` — stop detail: reservations, ideas (tap to cycle), rating + notes (persist)
- `app/rig.tsx` — the rig, read-only
- `src/api.ts` · `src/store.ts` · `src/theme.ts` · `src/ui.tsx`

Not in v1: creating anything, in-app maps (#32), sign-in (#33).
