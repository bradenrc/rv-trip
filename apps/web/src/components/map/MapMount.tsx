"use client";

import dynamic from "next/dynamic";
import { Moon, Satellite, Sun } from "lucide-react";
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

const STYLE_SEGMENTS: SegmentOption<StyleMode>[] = [
  { value: "night", label: "Night", Icon: Moon },
  { value: "day", label: "Day", Icon: Sun },
  { value: "sat", label: "Sat", Icon: Satellite },
];

export interface MapMountProps {
  pins: MapPin[];
  arcs?: DriveArc[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  showLabels?: boolean;
  /** CSS length for the map's box. Omit to fill the cell it sits in. */
  height?: string;
  /** How many points were dropped for having no coordinates — the honest count
   * behind the "nothing to map yet" frame. */
  unmappedCount?: number;
  /** The over-canvas style pill. Off for the stop sheet's mini-map, which
   * follows the preference but is too small to carry a control. */
  showStyleControl?: boolean;
}

export function MapMount({
  pins,
  arcs,
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
            <div className="absolute right-3 top-3 z-[3] rounded-rv-pill shadow-rv-lg">
              <SegmentedControl mono value={mode} options={STYLE_SEGMENTS} onChange={setMode} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
