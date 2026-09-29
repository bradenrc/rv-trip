import "./load-env";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { preflightVerdict, preflightTarget, type AppliedMigrations } from "./preflight-verdict";

/**
 * The pre-v2 baseline preflight (#132 i3 · #120 · docs/design/132 §3). Runs
 * before `drizzle-kit migrate` (package.json `migrate`), so every Vercel build,
 * `pnpm db:migrate` and the walk's migrate pass through it.
 *
 * READ-ONLY: it looks at drizzle.__drizzle_migrations and never writes. The
 * decision is ./preflight-verdict.ts (pure, unit-tested from apps/web); this
 * file is only the entrypoint that feeds it.
 */

const BASELINE_TAG = "0000_v2";

/** The baseline's `when`, read from the journal by tag — never hardcoded. */
function baselineWhen(): number {
  const journalPath = join(dirname(fileURLToPath(import.meta.url)), "../drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.tag === BASELINE_TAG);
  if (!entry) throw new Error(`preflight: no ${BASELINE_TAG} entry in ${journalPath}`);
  return entry.when;
}

async function readApplied(url: string): Promise<AppliedMigrations | null> {
  const pool = new Pool({ connectionString: url });
  try {
    const exists = await pool.query<{ t: string | null }>(
      `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t`,
    );
    if (!exists.rows[0]?.t) return null;
    // created_at is a bigint: pg hands it back as a string.
    const { rows } = await pool.query<{ count: string; max: string | null }>(
      `SELECT count(*)::text AS count, max(created_at)::text AS max FROM drizzle.__drizzle_migrations`,
    );
    return { count: Number(rows[0].count), maxCreatedAt: rows[0].max === null ? null : Number(rows[0].max) };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("preflight: DATABASE_URL is not set (see .env.example)");
    return 1;
  }
  const verdict = preflightVerdict({
    applied: await readApplied(url),
    baselineWhen: baselineWhen(),
    env: process.env,
  });
  if (!verdict.ok) {
    console.error(`preflight: ${verdict.message}`);
    return 1;
  }
  console.log(`preflight: ${preflightTarget(url)} is at or past the v2 baseline — migrating.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
