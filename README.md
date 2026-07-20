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
- `packages/core` — the trip grammar: domain types + Zod schemas, the
  `deriveDays` calendar projection (pure, unit-tested), and map provider
  interfaces (Mapbox/Google, stubbed locally).
- `packages/db` — Drizzle schema + local Postgres client + queries + seed.

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
(Drizzle Studio), `pnpm db:down`.

## Local-dev accommodations (seams to the cloud target)

- **DB:** local Postgres in Docker instead of Neon — same Drizzle schema.
- **Auth:** a dev-stub owner (`dev-user`) instead of Clerk — drops into the
  same middleware seam later.
- **Maps:** provider interfaces stubbed locally; real Mapbox/Google keys when
  live routing/places are needed.
