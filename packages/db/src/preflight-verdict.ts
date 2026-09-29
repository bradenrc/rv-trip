/**
 * The pre-v2 baseline preflight's DECISION (#132 i3 · #120 · Q3 · B) — pure,
 * no env load, no connection, no exit, so apps/web's vitest can import it.
 * The entrypoint that reads the database is ./preflight.ts.
 *
 * drizzle-kit records each applied migration's journal `when` as
 * `drizzle.__drizzle_migrations.created_at` and applies everything newer than
 * the max. A database whose journal predates the 0000_v2 baseline would re-run
 * 0000_v2 on top of the types it already has and die on a raw 42710 — so the
 * preflight refuses first, with the remedy in the message.
 */

export type AppliedMigrations = {
  count: number;
  /** max(created_at), in epoch ms; null when the table is empty. */
  maxCreatedAt: number | null;
};

export type PreflightInput = {
  /** null when drizzle.__drizzle_migrations does not exist (a fresh database). */
  applied: AppliedMigrations | null;
  /** The `when` of the journal entry tagged 0000_v2. */
  baselineWhen: number;
  env: {
    DATABASE_URL_UNPOOLED?: string;
    DATABASE_URL?: string;
    VERCEL_ENV?: string;
    VERCEL_GIT_COMMIT_REF?: string;
  };
};

export type PreflightVerdict = { ok: true } | { ok: false; message: string };

/** `host:port/database` — never the credentials (reset.ts's resetTarget idiom). */
export function preflightTarget(url: string | undefined): string {
  if (!url) return "(DATABASE_URL unset)";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export function preflightVerdict({ applied, baselineWhen, env }: PreflightInput): PreflightVerdict {
  if (!applied || applied.count === 0 || applied.maxCreatedAt === null) return { ok: true };
  if (applied.maxCreatedAt >= baselineWhen) return { ok: true };

  const baselineDate = new Date(baselineWhen).toISOString().slice(0, 10);
  if (env.VERCEL_ENV === "preview") {
    const branch = env.VERCEL_GIT_COMMIT_REF
      ? `preview/${env.VERCEL_GIT_COMMIT_REF}`
      : "this preview's Neon branch (preview/<git-branch>)";
    return {
      ok: false,
      message: `${branch} predates the v2 baseline (${baselineDate}). Delete that Neon branch and redeploy. It re-forks from production.`,
    };
  }
  const target = preflightTarget(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL);
  return {
    ok: false,
    message: `${target} predates the v2 baseline (${baselineDate}). Reset it and migrate again: pnpm db:reset --yes, then pnpm db:migrate.`,
  };
}
