import "./load-env";
import { eq, getTableName } from "drizzle-orm";
import { db, schema } from "./index";

/**
 * Re-own the seed data (issue #26): move every row owned by the dev household —
 * or by `--from <id>` — to the owner id given as the first argument, so a real
 * signed-in account sees the sample trips, places and rig. Owner-scoped tables
 * only; children (legs, stops, …) hang off trips and need nothing.
 *
 *   pnpm db:reown hh_2abc…            # dev-household → hh_2abc…
 *   pnpm db:reown hh_2abc… --from hh_1old…
 *
 * FOUR tables, not three (#77 · docs/design/81 §2). `user_prefs` carries
 * `owner_id` too — as its primary key — and an account re-owned without it
 * silently loses the theme, units and map style it had chosen. The same four
 * are what migration 0007's backfill repoints.
 *
 * Note the ids are HOUSEHOLD ids from #77 on, not Clerk user ids: `owner_id`
 * answers to `getOwner()`, and `getOwner()` answers the household.
 */
async function main() {
  const [to, flag, fromArg] = process.argv.slice(2);
  if (!to) {
    console.error("usage: pnpm db:reown <householdId> [--from <ownerId>]");
    process.exit(2);
  }
  const from = flag === "--from" && fromArg ? fromArg : "dev-household";
  const tables = [schema.trips, schema.savedPlaces, schema.rigs, schema.userPrefs] as const;
  for (const t of tables) {
    // `ownerId`, not `id`: user_prefs has no surrogate key — its owner IS the
    // primary key — and it is the one column all four tables share.
    const rows = await db.update(t).set({ ownerId: to }).where(eq(t.ownerId, from)).returning({ ownerId: t.ownerId });
    console.log(`${getTableName(t)}: ${rows.length} re-owned ${from} → ${to}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
