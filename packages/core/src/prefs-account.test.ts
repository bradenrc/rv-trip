import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import type { UserPrefs } from "./domain/prefs";

/**
 * Preferences that follow the account (issue #45, item 4 · issue #38).
 *
 * Item 4 is a seam in four parts — a `user_prefs` table + its migration, a
 * `/api/prefs` GET+PUT, a write-through inside `lib/pref.ts`, and a `<PrefSync/>`
 * that adopts the row after first paint. Two of those parts are real logic and
 * are EXECUTED here:
 *
 *   · the LOCAL ⇄ REMOTE translation (`src/domain/prefs.ts`) — covered in
 *     `src/domain/prefs.test.ts`, where it lives;
 *   · `hydrate()` itself — `apps/web/src/lib/pref.ts` is imported by absolute
 *     file URL and called against a stub `localStorage`. It is a "use client"
 *     module, but nothing it needs at import time is a browser API, so the real
 *     function runs here rather than being grepped.
 *
 * The rest is wiring — a Drizzle table, a route handler, a JSX mount — and, as
 * `web-shell.test.ts` and `pwa.test.ts` already do for `apps/web`, it is asserted
 * against the SOURCE TEXT of the real files. That is the honest limit of this
 * file: it proves the seam is wired as designed, not that a round-trip through
 * Postgres happened. **The DB round-trip and the after-paint GET are the walk's
 * job.**
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

/** Source with `//` and block comments stripped — a claim about code must not
 * be satisfied by a comment that merely mentions the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
/** Collapse whitespace so a hard-wrapped call still matches. */
const flat = (s: string) => s.replace(/\s+/g, " ");

const schema = read("packages/db/src/schema.ts");
const queries = read("packages/db/src/queries.ts");
const mutations = read("packages/db/src/mutations.ts");
const route = read("apps/web/src/app/api/prefs/route.ts");
const rigRoute = read("apps/web/src/app/api/rig/route.ts");
const prefLib = read("apps/web/src/lib/pref.ts");
const prefSync = read("apps/web/src/components/nav/PrefSync.tsx");
const layout = read("apps/web/src/app/layout.tsx");

const DRIZZLE = "packages/db/drizzle";

// ── 1 · the migration ───────────────────────────────────────────────────────

describe("the generated migration", () => {
  const files = readdirSync(join(REPO, DRIZZLE)).filter((f) => f.endsWith(".sql"));
  const creators = files.filter((f) => /CREATE TABLE "user_prefs"/.test(read(`${DRIZZLE}/${f}`)));

  it("exists — exactly one SQL file creates user_prefs", () => {
    expect(creators).toHaveLength(1);
  });

  it("is the next migration in sequence", () => {
    expect(creators[0]).toMatch(/^0003_/);
  });

  it("makes owner_id the PRIMARY KEY", () => {
    expect(read(`${DRIZZLE}/${creators[0]}`)).toContain('"owner_id" text PRIMARY KEY NOT NULL');
  });

  it("leaves every preference column nullable — null means 'never chosen'", () => {
    const sql = read(`${DRIZZLE}/${creators[0]}`);
    for (const col of ['"theme" text', '"units" text', '"map_style" text', '"track_costs" boolean'])
      expect(sql, col).toContain(`\t${col},\n`);
    // ...and none of them picked up a NOT NULL or a DEFAULT on the way.
    for (const line of sql.split("\n").filter((l) => /theme|units|map_style|track_costs/.test(l)))
      expect(line).not.toMatch(/NOT NULL|DEFAULT/);
  });

  it("keeps updated_at NOT NULL with a default — a row always has a last word", () => {
    expect(read(`${DRIZZLE}/${creators[0]}`)).toContain(
      '"updated_at" timestamp with time zone DEFAULT now() NOT NULL',
    );
  });

  it("creates nothing else — one table, no enum, no index", () => {
    const sql = read(`${DRIZZLE}/${creators[0]}`);
    expect(sql.match(/CREATE /g) ?? []).toHaveLength(1);
  });

  it("is registered in the journal under its own file name", () => {
    const journal = JSON.parse(read(`${DRIZZLE}/meta/_journal.json`)) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const tag = creators[0]!.replace(/\.sql$/, "");
    const entry = journal.entries.find((e) => e.tag === tag);
    expect(entry, `no journal entry tagged ${tag}`).toBeTruthy();
    expect(entry!.idx).toBe(3);
    // Every journal entry has a file, and every file has a journal entry.
    expect(journal.entries.map((e) => `${e.tag}.sql`).sort()).toEqual([...files].sort());
    expect(readdirSync(join(REPO, DRIZZLE, "meta"))).toContain(`${entry!.idx.toString().padStart(4, "0")}_snapshot.json`);
  });
});

// ── 2 · the table ───────────────────────────────────────────────────────────

describe("packages/db/src/schema.ts — userPrefs", () => {
  const table = flat(code(schema).split('pgTable("user_prefs"')[1] ?? "");

  it("declares the ninth table", () => {
    expect(code(schema)).toContain('export const userPrefs = pgTable("user_prefs", {');
  });

  it("keys on owner_id directly — no surrogate id", () => {
    expect(table).toContain('ownerId: text("owner_id").primaryKey()');
    expect(table.slice(0, table.indexOf("});"))).not.toContain("uuid(");
  });

  it("declares the four preference columns as bare, nullable columns", () => {
    expect(table).toContain('theme: text("theme")');
    expect(table).toContain('units: text("units")');
    expect(table).toContain('mapStyle: text("map_style")');
    expect(table).toContain('trackCosts: boolean("track_costs")');
    const body = table.slice(0, table.indexOf("});"));
    for (const m of body.match(/(theme|units|map_style|track_costs)"\)[^,]*/g) ?? [])
      expect(m).not.toMatch(/notNull|default/);
  });

  it("stamps updated_at the way every other table does", () => {
    expect(table).toContain(
      'updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()',
    );
  });

  it("adds no pgEnum — a preference vocabulary must not need an ALTER TYPE", () => {
    // The six the base sha already had: reservation_type, idea_status,
    // trip_status, saved_place_status, rig_type, route_source — plus
    // idea_category (#80), which IS a vocabulary the product speaks. A
    // preference is not, and that is what this guard is about.
    expect((code(schema).match(/pgEnum\(/g) ?? []).length).toBe(7);
    for (const name of ["theme", "units", "map_style", "track_costs"])
      expect(code(schema)).not.toContain(`pgEnum("${name}"`);
  });
});

// ── 3 · the queries ─────────────────────────────────────────────────────────

describe("packages/db — getPrefsByOwner / upsertPrefs", () => {
  it("reads scoped by ownerId and tolerates no row at all", () => {
    const q = flat(code(queries));
    expect(q).toContain(
      "export async function getPrefsByOwner(ownerId: string): Promise<UserPrefs | null>",
    );
    expect(q).toContain("db.query.userPrefs.findFirst({ where: eq(userPrefs.ownerId, ownerId) })");
    expect(q).toContain("return row ? mapPrefsRow(row) : null;");
  });

  it("hands the timestamp over as an ISO string, not a Date", () => {
    expect(flat(code(queries))).toContain("updatedAt: row.updatedAt.toISOString()");
  });

  it("upserts in the upsertRig shape, conflicting on the owner", () => {
    const m = flat(code(mutations));
    expect(m).toContain(
      "export async function upsertPrefs(owner: string, patch: UserPrefsPatch): Promise<UserPrefs>",
    );
    expect(m).toContain(".insert(userPrefs)");
    expect(m).toContain(".values({ ownerId: owner, ...values })");
    expect(m).toContain("target: userPrefs.ownerId");
    expect(m).toContain("set: { ...values, updatedAt: new Date() }");
  });

  it("writes ONLY the keys the patch actually carried", () => {
    const body = flat(code(mutations)).split("export async function upsertPrefs")[1] ?? "";
    // The guard is what stops a one-field PUT nulling the other three.
    expect(body.slice(0, body.indexOf(".returning()"))).toContain("!== undefined");
  });
});

// ── 4 · the route ───────────────────────────────────────────────────────────

describe("apps/web/src/app/api/prefs/route.ts", () => {
  const r = flat(code(route));

  it("exports GET and PUT and nothing else", () => {
    expect(r).toContain("export async function GET()");
    expect(r).toContain("export async function PUT(req: Request)");
    expect((code(route).match(/^export /gm) ?? []).length).toBe(2);
  });

  it("scopes BOTH verbs by getOwner()", () => {
    expect(r).toContain("getPrefsByOwner(await getOwner())");
    expect(r).toContain("upsertPrefs(await getOwner(), parsed.data)");
    expect((r.match(/await getOwner\(\)/g) ?? []).length).toBe(2);
    expect(code(route)).toContain('import { getOwner } from "@/lib/owner"');
  });

  it("validates the body with the core schema's safeParse and 400s on failure", () => {
    expect(code(route)).toContain('import { userPrefsPatch } from "@rv-trip/core"');
    expect(r).toContain("userPrefsPatch.safeParse(await req.json())");
    expect(r).toContain(
      "return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });",
    );
  });

  it("is the same handler shape api/rig/route.ts already uses", () => {
    const shape = (src: string) =>
      flat(code(src))
        .replace(/[A-Za-z]+Patch|rigSchema/g, "S")
        .includes(
          "const parsed = S.safeParse(await req.json()); if (!parsed.success) { return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 }); }",
        );
    expect(shape(route)).toBe(true);
    expect(shape(rigRoute)).toBe(true);
  });
});

// ── 5 · lib/pref.ts — the write-through, and hydrate EXECUTED ───────────────

describe("apps/web/src/lib/pref.ts — the seam", () => {
  const p = flat(code(prefLib));

  it("re-exports the key map and exports hydrate", () => {
    expect(p).toContain("export const REMOTE = PREF_REMOTE;");
    expect(p).toContain("export function hydrate(row: UserPrefs | null | undefined): void");
  });

  it("leaves both hook signatures untouched — so no call site changed", () => {
    expect(p).toContain(
      "export function useBooleanPref(key: string): [boolean, (on: boolean) => void]",
    );
    expect(p).toContain(
      "export function useStringPref<T extends string>( key: string, isValid: (v: string) => v is T, fallback: T, ): [T | null, (v: T) => void]",
    );
  });

  it("PUTs one mapped field, and only for mapped keys", () => {
    expect(p).toContain("function pushRemote(key: string, stored: string): void");
    expect(p).toContain("if (!isRemotePrefKey(key)) return;");
    expect(p).toContain('void fetch("/api/prefs", { method: "PUT"');
    expect(p).toContain("body: JSON.stringify(toRemotePatch(key, stored))");
  });

  it("writes locally and notifies BEFORE it PUTs — a dead network costs the sync, not the toggle", () => {
    const boolSet = p.slice(p.indexOf("(on: boolean) => {"));
    expect(boolSet.slice(0, boolSet.indexOf("},"))).toContain(
      'const stored = on ? "1" : "0"; localStorage.setItem(key, stored); notify(); pushRemote(key, stored);',
    );
    const strSet = p.slice(p.indexOf("(v: T) => {"));
    expect(strSet.slice(0, strSet.indexOf("return [value, set];"))).toContain(
      "notify(); pushRemote(key, v);",
    );
    // Both setters, and nothing else, mirror.
    expect((p.match(/pushRemote\(key,/g) ?? []).length).toBe(2);
  });
});

describe("hydrate() — executed against a stub localStorage", () => {
  // NOT `typeof import("…/pref")`: a static type-import would drag a "use client"
  // DOM module into core's `lib: ["ES2022"]` typecheck. The contract is core's
  // own `UserPrefs`, and the real signature is asserted as source text above.
  interface PrefModule {
    hydrate(row: UserPrefs | null | undefined): void;
  }
  let store: Map<string, string>;
  let hydrate: PrefModule["hydrate"];
  let throwOnRead = false;

  beforeEach(async () => {
    store = new Map();
    throwOnRead = false;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(k: string) {
          if (throwOnRead) throw new Error("blocked");
          return store.has(k) ? store.get(k)! : null;
        },
        setItem(k: string, v: string) {
          store.set(k, String(v));
        },
      },
    });
    const url = pathToFileURL(join(REPO, "apps/web/src/lib/pref.ts")).href;
    ({ hydrate } = (await import(/* @vite-ignore */ url)) as PrefModule);
  });

  const ROW = {
    ownerId: "dev-user",
    theme: "light",
    units: "metric",
    mapStyle: "sat",
    trackCosts: true,
    updatedAt: "2026-09-13T00:00:00.000Z",
  };

  it("writes every non-null column into localStorage", () => {
    hydrate(ROW);
    expect(Object.fromEntries(store)).toEqual({
      "rv-theme": "light",
      "rv-units": "metric",
      "rv-map-style": "sat",
      "rv-track-costs": "1",
    });
  });

  it('renders trackCosts back as the "1"/"0" useBooleanPref reads', () => {
    hydrate({ ...ROW, trackCosts: false });
    expect(store.get("rv-track-costs")).toBe("0");
  });

  it("skips null columns — a never-chosen preference leaves the device alone", () => {
    store.set("rv-map-style", "night");
    hydrate({ ...ROW, theme: null, units: null, mapStyle: null, trackCosts: null });
    expect(Object.fromEntries(store)).toEqual({ "rv-map-style": "night" });
  });

  it("overwrites a disagreeing local value — the row is the account's answer", () => {
    store.set("rv-theme", "dark");
    hydrate(ROW);
    expect(store.get("rv-theme")).toBe("light");
  });

  it("does nothing with no row at all", () => {
    hydrate(null);
    hydrate(undefined);
    expect(store.size).toBe(0);
  });

  it("survives storage that throws (private mode, a blocked origin)", () => {
    throwOnRead = true;
    expect(() => hydrate(ROW)).not.toThrow();
  });
});

// ── 6 · PrefSync, and the no-FOUC script it must not become ────────────────

describe("apps/web/src/components/nav/PrefSync.tsx", () => {
  const s = flat(code(prefSync));

  it("is a client component that renders nothing", () => {
    expect(prefSync.startsWith('"use client";')).toBe(true);
    expect(s).toContain("return null;");
  });

  it("GETs the row after mount and hands it to hydrate", () => {
    expect(s).toContain("useEffect(() => {");
    expect(s).toContain('fetch("/api/prefs")');
    expect(s).toContain("hydrate(await res.json());");
  });

  it("re-asserts the theme class, narrowed by the app's own vocabulary", () => {
    expect(code(prefSync)).toContain('import { THEME_PREF_KEY, isTheme } from "@/lib/theme"');
    expect(s).toContain("localStorage.getItem(THEME_PREF_KEY)");
    expect(s).toContain(
      'document.documentElement.classList.toggle("dark", stored === "dark");',
    );
  });

  it("never rewrites the row it just read", () => {
    expect(s).not.toContain('method: "PUT"');
  });
});

describe("apps/web/src/app/layout.tsx", () => {
  it("mounts PrefSync exactly once, inside MaybeClerk", () => {
    expect(code(layout)).toContain(
      'import { PrefSync } from "@/components/nav/PrefSync"',
    );
    expect((layout.match(/<PrefSync \/>/g) ?? []).length).toBe(1);
    const inside = flat(code(layout)).split("<MaybeClerk>")[1]?.split("</MaybeClerk>")[0] ?? "";
    expect(inside).toContain("<PrefSync />");
  });

  it("leaves the no-FOUC script byte-identical to the base sha", () => {
    // 71046ce, verbatim. localStorage stays the pre-paint answer and the theme
    // is never a fetch's conclusion — PrefSync runs after, or it is a flash.
    expect(layout).toContain(
      [
        "        <script",
        "          dangerouslySetInnerHTML={{",
        "            __html:",
        "              \"try{if(localStorage.getItem('rv-theme')==='light')\" +",
        '              "document.documentElement.classList.remove(\'dark\')}catch{}",',
        "          }}",
        "        />",
      ].join("\n"),
    );
  });

  it("keeps the script the FIRST child of <body>", () => {
    const body = layout.slice(layout.indexOf("<body"));
    expect(body.indexOf("<script")).toBeLessThan(body.indexOf("<PrefSync"));
  });
});
