"use client";

import { isScheduled, type Stop } from "@rv-trip/core";
import { MapMount } from "./MapMount";
import type { StopPin } from "./pins";

/**
 * Mode 2 — the stop-detail sheet's mini-map. Every affordance dropped except the
 * pin and pan/zoom, at the exact 150px `MapPlaceholder` (packages/ui/src/
 * DetailCards.tsx:10) reserves today, so the sheet's layout doesn't shift now
 * that the real map has landed. No arcs, no chips, no legend.
 */
export const STOP_MINI_MAP_HEIGHT = "150px";

export function StopMiniMap({
  stop,
  legName,
  tripTitle = "",
  ordinal = null,
}: {
  stop: Stop;
  legName: string;
  tripTitle?: string;
  /** Position in the trip's scheduled sequence — the same number /map's disc
   * carries. Null for a floating stop. */
  ordinal?: number | null;
}) {
  const { lat, lng } = stop.place;
  const pins: StopPin[] =
    lat == null || lng == null
      ? []
      : [
          {
            kind: "stop",
            id: stop.id,
            lat,
            lng,
            layer: "planning",
            name: stop.place.name,
            ordinal,
            floating: !isScheduled(stop),
            dates: null,
            nights: null,
            tripId: "",
            tripTitle,
            legTitle: legName,
            scheduledTotal: 0,
            rating: stop.rating,
            notes: stop.notes,
            reservations: [],
          },
        ];

  return (
    <MapMount
      pins={pins}
      selectedId={stop.id}
      height={STOP_MINI_MAP_HEIGHT}
      unmappedCount={pins.length === 0 ? 1 : 0}
      // Follows the style preference, offers no control: 150px is not a canvas
      // anyone works in, and it inherits the mode through MapMount for free.
      showStyleControl={false}
    />
  );
}
