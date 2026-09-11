import type { RvCategory } from "./tokens";

/**
 * The map's three-mode overlay palette (issue #12), shared by both renderers.
 *
 * ── Why this file lives in core ──────────────────────────────────────────
 * It was `apps/web/src/components/map/palette.ts` until #44: the phone's Map
 * lens paints the same three columns, and a second copy of a colour table is a
 * fork waiting to happen. It sits beside `tokens.ts`, which exists for exactly
 * this reason — "clients that cannot read CSS custom properties (React Native,
 * map SDKs)". The web file is now a re-export (the shape `trip-logic.ts` took
 * in #31's C0), so every existing import path still resolves, and it keeps the
 * one thing that is genuinely a DOM concern: `markerShadow`, which composes a
 * CSS `box-shadow`.
 *
 * ── Why this table exists ─────────────────────────────────────────────────
 * Swapping the basemap is one line. Everything drawn *on top of* it is not:
 * every pin, label, leader and arc in the web's `MapView` is a Night literal — either a
 * Tailwind `rv-*` class or an inline hex — and every one of them is unreadable
 * over `outdoors-v12`. So the overlay is a table of roles, keyed by mode, and
 * this is that table.
 *
 * ── Provenance ───────────────────────────────────────────────────────────
 * The **night** column is not a new palette: every value is what its `rv-*`
 * token resolves to in the DARK half of `packages/ui/styles/entry.css`, with
 * the token name in a comment beside it — the same discipline `NIGHTFALL_PAINT`
 * uses (apps/web/src/components/map/nightfall.ts:5-9), and guarded against
 * drift by `map-palette.test.ts` beside this file. The **day** and **sat**
 * columns are map-only literals: no `rv-*` token is added, so the `toEqual`
 * token contract in `nightfall-tokens.test.ts` stays green untouched.
 *
 * Values are literals rather than `var(--…)` because Mapbox paint properties
 * cannot read CSS custom properties, and one vocabulary for the whole overlay
 * beats two.
 *
 * ── Scope: the canvas flips, the chrome does not ─────────────────────────
 * Only what is drawn on the map canvas is mode-keyed. App chrome — the layer
 * chips, the category filter row above the canvas, the 360px rail, every
 * `FilterChip` swatch resolving through `categoryMeta`
 * (packages/ui/src/category.ts:33-57) — follows the app theme in all three
 * modes.
 * The map is a window onto vendor cartography and has to survive whatever is
 * behind it; the app around it does not. That is why the Day chip row can read
 * `rv-green` beside a `#2e8b4e` pin for the same category, and why
 * `categoryMeta` is not touched by this issue: the category *meanings* never
 * move, and the legend is chrome.
 *
 * This module is deliberately vendor-free — no `react-map-gl`, no `mapbox-gl`,
 * no `@rnmapbox/maps`, and (since the move) not even a type from `@rv-trip/ui`:
 * the five-category language is core's own `RvCategory`, identical to ui's
 * `CategoryLabel` minus the icons. `MapMount` runs during SSR and needs
 * `isStyleMode` as a runtime value, and a value import of anything in
 * `MapView.tsx` would drag `mapbox-gl` (which touches `window` at import time)
 * into the server bundle.
 */

export const STYLE_MODES = ["night", "day", "sat"] as const;

export type StyleMode = (typeof STYLE_MODES)[number];

/** The default. Day is the basemap that reads under either app theme; night
 * and sat stay one click away in the #12 style toggle. */
export const DEFAULT_STYLE_MODE: StyleMode = "day";

/** Narrow an untrusted string — a persisted preference, a stale value from a
 * future release — to a mode this build actually renders. */
export function isStyleMode(value: string): value is StyleMode {
  return (STYLE_MODES as readonly string[]).includes(value);
}

export interface OverlayPalette {
  /** Saved-place teardrop grounds, per category. Meanings are fixed; only the
   * values flip. */
  category: Record<RvCategory, string>;
  /** The teardrop's inner dot on a "want" place. */
  dropDot: string;
  /** Stop-disc stroke — planning and been alike. */
  discStroke: string;
  /** Stop-disc fill, planning only. */
  discFill: string;
  /** Stop-disc numeral, planning only. */
  discInk: string;
  /** The hollow ground behind a been disc, a floating disc, and a been
   * teardrop's body (MapView.tsx StopDisc + PlaceDrop both). */
  hollowGround: string;
  /** A floating stop's dashed stroke — and its ◇, which takes the same value. */
  floatingStroke: string;
  selFill: string;
  selStroke: string;
  selInk: string;
  arcLine: string;
  arcWidth: number;
  arcOpacity: number;
  /** A wide dark line *under* the arc, so a dashed estimate survives satellite
   * imagery. Null where the basemap is flat enough not to need one. */
  arcCasing: string | null;
  /** The casing under a SOLID routed corridor (docs/design/43 §2). Unlike
   * `arcCasing` this is never null: a corridor is a continuous line and needs
   * separation from the roads it runs along in all three modes. */
  corridorCasing: string;
  labelScrim: string;
  labelInk: string;
  labelInkSelected: string;
  arcLabelScrim: string;
  arcLabelBorder: string;
  arcLabelInk: string;
  /** The dashed spiderfy leader back to a nudged pin's true coordinate. */
  leader: string;
  /** A 1.5px ring outside every marker's own shadow, so a pin reads against
   * imagery of any tone. Null where the basemap is uniform enough. */
  halo: string | null;
}

const NIGHT: OverlayPalette = {
  category: {
    Stay: "#34d399", // --color-rv-green
    Eat: "#fbbf24", // --color-rv-warning
    Do: "#22d3ee", // --color-rv-info-ink
    Travel: "#a78bfa", // --color-rv-travel
    Other: "#94a3b8", // --color-rv-ink-faded
  },
  dropDot: "#020617", // --color-rv-navy
  discStroke: "#34d399", // --color-rv-green
  discFill: "#022c22", // --color-rv-green-soft
  discInk: "#6ee7b7", // --color-rv-green-ink
  hollowGround: "#0f172a", // --color-rv-navy-deep
  floatingStroke: "#fbbf24", // --color-rv-warning
  selFill: "#38bdf8", // --color-rv-accent
  selStroke: "#7dd3fc", // --color-rv-accent-bright
  selInk: "#020617", // --color-rv-navy
  arcLine: "#38bdf8", // --color-rv-accent
  arcWidth: 1.6,
  arcOpacity: 0.75,
  arcCasing: null,
  corridorCasing: "rgba(2, 6, 23, 0.8)", // rv-navy at 80%
  labelScrim: "rgba(15, 23, 42, 0.84)", // rv-navy-deep at 84%
  labelInk: "#cbd5e1", // --color-rv-ink-muted
  labelInkSelected: "#7dd3fc", // --color-rv-accent-bright
  arcLabelScrim: "rgba(2, 6, 23, 0.88)", // rv-navy at 88%
  arcLabelBorder: "#082f49", // --color-rv-accent-soft
  arcLabelInk: "#38bdf8", // --color-rv-accent
  leader: "#475569", // --color-rv-border-hi
  halo: null,
};

/**
 * `outdoors-v12`, stock and untouched. Six values come straight from issue
 * #12's table (the five categories plus the day route tone). These are
 * map-only literals and #19 does not re-trace them: they are tuned to
 * `outdoors-v12`, not to the app's palette. The rest are derived, not chosen:
 * white is the value the issue already names for the sat halo and does the
 * same job here — a pin's own chip ground, independent of the basemap; day
 * floating reuses the day amber, because night floating already reuses
 * rv-warning.
 */
const DAY: OverlayPalette = {
  category: {
    Stay: "#2e8b4e",
    Eat: "#97601c",
    Do: "#23697d",
    Travel: "#5c5470",
    Other: "#5d6b7d",
  },
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
  arcWidth: 1.8,
  arcOpacity: 0.92,
  arcCasing: null,
  corridorCasing: "rgba(255, 255, 255, 0.9)",
  labelScrim: "rgba(255, 255, 255, 0.9)",
  labelInk: "#0a1520",
  labelInkSelected: "#c14d20",
  arcLabelScrim: "rgba(255, 255, 255, 0.9)",
  arcLabelBorder: "#c14d20",
  arcLabelInk: "#c14d20",
  leader: "rgba(10, 21, 32, 0.45)",
  halo: null,
};

/**
 * `satellite-streets-v12`. The overlay is night's — a scrim at .84–.88 alpha
 * is the one treatment that is independent of whatever imagery happens to be
 * underneath, so there is nothing to tune per tile. What imagery *does* need
 * is separation: a white halo outside every marker, and a dark casing under
 * every arc. Built as a spread of night so the two can never fork by hand.
 * `corridorCasing` is inherited rather than overridden — night's value is
 * already the rv-navy-at-80% casing sat wants.
 */
const SAT: OverlayPalette = {
  ...NIGHT,
  arcOpacity: 1,
  arcCasing: "rgba(2, 6, 23, 0.8)", // rv-navy at 80%
  halo: "#ffffff",
};

export const MAP_PALETTE: Record<StyleMode, OverlayPalette> = {
  night: NIGHT,
  day: DAY,
  sat: SAT,
};

/** The width of the casing line under a sat arc. */
export const ARC_CASING_WIDTH = 4;
