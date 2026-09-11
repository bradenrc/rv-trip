import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ARC_CASING_WIDTH,
  DEFAULT_STYLE_MODE,
  MAP_PALETTE,
  STYLE_MODES,
  isStyleMode,
  type OverlayPalette,
} from "./map-palette";

/**
 * The map overlay palette contract (issue #12).
 *
 * `map-palette.ts` is the resolved three-mode overlay table. It lived in
 * `apps/web/src/components/map/palette.ts` until #44 i3 — an app module, which
 * is why this test used to assert the whole contract against the palette's
 * *source text*. The table now lives here in core (the phone needs the same
 * three columns, and `apps/mobile` has no test runner either), so every value
 * assertion below is a real import of the real object; only the two claims that
 * are genuinely about the source — the provenance comments, and the vendor-free
 * import list — still read text.
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
 *   3. Sat is night plus a halo and an arc casing, structurally (asserted as a
 *      spread of the real night object), so the two can never fork by hand.
 *   4. No value is a `var(--…)` reference: Mapbox paint properties cannot read
 *      CSS custom properties, which is why `NIGHTFALL_PAINT` passes literals
 *      too (apps/web/src/components/map/nightfall.ts:5-9).
 *   5. The web's `palette.ts` is a re-export and owns no value of its own, so
 *      the app and the phone cannot drift.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const SOURCE = read(join(REPO, "packages/core/src/theme/map-palette.ts"));
const WEB_PALETTE = read(join(REPO, "apps/web/src/components/map/palette.ts"));
const NIGHTFALL = read(join(REPO, "apps/web/src/components/map/nightfall.ts"));
/** The palette's CODE, comments stripped — the two claims about what the module
 * does NOT contain are about declarations, not about prose that names them. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ENTRY_CSS = read(join(REPO, "packages/ui/styles/entry.css"));

/** Every colour a column carries, flattened: the five categories beside the
 * role keys, exactly the shape the two tables below are written in. Numbers
 * (`arcWidth`) and the two nullable separations are excluded by type. */
function colors(p: OverlayPalette): Record<string, string> {
  const out: Record<string, string> = { ...p.category };
  for (const [k, v] of Object.entries(p)) if (typeof v === "string") out[k] = v;
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

/** The `const <NAME>: OverlayPalette = { … };` body, by declaration name. */
function block(name: string): string {
  const start = SOURCE.indexOf(`const ${name}: OverlayPalette = {`);
  expect(start, `const ${name}: OverlayPalette`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf("\n};", start);
  expect(end, `end of const ${name}`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
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
    expect(STYLE_MODES).toEqual(["night", "day", "sat"]);
    expect(Object.keys(MAP_PALETTE)).toEqual(["night", "day", "sat"]);
  });

  it("defaults to day (issue #19), with night and sat still one click away", () => {
    expect(DEFAULT_STYLE_MODE).toBe("day");
  });

  it("narrows an untrusted string to a mode this build renders", () => {
    for (const mode of STYLE_MODES) expect(isStyleMode(mode)).toBe(true);
    // A persisted preference from a future release, or junk in localStorage.
    for (const junk of ["", "Night", "terrain", "sat "]) expect(isStyleMode(junk)).toBe(false);
  });

  it("homes the mode vocabulary in a vendor-free module (no mapbox import)", () => {
    // MapView.tsx imports react-map-gl + mapbox-gl.css at module scope and is
    // only ever loaded through `dynamic(…, { ssr: false })`. MapMount needs the
    // validator as a VALUE during SSR, so the vocabulary cannot live there —
    // and since #44 it lives in core, which no renderer may pull a vendor into.
    expect(SOURCE).not.toMatch(/from "(react-map-gl|mapbox-gl)/);
    expect(SOURCE).not.toMatch(/^import (?!type )/m);
  });

  it("keeps MAP_STYLES — the vendor style urls — on the vendor seam", () => {
    const mapView = read(join(REPO, "apps/web/src/components/map/MapView.tsx"));
    expect(mapView).toContain("export const MAP_STYLES: Record<StyleMode, string>");
    expect(SOURCE).not.toContain("mapbox://");
  });

  it("night is the shipped rv-* tokens, resolved from entry.css", () => {
    const night = colors(MAP_PALETTE.night);
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
    // rv-navy-deep @ 84% (pin labels) and rv-navy @ 88% (arc labels).
    expect(MAP_PALETTE.night.labelScrim).toBe("rgba(15, 23, 42, 0.84)");
    expect(MAP_PALETTE.night.arcLabelScrim).toBe("rgba(2, 6, 23, 0.88)");
  });

  it("is the vetted day column, literal for literal", () => {
    expect(colors(MAP_PALETTE.day)).toEqual(DAY_COLORS);
  });

  it("builds sat from night, overriding only the halo and the arc casing", () => {
    // The structural claim, now asserted on the objects themselves: sat IS
    // night plus three values, so no fourth role can fork by hand.
    expect(MAP_PALETTE.sat).toEqual({
      ...MAP_PALETTE.night,
      arcOpacity: 1,
      arcCasing: "rgba(2, 6, 23, 0.8)",
      halo: "#ffffff",
    });
    expect(SOURCE.slice(SOURCE.indexOf("const SAT: OverlayPalette = {"))).toContain("...NIGHT");
  });

  it("mode-keys the arc geometry, not only its colour", () => {
    // The vet's MED: the wireframe draws Day arcs at 1.8/.92 and Sat at 1.6/1
    // against Night's 1.6/.75, so width and opacity flip with the mode too.
    expect(MAP_PALETTE.night.arcWidth).toBe(1.6);
    expect(MAP_PALETTE.night.arcOpacity).toBe(0.75);
    expect(MAP_PALETTE.day.arcWidth).toBe(1.8);
    expect(MAP_PALETTE.day.arcOpacity).toBe(0.92);
    expect(MAP_PALETTE.sat.arcWidth).toBe(1.6);
    expect(MAP_PALETTE.sat.arcOpacity).toBe(1);
    expect(ARC_CASING_WIDTH).toBe(4);
  });

  it("casings the solid corridor in all three modes (docs/design/43 §2)", () => {
    // A routed corridor is SOLID, so it needs a casing everywhere — unlike the
    // estimate dash, whose casing is sat-only (`arcCasing`, asserted below).
    // Both values already existed in the table: 0.8 is sat's arcCasing, 0.9
    // white is day's two scrims. No new colour and no new rv-* token.
    expect(MAP_PALETTE.night.corridorCasing).toBe("rgba(2, 6, 23, 0.8)");
    expect(MAP_PALETTE.day.corridorCasing).toBe("rgba(255, 255, 255, 0.9)");
    // Sat inherits it from the ...NIGHT spread — never re-stated by hand.
    expect(MAP_PALETTE.sat.corridorCasing).toBe(MAP_PALETTE.night.corridorCasing);
    expect(block("SAT")).not.toContain("corridorCasing");
  });

  it("gives night and day no halo and no arc casing", () => {
    for (const mode of ["night", "day"] as const) {
      expect(MAP_PALETTE[mode].halo, `${mode}.halo`).toBeNull();
      expect(MAP_PALETTE[mode].arcCasing, `${mode}.arcCasing`).toBeNull();
    }
  });

  it("holds no colour var(--…) — Mapbox paint cannot read custom properties", () => {
    for (const mode of STYLE_MODES) {
      for (const value of Object.values(colors(MAP_PALETTE[mode]))) {
        expect(value, `${mode}: ${value}`).not.toContain("var(--");
      }
    }
    // `markerShadow` composes `var(--shadow-rv-*)`, which is fine: that string
    // lands on a DOM marker's inline style, never in a Mapbox paint property —
    // and it is the one thing that stayed behind in the web's file.
    expect(CODE).not.toContain("var(--");
  });

  it("leaves the web's palette.ts a re-export with no value of its own", () => {
    // #44 i3: the table moved to core so the phone reads the same three columns.
    // Every existing import path still resolves — MapView.tsx:10-16 and
    // MapMount.tsx:7 are untouched — because this file re-exports them.
    expect(WEB_PALETTE).toContain('from "@rv-trip/core"');
    expect(WEB_PALETTE).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(WEB_PALETTE).not.toContain("rgba(");
    expect(WEB_PALETTE).not.toMatch(/const (NIGHT|DAY|SAT|MAP_PALETTE)\b/);
    // …except the one thing that is genuinely a CSS concern.
    expect(WEB_PALETTE).toContain("export function markerShadow(");
    expect(CODE).not.toContain("markerShadow");
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
    expect(CODE).not.toContain("@theme");
  });
});
