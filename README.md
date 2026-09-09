# RV Trip Hub

A personal trip hub for long RV / road trips (weeks, not days). The core is a
**trip grammar** — legs, stops, drive-days vs stay-days, month-at-a-glance —
that stays legible at 4-week scale. See
[`docs/superpowers/specs`](docs/superpowers/specs) for the design.

**Status:** local-dev-first MVP scaffold. Long-term target is Vercel + Neon +
Clerk with a shared core the native (Expo) app will reuse. See the spec.

## Stack

- **Turborepo** monorepo, TypeScript throughout.
- `apps/web` — Next.js 16 (App Router) + Tailwind 4. UI + API route handlers.
- `apps/mobile` — Expo (iOS-first) glance app; talks only to the web app's
  REST API through `@rv-trip/core/api-client`. See `apps/mobile/README.md`.
- `packages/core` — the trip grammar: domain types + Zod schemas, the
  `deriveDays` calendar projection, the planner view-models (`planner/`), the
  typed API client (`api-client/`), colour tokens as data (`theme/`), and the
  routing/places providers (HERE truck routing; Google Places is still the
  stub) — all pure, unit-tested.
- `packages/db` — Drizzle schema + local Postgres client + queries + seed.
- `packages/ui` — the DOM design-system components (`@rv-trip/ui`).

## Local dev

Requires Node (see `.nvmrc`), pnpm, and Docker.

```bash
pnpm install
cp .env.example .env         # local Postgres URL (already set for docker compose)
pnpm db:up                   # start local Postgres (docker, host port 5433)
pnpm db:push                 # create the schema
pnpm db:seed                 # load a sample 4-week trip
pnpm dev                     # http://localhost:3000
```

Other scripts: `pnpm test` (core logic), `pnpm typecheck`, `pnpm db:studio`
(Drizzle Studio), `pnpm db:down`, `pnpm backfill:places` (geocode every
coordless stop and saved place — needs `GOOGLE_API_KEY`; the in-app equivalent
is the Locate button beside the map's "N unmapped" count). Phone:
`pnpm --filter @rv-trip/mobile ios` (Expo Go on the iOS Simulator, against the
running web app).

Where things stand: `docs/audit/2026-09-08-project-audit.md` (feature matrix,
gaps, the roadmap on [the board](https://github.com/users/bradenrc/projects/6)).

## Local-dev accommodations (seams to the cloud target)

- **DB:** local Postgres in Docker instead of Neon — same Drizzle schema.
- **Auth:** a dev-stub owner (`dev-user`) instead of Clerk — drops into the
  same middleware seam later.
- **Maps:** Mapbox GL display · HERE RV-safe routing · Google Maps handoff are
  live with keys in `.env` (see `.env.example`); without keys every map
  degrades to a placeholder and every drive to a labelled estimate. Google
  Places search is still the stub (#23).
