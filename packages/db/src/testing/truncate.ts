import { sql } from "drizzle-orm";
import { db } from "../index";
import { ideas, legs, reservations, rigs, savedPlaces, stops, trips } from "../schema";

/**
 * The reset between tests: all seven tables, ONE statement, identity reset.
 *
 * This module — unlike ./lifecycle.ts — DOES use the shipped `db` handle, which
 * is why it is a file of its own. `../index` builds its pool at module scope
 * from DATABASE_URL, so importing this is only safe in a vitest WORKER, after
 * `apps/web/src/test/setup.ts` has pointed DATABASE_URL at the run database.
 * setup.ts reaches it through `await import(…)` for exactly that reason; a
 * static import would be hoisted above the assignment and bind the pool to the
 * developer's database instead.
 *
 * Truncate rather than transaction-per-test-and-roll-back: the handler commits
 * on the singleton pool's own connection, so a test cannot own its transaction
 * without an injection point in shipped code. On an empty database this is
 * sub-millisecond.
 */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`truncate table ${trips}, ${legs}, ${stops}, ${ideas}, ${reservations}, ${savedPlaces}, ${rigs} restart identity cascade`,
  );
}
