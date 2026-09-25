import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The W0 reset's repo-shape acceptance (#110 · docs/design/110 §5/§8/§9).
 * Wiring, asserted against the SOURCE TEXT of the real files the way
 * prefs-account.test.ts does — plus one real execution: reset.ts is spawned and
 * must refuse without `--yes`. That the migration APPLIES is proved by
 * apps/web's suite, which migrates a fresh database from packages/db/drizzle.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("packages/db/drizzle — one clean migration set", () => {
  it("holds exactly one .sql migration, and its journal exactly one entry", () => {
    const sql = readdirSync(join(REPO, "packages/db/drizzle")).filter((f) => f.endsWith(".sql"));
    expect(sql).toEqual(["0000_v2.sql"]);
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => e.tag)).toEqual(["0000_v2"]);
  });
});

describe("packages/db/src/schema.ts — v2 (§5)", () => {
  const schema = flat(code(read("packages/db/src/schema.ts")));

  it("declares the three new enums and the renamed status", () => {
    expect(schema).toContain('pgEnum("travel_mode", ["drive", "fly", "ferry"])');
    expect(schema).toContain('pgEnum("lodging_kind", ["hotel", "friends", "airbnb", "campground"])');
    expect(schema).toContain('pgEnum("save_anchor", ["place", "area", "pin"])');
    expect(schema).toContain('pgEnum("save_status", ["want", "been"])');
    expect(schema).toContain('pgEnum("change_entity", ["stop", "idea", "reservation", "save"])');
    expect(schema).not.toContain("saved_place");
  });

  it("declares travel_segments, destinations (unique per household + place) and saves", () => {
    expect(schema).toContain('pgTable( "travel_segments"');
    expect(schema).toContain('pgTable( "destinations"');
    expect(schema).toContain('unique("destinations_owner_place_uq").on(t.ownerId, t.googlePlaceId)');
    expect(schema).toContain('pgTable( "saves"');
  });

  it("hangs every reservation on exactly one parent", () => {
    expect(schema).toContain("num_nonnulls(${t.stopId}, ${t.segmentId}) = 1");
  });

  it("gives trips their three plain defaults", () => {
    expect(schema).toContain('defaultMode: travelMode("default_mode").notNull().default("drive")');
    expect(schema).toContain('lodgingDefault: lodgingKind("lodging_default"),');
    expect(schema).toContain('rigOn: boolean("rig_on").notNull().default(true)');
  });
});

describe("the reset script (§8)", () => {
  it("baseline.ts is gone, and nothing still points at it", () => {
    expect(existsSync(join(REPO, "packages/db/src/baseline.ts"))).toBe(false);
    expect(read("package.json")).not.toContain("baseline");
    expect(read("packages/db/package.json")).not.toContain("baseline");
  });

  it("reset.ts prints its target and exits non-zero without --yes", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgres://nobody:secret@example.invalid:6543/nope" };
    delete env.DATABASE_URL_UNPOOLED;
    let status = 0;
    let stdout = "";
    try {
      execFileSync(join(REPO, "packages/db/node_modules/.bin/tsx"), ["src/reset.ts"], {
        cwd: join(REPO, "packages/db"),
        env,
        stdio: "pipe",
      });
    } catch (err) {
      const e = err as { status: number; stdout: Buffer };
      status = e.status;
      stdout = e.stdout.toString();
    }
    expect(status).not.toBe(0);
    expect(stdout).toContain("reset: target example.invalid:6543/nope");
    expect(stdout).not.toContain("secret");
  }, 30_000);
});

describe('"drive" is no longer a DayKind (§4)', () => {
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...sources(p));
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("appears nowhere in packages/ or apps/ as a day kind", () => {
    const hits = [...sources(join(REPO, "packages")), ...sources(join(REPO, "apps"))].filter(
      (f) =>
        !f.endsWith("w0-reset.test.ts") &&
        /kind\s*===?\s*["']drive["']|kind:\s*["']drive["']|DayKind\s*=[^;]*["']drive["']|dayKindColor\(["']drive["']\)/.test(
          readFileSync(f, "utf8"),
        ),
    );
    expect(hits).toEqual([]);
  });
});
