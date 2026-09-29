import { describe, expect, it } from "vitest";
import { preflightVerdict } from "@rv-trip/db/preflight";

/**
 * #132 i3 (#120 · Q3 · B): the pre-v2 baseline preflight that runs before
 * `drizzle-kit migrate`. Only the pure decision is tested here — importing
 * `@rv-trip/db/preflight` must never open a connection or exit (the entrypoint
 * lives in packages/db/src/preflight.ts, a separate module).
 */

// drizzle/meta/_journal.json → entries[tag = "0000_v2"].when (2026-09-25T14:28Z).
const BASELINE = 1790346498719;
const LOCAL_URL = "postgres://rvtrip:s3cret-pw@db.example.test:5433/rvtrip_walk";

describe("preflightVerdict", () => {
  it("passes a database with no drizzle journal (fresh DB)", () => {
    expect(preflightVerdict({ applied: null, baselineWhen: BASELINE, env: { DATABASE_URL: LOCAL_URL } })).toEqual({
      ok: true,
    });
  });

  it("passes an empty journal", () => {
    expect(
      preflightVerdict({
        applied: { count: 0, maxCreatedAt: null },
        baselineWhen: BASELINE,
        env: { DATABASE_URL: LOCAL_URL },
      }),
    ).toEqual({ ok: true });
  });

  it("passes when the newest applied migration IS the baseline", () => {
    expect(
      preflightVerdict({
        applied: { count: 1, maxCreatedAt: BASELINE },
        baselineWhen: BASELINE,
        env: { DATABASE_URL: LOCAL_URL },
      }),
    ).toEqual({ ok: true });
  });

  it("passes when the newest applied migration is past the baseline", () => {
    expect(
      preflightVerdict({
        applied: { count: 5, maxCreatedAt: BASELINE + 167_367_000 },
        baselineWhen: BASELINE,
        env: { DATABASE_URL: LOCAL_URL },
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a pre-v2 preview DB, naming its Neon branch", () => {
    expect(
      preflightVerdict({
        applied: { count: 10, maxCreatedAt: BASELINE - 1 },
        baselineWhen: BASELINE,
        env: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/86-walk-sha-port", DATABASE_URL: LOCAL_URL },
      }),
    ).toEqual({
      ok: false,
      message:
        "preview/fix/86-walk-sha-port predates the v2 baseline (2026-09-25). Delete that Neon branch and redeploy. It re-forks from production.",
    });
  });

  it("refuses a pre-v2 preview DB with no git ref", () => {
    expect(
      preflightVerdict({
        applied: { count: 10, maxCreatedAt: BASELINE - 1 },
        baselineWhen: BASELINE,
        env: { VERCEL_ENV: "preview", DATABASE_URL: LOCAL_URL },
      }),
    ).toEqual({
      ok: false,
      message:
        "this preview's Neon branch (preview/<git-branch>) predates the v2 baseline (2026-09-25). Delete that Neon branch and redeploy. It re-forks from production.",
    });
  });

  it("refuses a pre-v2 local DB, naming host:port/database and never the credentials", () => {
    const verdict = preflightVerdict({
      applied: { count: 10, maxCreatedAt: BASELINE - 1 },
      baselineWhen: BASELINE,
      env: { DATABASE_URL_UNPOOLED: LOCAL_URL, DATABASE_URL: "postgres://other:pw@pooled.example.test/x" },
    });
    expect(verdict).toEqual({
      ok: false,
      message:
        "db.example.test:5433/rvtrip_walk predates the v2 baseline (2026-09-25). Reset it and migrate again: pnpm db:reset --yes, then pnpm db:migrate.",
    });
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.message).not.toContain("s3cret-pw");
    expect(verdict.message).not.toContain("rvtrip:");
  });
});
