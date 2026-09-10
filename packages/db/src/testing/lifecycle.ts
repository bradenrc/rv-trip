import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * The run database's lifecycle: probe · create · migrate · drop · reap, plus the
 * Q4 notice. Issue #30 §3/§4.
 *
 * ── THE ONE HARD RULE ──────────────────────────────────────────────────────
 * Nothing in this file may import `../index` (the `@rv-trip/db` barrel). That
 * module builds its `Pool` at MODULE SCOPE from `process.env.DATABASE_URL`
 * (src/index.ts:5-12), and every function here runs in vitest's globalSetup
 * process, where DATABASE_URL still points at the DEVELOPER'S database. An
 * import of the barrel from here would aim `CREATE`/`DROP DATABASE` and the
 * migration at it.
 *
 * That is why `truncateAll` — which DOES use the shipped handle — lives in its
 * own module (`./truncate.ts`) and is reached only from a worker where
 * `apps/web/src/test/setup.ts` has already re-pointed DATABASE_URL at the run
 * database. It is also why globalSetup imports `@rv-trip/db/testing/lifecycle`
 * (this file) rather than the `./testing` barrel, which re-exports both halves.
 */

/** Where the checked-in migrations live: packages/db/drizzle. */
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Every run database is named for the pid that made it, base36. */
const PREFIX = "rvtrip_test_";

function requireDatabaseUrl(url = process.env.DATABASE_URL): string {
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
}

/**
 * `postgres://…/postgres` — the maintenance database, derived from
 * DATABASE_URL by swapping the database name. `CREATE DATABASE` cannot run on
 * the database it is creating, and must not run on the dev one.
 */
export function adminUrlFrom(url?: string): string {
  const parsed = new URL(requireDatabaseUrl(url));
  parsed.pathname = "/postgres";
  return parsed.toString();
}

/** The URL of a run database, derived from DATABASE_URL the same way. */
function runUrlFrom(base: string, name: string): string {
  const parsed = new URL(base);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function nameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/** `postgres://…@localhost:5433/rvtrip` with the credentials taken out. */
function redact(url?: string): string {
  if (!url) return "postgres://…@localhost:5433";
  try {
    const parsed = new URL(url);
    return `postgres://…@${parsed.host}${parsed.pathname}`;
  } catch {
    return "postgres://…@localhost:5433";
  }
}

/**
 * The Q4 notice. Printed once, at the top of a run that found no Postgres —
 * and thrown instead when CI is set, because a green CI run that quietly tested
 * nothing is the failure mode this issue exists to remove.
 */
export const NO_DB_MESSAGE = `API integration tests SKIPPED — no Postgres on ${redact(
  process.env.DATABASE_URL,
)}

  pnpm db:up          # docker compose up -d

These tests are the only machine check on owner scoping and on the
trip bundle's shape. In CI (CI=1) this same condition FAILS the run.`;

/** Can we connect at all? One short-timeout connect, no throw. */
export async function probe(adminUrl: string): Promise<boolean> {
  const pool = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function withAdmin<T>(adminUrl: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/**
 * `CREATE DATABASE rvtrip_test_<pid36> TEMPLATE template0`, then the real
 * `packages/db/drizzle/` migrations. Returns its URL.
 *
 * TEMPLATE template0 rather than the default template1 so nothing a developer
 * left in template1 leaks in — and `drizzle/0000_baseline.sql` qualifies 11
 * identifiers as `"public".…`, which is why the isolation has to be a whole
 * database and cannot be a schema.
 */
export async function createTestDatabase(): Promise<string> {
  const base = requireDatabaseUrl();
  const name = `${PREFIX}${process.pid.toString(36)}`;
  const adminUrl = adminUrlFrom(base);

  await withAdmin(adminUrl, async (pool) => {
    // A crashed run that reused this pid would otherwise collide.
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await pool.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  });

  const url = runUrlFrom(base, name);
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  return url;
}

/** `DROP DATABASE … WITH (FORCE)`. Idempotent, and forces off the pools the
 * finished run may still be holding open. */
export async function dropTestDatabase(url: string): Promise<void> {
  if (!url) return;
  const name = nameFromUrl(url);
  if (!name.startsWith(PREFIX)) {
    throw new Error(`refusing to drop "${name}" — not a ${PREFIX}* database`);
  }
  await withAdmin(adminUrlFrom(url), async (pool) => {
    await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and is not ours; ESRCH means it is gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Drop every `rvtrip_test_*` whose encoded pid is no longer alive. A crashed
 * run leaves one orphan named after a dead pid; this is what keeps a worktree
 * walk from accumulating databases. Returns how many were dropped.
 */
export async function reapOrphans(): Promise<number> {
  const adminUrl = adminUrlFrom();
  return withAdmin(adminUrl, async (pool) => {
    const { rows } = await pool.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE $1",
      [`${PREFIX}%`],
    );
    let dropped = 0;
    for (const { datname } of rows) {
      const pid = Number.parseInt(datname.slice(PREFIX.length), 36);
      if (!Number.isFinite(pid) || pid === process.pid || pidIsAlive(pid)) continue;
      await pool.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
      dropped += 1;
    }
    return dropped;
  });
}
