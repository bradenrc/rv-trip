import { eq, and, asc, desc, gt, inArray, sql } from "drizzle-orm";
import {
  deriveDays,
  deriveTripStatus,
  orderedPairs,
  routeCacheKey,
  routeSummary,
  routingHash,
  suggestionsFromTrips,
  todayIso,
} from "@rv-trip/core";
import { db } from "./index";
import { trips, legs, stops, savedPlaces, rigs, routes } from "./schema";
import type {
  IsoDate,
  Trip,
  Leg,
  Stop,
  Reservation,
  Idea,
  Place,
  SavedPlace,
  PlaceSuggestion,
  RigProfile,
  RouteResult,
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

/**
 * The one seam both `Trip` and `TripSummary` pass through — so status is
 * derived exactly once, here, and the two shapes can never disagree. `today` is
 * threaded in so every row of one listing is evaluated against the same date.
 */
function mapTripRow(row: TripRow, today: IsoDate = todayIso()): Trip {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    homeBase: row.homeBase,
    startDate: row.startDate,
    endDate: row.endDate,
    status: deriveTripStatus(
      {
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        statusAuto: row.statusAuto,
      },
      today,
    ),
    statusAuto: row.statusAuto,
    rating: row.rating,
    note: row.note,
    legs: row.legs.map(mapLeg),
  };
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

/**
 * The dashboard listing, and the ONE place the card's miles number is produced.
 *
 * It reads the route cache and never the provider: landing on the dashboard
 * can never cost money (docs/design/43 §3). The rig is resolved once and
 * `routingHash` derived once — not per trip — and every trip's pairs are asked
 * for in a single batched `getCachedRoutes`. A miss simply stays absent from
 * the map, which is exactly what `routeSummary` falls back on.
 */
export async function listTripsForOwner(ownerId: string): Promise<TripSummary[]> {
  const [rows, rig] = await Promise.all([
    db.query.trips.findMany({
      where: eq(trips.ownerId, ownerId),
      orderBy: [asc(trips.startDate)],
      with: TRIP_WITH,
    }),
    getRigByOwner(ownerId),
  ]);
  const today = todayIso();
  const mapped = rows.map((r) => mapTripRow(r, today));
  const hash = await routingHash(rig);
  const keys = mapped.flatMap((trip) =>
    orderedPairs(trip).map((p) => routeCacheKey(p.from, p.to, hash)),
  );
  const routes = await getCachedRoutes(keys);
  return mapped.map((trip) => summarize(trip, routes, hash));
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
  const today = todayIso();
  return rows.map((r) => mapTripRow(r, today));
}

/**
 * The card's stats. `miles` is `routeSummary().driveMiles` — the RAIL's own
 * number, the same function the planner calls over the same `orderedPairs` —
 * so the card and the rail cannot disagree, because they are one expression.
 * The haversine over adjacent scheduled stops this used to sum disagreed
 * twice: a chord instead of a road, and a pair set that never counted the
 * drive to a floating stop.
 */
function summarize(
  trip: Trip,
  routes: Record<string, RouteResult>,
  hash: string,
): TripSummary {
  const stops = trip.legs.flatMap((l) => l.stops);
  const { days } = deriveDays(trip, stops);
  const open = days.filter((d) => d.kind === "empty").length;
  const summary = routeSummary(trip, routes, hash);
  // Honest when it is guessing: a single missed key means the total carries at
  // least one straight-line estimate, and the card says so beside the number.
  const milesEstimated = orderedPairs(trip).some(
    (p) => !routes[routeCacheKey(p.from, p.to, hash)],
  );
  return {
    id: trip.id,
    title: trip.title,
    homeBase: trip.homeBase,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    statusAuto: trip.statusAuto,
    rating: trip.rating,
    note: trip.note,
    days: days.length,
    stops: stops.length,
    legs: trip.legs.length,
    miles: summary.driveMiles,
    milesEstimated,
    open,
  };
}

/**
 * Everything `PATCH /api/stops/:id` needs to judge a date write: the stop's
 * CURRENT dates (a patch may send only one of the pair) and the window of the
 * trip it hangs under, owner-scoped through the same stops -> legs -> trips
 * join every stop write uses. `deriveDays` clamps to that window
 * (derive-days.ts), so dates outside it would make the stop invisible rather
 * than wrong — hence the 409. `null` means the owner has no such stop: a 404.
 */
export async function getStopDateContext(
  ownerId: string,
  stopId: string,
): Promise<{
  tripId: string;
  tripStartDate: IsoDate;
  tripEndDate: IsoDate;
  arriveDate: IsoDate | null;
  departDate: IsoDate | null;
} | null> {
  const rows = await db
    .select({
      tripId: trips.id,
      tripStartDate: trips.startDate,
      tripEndDate: trips.endDate,
      arriveDate: stops.arriveDate,
      departDate: stops.departDate,
    })
    .from(stops)
    .innerJoin(legs, eq(stops.legId, legs.id))
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(and(eq(stops.id, stopId), eq(trips.ownerId, ownerId)));
  return rows[0] ?? null;
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
  const today = todayIso();
  return suggestionsFromTrips(rows.map((r) => mapTripRow(r, today)));
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

function mapPlace(name: string, lat: number | null, lng: number | null, gid: string | null): Place {
  return { name, lat, lng, googlePlaceId: gid };
}

export function mapLeg(l: {
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

export interface MapStopRow {
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

export function mapStop(s: MapStopRow): Stop {
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

/** Exported so a create/promote can hand its INSERT ... returning row back in
 * the core shape — the same seam the read path maps through. */
export function mapReservation(r: MapReservationRow): Reservation {
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

/** Exported for the same reason `mapReservation` is: `createIdea` returns the
 * row it just inserted, and the client splices exactly that shape. */
export function mapIdea(i: MapIdeaRow): Idea {
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

// ── the route cache ────────────────────────────────────────────────────────
/**
 * How long a cached route stands. Expressed as a READ filter, not a sweeper:
 * a stale row is simply re-fetched and upserted over (docs/design/43 §1), and
 * routes_fetched_at_idx is what makes the eventual cron a follow-up rather
 * than a migration.
 */
export const ROUTE_CACHE_TTL_DAYS = 30;

/**
 * The keys that are still fresh, as a RouteMap-shaped record. A miss and an
 * expired row are the same answer — absent — so the caller has exactly one
 * fall-through path to the vendor.
 *
 * Not owner-scoped, on purpose: the row has no owner. A route between two
 * coordinates under a given ROUTING hash is the same route for everyone, which
 * is only true now that the rig's NAME is out of the hash.
 */
export async function getCachedRoutes(keys: string[]): Promise<Record<string, RouteResult>> {
  if (keys.length === 0) return {};
  const rows = await db
    .select({ key: routes.key, result: routes.result })
    .from(routes)
    .where(
      and(
        inArray(routes.key, keys),
        gt(routes.fetchedAt, sql`now() - ${`${ROUTE_CACHE_TTL_DAYS} days`}::interval`),
      ),
    );
  const map: Record<string, RouteResult> = {};
  for (const row of rows) map[row.key] = row.result;
  return map;
}
