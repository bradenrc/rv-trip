"use client";

import { useMemo } from "react";
import { isScheduled, journalMap, saveForJournalEntry, type IsoDate, type SavedPlace, type Trip } from "@rv-trip/core";
import { PinOpenCard } from "@/components/places/PinOpenCard";
import { MapMount } from "@/components/map/MapMount";
import type { MapPin } from "@/components/map/pins";
import { dateRange } from "@/lib/trip-logic";

/**
 * #179 · #181 i5 (q6 A · docs/design/181 frame 5) — the web Journal's map,
 * always beside the list. Core's `journalMap` decides what is drawn; this maps
 * its points onto the shipped pin grammar — a destination is a `DestinationPin`
 * (hollow on the "been" layer, filled on the trip's own), a logged place an
 * `IdeaPin` in its category colour — and hands the dashed `join` to the shipped
 * `MapMount`. It makes no request: no drive arcs, no routing.
 *
 * Below md it stacks ABOVE the list at 200px; from md it fills the right column.
 */
export function JournalMap({
  trip,
  today,
  label,
  selectedId,
  onSelect,
  saves = [],
}: {
  trip: Trip;
  /** #197 · #196: the owner's library. A selected logged place whose name is in
   * it gets a card with Open (core's `saveForJournalEntry`, the Journal rule);
   * a destination, or a place not in the library, gets none. */
  saves?: readonly SavedPlace[];
  today: IsoDate | null;
  /** The mono kicker over the map ("The trip so far" / "Everything logged on this trip"). */
  label: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const m = useMemo(() => journalMap(trip, today), [trip, today]);
  const pins = useMemo(() => toPins(trip, m.points), [trip, m.points]);
  const picked = pins.find((p) => p.id === selectedId);
  const open = picked?.kind === "idea" ? saveForJournalEntry(picked, saves) : null;

  return (
    <div className="order-first flex min-w-0 flex-col gap-1.5 md:order-none">
      <div className="px-0.5 pt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-rv-ink-faded">{label}</div>
      <div className="relative h-[200px] md:h-auto md:min-h-[440px] md:flex-1">
        <MapMount pins={pins} join={m.join} unmappedCount={m.unmapped} selectedId={selectedId} onSelect={onSelect} showLabels={false} />
        {open && <PinOpenCard save={open} className="absolute bottom-2 left-2 right-2 z-[3]" />}
      </div>
    </div>
  );
}

function toPins(trip: Trip, points: ReturnType<typeof journalMap>["points"]): MapPin[] {
  const layer = trip.status === "complete" ? "been" : trip.status;
  const destinations = trip.chapters.flatMap((c) => c.destinations.map((d) => ({ d, chapter: c })));
  const byId = new Map(destinations.map((x) => [x.d.id, x]));
  const ideas = new Map([...destinations.flatMap((x) => x.d.ideas), ...trip.ideas].map((i) => [i.id, i]));
  const scheduledTotal = destinations.filter((x) => isScheduled(x.d)).length;

  return points.flatMap((p): MapPin[] => {
    if (p.kind === "destination") {
      const hit = byId.get(p.id);
      if (!hit) return [];
      const { d, chapter } = hit;
      return [
        {
          kind: "destination",
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          layer: p.been ? "been" : layer,
          been: p.been,
          name: p.name,
          ordinal: p.ordinal,
          floating: !isScheduled(d),
          dates: isScheduled(d) ? dateRange(d.arriveDate, d.departDate) : null,
          nights: null,
          tripId: trip.id,
          tripTitle: trip.title,
          chapterTitle: chapter.title,
          scheduledTotal,
          rating: d.rating,
          notes: d.notes,
          reservations: [],
        },
      ];
    }
    const idea = ideas.get(p.id);
    if (!idea) return [];
    return [
      {
        kind: "idea",
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        layer,
        name: p.name,
        status: idea.status,
        destinationName: idea.destinationId ? (byId.get(idea.destinationId)?.d.place.name ?? null) : null,
        tripId: trip.id,
        tripTitle: trip.title,
        category: p.category,
      },
    ];
  });
}
