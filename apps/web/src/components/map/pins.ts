import type { CategoryLabel } from "@rv-trip/ui";
import { categoryMeta } from "@rv-trip/ui";
import { driveMiles, estimateRoute, hasCoords, isScheduled } from "@rv-trip/core";
import type { ReservationType, SavedPlace, Stop, Trip } from "@rv-trip/core";
import { dateRange } from "@/lib/trip-ui";

/**
 * The pin model behind every map surface: one flat list of drawable points, the
 * coordless rows the map can't take, and the estimated-drive arcs.
 *
 * Nothing here styles anything — `MapView` reads `layer` / `kind` / `floating`
 * and applies the pin grammar. The miles come from core's `estimateRoute()` —
 * the one surviving haversine, which the Route rail also falls back to — so the
 * map and the rail can never print different numbers.
 */

/** The four layers, in the order their chips read — labelled verbatim from the
 * dashboard's own section heads (apps/web/src/app/page.tsx). */
export type MapLayer = "planning" | "upcoming" | "been" | "saved";

export const LAYER_LABEL: Record<MapLayer, string> = {
  planning: "Planning now",
  upcoming: "Upcoming",
  been: "Been there",
  saved: "Saved places",
};

export const LAYER_ORDER: MapLayer[] = ["planning", "upcoming", "been", "saved"];

export interface PinReservation {
  id: string;
  type: ReservationType;
  name: string;
  /** "Stay · campground · Aug 2–5" */
  meta: string;
  cost: number | null;
}

export interface StopPin {
  kind: "stop";
  id: string;
  lat: number;
  lng: number;
  layer: Exclude<MapLayer, "saved">;
  name: string;
  /** 1-based position in the trip's scheduled sequence; null when floating. */
  ordinal: number | null;
  floating: boolean;
  /** "Aug 2–5", or null for a floating stop. */
  dates: string | null;
  /** Nights between arrive and depart; null for a floating stop. */
  nights: number | null;
  tripId: string;
  tripTitle: string;
  legTitle: string;
  /** How many scheduled stops the trip has — the "stop 1 of 3" denominator. */
  scheduledTotal: number;
  rating: number | null;
  notes: string | null;
  reservations: PinReservation[];
}

export interface PlacePin {
  kind: "place";
  id: string;
  lat: number;
  lng: number;
  layer: "saved";
  name: string;
  type: ReservationType;
  category: CategoryLabel;
  status: SavedPlace["status"];
  region: string | null;
  note: string | null;
  source: string | null;
  rating: number | null;
  tripName: string | null;
}

export type MapPin = StopPin | PlacePin;

/** A point the map cannot draw — kept so nothing silently disappears. */
export interface UnmappedRow {
  id: string;
  name: string;
  layer: MapLayer;
}

/** One leg of the dashed estimate between consecutive scheduled stops. */
export interface DriveArc {
  id: string;
  layer: Exclude<MapLayer, "saved" | "been">;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  miles: number;
  /** "~108 mi · est." — a map label answers "how far", not "how long". */
  label: string;
}

export interface MapModel {
  pins: MapPin[];
  unmapped: UnmappedRow[];
  arcs: DriveArc[];
}

function layerOf(trip: Trip): Exclude<MapLayer, "saved"> {
  return trip.status === "complete" ? "been" : trip.status;
}

/** Trip-wide scheduled stops sorted by arriveDate — the same ordering
 * `routeSummary()` uses (apps/web/src/lib/trip-logic.ts:294), so the map's
 * sequence and the Route rail's sequence are one sequence. */
function scheduledSequence(trip: Trip): Stop[] {
  return trip.legs
    .flatMap((l) => l.stops)
    .filter(isScheduled)
    .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
}

/** Whole days between two plain dates — no timestamps, no tz. */
function nightsBetween(arrive: string, depart: string): number {
  const ms = Date.parse(`${depart}T00:00:00Z`) - Date.parse(`${arrive}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function reservationsOf(stop: Stop): PinReservation[] {
  return stop.reservations.map((r) => {
    const cm = categoryMeta(r.type);
    const dates =
      r.checkIn && r.checkOut ? dateRange(r.checkIn, r.checkOut) : r.checkIn ? dateRange(r.checkIn, r.checkIn) : null;
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      meta: [cm.cat, r.type, dates].filter(Boolean).join(" · "),
      cost: r.cost,
    };
  });
}

/**
 * Fold every trip tree and the saved-place shelf into the one model each of the
 * three map modes reads. Coordless points are split out here, once — no pin path
 * downstream has to re-check for nulls.
 */
export function buildMapModel(trips: Trip[], places: SavedPlace[]): MapModel {
  const pins: MapPin[] = [];
  const unmapped: UnmappedRow[] = [];
  const arcs: DriveArc[] = [];

  for (const trip of trips) {
    const layer = layerOf(trip);
    const sequence = scheduledSequence(trip);
    const ordinalOf = new Map(sequence.map((s, i) => [s.id, i + 1]));

    for (const leg of trip.legs) {
      for (const stop of leg.stops) {
        const floating = !isScheduled(stop);
        if (!hasCoords(stop.place)) {
          unmapped.push({ id: stop.id, name: stop.place.name, layer });
          continue;
        }
        pins.push({
          kind: "stop",
          id: stop.id,
          lat: stop.place.lat,
          lng: stop.place.lng,
          layer,
          name: stop.place.name,
          ordinal: ordinalOf.get(stop.id) ?? null,
          floating,
          dates: isScheduled(stop) ? dateRange(stop.arriveDate, stop.departDate) : null,
          nights: isScheduled(stop) ? nightsBetween(stop.arriveDate, stop.departDate) : null,
          tripId: trip.id,
          tripTitle: trip.title,
          legTitle: leg.title,
          scheduledTotal: sequence.length,
          rating: stop.rating,
          notes: stop.notes,
          reservations: reservationsOf(stop),
        });
      }
    }

    // Arcs are drawn only for the trips AHEAD of you — a traveled trip's drive
    // already happened, and a dashed estimate over a real past route is a lie.
    if (layer === "been") continue;
    for (let i = 0; i < sequence.length - 1; i++) {
      const a = sequence[i]!.place;
      const b = sequence[i + 1]!.place;
      if (!hasCoords(a) || !hasCoords(b)) continue;
      const miles = driveMiles(estimateRoute(a, b));
      arcs.push({
        id: `${sequence[i]!.id}->${sequence[i + 1]!.id}`,
        layer,
        from: { lat: a.lat, lng: a.lng },
        to: { lat: b.lat, lng: b.lng },
        miles,
        label: `~${miles} mi · est.`,
      });
    }
  }

  for (const p of places) {
    if (!hasCoords(p.place)) {
      unmapped.push({ id: p.id, name: p.place.name, layer: "saved" });
      continue;
    }
    pins.push({
      kind: "place",
      id: p.id,
      lat: p.place.lat,
      lng: p.place.lng,
      layer: "saved",
      name: p.place.name,
      type: p.type,
      category: categoryMeta(p.type).cat,
      status: p.status,
      region: p.region,
      note: p.note,
      source: p.source,
      rating: p.rating,
      tripName: p.tripName,
    });
  }

  return { pins, unmapped, arcs };
}

/**
 * Category counts for the /map chip row. Deliberately NOT `PlacesLibrary`'s memo
 * (PlacesLibrary.tsx:49-56): that one scopes to the active shelf, so it counts 4
 * for "want". The map spans both shelves and must count all 8.
 */
export function categoryCounts(places: SavedPlace[]): Record<string, number> {
  const c: Record<string, number> = { All: places.length };
  for (const p of places) {
    const k = categoryMeta(p.type).cat;
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}

/** How many drawable points each layer contributes, before any chip filtering. */
export function layerCounts(pins: MapPin[], unmapped: UnmappedRow[]): Record<MapLayer, number> {
  const c: Record<MapLayer, number> = { planning: 0, upcoming: 0, been: 0, saved: 0 };
  for (const p of pins) c[p.layer]++;
  for (const u of unmapped) c[u.layer]++;
  return c;
}
