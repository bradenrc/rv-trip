"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, Marker, Source, type MapRef } from "react-map-gl/mapbox";
import type { MapEvent } from "react-map-gl/mapbox";
import { boundsFor, spiderfy, type SpiderPoint } from "@rv-trip/core";
import { categoryMeta } from "@rv-trip/ui";
import "mapbox-gl/dist/mapbox-gl.css";
import { applyNightfall } from "./nightfall";
import type { DriveArc, MapPin } from "./pins";

/**
 * The one map component. Three surfaces speak to it: the /map overview (pins,
 * arcs, labels, selection), the stop-detail mini-map (one pin, pan/zoom only)
 * and the Places library's map lens (the already-filtered shelf).
 *
 * It never filters — it draws exactly the pins it is handed — and it holds no
 * vendor code outside this directory.
 */

export const MAPBOX_STYLE = "mapbox://styles/mapbox/dark-v11";

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
}

export function MapView({
  pins,
  arcs = [],
  selectedId = null,
  onSelect,
  showLabels = true,
  height,
  token,
}: MapViewProps) {
  const ref = useRef<MapRef | null>(null);

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

  const onLoad = useCallback((e: MapEvent) => {
    applyNightfall(e.target);
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
  }, [boundsKey]);

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
      mapStyle={MAPBOX_STYLE}
      initialViewState={{ longitude: -116, latitude: 42, zoom: 3.4 }}
      onLoad={onLoad}
      style={height ? { height, width: "100%" } : { height: "100%", width: "100%" }}
      cooperativeGestures
    >
      {arcs.length > 0 && (
        <Source id="rv-drive-arcs" type="geojson" data={arcGeoJson}>
          <Layer
            id="rv-drive-arcs-line"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{
              // --color-rv-ember (packages/ui/styles/entry.css)
              "line-color": "#f28c5e",
              "line-width": 1.6,
              "line-opacity": 0.75,
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
            className="whitespace-nowrap rounded-rv-pill border border-rv-ember-soft px-1.5 py-0.5 font-mono text-[9.5px] text-rv-ember"
            style={{ background: "rgba(10, 21, 32, 0.88)" }}
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
              {at?.spiderfied && <SpiderLeader dx={dx} dy={dy} />}
              {pin.kind === "stop" ? <StopDisc pin={pin} selected={selected} /> : <PlaceDrop pin={pin} selected={selected} />}
              {showLabels && (
                <span
                  className={`pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-rv-sm px-[5px] py-px font-mono text-[9.5px] ${
                    selected ? "text-rv-ember-bright" : "text-rv-ink-muted"
                  }`}
                  style={{ background: "rgba(8, 24, 43, 0.84)" }}
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
function SpiderLeader({ dx, dy }: { dx: number; dy: number }) {
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 border-t border-dashed border-rv-border-hi"
      style={{ width: length, transformOrigin: "0 0", transform: `rotate(${angle}deg)` }}
    />
  );
}

/**
 * A trip stop: a numbered disc, green because that is the shipped stop language
 * (StopBar, packages/ui/src/Gantt.tsx:130). Filled = ahead of you, hollow = been
 * there. A floating stop is an amber dashed disc with no ordinal — it has no
 * position in the drive sequence, so it gets no number and no arc.
 */
function StopDisc({ pin, selected }: { pin: Extract<MapPin, { kind: "stop" }>; selected: boolean }) {
  const been = pin.layer === "been";
  const base =
    "flex size-[27px] items-center justify-center rounded-rv-pill border-2 font-mono text-[12px] font-bold";
  if (selected) {
    return (
      <div
        className={`${base} border-rv-ember-bright bg-rv-ember text-rv-navy`}
        style={{
          boxShadow:
            "var(--shadow-rv-xl), 0 0 0 5px color-mix(in srgb, var(--color-rv-ember) 22%, transparent)",
        }}
      >
        {pin.floating ? "◇" : pin.ordinal}
      </div>
    );
  }
  if (pin.floating) {
    return (
      <div
        className={`${base} border-dashed border-rv-warning bg-rv-navy-deep text-[13px] text-rv-warning shadow-rv-md`}
      >
        ◇
      </div>
    );
  }
  return (
    <div
      className={
        been
          ? `${base} border-rv-green bg-rv-navy-deep text-rv-green shadow-rv-md`
          : `${base} border-rv-green bg-rv-green-soft text-rv-green-ink shadow-rv-lg`
      }
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
function PlaceDrop({ pin, selected }: { pin: Extract<MapPin, { kind: "place" }>; selected: boolean }) {
  const color = categoryMeta(pin.type).color;
  const been = pin.status === "been";
  return (
    <div
      className="size-[19px] border-2 shadow-rv-md"
      style={{
        borderRadius: "50% 50% 50% 0",
        transform: "rotate(-45deg)",
        background: been ? "var(--color-rv-navy-deep)" : color,
        borderColor: been ? color : "transparent",
        ...(selected
          ? {
              boxShadow:
                "var(--shadow-rv-xl), 0 0 0 5px color-mix(in srgb, var(--color-rv-ember) 22%, transparent)",
            }
          : {}),
      }}
    >
      <div
        className="mx-auto mt-1 size-1.5 rounded-full"
        style={{ background: been ? color : "var(--color-rv-navy)" }}
      />
    </div>
  );
}

export default MapView;
