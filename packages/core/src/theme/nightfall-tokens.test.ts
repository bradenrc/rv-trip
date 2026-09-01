import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The "Nightfall & Ember" token contract (issue #3).
 *
 * The rv-* token values are duplicated by design in two files —
 * `packages/ui/styles/entry.css` (the DS stylesheet, what design-sync previews
 * compile against) and `apps/web/src/app/globals.css` (the app's Tailwind
 * theme). The design's own words: "the two files are duplicated by design; if
 * they diverge that is a bug." Nothing else in the repo can assert that, and
 * `packages/core` is the only package with a test runner — so the contract is
 * guarded here.
 *
 * These are source-text assertions, not runtime behaviour: the change this
 * guards is a pure restyle (token values + className edits) with no domain
 * logic to exercise.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENTRY_CSS = join(REPO, "packages/ui/styles/entry.css");
const GLOBALS_CSS = join(REPO, "apps/web/src/app/globals.css");

const read = (p: string) => readFileSync(p, "utf8");

/** Pull `--name: value;` declarations for a token prefix out of a stylesheet. */
function tokens(css: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`--(${prefix}[a-z0-9-]*)\\s*:\\s*([^;]+);`, "g");
  for (const m of css.matchAll(re)) out[m[1]!] = m[2]!.trim().replace(/\s+/g, " ");
  return out;
}

/** Every tracked source file under the DS and the app. */
function sourceFiles(): string[] {
  const roots = [join(REPO, "packages/ui/src"), join(REPO, "apps/web/src")];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  roots.forEach(walk);
  return out;
}

/** [file:line, text] for every source line matching `re`. */
function hits(re: RegExp): { at: string; line: string }[] {
  const out: { at: string; line: string }[] = [];
  for (const f of sourceFiles()) {
    read(f)
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) out.push({ at: `${relative(REPO, f)}:${i + 1}`, line: line.trim() });
      });
  }
  return out;
}

// ── §1 the token contract ────────────────────────────────────────────────
const NIGHTFALL_COLORS: Record<string, string> = {
  "color-rv-navy": "#0a1520",
  "color-rv-navy-deep": "#08182b",
  "color-rv-navy-soft": "#21374d",
  "color-rv-green": "#7cd897",
  "color-rv-green-cta": "#7cd897",
  "color-rv-green-soft": "#1c3a2b",
  "color-rv-green-ink": "#a8e8bd",
  "color-rv-green-on-dark": "#7cd897",
  "color-rv-ember": "#f28c5e",
  "color-rv-ember-bright": "#ffa477",
  "color-rv-ember-deep": "#c14d20",
  "color-rv-ember-soft": "#3a2b22",
  "color-rv-ink": "#eef5fa",
  "color-rv-ink-muted": "#b8cbda",
  "color-rv-ink-faded": "#8fa8bd",
  "color-rv-ink-subtle": "#5f7690",
  "color-rv-surface": "#182b3d",
  "color-rv-surface-alt": "#101f2d",
  "color-rv-border": "#2e4459",
  "color-rv-border-soft": "#26394b",
  "color-rv-border-hi": "#3d566c",
  "color-rv-warning": "#f0bc55",
  "color-rv-warning-soft": "#3a3220",
  "color-rv-info": "#6fc4d8",
  "color-rv-info-soft": "#183440",
  "color-rv-info-ink": "#6fc4d8",
  "color-rv-travel": "#a79ec8",
  "color-rv-travel-ink": "#a79ec8",
  "color-rv-travel-soft": "#2b2839",
};

const NIGHTFALL_SHADOWS: Record<string, string> = {
  "shadow-rv-sm": "0 1px 2px rgba(0, 0, 0, 0.28)",
  "shadow-rv-md": "0 1px 3px rgba(0, 0, 0, 0.36), 0 1px 2px -1px rgba(0, 0, 0, 0.28)",
  "shadow-rv-lg": "0 4px 10px -2px rgba(0, 0, 0, 0.44), 0 2px 4px -2px rgba(0, 0, 0, 0.36)",
  "shadow-rv-xl": "0 12px 28px -6px rgba(0, 0, 0, 0.55), 0 4px 10px -4px rgba(0, 0, 0, 0.44)",
};

/** shadcn `:root` values that paint today via globals.css's `@layer base`. */
const SHADCN_MUST_NOT_MISS: Record<string, string> = {
  background: "#101f2d",
  foreground: "#eef5fa",
  border: "#2e4459",
  ring: "#f28c5e",
};

describe("Nightfall & Ember — the token contract", () => {
  it("resolves every rv-* color to its Nightfall value in entry.css", () => {
    expect(tokens(read(ENTRY_CSS), "color-rv-")).toEqual(NIGHTFALL_COLORS);
  });

  it("resolves every rv-* shadow to its Q4=A value in entry.css", () => {
    expect(tokens(read(ENTRY_CSS), "shadow-rv-")).toEqual(NIGHTFALL_SHADOWS);
  });

  it("keeps entry.css and globals.css a verbatim mirror (divergence is a bug)", () => {
    const entry = read(ENTRY_CSS);
    const globals = read(GLOBALS_CSS);
    for (const prefix of ["color-rv-", "radius-rv-", "shadow-rv-"]) {
      expect(tokens(globals, prefix), `--${prefix}* mirror`).toEqual(tokens(entry, prefix));
    }
  });

  it("drops rv-green-deep from both stylesheets and the safelist", () => {
    expect(read(ENTRY_CSS)).not.toContain("green-deep");
    expect(read(GLOBALS_CSS)).not.toContain("green-deep");
  });

  it("safelists the four ember names plus travel-soft", () => {
    const safelist = read(ENTRY_CSS).match(/@source inline\("\{bg,text,border\}-rv-\{([^}]*)\}"\)/s);
    expect(safelist, "the {bg,text,border}-rv-{…} safelist").not.toBeNull();
    const names = safelist![1]!.split(",").map((s) => s.trim());
    for (const n of ["ember", "ember-bright", "ember-deep", "ember-soft", "travel-soft"]) {
      expect(names, `safelist should carry ${n}`).toContain(n);
    }
  });

  it("moves the shadcn :root tokens that already paint (V4)", () => {
    const root = read(GLOBALS_CSS).match(/:root \{[^}]*\}/s)?.[0] ?? "";
    for (const [name, value] of Object.entries(SHADCN_MUST_NOT_MISS)) {
      expect(root, `--${name}`).toContain(`--${name}: ${value};`);
    }
  });
});

// ── §3 the collisions the sweeps exist to close ──────────────────────────
describe("Nightfall & Ember — the call-site sweeps", () => {
  it("sweep 1: leaves text-rv-navy only where the background is ember or green", () => {
    // C3/V7: navy is CTA ink on an ember or green fill; everywhere else it is
    // shell chrome and heading ink must be rv-ink.
    const bad = hits(/text-rv-navy(?![-\w])/).filter(
      (h) => !/bg-rv-(?:ember|green|green-on-dark)(?![-\w])/.test(h.line),
    );
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("sweep 1: no inline var(--color-rv-navy) is used as a foreground color (vet HIGH)", () => {
    // Gantt's Ruler set the week-start day numbers with an inline style, so the
    // className sweep could not reach it; revalued, navy is the canvas's shell.
    expect(hits(/\bcolor:\s*[^;\n]*var\(--color-rv-navy\)/).map((h) => h.at)).toEqual([]);
  });

  it("sweep 2: no rv-green-cta call site is left carrying CTA/money/link duty", () => {
    // green-cta becomes stay-text only; every CTA, money and link site is ember.
    const bad = hits(/rv-green-cta/).filter((h) => /\bbg-rv-green-cta\b/.test(h.line));
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("sweep 2: stars are ember, not Eat's amber", () => {
    const stars = read(join(REPO, "packages/ui/src/Stars.tsx"));
    expect(stars).toContain("var(--color-rv-ember)");
    expect(stars).not.toContain("var(--color-rv-warning)");
  });

  it("sweep 3 (C1/C2): rv-surface and rv-navy-soft are background-only", () => {
    expect(hits(/(text|border)-rv-surface(?![-\w])/).map((h) => h.at)).toEqual([]);
    expect(hits(/text-rv-navy-soft/).map((h) => h.at)).toEqual([]);
  });

  it("sweep 4 (C3): text-white survives only on the navy shell chip", () => {
    // §5 sweep 4 leaves exactly one text-white — Places' active filter chip,
    // whose background is bg-rv-navy (18:1). Asserted from what the line says,
    // not from a line number, so an unrelated edit above it cannot red this.
    const bad = hits(/text-white/).filter((h) => !/\bbg-rv-navy(?![-\w])/.test(h.line));
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("rv-ink-subtle paints no text glyphs — non-text only (vet HIGH)", () => {
    // The §1 role table scopes rv-ink-subtle (#5f7690, ~3.1:1 on rv-surface) to
    // empty stars, grip handles and disabled icons. Kickers, labels and meta
    // text belong to rv-ink-faded (#8fa8bd), the documented "mono kickers" role.
    //
    // The guard is an allowlist of the two shapes a *non-text* use takes, applied
    // to every source file — not a per-file "is this line texty" filter, which
    // could not see category.ts's statusMeta colors (rendered as the label text
    // at StatusMarker.tsx:13 — the site the vet's second HIGH named).
    const ICON_SIZED = /\bsize-[\d[]/; // a lucide icon or a dot, sized on the same line
    const ICON_STATE = /(?:color|fill):\s*\w+\s*\?\s*"var\(--color-rv-ember\)"/; // empty star · hidden-note icon
    const bad = hits(/rv-ink-subtle/).filter(
      (h) => !ICON_SIZED.test(h.line) && !ICON_STATE.test(h.line),
    );
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("C5: the dashboard trip covers are re-tuned to the ladder", () => {
    const card = read(join(REPO, "apps/web/src/components/dashboard/TripCard.tsx"));
    for (const pair of [
      '["#12332a", "#2f6b4c"]',
      '["#3a2b22", "#8a5230"]',
      '["#0a1520", "#284866"]',
      '["#1d2b38", "#41586e"]',
    ]) {
      expect(card).toContain(pair);
    }
    expect(card).toContain("opacity: 0.08,");
  });

  it("V6: Travel's chip background is the hand-tuned token, not a color-mix", () => {
    const cat = read(join(REPO, "packages/ui/src/category.ts"));
    expect(cat).toContain("var(--color-rv-travel-soft)");
    expect(cat).not.toContain("color-mix");
  });

  it("C4: .trip-card's hover lift is a pure-black shadow", () => {
    const globals = read(GLOBALS_CSS);
    expect(globals).toContain("box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);");
    expect(globals).toContain("box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.55);");
  });
});
