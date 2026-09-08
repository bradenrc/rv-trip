import type { Map as MapboxMap } from "mapbox-gl";

/**
 * The Nightfall paint contract.
 *
 * Mapbox can't read CSS custom properties, so the runtime restyle of `dark-v11`
 * passes literals. Every literal here is the value its `rv-*` token resolves to
 * in the DARK half of packages/ui/styles/entry.css (mirrored, and in agreement,
 * at apps/web/src/app/globals.css) — the token name ships beside it so a token
 * change stays a one-line diff instead of a hunt for a stray hex. No value below
 * is outside the token vocabulary.
 *
 * Layer ids belong to Mapbox's style, not to us: a renamed or removed layer
 * would make `setPaintProperty` throw at load and blank the route. Every write
 * is therefore guarded on the layer actually existing, and the property is
 * resolved from the layer's own type rather than assumed.
 */

interface PaintRow {
  /** Basemap role, for the diff that follows a token change. */
  role: string;
  /** dark-v11 layer ids this role paints. */
  layers: string[];
  /** The rv-* token this literal comes from. */
  token: string;
  color: string;
}

export const NIGHTFALL_PAINT: PaintRow[] = [
  { role: "Water", layers: ["water", "waterway"], token: "--color-rv-navy", color: "#020617" },
  {
    role: "Land / background",
    layers: ["background", "land"],
    token: "--color-rv-surface-alt",
    color: "#0f172a",
  },
  {
    role: "Road hairline",
    layers: ["road-minor", "road-street"],
    token: "--color-rv-border",
    color: "#334155",
  },
  {
    role: "Road major",
    layers: ["road-primary", "road-motorway"],
    token: "--color-rv-border-hi",
    color: "#475569",
  },
  {
    role: "Place labels",
    layers: ["settlement-label", "poi-label"],
    token: "--color-rv-ink-faded",
    color: "#94a3b8",
  },
  {
    role: "Parks / green areas",
    layers: ["landuse", "national-park", "landuse-overlay"],
    token: "--color-rv-green-soft",
    color: "#022c22",
  },
];

/** The colour property a layer type actually accepts. */
type PaintProperty = Parameters<MapboxMap["setPaintProperty"]>[1];

const COLOR_PROPERTY: Record<string, PaintProperty> = {
  background: "background-color",
  fill: "fill-color",
  line: "line-color",
  symbol: "text-color",
  "fill-extrusion": "fill-extrusion-color",
  circle: "circle-color",
  heatmap: "heatmap-color",
};

/**
 * Repaint the vendor basemap into Nightfall. Safe to call on every `style.load`
 * — a layer that isn't in the style is skipped, never thrown on.
 */
export function applyNightfall(map: MapboxMap): void {
  for (const row of NIGHTFALL_PAINT) {
    for (const id of row.layers) {
      const layer = map.getLayer(id);
      if (!layer) continue;
      const prop = COLOR_PROPERTY[layer.type];
      if (!prop) continue;
      try {
        map.setPaintProperty(id, prop, row.color);
      } catch {
        // A layer that exists but rejects the property is a style change on
        // Mapbox's side, not a reason to blank the map.
      }
    }
  }
}
