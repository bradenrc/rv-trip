"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  GOOGLE_WEB_BASEMAP,
  boundsCovers,
  boundsFor,
  boundsKey,
  spiderfy,
  type Bounds,
  type SpiderPoint,
} from "@rv-trip/core";
import { MapFrame } from "@rv-trip/ui";
import { ARC_CASING_WIDTH, MAP_PALETTE, type OverlayPalette } from "./palette";
import { ArcLabel, PinMark, labelAt, markerTier } from "./markers";
import type { MapViewProps } from "./MapView";
import type { DriveArc } from "./pins";

/**
 * #199 · the Google engine on the web (docs/design/202 §1, §3).
 *
 * The second renderer behind `MapMount`, loaded ONLY through its lazy
 * `dynamic()` import, so no Google code reaches a Mapbox reader's bundle and
 * none runs during SSR. It takes `MapViewProps` minus the Mapbox token and
 * draws the same marks `MapView` does: the HTML discs, drops and rings are
 * `AdvancedMarkerElement` content (which is why a Map ID is required, q4 A),
 * the HERE corridor is a solid polyline and the estimate a dashed one, all in
 * `MAP_PALETTE[mode]`. Only the basemap and its attribution change. Google's
 * attribution and logo are Google's own and are never hidden.
 *
 * Mode → basemap is core's `GOOGLE_WEB_BASEMAP`: day roadmap, night roadmap on
 * the Map ID's DARK colour scheme, sat hybrid. `colorScheme` can only be set
 * when a map is created, so a day ↔ night switch builds a fresh map at the
 * camera the reader left; a switch to or from sat only changes the map type.
 *
 * Tapping a business on the basemap (#201) is not wired here yet.
 */

export type GoogleMapViewProps = Omit<MapViewProps, "token">;

/** The corridor is drawn heavier than the estimate — the same value as
 * `MapView.tsx`'s `CORRIDOR_WIDTH`, pinned equal by map-engine.test.ts. */
const CORRIDOR_WIDTH = 2.6;

/** The estimate's dash, as MapView's `"line-dasharray": [2.2, 1.8]`: lengths
 * in units of the line's width. */
const DASH_ON = 2.2;
const DASH_OFF = 1.8;

/** Mapbox's `maxZoom: 11` on its 512px tiles is Google's 12 on 256px tiles. */
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 12;

/** Where the camera starts before the first fit — MapView's initial view. */
const START = { center: { lat: 42, lng: -116 }, zoom: 4.4 };

interface GoogleLibs {
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}

export function GoogleMapView({
  pins,
  arcs = [],
  join = [],
  selectedId = null,
  onSelect,
  showLabels = true,
  height,
  mode,
}: GoogleMapViewProps) {
  const palette = MAP_PALETTE[mode];
  const basemap = GOOGLE_WEB_BASEMAP[mode];
  const host = useRef<HTMLDivElement | null>(null);
  const [libs, setLibs] = useState<GoogleLibs | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(false);
  // The camera the reader left, carried across a day ↔ night rebuild.
  const camera = useRef<{ center: google.maps.LatLngLiteral; zoom: number } | null>(null);

  const placements = useMemo(() => {
    const input: SpiderPoint[] = pins.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      anchor: p.kind === "destination",
    }));
    return new Map(spiderfy(input).map((s) => [s.id, s]));
  }, [pins]);

  const bounds = useMemo(
    () =>
      boundsFor([...pins, ...arcs.flatMap((a) => a.path.map(([lng, lat]) => ({ lat, lng })))]),
    [pins, arcs],
  );
  const key = boundsKey(bounds);

  // Load the Maps JS API once per page, then the two libraries this view uses.
  useEffect(() => {
    let live = true;
    loadGoogleMaps()
      .then(async () => {
        const [maps, marker] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("marker"),
        ]);
        if (live) setLibs({ maps, marker });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    const offAuth = onGoogleAuthFailure(() => {
      if (live) setFailed(true);
    });
    return () => {
      live = false;
      offAuth();
    };
  }, []);

  // One map per colour scheme (it is a construction-time option).
  useEffect(() => {
    const el = host.current;
    if (!libs || !el) return;
    const resume = camera.current;
    const m = new libs.maps.Map(el, {
      mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID,
      colorScheme: basemap.colorScheme,
      mapTypeId: basemap.mapTypeId,
      center: resume?.center ?? START.center,
      zoom: resume?.zoom ?? START.zoom,
      // MapView's `cooperativeGestures`: page scroll stays page scroll.
      gestureHandling: "cooperative",
      // MapView draws no zoom / type / street-view controls; the overlay pills
      // are ours. Attribution and the Google logo are not controls and stay.
      disableDefaultUI: true,
    });
    const idle = m.addListener("idle", () => {
      const c = m.getCenter();
      const z = m.getZoom();
      if (c && z !== undefined) camera.current = { center: c.toJSON(), zoom: z };
    });
    if (!resume && bounds) fit(m, bounds);
    setMap(m);
    return () => {
      idle.remove();
      setMap(null);
    };
    // Rebuilt for the scheme only; the map type and the fit have their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libs, basemap.colorScheme]);

  useEffect(() => {
    map?.setMapTypeId(basemap.mapTypeId);
  }, [map, basemap.mapTypeId]);

  // Re-fit when the visible set changes something the camera isn't already
  // showing — MapView's #80 i4 rule, on Google's bounds.
  useEffect(() => {
    if (!map || !bounds) return;
    if (boundsCovers(shownBounds(map), bounds)) return;
    fit(map, bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failed) return <MapFrame state="unavailable" />;

  return (
    <div style={height ? { height, width: "100%" } : { height: "100%", width: "100%" }}>
      {/* Keyed on the scheme so a rebuild gets a clean element. */}
      <div key={basemap.colorScheme} ref={host} className="h-full w-full" />
      {map && libs && (
        <>
          {arcs.map((a) => (
            <ArcLines key={a.id} map={map} libs={libs} arc={a} palette={palette} />
          ))}
          {join.length > 1 && (
            <DashedLine map={map} libs={libs} path={join} palette={palette} />
          )}
          {arcs.map((a) => {
            const [lng, lat] = labelAt(a);
            return (
              <GoogleMarker key={`label-${a.id}`} map={map} libs={libs} lat={lat} lng={lng} zIndex={0}>
                <ArcLabel label={a.label} palette={palette} />
              </GoogleMarker>
            );
          })}
          {pins.map((pin) => {
            const at = placements.get(pin.id);
            const selected = pin.id === selectedId;
            return (
              <GoogleMarker
                key={pin.id}
                map={map}
                libs={libs}
                lat={pin.lat}
                lng={pin.lng}
                dx={at?.dx ?? 0}
                dy={at?.dy ?? 0}
                zIndex={markerTier(pin, selected)}
                onClick={onSelect ? () => onSelect(pin.id) : undefined}
              >
                <PinMark pin={pin} at={at} selected={selected} palette={palette} showLabels={showLabels} />
              </GoogleMarker>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * An `AdvancedMarkerElement` whose content is a React subtree (a portal), so
 * the marks are the same components MapView renders. The content is centred on
 * the coordinate (Google anchors at bottom-centre; Mapbox's Marker at centre)
 * and nudged by the spiderfy offset, exactly as MapView's `offset={[dx, dy]}`.
 */
function GoogleMarker({
  map,
  libs,
  lat,
  lng,
  dx = 0,
  dy = 0,
  zIndex,
  onClick,
  children,
}: {
  map: google.maps.Map;
  libs: GoogleLibs;
  lat: number;
  lng: number;
  dx?: number;
  dy?: number;
  zIndex: number;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [el] = useState(() => document.createElement("div"));
  const marker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);

  useEffect(() => {
    const m = new libs.marker.AdvancedMarkerElement({ map, content: el });
    marker.current = m;
    return () => {
      m.map = null;
      marker.current = null;
    };
  }, [map, libs, el]);

  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    m.position = { lat, lng };
    m.zIndex = zIndex;
  }, [map, libs, lat, lng, zIndex]);

  useEffect(() => {
    const m = marker.current;
    if (!m) return;
    m.gmpClickable = Boolean(onClick);
    if (!onClick) return;
    const handle = () => onClick();
    m.addEventListener("gmp-click", handle);
    return () => m.removeEventListener("gmp-click", handle);
  }, [map, libs, onClick]);

  return createPortal(
    <div style={{ transform: `translate(${dx}px, calc(50% + ${dy}px))` }}>{children}</div>,
    el,
  );
}

/**
 * One drive, in MapView's grammar: a routed HERE corridor is a solid line at
 * `CORRIDOR_WIDTH` over a `corridorCasing` casing; an estimate is the dashed
 * chord at `palette.arcWidth`, cased only where its mode cases it (sat).
 */
function ArcLines({
  map,
  libs,
  arc,
  palette,
}: {
  map: google.maps.Map;
  libs: GoogleLibs;
  arc: DriveArc;
  palette: OverlayPalette;
}) {
  const routed = arc.source === "here";
  useEffect(() => {
    const path = toLatLng(arc.path);
    const lines: google.maps.Polyline[] = [];
    if (routed || palette.arcCasing) {
      lines.push(
        new libs.maps.Polyline({
          map,
          path,
          clickable: false,
          strokeColor: palette.corridorCasing,
          strokeWeight: ARC_CASING_WIDTH,
          strokeOpacity: 1,
          zIndex: 1,
        }),
      );
    }
    lines.push(
      routed
        ? new libs.maps.Polyline({
            map,
            path,
            clickable: false,
            strokeColor: palette.arcLine,
            strokeWeight: CORRIDOR_WIDTH,
            strokeOpacity: 1,
            zIndex: 2,
          })
        : dashed(libs, map, path, palette),
    );
    return () => {
      for (const l of lines) l.setMap(null);
    };
  }, [map, libs, arc.path, routed, palette]);
  return null;
}

/** #179 · the Journal's join: one dashed line at the estimate's paint, no
 * casing, no label. */
function DashedLine({
  map,
  libs,
  path,
  palette,
}: {
  map: google.maps.Map;
  libs: GoogleLibs;
  path: [number, number][];
  palette: OverlayPalette;
}) {
  useEffect(() => {
    const line = dashed(libs, map, toLatLng(path), palette);
    return () => line.setMap(null);
  }, [map, libs, path, palette]);
  return null;
}

/** A Google polyline has no dash array; a dash is a repeated line symbol on
 * an invisible stroke. Sized so one dash + gap is MapView's [2.2, 1.8] × width. */
function dashed(
  libs: GoogleLibs,
  map: google.maps.Map,
  path: google.maps.LatLngLiteral[],
  palette: OverlayPalette,
): google.maps.Polyline {
  const w = palette.arcWidth;
  return new libs.maps.Polyline({
    map,
    path,
    clickable: false,
    strokeOpacity: 0,
    zIndex: 2,
    icons: [
      {
        icon: {
          path: "M 0,-1 0,1",
          strokeColor: palette.arcLine,
          strokeOpacity: palette.arcOpacity,
          strokeWeight: w,
          scale: (DASH_ON * w) / 2,
        },
        offset: "0",
        repeat: `${(DASH_ON + DASH_OFF) * w}px`,
      },
    ],
  });
}

function toLatLng(path: [number, number][]): google.maps.LatLngLiteral[] {
  return path.map(([lng, lat]) => ({ lat, lng }));
}

function fit(map: google.maps.Map, b: Bounds) {
  map.fitBounds({ west: b.west, south: b.south, east: b.east, north: b.north }, FIT_PADDING);
  // Google's fitBounds has no maxZoom: clamp once the fit has landed, so a
  // single pin doesn't open at street level.
  google.maps.event.addListenerOnce(map, "idle", () => {
    const z = map.getZoom();
    if (z !== undefined && z > FIT_MAX_ZOOM) map.setZoom(FIT_MAX_ZOOM);
  });
}

/** What the camera shows, as core's `Bounds` (null before the first frame). */
function shownBounds(map: google.maps.Map): Bounds | null {
  const b = map.getBounds();
  if (!b) return null;
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  return { west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() };
}

// ── the Maps JS bootstrap ────────────────────────────────────────────────────

const READY_CALLBACK = "__rvGoogleMapsReady";
let loading: Promise<void> | null = null;

/**
 * Inject the Maps JS API once per page (`loading=async`, resolved by its
 * callback), keyed by the browser key. Callers only reach here when
 * `webGoogleAvailability` said the key and Map ID are both set.
 */
function loadGoogleMaps(): Promise<void> {
  const g = (window as unknown as { google?: { maps?: { importLibrary?: unknown } } }).google;
  if (typeof g?.maps?.importLibrary === "function") return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w[READY_CALLBACK] = () => resolve();
    const params = new URLSearchParams({
      key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "",
      v: "weekly",
      loading: "async",
      callback: READY_CALLBACK,
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Google Maps JS failed to load"));
    };
    document.head.append(script);
  });
  return loading;
}

/** Google calls `window.gm_authFailure` when the key is rejected (wrong
 * referrer, API not enabled). The map then can't draw, so the frame says so. */
const authListeners = new Set<() => void>();
function onGoogleAuthFailure(cb: () => void): () => void {
  const w = window as unknown as { gm_authFailure?: () => void };
  w.gm_authFailure = () => {
    for (const l of authListeners) l();
  };
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export default GoogleMapView;
