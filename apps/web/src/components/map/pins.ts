import type { CategoryLabel } from "@rv-trip/ui";
import { categoryMeta } from "@rv-trip/ui";
import { DEFAULT_UNITS, NO_ROUTING_HASH, arcLabel, hasCoords, isScheduled, tripArcs } from "@rv-trip/core";
import type {
  IdeaStatus,
  LocateRow,
  LocateRowKind,
  ReservationType,
  RouteMap,
  RouteSource,
  SavedPlace,
  Stop,
  Trip,
  Units,
} from "@rv-trip/core";
import { dateRange } from "@/lib/trip-ui";

/**
 * The pin model behind every map surface: one flat list of drawable points, the
 * coordless rows the map can't take, and the estimated-drive arcs.
 *
 * Nothing here styles anything — `MapView` reads `layer` / `kind` / `floating`
 * / `source` and applies the pin grammar. A drive's numbers come from core's
 * `tripArcs()` (#44 i3): the routed `RouteMap` the server resolved, keyed by
 * `routeCacheKey`, falling back to `estimateRoute()` — the one surviving
 * haversine, which the Route rail falls back to through the SAME key — so the
 * map and the rail can never print different numbers, and neither can the web
 * and the phone, which draws the same arcs from the same call.
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

/**
 * An idea (#69): the grammar's *maybe*, hanging under a stop. It draws smaller
 * than the stop it belongs to and carries no number, because it is not a
 * commitment and has no position in the drive sequence — it is never an arc
 * endpoint.
 *
 * It carries no `ReservationType`, so it has no category: the chip row's Do
 * count comes from `categoryCounts(places)`, which walks saved places only, and
 * letting ideas into that filter would give the chip a set its own number does
 * not describe (G1).
 */
export interface IdeaPin {
  kind: "idea";
  id: string;
  lat: number;
  lng: number;
  /** The parent TRIP's layer — an idea is never on the saved shelf. */
  layer: Exclude<MapLayer, "saved">;
  /** The idea's TITLE, not the place it resolved to, so the pin, the rail row
   * and the sheet row are recognisably one object. */
  name: string;
  status: IdeaStatus;
  /** The stop this idea hangs under, or `null` for a SHELF idea (#80): a
   * trip-level idea is attached to no stop, so there is no name to borrow and
   * the rail prints the trip alone. */
  stopName: string | null;
  tripId: string;
  tripTitle: string;
}

export type MapPin = StopPin | PlacePin | IdeaPin;

/** A point the map cannot draw — kept so nothing silently disappears. */
export interface UnmappedRow {
  id: string;
  name: string;
  layer: MapLayer;
  /** Which TABLE the id names, set at each `unmapped.push` site below. */
  kind: LocateRowKind;
}

/**
 * The row as POST /api/places/locate wants it: ids only, plus which table the
 * id names — now a passthrough of the field above.
 *
 * It used to DERIVE the kind from the layer (`layer === "saved" ? "place" :
 * "stop"`), which held only while the three trip layers carried stops alone. An
 * idea on a planning trip derived "stop", so the batch would have asked the
 * stops table for an idea's id, loaded nothing, and reported the row still
 * unmapped forever, silently, on every press. The explicit field deletes a
 * guess about the caller.
 */
export function locateRowOf(row: UnmappedRow): LocateRow {
  return { kind: row.kind, id: row.id };
}

/**
 * One drive between consecutive stops in the trip's ONE ordered sequence
 * (`orderedPairs`) — floating stops included, which is why this is no longer
 * "the dashed estimate": a routed drive carries the HERE corridor and draws
 * solid, an un-routed one keeps exactly the dash it has always had.
 *
 * Core's `TripArc` is the shared half (id / from / to / source / miles /
 * primaryRoad / path); the web adds the one thing only the web has — the
 * `layer` its chips filter by. The `label` is core's `arcLabel` as of #45: the
 * phone words it identically, and once the wording honors a units preference a
 * second copy of the format string is a second place for the two to disagree.
 */
export interface DriveArc {
  id: string;
  layer: Exclude<MapLayer, "saved" | "been">;
  /** The pair's endpoints — still the chord, for the estimate label's midpoint. */
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  miles: number;
  /** "136 mi · US-101" routed, "~108 mi · est." otherwise (or the same two
   * forms in kilometres) — a map label answers "how far", not "how long". */
  label: string;
  /** Which line grammar the Mapbox layer paints: solid corridor, or dash. */
  source: RouteSource;
  /** The drawn path as `[lng, lat]` positions: the decoded HERE corridor when
   * routed, the two endpoints otherwise (so an estimate is unchanged by
   * construction, never by a branch). */
  path: [number, number][];
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
 * A trip's ideas, split the same way a stop's own point is: a drawable one
 * becomes an `IdeaPin`, a coordless one an `UnmappedRow`.
 *
 * Called twice per trip — once per stop for the ideas hanging under it, and
 * once for `trip.ideas`, the SHELF (#80): the `stop_id IS NULL` rows the trip
 * tree carries beside its legs. One row has one home (queries.ts TRIP_WITH
 * filters the shelf to unattached rows), so nothing is drawn twice, and
 * `stopName` is the only thing that differs — a shelf idea has no stop to
 * borrow a name from.
 *
 * No new query — `Trip` already carries ideas with a nullable `place`, and
 * `listTripsWithStopsForOwner` already hydrates both lists. Q4 = A: EVERY
 * status counts into the unmapped total, because the dashed chip and the Locate
 * button beside it have to tell one story, and a "done" idea with no
 * coordinates is still a row the map cannot draw — and a shelf idea that never
 * reached this list would be a row the Locate batch could never see.
 */
function pushIdeas(
  pins: MapPin[],
  unmapped: UnmappedRow[],
  trip: Trip,
  ideas: Stop["ideas"],
  stopName: string | null,
  layer: Exclude<MapLayer, "saved">,
): void {
  for (const idea of ideas) {
    // `mapIdea` returns a non-null `place` the moment place_name is set, with
    // lat/lng still null — the normal outcome of the picker's free-text escape
    // row. Half a place is not a pin, so the same `hasCoords` test the stops
    // make decides it here too.
    if (!idea.place || !hasCoords(idea.place)) {
      unmapped.push({ id: idea.id, name: idea.title, layer, kind: "idea" });
      continue;
    }
    pins.push({
      kind: "idea",
      id: idea.id,
      lat: idea.place.lat,
      lng: idea.place.lng,
      layer,
      name: idea.title,
      status: idea.status,
      stopName,
      tripId: trip.id,
      tripTitle: trip.title,
    });
  }
}

/**
 * Fold every trip tree and the saved-place shelf into the one model each of the
 * three map modes reads. Coordless points are split out here, once — no pin path
 * downstream has to re-check for nulls.
 *
 * `routes` + `routingHash` are the server's resolved drives (map/page.tsx), and
 * they default to "none, no rig" so the Places map lens — which hands in no
 * trips at all (PlacesLibrary.tsx:82) — keeps calling this with two arguments.
 *
 * `units` is the account's display preference, resolved on the server and
 * passed down (lib/units.ts). It reaches exactly one thing here — the arc
 * label's distance — and it defaults, so the lens that draws no arc at all does
 * not have to name it.
 */
export function buildMapModel(
  trips: Trip[],
  places: SavedPlace[],
  routes: RouteMap = {},
  routingHash: string = NO_ROUTING_HASH,
  units: Units = DEFAULT_UNITS,
): MapModel {
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
          unmapped.push({ id: stop.id, name: stop.place.name, layer, kind: "stop" });
          // The stop has no pin, but its ideas still do — an idea's coordinates
          // are its own, not borrowed from the stop it hangs under.
          pushIdeas(pins, unmapped, trip, stop.ideas, stop.place.name, layer);
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
        pushIdeas(pins, unmapped, trip, stop.ideas, stop.place.name, layer);
      }
    }

    // The shelf, after the legs: the trip's unattached ideas (#80). They are
    // drawn last, so a maybe never lands between the stops in the rail's
    // reading order.
    pushIdeas(pins, unmapped, trip, trip.ideas, null, layer);

    // Arcs are drawn only for the trips AHEAD of you — a traveled trip's drive
    // already happened, and a dashed estimate over a real past route is a lie.
    if (layer === "been") continue;
    // `tripArcs` is the shared derivation (packages/core/src/planner/map-arcs.ts):
    // `orderedPairs`, not the scheduled-only sequence — it is the pair set the
    // Route rail, the dashboard card and the `routes` table all key on, so a
    // corridor resolved by the server can actually be looked up there. It also
    // already drops any pair touching a coordless stop — coordinates, not
    // dates, are the precondition (route-order.ts:49-57).
    //
    // What stays here is what is genuinely the web's: the layer this trip
    // paints on. The label wording is core's `arcLabel` — shared with the
    // phone's Map lens, and units-aware as of #45.
    for (const arc of tripArcs(trip, routes, routingHash)) {
      arcs.push({
        id: arc.id,
        layer,
        from: arc.from,
        to: arc.to,
        miles: arc.miles,
        label: arcLabel(arc, units),
        source: arc.source,
        path: arc.path,
      });
    }
  }

  for (const p of places) {
    if (!hasCoords(p.place)) {
      unmapped.push({ id: p.id, name: p.place.name, layer: "saved", kind: "place" });
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
