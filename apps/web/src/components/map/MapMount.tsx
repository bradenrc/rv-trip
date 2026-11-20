"use client";

import dynamic from "next/dynamic";
import { Moon, Satellite, Sun } from "lucide-react";
import {
  DEFAULT_MAP_ENGINE,
  MAP_ENGINES,
  MAP_ENGINE_FALLBACK_COPY,
  isMapEngine,
  resolveMapEngine,
  type GoogleAvailability,
  type GoogleFallbackReason,
  type MapEngine,
} from "@rv-trip/core";
import { MapFrame, SegmentedControl, type SegmentOption } from "@rv-trip/ui";
import { useStringPref } from "@/lib/pref";
import { DEFAULT_STYLE_MODE, isStyleMode, type StyleMode } from "./palette";
import type { DriveArc, MapPin } from "./pins";

/**
 * The single seam every map surface mounts through.
 *
 * `mapbox-gl` touches `window` at import time, so it can only be loaded with
 * `ssr: false` — which Next 16 forbids in a Server Component. This file is the
 * `"use client"` boundary that owns that import, and it is where the three
 * frames with no map in them are chosen: the lazy chunk is still arriving, the
 * publishable token is missing at runtime, or every visible point is coordless.
 * Each frame is a design-system component (`MapFrame`), so no vendor code — and
 * no map-shaped styling — leaks into `packages/ui`.
 *
 * It also owns the style mode (issue #12), for the same reason. The preference
 * is client-only and has to be resolved BEFORE the lazy chunk mounts, or a Day
 * reader watches a Night basemap load and then get thrown away; a control
 * inside `MapView` could neither render during the loading frame nor hand the
 * resolved mode back across the lazy boundary. So the mode, its persistence and
 * the control live here, and `MapView` takes `mode` as a prop and stays a pure
 * renderer. All three surfaces inherit the one preference.
 *
 * Note that nothing is imported from `./MapView` at module scope: this
 * component executes during SSR, and the mode vocabulary therefore lives in the
 * vendor-free `./palette` rather than beside the `mapbox://` urls.
 */

const LazyMapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapFrame state="loading" />,
});

/** Where the preference lives. Flat and dash-cased, like `rv-track-costs`
 * (TripPlanner.tsx:67). */
export const STYLE_PREF_KEY = "rv-map-style";

/** The three options every map offers. Exported because Settings' "Default map
 * style" row is a second front door onto the SAME preference, and a second copy
 * of the list would be a second vocabulary. */
export const STYLE_SEGMENTS: SegmentOption<StyleMode>[] = [
  { value: "night", label: "Night", Icon: Moon },
  { value: "day", label: "Day", Icon: Sun },
  { value: "sat", label: "Sat", Icon: Satellite },
];

/** #198 · the map-engine preference (docs/design/202). Mirrored to
 * `user_prefs.map_engine` by `lib/pref.ts` like every other mapped key. */
export const ENGINE_PREF_KEY = "rv-map-engine";

/**
 * #198 · whether THIS client can draw Google. The web renderer lands in #199
 * (which replaces this with the key + Map ID check); until then every web
 * build reports "not-built", so a "google" choice is kept and Mapbox draws.
 */
export const WEB_GOOGLE_AVAILABILITY: GoogleAvailability = { ok: false, reason: "not-built" };

/** The engine pill's two options — Mapbox · Google, no glyphs. `struck` marks
 * Google when it is the choice but can't be drawn here (q2 A). Exported for
 * Settings' "Map engine" row, the second front door onto the same preference. */
export function engineSegments(fallback: GoogleFallbackReason | null): SegmentOption<MapEngine>[] {
  return MAP_ENGINES.map(({ value, label }) => ({
    value,
    label,
    struck: value === "google" && fallback !== null,
  }));
}

/** The amber two-line note under the engine pill when Google is chosen but
 * Mapbox draws. */
function EngineFallbackNote({ reason }: { reason: GoogleFallbackReason }) {
  const copy = MAP_ENGINE_FALLBACK_COPY[reason];
  return (
    <div className="max-w-[220px] rounded-rv-md border border-rv-warning bg-rv-warning-soft px-2 py-1 text-left text-[10.5px] leading-[1.35] text-rv-warning shadow-rv-md">
      <b className="block font-bold">{copy.title}</b>
      {copy.body}
    </div>
  );
}

export interface MapMountProps {
  pins: MapPin[];
  arcs?: DriveArc[];
  /** #179 · the Journal map's join: `[lng, lat]` destinations in date order,
   * drawn as one dashed line. Never routed, never labelled. */
  join?: [number, number][];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  showLabels?: boolean;
  /** CSS length for the map's box. Omit to fill the cell it sits in. */
  height?: string;
  /** How many points were dropped for having no coordinates — the honest count
   * behind the "nothing to map yet" frame. */
  unmappedCount?: number;
  /** The over-canvas style pill. Off for the destination sheet's mini-map, which
   * follows the preference but is too small to carry a control. */
  showStyleControl?: boolean;
}

export function MapMount({
  pins,
  arcs,
  join,
  selectedId,
  onSelect,
  showLabels,
  height,
  unmappedCount,
  showStyleControl = true,
}: MapMountProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  // null until the client has read the preference — one render, covered by the
  // same loading frame the lazy chunk already shows, so nothing reflows and no
  // basemap style is fetched twice.
  const [mode, setMode] = useStringPref(STYLE_PREF_KEY, isStyleMode, DEFAULT_STYLE_MODE);
  // #198 · the account's engine choice, and what this client actually draws.
  // The choice is never written back by the client on its own: only a tap
  // writes. Until #199 lands, `resolved.engine` is always "mapbox".
  const [engine, setEngine] = useStringPref(ENGINE_PREF_KEY, isMapEngine, DEFAULT_MAP_ENGINE);
  const resolved = resolveMapEngine(engine, WEB_GOOGLE_AVAILABILITY);

  return (
    <div className={height ? undefined : "h-full min-h-[150px]"} style={height ? { height } : undefined}>
      {!token ? (
        <MapFrame state="unavailable" />
      ) : pins.length === 0 ? (
        <MapFrame state="empty" count={unmappedCount} />
      ) : mode === null ? (
        <MapFrame state="loading" />
      ) : (
        <div className="relative h-full overflow-hidden rounded-rv-card border border-rv-border">
          <LazyMapView
            pins={pins}
            arcs={arcs}
            join={join}
            selectedId={selectedId}
            onSelect={onSelect}
            showLabels={showLabels}
            token={token}
            mode={mode}
          />
          {showStyleControl && (
            // Over the canvas, never in the chrome: every surface that mounts a
            // map already spends a row or two on controls, and a third would
            // push the map below the fold on a laptop.
            // #198 · q1 A — the engine pill stacks under the style pill, and the
            // amber fallback note under that.
            <div className="absolute right-3 top-3 z-[3] flex flex-col items-end gap-1.5">
              <div className="rounded-rv-pill shadow-rv-lg">
                <SegmentedControl mono value={mode} options={STYLE_SEGMENTS} onChange={setMode} />
              </div>
              <div className="rounded-rv-pill shadow-rv-lg">
                <SegmentedControl
                  mono
                  value={engine ?? DEFAULT_MAP_ENGINE}
                  options={engineSegments(resolved.fallback)}
                  onChange={setEngine}
                />
              </div>
              {resolved.fallback && <EngineFallbackNote reason={resolved.fallback} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
