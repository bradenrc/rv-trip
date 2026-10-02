import { orderedDestinations } from "./route-order";
import type { Place, Destination, Trip } from "./types";

/**
 * Where a trip-context place search is biased (#126 · the anchor table).
 *
 * ONE helper replaces every `nearOf(…, trip.homeBasePlace)` the planner used to
 * spell at its five call sites. The chain is the design's, per context:
 *
 *   | context  | 1st              | 2nd               | 3rd                |
 *   |----------|------------------|-------------------|--------------------|
 *   | `destination`   | this destination        | trip.area  | —                  |
 *   | `after`  | the destination above   | trip.area  | —                  |
 *   | `trip`   | trip.area | first located destination| —                  |
 *   | `ideas`  | trip.area | last located destination | —                  |
 *
 * …and then `null`, which the picker reads as "ask" (the "Search near…?" chip)
 * rather than letting Google bias to the caller's IP. Home base is NEVER in the
 * chain: it anchors the first drive's origin, not an area search.
 */

export type SearchAnchorContext =
  /** Add stay on a destination (DestinationDetailSheet): the destination itself. */
  | { kind: "destination"; destinationId: string }
  /** A new or re-placed destination: the destination ABOVE it (null = first in its chapter). */
  | { kind: "after"; destinationId: string | null }
  /** Itinerary ▸ Add ▸ Stay with no destination picked. */
  | { kind: "trip" }
  /** Ideas ▸ Add / locate an idea. */
  | { kind: "ideas" };

export type SearchAnchorSource = "destination" | "area" | "trip";

export interface SearchAnchor {
  name: string;
  lat: number;
  lng: number;
  /** Which link of the chain answered — the chip's suffix. */
  source: SearchAnchorSource;
}

type AnchorTrip = Pick<Trip, "area" | "chapters">;

const located = (p: Pick<Place, "name" | "lat" | "lng"> | null | undefined, source: SearchAnchorSource) =>
  p && p.lat !== null && p.lng !== null ? { name: p.name, lat: p.lat, lng: p.lng, source } : null;

export function searchAnchor(trip: AnchorTrip, ctx: SearchAnchorContext): SearchAnchor | null {
  const destinations: Destination[] = orderedDestinations(trip);
  const byId = new Map(destinations.map((s) => [s.id, s]));
  const area = located(trip.area, "area");
  switch (ctx.kind) {
    case "destination":
      return located(byId.get(ctx.destinationId)?.place, "destination") ?? area;
    case "after":
      return (ctx.destinationId ? located(byId.get(ctx.destinationId)?.place, "destination") : null) ?? area;
    case "trip":
      return area ?? firstLocated(destinations, "trip");
    case "ideas":
      return area ?? firstLocated([...destinations].reverse(), "trip");
  }
}

function firstLocated(destinations: Destination[], source: SearchAnchorSource): SearchAnchor | null {
  for (const s of destinations) {
    const a = located(s.place, source);
    if (a) return a;
  }
  return null;
}

/**
 * The chip the anchored picker shows: "near Bellingham, WA — this destination",
 * "near Bellingham, WA — from this trip", or — nothing known — the ask.
 */
export function searchAnchorChip(anchor: SearchAnchor | null): string {
  if (!anchor) return "Search near…?";
  if (anchor.source === "destination") return `near ${anchor.name} — this destination`;
  return `near ${anchor.name} — from this trip`;
}
