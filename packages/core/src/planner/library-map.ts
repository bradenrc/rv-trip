import type { Destination, IsoDate, SavedPlace, Trip } from "../domain/types";
import { categoryOf, type RvCategory } from "../theme/tokens";
import { tripDestinationPins } from "./map-pins";
import { savePoint } from "./nearby-saves";

/**
 * The library map (#184 · #186 i5 · q6 A · q7 A · q8 A): every trip's
 * destinations and every save, as pins, under one of four filters. The phone's
 * Map tab and web /map both read `libraryMap`, so the two clients cannot
 * disagree about which pins a filter keeps or which stops count as been.
 *
 * Pins only. Nothing here draws a route or asks a server for anything; the
 * drive arcs a renderer may add come from the shipped `tripArcs` path.
 *
 * One point rule for every map surface (#185 vet HIGH): a save is pinned at
 * `savePoint` — its own lat/lng, else its area's — the same point Near you
 * measures from. Only a save with neither is `unmapped`.
 */

export type LibraryFilter = { kind: "all" } | { kind: "been" } | { kind: "want" } | { kind: "trip"; tripId: string };

/**
 * A destination is been once its trip is complete, or once its departDate is
 * behind today. So a trip in progress is both: its past stops are been, the
 * rest are want (q7 A). Departing today is not yet behind you.
 */
export function destinationBeen(
  trip: Pick<Trip, "status">,
  destination: Pick<Destination, "departDate">,
  today: IsoDate | null,
): boolean {
  if (trip.status === "complete") return true;
  return today !== null && destination.departDate !== null && destination.departDate < today;
}

/** all → everything · been → been · want → not been · trip → that trip's pins only.
 * A save's tripId is the trip it was visited on; a destination's is its trip's id. */
export function libraryFilterKeeps(f: LibraryFilter, item: { been: boolean; tripId: string | null }): boolean {
  switch (f.kind) {
    case "all":
      return true;
    case "been":
      return item.been;
    case "want":
      return !item.been;
    case "trip":
      return item.tripId === f.tripId;
  }
}

export interface LibraryDestinationPin {
  id: string;
  tripId: string;
  name: string;
  lat: number;
  lng: number;
  /** 1-based scheduled position in its trip; null when floating. */
  ordinal: number | null;
  been: boolean;
}

export interface LibrarySavePin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: RvCategory;
  been: boolean;
  tripId: string | null;
}

export interface LibraryMap {
  destinations: LibraryDestinationPin[];
  saves: LibrarySavePin[];
  /** Saves the filter keeps that have no point to pin. */
  unmapped: number;
}

export function libraryMap(
  trips: readonly Trip[],
  saves: readonly SavedPlace[],
  today: IsoDate | null,
  f: LibraryFilter,
): LibraryMap {
  const destinations: LibraryDestinationPin[] = [];
  for (const trip of trips) {
    const departs = new Map(trip.chapters.flatMap((c) => c.destinations).map((d) => [d.id, d.departDate]));
    for (const pin of tripDestinationPins(trip)) {
      const been = destinationBeen(trip, { departDate: departs.get(pin.id) ?? null }, today);
      if (!libraryFilterKeeps(f, { been, tripId: trip.id })) continue;
      destinations.push({
        id: pin.id,
        tripId: trip.id,
        name: pin.name,
        lat: pin.lat,
        lng: pin.lng,
        ordinal: pin.ordinal,
        been,
      });
    }
  }

  const pins: LibrarySavePin[] = [];
  let unmapped = 0;
  for (const s of saves) {
    const been = s.status === "been";
    if (!libraryFilterKeeps(f, { been, tripId: s.tripId })) continue;
    const point = savePoint(s);
    if (!point) {
      unmapped += 1;
      continue;
    }
    pins.push({
      id: s.id,
      name: s.place.name,
      lat: point.lat,
      lng: point.lng,
      category: categoryOf(s.type).cat,
      been,
      tripId: s.tripId,
    });
  }

  return { destinations, saves: pins, unmapped };
}

export interface LibraryTrip {
  id: string;
  title: string;
  /** "08/01 – 08/28" — the One trip chooser's date line. */
  dates: string;
  /** How many of its destinations the map can draw. */
  destinations: number;
}

/** "2026-08-01" → "08/01". */
function monthSlashDay(d: IsoDate): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

/** The One trip chooser: trips with at least one mapped destination, newest startDate first. */
export function libraryTrips(trips: readonly Trip[]): LibraryTrip[] {
  return trips
    .map((t) => ({ trip: t, mapped: tripDestinationPins(t).length }))
    .filter((x) => x.mapped > 0)
    .sort((a, b) => (a.trip.startDate < b.trip.startDate ? 1 : a.trip.startDate > b.trip.startDate ? -1 : 0))
    .map(({ trip, mapped }) => ({
      id: trip.id,
      title: trip.title,
      dates: `${monthSlashDay(trip.startDate)} – ${monthSlashDay(trip.endDate)}`,
      destinations: mapped,
    }));
}
