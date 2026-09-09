import "./load-env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * Mark the checked-in migrations as already applied — WITHOUT running them.
 *
 * For a database that was built with `drizzle-kit push` before migrations
 * existed (issue #27): its schema already matches, so `db:migrate` would try to
 * re-create every table and fail. This records the same rows the drizzle
 * migrator writes (sha256 of each migration's SQL + the journal timestamp, see
 * drizzle-orm/migrator readMigrationFiles), so the next `db:migrate` applies
 * only what is genuinely new. Idempotent: rows already present are skipped.
 *
 * Never run this against a database whose schema does NOT already match — it
 * would silently skip the migrations that database actually needs. Fresh
 * databases just run `db:migrate`.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "..", "drizzle");

type Journal = { entries: { idx: number; when: number; tag: string }[] };

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as Journal;

  const pool = new Pool({ connectionString: url });
  try {
    // Same DDL the drizzle migrator uses; a no-op when it already exists.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    );
    const { rows } = await pool.query<{ hash: string }>(
      `SELECT hash FROM "drizzle"."__drizzle_migrations"`,
    );
    const applied = new Set(rows.map((r) => r.hash));

    let marked = 0;
    for (const entry of journal.entries) {
      const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      if (applied.has(hash)) {
        console.log(`already recorded  ${entry.tag}`);
        continue;
      }
      await pool.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [hash, entry.when],
      );
      console.log(`marked as applied ${entry.tag}`);
      marked++;
    }
    console.log(`baseline: ${marked} marked, ${journal.entries.length - marked} already recorded.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
