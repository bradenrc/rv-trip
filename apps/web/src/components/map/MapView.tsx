"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, Marker, Source, type MapRef } from "react-map-gl/mapbox";
import type { MapEvent } from "react-map-gl/mapbox";
import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import {
  boundsCovers,
  boundsFor,
  boundsKey,
  spiderfy,
  type Bounds,
  type SpiderPoint,
} from "@rv-trip/core";
import "mapbox-gl/dist/mapbox-gl.css";
import { applyNightfall } from "./nightfall";
import { ARC_CASING_WIDTH, MAP_PALETTE, type StyleMode } from "./palette";
import { ArcLabel, PinMark, labelAt, markerTier } from "./markers";
import type { DriveArc, MapPin } from "./pins";

/**
 * The one map component. Three surfaces speak to it: the /map overview (pins,
 * arcs, labels, selection), the destination-detail mini-map (one pin, pan/zoom only)
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

/**
 * The one predicate the whole drive-arc grammar is painted by: did HERE answer
 * for this pair? Solid corridor when it did, the shipped dash when it did not
 * (docs/design/43 §2). It is a data-driven expression rather than two sources
 * so a drive rendered twice is unrepresentable.
 */
const ROUTED: ExpressionSpecification = ["==", ["get", "source"], "here"];

/** A routed corridor is drawn heavier than the estimate chord it replaces —
 * it is a road, not a guess. The estimate keeps `palette.arcWidth`. */
const CORRIDOR_WIDTH = 2.6;

export interface MapViewProps {
  pins: MapPin[];
  /** Drive arcs: a solid HERE corridor where one was resolved, the dashed
   * straight-line estimate where it was not. Overview only; the mini-map and
   * the lens draw none. */
  arcs?: DriveArc[];
  /** #179 · the Journal map's join: `[lng, lat]` destinations in date order.
   * ONE straight dashed line at the estimate's paint — never routed, never
   * labelled. The drive arcs above are untouched by it. */
  join?: [number, number][];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Name labels under each pin. Off for the mini-map, where the sheet already
   * names the destination directly under the frame. */
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
  join = [],
  selectedId = null,
  onSelect,
  showLabels = true,
  height,
  token,
  mode,
}: MapViewProps) {
  const ref = useRef<MapRef | null>(null);
  const palette = MAP_PALETTE[mode];

  // Deterministic spiderfy: a trip destination anchors its group and the saved places
  // sitting on its exact coordinate are the ones that move.
  const placements = useMemo(() => {
    const input: SpiderPoint[] = pins.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      anchor: p.kind === "destination",
    }));
    return new Map(spiderfy(input).map((s) => [s.id, s]));
  }, [pins]);

  // The camera holds the corridor, not only the pins: US-101 runs west of both
  // Astoria and Newport, so a routed drive's box is wider than its endpoints'.
  // An estimate contributes exactly its two endpoints, so nothing moves on a
  // map with no routed drive on it.
  const bounds = useMemo(
    () =>
      boundsFor([
        ...pins,
        ...arcs.flatMap((a) => a.path.map(([lng, lat]) => ({ lat, lng }))),
      ]),
    [pins, arcs],
  );
  // `bounds` is rebuilt on every render; the string key is the real dependency
  // (core's `boundsKey`, so the phone's lens keys its own re-fit identically).
  const key = boundsKey(bounds);

  /**
   * Re-fit when the visible set changes — but only when it changes something
   * the camera is not already showing (#80 i4).
   *
   * The shelf lets an idea sit anywhere on the trip, so the pin set now grows
   * genuine outliers, and the old unconditional re-fit made that hostile: every
   * located idea, every chip toggle, every refresh threw the camera back to the
   * whole-set box and undid the reader's own pan and zoom. `boundsCovers` asks
   * the one question worth asking — is the new box already on screen? — and
   * skips the fit when it is. A FAR-FLUNG idea is not covered, so the map does
   * re-fit and actually shows it: the outlier still wins, the neighbour no
   * longer interrupts.
   */
  useEffect(() => {
    if (!bounds) return;
    const map = ref.current?.getMap();
    if (!map) return;
    if (boundsCovers(shownBounds(map), bounds)) return;
    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: 56, maxZoom: 11, duration: 600 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
  }, [key, mode]);

  const arcGeoJson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: arcs.map((a) => ({
        type: "Feature" as const,
        // `source` is what every layer below filters or cases on. The geometry
        // is already decoded (pins.ts) — N corridor vertices, or the two
        // endpoints of a chord.
        properties: { id: a.id, source: a.source },
        geometry: {
          type: "LineString" as const,
          coordinates: a.path,
        },
      })),
    }),
    [arcs],
  );

  const joinGeoJson = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates: join },
    }),
    [join],
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
          {/* One casing, under a SOLID corridor in every mode — a continuous
              line needs separating from the roads it runs along. An estimate
              keeps exactly the casing its mode already gave it: sat only,
              where `arcCasing` is the same rv-navy-at-80% value this is, and
              none at all in night or day. */}
          <Layer
            id="rv-drive-arcs-casing"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": palette.corridorCasing,
              "line-width": ARC_CASING_WIDTH,
              "line-opacity": ["case", ROUTED, 1, palette.arcCasing ? 1 : 0],
            }}
          />
          {/* The corridor itself. An estimate draws nothing here — its visible
              path is the dash layer below, at the paint it has always had. */}
          <Layer
            id="rv-drive-arcs-line"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": palette.arcLine,
              "line-width": ["case", ROUTED, CORRIDOR_WIDTH, palette.arcWidth],
              "line-opacity": ["case", ROUTED, 1, 0],
            }}
          />
          {/* `line-dasharray` is not data-driven in mapbox-gl 3.30, so the dash
              is its own filtered layer rather than a case on the one above —
              the single place this grammar is 1 source / 2 line layers. The
              paint is the shipped estimate's, unchanged. */}
          <Layer
            id="rv-drive-arcs-dash"
            type="line"
            filter={["==", ["get", "source"], "estimate"]}
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

      {join.length > 1 && (
        <Source id="rv-journal-join" type="geojson" data={joinGeoJson}>
          {/* #179 · the Journal's join: one dashed line, the estimate's paint,
              no casing and no label. */}
          <Layer
            id="rv-journal-join-dash"
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

      {arcs.map((a) => {
        const [lng, lat] = labelAt(a);
        return (
          <Marker key={`label-${a.id}`} longitude={lng} latitude={lat}>
            <ArcLabel label={a.label} palette={palette} />
          </Marker>
        );
      })}

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
            style={{
              zIndex: markerTier(pin, selected),
              cursor: onSelect ? "pointer" : "default",
            }}
            onClick={onSelect ? () => onSelect(pin.id) : undefined}
          >
            <PinMark pin={pin} at={at} selected={selected} palette={palette} showLabels={showLabels} />
          </Marker>
        );
      })}
    </MapGL>
  );
}

/**
 * What the camera is showing right now, as core's `Bounds`.
 *
 * The vendor seam for the re-fit guard: `getBounds()` is a `LngLatBounds` with
 * accessor methods, and `boundsCovers` (bounds.ts) is pure geometry that has
 * never heard of Mapbox. It returns null before the map has a projection.
 */
function shownBounds(map: MapboxMap): Bounds | null {
  const b = map.getBounds();
  if (!b) return null;
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}


export default MapView;
