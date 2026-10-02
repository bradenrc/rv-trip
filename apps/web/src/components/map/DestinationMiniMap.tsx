"use client";

import { CircleDot } from "lucide-react";
import { isScheduled, pickedCoordLabel, pickedFromPlace, type Destination } from "@rv-trip/core";
import { MapMount } from "./MapMount";
import type { DestinationPin } from "./pins";

/**
 * Mode 2 — the destination-detail sheet's mini-map. Every affordance dropped except the
 * pin and pan/zoom, at the exact 150px `MapPlaceholder` (packages/ui/src/
 * DetailCards.tsx:10) reserves today, so the sheet's layout doesn't shift now
 * that the real map has landed. No arcs, no chips, no legend.
 */
export const DESTINATION_MINI_MAP_HEIGHT = "150px";

export function DestinationMiniMap({
  destination,
  chapterName,
  tripTitle = "",
  ordinal = null,
  onChangePlace,
}: {
  destination: Destination;
  chapterName: string;
  tripTitle?: string;
  /** Position in the trip's scheduled sequence — the same number /map's disc
   * carries. Null for a floating destination. */
  ordinal?: number | null;
  /**
   * "Change place" (#60, Mount B). When given, the mini-map grows a footer with
   * the destination's coordinates and the control — deliberately here in the sheet
   * BODY rather than in its sticky navy header, whose scroll container would
   * clip the picker's absolutely-positioned dropdown. The map is also the thing
   * the change is about.
   */
  onChangePlace?: () => void;
}) {
  const { lat, lng } = destination.place;
  const pins: DestinationPin[] =
    lat == null || lng == null
      ? []
      : [
          {
            kind: "destination",
            id: destination.id,
            lat,
            lng,
            layer: "planning",
            name: destination.place.name,
            ordinal,
            floating: !isScheduled(destination),
            dates: null,
            nights: null,
            tripId: "",
            tripTitle,
            chapterTitle: chapterName,
            scheduledTotal: 0,
            rating: destination.rating,
            notes: destination.notes,
            reservations: [],
          },
        ];

  const map = (
    <MapMount
      pins={pins}
      selectedId={destination.id}
      height={DESTINATION_MINI_MAP_HEIGHT}
      unmappedCount={pins.length === 0 ? 1 : 0}
      // Follows the style preference, offers no control: 150px is not a canvas
      // anyone works in, and it inherits the mode through MapMount for free.
      showStyleControl={false}
    />
  );

  if (!onChangePlace) return map;

  return (
    <div className="overflow-hidden rounded-rv-card border border-rv-border bg-rv-surface">
      {map}
      <div className="flex flex-wrap items-center gap-2.5 border-t border-rv-border-soft px-3 py-2.5 font-mono text-[11px] text-rv-ink-faded">
        {/* The picker's own coordinate line, so the sheet and the picker never
            word the same fact two ways. */}
        <span>{pickedCoordLabel(pickedFromPlace(destination.place)!)}</span>
        <button
          type="button"
          onClick={onChangePlace}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-rv-pill border border-rv-green bg-rv-green-soft px-3 py-1 font-sans text-[12.5px] font-semibold text-rv-green"
        >
          <CircleDot className="size-3.5" />
          Change place
        </button>
      </div>
    </div>
  );
}
