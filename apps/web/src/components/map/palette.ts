import type { OverlayPalette } from "@rv-trip/core";

/**
 * The map's overlay palette, as the web imports it.
 *
 * The table itself moved to `packages/core/src/theme/map-palette.ts` in #44:
 * the phone's Map lens paints the same three columns, and a second copy of a
 * colour table is a fork waiting to happen. This file stays a re-export — the
 * shape `@/lib/trip-logic` took when #31's C0 lifted the planner into core — so
 * every import path in `MapView.tsx`, `MapMount.tsx` and `MapOverview.tsx`
 * keeps resolving unchanged.
 *
 * `markerShadow` is the one thing that did NOT move: it composes a CSS
 * `box-shadow` string (`var(--shadow-rv-*)` and `color-mix()`) for a DOM
 * marker's inline style. That is a browser concern, not a palette value, and
 * React Native has no equivalent.
 */

export {
  ARC_CASING_WIDTH,
  DEFAULT_STYLE_MODE,
  MAP_PALETTE,
  STYLE_MODES,
  isStyleMode,
} from "@rv-trip/core";
export type { OverlayPalette, StyleMode } from "@rv-trip/core";

/**
 * A DOM marker's full `box-shadow`: its own depth shadow, then — on sat — the
 * halo ring, then the selection ring outside both. The order is the whole
 * point: a ring cannot be appended to a Tailwind `shadow-rv-*` class, which is
 * why these markers carry their shadow inline.
 */
export function markerShadow(
  depth: "sm" | "md" | "lg" | "xl",
  palette: OverlayPalette,
  selected: boolean,
): string {
  const parts = [`var(--shadow-rv-${depth})`];
  if (palette.halo) parts.push(`0 0 0 1.5px ${palette.halo}`);
  if (selected) {
    // The selection ring always sits outside the halo, so it grows by its width.
    parts.push(
      `0 0 0 ${palette.halo ? 6.5 : 5}px color-mix(in srgb, ${palette.selFill} 22%, transparent)`,
    );
  }
  return parts.join(", ");
}
