import { eq, and, asc, desc, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  deriveDays,
  deriveTripStatus,
  drivePairs,
  homeBasePlaceOf,
  resolveHomeBase,
  routeCacheKey,
  routeSummary,
  routingHash,
  tripRig,
  suggestionsFromTrips,
  surfaceRadiusMi,
  todayIso,
} from "@rv-trip/core";
import { db } from "./index";
import {
  trips,
  chapters,
  destinations,
  ideas,
  reservations,
  saves,
  tripDismissedSaves,
  travelSegments,
  rigs,
  routes,
  userPrefs,
  changeLog,
  households,
  householdMembers,
  householdInvites,
} from "./schema";
import type { HouseholdRole } from "./schema";
import type {
  ChangeEntity,
  ChangeField,
  IsoDate,
  LastChange,
  Trip,
  Chapter,
  Destination,
  Reservation,
  Idea,
  Place,
  SavedPlace,
  SaveArea,
  Segment,
  PlaceSuggestion,
  NavCheck,
  RigProfile,
  RouteResult,
  TripSummary,
  UserPrefs,
} from "@rv-trip/core";

/**
 * Fetch full trip trees (chapters → destinations → reservations/ideas) and map them to the
 * @rv-trip/core grammar. This mapper is the seam between the DB row shape (flat
 * place columns, numeric-as-string) and the domain types the clients consume.
 */

// The nested-load spec, inlined per query so Drizzle's relational types infer.
const TRIP_WITH = {
  chapters: {
    orderBy: (l, { asc }) => [asc(l.sortOrder)],
    with: {
      destinations: {
        orderBy: (s, { asc }) => [asc(s.sortOrder)],
        with: {
          // The `destination` relation joins on `destination_id`, so this is exactly the
          // DESTINATION-attached rows (#110 Q2 A); a flight arrives on its segment.
          reservations: true,
          ideas: { orderBy: (i, { asc }) => [asc(i.sortOrder)] },
        },
      },
    },
  },
  // The journey's hops (#110 §6), with the paperwork that hangs on them.
  segments: {
    orderBy: (s, { asc }) => [asc(s.sortOrder)],
    with: { reservations: true },
  },
  // The SHELF (#80): the trip's UNATTACHED ideas. `destination_id IS NULL` is what
  // keeps one row in one place — an attached idea already arrives under its
  // destination above, and loading it twice would draw it twice.
  ideas: {
    where: (i, { isNull }) => isNull(i.destinationId),
    orderBy: (i, { asc }) => [asc(i.sortOrder)],
  },
  // #126 · Q4 A — the "Where to?" locality (`trips.area_id`).
  area: true,
} satisfies NonNullable<Parameters<typeof db.query.trips.findFirst>[0]>["with"];

type TripRow = NonNullable<
  Awaited<ReturnType<typeof db.query.trips.findFirst<{ with: typeof TRIP_WITH }>>>
>;

// ── the change log's read side ────────────────────────────────────────────
//
// #78 · docs/design/81 §6. Two reads over one table: the NEWEST row per entity,
// joined onto a list read as `lastChange` ("rated by Jess · Sep 12"), and the
// last five rows for ONE entity behind `GET /api/history` — fetched only when
// the byline is opened, which is what keeps a row read to a single join.

/** The joined rows by `entity:id` — what a mapper looks its own row up in. */
export type LastChangeIndex = ReadonlyMap<string, LastChange>;

const changeKey = (entity: ChangeEntity, entityId: string) => `${entity}:${entityId}`;

/**
 * The default every mapper falls back to: no log was joined, so nothing has a
 * byline. Shared and never mutated — a create's `returning` row and the
 * dashboard's summaries both map through here and neither pays for a query.
 */
const NO_CHANGES: LastChangeIndex = new Map();

const lastChangeOf = (
  index: LastChangeIndex,
  entity: ChangeEntity,
  entityId: string,
): LastChange | null => index.get(changeKey(entity, entityId)) ?? null;

/**
 * The newest log row for every one of these entity ids, in ONE query.
 *
 * `DISTINCT ON (entity, entity_id)` with the matching ORDER BY is the join:
 * Postgres keeps the first row of each group and the group is ordered
 * `at desc, id desc`. The id tiebreak is load-bearing — two fields saved by one
 * patch share `at` EXACTLY (the clock is the transaction's `now()`), and
 * without it the byline would name an arbitrary one of the two.
 *
 * `household_id` is in the WHERE and not merely implied by the entity's own
 * ownership path: `change_log` is the one table that carries the tenant on
 * every row, and a row written under another household must never surface on
 * this one's byline. The ids themselves are uuids from four different tables,
 * so one `IN` list cannot collide across entities.
 */
async function lastChangesFor(
  householdId: string,
  entityIds: string[],
): Promise<LastChangeIndex> {
  if (entityIds.length === 0) return NO_CHANGES;
  const rows = await db
    .selectDistinctOn([changeLog.entity, changeLog.entityId], {
      entity: changeLog.entity,
      entityId: changeLog.entityId,
      field: changeLog.field,
      memberId: changeLog.memberId,
      at: changeLog.at,
    })
    .from(changeLog)
    .where(and(eq(changeLog.householdId, householdId), inArray(changeLog.entityId, entityIds)))
    .orderBy(changeLog.entity, changeLog.entityId, desc(changeLog.at), desc(changeLog.id));
  const index = new Map<string, LastChange>();
  for (const r of rows) {
    index.set(changeKey(r.entity, r.entityId), {
      field: r.field,
      // The best name this layer HAS. `household_members` stores a membership
      // and nothing else — no name, no email — so a display name can only come
      // from the identity provider, which packages/db deliberately cannot
      // reach (apps/web/src/lib/members.ts is the one place that asks).
      // `GET /api/history` resolves it there; this join falls back to the id.
      memberName: r.memberId,
      at: r.at.toISOString(),
    });
  }
  return index;
}

/** Every id under a loaded trip that can carry a byline: the destinations, their
 * reservations and ideas, and the shelf ideas hanging off the trip itself. */
function loggableIds(row: TripRow): string[] {
  const ids: string[] = row.ideas.map((i) => i.id);
  for (const seg of row.segments) for (const r of seg.reservations) ids.push(r.id);
  for (const chapter of row.chapters) {
    for (const destination of chapter.destinations) {
      ids.push(destination.id);
      for (const r of destination.reservations) ids.push(r.id);
      for (const i of destination.ideas) ids.push(i.id);
    }
  }
  return ids;
}

/** One row of `GET /api/history`, as the DATABASE can answer it: the member is
 * an id here, and the route turns it into a name (see `lastChangesFor`). */
export interface ChangeHistoryEntry {
  field: ChangeField;
  from: string | null;
  to: string | null;
  memberId: string;
  at: string;
}

/**
 * Is this entity the household's? The four ownership paths, each the same one
 * its write site scopes on — an idea through `trip_id` (#80: a shelf idea has
 * no destination), a reservation through its destination, a saved place through its own
 * `owner_id`.
 */
async function entityIsOwned(
  householdId: string,
  entity: ChangeEntity,
  entityId: string,
): Promise<boolean> {
  switch (entity) {
    case "destination": {
      const rows = await db
        .select({ id: destinations.id })
        .from(destinations)
        .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
        .innerJoin(trips, eq(chapters.tripId, trips.id))
        .where(and(eq(destinations.id, entityId), eq(trips.ownerId, householdId)));
      return rows.length > 0;
    }
    case "idea": {
      const rows = await db
        .select({ id: ideas.id })
        .from(ideas)
        .innerJoin(trips, eq(ideas.tripId, trips.id))
        .where(and(eq(ideas.id, entityId), eq(trips.ownerId, householdId)));
      return rows.length > 0;
    }
    case "reservation": {
      // Two parents since #110 (Q2 A): a destination, or a travel segment.
      const viaDestination = await db
        .select({ id: reservations.id })
        .from(reservations)
        .innerJoin(destinations, eq(reservations.destinationId, destinations.id))
        .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
        .innerJoin(trips, eq(chapters.tripId, trips.id))
        .where(and(eq(reservations.id, entityId), eq(trips.ownerId, householdId)));
      if (viaDestination.length > 0) return true;
      const viaSegment = await db
        .select({ id: reservations.id })
        .from(reservations)
        .innerJoin(travelSegments, eq(reservations.segmentId, travelSegments.id))
        .innerJoin(trips, eq(travelSegments.tripId, trips.id))
        .where(and(eq(reservations.id, entityId), eq(trips.ownerId, householdId)));
      return viaSegment.length > 0;
    }
    case "save": {
      const rows = await db
        .select({ id: saves.id })
        .from(saves)
        .where(and(eq(saves.id, entityId), eq(saves.ownerId, householdId)));
      return rows.length > 0;
    }
  }
}

/**
 * The audit behind an opened byline: this entity's last `limit` changes, newest
 * first. `null` — NOT an empty list — means the entity is not this household's,
 * so the route can 404 it exactly as every other read does; an owned thing that
 * has simply never been changed answers `[]`.
 *
 * The ownership check is a separate statement rather than a join onto the log,
 * because those two answers have to stay distinguishable: filtering the log by
 * the household alone would turn "not yours" into "no history", which would
 * quietly confirm that someone else's id exists.
 */
export async function listChangeHistory(
  householdId: string,
  entity: ChangeEntity,
  entityId: string,
  limit = 5,
): Promise<ChangeHistoryEntry[] | null> {
  if (!(await entityIsOwned(householdId, entity, entityId))) return null;
  const rows = await db
    .select({
      field: changeLog.field,
      from: changeLog.from,
      to: changeLog.to,
      memberId: changeLog.memberId,
      at: changeLog.at,
    })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.householdId, householdId),
        eq(changeLog.entity, entity),
        eq(changeLog.entityId, entityId),
      ),
    )
    // Same tiebreak as the join above, and the same reason.
    .orderBy(desc(changeLog.at), desc(changeLog.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

/**
 * The one seam both `Trip` and `TripSummary` pass through — so status is
 * derived exactly once, here, and the two shapes can never disagree. `today` is
 * threaded in so every row of one listing is evaluated against the same date.
 */
function mapTripRow(
  row: TripRow,
  today: IsoDate = todayIso(),
  last: LastChangeIndex = NO_CHANGES,
): Trip {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    homeBase: row.homeBase,
    // The three anchor columns read back as one object — without this half,
    // `trip.homeBasePlace` never reaches the client and the first destination of a chapter
    // would silently have no search bias (#60).
    homeBasePlace: homeBasePlaceOf(row),
    area: row.area
      ? {
          id: row.area.id,
          name: row.area.name,
          googlePlaceId: row.area.googlePlaceId,
          lat: row.area.lat,
          lng: row.area.lng,
        }
      : null,
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
    defaultMode: row.defaultMode,
    lodgingDefault: row.lodgingDefault,
    rigOn: row.rigOn,
    // A smallint on the way out; the CHECK only ever lets the four chips in,
    // and anything else (a hand-edited row) reads as "never picked".
    surfaceRadiusMi: surfaceRadiusMi.nullable().catch(null).parse(row.surfaceRadiusMi),
    chapters: row.chapters.map((l) => mapChapter(l, last)),
    ideas: row.ideas.map((i) => mapIdea(i, last)),
    segments: row.segments.map((s) => mapSegment(s, last)),
  };
}

/** A timestamptz column, as the ISO instant the wire carries. */
const instant = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export interface MapSegmentRow {
  id: string;
  tripId: string;
  fromDestinationId: string | null;
  toDestinationId: string | null;
  mode: Segment["mode"];
  departAt: Date | null;
  arriveAt: Date | null;
  departTz: string | null;
  arriveTz: string | null;
  sortOrder: number;
  reservations: MapReservationRow[];
}

/** One hop (#110 §6) and the paperwork on it. */
export function mapSegment(s: MapSegmentRow, last: LastChangeIndex = NO_CHANGES): Segment {
  return {
    id: s.id,
    tripId: s.tripId,
    fromDestinationId: s.fromDestinationId,
    toDestinationId: s.toDestinationId,
    mode: s.mode,
    departAt: instant(s.departAt),
    arriveAt: instant(s.arriveAt),
    departTz: s.departTz,
    arriveTz: s.arriveTz,
    sortOrder: s.sortOrder,
    reservations: s.reservations.map((r) => mapReservation(r, last)),
  };
}

export async function getTripById(ownerId: string, tripId: string): Promise<Trip | null> {
  const row = await db.query.trips.findFirst({
    where: and(eq(trips.ownerId, ownerId), eq(trips.id, tripId)),
    with: TRIP_WITH,
  });
  if (!row) return null;
  // ONE extra query for the whole tree's bylines (#78 §6 read 1). It is joined
  // here and not in `listTripsForOwner`/`listTripsWithDestinationsForOwner`: the
  // dashboard throws the tree away inside `summarize()` and the map draws pins,
  // so neither renders a byline and neither should pay for one.
  const trip = mapTripRow(row, todayIso(), await lastChangesFor(ownerId, loggableIds(row)));
  // #126 · Q5 A — the home base a trip starts from: its own override, else the
  // household default. Coalesced HERE so the page, `GET /api/trips/:id` (the
  // phone's bundle) and the optimistic `withReconciledSegments` all see the
  // same value `loadSegmentTrip` reconciles the hops with (vet HIGH).
  const home = resolveHomeBase(trip, (await getPrefsByOwner(ownerId))?.homeBasePlace ?? null);
  return {
    ...trip,
    homeBase: home.homeBase,
    homeBasePlace: home.homeBasePlace,
    homeBaseFromHousehold: home.fromHousehold,
  };
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
  // Two hashes at most, not one: a trip that leaves the rig at home (#103 ·
  // `rigOn: false`) is routed — and cached — without it, so its miles are
  // looked up on the no-rig key (`tripRig`, the same rule the planner uses).
  const rigHash = await routingHash(rig);
  const noRig = await routingHash(null);
  const hashOf = (trip: Trip) => (tripRig(trip, rig) ? rigHash : noRig);
  // Driven hops only (#110 §6): a flight has no road in the cache.
  const keys = mapped.flatMap((trip) =>
    drivePairs(trip).map((p) => routeCacheKey(p.from, p.to, hashOf(trip))),
  );
  const routes = await getCachedRoutes(keys);
  return mapped.map((trip) => summarize(trip, routes, hashOf(trip)));
}

/**
 * Whether a trip brings the rig (#103), owner-scoped — what `POST /api/routes`
 * keys a post-reorder upgrade with, so the reply's hash matches the page's
 * (vet HIGH). `null` when the owner has no such trip.
 */
export async function getTripRigOn(ownerId: string, tripId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ rigOn: trips.rigOn })
    .from(trips)
    .where(and(eq(trips.ownerId, ownerId), eq(trips.id, tripId)));
  return row ? row.rigOn : null;
}

/**
 * Every trip as its full tree — the map needs chapters → destinations → coordinates, which
 * `listTripsForOwner` throws away inside `summarize()`. Same query, same
 * `TRIP_WITH` load; only the mapping differs.
 */
export async function listTripsWithDestinationsForOwner(ownerId: string): Promise<Trip[]> {
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
 * The haversine over adjacent scheduled destinations this used to sum disagreed
 * twice: a chord instead of a road, and a pair set that never counted the
 * drive to a floating destination.
 */
function summarize(
  trip: Trip,
  routes: Record<string, RouteResult>,
  hash: string,
): TripSummary {
  const destinations = trip.chapters.flatMap((l) => l.destinations);
  const { days } = deriveDays(trip, destinations, trip.segments);
  const open = days.filter((d) => d.kind === "empty").length;
  const summary = routeSummary(trip, routes, hash);
  // Honest when it is guessing: a single missed key means the total carries at
  // least one straight-line estimate, and the card says so beside the number.
  const milesEstimated = drivePairs(trip).some(
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
    destinations: destinations.length,
    chapters: trip.chapters.length,
    miles: summary.driveMiles,
    milesEstimated,
    open,
  };
}

/**
 * Everything `PATCH /api/destinations/:id` needs to judge a date write: the destination's
 * CURRENT dates (a patch may send only one of the pair) and the window of the
 * trip it hangs under, owner-scoped through the same destinations -> chapters -> trips
 * join every destination write uses. `deriveDays` clamps to that window
 * (derive-days.ts), so dates outside it would make the destination invisible rather
 * than wrong — hence the 409. `null` means the owner has no such destination: a 404.
 */
export async function getDestinationDateContext(
  ownerId: string,
  destinationId: string,
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
      arriveDate: destinations.arriveDate,
      departDate: destinations.departDate,
    })
    .from(destinations)
    .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
    .innerJoin(trips, eq(chapters.tripId, trips.id))
    .where(and(eq(destinations.id, destinationId), eq(trips.ownerId, ownerId)));
  return rows[0] ?? null;
}

/**
 * The Places library for an account — both shelves in one list. The page
 * partitions by `status`; sending both keeps the shelf counts honest without a
 * second round-trip. `tripName` is denormalized from the visited-on trip.
 */
export async function listSavedPlacesForOwner(ownerId: string): Promise<SavedPlace[]> {
  const rows = await db.query.saves.findMany({
    where: eq(saves.ownerId, ownerId),
    orderBy: [desc(saves.createdAt)],
    with: { trip: { columns: { title: true } }, area: true },
  });
  // The /places cards render a byline (§5), so the library read joins the log
  // the same way the trip tree does — one query for the whole page.
  const last = await lastChangesFor(ownerId, rows.map((r) => r.id));
  return rows.map((r) => mapSavedPlaceRow(r, r.trip?.title ?? null, last));
}

/**
 * The saves this trip's banner was dismissed for (#111 Q6 A) — what
 * `nearbySaves` leaves out. Owner-scoped through the trip: a foreign trip id
 * reads as no dismissals, never as someone else's.
 */
export async function listDismissedSaveIds(ownerId: string, tripId: string): Promise<string[]> {
  const rows = await db
    .select({ saveId: tripDismissedSaves.saveId })
    .from(tripDismissedSaves)
    .innerJoin(trips, eq(trips.id, tripDismissedSaves.tripId))
    .where(and(eq(tripDismissedSaves.tripId, tripId), eq(trips.ownerId, ownerId)));
  return rows.map((r) => r.saveId);
}

/**
 * The "Been there?" candidates (docs/design/41 §7) — every destination AND every
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
 * The `saves` row → `SavedPlace` seam: flat place columns in, the nested
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
    /** #113 · absent (a caller that selected columns) reads as not said. */
    again?: boolean | null;
    tripId: string | null;
    anchor: SavedPlace["anchor"];
    areaLabel: string | null;
    suggestedPlace: SavedPlace["suggestedPlace"];
    /** Absent reads as null, for a caller that selected columns (#111 i2). */
    createdAt?: Date | null;
    /** The joined `areas` row (#111) — null when unanchored. Absent
     * (undefined) reads as null too, for a caller that did not join it. */
    area?: SaveAreaRow | null;
  },
  tripName: string | null,
  last: LastChangeIndex = NO_CHANGES,
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
    again: r.again ?? null,
    tripId: r.tripId,
    tripName,
    lastChange: lastChangeOf(last, "save", r.id),
    anchor: r.anchor,
    areaLabel: r.areaLabel,
    area: r.area ? mapSaveArea(r.area) : null,
    suggestedPlace: r.suggestedPlace ?? null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  };
}

/** The `areas` columns a save's read shape carries. */
export interface SaveAreaRow {
  id: string;
  name: string;
  region: string | null;
  googlePlaceId: string;
  lat: number | null;
  lng: number | null;
}

export function mapSaveArea(d: SaveAreaRow): SaveArea {
  return {
    id: d.id,
    name: d.name,
    region: d.region,
    googlePlaceId: d.googlePlaceId,
    lat: d.lat,
    lng: d.lng,
  };
}

function mapPlace(name: string, lat: number | null, lng: number | null, gid: string | null): Place {
  return { name, lat, lng, googlePlaceId: gid };
}

export function mapChapter(
  l: {
    id: string;
    tripId: string;
    title: string | null;
    sortOrder: number;
    destinations: MapDestinationRow[];
  },
  last: LastChangeIndex = NO_CHANGES,
): Chapter {
  return {
    id: l.id,
    tripId: l.tripId,
    title: l.title,
    sortOrder: l.sortOrder,
    destinations: l.destinations.map((s) => mapDestination(s, last)),
  };
}

export interface MapDestinationRow {
  id: string;
  chapterId: string;
  placeName: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  arriveDate: string | null;
  departDate: string | null;
  sortOrder: number;
  rating: number | null;
  again: boolean | null;
  notes: string | null;
  reservations: MapReservationRow[];
  ideas: MapIdeaRow[];
}

export function mapDestination(s: MapDestinationRow, last: LastChangeIndex = NO_CHANGES): Destination {
  return {
    id: s.id,
    chapterId: s.chapterId,
    place: mapPlace(s.placeName, s.lat, s.lng, s.googlePlaceId),
    arriveDate: s.arriveDate,
    departDate: s.departDate,
    sortOrder: s.sortOrder,
    rating: s.rating,
    again: s.again,
    notes: s.notes,
    reservations: s.reservations.map((r) => mapReservation(r, last)),
    ideas: s.ideas.map((i) => mapIdea(i, last)),
    lastChange: lastChangeOf(last, "destination", s.id),
  };
}

interface MapReservationRow {
  id: string;
  destinationId: string | null;
  segmentId: string | null;
  ideaId: string | null;
  type: Reservation["type"];
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  confirmationNumber: string | null;
  cost: string | null;
  rating: number | null;
  again: boolean | null;
  notes: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  startsTz: string | null;
  endsTz: string | null;
  lodgingKind: Reservation["lodgingKind"];
  transportKind: Reservation["transportKind"];
}

/** Exported so a create/promote can hand its INSERT ... returning row back in
 * the core shape — the same seam the read path maps through. */
export function mapReservation(
  r: MapReservationRow,
  last: LastChangeIndex = NO_CHANGES,
): Reservation {
  return {
    id: r.id,
    destinationId: r.destinationId,
    segmentId: r.segmentId,
    ideaId: r.ideaId,
    type: r.type,
    name: r.name,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    confirmationNumber: r.confirmationNumber,
    cost: r.cost === null ? null : Number(r.cost),
    rating: r.rating,
    again: r.again,
    notes: r.notes,
    startsAt: instant(r.startsAt),
    endsAt: instant(r.endsAt),
    startsTz: r.startsTz,
    endsTz: r.endsTz,
    lodgingKind: r.lodgingKind,
    transportKind: r.transportKind,
    lastChange: lastChangeOf(last, "reservation", r.id),
  };
}

interface MapIdeaRow {
  id: string;
  tripId: string;
  destinationId: string | null;
  title: string;
  category: Idea["category"];
  status: Idea["status"];
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  rating: number | null;
  again: boolean | null;
  notes: string | null;
  sortOrder: number;
}

/** Exported for the same reason `mapReservation` is: `createIdea` returns the
 * row it just inserted, and the client splices exactly that shape. */
export function mapIdea(i: MapIdeaRow, last: LastChangeIndex = NO_CHANGES): Idea {
  return {
    id: i.id,
    tripId: i.tripId,
    destinationId: i.destinationId,
    title: i.title,
    category: i.category,
    status: i.status,
    place:
      i.placeName === null
        ? null
        : mapPlace(i.placeName, i.lat, i.lng, i.googlePlaceId),
    rating: i.rating,
    again: i.again,
    notes: i.notes,
    sortOrder: i.sortOrder,
    lastChange: lastChangeOf(last, "idea", i.id),
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

// ── preferences ────────────────────────────────────────────────────────────
/**
 * The account's preference row, or null when nothing has ever been chosen —
 * the same "null is a real state" shape as `getRigByOwner`. Every caller
 * already has a product default (dark, imperial, day, costs off), so a null row
 * and a row of nulls mean the same thing and neither needs a backfill.
 */
export async function getPrefsByOwner(ownerId: string): Promise<UserPrefs | null> {
  const row = await db.query.userPrefs.findFirst({ where: eq(userPrefs.ownerId, ownerId) });
  return row ? mapPrefsRow(row) : null;
}

/** `updated_at` is a Date off the driver; the API contract is JSON, so it
 * leaves here as an ISO string rather than as whatever a serializer guesses. */
export function mapPrefsRow(row: {
  ownerId: string;
  theme: string | null;
  units: string | null;
  mapStyle: string | null;
  trackCosts: boolean | null;
  homeBase?: string | null;
  homeBaseLat?: number | null;
  homeBaseLng?: number | null;
  homeBasePlaceId?: string | null;
  updatedAt: Date;
}): UserPrefs {
  return {
    ownerId: row.ownerId,
    theme: row.theme,
    units: row.units,
    mapStyle: row.mapStyle,
    trackCosts: row.trackCosts,
    // #126 · the household home base, as the one object the wire carries.
    homeBasePlace:
      row.homeBase == null
        ? null
        : {
            name: row.homeBase,
            lat: row.homeBaseLat ?? null,
            lng: row.homeBaseLng ?? null,
            googlePlaceId: row.homeBasePlaceId ?? null,
          },
    updatedAt: row.updatedAt.toISOString(),
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

/**
 * The corridor checks for those same keys, from the same rows under the same
 * TTL — a second read rather than a wider one, because resolving the check is
 * BILLABLE and therefore opt-in per caller: the trip page asks for it, /map and
 * the dashboard never do, and neither should pay a wider select for a column
 * they will not read.
 *
 * A key whose row has never been checked is simply absent, which is the same
 * answer as "no Google key" — verdict "plain".
 */
export async function getCachedNav(keys: string[]): Promise<Record<string, NavCheck>> {
  if (keys.length === 0) return {};
  const rows = await db
    .select({ key: routes.key, nav: routes.nav })
    .from(routes)
    .where(
      and(
        inArray(routes.key, keys),
        gt(routes.fetchedAt, sql`now() - ${`${ROUTE_CACHE_TTL_DAYS} days`}::interval`),
      ),
    );
  const map: Record<string, NavCheck> = {};
  for (const row of rows) if (row.nav) map[row.key] = row.nav;
  return map;
}

// ── the household (#77) ────────────────────────────────────────────────────

/** A person in the household, as `/settings` reads them. Names and email
 * addresses live in Clerk, not here — `household_members` holds the membership
 * and nothing else, so the page resolves the display half separately
 * (apps/web/src/lib/members.ts). */
export interface HouseholdMemberRow {
  userId: string;
  role: HouseholdRole;
  joinedAt: Date;
}

/** A link still in flight: not redeemed, not expired. */
export interface LiveHouseholdInvite {
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface HouseholdOverview {
  id: string;
  name: string;
  /** Oldest membership first, so the owner heads the list. */
  members: HouseholdMemberRow[];
  invite: LiveHouseholdInvite | null;
}

/** What `households.name` means before anyone has renamed it — the column's own
 * DDL default, repeated here for the one case where there is no row to read it
 * from (below). */
export const DEFAULT_HOUSEHOLD_NAME = "My household";

/**
 * Everything `/settings`'s Household card draws, in one read (docs/design/81
 * §3, plan item i3): the household, its members, and the one live invite.
 *
 * A MISSING `households` row is not an error. Keyless, `getOwner()` answers the
 * literal `dev-household` without a lookup (apps/web/src/lib/owner.ts), so this
 * can legitimately be asked about a household that migration 0007 seeded and a
 * fresh test database did not. Answering a named, empty household is what keeps
 * /settings rendering on a database nobody seeded, rather than 500ing on a page
 * whose other three cards need no database at all.
 *
 * "Live" is `redeemed_at IS NULL AND expires_at > now()`, newest first: the
 * card must never offer a dead link, and creating an invite already clears the
 * previous live one (`createHouseholdInvite`), so the limit is belt and braces.
 */
export async function getHouseholdOverview(householdId: string): Promise<HouseholdOverview> {
  const [row] = await db
    .select({ name: households.name })
    .from(households)
    .where(eq(households.id, householdId));

  const members = await db
    .select({
      userId: householdMembers.userId,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.joinedAt), asc(householdMembers.userId));

  const [invite] = await db
    .select({
      token: householdInvites.token,
      createdAt: householdInvites.createdAt,
      expiresAt: householdInvites.expiresAt,
    })
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.householdId, householdId),
        isNull(householdInvites.redeemedAt),
        // The APP's clock, not Postgres's: the app writes `expires_at` from
        // its own `new Date()` (`createHouseholdInvite`), so reading the window
        // with the same clock is what makes "expires in 14 days" one statement
        // rather than two that can disagree — and it is what lets a test with a
        // frozen clock assert the boundary at all.
        gt(householdInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(householdInvites.createdAt))
    .limit(1);

  return {
    id: householdId,
    name: row?.name ?? DEFAULT_HOUSEHOLD_NAME,
    members,
    invite: invite ?? null,
  };
}

/**
 * One invite row, by TOKEN and nothing else — what `/join/<token>` reads
 * before it knows who is looking (#77 · docs/design/81 §4).
 *
 * Deliberately NOT owner-scoped, unlike every other read in this file: the
 * visitor is not a member of the inviting household yet, so there is no owner
 * to scope it by. The token IS the capability (schema.ts — it is the primary
 * key because it is the path segment), and 64 bits of it is what stands
 * between a stranger and this row.
 *
 * Expiry and one-use are NOT filtered here: `/join` has to tell an expired link
 * apart from a spent one to render the right refusal, so the row comes back raw
 * and `joinVerdict` (mutations.ts) is the one place that judges it.
 */
export async function getHouseholdInvite(token: string): Promise<HouseholdInviteRow | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.token, token))
    .limit(1);
  return row ?? null;
}

export interface HouseholdInviteRow {
  token: string;
  householdId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Null until it is used — that null IS "one use" (schema.ts). */
  redeemedAt: Date | null;
}
