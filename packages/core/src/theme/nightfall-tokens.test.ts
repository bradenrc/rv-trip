import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The token contract — "Nightfall & Ember" (issue #3), revalued to
 * "Slate + Sky" with a light half and a toggle (issue #19).
 *
 * The rv-* token values are duplicated by design in two files —
 * `packages/ui/styles/entry.css` (the DS stylesheet, what design-sync previews
 * compile against) and `apps/web/src/app/globals.css` (the app's Tailwind
 * theme). The design's own words: "the two files are duplicated by design; if
 * they diverge that is a bug." Nothing else in the repo can assert that, and
 * `packages/core` is the only package with a test runner — so the contract is
 * guarded here.
 *
 * Since #19 each file carries the palette TWICE — the raw `--rv-*` values,
 * light on `:root` and dark on `.dark` — behind one `@theme inline` map that
 * points every `--color-rv-*` / `--shadow-rv-*` at its raw twin. So the drift
 * guard is pointed at the RAW halves of both files: the `@theme inline` maps
 * are identical `var(--rv-*)` text in both files and would mirror each other
 * even if the values underneath diverged, which is exactly the bug this test
 * exists to catch.
 *
 * These are source-text assertions, not runtime behaviour: the change this
 * guards is a pure restyle (token values + className edits) with no domain
 * logic to exercise. What a browser has to confirm — that the light half
 * actually paints, that the inline script beats first paint, that the three
 * `class="dark"` islands stay dark — is the walk gate's job.
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

/** One declaration block by selector. The raw pairs now appear twice per file,
 * so a file-wide regex would let the second half overwrite the first. */
function block(css: string, sel: string): string {
  const i = css.indexOf(`${sel} {`);
  expect(i, `${sel} { … } in the stylesheet`).toBeGreaterThan(-1);
  const end = css.indexOf("}", i);
  expect(end, `end of ${sel} { … }`).toBeGreaterThan(i);
  return css.slice(i, end);
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

// ── §1 the token contract, both halves ───────────────────────────────────
/** The LIGHT half — published Tailwind Slate + Sky, on `:root`. */
const SLATE_SKY_LIGHT: Record<string, string> = {
  "rv-navy": "#020617",
  "rv-navy-deep": "#0f172a",
  "rv-green-on-dark": "#34d399",
  "rv-surface-alt": "#f8fafc",
  "rv-surface": "#ffffff",
  "rv-navy-soft": "#f1f5f9",
  "rv-border": "#e2e8f0",
  "rv-border-soft": "#f1f5f9",
  "rv-border-hi": "#cbd5e1",
  "rv-ink": "#0f172a",
  "rv-ink-muted": "#475569",
  "rv-ink-faded": "#64748b",
  "rv-ink-subtle": "#94a3b8",
  "rv-accent": "#0369a1",
  "rv-accent-bright": "#0ea5e9",
  "rv-accent-deep": "#0284c7",
  "rv-accent-soft": "#f0f9ff",
  "rv-accent-ink": "#ffffff",
  "rv-green": "#059669",
  "rv-green-cta": "#059669",
  "rv-green-soft": "#ecfdf5",
  "rv-green-ink": "#047857",
  "rv-warning": "#d97706",
  "rv-warning-soft": "#fffbeb",
  "rv-info": "#0891b2",
  "rv-info-soft": "#ecfeff",
  "rv-info-ink": "#0891b2",
  "rv-travel": "#7c3aed",
  "rv-travel-ink": "#7c3aed",
  "rv-travel-soft": "#f5f3ff",
  // elevation — slate-900 alphas; pure black reads leaden on slate-50
  "rv-shadow-sm": "0 1px 2px rgba(15, 23, 42, 0.06)",
  "rv-shadow-md": "0 1px 3px rgba(15, 23, 42, 0.1), 0 1px 2px -1px rgba(15, 23, 42, 0.08)",
  "rv-shadow-lg": "0 4px 10px -2px rgba(15, 23, 42, 0.12), 0 2px 4px -2px rgba(15, 23, 42, 0.08)",
  "rv-shadow-xl": "0 12px 28px -6px rgba(15, 23, 42, 0.16), 0 4px 10px -4px rgba(15, 23, 42, 0.1)",
};

/** The DARK half — the product default, and the chrome island, on `.dark`. */
const SLATE_SKY_DARK: Record<string, string> = {
  "rv-navy": "#020617",
  "rv-navy-deep": "#0f172a",
  "rv-green-on-dark": "#34d399",
  "rv-surface-alt": "#0f172a",
  "rv-surface": "#1e293b",
  "rv-navy-soft": "#334155",
  "rv-border": "#334155",
  "rv-border-soft": "#1e293b",
  "rv-border-hi": "#475569",
  "rv-ink": "#f1f5f9",
  "rv-ink-muted": "#cbd5e1",
  "rv-ink-faded": "#94a3b8",
  "rv-ink-subtle": "#64748b",
  "rv-accent": "#38bdf8",
  "rv-accent-bright": "#7dd3fc",
  "rv-accent-deep": "#0ea5e9",
  "rv-accent-soft": "#082f49",
  "rv-accent-ink": "#020617",
  "rv-green": "#34d399",
  "rv-green-cta": "#34d399",
  "rv-green-soft": "#022c22",
  "rv-green-ink": "#6ee7b7",
  "rv-warning": "#fbbf24",
  "rv-warning-soft": "#451a03",
  "rv-info": "#22d3ee",
  "rv-info-soft": "#083344",
  "rv-info-ink": "#22d3ee",
  "rv-travel": "#a78bfa",
  "rv-travel-ink": "#a78bfa",
  "rv-travel-soft": "#2e1065",
  // elevation — pure black on the night canvas, as shipped
  "rv-shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.28)",
  "rv-shadow-md": "0 1px 3px rgba(0, 0, 0, 0.36), 0 1px 2px -1px rgba(0, 0, 0, 0.28)",
  "rv-shadow-lg": "0 4px 10px -2px rgba(0, 0, 0, 0.44), 0 2px 4px -2px rgba(0, 0, 0, 0.36)",
  "rv-shadow-xl": "0 12px 28px -6px rgba(0, 0, 0, 0.55), 0 4px 10px -4px rgba(0, 0, 0, 0.44)",
};

const RADII: Record<string, string> = {
  "radius-rv-sm": "4px",
  "radius-rv-md": "6px",
  "radius-rv-card": "10px",
  "radius-rv-pill": "9999px",
};

/** shadcn values that paint today via globals.css's `@layer base` — one
 * fixture per half, because `:root` is now the LIGHT half. */
const SHADCN_LIGHT: Record<string, string> = {
  background: "#f8fafc",
  foreground: "#0f172a",
  border: "#e2e8f0",
  ring: "#0369a1",
};
const SHADCN_DARK: Record<string, string> = {
  background: "#0f172a",
  foreground: "#f1f5f9",
  border: "#334155",
  ring: "#38bdf8",
};

describe("Slate + Sky — the token contract", () => {
  for (const [label, file] of [
    ["entry.css", ENTRY_CSS],
    ["globals.css", GLOBALS_CSS],
  ] as const) {
    it(`resolves every rv-* value to its light half on :root in ${label}`, () => {
      expect(tokens(block(read(file), ":root"), "rv-")).toEqual(SLATE_SKY_LIGHT);
    });

    it(`resolves every rv-* value to its dark half on .dark in ${label}`, () => {
      expect(tokens(block(read(file), ".dark"), "rv-")).toEqual(SLATE_SKY_DARK);
    });

    it(`maps every rv-* utility at its raw twin through @theme inline in ${label}`, () => {
      // The indirection IS the flip: `bg-rv-surface` compiles to
      // `var(--rv-surface)` and so re-resolves inside a `.dark` island.
      const css = read(file);
      const map = { ...tokens(css, "color-rv-"), ...tokens(css, "shadow-rv-") };
      const expected: Record<string, string> = {};
      for (const name of Object.keys(SLATE_SKY_LIGHT)) {
        const themeName = name.startsWith("rv-shadow-")
          ? `shadow-rv-${name.slice("rv-shadow-".length)}`
          : `color-${name}`;
        expected[themeName] = `var(--${name})`;
      }
      expect(map).toEqual(expected);
      expect(css, "@theme inline is what makes the map flip").toContain("@theme inline {");
    });

    it(`keeps the radius scale literal and un-halved in ${label}`, () => {
      expect(tokens(read(file), "radius-rv-")).toEqual(RADII);
    });
  }

  it("keeps entry.css and globals.css a verbatim mirror (divergence is a bug)", () => {
    const entry = read(ENTRY_CSS);
    const globals = read(GLOBALS_CSS);
    // Pointed at the RAW halves: the `@theme inline` maps are identical
    // `var(--rv-*)` text in both files and would mirror even if the values
    // underneath had drifted apart.
    for (const sel of [":root", ".dark"]) {
      expect(tokens(block(globals, sel), "rv-"), `${sel} raw mirror`).toEqual(
        tokens(block(entry, sel), "rv-"),
      );
    }
    for (const prefix of ["color-rv-", "radius-rv-", "shadow-rv-"]) {
      expect(tokens(globals, prefix), `--${prefix}* mirror`).toEqual(tokens(entry, prefix));
    }
  });

  it("drops rv-green-deep from both stylesheets and the safelist", () => {
    expect(read(ENTRY_CSS)).not.toContain("green-deep");
    expect(read(GLOBALS_CSS)).not.toContain("green-deep");
  });

  it("safelists the five accent names plus travel-soft, and no ember name", () => {
    const safelist = read(ENTRY_CSS).match(/@source inline\("\{bg,text,border\}-rv-\{([^}]*)\}"\)/s);
    expect(safelist, "the {bg,text,border}-rv-{…} safelist").not.toBeNull();
    const names = safelist![1]!.split(",").map((s) => s.trim());
    for (const n of [
      "accent",
      "accent-bright",
      "accent-deep",
      "accent-soft",
      "accent-ink",
      "travel-soft",
    ]) {
      expect(names, `safelist should carry ${n}`).toContain(n);
    }
    for (const n of ["ember", "ember-bright", "ember-deep", "ember-soft"]) {
      expect(names, `safelist should have retired ${n}`).not.toContain(n);
    }
  });

  it("puts the shadcn scale on the same two halves, no longer inverted", () => {
    // Before #19 `:root` held the app's dark values and `.dark` held shadcn's
    // stock grey preset — harmless only because nothing ever set the class.
    const globals = read(GLOBALS_CSS);
    for (const [sel, fixture] of [
      [":root", SHADCN_LIGHT],
      [".dark", SHADCN_DARK],
    ] as const) {
      const b = block(globals, sel);
      for (const [name, value] of Object.entries(fixture)) {
        expect(b, `${sel} --${name}`).toContain(`--${name}: ${value};`);
      }
    }
  });
});

// ── §3 the collisions the sweeps exist to close ──────────────────────────
describe("Slate + Sky — the call-site sweeps", () => {
  it("sweep 1: leaves text-rv-navy only where the background is green", () => {
    // C3/V7: navy is ink on a green fill; everywhere else it is shell chrome
    // and heading ink must be rv-ink. #19 moved the accent CTAs off this pair
    // onto rv-accent-deep + rv-accent-ink — sky-700 under slate-950 would be
    // ~3.4:1 in the light half.
    const bad = hits(/text-rv-navy(?![-\w])/).filter(
      (h) => !/bg-rv-(?:green|green-on-dark)(?![-\w])/.test(h.line),
    );
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("sweep 1 (#19): the accent CTA is accent-deep filled with accent-ink", () => {
    // Both directions: no accent fill without its ink, no accent ink without
    // its fill. This is the pair that passes AA in BOTH halves.
    const fills = hits(/\bbg-rv-accent-deep\b/).filter((h) => !/\btext-rv-accent-ink\b/.test(h.line));
    expect(fills.map((h) => h.at), "bg-rv-accent-deep without text-rv-accent-ink").toEqual([]);
    const inks = hits(/\btext-rv-accent-ink\b/).filter((h) => !/\bbg-rv-accent-deep\b/.test(h.line));
    expect(inks.map((h) => h.at), "text-rv-accent-ink without bg-rv-accent-deep").toEqual([]);
    expect(hits(/\bbg-rv-accent-deep\b/).length, "the accent CTA ships somewhere").toBeGreaterThan(0);
  });

  it("sweep 1: no inline var(--color-rv-navy) is used as a foreground color (vet HIGH)", () => {
    // Gantt's Ruler set the week-start day numbers with an inline style, so the
    // className sweep could not reach it; revalued, navy is the canvas's shell.
    expect(hits(/\bcolor:\s*[^;\n]*var\(--color-rv-navy\)/).map((h) => h.at)).toEqual([]);
  });

  it("sweep 2: no rv-green-cta call site is left carrying CTA/money/link duty", () => {
    // green-cta becomes stay-text only; every CTA, money and link site is accent.
    const bad = hits(/rv-green-cta/).filter((h) => /\bbg-rv-green-cta\b/.test(h.line));
    expect(bad.map((h) => h.at)).toEqual([]);
  });

  it("sweep 2: stars are the accent, not Eat's amber", () => {
    const stars = read(join(REPO, "packages/ui/src/Stars.tsx"));
    expect(stars).toContain("var(--color-rv-accent)");
    expect(stars).not.toContain("var(--color-rv-warning)");
  });

  it("retires the rv-ember-* family from every call site", () => {
    expect(hits(/rv-ember/).map((h) => h.at)).toEqual([]);
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
    // The §1 role table scopes rv-ink-subtle to empty stars, grip handles and
    // disabled icons. Kickers, labels and meta text belong to rv-ink-faded,
    // the documented "mono kickers" role.
    //
    // The guard is an allowlist of the two shapes a *non-text* use takes, applied
    // to every source file — not a per-file "is this line texty" filter, which
    // could not see category.ts's statusMeta colors (rendered as the label text
    // at StatusMarker.tsx:13 — the site the vet's second HIGH named).
    const ICON_SIZED = /\bsize-[\d[]/; // a lucide icon or a dot, sized on the same line
    const ICON_STATE = /(?:color|fill):\s*\w+\s*\?\s*"var\(--color-rv-accent\)"/; // empty star · hidden-note icon
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

  it("C4 (#19 F7): .trip-card's hover lift reads the token scale, so it flips", () => {
    const globals = read(GLOBALS_CSS);
    expect(globals).toContain("box-shadow: var(--shadow-rv-md);");
    expect(globals).toContain("box-shadow: var(--shadow-rv-xl);");
    expect(globals, "no hard-coded black shadow outside the scale").not.toMatch(
      /\.trip-card[^}]*rgba\(0, 0, 0/s,
    );
  });
});

// ── §3·§4·§5 the theme mechanism (issue #19) ─────────────────────────────
describe("Slate + Sky — default dark, the toggle, and the chrome islands", () => {
  const LAYOUT = join(REPO, "apps/web/src/app/layout.tsx");

  it("§3: the server renders `dark`, and only a script may remove it", () => {
    const layout = read(LAYOUT);
    expect(layout, "dark on <html>").toMatch(/className=\{`[^`]*\bdark`\}/);
    // The vet's HIGH: React 19 diffs <html>'s className during hydration, so
    // the element the inline script mutates must suppress the warning.
    expect(layout, "suppressHydrationWarning on <html>").toContain("suppressHydrationWarning");
    expect(layout, "the script only ever REMOVES the class").toContain(
      "classList.remove('dark')",
    );
    expect(layout, "keyed to the rv-theme pref").toContain("localStorage.getItem('rv-theme')");
  });

  it("§3: the theme pref uses the app's own store, with no new dependency", () => {
    const theme = read(join(REPO, "apps/web/src/lib/theme.ts"));
    expect(theme).toContain('export const THEME_PREF_KEY = "rv-theme"');
    expect(theme).toContain("useStringPref");
    expect(theme).toContain('export const DEFAULT_THEME: Theme = "dark"');
  });

  it("§4 (F1): the toggle swaps its glyph off <html>, not off the island", () => {
    // `dark:` is permanently true inside the `.dark` masthead, so the icons are
    // keyed to a second variant scoped to the document root.
    expect(read(GLOBALS_CSS)).toContain("@custom-variant theme-dark (&:is(html.dark *));");
    const nav = read(join(REPO, "apps/web/src/components/nav/Nav.tsx"));
    expect(nav).toContain("theme-dark:block");
    expect(nav).toContain("theme-dark:hidden");
    expect(nav, "the tooltip says in words what the icon means").toContain(
      '"Switch to light theme"',
    );
    expect(nav).toContain('"Switch to dark theme"');
  });

  it("§5 (Q4=A): the three chrome bars wear the dark theme itself", () => {
    for (const [file, marker] of [
      ["apps/web/src/components/nav/Nav.tsx", "<nav className=\"dark sticky"],
      ["apps/web/src/components/trip/StopDetailSheet.tsx", 'className="dark sticky top-0 z-[1] bg-rv-navy'],
      ["apps/web/src/components/map/MapOverview.tsx", 'className="dark flex flex-wrap'],
    ] as const) {
      expect(read(join(REPO, file)), `${file} island`).toContain(marker);
    }
  });

  it("F2: the toaster follows the app theme; nothing imports next-themes", () => {
    const sonner = read(join(REPO, "apps/web/src/components/ui/sonner.tsx"));
    expect(sonner).toContain('import { useTheme } from "@/lib/theme"');
    expect(hits(/from "next-themes"/).map((h) => h.at)).toEqual([]);
  });
});
