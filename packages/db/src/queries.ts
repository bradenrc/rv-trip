import { eq, and, asc, desc } from "drizzle-orm";
import { deriveDays, isScheduled, suggestionsFromTrips } from "@rv-trip/core";
import { db } from "./index";
import { trips, savedPlaces, rigs } from "./schema";
import type {
  Trip,
  Leg,
  Stop,
  Reservation,
  Idea,
  Place,
  SavedPlace,
  PlaceSuggestion,
  RigProfile,
  TripSummary,
} from "@rv-trip/core";

/**
 * Fetch full trip trees (legs → stops → reservations/ideas) and map them to the
 * @rv-trip/core grammar. This mapper is the seam between the DB row shape (flat
 * place columns, numeric-as-string) and the domain types the clients consume.
 */

// The nested-load spec, inlined per query so Drizzle's relational types infer.
const TRIP_WITH = {
  legs: {
    orderBy: (l, { asc }) => [asc(l.sortOrder)],
    with: {
      stops: {
        orderBy: (s, { asc }) => [asc(s.sortOrder)],
        with: {
          reservations: true,
          ideas: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
        },
      },
    },
  },
} satisfies NonNullable<Parameters<typeof db.query.trips.findFirst>[0]>["with"];

type TripRow = NonNullable<
  Awaited<ReturnType<typeof db.query.trips.findFirst<{ with: typeof TRIP_WITH }>>>
>;

function mapTripRow(row: TripRow): Trip {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    homeBase: row.homeBase,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    rating: row.rating,
    note: row.note,
    legs: row.legs.map(mapLeg),
  };
}

export async function getTripForOwner(ownerId: string): Promise<Trip | null> {
  const row = await db.query.trips.findFirst({ where: eq(trips.ownerId, ownerId), with: TRIP_WITH });
  return row ? mapTripRow(row) : null;
}

export async function getTripById(ownerId: string, tripId: string): Promise<Trip | null> {
  const row = await db.query.trips.findFirst({
    where: and(eq(trips.ownerId, ownerId), eq(trips.id, tripId)),
    with: TRIP_WITH,
  });
  return row ? mapTripRow(row) : null;
}

/** Dashboard row — the shape is owned by @rv-trip/core so the API client can validate it. */
export type { TripSummary };

export async function listTripsForOwner(ownerId: string): Promise<TripSummary[]> {
  const rows = await db.query.trips.findMany({
    where: eq(trips.ownerId, ownerId),
    orderBy: [asc(trips.startDate)],
    with: TRIP_WITH,
  });
  return rows.map((r) => summarize(mapTripRow(r)));
}

/**
 * Every trip as its full tree — the map needs legs → stops → coordinates, which
 * `listTripsForOwner` throws away inside `summarize()`. Same query, same
 * `TRIP_WITH` load; only the mapping differs.
 */
export async function listTripsWithStopsForOwner(ownerId: string): Promise<Trip[]> {
  const rows = await db.query.trips.findMany({
    where: eq(trips.ownerId, ownerId),
    orderBy: [asc(trips.startDate)],
    with: TRIP_WITH,
  });
  return rows.map(mapTripRow);
}

function summarize(trip: Trip): TripSummary {
  const stops = trip.legs.flatMap((l) => l.stops);
  const { days } = deriveDays(trip, stops);
  const open = days.filter((d) => d.kind === "empty").length;
  const scheduled = stops
    .filter(isScheduled)
    .sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
  let miles = 0;
  for (let i = 0; i < scheduled.length - 1; i++) {
    miles += haversineMiles(scheduled[i]!.place, scheduled[i + 1]!.place);
  }
  return {
    id: trip.id,
    title: trip.title,
    homeBase: trip.homeBase,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    rating: trip.rating,
    note: trip.note,
    days: days.length,
    stops: stops.length,
    legs: trip.legs.length,
    miles: Math.round(miles),
    open,
  };
}

/**
 * The Places library for an account — both shelves in one list. The page
 * partitions by `status`; sending both keeps the shelf counts honest without a
 * second round-trip. `tripName` is denormalized from the visited-on trip.
 */
export async function listSavedPlacesForOwner(ownerId: string): Promise<SavedPlace[]> {
  const rows = await db.query.savedPlaces.findMany({
    where: eq(savedPlaces.ownerId, ownerId),
    orderBy: [desc(savedPlaces.createdAt)],
    with: { trip: { columns: { title: true } } },
  });
  return rows.map((r) => mapSavedPlaceRow(r, r.trip?.title ?? null));
}

/**
 * The "Been there?" candidates (docs/design/41 §7) — every stop AND every
 * reservation rated ≥ 4 on a trip that is `complete`. Same `TRIP_WITH` load as
 * the map's query; only the mapping differs, and that mapping is
 * `suggestionsFromTrips` in @rv-trip/core so the ≥ 4 filter, the reservation's
 * borrowed-region-but-never-borrowed-pin rule and the ordering are unit-tested
 * where a test runner actually runs (packages/core/src/domain/places.test.ts).
 *
 * De-duplication against the library is NOT done here: it is `isAlreadySaved`
 * against `listSavedPlacesForOwner`, applied in the island so that accepting a
 * suggestion drops it without a second round-trip.
 */
export async function listSuggestionCandidatesForOwner(
  ownerId: string,
): Promise<PlaceSuggestion[]> {
  const rows = await db.query.trips.findMany({
    where: and(eq(trips.ownerId, ownerId), eq(trips.status, "complete")),
    orderBy: [desc(trips.endDate)],
    with: TRIP_WITH,
  });
  return suggestionsFromTrips(rows.map(mapTripRow));
}

/**
 * The saved_places row → `SavedPlace` seam: flat place columns in, the nested
 * `place` the clients read out. Shared with the write path (mutations.ts) so a
 * created or patched row comes back in exactly the shape the library renders —
 * `tripName` is joined on read and passed in, never stored on the row.
 */
export function mapSavedPlaceRow(
  r: {
    id: string;
    ownerId: string;
    name: string;
    lat: number | null;
    lng: number | null;
    googlePlaceId: string | null;
    region: string | null;
    type: SavedPlace["type"];
    status: SavedPlace["status"];
    note: string | null;
    source: string | null;
    rating: number | null;
    tripId: string | null;
  },
  tripName: string | null,
): SavedPlace {
  return {
    id: r.id,
    ownerId: r.ownerId,
    place: mapPlace(r.name, r.lat, r.lng, r.googlePlaceId),
    region: r.region,
    type: r.type,
    status: r.status,
    note: r.note,
    source: r.source,
    rating: r.rating,
    tripId: r.tripId,
    tripName,
  };
}

function haversineMiles(a: Place, b: Place): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const R = 3958.8; // miles
  const dLat = deg(b.lat - a.lat);
  const dLng = deg(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(deg(a.lat)) * Math.cos(deg(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}
function deg(x: number): number {
  return (x * Math.PI) / 180;
}

function mapPlace(name: string, lat: number | null, lng: number | null, gid: string | null): Place {
  return { name, lat, lng, googlePlaceId: gid };
}

function mapLeg(l: {
  id: string;
  tripId: string;
  title: string;
  sortOrder: number;
  stops: MapStopRow[];
}): Leg {
  return {
    id: l.id,
    tripId: l.tripId,
    title: l.title,
    sortOrder: l.sortOrder,
    stops: l.stops.map(mapStop),
  };
}

interface MapStopRow {
  id: string;
  legId: string;
  placeName: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  arriveDate: string | null;
  departDate: string | null;
  sortOrder: number;
  rating: number | null;
  notes: string | null;
  reservations: MapReservationRow[];
  ideas: MapIdeaRow[];
}

function mapStop(s: MapStopRow): Stop {
  return {
    id: s.id,
    legId: s.legId,
    place: mapPlace(s.placeName, s.lat, s.lng, s.googlePlaceId),
    arriveDate: s.arriveDate,
    departDate: s.departDate,
    sortOrder: s.sortOrder,
    rating: s.rating,
    notes: s.notes,
    reservations: s.reservations.map(mapReservation),
    ideas: s.ideas.map(mapIdea),
  };
}

interface MapReservationRow {
  id: string;
  stopId: string;
  ideaId: string | null;
  type: Reservation["type"];
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  confirmationNumber: string | null;
  cost: string | null;
  rating: number | null;
  notes: string | null;
}

function mapReservation(r: MapReservationRow): Reservation {
  return {
    id: r.id,
    stopId: r.stopId,
    ideaId: r.ideaId,
    type: r.type,
    name: r.name,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    confirmationNumber: r.confirmationNumber,
    cost: r.cost === null ? null : Number(r.cost),
    rating: r.rating,
    notes: r.notes,
  };
}

interface MapIdeaRow {
  id: string;
  stopId: string;
  title: string;
  status: Idea["status"];
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  rating: number | null;
  notes: string | null;
  sortOrder: number;
}

function mapIdea(i: MapIdeaRow): Idea {
  return {
    id: i.id,
    stopId: i.stopId,
    title: i.title,
    status: i.status,
    place:
      i.placeName === null
        ? null
        : mapPlace(i.placeName, i.lat, i.lng, i.googlePlaceId),
    rating: i.rating,
    notes: i.notes,
    sortOrder: i.sortOrder,
  };
}

// ── the rig ────────────────────────────────────────────────────────────────
/**
 * The account's single rig, or null on a brand-new account. `null` is a real,
 * expected state — it is the same code path as a missing HERE key: every drive
 * falls back to a straight-line estimate and the trip still opens.
 */
export async function getRigByOwner(ownerId: string): Promise<RigProfile | null> {
  const row = await db.query.rigs.findFirst({ where: eq(rigs.ownerId, ownerId) });
  return row ? mapRigRow(row) : null;
}

/** numeric columns arrive as strings; the domain works in numbers. */
export function mapRigRow(row: {
  id: string;
  ownerId: string;
  name: string;
  type: "motorhome" | "trailer";
  heightMeters: string;
  widthMeters: string;
  lengthMeters: string;
  grossWeightKg: string;
  propaneOnBoard: boolean;
}): RigProfile {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    type: row.type,
    heightMeters: Number(row.heightMeters),
    widthMeters: Number(row.widthMeters),
    lengthMeters: Number(row.lengthMeters),
    grossWeightKg: Number(row.grossWeightKg),
    propaneOnBoard: row.propaneOnBoard,
  };
}
