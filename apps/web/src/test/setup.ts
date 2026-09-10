import { beforeEach, inject, vi } from "vitest";

/**
 * Runs per test FILE, in the worker, before that file's own imports evaluate —
 * the only place packages/db's module singleton can still be steered
 * (issue #30 §3).
 */

/** Q5 = A: frozen, so every value `deriveTripStatus` derives is a constant. */
export const PINNED_NOW = "2026-08-15T12:00:00Z";

/**
 * Where DATABASE_URL points when there is no Postgres. A skipped file still
 * EVALUATES its imports, and packages/db/src/index.ts:6-8 throws at module
 * scope when DATABASE_URL is unset — so an unset value turns "skipped" into
 * "errored". `new Pool()` does not connect eagerly, so a placeholder is
 * harmless. It is deliberately NOT the developer's URL: no test ever names the
 * dev database in a connection string (DoD #5).
 */
const PLACEHOLDER_URL = "postgres://rvtrip:rvtrip@127.0.0.1:1/rvtrip_test_placeholder";

const url = inject("databaseUrl");
process.env.DATABASE_URL = url || PLACEHOLDER_URL;

// Q5: freeze Date ONLY. `vi.useFakeTimers()` with its default toFake list also
// fakes setTimeout/setInterval, which pg uses for its connection and query
// timeouts — a full fake clock hangs the pool.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(PINNED_NOW));

// Q3: no Clerk keys are set, and `clerkEnabled()` is checked per call, so the
// REAL `getOwner()` returns DEV_OWNER. Nothing is mocked (owner.ts:9-31).
beforeEach(async () => {
  vi.setSystemTime(new Date(PINNED_NOW));
  if (!url) return;
  // Dynamic, and after the assignment above: a static import would be hoisted
  // above it, and packages/db's module-scope pool would bind to the
  // DEVELOPER'S DATABASE_URL — truncating their data.
  const { truncateAll } = await import("@rv-trip/db/testing");
  await truncateAll();
});
