import { orderedStops } from "./route-order";
import type { Place, Stop, Trip } from "./types";

/**
 * Where a trip-context place search is biased (#126 · the anchor table).
 *
 * ONE helper replaces every `nearOf(…, trip.homeBasePlace)` the planner used to
 * spell at its five call sites. The chain is the design's, per context:
 *
 *   | context  | 1st              | 2nd               | 3rd                |
 *   |----------|------------------|-------------------|--------------------|
 *   | `stop`   | this stop        | trip.destination  | —                  |
 *   | `after`  | the stop above   | trip.destination  | —                  |
 *   | `trip`   | trip.destination | first located stop| —                  |
 *   | `ideas`  | trip.destination | last located stop | —                  |
 *
 * …and then `null`, which the picker reads as "ask" (the "Search near…?" chip)
 * rather than letting Google bias to the caller's IP. Home base is NEVER in the
 * chain: it anchors the first drive's origin, not a destination search.
 */

export type SearchAnchorContext =
  /** Add stay on a stop (StopDetailSheet): the stop itself. */
  | { kind: "stop"; stopId: string }
  /** A new or re-placed stop: the stop ABOVE it (null = first in its leg). */
  | { kind: "after"; stopId: string | null }
  /** Itinerary ▸ Add ▸ Stay with no stop picked. */
  | { kind: "trip" }
  /** Ideas ▸ Add / locate an idea. */
  | { kind: "ideas" };

export type SearchAnchorSource = "stop" | "destination" | "trip";

export interface SearchAnchor {
  name: string;
  lat: number;
  lng: number;
  /** Which link of the chain answered — the chip's suffix. */
  source: SearchAnchorSource;
}

type AnchorTrip = Pick<Trip, "destination" | "legs">;

const located = (p: Pick<Place, "name" | "lat" | "lng"> | null | undefined, source: SearchAnchorSource) =>
  p && p.lat !== null && p.lng !== null ? { name: p.name, lat: p.lat, lng: p.lng, source } : null;

export function searchAnchor(trip: AnchorTrip, ctx: SearchAnchorContext): SearchAnchor | null {
  const stops: Stop[] = orderedStops(trip);
  const byId = new Map(stops.map((s) => [s.id, s]));
  const destination = located(trip.destination, "destination");
  switch (ctx.kind) {
    case "stop":
      return located(byId.get(ctx.stopId)?.place, "stop") ?? destination;
    case "after":
      return (ctx.stopId ? located(byId.get(ctx.stopId)?.place, "stop") : null) ?? destination;
    case "trip":
      return destination ?? firstLocated(stops, "trip");
    case "ideas":
      return destination ?? firstLocated([...stops].reverse(), "trip");
  }
}

function firstLocated(stops: Stop[], source: SearchAnchorSource): SearchAnchor | null {
  for (const s of stops) {
    const a = located(s.place, source);
    if (a) return a;
  }
  return null;
}

/**
 * The chip the anchored picker shows: "near Bellingham, WA — this stop",
 * "near Bellingham, WA — from this trip", or — nothing known — the ask.
 */
export function searchAnchorChip(anchor: SearchAnchor | null): string {
  if (!anchor) return "Search near…?";
  if (anchor.source === "stop") return `near ${anchor.name} — this stop`;
  return `near ${anchor.name} — from this trip`;
}
