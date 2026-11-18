import type { CategoryLabel } from "@rv-trip/ui";
import { categoryMeta } from "@rv-trip/ui";
import {
  DEFAULT_UNITS,
  NO_ROUTING_HASH,
  arcLabel,
  destinationBeen,
  hasCoords,
  isScheduled,
  libraryFilterKeeps,
  savePoint,
  tripArcs,
} from "@rv-trip/core";
import type {
  IdeaStatus,
  IsoDate,
  LibraryFilter,
  LocateRow,
  LocateRowKind,
  ReservationType,
  RouteMap,
  RouteSource,
  SavedPlace,
  Destination,
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

/** Which shelf of the dashboard a pin's trip sits on — labelled verbatim from
 * the dashboard's own section heads (apps/web/src/app/trips/page.tsx). It is no
 * longer a chip (#186 i6 · q8 A: the four library filters replaced the layer
 * chips); the rail still names a destination's trip by it, and arcs keep their
 * planning / upcoming paint. */
export type MapLayer = "planning" | "upcoming" | "been" | "saved";

export const LAYER_LABEL: Record<MapLayer, string> = {
  planning: "Planning now",
  upcoming: "Upcoming",
  been: "Been there",
  saved: "Saved places",
};

export interface PinReservation {
  id: string;
  type: ReservationType;
  name: string;
  /** "Stay · campground · Aug 2–5" */
  meta: string;
  cost: number | null;
}

export interface DestinationPin {
  kind: "destination";
  id: string;
  lat: number;
  lng: number;
  layer: Exclude<MapLayer, "saved">;
  /** #186 i6 · q7 A: core's `destinationBeen` — the trip is complete, or this
   * stop's departDate is behind today. A trip in progress draws its past stops
   * hollow and the rest filled. */
  been: boolean;
  name: string;
  /** 1-based position in the trip's scheduled sequence; null when floating. */
  ordinal: number | null;
  floating: boolean;
  /** "Aug 2–5", or null for a floating destination. */
  dates: string | null;
  /** Nights between arrive and depart; null for a floating destination. */
  nights: number | null;
  tripId: string;
  tripTitle: string;
  /** Null for an unnamed chapter (#155 · Q1 A) — the popup then names the trip alone. */
  chapterTitle: string | null;
  /** How many scheduled destinations the trip has — the "destination 1 of 3" denominator. */
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
  /** The trip it was visited on (`SavedPlace.tripId`) — what One trip keeps. */
  tripId: string | null;
}

/**
 * An idea (#69): the grammar's *maybe*, hanging under a destination. It draws smaller
 * than the destination it belongs to and carries no number, because it is not a
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
  /** The destination this idea hangs under, or `null` for a SHELF idea (#80): a
   * trip-level idea is attached to no destination, so there is no name to borrow and
   * the rail prints the trip alone. */
  destinationName: string | null;
  tripId: string;
  tripTitle: string;
  /** #186 i6: the destination it hangs under is been (a shelf idea: its trip
   * is complete). Set by `buildMapModel`; absent ⇒ the trip's layer decides. */
  been?: boolean;
  /** #179 · the Journal map's logged places carry their five-category colour
   * (core's `journalMap`). Absent everywhere else — the /map rule above still
   * holds there — and an absent category keeps the Do ring. */
  category?: CategoryLabel;
}

export type MapPin = DestinationPin | PlacePin | IdeaPin;

/** A point the map cannot draw — kept so nothing silently disappears. */
export interface UnmappedRow {
  id: string;
  name: string;
  layer: MapLayer;
  /** Which TABLE the id names, set at each `unmapped.push` site below. */
  kind: LocateRowKind;
  /** #186 i6 — what the four filters read, as on a pin (`filterFacts`). */
  been: boolean;
  tripId: string | null;
}

/**
 * The row as POST /api/places/locate wants it: ids only, plus which table the
 * id names — now a passthrough of the field above.
 *
 * It used to DERIVE the kind from the layer (`layer === "saved" ? "place" :
 * "destination"`), which held only while the three trip layers carried destinations alone. An
 * idea on a planning trip derived "destination", so the batch would have asked the
 * destinations table for an idea's id, loaded nothing, and reported the row still
 * unmapped forever, silently, on every press. The explicit field deletes a
 * guess about the caller.
 */
export function locateRowOf(row: UnmappedRow): LocateRow {
  return { kind: row.kind, id: row.id };
}

/**
 * One drive between consecutive destinations in the trip's ONE ordered sequence
 * (`orderedPairs`) — floating destinations included, which is why this is no longer
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
  /** #186 i6 — One trip draws that trip's arcs only. */
  tripId: string;
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

/** Trip-wide scheduled destinations sorted by arriveDate — the same ordering
 * `routeSummary()` uses (apps/web/src/lib/trip-logic.ts:294), so the map's
 * sequence and the Route rail's sequence are one sequence. */
function scheduledSequence(trip: Trip): Destination[] {
  return trip.chapters
    .flatMap((l) => l.destinations)
    .filter(isScheduled)
    .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
}

/** Whole days between two plain dates — no timestamps, no tz. */
function nightsBetween(arrive: string, depart: string): number {
  const ms = Date.parse(`${depart}T00:00:00Z`) - Date.parse(`${arrive}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function reservationsOf(destination: Destination): PinReservation[] {
  return destination.reservations.map((r) => {
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
 * A trip's ideas, split the same way a destination's own point is: a drawable one
 * becomes an `IdeaPin`, a coordless one an `UnmappedRow`.
 *
 * Called twice per trip — once per destination for the ideas hanging under it, and
 * once for `trip.ideas`, the SHELF (#80): the `destination_id IS NULL` rows the trip
 * tree carries beside its chapters. One row has one home (queries.ts TRIP_WITH
 * filters the shelf to unattached rows), so nothing is drawn twice, and
 * `destinationName` is the only thing that differs — a shelf idea has no destination to
 * borrow a name from.
 *
 * No new query — `Trip` already carries ideas with a nullable `place`, and
 * `listTripsWithDestinationsForOwner` already hydrates both lists. Q4 = A: EVERY
 * status counts into the unmapped total, because the dashed chip and the Locate
 * button beside it have to tell one story, and a "done" idea with no
 * coordinates is still a row the map cannot draw — and a shelf idea that never
 * reached this list would be a row the Locate batch could never see.
 */
function pushIdeas(
  pins: MapPin[],
  unmapped: UnmappedRow[],
  trip: Trip,
  ideas: Destination["ideas"],
  destinationName: string | null,
  layer: Exclude<MapLayer, "saved">,
  been: boolean,
): void {
  for (const idea of ideas) {
    // `mapIdea` returns a non-null `place` the moment place_name is set, with
    // lat/lng still null — the normal outcome of the picker's free-text escape
    // row. Half a place is not a pin, so the same `hasCoords` test the destinations
    // make decides it here too.
    if (!idea.place || !hasCoords(idea.place)) {
      unmapped.push({ id: idea.id, name: idea.title, layer, kind: "idea", been, tripId: trip.id });
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
      destinationName,
      tripId: trip.id,
      tripTitle: trip.title,
      been,
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
 *
 * `today` (#186 i6 · q7 A) is the reader's date (map/page.tsx reads the tz
 * cookie). Each destination's `been` is core's `destinationBeen`; with no
 * today only a complete trip's stops are been.
 *
 * A save is pinned at core's `savePoint` — its own lat/lng, else its area's —
 * the one point rule every map surface shares with the phone's `libraryMap`
 * and with Near you (#185 vet HIGH). Only a save with neither is unmapped.
 */
export function buildMapModel(
  trips: Trip[],
  places: SavedPlace[],
  routes: RouteMap = {},
  /** One hash for every trip, or (#103) each trip's own — a trip that leaves
   * the rig at home is routed on the no-rig key. A trip missing from the map
   * reads the no-rig hash. */
  routingHash: string | Readonly<Record<string, string>> = NO_ROUTING_HASH,
  units: Units = DEFAULT_UNITS,
  today: IsoDate | null = null,
): MapModel {
  const pins: MapPin[] = [];
  const unmapped: UnmappedRow[] = [];
  const arcs: DriveArc[] = [];

  for (const trip of trips) {
    const layer = layerOf(trip);
    const sequence = scheduledSequence(trip);
    const ordinalOf = new Map(sequence.map((s, i) => [s.id, i + 1]));

    for (const chapter of trip.chapters) {
      for (const destination of chapter.destinations) {
        const floating = !isScheduled(destination);
        const been = destinationBeen(trip, destination, today);
        if (!hasCoords(destination.place)) {
          unmapped.push({
            id: destination.id,
            name: destination.place.name,
            layer,
            kind: "destination",
            been,
            tripId: trip.id,
          });
          // The destination has no pin, but its ideas still do — an idea's coordinates
          // are its own, not borrowed from the destination it hangs under.
          pushIdeas(pins, unmapped, trip, destination.ideas, destination.place.name, layer, been);
          continue;
        }
        pins.push({
          kind: "destination",
          id: destination.id,
          lat: destination.place.lat,
          lng: destination.place.lng,
          layer,
          been,
          name: destination.place.name,
          ordinal: ordinalOf.get(destination.id) ?? null,
          floating,
          dates: isScheduled(destination) ? dateRange(destination.arriveDate, destination.departDate) : null,
          nights: isScheduled(destination) ? nightsBetween(destination.arriveDate, destination.departDate) : null,
          tripId: trip.id,
          tripTitle: trip.title,
          chapterTitle: chapter.title,
          scheduledTotal: sequence.length,
          rating: destination.rating,
          notes: destination.notes,
          reservations: reservationsOf(destination),
        });
        pushIdeas(pins, unmapped, trip, destination.ideas, destination.place.name, layer, been);
      }
    }

    // The shelf, after the chapters: the trip's unattached ideas (#80). They are
    // drawn last, so a maybe never lands between the destinations in the rail's
    // reading order.
    pushIdeas(pins, unmapped, trip, trip.ideas, null, layer, trip.status === "complete");

    // Arcs are drawn only for the trips AHEAD of you — a traveled trip's drive
    // already happened, and a dashed estimate over a real past route is a lie.
    if (layer === "been") continue;
    // `tripArcs` is the shared derivation (packages/core/src/planner/map-arcs.ts):
    // `orderedPairs`, not the scheduled-only sequence — it is the pair set the
    // Route rail, the dashboard card and the `routes` table all key on, so a
    // corridor resolved by the server can actually be looked up there. It also
    // already drops any pair touching a coordless destination — coordinates, not
    // dates, are the precondition (route-order.ts:49-57).
    //
    // What stays here is what is genuinely the web's: the layer this trip
    // paints on. The label wording is core's `arcLabel` — shared with the
    // phone's Map lens, and units-aware as of #45.
    const hash =
      typeof routingHash === "string" ? routingHash : (routingHash[trip.id] ?? NO_ROUTING_HASH);
    for (const arc of tripArcs(trip, routes, hash)) {
      arcs.push({
        id: arc.id,
        layer,
        tripId: trip.id,
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
    const point = savePoint(p);
    if (!point) {
      unmapped.push({
        id: p.id,
        name: p.place.name,
        layer: "saved",
        kind: "place",
        been: p.status === "been",
        tripId: p.tripId,
      });
      continue;
    }
    pins.push({
      kind: "place",
      id: p.id,
      lat: point.lat,
      lng: point.lng,
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
      tripId: p.tripId,
    });
  }

  return { pins, unmapped, arcs };
}

/**
 * What the four /map filters read off a pin (#186 i6 · #184): been, and the
 * trip it belongs to. A destination: its own `been`. A save: its shelf and the
 * trip it was visited on. An idea: the destination it hangs under (absent, its
 * trip's layer).
 */
export function filterFacts(pin: MapPin): { been: boolean; tripId: string | null } {
  if (pin.kind === "place") return { been: pin.status === "been", tripId: pin.tripId };
  if (pin.kind === "idea") return { been: pin.been ?? pin.layer === "been", tripId: pin.tripId };
  return { been: pin.been, tripId: pin.tripId };
}

/** The chip counts: the drawable pins each filter keeps, before the category
 * row. `trip` is 0 until a trip is picked. */
export function filterCounts(
  pins: MapPin[],
  tripId: string | null,
): { all: number; been: number; want: number; trip: number } {
  const count = (f: LibraryFilter) => pins.filter((p) => libraryFilterKeeps(f, filterFacts(p))).length;
  return {
    all: pins.length,
    been: count({ kind: "been" }),
    want: count({ kind: "want" }),
    trip: tripId === null ? 0 : count({ kind: "trip", tripId }),
  };
}

/** Arcs show under All, Want to go and One trip (that trip's only), never
 * under Been there: a drive already taken draws none (q8 A). */
export function arcKept(f: LibraryFilter, arc: Pick<DriveArc, "tripId">): boolean {
  if (f.kind === "been") return false;
  if (f.kind === "trip") return arc.tripId === f.tripId;
  return true;
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
