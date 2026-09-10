// Import FIRST: this is packages/db's own repo-root `.env` loader, and it must
// populate DATABASE_URL before ./testing/lifecycle evaluates (its NO_DB_MESSAGE
// names the address). ESM evaluates imports in source order. dotenv never
// overwrites a value that is already set, so turbo's passThroughEnv still wins.
import "@rv-trip/db/load-env";
import {
  NO_DB_MESSAGE,
  adminUrlFrom,
  createTestDatabase,
  dropTestDatabase,
  probe,
  reapOrphans,
} from "@rv-trip/db/testing/lifecycle";
import type { GlobalSetupContext } from "vitest/node";

/**
 * Runs ONCE per run, in its own process (issue #30 §3).
 *
 * It imports `@rv-trip/db/testing/lifecycle` — NOT the `./testing` barrel.
 * The barrel re-exports the fixtures and `truncateAll`, which reach
 * packages/db/src/index.ts, whose module-scope pool would bind to the
 * DEVELOPER'S DATABASE_URL here (and whose `throw` on an unset one would turn
 * the Q4 skip into a module-scope crash).
 */
export default async function setup({ provide }: GlobalSetupContext) {
  const base = process.env.DATABASE_URL;
  // An unset DATABASE_URL is the same verdict as an unreachable one — never a
  // crash, because that is the failure mode Q4 = A exists to avoid.
  const reachable = base ? await probe(adminUrlFrom(base)) : false;

  if (!reachable) {
    if (process.env.CI) throw new Error(NO_DB_MESSAGE); // CI cannot lie
    console.warn(NO_DB_MESSAGE);
    provide("databaseUrl", ""); // the sentinel — see setup.ts and db.ts
    return;
  }

  await reapOrphans(); // rvtrip_test_* whose pid is gone
  const url = await createTestDatabase(); // CREATE + drizzle migrate()
  provide("databaseUrl", url);

  // A CREATE or a migrate failure is NEVER skipped, either way: the database
  // answered, so it is a broken migration or a permissions problem — the exact
  // class of failure this issue exists to surface.
  return async () => {
    await dropTestDatabase(url); // DROP … WITH (FORCE)
  };
}
