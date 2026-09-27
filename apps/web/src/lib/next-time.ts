import type { ForNextTime, SavedPlace, Trip } from "@rv-trip/core";
import { forNextTime } from "@rv-trip/core";
import { listTripsForOwner } from "@rv-trip/db";

/**
 * #113 · #107 "Last time here" — the ONE server seam for it. Three readers
 * call this, so the phone's card, the phone's banner count and the web agree:
 * `GET /api/trips/:id/for-next-time` (the phone's card), `GET
 * /api/trips/:id/nearby-saves` (both clients' banner — the card's saves are
 * left out of it, vet HIGH) and app/trips/[id]/page.tsx (the web's first paint).
 *
 * `listTripsForOwner` is the dashboard read: it carries each trip's derived
 * status, dates, ★ and note — exactly what a past-trip card shows.
 */
export async function nextTimeFor(owner: string, trip: Trip, saves: SavedPlace[]): Promise<ForNextTime> {
  const pastTrips = await listTripsForOwner(owner);
  return forNextTime(trip, pastTrips, saves, trip.surfaceRadiusMi);
}
