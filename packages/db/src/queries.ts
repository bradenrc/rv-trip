import { eq } from "drizzle-orm";
import { db } from "./index";
import { trips } from "./schema";
import type { Trip, Leg, Stop, Reservation, Idea, Place } from "@rv-trip/core";

/**
 * Fetch a full trip tree (legs → stops → reservations/ideas) for an owner and
 * map it to the @rv-trip/core grammar. This mapper is the seam between the DB
 * row shape (flat place columns, numeric-as-string) and the domain types the
 * clients consume — the real API will reuse it.
 */
export async function getTripForOwner(ownerId: string): Promise<Trip | null> {
  const row = await db.query.trips.findFirst({
    where: eq(trips.ownerId, ownerId),
    with: {
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
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    homeBase: row.homeBase,
    startDate: row.startDate,
    endDate: row.endDate,
    legs: row.legs.map(mapLeg),
  };
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
