"use client";

import dynamic from "next/dynamic";
import { MapFrame } from "@rv-trip/ui";
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
 */

const LazyMapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <MapFrame state="loading" />,
});

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
}

export function MapMount({
  pins,
  arcs,
  selectedId,
  onSelect,
  showLabels,
  height,
  unmappedCount,
}: MapMountProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return (
    <div className={height ? undefined : "h-full min-h-[150px]"} style={height ? { height } : undefined}>
      {!token ? (
        <MapFrame state="unavailable" />
      ) : pins.length === 0 ? (
        <MapFrame state="empty" count={unmappedCount} />
      ) : (
        <div className="h-full overflow-hidden rounded-rv-card border border-rv-border">
          <LazyMapView
            pins={pins}
            arcs={arcs}
            selectedId={selectedId}
            onSelect={onSelect}
            showLabels={showLabels}
            token={token}
          />
        </div>
      )}
    </div>
  );
}
