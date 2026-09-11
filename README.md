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
pnpm db:migrate              # build the schema from packages/db/drizzle/
pnpm db:seed                 # load a sample 4-week trip
pnpm dev                     # http://localhost:3000
```

Other scripts: `pnpm test` (core logic), `pnpm typecheck`, `pnpm db:studio`
(Drizzle Studio), `pnpm db:down`, `pnpm backfill:places` (geocode every
coordless stop and saved place — needs `GOOGLE_API_KEY`; the in-app equivalent
is the Locate button beside the map's "N unmapped" count). Phone:
`pnpm --filter @rv-trip/mobile ios` (a native dev client on the iOS
Simulator, against the running web app — the first build is a ~4–8 min Xcode
build; one-time Xcode + CocoaPods setup in `apps/mobile/README.md`).

### Schema changes

The checked-in migrations in `packages/db/drizzle/` are the schema's source of
truth — every environment (a teammate, CI, Neon) reaches the current schema by
running them, never by pushing from a laptop. After editing
`packages/db/src/schema.ts`:

```bash
pnpm db:generate             # writes the next drizzle/NNNN_*.sql — commit it
pnpm db:migrate              # applies it locally
```

CI applies the migrations to an empty Postgres, seeds on top, and fails if
`schema.ts` has drifted from them (`db:generate` would produce a new file).
`pnpm db:push` still works as a quick local experiment, but a pushed change
that is not also generated will fail that check.

**Have a local DB from before migrations existed?** (built with `db:push`;
`db:migrate` fails on it with "relation already exists"). Either reset it —
`pnpm db:down && rm -rf pgdata && pnpm db:up && pnpm db:migrate && pnpm db:seed`
— or keep your data: `pnpm db:baseline` records the existing migrations as
already applied without running them, and `db:migrate` picks up from there.
Only do that when the schema already matches `schema.ts`.

Neon: the Vercel integration provides a pooled `DATABASE_URL` for the app and
`DATABASE_URL_UNPOOLED` for DDL; `db:migrate` uses the unpooled one when it is
set (see `.env.example`). Local docker needs only `DATABASE_URL`.

Where things stand: `docs/audit/2026-09-08-project-audit.md` (feature matrix,
gaps, the roadmap on [the board](https://github.com/users/bradenrc/projects/6)).

## Local-dev accommodations (seams to the cloud target)

- **DB:** local Postgres in Docker instead of Neon — same Drizzle schema.
- **Auth:** Clerk when both `CLERK_*` keys are set (every page needs a session,
  `/api/*` answers 401 without one, mobile clients send the session JWT as
  `Authorization: Bearer`); without keys the app runs as the seeded
  `dev-user` stub. Keep local keys in `apps/web/.env.development.local` so the
  pipeline's walk worktrees (which copy `.env.local`) stay key-free. To see the
  seed data as your real account: `pnpm db:reown <your Clerk user id>`.
- **Maps:** Mapbox GL display · HERE RV-safe routing · Google Maps handoff are
  live with keys in `.env` (see `.env.example`); without keys every map
  degrades to a placeholder and every drive to a labelled estimate. Google
  Places search is still the stub (#23).
