import { eq, and, asc } from "drizzle-orm";
import { deriveDays, isScheduled } from "@rv-trip/core";
import { db } from "./index";
import { trips } from "./schema";
import type { Trip, Leg, Stop, Reservation, Idea, Place, TripStatus } from "@rv-trip/core";

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

/** Dashboard row: a trip's identity + status/memory + computed stats. */
export interface TripSummary {
  id: string;
  title: string;
  homeBase: string | null;
  startDate: string;
  endDate: string;
  status: TripStatus;
  rating: number | null;
  note: string | null;
  days: number;
  stops: number;
  legs: number;
  miles: number;
  open: number;
}

export async function listTripsForOwner(ownerId: string): Promise<TripSummary[]> {
  const rows = await db.query.trips.findMany({
    where: eq(trips.ownerId, ownerId),
    orderBy: [asc(trips.startDate)],
    with: TRIP_WITH,
  });
  return rows.map((r) => summarize(mapTripRow(r)));
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
