import "./load-env";
import { Pool } from "pg";

/**
 * WIPE the database so the one v2 migration can apply (#110 · docs/design/110
 * §8, Q8 A — pre-production, nothing is carried over).
 *
 * `drizzle/` now holds a single `0000_v2`. A database whose drizzle journal
 * still lists the old 0000–0009 would try to apply 0000_v2 on top of the types
 * and tables it already has and fail — so the database is emptied first:
 * the `drizzle` schema (the migration journal) and `public` (every table and
 * enum) are dropped, and an empty `public` is recreated. Then:
 *
 *   pnpm --filter @rv-trip/db reset --yes
 *   pnpm db:migrate
 *   pnpm db:seed          (and `pnpm db:reown` to put the seeds on a household)
 *
 * It prints the TARGET HOST before anything else and refuses to run without
 * `--yes`, because the same DATABASE_URL_UNPOOLED/DATABASE_URL precedence the
 * migrator uses (drizzle.config.ts) can point at Neon.
 */

const RESET_STATEMENTS = [
  `DROP SCHEMA IF EXISTS "drizzle" CASCADE`,
  `DROP SCHEMA IF EXISTS "public" CASCADE`,
  `CREATE SCHEMA "public"`,
] as const;

/** `host:port/database` — never the credentials. */
function resetTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("reset: DATABASE_URL is not set (see .env.example)");
    return 1;
  }
  console.log(`reset: target ${resetTarget(url)}`);
  if (!process.argv.slice(2).includes("--yes")) {
    console.error(
      "reset: refusing — this DROPS the public and drizzle schemas (every table, every row). Re-run with --yes.",
    );
    return 1;
  }

  const pool = new Pool({ connectionString: url });
  try {
    for (const statement of RESET_STATEMENTS) {
      await pool.query(statement);
      console.log(`reset: ${statement}`);
    }
  } finally {
    await pool.end();
  }
  console.log("reset: done — now run `pnpm db:migrate` and `pnpm db:seed`.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
