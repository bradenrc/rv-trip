import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * The map overlay palette contract (issue #12).
 *
 * `apps/web/src/components/map/palette.ts` is the resolved three-mode overlay
 * table. It cannot be imported here: it is an app module, and `packages/core`
 * is the only package with a test runner. So — exactly as
 * `nightfall-tokens.test.ts` guards the two duplicated stylesheets — the
 * contract is asserted against the palette's source text.
 *
 * What this guards:
 *
 *   1. Night is *not* a new palette. Every night literal is the value its
 *      `rv-*` token resolves to in `packages/ui/styles/entry.css`, and the
 *      token name ships in a comment beside it. Retune a token and this reds
 *      instead of the map quietly drifting off the app palette. Since #19 the
 *      values live on the raw `--rv-*` pair, so the resolver reads the DARK
 *      half — the `@theme inline` map only says `var(--rv-…)`.
 *   2. Day is the vetted table, literal for literal — the wireframe's numbers,
 *      not a re-derivation.
 *   3. Sat is night plus a halo and an arc casing, structurally (a spread), so
 *      the two can never fork by hand.
 *   4. No value is a `var(--…)` reference: Mapbox paint properties cannot read
 *      CSS custom properties, which is why `NIGHTFALL_PAINT` passes literals
 *      too (apps/web/src/components/map/nightfall.ts:5-9).
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const PALETTE = read(join(REPO, "apps/web/src/components/map/palette.ts"));
const NIGHTFALL = read(join(REPO, "apps/web/src/components/map/nightfall.ts"));
const ENTRY_CSS = read(join(REPO, "packages/ui/styles/entry.css"));

/** The `const <NAME>: OverlayPalette = { … };` body, by declaration name. */
function block(name: string): string {
  const start = PALETTE.indexOf(`const ${name}: OverlayPalette = {`);
  expect(start, `const ${name}: OverlayPalette`).toBeGreaterThan(-1);
  const end = PALETTE.indexOf("\n};", start);
  expect(end, `end of const ${name}`).toBeGreaterThan(start);
  return PALETTE.slice(start, end);
}

/** Every `key: "value"` string pair in a block, nested keys included. */
function colors(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s+(\w+): "([^"]+)",/gm)) out[m[1]!] = m[2]!;
  return out;
}

/** `key: "#hex", // --color-rv-name` — the night column's provenance comments. */
function tokenComments(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/^\s+(\w+): "([^"]+)",\s*\/\/ (--color-rv-[a-z-]+)$/gm)) {
    out[m[1]!] = m[3]!;
  }
  return out;
}

/** The raw dark half of entry.css — `.dark { --rv-*: <literal>; }`. Reading the
 * `@theme inline` map instead would compare every night literal against the
 * string "var(--rv-…)", which nothing can equal. */
const DARK_HALF = ENTRY_CSS.slice(
  ENTRY_CSS.indexOf(".dark {"),
  ENTRY_CSS.indexOf("}", ENTRY_CSS.indexOf(".dark {")),
);

/** Resolve `--color-rv-x` to the literal its raw twin carries in the dark half. */
function tokenValue(name: string): string {
  const raw = name.replace(/^--color-/, "--");
  const m = DARK_HALF.match(new RegExp(`${raw}\\s*:\\s*([^;]+);`));
  return m ? m[1]!.trim() : `MISSING ${name}`;
}

// ── the resolved tables (docs/design/12/index.html §4) ───────────────────

/** night role -> the rv-* token it must equal. */
const NIGHT_TOKENS: Record<string, string> = {
  Stay: "--color-rv-green",
  Eat: "--color-rv-warning",
  Do: "--color-rv-info-ink",
  Travel: "--color-rv-travel",
  Other: "--color-rv-ink-faded",
  dropDot: "--color-rv-navy",
  discStroke: "--color-rv-green",
  discFill: "--color-rv-green-soft",
  discInk: "--color-rv-green-ink",
  hollowGround: "--color-rv-navy-deep",
  floatingStroke: "--color-rv-warning",
  selFill: "--color-rv-accent",
  selStroke: "--color-rv-accent-bright",
  selInk: "--color-rv-navy",
  arcLine: "--color-rv-accent",
  labelInk: "--color-rv-ink-muted",
  labelInkSelected: "--color-rv-accent-bright",
  arcLabelBorder: "--color-rv-accent-soft",
  arcLabelInk: "--color-rv-accent",
  leader: "--color-rv-border-hi",
};

/** The day column, literal for literal. Map-only values — Q1 · B adds no token. */
const DAY_COLORS: Record<string, string> = {
  Stay: "#2e8b4e",
  Eat: "#97601c",
  Do: "#23697d",
  Travel: "#5c5470",
  Other: "#5d6b7d",
  dropDot: "#ffffff",
  discStroke: "#2e8b4e",
  discFill: "#2e8b4e",
  discInk: "#ffffff",
  hollowGround: "#ffffff",
  floatingStroke: "#97601c",
  selFill: "#c14d20",
  selStroke: "#c14d20",
  selInk: "#ffffff",
  arcLine: "#c14d20",
  corridorCasing: "rgba(255, 255, 255, 0.9)",
  labelScrim: "rgba(255, 255, 255, 0.9)",
  labelInk: "#0a1520",
  labelInkSelected: "#c14d20",
  arcLabelScrim: "rgba(255, 255, 255, 0.9)",
  arcLabelBorder: "#c14d20",
  arcLabelInk: "#c14d20",
  leader: "rgba(10, 21, 32, 0.45)",
};

describe("Map overlay palette — the three-mode contract", () => {
  it("names exactly the three modes, in Night · Day · Sat order", () => {
    expect(PALETTE).toContain('export const STYLE_MODES = ["night", "day", "sat"] as const;');
  });

  it("defaults to day (issue #19), with night and sat still one click away", () => {
    expect(PALETTE).toContain('export const DEFAULT_STYLE_MODE: StyleMode = "day";');
  });

  it("homes the mode vocabulary in a vendor-free module (no mapbox import)", () => {
    // MapView.tsx imports react-map-gl + mapbox-gl.css at module scope and is
    // only ever loaded through `dynamic(…, { ssr: false })`. MapMount needs the
    // validator as a VALUE during SSR, so the vocabulary cannot live there.
    expect(PALETTE).not.toMatch(/from "(react-map-gl|mapbox-gl)/);
    expect(PALETTE).not.toMatch(/^import (?!type )/m);
  });

  it("keeps MAP_STYLES — the vendor style urls — on the vendor seam", () => {
    const mapView = read(join(REPO, "apps/web/src/components/map/MapView.tsx"));
    expect(mapView).toContain("export const MAP_STYLES: Record<StyleMode, string>");
    expect(PALETTE).not.toContain("mapbox://");
  });

  it("night is the shipped rv-* tokens, resolved from entry.css", () => {
    const night = colors(block("NIGHT"));
    const resolved: Record<string, string> = {};
    for (const [role, token] of Object.entries(NIGHT_TOKENS)) resolved[role] = tokenValue(token);
    const actual: Record<string, string> = {};
    for (const role of Object.keys(NIGHT_TOKENS)) actual[role] = night[role] ?? "MISSING";
    expect(actual).toEqual(resolved);
  });

  it("names the rv-* token beside every night literal it comes from", () => {
    expect(tokenComments(block("NIGHT"))).toEqual(NIGHT_TOKENS);
  });

  it("carries night's two scrims and the leader at their documented alphas", () => {
    const night = colors(block("NIGHT"));
    // rv-navy-deep @ 84% (pin labels) and rv-navy @ 88% (arc labels).
    expect(night.labelScrim).toBe("rgba(15, 23, 42, 0.84)");
    expect(night.arcLabelScrim).toBe("rgba(2, 6, 23, 0.88)");
  });

  it("is the vetted day column, literal for literal", () => {
    expect(colors(block("DAY"))).toEqual(DAY_COLORS);
  });

  it("builds sat from night, overriding only the halo and the arc casing", () => {
    const sat = PALETTE.slice(
      PALETTE.indexOf("const SAT: OverlayPalette = {"),
      PALETTE.indexOf("\n};", PALETTE.indexOf("const SAT: OverlayPalette = {")),
    );
    expect(sat).toContain("...NIGHT");
    expect(colors(sat)).toEqual({
      halo: "#ffffff",
      arcCasing: "rgba(2, 6, 23, 0.8)",
    });
  });

  it("mode-keys the arc geometry, not only its colour", () => {
    // The vet's MED: the wireframe draws Day arcs at 1.8/.92 and Sat at 1.6/1
    // against Night's 1.6/.75, so width and opacity flip with the mode too.
    expect(block("NIGHT")).toMatch(/arcWidth: 1\.6,/);
    expect(block("NIGHT")).toMatch(/arcOpacity: 0\.75,/);
    expect(block("DAY")).toMatch(/arcWidth: 1\.8,/);
    expect(block("DAY")).toMatch(/arcOpacity: 0\.92,/);
    const sat = PALETTE.slice(PALETTE.indexOf("const SAT: OverlayPalette = {"));
    expect(sat).toMatch(/arcOpacity: 1,/);
  });

  it("casings the solid corridor in all three modes (docs/design/43 §2)", () => {
    // A routed corridor is SOLID, so it needs a casing everywhere — unlike the
    // estimate dash, whose casing is sat-only (`arcCasing`, asserted below).
    // Both values already existed in the file: 0.8 is sat's arcCasing, 0.9
    // white is day's two scrims. No new colour and no new rv-* token.
    expect(colors(block("NIGHT")).corridorCasing).toBe("rgba(2, 6, 23, 0.8)");
    expect(colors(block("DAY")).corridorCasing).toBe("rgba(255, 255, 255, 0.9)");
    const sat = PALETTE.slice(
      PALETTE.indexOf("const SAT: OverlayPalette = {"),
      PALETTE.indexOf("\n};", PALETTE.indexOf("const SAT: OverlayPalette = {")),
    );
    // Sat inherits it from the ...NIGHT spread — never re-stated by hand.
    expect(colors(sat)).not.toHaveProperty("corridorCasing");
    expect(sat).toContain("...NIGHT");
  });

  it("gives night and day no halo and no arc casing", () => {
    for (const name of ["NIGHT", "DAY"]) {
      expect(block(name), `${name}.halo`).toMatch(/halo: null,/);
      expect(block(name), `${name}.arcCasing`).toMatch(/arcCasing: null,/);
    }
  });

  it("holds no colour var(--…) — Mapbox paint cannot read custom properties", () => {
    // `markerShadow` composes `var(--shadow-rv-*)`, which is fine: that string
    // lands on a DOM marker's inline style, never in a Mapbox paint property.
    // No *colour* may take that shape.
    expect(PALETTE).not.toContain("var(--color-");
  });

  it("restyles the night BASEMAP from the same dark half (nightfall.ts)", () => {
    // nightfall.ts states the same invariant as the night column above — every
    // literal is its rv-* token's dark-half value, with the token name beside
    // it — but nothing guarded it (qa's DD). Retune a token and this reds
    // instead of the basemap quietly staying on the old palette.
    const rows = [...NIGHTFALL.matchAll(/token: "(--color-rv-[a-z-]+)",\s*color: "([^"]+)"/g)];
    expect(rows.length, "NIGHTFALL_PAINT rows").toBe(6);
    const actual: Record<string, string> = {};
    const resolved: Record<string, string> = {};
    for (const m of rows) {
      actual[m[1]!] = m[2]!;
      resolved[m[1]!] = tokenValue(m[1]!);
    }
    expect(actual).toEqual(resolved);
  });

  it("adds no rv-* token, so the Nightfall toEqual guard stays untouched", () => {
    // Q1 · B is the cheap answer precisely because nothing enters @theme: the
    // map-only literals live here, not in the token vocabulary. (Day values are
    // free to *coincide* with a token — rv-ember-deep and rv-navy are two the
    // design cites by name — but no new name may appear.)
    expect(ENTRY_CSS).not.toContain("rv-map");
    expect(PALETTE).not.toContain("@theme");
  });
});
