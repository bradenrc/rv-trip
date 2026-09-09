import "./load-env";
import { eq, getTableName } from "drizzle-orm";
import { db, schema } from "./index";

/**
 * Re-own the seed data (issue #26): move every row owned by `dev-user` — or by
 * `--from <id>` — to the Clerk user id given as the first argument, so a real
 * signed-in account sees the sample trips, places and rig. Owner-scoped tables
 * only; children (legs, stops, …) hang off trips and need nothing.
 *
 *   pnpm db:reown user_2abc…            # dev-user → user_2abc…
 *   pnpm db:reown user_2abc… --from user_1old…
 */
async function main() {
  const [to, flag, fromArg] = process.argv.slice(2);
  if (!to) {
    console.error("usage: pnpm db:reown <clerkUserId> [--from <ownerId>]");
    process.exit(2);
  }
  const from = flag === "--from" && fromArg ? fromArg : "dev-user";
  const tables = [schema.trips, schema.savedPlaces, schema.rigs] as const;
  for (const t of tables) {
    const rows = await db.update(t).set({ ownerId: to }).where(eq(t.ownerId, from)).returning({ id: t.id });
    console.log(`${getTableName(t)}: ${rows.length} re-owned ${from} → ${to}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
