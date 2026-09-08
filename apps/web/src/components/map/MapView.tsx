"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, Marker, Source, type MapRef } from "react-map-gl/mapbox";
import type { MapEvent } from "react-map-gl/mapbox";
import { boundsFor, spiderfy, type SpiderPoint } from "@rv-trip/core";
import "mapbox-gl/dist/mapbox-gl.css";
import { applyNightfall } from "./nightfall";
import {
  ARC_CASING_WIDTH,
  MAP_PALETTE,
  markerShadow,
  type OverlayPalette,
  type StyleMode,
} from "./palette";
import type { DriveArc, MapPin } from "./pins";

/**
 * The one map component. Three surfaces speak to it: the /map overview (pins,
 * arcs, labels, selection), the stop-detail mini-map (one pin, pan/zoom only)
 * and the Places library's map lens (the already-filtered shelf).
 *
 * It never filters — it draws exactly the pins it is handed — and it holds no
 * vendor code outside this directory.
 */

/**
 * The vendor style url per mode. This file is the vendor seam — the only place
 * a `mapbox://` string belongs — but the mode *vocabulary* is not here: it
 * lives in `./palette`, because `MapMount` has to validate a persisted mode
 * during SSR and a value import from this module would drag `mapbox-gl` (which
 * touches `window` at import time) into the server bundle.
 *
 * Day and Sat are stock cartography, untouched. Only Night is repainted, by
 * `applyNightfall`.
 */
export const MAP_STYLES: Record<StyleMode, string> = {
  night: "mapbox://styles/mapbox/dark-v11",
  day: "mapbox://styles/mapbox/outdoors-v12",
  sat: "mapbox://styles/mapbox/satellite-streets-v12",
};

export interface MapViewProps {
  pins: MapPin[];
  /** Estimated-drive arcs. Overview only; the mini-map and the lens draw none. */
  arcs?: DriveArc[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Name labels under each pin. Off for the mini-map, where the sheet already
   * names the stop directly under the frame. */
  showLabels?: boolean;
  /** CSS length. Omit to fill the cell. */
  height?: string;
  token: string;
  /** Which basemap, and which overlay palette with it. Resolved by `MapMount`
   * before this chunk mounts, so the first style request is the right one. */
  mode: StyleMode;
}

export function MapView({
  pins,
  arcs = [],
  selectedId = null,
  onSelect,
  showLabels = true,
  height,
  token,
  mode,
}: MapViewProps) {
  const ref = useRef<MapRef | null>(null);
  const palette = MAP_PALETTE[mode];

  // Deterministic spiderfy: a trip stop anchors its group and the saved places
  // sitting on its exact coordinate are the ones that move.
  const placements = useMemo(() => {
    const input: SpiderPoint[] = pins.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      anchor: p.kind === "stop",
    }));
    return new Map(spiderfy(input).map((s) => [s.id, s]));
  }, [pins]);

  const bounds = useMemo(() => boundsFor(pins), [pins]);
  // Re-fit whenever the visible set changes — toggling a layer chip re-fits.
  const boundsKey = bounds ? `${bounds.west},${bounds.south},${bounds.east},${bounds.north}` : "";

  useEffect(() => {
    if (!bounds) return;
    ref.current?.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: 56, maxZoom: 11, duration: 600 },
    );
    // `bounds` is rebuilt on every render; the string key is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  // The Nightfall repaint is STYLE-owned, not map-owned: `setStyle` throws away
  // every `setPaintProperty` write, and `load` fires once per map while
  // `style.load` fires once per style. So it hangs off `style.load`, re-bound
  // whenever the mode changes, and detached on unmount. Day and Sat get no
  // equivalent — stock cartography, untouched.
  useEffect(() => {
    const map = ref.current?.getMap();
    if (!map) return;
    const repaint = () => {
      if (mode === "night") applyNightfall(map);
    };
    map.on("style.load", repaint);
    return () => {
      map.off("style.load", repaint);
    };
  }, [mode]);

  // The fitBounds stays on `load`, deliberately: moved to `style.load` with the
  // repaint, every style swap would re-frame the camera.
  const onLoad = useCallback((e: MapEvent) => {
    // The first style is already loaded when `load` fires, so its repaint is
    // here rather than on the listener above.
    if (mode === "night") applyNightfall(e.target);
    if (bounds) {
      e.target.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 56, maxZoom: 11, duration: 0 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, mode]);

  const arcGeoJson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: arcs.map((a) => ({
        type: "Feature" as const,
        properties: { id: a.id },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [a.from.lng, a.from.lat],
            [a.to.lng, a.to.lat],
          ],
        },
      })),
    }),
    [arcs],
  );

  return (
    <MapGL
      ref={ref}
      mapboxAccessToken={token}
      mapStyle={MAP_STYLES[mode]}
      initialViewState={{ longitude: -116, latitude: 42, zoom: 3.4 }}
      onLoad={onLoad}
      style={height ? { height, width: "100%" } : { height: "100%", width: "100%" }}
      cooperativeGestures
    >
      {arcs.length > 0 && (
        <Source id="rv-drive-arcs" type="geojson" data={arcGeoJson}>
          {/* Beneath the dashes, and only where the ground is imagery: a solid
              dark casing is what keeps a thin dashed estimate readable over
              satellite tiles. */}
          {palette.arcCasing && (
            <Layer
              id="rv-drive-arcs-casing"
              type="line"
              layout={{ "line-cap": "round" }}
              paint={{
                "line-color": palette.arcCasing,
                "line-width": ARC_CASING_WIDTH,
              }}
            />
          )}
          <Layer
            id="rv-drive-arcs-line"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": palette.arcLine,
              "line-width": palette.arcWidth,
              "line-opacity": palette.arcOpacity,
              "line-dasharray": [2.2, 1.8],
            }}
          />
        </Source>
      )}

      {arcs.map((a) => (
        <Marker
          key={`label-${a.id}`}
          longitude={(a.from.lng + a.to.lng) / 2}
          latitude={(a.from.lat + a.to.lat) / 2}
        >
          <span
            className="whitespace-nowrap rounded-rv-pill border px-1.5 py-0.5 font-mono text-[9.5px]"
            style={{
              background: palette.arcLabelScrim,
              borderColor: palette.arcLabelBorder,
              color: palette.arcLabelInk,
            }}
          >
            {a.label}
          </span>
        </Marker>
      ))}

      {pins.map((pin) => {
        const at = placements.get(pin.id);
        const dx = at?.dx ?? 0;
        const dy = at?.dy ?? 0;
        const selected = pin.id === selectedId;
        return (
          <Marker
            key={pin.id}
            longitude={pin.lng}
            latitude={pin.lat}
            offset={[dx, dy]}
            style={{ zIndex: selected ? 3 : pin.kind === "stop" ? 2 : 1, cursor: onSelect ? "pointer" : "default" }}
            onClick={onSelect ? () => onSelect(pin.id) : undefined}
          >
            <div className="relative">
              {at?.spiderfied && <SpiderLeader dx={dx} dy={dy} palette={palette} />}
              {pin.kind === "stop" ? (
                <StopDisc pin={pin} selected={selected} palette={palette} />
              ) : (
                <PlaceDrop pin={pin} selected={selected} palette={palette} />
              )}
              {showLabels && (
                <span
                  className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-rv-sm px-[5px] py-px font-mono text-[9.5px]"
                  style={{
                    background: palette.labelScrim,
                    color: selected ? palette.labelInkSelected : palette.labelInk,
                  }}
                >
                  {pin.name}
                </span>
              )}
            </div>
          </Marker>
        );
      })}
    </MapGL>
  );
}

/** 1px dashed leader from a nudged pin back to its true coordinate. */
function SpiderLeader({ dx, dy, palette }: { dx: number; dy: number; palette: OverlayPalette }) {
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 border-t border-dashed"
      style={{
        width: length,
        borderTopColor: palette.leader,
        transformOrigin: "0 0",
        transform: `rotate(${angle}deg)`,
      }}
    />
  );
}

/**
 * A trip stop: a numbered disc, green because that is the shipped stop language
 * (StopBar, packages/ui/src/Gantt.tsx:130). Filled = ahead of you, hollow = been
 * there. A floating stop is an amber dashed disc with no ordinal — it has no
 * position in the drive sequence, so it gets no number and no arc.
 */
function StopDisc({
  pin,
  selected,
  palette,
}: {
  pin: Extract<MapPin, { kind: "stop" }>;
  selected: boolean;
  palette: OverlayPalette;
}) {
  const been = pin.layer === "been";
  // Layout only. Every colour on this disc used to be a Tailwind `rv-*` class,
  // and every one of those was a Night literal frozen into a class name — so
  // colour moves to the palette and the geometry stays where it was.
  const base =
    "flex size-[27px] items-center justify-center rounded-rv-pill border-2 font-mono text-[12px] font-bold";
  if (selected) {
    return (
      <div
        className={base}
        style={{
          borderColor: palette.selStroke,
          background: palette.selFill,
          color: palette.selInk,
          boxShadow: markerShadow("xl", palette, true),
        }}
      >
        {pin.floating ? "◇" : pin.ordinal}
      </div>
    );
  }
  if (pin.floating) {
    return (
      <div
        className={`${base} border-dashed text-[13px]`}
        style={{
          borderColor: palette.floatingStroke,
          background: palette.hollowGround,
          color: palette.floatingStroke,
          boxShadow: markerShadow("md", palette, false),
        }}
      >
        ◇
      </div>
    );
  }
  return (
    <div
      className={base}
      style={{
        borderColor: palette.discStroke,
        background: been ? palette.hollowGround : palette.discFill,
        color: been ? palette.discStroke : palette.discInk,
        boxShadow: markerShadow(been ? "md" : "lg", palette, false),
      }}
    >
      {pin.ordinal}
    </div>
  );
}

/**
 * A saved place: a category-coloured teardrop. Filled = want to go, hollow =
 * been there — the same filled/hollow rule the stop discs use, so one rule reads
 * across the whole map.
 */
function PlaceDrop({
  pin,
  selected,
  palette,
}: {
  pin: Extract<MapPin, { kind: "place" }>;
  selected: boolean;
  palette: OverlayPalette;
}) {
  // The five-category *meanings* are unchanged — `pin.category` is still
  // resolved through `categoryMeta` (pins.ts:217). Only the value flips, and
  // only on the canvas: the chip row above the map keeps the Nightfall swatch.
  const color = palette.category[pin.category];
  const been = pin.status === "been";
  return (
    <div
      className="size-[19px] border-2"
      style={{
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        background: been ? palette.hollowGround : color,
        borderColor: been ? color : "transparent",
        boxShadow: markerShadow(selected ? "xl" : "md", palette, selected),
      }}
    >
      <div
        className="mx-auto mt-1 size-1.5 rounded-full"
        style={{ background: been ? color : palette.dropDot }}
      />
    </div>
  );
}

export default MapView;
