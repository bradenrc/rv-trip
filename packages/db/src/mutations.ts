import { randomBytes, randomUUID } from "node:crypto";
import { eq, and, inArray, isNull, max, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  chapters,
  destinations,
  ideas,
  reservations,
  trips,
  rigs,
  routes,
  saves,
  tripDismissedSaves,
  areas,
  travelSegments,
  userPrefs,
  changeLog,
  households,
  householdMembers,
  householdInvites,
} from "./schema";
import type {
  BeenDecision,
  BeenThing,
  Idea,
  Chapter,
  Destination,
  Place,
  Reservation,
  ReservationType,
  IdeaCategory,
  IdeaStatus,
  IsoDate,
  LatLng,
  LodgingKind,
  TransportKind,
  NavCheck,
  PlaceSummary,
  RigProfile,
  RigProfileInput,
  ResolvedArea,
  RouteResult,
  SavedPlace,
  SavedPlaceCreate,
  SavedPlacePatch,
  SurfaceRadiusMi,
  TravelMode,
  TripStatus,
  UserPrefs,
  UserPrefsPatch,
  Segment,
  SegmentDateConflict,
  SegmentTrip,
  SegmentBookingsChoice,
  TripAreaInput,
  BoundaryFlightsInput,
  BoundaryBooking,
} from "@rv-trip/core";
import {
  beenWriteThrough,
  isJournalWorthy,
  clashMoveIsValid,
  clashOf,
  clashDestinationPatch,
  diffSegments,
  newSegmentDateConflicts,
  reconcileSegments,
  retimedSegment,
  suggestedPlaceFromSearch,
  withReturnHop,
  boundarySegments,
} from "@rv-trip/core";
import {
  getHouseholdInvite,
  mapIdea,
  mapChapter,
  mapReservation,
  mapDestination,
  mapPrefsRow,
  mapRigRow,
  mapSaveArea,
  mapSavedPlaceRow,
} from "./queries";

/**
 * Owner-scoped writes. Every mutation is constrained to resources belonging to
 * a trip the owner owns (via subquery), so a caller can never touch another
 * tenant's data even if they pass a foreign id. `owner` is the HOUSEHOLD id
 * (#77) — whatever `getOwner()` answered: a real household minted by
 * `ensureHouseholdForUser` (end of this file) with Clerk on, and the stable
 * `dev-household` without keys. It is NOT a Clerk user id any more; that is
 * `getActor()`, and from #78 on the two are passed separately.
 */

const ownedChapterIds = (owner: string) =>
  db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(trips, eq(chapters.tripId, trips.id))
    .where(eq(trips.ownerId, owner));

const ownedDestinationIds = (owner: string) =>
  db.select({ id: destinations.id }).from(destinations).where(inArray(destinations.chapterId, ownedChapterIds(owner)));

/**
 * The ownership path for IDEAS (#80). An idea carries `trip_id` whether or not
 * it is attached to a destination, so this — never `ownedDestinationIds` — is what every idea
 * write scopes on: a NULL `destination_id` matches no IN list, and scoping through the
 * destination would make the status pill, the stars, the note, the delete and #74's
 * Clear place all silent no-ops on exactly the shelf rows this epic creates.
 */
const ownedTripIds = (owner: string) =>
  db.select({ id: trips.id }).from(trips).where(eq(trips.ownerId, owner));

/** The ownership path for a HOP and the bookings on it (#104): a segment
 * carries `trip_id`, so it scopes through the trip like an idea does. */
const ownedSegmentIds = (owner: string) =>
  db
    .select({ id: travelSegments.id })
    .from(travelSegments)
    .where(inArray(travelSegments.tripId, ownedTripIds(owner)));

/** A reservation the caller owns — through its destination OR (#104) its hop. The
 * segment arm is why a flight can be edited and removed at all (vet MED: the
 * destination-only scope made both a 404). */
const ownedReservation = (owner: string, resId: string) =>
  and(
    eq(reservations.id, resId),
    or(
      inArray(reservations.destinationId, ownedDestinationIds(owner)),
      inArray(reservations.segmentId, ownedSegmentIds(owner)),
    ),
  );

// ── the journey's hops (#110 · docs/design/110 §6) ─────────────────────────
//
// Every write that can move the ROUTE SEQUENCE — a destination created, deleted,
// re-dated, moved or reordered; a chapter reordered or deleted; a home base set or
// cleared — persists core's `reconcileSegments` diff in the SAME transaction,
// so `travel_segments` is always the dense hop set Q1 A promises. A kept hop
// keeps its row (mode, times, reservations); a new hop is born in the trip's
// `default_mode`, untimed; an orphan is deleted and its reservations cascade.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A write refused because it would put a timed segment and a destination's dates in
 * disagreement (Q3 A — destination dates win, a destination is never silently re-dated).
 * `PATCH /api/destinations/:id` answers it as 409 `segment_date_mismatch`.
 */
export class SegmentDateMismatch extends Error {
  constructor(readonly conflict: SegmentDateConflict) {
    super("segment_date_mismatch");
    this.name = "SegmentDateMismatch";
  }
}

/**
 * A hop switched back to Drive while flights or ferries hang on it (#104 · vet
 * MED "switching back to drive"). Refused rather than silently orphaning the
 * bookings on a drive row that cannot draw them — remove them first.
 * `PATCH /api/segments/:id` answers it as 409 `segment_has_bookings`.
 */
export class SegmentHasBookings extends Error {
  constructor() {
    super("segment_has_bookings");
    this.name = "SegmentHasBookings";
  }
}

/** The slice of a trip its hop set is a function of, read inside `tx`. */
async function loadSegmentTrip(tx: Tx, tripId: string): Promise<SegmentTrip | null> {
  // #126 · Q5 A (vet HIGH) — the home → first hop exists when the trip has an
  // EFFECTIVE home base: its own override, else the household default. The same
  // coalesce `getTripById` hands the client, so the optimistic reconcile agrees.
  const [row] = await tx
    .select({
      id: trips.id,
      homeBase: trips.homeBase,
      householdHomeBase: userPrefs.homeBase,
      defaultMode: trips.defaultMode,
    })
    .from(trips)
    .leftJoin(userPrefs, eq(userPrefs.ownerId, trips.ownerId))
    .where(eq(trips.id, tripId));
  if (!row) return null;
  const trip = {
    id: row.id,
    homeBase: row.homeBase ?? row.householdHomeBase ?? null,
    defaultMode: row.defaultMode,
  };
  const chapterRows = await tx
    .select({ id: chapters.id, sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.tripId, tripId));
  const destinationRows = await tx
    .select({
      id: destinations.id,
      chapterId: destinations.chapterId,
      arriveDate: destinations.arriveDate,
      departDate: destinations.departDate,
      sortOrder: destinations.sortOrder,
    })
    .from(destinations)
    .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
    .where(eq(chapters.tripId, tripId));
  const segRows = await tx.select().from(travelSegments).where(eq(travelSegments.tripId, tripId));
  return {
    ...trip,
    chapters: chapterRows.map((l) => ({
      id: l.id,
      sortOrder: l.sortOrder,
      destinations: destinationRows.filter((s) => s.chapterId === l.id),
    })),
    segments: segRows.map(
      (r): Segment => ({
        ...r,
        departAt: r.departAt?.toISOString() ?? null,
        arriveAt: r.arriveAt?.toISOString() ?? null,
        reservations: [],
      }),
    ),
  };
}

/** Write `before → after` as the three statements it takes. */
async function writeSegments(tx: Tx, before: Segment[], after: Segment[]): Promise<void> {
  const diff = diffSegments(before, after);
  if (diff.remove.length > 0) {
    await tx.delete(travelSegments).where(inArray(travelSegments.id, diff.remove));
  }
  for (const s of diff.update) {
    await tx
      .update(travelSegments)
      .set({ fromDestinationId: s.fromDestinationId, toDestinationId: s.toDestinationId, sortOrder: s.sortOrder })
      .where(eq(travelSegments.id, s.id));
  }
  if (diff.insert.length > 0) {
    await tx.insert(travelSegments).values(
      diff.insert.map((s) => ({
        id: s.id,
        tripId: s.tripId,
        fromDestinationId: s.fromDestinationId,
        toDestinationId: s.toDestinationId,
        mode: s.mode,
        departAt: s.departAt === null ? null : new Date(s.departAt),
        arriveAt: s.arriveAt === null ? null : new Date(s.arriveAt),
        departTz: s.departTz,
        arriveTz: s.arriveTz,
        sortOrder: s.sortOrder,
      })),
    );
  }
}

/**
 * Reconcile one trip's hops and persist the diff. `transform` is the
 * would-be trip for a write that has NOT happened yet (a delete: the hops are
 * re-pointed first, so a → home row survives its from-destination's cascade).
 */
async function syncSegments(
  tx: Tx,
  tripId: string,
  transform: (t: SegmentTrip) => SegmentTrip = (t) => t,
): Promise<void> {
  const current = await loadSegmentTrip(tx, tripId);
  if (!current) return;
  const next = reconcileSegments(transform(current), randomUUID);
  await writeSegments(tx, current.segments, next);
}

/** A trip minus some destinations — what a destination or chapter delete is about to leave. */
function withoutDestinations(t: SegmentTrip, gone: (s: { id: string; chapterId: string }) => boolean): SegmentTrip {
  return { ...t, chapters: t.chapters.map((l) => ({ ...l, destinations: l.destinations.filter((s) => !gone(s)) })) };
}

// ── the change log ────────────────────────────────────────────────────────
//
// #78 · docs/design/81 §6. Four fields on four things — not an every-write
// firehose. (`again` joined in #113: "marked by Jess" names a personal answer
// the same way "rated by Jess" does.) Everything below this comment is the ONLY code in this file that
// touches `change_log`: the four `update*Fields` mutations each hand it a
// before/after pair, and it decides what (if anything) is worth a row.

/** The shared-voice fields, as the LOG names them (schema.ts `change_field`). */
type LoggedField = "rating" | "notes" | "status" | "again";

/** Every logged field, in one list — the two loops below read it, so a new
 * field lands in the log by being added here and to the pgEnum/Zod enum. */
const LOGGED_FIELDS = ["rating", "notes", "status", "again"] as const satisfies readonly LoggedField[];

/** A before/after pair per field the patch actually NAMED. A field the patch
 * left absent never appears here, so it can never be logged. */
type LoggedPair = Partial<Record<LoggedField, { before: unknown; after: unknown }>>;

/**
 * One column value as the log stores it. `from`/`to` are `text`, so a rating
 * travels as its decimal digits and an absent value stays NULL rather than
 * becoming the string "null" — the reader has to tell "cleared" from "was never
 * set" to render "★★★★ → —".
 */
const logValue = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Does this patch NAME any of the three logged fields? The answer decides
 * whether the write needs a transaction at all — a rename, a move, a date or a
 * cost stays the single statement it has always been.
 */
const logs = (patch: object, map: Partial<Record<LoggedField, string>> = {}): boolean =>
  LOGGED_FIELDS.some((field) => (map[field] ?? field) in patch);

/**
 * Pick the logged fields a patch NAMED, pairing each with what the row held
 * before the update. `before` is a row read in the SAME transaction as the
 * write — `.returning()` cannot serve it, because it yields post-update values
 * only.
 *
 * `map` exists for exactly one column: `saves.note` is singular
 * (schema.ts:204) while the log's vocabulary is `notes`, so the saved-place
 * call site maps the key here and nothing downstream has to know.
 */
function loggedPairs<P extends object, B extends object>(
  patch: P,
  before: B,
  map: Partial<Record<LoggedField, string>> = {},
): LoggedPair {
  const pairs: LoggedPair = {};
  for (const field of LOGGED_FIELDS) {
    const key = map[field] ?? field;
    if (!(key in patch)) continue;
    pairs[field] = {
      before: (before as Record<string, unknown>)[key],
      after: (patch as Record<string, unknown>)[key],
    };
  }
  return pairs;
}

/**
 * Write one row per field whose value actually MOVED. A no-op save — the stars
 * re-clicked on the rating they already showed, a note blurred without an edit
 * — writes nothing at all, which is what keeps the byline honest about who last
 * changed the thing.
 *
 * `owner` is the household (`getOwner()`); `actor` is the person
 * (`getActor()`). They are the two different strings #77 separated.
 */
async function logChanges(
  tx: { insert: typeof db.insert },
  input: {
    owner: string;
    actor: string;
    entity: (typeof changeLog.$inferInsert)["entity"];
    entityId: string;
    pairs: LoggedPair;
  },
): Promise<void> {
  const rows = (Object.keys(input.pairs) as LoggedField[])
    .map((field) => ({
      field,
      from: logValue(input.pairs[field]!.before),
      to: logValue(input.pairs[field]!.after),
    }))
    .filter((r) => r.from !== r.to)
    .map((r) => ({
      householdId: input.owner,
      entity: input.entity,
      entityId: input.entityId,
      field: r.field,
      from: r.from,
      to: r.to,
      memberId: input.actor,
    }));
  if (rows.length === 0) return;
  await tx.insert(changeLog).values(rows);
}

// ── trips ─────────────────────────────────────────────────────────────────
//
// A trip is the ownership root: it carries `ownerId` itself, so its writes scope
// on that column directly rather than through the chapter/destination subqueries below.
// Update and delete report whether the owner-scoped statement matched a row, so
// the handler can answer 404 instead of pretending a foreign id succeeded.

export async function createTrip(
  owner: string,
  input: {
    title: string;
    startDate: IsoDate;
    endDate: IsoDate;
    homeBase: string | null;
    // The home-base ANCHOR (#60) — flattened from the wire's nested
    // `homeBasePlace` by the route, because there is no such column.
    homeBaseLat?: number | null;
    homeBaseLng?: number | null;
    homeBasePlaceId?: string | null;
    // #103 · the setup's three answers (vet HIGH: the insert lists its values
    // explicitly, so a key not named here never reaches the row). Optional, so
    // a caller with none keeps the columns' own defaults.
    defaultMode?: TravelMode;
    lodgingDefault?: LodgingKind | null;
    rigOn?: boolean;
    /** #126 · Q4 A — "Where to?". Upserted as the household's areas
     * row; the trip points at it and opens with one destination spanning its dates. */
    area?: TripAreaInput | null;
  },
) {
  // One chapter in the SAME transaction: RouteView renders per chapter, so a trip with
  // none opens with nothing to hang "Add destination" on.
  return db.transaction(async (tx) => {
    const dest = input.area ?? null;
    const areaId = dest ? await upsertTripArea(tx, owner, dest) : null;
    const [row] = await tx
      .insert(trips)
      .values({
        areaId,
        ownerId: owner,
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        homeBase: input.homeBase,
        homeBaseLat: input.homeBaseLat ?? null,
        homeBaseLng: input.homeBaseLng ?? null,
        homeBasePlaceId: input.homeBasePlaceId ?? null,
        ...(input.defaultMode !== undefined && { defaultMode: input.defaultMode }),
        ...(input.lodgingDefault !== undefined && { lodgingDefault: input.lodgingDefault }),
        ...(input.rigOn !== undefined && { rigOn: input.rigOn }),
      })
      .returning();
    const [chapter] = await tx
      .insert(chapters)
      // #155 · Q1 A — an UNNAMED chapter: it renders no header until named.
      .values({ tripId: row!.id, title: null, sortOrder: 0 })
      .returning({ id: chapters.id });
    if (dest) {
      // #126 · Q4 A — the area IS the first destination, spanning the whole
      // trip (the "whole trip" pill). Its hops follow: home → it when the trip
      // has an effective home base (override, else household), and the → home
      // row a round trip needs (vet HIGH: only this create and the round-trip
      // save ever birth one).
      await tx.insert(destinations).values({
        chapterId: chapter!.id,
        placeName: dest.name,
        lat: dest.lat,
        lng: dest.lng,
        googlePlaceId: dest.googlePlaceId,
        arriveDate: input.startDate,
        departDate: input.endDate,
        sortOrder: 0,
      });
      await syncSegments(tx, row!.id);
      const reconciled = await loadSegmentTrip(tx, row!.id);
      if (reconciled && reconciled.homeBase !== null) {
        await writeSegments(
          tx,
          reconciled.segments,
          withReturnHop(reconciled, randomUUID).segments,
        );
      }
    }
    return row!;
  });
}

/**
 * The household's areas row for a "Where to?" pick — created on first
 * use, REUSED after (`areas_owner_place_uq`). An existing row keeps its
 * name and region; a pick that carries coordinates fills a point the row lacks.
 */
async function upsertTripArea(
  tx: Tx,
  owner: string,
  d: TripAreaInput,
): Promise<string> {
  const [row] = await tx
    .insert(areas)
    .values({ ownerId: owner, googlePlaceId: d.googlePlaceId, name: d.name, lat: d.lat, lng: d.lng })
    .onConflictDoUpdate({
      target: [areas.ownerId, areas.googlePlaceId],
      set: {
        lat: sql`coalesce(${areas.lat}, excluded.lat)`,
        lng: sql`coalesce(${areas.lng}, excluded.lng)`,
      },
    })
    .returning({ id: areas.id });
  return row!.id;
}

export async function updateTripFields(
  owner: string,
  tripId: string,
  patch: {
    title?: string;
    homeBase?: string | null;
    homeBaseLat?: number | null;
    homeBaseLng?: number | null;
    homeBasePlaceId?: string | null;
    startDate?: IsoDate;
    endDate?: IsoDate;
    status?: TripStatus;
    statusAuto?: boolean;
    rating?: number | null;
    note?: string | null;
    /** #111 i3 — the review sheet's radius chip (core's `surfaceRadiusMi`). */
    surfaceRadiusMi?: SurfaceRadiusMi | null;
    /** #103 · Trip settings' three defaults. A new `defaultMode` reaches only
     * the hops reconciled from now on — no existing segment is re-moded. */
    defaultMode?: TravelMode;
    lodgingDefault?: LodgingKind | null;
    rigOn?: boolean;
    /** #143 · Q8 A — phone Trip settings' Area. Upserts the household's
     * areas row and repoints `trips.area_id`; null clears the
     * pointer. Unlike the create, NO destination is written. */
    area?: TripAreaInput | null;
  },
): Promise<boolean> {
  const scope = and(eq(trips.id, tripId), eq(trips.ownerId, owner));
  const { area, ...fields } = patch;
  // An empty patch is a legal no-op, but `.set({})` is not a legal statement —
  // fall back to the existence check so the answer is still 204 vs 404.
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: trips.id }).from(trips).where(scope);
    return rows.length > 0;
  }
  // Setting or clearing the home base adds or removes the home → first hop
  // (#110 §6), and an area pick upserts its row first — both write in
  // one transaction with the trip update.
  if (fields.homeBase !== undefined || area !== undefined) {
    return db.transaction(async (tx) => {
      // Ownership first: the areas row is the household's, so a
      // stranger's trip id must not plant one.
      const owned = await tx.select({ id: trips.id }).from(trips).where(scope);
      if (owned.length === 0) return false;
      const areaId =
        area === undefined
          ? undefined
          : area === null
            ? null
            : await upsertTripArea(tx, owner, area);
      const updated = await tx
        .update(trips)
        .set({
          ...fields,
          ...(areaId === undefined ? {} : { areaId }),
          updatedAt: new Date(),
        })
        .where(scope)
        .returning({ id: trips.id });
      if (updated.length === 0) return false;
      if (fields.homeBase !== undefined) await syncSegments(tx, tripId);
      return true;
    });
  }
  const updated = await db
    .update(trips)
    .set({ ...fields, updatedAt: new Date() })
    .where(scope)
    .returning({ id: trips.id });
  return updated.length > 0;
}

/**
 * The banner's Dismiss (#111 Q6 A): remember these saves as dismissed for this
 * trip. Idempotent — a save dismissed twice is one row (`ON CONFLICT DO
 * NOTHING` on the (trip, save) key).
 *
 * The trip must be the caller's (false → the handler's 404), and only the
 * caller's own saves are recorded: an id that is not one of their saves is
 * dropped rather than planted against their trip.
 */
export async function dismissSavesForTrip(
  owner: string,
  tripId: string,
  saveIds: string[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)));
    if (!owned.length) return false;
    if (saveIds.length === 0) return true;
    const mine = await tx
      .select({ id: saves.id })
      .from(saves)
      .where(and(eq(saves.ownerId, owner), inArray(saves.id, saveIds)));
    if (mine.length === 0) return true;
    await tx
      .insert(tripDismissedSaves)
      .values(mine.map((s) => ({ tripId, saveId: s.id })))
      .onConflictDoNothing();
    return true;
  });
}

export async function deleteTrip(owner: string, tripId: string): Promise<boolean> {
  // Chapters -> destinations -> reservations/ideas all cascade from the FK (schema.ts).
  const deleted = await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)))
    .returning({ id: trips.id });
  return deleted.length > 0;
}

// ── chapters ──────────────────────────────────────────────────────────────────
//
// A chapter has no owner column of its own, so every chapter write scopes through
// `ownedChapterIds` — except the two that address a chapter that does not exist yet or
// addresses a whole trip (create, reorder), which check the PARENT trip's
// owner_id first and throw when it is not the caller's. An INSERT has no WHERE
// to match zero rows, so the check has to be an explicit select-then-throw:
// the same shape `createReservation` uses below.

/** The trip is the ownership root — a create/reorder proves it before writing. */
async function assertOwnedTrip(
  tx: { select: typeof db.select },
  owner: string,
  tripId: string,
): Promise<void> {
  const owned = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)));
  if (!owned.length) throw new Error("trip not found");
}

/** A chapter the caller owns, proved through the shared subquery. */
async function assertOwnedChapter(
  tx: { select: typeof db.select },
  owner: string,
  chapterId: string,
): Promise<void> {
  const owned = await tx
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), inArray(chapters.id, ownedChapterIds(owner))));
  if (!owned.length) throw new Error("chapter not found");
}

/**
 * "Add chapter" — appended to the end of the trip. The sortOrder is read and
 * written in ONE transaction so two concurrent adds cannot claim the same
 * position. Returns the core `Chapter` shape (with an empty `destinations`) so the planner
 * can splice it straight into the tree it is holding.
 */
export async function createChapter(
  owner: string,
  input: { tripId: string; title: string | null },
): Promise<Chapter> {
  return db.transaction(async (tx) => {
    await assertOwnedTrip(tx, owner, input.tripId);
    const [agg] = await tx
      .select({ highest: max(chapters.sortOrder) })
      .from(chapters)
      .where(eq(chapters.tripId, input.tripId));
    const [row] = await tx
      .insert(chapters)
      .values({
        tripId: input.tripId,
        title: input.title,
        sortOrder: (agg?.highest ?? -1) + 1,
      })
      .returning();
    return mapChapter({ ...row!, destinations: [] });
  });
}

/** The inline rename. Reports whether the owner-scoped statement matched. */
export async function updateChapterFields(
  owner: string,
  chapterId: string,
  patch: { title?: string | null },
): Promise<boolean> {
  const scope = and(eq(chapters.id, chapterId), inArray(chapters.id, ownedChapterIds(owner)));
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: chapters.id }).from(chapters).where(scope);
    return rows.length > 0;
  }
  const updated = await db.update(chapters).set(patch).where(scope).returning({ id: chapters.id });
  return updated.length > 0;
}

/** Destinations (and their reservations and ideas) cascade with the chapter. */
export async function deleteChapter(owner: string, chapterId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ tripId: chapters.tripId })
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), inArray(chapters.id, ownedChapterIds(owner))));
    if (!owned) return false;
    // Re-point the hops BEFORE the cascade, so the neighbours either side of
    // the chapter are joined and a → home row moves to the new last destination.
    await syncSegments(tx, owned.tripId, (t) => withoutDestinations(t, (s) => s.chapterId === chapterId));
    await tx.delete(chapters).where(eq(chapters.id, chapterId));
    return true;
  });
}

/**
 * "Move chapter up/down" sends the whole new order and the rows are renumbered in
 * one transaction — the same pattern as `reorderChapterDestinations` below, so a partial
 * write can never leave two chapters sharing a sortOrder. Each statement also
 * carries `chapters.tripId`, so an id from another trip renumbers nothing.
 */
export async function reorderTripChapters(
  owner: string,
  tripId: string,
  order: string[],
): Promise<void> {
  await assertOwnedTrip(db, owner, tripId);
  await db.transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(chapters)
        .set({ sortOrder: i })
        .where(and(eq(chapters.id, order[i]!), eq(chapters.tripId, tripId)));
    }
    await syncSegments(tx, tripId);
  });
}

// ── destinations ─────────────────────────────────────────────────────────────────

/**
 * "Add destination" — appended to the end of its chapter, floating unless the caller
 * already has dates. The AREA chapter is checked explicitly (an insert has
 * no WHERE to match zero rows), and the append reads and writes the sortOrder
 * inside one transaction.
 */
export async function createDestination(
  owner: string,
  input: {
    chapterId: string;
    place: Place;
    arriveDate: IsoDate | null;
    departDate: IsoDate | null;
  },
): Promise<Destination> {
  return db.transaction(async (tx) => {
    await assertOwnedChapter(tx, owner, input.chapterId);
    const [agg] = await tx
      .select({ highest: max(destinations.sortOrder) })
      .from(destinations)
      .where(eq(destinations.chapterId, input.chapterId));
    const [row] = await tx
      .insert(destinations)
      .values({
        chapterId: input.chapterId,
        placeName: input.place.name,
        lat: input.place.lat,
        lng: input.place.lng,
        googlePlaceId: input.place.googlePlaceId,
        arriveDate: input.arriveDate,
        departDate: input.departDate,
        sortOrder: (agg?.highest ?? -1) + 1,
      })
      .returning();
    const [chapter] = await tx.select({ tripId: chapters.tripId }).from(chapters).where(eq(chapters.id, input.chapterId));
    await syncSegments(tx, chapter!.tripId);
    return mapDestination({ ...row!, reservations: [], ideas: [] });
  });
}

/**
 * The widened destination write: rename (`placeName`), move (`chapterId`), reorder
 * (`sortOrder`) and the dates, on top of the rating/notes it always had.
 *
 * `ownedChapterIds` in the WHERE only proves the destination's CURRENT chapter is owned — it
 * says nothing about a chapter id being written INTO the row. So a move checks the
 * AREA chapter separately and throws, or "Move to chapter" would be a way to
 * push an owned destination into someone else's trip.
 */
export async function updateDestinationFields(
  owner: string,
  destinationId: string,
  patch: {
    placeName?: string;
    // The three place columns "Change place…" writes (#60). They arrive
    // flattened from the wire's nested `place` by `destinationPatchColumns`, because
    // this spreads its patch straight into drizzle's `.set()`.
    lat?: number | null;
    lng?: number | null;
    googlePlaceId?: string | null;
    chapterId?: string;
    sortOrder?: number;
    rating?: number | null;
    again?: boolean | null;
    notes?: string | null;
    arriveDate?: IsoDate | null;
    departDate?: IsoDate | null;
  },
  actor: string,
  deps: Pick<SaveDeps, "resolveArea"> = {},
): Promise<boolean> {
  const matched = await writeDestinationFields(owner, destinationId, patch, actor);
  // #113 · a rated / Again destination writes through to a Been save.
  if (matched && namesJournalField(patch)) {
    await writeThroughBeen(owner, { kind: "destination", id: destinationId }, { ...deps, actor });
  }
  return matched;
}

async function writeDestinationFields(
  owner: string,
  destinationId: string,
  patch: Parameters<typeof updateDestinationFields>[2],
  actor: string,
): Promise<boolean> {
  if (patch.chapterId !== undefined) await assertOwnedChapter(db, owner, patch.chapterId);
  const scope = and(eq(destinations.id, destinationId), inArray(destinations.chapterId, ownedChapterIds(owner)));
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: destinations.id }).from(destinations).where(scope);
    return rows.length > 0;
  }
  // A move, a reorder or a date moves the ROUTE SEQUENCE (route-order.ts sorts
  // scheduled destinations by arriveDate, floating ones after): drag-to-schedule,
  // Unschedule, "Move to chapter" and the rail reorder all reconcile the hops.
  const moves = SEQUENCE_KEYS.some((k) => k in patch);
  // A patch that names none of those and neither rating nor notes stays the ONE
  // statement it has always been — only a logged or sequencing field pays for
  // a transaction.
  if (!logs(patch) && !moves) {
    const updated = await db.update(destinations).set(patch).where(scope).returning({ id: destinations.id });
    return updated.length > 0;
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ rating: destinations.rating, notes: destinations.notes, again: destinations.again, tripId: chapters.tripId })
      .from(destinations)
      .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
      .where(scope);
    if (!before) return false;

    let segmentWrite: (() => Promise<void>) | null = null;
    if (moves) {
      const current = (await loadSegmentTrip(tx, before.tripId))!;
      const wouldBe = patchedDestination(current, destinationId, patch);
      const next = reconcileSegments(wouldBe, randomUUID);
      // Q3 A — destination dates win: a write that would put a TIMED segment out of
      // step with a destination's dates is refused, whole, before anything is written.
      const [conflict] = newSegmentDateConflicts(current, { ...wouldBe, segments: next });
      if (conflict) throw new SegmentDateMismatch(conflict);
      segmentWrite = () => writeSegments(tx, current.segments, next);
    }

    const updated = await tx.update(destinations).set(patch).where(scope).returning({ id: destinations.id });
    if (updated.length === 0) return false;
    if (segmentWrite) {
      await segmentWrite();
      // "Move to chapter" into ANOTHER trip: that trip gains a destination too.
      if (patch.chapterId !== undefined) {
        const [dest] = await tx.select({ tripId: chapters.tripId }).from(chapters).where(eq(chapters.id, patch.chapterId));
        if (dest && dest.tripId !== before.tripId) await syncSegments(tx, dest.tripId);
      }
    }
    if (logs(patch)) {
      await logChanges(tx, {
        owner,
        actor,
        entity: "destination",
        entityId: destinationId,
        pairs: loggedPairs(patch, before),
      });
    }
    return true;
  });
}

/** The destination-patch keys that can move the route sequence. */
const SEQUENCE_KEYS = ["chapterId", "sortOrder", "arriveDate", "departDate"] as const;

/**
 * The trip as it WOULD be after a destination patch — the destination re-dated, re-ordered or
 * moved (out of this trip entirely when its new chapter lives elsewhere). What the
 * conflict check and the reconcile both judge.
 */
function patchedDestination(
  t: SegmentTrip,
  destinationId: string,
  patch: {
    chapterId?: string;
    sortOrder?: number;
    arriveDate?: IsoDate | null;
    departDate?: IsoDate | null;
  },
): SegmentTrip {
  const destination = t.chapters.flatMap((l) => l.destinations).find((s) => s.id === destinationId);
  if (!destination) return t;
  const moved = {
    ...destination,
    ...(patch.chapterId !== undefined && { chapterId: patch.chapterId }),
    ...(patch.sortOrder !== undefined && { sortOrder: patch.sortOrder }),
    ...(patch.arriveDate !== undefined && { arriveDate: patch.arriveDate }),
    ...(patch.departDate !== undefined && { departDate: patch.departDate }),
  };
  return {
    ...t,
    chapters: t.chapters.map((l) => {
      const rest = l.destinations.filter((s) => s.id !== destinationId);
      return (l as { id?: string }).id === moved.chapterId ? { ...l, destinations: [...rest, moved] } : { ...l, destinations: rest };
    }),
  };
}

/** Reservations and ideas cascade with the destination. */
export async function deleteDestination(owner: string, destinationId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ tripId: chapters.tripId })
      .from(destinations)
      .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
      .where(and(eq(destinations.id, destinationId), inArray(destinations.chapterId, ownedChapterIds(owner))));
    if (!owned) return false;
    // Re-point first (see deleteChapter): the neighbours are joined by a new hop,
    // and a → home row leaving this destination moves to the new last destination instead of
    // cascading away with it.
    await syncSegments(tx, owned.tripId, (t) => withoutDestinations(t, (s) => s.id === destinationId));
    await tx.delete(destinations).where(eq(destinations.id, destinationId));
    return true;
  });
}

// ── reservations and ideas: the two LEAVES ────────────────────────────────
//
// Neither table has an owner column, so an UPDATE/DELETE scopes through
// `ownedDestinationIds` and reports whether it matched a row (404 vs 204). A CREATE
// has no WHERE to match zero rows, so it proves the parent destination first and
// throws — the shape `createReservation` has always used, now shared.

/** A destination the caller owns, proved before an insert can point at it. */
async function assertOwnedDestination(
  tx: { select: typeof db.select },
  owner: string,
  destinationId: string,
): Promise<void> {
  const owned = await tx
    .select({ id: destinations.id })
    .from(destinations)
    .where(and(eq(destinations.id, destinationId), inArray(destinations.chapterId, ownedChapterIds(owner))));
  if (!owned.length) throw new Error("destination not found");
}

/** The invariant no FK can span the join: an attached idea's destination must live on
 * the trip the idea claims. Ownership is already proved by the trip above, so
 * this is about the PAIR, not about tenancy. */
async function assertDestinationInTrip(
  tx: { select: typeof db.select },
  tripId: string,
  destinationId: string,
): Promise<void> {
  const found = await tx
    .select({ id: destinations.id })
    .from(destinations)
    .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
    .where(and(eq(destinations.id, destinationId), eq(chapters.tripId, tripId)));
  if (!found.length) throw new Error("destination not found");
}

/** The paperwork columns a create writes, parent aside. */
interface ReservationFields {
  type: ReservationType;
  name: string;
  checkIn: IsoDate | null;
  checkOut: IsoDate | null;
  confirmationNumber: string | null;
  cost: number | null;
  rating: number | null;
  notes: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  startsTz?: string | null;
  endsTz?: string | null;
  lodgingKind?: LodgingKind | null;
  /** #155 · Q4 A — flight · ferry · shuttle · train · car; null = the hop's mode. */
  transportKind?: TransportKind | null;
}

const reservationValues = (input: ReservationFields) => ({
  type: input.type,
  name: input.name,
  checkIn: input.checkIn,
  checkOut: input.checkOut,
  confirmationNumber: input.confirmationNumber,
  cost: input.cost == null ? null : String(input.cost),
  rating: input.rating,
  notes: input.notes,
  startsAt: input.startsAt ? new Date(input.startsAt) : null,
  endsAt: input.endsAt ? new Date(input.endsAt) : null,
  startsTz: input.startsTz ?? null,
  endsTz: input.endsTz ?? null,
  lodgingKind: input.lodgingKind ?? null,
  transportKind: input.transportKind ?? null,
});

/**
 * The destination sheet's reservation form, a hop's Add flight / Add ferry (#104) —
 * and the body an undone DELETE re-POSTs, which is why every column travels.
 * `cost` is a numeric column: it arrives as a number and is written as a
 * string, exactly the way `mapReservation` reads it back.
 *
 * A DESTINATION parent is proved with `assertOwnedDestination` and inserted, as it always
 * was. A SEGMENT parent is `createSegmentReservation` below.
 */
export async function createReservation(
  owner: string,
  input: ReservationFields & {
    destinationId?: string | null;
    segmentId?: string | null;
    moveDestination?: boolean;
  },
): Promise<Reservation> {
  if (input.segmentId) return createSegmentReservation(owner, { ...input, segmentId: input.segmentId });
  if (!input.destinationId) throw new Error("destination not found");
  await assertOwnedDestination(db, owner, input.destinationId);
  const [row] = await db
    .insert(reservations)
    .values({ destinationId: input.destinationId, ...reservationValues(input) })
    .returning();
  return mapReservation(row!);
}

/** A hop the caller owns, proved before an insert can point at it — an INSERT
 * has no WHERE, so the trip's owner is checked explicitly (vet MED). */
async function ownedSegment(
  tx: { select: typeof db.select },
  owner: string,
  segmentId: string,
): Promise<{ id: string; tripId: string } | null> {
  const [seg] = await tx
    .select({ id: travelSegments.id, tripId: travelSegments.tripId })
    .from(travelSegments)
    .innerJoin(trips, eq(travelSegments.tripId, trips.id))
    .where(and(eq(travelSegments.id, segmentId), eq(trips.ownerId, owner)));
  return seg ?? null;
}

/** Every booking on a hop, as its clock reads them — WITH its kind, so core's
 * `retimedSegment` can leave a shuttle/train/car out of the clock (#155 · Q4 A,
 * vet MED: a timed airport shuttle must never stretch the hop). */
async function segmentBookings(tx: Tx, segmentId: string) {
  const rows = await tx
    .select({
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      startsTz: reservations.startsTz,
      endsTz: reservations.endsTz,
      transportKind: reservations.transportKind,
    })
    .from(reservations)
    .where(eq(reservations.segmentId, segmentId));
  return rows.map((r) => ({
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    startsTz: r.startsTz,
    endsTz: r.endsTz,
    transportKind: r.transportKind,
  }));
}

/** Write a segment's clock. */
async function writeSegmentClock(tx: Tx, seg: Segment): Promise<void> {
  await tx
    .update(travelSegments)
    .set({
      departAt: seg.departAt === null ? null : new Date(seg.departAt),
      arriveAt: seg.arriveAt === null ? null : new Date(seg.arriveAt),
      departTz: seg.departTz,
      arriveTz: seg.arriveTz,
    })
    .where(eq(travelSegments.id, seg.id));
}

/**
 * A flight or a ferry booked on a hop (#104), in ONE transaction:
 *
 *  1. prove the hop is the caller's (its trip's owner — an insert has no WHERE);
 *  2. insert the booking;
 *  3. re-time the hop from ALL its bookings (core's `retimedSegment`: earliest
 *     departure, latest arrival, each in its own zone);
 *  4. judge it with `newSegmentDateConflicts(before, after)` — destination dates win
 *     (Q3 A), so a clash throws `SegmentDateMismatch` and the insert rolls
 *     back, UNLESS `moveDestination` (Q8 A's "Check out of … on … instead"): then the
 *     touched destination's date — its check-out for a hop home, its check-in
 *     otherwise — is set to the booking's own date, its stay row moves with it
 *     (vet MED c), and the hops are reconciled exactly as a destination re-date is
 *     (vet MED b: a new arrive date can reorder the route). After the move the
 *     check must find nothing new, or the whole write is refused.
 */
async function createSegmentReservation(
  owner: string,
  input: ReservationFields & { segmentId: string; moveDestination?: boolean },
): Promise<Reservation> {
  return db.transaction(async (tx) => {
    const seg = await ownedSegment(tx, owner, input.segmentId);
    if (!seg) throw new Error("segment not found");

    const [row] = await tx
      .insert(reservations)
      .values({ segmentId: seg.id, ...reservationValues(input) })
      .returning();

    const before = (await loadSegmentTrip(tx, seg.tripId))!;
    const current = before.segments.find((s) => s.id === seg.id)!;
    const retimed = retimedSegment(current, await segmentBookings(tx, seg.id));
    const after: SegmentTrip = {
      ...before,
      segments: before.segments.map((s) => (s.id === seg.id ? retimed : s)),
    };
    const [conflict] = newSegmentDateConflicts(before, after).filter((c) => c.segmentId === seg.id);

    if (!conflict) {
      await writeSegmentClock(tx, retimed);
      return mapReservation(row!);
    }
    const clash = input.moveDestination ? clashOf(after, retimed, conflict) : null;
    if (!clash) throw new SegmentDateMismatch(conflict);

    // Q8 A · move the destination. Refused (as the same 409) when the move would turn
    // the destination's range backwards or push it outside the trip.
    const destination = after.chapters.flatMap((l) => l.destinations).find((s) => s.id === clash.destinationId)!;
    const patch = clashDestinationPatch(clash);
    const [window] = await tx
      .select({ startDate: trips.startDate, endDate: trips.endDate })
      .from(trips)
      .where(eq(trips.id, seg.tripId));
    const moved = Object.values(patch)[0] as IsoDate;
    if (!clashMoveIsValid(destination, clash) || moved < window!.startDate || moved > window!.endDate) {
      throw new SegmentDateMismatch(conflict);
    }
    const wouldBe = patchedDestination(after, destination.id, patch);
    const next = reconcileSegments(wouldBe, randomUUID);
    if (newSegmentDateConflicts(before, { ...wouldBe, segments: next }).length > 0) {
      throw new SegmentDateMismatch(conflict);
    }

    await tx.update(destinations).set(patch).where(eq(destinations.id, destination.id));
    // The destination's own stay follows it, so the card and the destination agree.
    const { expected, actual } = conflict;
    const stay = and(
      eq(reservations.destinationId, destination.id),
      inArray(reservations.type, ["campground", "lodging"]),
    );
    if (clash.side === "checkout") {
      await tx
        .update(reservations)
        .set({ checkOut: actual })
        .where(and(stay, eq(reservations.checkOut, expected)));
    } else {
      await tx
        .update(reservations)
        .set({ checkIn: actual })
        .where(and(stay, eq(reservations.checkIn, expected)));
    }
    await writeSegments(tx, before.segments, next);
    if (next.some((s) => s.id === seg.id)) await writeSegmentClock(tx, retimed);
    return mapReservation(row!);
  });
}

/**
 * A hop's mode switch (#104 · Q7 B) — `PATCH /api/segments/:id`. Owner-scoped
 * in the UPDATE itself (vet MED): the segment's trip must be the caller's.
 *
 * #129 · Q11 A — reversible, and the 409 `segment_has_bookings` is gone:
 *
 *  - to Drive: the hop's clock is cleared with the mode (an untimed drive
 *    borrows its day from the destination it arrives at). Its flights are KEPT on
 *    `segment_id` — parked, hidden while it drives — or, with `remove`,
 *    deleted. An absent choice reads as `keep`: the one that loses nothing.
 *  - to Fly/Ferry: the hop is RE-TIMED from the bookings it kept (vet MED 2),
 *    so the ✈ cell and `segmentDateConflicts` have a clock again — unless that
 *    clock would now clash with the destination dates, in which case the hop stays
 *    untimed (the same rule a booking delete follows).
 */
export async function updateSegmentMode(
  owner: string,
  segmentId: string,
  mode: TravelMode,
  bookings: SegmentBookingsChoice = "keep",
): Promise<boolean> {
  const scope = and(eq(travelSegments.id, segmentId), inArray(travelSegments.tripId, ownedTripIds(owner)));
  return db.transaction(async (tx) => {
    const [seg] = await tx
      .select({ id: travelSegments.id, tripId: travelSegments.tripId })
      .from(travelSegments)
      .where(scope);
    if (!seg) return false;
    if (mode === "drive") {
      if (bookings === "remove") {
        await tx.delete(reservations).where(eq(reservations.segmentId, segmentId));
      }
      await tx
        .update(travelSegments)
        .set({ mode, departAt: null, arriveAt: null, departTz: null, arriveTz: null })
        .where(scope);
      return true;
    }
    await tx.update(travelSegments).set({ mode }).where(scope);
    await retimeQuietly(tx, seg.tripId, segmentId);
    return true;
  });
}

/** Re-time one hop from its bookings, and write the clock only when it moved
 * and introduces no destination-date clash. */
async function retimeQuietly(tx: Tx, tripId: string, segmentId: string): Promise<void> {
  const before = (await loadSegmentTrip(tx, tripId))!;
  const current = before.segments.find((s) => s.id === segmentId);
  if (!current) return;
  const retimed = retimedSegment(current, await segmentBookings(tx, segmentId));
  if (retimed === current) return;
  const after = { ...before, segments: before.segments.map((s) => (s.id === segmentId ? retimed : s)) };
  if (newSegmentDateConflicts(before, after).length === 0) await writeSegmentClock(tx, retimed);
}

/**
 * #129 · Q10 A (vet HIGH) — Add flight with Round trip on:
 * `POST /api/trips/:id/boundary-flights`. ONE transaction, owner-scoped on the
 * trip:
 *
 *  1. the home → first hop must exist (it does whenever the trip has an
 *     effective home base) — else `NoHomeBase` (the handler's 409);
 *  2. a round trip ensures the last → home hop, CREATING it when the trip has
 *     none (`withReturnHop` — reconcileSegments never invents one);
 *  3. both hops go Fly, each booking is inserted on its hop, and each hop is
 *     re-timed from its bookings;
 *  4. destination dates win (Q3 A): a clash rolls the whole save back as
 *     `SegmentDateMismatch` (409 `segment_date_mismatch`).
 *
 * Returns false when the trip is not the caller's (404).
 */
export class NoHomeBase extends Error {
  constructor() {
    super("no_home_base");
    this.name = "NoHomeBase";
  }
}

export async function createBoundaryFlights(
  owner: string,
  tripId: string,
  input: BoundaryFlightsInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)));
    if (!owned) return false;

    let before = (await loadSegmentTrip(tx, tripId))!;
    if (input.roundTrip) {
      const withHome = withReturnHop(before, randomUUID);
      if (withHome !== before) {
        await writeSegments(tx, before.segments, withHome.segments);
        before = (await loadSegmentTrip(tx, tripId))!;
      }
    }
    const hops = boundarySegments(before);
    if (!hops.outbound) throw new NoHomeBase();
    const chapters: [string, BoundaryBooking][] = [[hops.outbound.id, input.outbound]];
    if (input.roundTrip && input.return && hops.return) chapters.push([hops.return.id, input.return]);

    for (const [segmentId, b] of chapters) {
      await tx.update(travelSegments).set({ mode: "fly" }).where(eq(travelSegments.id, segmentId));
      await tx.insert(reservations).values({
        segmentId,
        type: "transport",
        name: b.name,
        confirmationNumber: b.confirmationNumber,
        cost: b.cost == null ? null : String(b.cost),
        startsAt: new Date(b.startsAt),
        endsAt: new Date(b.endsAt),
        startsTz: b.startsTz,
        endsTz: b.endsTz,
      });
    }

    const after = (await loadSegmentTrip(tx, tripId))!;
    const retimed = await Promise.all(
      after.segments.map(async (s) =>
        chapters.some(([id]) => id === s.id) ? retimedSegment(s, await segmentBookings(tx, s.id)) : s,
      ),
    );
    const next = { ...after, segments: retimed };
    const [conflict] = newSegmentDateConflicts(after, next);
    if (conflict) throw new SegmentDateMismatch(conflict);
    for (const s of retimed) {
      if (chapters.some(([id]) => id === s.id)) await writeSegmentClock(tx, s);
    }
    return true;
  });
}

/**
 * The widened reservation write: the whole editable field set, not just the
 * rating and the note. Every key optional — the edit form sends what changed,
 * and the card's stars and note each send one.
 */
export async function updateReservationFields(
  owner: string,
  resId: string,
  patch: {
    type?: ReservationType;
    name?: string;
    checkIn?: IsoDate | null;
    checkOut?: IsoDate | null;
    confirmationNumber?: string | null;
    cost?: number | null;
    rating?: number | null;
    again?: boolean | null;
    notes?: string | null;
    /** #105 · the stay form's kind switch. */
    lodgingKind?: LodgingKind | null;
    /** #155 · Q4 A — re-kinding a hop booking can change what times its hop,
     * so it rides the clock path below. */
    transportKind?: TransportKind | null;
    /** #124 (vet HIGH) · a hop booking's Edit — the ticket's clock. */
    startsAt?: string | null;
    endsAt?: string | null;
    startsTz?: string | null;
    endsTz?: string | null;
  },
  actor: string,
  deps: Pick<SaveDeps, "resolveArea"> = {},
): Promise<boolean> {
  if (CLOCK_KEYS.some((k) => k in patch)) return writeBookingClock(owner, resId, patch);
  const matched = await writeReservationFields(owner, resId, patch, actor);
  // #113 · "How was it?" on a stay / meal / thing to do writes through.
  if (matched && namesJournalField(patch)) {
    await writeThroughBeen(owner, { kind: "reservation", id: resId }, { ...deps, actor });
  }
  return matched;
}

const CLOCK_KEYS = ["startsAt", "endsAt", "startsTz", "endsTz", "transportKind"] as const;

/**
 * #124 · an edited hop booking, in ONE transaction: write the fields, then —
 * like `createSegmentReservation` — re-time its hop from ALL its bookings and
 * judge the result against the destination dates (Q3 A). A clash rolls the edit back
 * as `SegmentDateMismatch` (409 `segment_date_mismatch`). A parked hop (#129,
 * mode drive) keeps no clock, so it is not re-timed.
 */
async function writeBookingClock(
  owner: string,
  resId: string,
  patch: Parameters<typeof updateReservationFields>[2],
): Promise<boolean> {
  const { cost, startsAt, endsAt, ...rest } = patch;
  const values = {
    ...rest,
    ...(cost !== undefined && { cost: cost === null ? null : String(cost) }),
    ...(startsAt !== undefined && { startsAt: startsAt === null ? null : new Date(startsAt) }),
    ...(endsAt !== undefined && { endsAt: endsAt === null ? null : new Date(endsAt) }),
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reservations)
      .set(values)
      .where(ownedReservation(owner, resId))
      .returning({ segmentId: reservations.segmentId });
    if (!row) return false;
    if (!row.segmentId) return true;
    const [seg] = await tx
      .select({ tripId: travelSegments.tripId, mode: travelSegments.mode })
      .from(travelSegments)
      .where(eq(travelSegments.id, row.segmentId));
    if (!seg || seg.mode === "drive") return true;
    const before = (await loadSegmentTrip(tx, seg.tripId))!;
    const current = before.segments.find((s) => s.id === row.segmentId)!;
    const retimed = retimedSegment(current, await segmentBookings(tx, row.segmentId));
    const after = { ...before, segments: before.segments.map((s) => (s.id === retimed.id ? retimed : s)) };
    const [conflict] = newSegmentDateConflicts(before, after).filter((c) => c.segmentId === retimed.id);
    if (conflict) throw new SegmentDateMismatch(conflict);
    await writeSegmentClock(tx, retimed);
    return true;
  });
}

async function writeReservationFields(
  owner: string,
  resId: string,
  patch: Parameters<typeof updateReservationFields>[2],
  actor: string,
): Promise<boolean> {
  const scope = ownedReservation(owner, resId);
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: reservations.id }).from(reservations).where(scope);
    return rows.length > 0;
  }
  // `cost` is the one column whose wire type is not its stored type. (The
  // clock keys never reach here — `writeBookingClock` owns them.)
  const { cost, startsAt: _startsAt, endsAt: _endsAt, ...rest } = patch;
  const values = cost === undefined ? rest : { ...rest, cost: cost === null ? null : String(cost) };
  if (!logs(patch)) {
    const updated = await db
      .update(reservations)
      .set(values)
      .where(scope)
      .returning({ id: reservations.id });
    return updated.length > 0;
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ rating: reservations.rating, notes: reservations.notes, again: reservations.again })
      .from(reservations)
      .where(scope);
    const updated = await tx
      .update(reservations)
      .set(values)
      .where(scope)
      .returning({ id: reservations.id });
    if (!before || updated.length === 0) return false;
    await logChanges(tx, {
      owner,
      actor,
      entity: "reservation",
      entityId: resId,
      pairs: loggedPairs(patch, before),
    });
    return true;
  });
}

/** A leaf delete — nothing cascades from it, which is why the client offers an
 * undo toast instead of a confirm dialog. */
export async function deleteReservation(owner: string, resId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(reservations)
      .where(ownedReservation(owner, resId))
      .returning({ id: reservations.id, segmentId: reservations.segmentId });
    const [gone] = deleted;
    if (!gone) return false;
    // A flight removed from its hop (#104): the hop re-times from what is
    // left. A hop left with no timed booking keeps its clock, and a re-time
    // that would itself clash with the destination dates is not applied.
    if (gone.segmentId) {
      const [seg] = await tx
        .select({ tripId: travelSegments.tripId })
        .from(travelSegments)
        .where(eq(travelSegments.id, gone.segmentId));
      if (seg) {
        const before = (await loadSegmentTrip(tx, seg.tripId))!;
        const current = before.segments.find((s) => s.id === gone.segmentId)!;
        const retimed = retimedSegment(current, await segmentBookings(tx, gone.segmentId));
        const after = { ...before, segments: before.segments.map((s) => (s.id === retimed.id ? retimed : s)) };
        if (retimed !== current && newSegmentDateConflicts(before, after).length === 0) {
          await writeSegmentClock(tx, retimed);
        }
      }
    }
    return true;
  });
}

/**
 * "Add idea" — the destination sheet's form, the shelf's "+ Add", the Add-from-Places
 * copy, and the undo.
 *
 * The TRIP is proved always: an insert has no WHERE to match zero rows, so a
 * foreign `tripId` has to be refused explicitly and reads as 404. A `destinationId` is
 * proved too when one is sent, AND it must belong to the same trip — that is
 * the one invariant no FK can span the join (schema.ts), and this is the only
 * place the pair is set.
 *
 * The sortOrder is read and written in ONE transaction, appended within the
 * row's own list (its destination's, or the shelf's), so two concurrent adds cannot
 * claim the same position.
 */
export interface CreateIdeaResult {
  idea: Idea;
  /** True when `clientId` matched an idea this trip already has (answer 200). */
  replayed: boolean;
}

/** A trip's idea by its phone client id, or null. Owner-scoped via the trip. */
async function ideaByClientId(owner: string, tripId: string, clientId: string): Promise<Idea | null> {
  const [row] = await db
    .select()
    .from(ideas)
    .where(
      and(
        eq(ideas.tripId, tripId),
        eq(ideas.clientId, clientId),
        inArray(ideas.tripId, ownedTripIds(owner)),
      ),
    );
  return row ? mapIdea(row) : null;
}

export async function createIdea(
  owner: string,
  input: {
    tripId: string;
    destinationId?: string | null;
    title: string;
    category: IdeaCategory;
    status: IdeaStatus;
    place: Place | null;
    rating: number | null;
    notes: string | null;
    /** #113 · "Do it again?". */
    again?: boolean | null;
    /** #113 · "Did it"'s replay key: idempotent on (trip, clientId). */
    clientId?: string;
    /** #113 · the capture's area name — rides to the write-through only. */
    areaLabel?: string | null;
  },
  deps: WriteThroughDeps = {},
): Promise<CreateIdeaResult> {
  if (input.clientId) {
    const existing = await ideaByClientId(owner, input.tripId, input.clientId);
    if (existing) return { idea: existing, replayed: true };
  }
  const created = await insertIdea(owner, input);
  if (!created) {
    // Lost the race to a concurrent replay of the same "Did it".
    return { idea: (await ideaByClientId(owner, input.tripId, input.clientId!))!, replayed: true };
  }
  // #113 · a born-done "Did it" (or an undone delete of a logged idea) writes
  // through to a Been save, the same way a check-off does.
  if (isJournalWorthy(created)) {
    await writeThroughBeen(owner, { kind: "idea", id: created.id, areaLabel: input.areaLabel ?? null }, deps);
  }
  return { idea: created, replayed: false };
}

async function insertIdea(
  owner: string,
  input: Parameters<typeof createIdea>[1],
): Promise<Idea | null> {
  const destinationId = input.destinationId ?? null;
  return db.transaction(async (tx) => {
    await assertOwnedTrip(tx, owner, input.tripId);
    if (destinationId !== null) await assertDestinationInTrip(tx, input.tripId, destinationId);
    const [agg] = await tx
      .select({ highest: max(ideas.sortOrder) })
      .from(ideas)
      .where(
        destinationId === null
          ? and(eq(ideas.tripId, input.tripId), isNull(ideas.destinationId))
          : eq(ideas.destinationId, destinationId),
      );
    const [row] = await tx
      .insert(ideas)
      .values({
        tripId: input.tripId,
        destinationId,
        title: input.title,
        category: input.category,
        status: input.status,
        placeName: input.place?.name ?? null,
        lat: input.place?.lat ?? null,
        lng: input.place?.lng ?? null,
        googlePlaceId: input.place?.googlePlaceId ?? null,
        rating: input.rating,
        again: input.again ?? null,
        notes: input.notes,
        sortOrder: (agg?.highest ?? -1) + 1,
        clientId: input.clientId ?? null,
      })
      .onConflictDoNothing({ target: [ideas.tripId, ideas.clientId] })
      .returning();
    return row ? mapIdea(row) : null;
  });
}

/**
 * The idea PATCH. The patch is spread STRAIGHT into `.set()`, so every key on
 * it must be a real column — the wire's nested `place` is flattened to the four
 * columns below by `ideaPatchColumns` (core's leaf-form.ts) before it gets
 * here, exactly as `destinationPatchColumns` flattens the destination write.
 *
 * A key the caller left out is a column left alone: the status pill, the stars
 * and the note each send one field, and none of them may disturb the place an
 * idea has been given.
 *
 * #80 adds `destinationId` to that list, and with it the ONE thing the WHERE cannot
 * prove. The scope `ideas.tripId in ownedTripIds` proves the row being written
 * is yours; it says nothing about the destination the body points AT. So a bare spread
 * would let a hand-rolled PATCH plant one of your ideas under a destination on someone
 * else's trip — rendered by their `getTripById`, and undeletable by them,
 * because `deleteIdea` is scoped the same way. `createIdea` already proves the
 * pair with `assertDestinationInTrip` (schema.ts:134 states the invariant); an attach
 * is the same write arriving later, so it gets the same proof, inside the same
 * transaction as the update so a refusal moves no column at all.
 */
export async function updateIdeaFields(
  owner: string,
  ideaId: string,
  patch: {
    status?: IdeaStatus;
    rating?: number | null;
    notes?: string | null;
    placeName?: string | null;
    lat?: number | null;
    lng?: number | null;
    googlePlaceId?: string | null;
    destinationId?: string | null;
    category?: IdeaCategory;
    again?: boolean | null;
  },
  actor: string,
  deps: Pick<SaveDeps, "resolveArea"> = {},
): Promise<void> {
  await writeIdeaFields(owner, ideaId, patch, actor);
  // #113 · a check-off (done / ★ / Again) writes through to a Been save. A
  // foreign idea is skipped inside (the owner-scoped read finds nothing).
  if (namesJournalField(patch)) {
    await writeThroughBeen(owner, { kind: "idea", id: ideaId }, { ...deps, actor });
  }
}

async function writeIdeaFields(
  owner: string,
  ideaId: string,
  patch: Parameters<typeof updateIdeaFields>[2],
  actor: string,
): Promise<void> {
  // An empty patch is a legal "nothing changed" on the wire, and drizzle throws
  // on `.set({})` — so the no-op is answered here rather than by a SQL error.
  if (Object.keys(patch).length === 0) return;
  const scope = and(eq(ideas.id, ideaId), inArray(ideas.tripId, ownedTripIds(owner)));
  // A DETACH (`destinationId: null`) names no destination, so there is nothing to prove and
  // — when the patch logs nothing either — it stays the single statement every
  // other field patch is.
  const target = patch.destinationId;
  const attaching = target !== undefined && target !== null;
  if (!attaching && !logs(patch)) {
    await db.update(ideas).set(patch).where(scope);
    return;
  }
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({
        tripId: ideas.tripId,
        rating: ideas.rating,
        notes: ideas.notes,
        status: ideas.status,
        again: ideas.again,
      })
      .from(ideas)
      .where(scope);
    const mine = owned[0];
    // A foreign (or absent) idea stays the shipped silent no-op this handler
    // has always answered 204 to — the guard below is about the TARGET, and
    // there is no owned row to attach in the first place. It is also what keeps
    // a refused patch out of the log.
    if (!mine) return;
    if (attaching) await assertDestinationInTrip(tx, mine.tripId, target);
    await tx.update(ideas).set(patch).where(eq(ideas.id, ideaId));
    await logChanges(tx, {
      owner,
      actor,
      entity: "idea",
      entityId: ideaId,
      pairs: loggedPairs(patch, mine),
    });
  });
}

/** The other leaf delete. Same undo toast, same absence of a cascade. */
export async function deleteIdea(owner: string, ideaId: string): Promise<boolean> {
  const deleted = await db
    .delete(ideas)
    .where(and(eq(ideas.id, ideaId), inArray(ideas.tripId, ownedTripIds(owner))))
    .returning({ id: ideas.id });
  return deleted.length > 0;
}

/**
 * "Book" — the idea becomes a reservation, in one transaction.
 *
 * `type` is the one you chose on the way in. It used to be hardcoded
 * `"activity"`, so every promoted lunch arrived as a blue "Do"; the parameter
 * defaults to that same value so a caller that sends no type is unaffected.
 */
export async function promoteIdeaToReservation(
  owner: string,
  ideaId: string,
  type: ReservationType = "activity",
): Promise<Reservation> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), inArray(ideas.tripId, ownedTripIds(owner))));
    const idea = owned[0];
    if (!idea) throw new Error("idea not found");
    // `reservations.destination_id` is NOT NULL, so an unattached idea cannot become a
    // reservation: it becomes bookable by being dropped onto a destination first. The
    // shelf card renders no Book action at all — this is the server half of the
    // same rule, so a hand-rolled POST is a 404 rather than a constraint error.
    if (idea.destinationId === null) throw new Error("idea not found");
    await tx.delete(ideas).where(eq(ideas.id, ideaId));
    const [res] = await tx
      .insert(reservations)
      .values({
        destinationId: idea.destinationId,
        type,
        name: idea.title,
        notes: "Promoted from idea",
      })
      .returning();
    return mapReservation(res!);
  });
}

export async function reorderChapterDestinations(
  owner: string,
  chapterId: string,
  order: string[],
): Promise<void> {
  const owned = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(trips, eq(chapters.tripId, trips.id))
    .where(and(eq(chapters.id, chapterId), eq(trips.ownerId, owner)));
  if (!owned.length) throw new Error("chapter not found");
  await db.transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(destinations)
        .set({ sortOrder: i })
        .where(and(eq(destinations.id, order[i]!), eq(destinations.chapterId, chapterId)));
    }
    const [chapter] = await tx.select({ tripId: chapters.tripId }).from(chapters).where(eq(chapters.id, chapterId));
    await syncSegments(tx, chapter!.tripId);
  });
}

/**
 * Save the account's one rig — insert on a first save, update thereafter. The
 * unique constraint on rigs.owner_id is what makes this a single statement, so
 * two concurrent saves cannot create two rigs for one account.
 *
 * Dimensions arrive metric at millimetre precision and are written verbatim;
 * rounding UP to whole centimetres happens at the vendor boundary only.
 */
export async function upsertRig(owner: string, input: RigProfileInput): Promise<RigProfile> {
  const values = {
    name: input.name,
    type: input.type,
    heightMeters: String(input.heightMeters),
    widthMeters: String(input.widthMeters),
    lengthMeters: String(input.lengthMeters),
    grossWeightKg: String(input.grossWeightKg),
    propaneOnBoard: input.propaneOnBoard,
  };
  const [row] = await db
    .insert(rigs)
    .values({ ownerId: owner, ...values })
    .onConflictDoUpdate({
      target: rigs.ownerId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return mapRigRow(row!);
}

/**
 * Save the account's preferences — insert on the first choice ever made, update
 * thereafter. Same single-statement upsert as `upsertRig`; here `owner_id` is
 * the primary key, so that is what the conflict targets.
 *
 * The input is a PARTIAL and is treated as one: only the keys actually present
 * are written. That matters because every setter PUTs exactly one field — if
 * the `set` clause listed all four, toggling the theme would write `null` over
 * a units choice made on another device one round-trip earlier.
 */
export async function upsertPrefs(owner: string, patch: UserPrefsPatch): Promise<UserPrefs> {
  const values: Partial<typeof userPrefs.$inferInsert> = {};
  for (const key of ["theme", "units", "mapStyle", "trackCosts"] as const) {
    if (patch[key] !== undefined) Object.assign(values, { [key]: patch[key] });
  }
  // #126 · Q5 A — the household home base: one object on the wire, four
  // columns here (the trip's own `homeBaseColumns` shape, plus the name).
  const home = patch.homeBasePlace;
  if (home !== undefined) {
    Object.assign(values, {
      homeBase: home?.name ?? null,
      homeBaseLat: home?.lat ?? null,
      homeBaseLng: home?.lng ?? null,
      homeBasePlaceId: home?.googlePlaceId ?? null,
    });
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(userPrefs)
      .values({ ownerId: owner, ...values })
      .onConflictDoUpdate({
        target: userPrefs.ownerId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    // Every trip that reads the household default (no override of its own)
    // gains or loses its home → first hop with it — the same reconcile a
    // trip's own home-base write runs (#110 §6).
    if (home !== undefined) {
      const following = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.ownerId, owner), isNull(trips.homeBase)));
      for (const t of following) await syncSegments(tx, t.id);
    }
    return mapPrefsRow(row!);
  });
}

/**
 * ── The Places library (docs/design/41 §3) ───────────────────────────────────
 *
 * `saves` is account-scoped, not trip-scoped, so these three scope on
 * `owner_id` directly rather than through the chapter/destination subqueries above. The
 * update and the delete RETURN the ids they matched: a row belonging to another
 * owner matches nothing, so the caller gets `false` and answers 404 instead of
 * a silent 200 over a write that never happened.
 *
 * ONE row, ONE status field — graduating want → been is a PATCH of the existing
 * row, never a second insert. `tripName` is joined on read (queries.ts's
 * `mapSavedPlaceRow`) and is never written.
 */

/** Guard + join in one: a foreign or unknown `tripId` is refused, an owned one
 * hands back the title the created/patched row displays. */
async function ownedTripTitle(owner: string, tripId: string | null): Promise<string | null> {
  if (tripId == null) return null;
  const [row] = await db
    .select({ title: trips.title })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)));
  if (!row) throw new Error("trip not found");
  return row.title;
}

/**
 * What a new save is anchored to (#110 §5, the W0 rule): a Google place id
 * makes it a `place`; bare coordinates a `pin`; otherwise it is an `area`,
 * labelled by its region. Validation beyond this is W1 capture's (#111).
 */
export function saveAnchorOf(input: {
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
}): { anchor: "place" | "area" | "pin"; areaLabel: string | null } {
  if (input.googlePlaceId) return { anchor: "place", areaLabel: null };
  if (input.lat != null && input.lng != null) return { anchor: "pin", areaLabel: null };
  return { anchor: "area", areaLabel: input.region };
}

/**
 * Reverse-geocodes a point to its locality — `PlacesProvider.resolveArea`
 * handed in by the ROUTE (#111). packages/db holds no provider and no key: the
 * web resolves which provider is live (`apps/web/src/lib/places.ts`) and passes
 * its method here, the same way `api/places/locate` hands `locatePlaces` one.
 */
export type AreaResolver = (lat: number, lng: number) => Promise<ResolvedArea | null>;

/**
 * A Places text search near a point — `PlacesProvider.search` handed in by the
 * ROUTE, like the resolver. Used for exactly one thing: the Q3 A offer on an
 * offline note (#111 i2).
 */
export type PlacesSearcher = (query: string, near: LatLng) => Promise<PlaceSummary[]>;

export interface SaveDeps {
  resolveArea?: AreaResolver;
  searchPlaces?: PlacesSearcher;
  /**
   * #113 · the point the area is resolved AT, when it is not the
   * save's own. A reservation's Been save is name-only (rule 4: its lat/lng
   * stay null) but its DESTINATION's point still tells the resolver which town it is
   * in — the same way an area save borrows a point for distance only.
   */
  resolveAt?: { lat: number | null; lng: number | null } | null;
}

export interface CreateSaveResult {
  saved: SavedPlace;
  /** True when `clientId` matched a row this owner already has (answer 200). */
  replayed: boolean;
}

/** An owner's save by its phone client id, area joined, or null. */
async function saveByClientId(owner: string, clientId: string): Promise<SavedPlace | null> {
  const row = await db.query.saves.findFirst({
    where: and(eq(saves.ownerId, owner), eq(saves.clientId, clientId)),
    with: { trip: { columns: { title: true } }, area: true },
  });
  return row ? mapSavedPlaceRow(row, row.trip?.title ?? null) : null;
}

/**
 * The resolver's answer, or null — never a failed save. No key (the stub), a
 * Google outage, a refused Geocoding API: the save is still written, with a
 * null area (docs/design/111 "One resolver").
 */
async function resolveQuietly(
  resolve: AreaResolver | undefined,
  lat: number | null,
  lng: number | null,
): Promise<ResolvedArea | null> {
  if (!resolve || lat == null || lng == null) return null;
  try {
    return await resolve(lat, lng);
  } catch {
    return null;
  }
}

/**
 * The Q3 A offer (#111 i2): an AREA note typed with no signal is searched for
 * by its words near where it was typed, and the top hit is stored as
 * `suggested_place`. Only then — a note typed online was already offered the
 * Google rows and chose the note on purpose. No point, no searcher, no hit or
 * a failed search: no suggestion, and the save is written all the same.
 */
async function suggestQuietly(
  search: PlacesSearcher | undefined,
  input: Pick<SavedPlaceCreate, "name" | "lat" | "lng" | "capturedOffline">,
  anchor: SavedPlace["anchor"],
) {
  if (!search || !input.capturedOffline || anchor !== "area") return null;
  if (input.lat == null || input.lng == null) return null;
  try {
    return suggestedPlaceFromSearch(await search(input.name, { lat: input.lat, lng: input.lng }));
  } catch {
    return null;
  }
}

/**
 * One areas row per (household, locality place id) — created on first
 * use, REUSED after (the unique is `areas_owner_place_uq`). The name,
 * region and point are refreshed from the resolver on every hit, so a row
 * written before `region` existed picks its header up the next time it is used.
 */
async function upsertArea(owner: string, d: ResolvedArea) {
  const [row] = await db
    .insert(areas)
    .values({
      ownerId: owner,
      googlePlaceId: d.googlePlaceId,
      name: d.name,
      region: d.region,
      lat: d.lat,
      lng: d.lng,
    })
    .onConflictDoUpdate({
      target: [areas.ownerId, areas.googlePlaceId],
      set: { name: d.name, region: d.region, lat: d.lat, lng: d.lng },
    })
    .returning();
  return row!;
}

/**
 * Save a place (docs/design/41 §3), extended for capture (#111):
 *
 * - **Idempotent on `clientId`.** A phone replaying a queued capture whose
 *   first POST landed but whose answer was lost gets the row that exists, with
 *   `replayed: true`, and no second row. Checked first, and again on the
 *   insert's `ON CONFLICT` so two concurrent replays cannot both write.
 * - **An explicit `anchor` wins** over `saveAnchorOf`, which would file an area
 *   note that carries the phone's location as a pin. The derivation stays the
 *   fallback for the web and older callers.
 * - **`capturedAt` is `created_at`** when sent — a queued save flushed hours
 *   later still sorts where it was captured.
 * - **The area is resolved** from the save's point when there is one and
 *   the route handed in a resolver. An area save's `areaLabel` falls back to
 *   the area's name ("Bend, OR"), then to `region` (the W0 rule).
 * - **An offline area note earns a place suggestion** (Q3 A, i2): see
 *   `suggestQuietly`.
 */
export async function createSave(
  owner: string,
  input: SavedPlaceCreate,
  deps: SaveDeps = {},
): Promise<CreateSaveResult> {
  if (input.clientId) {
    const existing = await saveByClientId(owner, input.clientId);
    if (existing) return { saved: existing, replayed: true };
  }
  const tripName = await ownedTripTitle(owner, input.tripId);
  const {
    clientId,
    capturedAt,
    anchor: explicitAnchor,
    areaLabel: explicitLabel,
    // Read by suggestQuietly below; there is no column for it.
    capturedOffline,
    ...fields
  } = input;
  void capturedOffline;
  const anchor = explicitAnchor ?? saveAnchorOf(input).anchor;

  const [resolved, suggestedPlace] = await Promise.all([
    resolveQuietly(
      deps.resolveArea,
      deps.resolveAt?.lat ?? input.lat,
      deps.resolveAt?.lng ?? input.lng,
    ),
    suggestQuietly(deps.searchPlaces, input, anchor),
  ]);
  const area = resolved ? await upsertArea(owner, resolved) : null;
  const areaLabel =
    anchor === "area" ? (explicitLabel ?? area?.name ?? input.region ?? null) : null;

  const [row] = await db
    .insert(saves)
    .values({
      ownerId: owner,
      ...fields,
      anchor,
      areaLabel,
      clientId: clientId ?? null,
      areaId: area?.id ?? null,
      suggestedPlace,
      ...(capturedAt ? { createdAt: new Date(capturedAt) } : {}),
    })
    .onConflictDoNothing({ target: [saves.ownerId, saves.clientId] })
    .returning();
  if (!row) {
    // Lost the race to a concurrent replay of the same capture.
    const existing = await saveByClientId(owner, clientId!);
    return { saved: existing!, replayed: true };
  }
  return {
    saved: {
      ...mapSavedPlaceRow(row, tripName),
      area: area ? mapSaveArea(area) : null,
    },
    replayed: false,
  };
}

/**
 * The ONE place the log's vocabulary and a column name differ: this table
 * spells its note `note`, SINGULAR (schema.ts:204), while the log — and the
 * byline that reads it — says `notes`.
 */
const SAVED_PLACE_COLUMNS = { notes: "note" } as const;

/**
 * Patch a library row in place — the edit sheet, the graduation ("been" +
 * rating + tripId, source cleared) and the Locate coordinate backfill all land
 * here. Returns false when the id is not this owner's.
 *
 * Unlike destinations and reservations this table DOES carry `status` (schema.ts:203),
 * so the want → been graduation is a shared-voice change like any other and is
 * logged as one.
 */
/** Thrown by an upgrade on a save that has no suggestion to take (→ 409). */
export const NO_SUGGESTION = "no suggestion";

/**
 * The columns `upgradeToSuggested` writes (#111 i2 · Q3 A): the suggestion's
 * name, Place ID and point, the anchor area → place, and the area
 * RE-RESOLVED from the new point. When the resolver answers nothing (no key,
 * a Google failure, nothing within 25 mi) the save keeps the area it
 * had — the suggestion was searched for near that very point, so the town it
 * was typed in is still the honest answer. Null when the row is not this
 * owner's; throws NO_SUGGESTION when there is nothing to take.
 */
async function upgradeColumns(
  owner: string,
  scope: ReturnType<typeof and>,
  resolve: AreaResolver | undefined,
) {
  const [row] = await db
    .select({ suggestedPlace: saves.suggestedPlace, areaId: saves.areaId })
    .from(saves)
    .where(scope);
  if (!row) return null;
  const sp = row.suggestedPlace;
  if (!sp) throw new Error(NO_SUGGESTION);
  const resolved = await resolveQuietly(resolve, sp.lat, sp.lng);
  const area = resolved ? await upsertArea(owner, resolved) : null;
  return {
    name: sp.name,
    googlePlaceId: sp.googlePlaceId,
    lat: sp.lat,
    lng: sp.lng,
    anchor: "place" as const,
    areaLabel: null,
    areaId: area?.id ?? row.areaId,
    suggestedPlace: null,
  };
}

export async function updateSavedPlaceFields(
  owner: string,
  placeId: string,
  input: SavedPlacePatch,
  actor: string,
  deps: Pick<SaveDeps, "resolveArea"> = {},
): Promise<boolean> {
  const { upgradeToSuggested, suggestedPlace, ...fields } = input;
  if (fields.tripId !== undefined) await ownedTripTitle(owner, fields.tripId);
  const scope = and(eq(saves.id, placeId), eq(saves.ownerId, owner));
  // The two suggestion actions are not columns: they become the columns they
  // write, applied over whatever else the body named.
  let patch: Partial<typeof saves.$inferInsert> = { ...fields };
  if (suggestedPlace === null) patch.suggestedPlace = null;
  if (upgradeToSuggested) {
    const up = await upgradeColumns(owner, scope, deps.resolveArea);
    if (!up) return false;
    patch = { ...patch, ...up };
  }
  if (!logs(patch, SAVED_PLACE_COLUMNS)) {
    const rows = await db
      .update(saves)
      .set(patch)
      .where(scope)
      .returning({ id: saves.id });
    return rows.length > 0;
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        rating: saves.rating,
        note: saves.note,
        status: saves.status,
        again: saves.again,
      })
      .from(saves)
      .where(scope);
    const rows = await tx
      .update(saves)
      .set(patch)
      .where(scope)
      .returning({ id: saves.id });
    if (!before || rows.length === 0) return false;
    await logChanges(tx, {
      owner,
      actor,
      entity: "save",
      entityId: placeId,
      pairs: loggedPairs(patch, before, SAVED_PLACE_COLUMNS),
    });
    return true;
  });
}

/** Hard delete, owner-scoped. Returns false when the id is not this owner's. */
export async function deleteSavedPlace(owner: string, placeId: string): Promise<boolean> {
  const rows = await db
    .delete(saves)
    .where(and(eq(saves.id, placeId), eq(saves.ownerId, owner)))
    .returning({ id: saves.id });
  return rows.length > 0;
}

// ── #113 · the Been write-through ─────────────────────────────────────────
//
// W3 Journal, Q7 B (docs/design/113 "The data contract"): a thing checked off,
// rated or marked Again on a trip becomes — or updates — a "been" save, so
// #107's "Last time here" card finds it on the next trip that goes back near
// it. Core's `beenWriteThrough` DECIDES (skip · update · create, unit-tested);
// this writes what it decided. It runs after every idea / destination / reservation
// write that names a journal field, and after a "Did it" create.
//
// - Match-or-create by the shipped `isAlreadySaved` rule (never a new unique).
// - A reservation's save is NAME-ONLY (rule 4); its destination's point feeds the
//   area resolver only (`SaveDeps.resolveAt`).
// - The area is resolved on create AND on an update of a matched save
//   that has none (vet HIGH) — with the resolver the ROUTE hands in; packages/db
//   holds no provider.
// - Never deletes: an un-check leaves the Been save in place.
// - Never fails the write it follows: the check-off already committed, so a
//   write-through fault is logged and swallowed (the phone's queue would
//   otherwise retry a PATCH that has landed).

/** What the write-through needs from the ROUTE: the live resolver, and the
 * person (`getActor()`) the save's byline names when a match graduates. */
export interface WriteThroughDeps {
  resolveArea?: AreaResolver;
  actor?: string;
}

/** The fields whose write can make a thing journal-worthy. */
const JOURNAL_KEYS = ["status", "rating", "again", "notes"] as const;

function namesJournalField(patch: object): boolean {
  return JOURNAL_KEYS.some((k) => k in patch);
}

type WriteThroughTarget =
  | { kind: "idea"; id: string; areaLabel?: string | null }
  | { kind: "destination"; id: string }
  | { kind: "reservation"; id: string };

interface LoadedThing {
  thing: BeenThing;
  tripId: string;
  notes: string | null;
  /** The point the area is resolved at: the thing's own, or — for a
   * reservation — its destination's. */
  point: { lat: number | null; lng: number | null };
  /** A reservation's destination name — the save's display region (places.ts). */
  region: string | null;
}

async function loadThing(owner: string, target: WriteThroughTarget): Promise<LoadedThing | null> {
  if (target.kind === "idea") {
    const [row] = await db
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, target.id), inArray(ideas.tripId, ownedTripIds(owner))));
    if (!row) return null;
    const idea = mapIdea(row);
    return {
      thing: {
        kind: "idea",
        title: idea.title,
        category: idea.category,
        status: idea.status,
        place: idea.place,
        rating: idea.rating,
        again: idea.again,
      },
      tripId: idea.tripId,
      notes: idea.notes,
      point: { lat: row.lat, lng: row.lng },
      region: null,
    };
  }
  if (target.kind === "destination") {
    const [row] = await db
      .select({
        placeName: destinations.placeName,
        lat: destinations.lat,
        lng: destinations.lng,
        googlePlaceId: destinations.googlePlaceId,
        rating: destinations.rating,
        again: destinations.again,
        notes: destinations.notes,
        tripId: chapters.tripId,
      })
      .from(destinations)
      .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
      .where(and(eq(destinations.id, target.id), inArray(destinations.chapterId, ownedChapterIds(owner))));
    if (!row) return null;
    return {
      thing: {
        kind: "destination",
        place: { name: row.placeName, lat: row.lat, lng: row.lng, googlePlaceId: row.googlePlaceId },
        rating: row.rating,
        again: row.again,
      },
      tripId: row.tripId,
      notes: row.notes,
      point: { lat: row.lat, lng: row.lng },
      region: null,
    };
  }
  // A reservation: only a DESTINATION-attached one — a segment booking is travel.
  const [row] = await db
    .select({
      name: reservations.name,
      type: reservations.type,
      rating: reservations.rating,
      again: reservations.again,
      notes: reservations.notes,
      destinationName: destinations.placeName,
      lat: destinations.lat,
      lng: destinations.lng,
      tripId: chapters.tripId,
    })
    .from(reservations)
    .innerJoin(destinations, eq(reservations.destinationId, destinations.id))
    .innerJoin(chapters, eq(destinations.chapterId, chapters.id))
    .where(and(eq(reservations.id, target.id), inArray(destinations.chapterId, ownedChapterIds(owner))));
  if (!row) return null;
  return {
    thing: { kind: "reservation", name: row.name, type: row.type, rating: row.rating, again: row.again },
    tripId: row.tripId,
    notes: row.notes,
    point: { lat: row.lat, lng: row.lng },
    region: row.destinationName,
  };
}

/**
 * Run the write-through for one thing. Returns what was decided (tests read
 * it), or null when the thing is not the owner's or the write-through failed.
 */
export async function writeThroughBeen(
  owner: string,
  target: WriteThroughTarget,
  deps: WriteThroughDeps = {},
): Promise<BeenDecision | null> {
  try {
    const loaded = await loadThing(owner, target);
    if (!loaded) return null;
    const library = await db
      .select({
        id: saves.id,
        name: saves.name,
        lat: saves.lat,
        lng: saves.lng,
        googlePlaceId: saves.googlePlaceId,
        areaId: saves.areaId,
        rating: saves.rating,
        again: saves.again,
        note: saves.note,
      })
      .from(saves)
      .where(eq(saves.ownerId, owner));
    const decision = beenWriteThrough(loaded.thing, library);
    const { thing, notes, tripId, point } = loaded;

    if (decision.action === "update") {
      const hit = library.find((r) => r.id === decision.saveId)!;
      const patch: Partial<typeof saves.$inferInsert> = {
        status: "been",
        // A thing with no ★ / answer of its own never blanks the save's.
        rating: thing.rating ?? hit.rating,
        again: thing.again ?? hit.again,
        note: notes ?? hit.note,
        tripId,
        // The graduation invariant (`normalizeSavedPlacePatch`): who told you
        // about it is queue metadata, not archive metadata.
        source: null,
      };
      if (hit.areaId === null) {
        const resolved = await resolveQuietly(deps.resolveArea, point.lat, point.lng);
        if (resolved) patch.areaId = (await upsertArea(owner, resolved)).id;
      }
      await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ rating: saves.rating, note: saves.note, status: saves.status, again: saves.again })
          .from(saves)
          .where(eq(saves.id, hit.id));
        await tx.update(saves).set(patch).where(and(eq(saves.id, hit.id), eq(saves.ownerId, owner)));
        if (before && deps.actor) {
          await logChanges(tx, {
            owner,
            actor: deps.actor,
            entity: "save",
            entityId: hit.id,
            pairs: loggedPairs(patch, before, SAVED_PLACE_COLUMNS),
          });
        }
      });
    } else if (decision.action === "create") {
      const { candidate } = decision;
      // "Did it" from a note with a fix: the save is anchored to the AREA the
      // capture resolved ("Playa Flamingo"), not a bare pin (vet HIGH).
      const area =
        target.kind === "idea" && target.areaLabel && !candidate.googlePlaceId
          ? { anchor: "area" as const, areaLabel: target.areaLabel }
          : {};
      await createSave(
        owner,
        {
          ...area,
          name: candidate.name,
          region: loaded.region,
          lat: candidate.lat,
          lng: candidate.lng,
          googlePlaceId: candidate.googlePlaceId,
          type: decision.type,
          status: "been",
          note: notes,
          source: null,
          rating: thing.rating,
          again: thing.again,
          tripId,
        },
        { resolveArea: deps.resolveArea, resolveAt: point },
      );
    }
    return decision;
  } catch (e) {
    console.error("writeThroughBeen failed", e);
    return null;
  }
}

// ── the route cache ────────────────────────────────────────────────────────
/** One cacheable drive: the key core built, and the vendor's answer verbatim. */
export interface CachedRoute {
  /** `routeCacheKey(from, to, routingHash)`. */
  key: string;
  result: RouteResult;
}

/**
 * Write through, upserting on the key so a stale row is refreshed in place
 * (docs/design/43 §1 — the TTL is a read filter, there is no sweeper).
 *
 * ONLY `here` results are stored, and the filter is here as well as at the
 * caller: `routes.source` is a one-value enum, so writing an "estimate" would
 * both lie about the row and poison the key for the whole TTL. A failed vendor
 * call must cost the next open nothing more than another attempt.
 *
 * Not owner-scoped — the row has no owner; see getCachedRoutes.
 */
export async function putCachedRoutes(rows: CachedRoute[]): Promise<void> {
  const cacheable = rows.filter((r) => r.result.source === "here");
  if (cacheable.length === 0) return;
  await db
    .insert(routes)
    .values(
      cacheable.map((r) => ({ key: r.key, result: r.result, source: "here" as const })),
    )
    // fetched_at comes from the DATABASE clock on both paths (the column
    // default on insert, `now()` here), because the TTL is read back as
    // `fetched_at > now() - interval`. A JS timestamp on one side of that
    // comparison and a SQL one on the other is a skew waiting to happen.
    .onConflictDoUpdate({
      target: routes.key,
      set: { result: sql`excluded.result`, fetchedAt: sql`now()` },
    });
}

/** One cached corridor check: the key it shares with the route it validates. */
export interface CachedNavCheck {
  key: string;
  nav: NavCheck;
}

/**
 * Store the verdicts, as an UPDATE on rows that already exist — never an
 * insert.
 *
 * `nav` is meaningful only beside the HERE polyline it was measured against, so
 * a check without a cached route is not a row we can write: `result` is NOT
 * NULL and there is nothing honest to put in it. In practice the route is
 * always written first (the check is a function of its polyline), so a key that
 * is missing here means the route write failed or its TTL just lapsed — and
 * dropping the verdict is exactly right in both cases.
 *
 * `fetched_at` is deliberately NOT touched: the verdict ages with the route it
 * describes, which is what makes "same key, same TTL" true.
 */
export async function putCachedNav(rows: CachedNavCheck[]): Promise<void> {
  if (rows.length === 0) return;
  await Promise.all(
    rows.map((row) => db.update(routes).set({ nav: row.nav }).where(eq(routes.key, row.key))),
  );
}

/* ── tenancy (#77) ──────────────────────────────────────────────────────── */

/** The one lookup that matters: a person → the household that owns their rows.
 * Rides `household_members_user_idx`, the unique index on `user_id`
 * (schema.ts), so it is a single-row index scan however many households exist. */
async function householdIdFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return row?.householdId ?? null;
}

/**
 * Resolve a Clerk user id to the HOUSEHOLD id every `owner_id` column carries
 * from #77 on, minting a 1-member household the first time this person is seen
 * (docs/design/81 §2, plan item i2). This is what `getOwner()` returns, so it
 * sits on the hot path of every read and every write — hence one indexed
 * SELECT on the common path, and a write only on a user's very first request.
 *
 * Lazy-create rather than a Clerk webhook: a webhook is a second deployment
 * surface and a race of its own (the first request can beat it), and there is
 * nothing to create a household FROM until someone actually shows up.
 *
 * The race, spelled out, because the seam has no transaction around it and two
 * of a new user's first requests really can arrive together: both miss the
 * SELECT, both insert a household, and the member insert then decides — the
 * `user_id` unique index lets exactly one through. The loser deletes the
 * household it just minted (nothing references it: the member row it would
 * have hung off was never written) and re-reads the winner's. So the outcome
 * is the same row either way and no orphan household is left behind.
 */
export async function ensureHouseholdForUser(userId: string): Promise<string> {
  const existing = await householdIdFor(userId);
  if (existing) return existing;

  // Bare uuid, the shape migration 0007's backfill mints with
  // `gen_random_uuid()` — the `hh_…` in the wireframe is sample data, not a
  // prefix to ship (docs/design/81 dev note 8).
  const id = randomUUID();
  await db.insert(households).values({ id });
  const claimed = await db
    .insert(householdMembers)
    .values({ householdId: id, userId, role: "owner" })
    .onConflictDoNothing()
    .returning({ householdId: householdMembers.householdId });
  if (claimed.length > 0) return id;

  await db.delete(households).where(eq(households.id, id));
  const settled = await householdIdFor(userId);
  if (!settled) {
    // The member insert was refused and yet no row exists: not a race, so
    // something else is wrong (a partially applied 0007, a dropped index).
    // Loud beats serving the wrong tenant's data.
    throw new Error(`ensureHouseholdForUser: no household for ${userId} after a lost create`);
  }
  return settled;
}

/** How long a join link lives. Stated here rather than defaulted in DDL so the
 * window is the app's to say — and so the card's "One use, expires in 14 days"
 * and the row agree by construction (docs/design/81 §3). */
export const INVITE_TTL_DAYS = 14;

/** The token is the path segment of `/join/<token>` (schema.ts) — 8 random
 * bytes, base64url, so it is 11 URL-safe characters with 64 bits behind them.
 * Short enough to read out over the phone, long enough that a one-use link
 * living 14 days cannot be found by guessing. */
function inviteToken(): string {
  return randomBytes(8).toString("base64url");
}

export interface CreatedInvite {
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Mint the household's join link (Q3 = B: a link you send her yourself, no
 * mailer and no webhook).
 *
 * `created_at` is written EXPLICITLY rather than left to `defaultNow()`, and
 * `expires_at` is derived from that same instant, so "expires 14 days after it
 * was created" is a property of the row rather than of how long the insert
 * took. One clock, one subtraction, and the card's copy is provable.
 *
 * Exactly ONE live invite per household: a second press supersedes the first
 * rather than leaving two links that both work, because the card draws "the"
 * invite and a revoked-looking link that still redeems is the worse surprise.
 * REDEEMED rows are left alone — that timestamp is how the household knows the
 * seat was taken and is what /join's one-use check reads (i4).
 *
 * The household row is created if it is missing, for the same reason
 * `ensureHouseholdForUser` creates one: keyless, `getOwner()` answers the
 * literal `dev-household` without a lookup, so on a migrated-but-unseeded
 * database the invite's foreign key would have nothing to point at.
 */
export async function createHouseholdInvite(householdId: string): Promise<CreatedInvite> {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + INVITE_TTL_DAYS * 86_400_000);
  const token = inviteToken();

  await db.transaction(async (tx) => {
    await tx.insert(households).values({ id: householdId }).onConflictDoNothing();
    await tx
      .delete(householdInvites)
      .where(
        and(eq(householdInvites.householdId, householdId), isNull(householdInvites.redeemedAt)),
      );
    await tx.insert(householdInvites).values({ token, householdId, createdAt, expiresAt });
  });

  return { token, createdAt, expiresAt };
}

/**
 * "Cancel invite" — revoke a link still in flight. Returns false when the token
 * is not this household's live invite, which covers three cases the caller
 * answers identically (404): no such token, someone else's token, and a token
 * already redeemed. The household is in the WHERE, so holding the URL is not
 * enough to revoke it.
 */
export async function cancelHouseholdInvite(
  householdId: string,
  token: string,
): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .delete(householdInvites)
    .where(
      and(
        eq(householdInvites.token, token),
        eq(householdInvites.householdId, householdId),
        isNull(householdInvites.redeemedAt),
      ),
    )
    .returning({ token: householdInvites.token });
  return rows.length > 0;
}

/** Why `removeHouseholdMember` refused, so the route can answer 409 rather than
 * 404 for the one refusal that is a conflict and not a miss. */
export type RemoveMemberResult = "removed" | "not_a_member" | "is_owner";

/**
 * Remove a co-pilot from the household.
 *
 * This moves NO rows. Trips, the library and the rig belong to the household
 * (Q2 = A), so removing someone takes away their way in and nothing else —
 * which is precisely why the OWNER row must not be removable: a household with
 * no members would still own every row and nobody could reach them. The role is
 * read in the same statement rather than checked first, so the refusal cannot
 * race a concurrent delete.
 */
export async function removeHouseholdMember(
  householdId: string,
  userId: string,
): Promise<RemoveMemberResult> {
  if (!userId) return "not_a_member";
  const rows = await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, userId),
        ne(householdMembers.role, "owner"),
      ),
    )
    .returning({ userId: householdMembers.userId });
  if (rows.length > 0) return "removed";

  // Nothing deleted: either they are not here, or they are and they own it.
  const [row] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(
      and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
    );
  return row ? "is_owner" : "not_a_member";
}

/* ── joining a household (#77 · docs/design/81 §4) ──────────────────────── */

/**
 * What `/join/<token>` and `POST /api/household/join` both answer.
 *
 * `ok` means the join is on: the accept card on the page, a 204 from the route.
 * The three refusals are §4's 409 codes, verbatim, and the page renders one
 * card per code. `already_here` is not a refusal and not a code the design
 * names — it is the household's own member opening their own link, where there
 * is simply nothing to do.
 */
export type JoinVerdict =
  | "ok"
  | "already_here"
  | "invite_not_found"
  | "invite_expired"
  | "invite_used"
  | "account_not_empty";

/** §4's three refusals, in the order they are checked. */
export type JoinRefusal = "invite_expired" | "invite_used" | "account_not_empty";

/**
 * THE order, in one pure function — §4 states the codes "in the order they are
 * checked", and the page (which renders the refusal) and the route (which
 * performs the join) have to reach the same conclusion about the same row.
 * Neither owns it; this does.
 *
 * `already_here` sits between the invite's own two checks and the visitor's,
 * where it cannot disturb either: an expired or spent link still reads as
 * expired or spent even to the person who minted it, and the emptiness check
 * never runs against a household the visitor is already in — which matters,
 * because that path would otherwise delete the household the invite belongs to.
 */
export function joinVerdict(input: {
  invite: { householdId: string; expiresAt: Date; redeemedAt: Date | null } | null;
  now: Date;
  visitorHousehold: string;
  visitorHouseholdIsEmpty: boolean;
}): JoinVerdict {
  const { invite, now, visitorHousehold, visitorHouseholdIsEmpty } = input;
  if (!invite) return "invite_not_found";
  // `<=`, matching `getHouseholdOverview`'s `expires_at > now` for "live": an
  // invite is expired the instant it stops being live, never both.
  if (invite.expiresAt.getTime() <= now.getTime()) return "invite_expired";
  if (invite.redeemedAt !== null) return "invite_used";
  if (invite.householdId === visitorHousehold) return "already_here";
  if (!visitorHouseholdIsEmpty) return "account_not_empty";
  return "ok";
}

/**
 * What makes a household NOT empty — the three tables that hold what a person
 * planned. Written once and used twice: once as a read (`householdIsEmpty`) and
 * once as the WHERE of the delete that acts on it, so the question and the
 * guard cannot drift.
 *
 * `user_prefs` is deliberately absent. §4's prose says "any trip, saved place,
 * rig or prefs row", but the card it maps to says "This account already has
 * trips" and offers "an account that hasn't planned anything" — and a prefs row
 * is written by any theme, units or map-style save (`upsertPrefs`), so counting
 * it would refuse a visitor who had done nothing but flip dark mode, with copy
 * that is false about her. The copy is the signed pixel target, so the
 * CONDITION gives way: preferences are a display choice, not a plan. The
 * visitor's prefs row is dropped with her household when she joins
 * (`redeemHouseholdInvite`), because it is keyed by the household id that is
 * about to destination existing.
 *
 * Nothing else needs listing: ideas and reservations hang off a trip, and
 * `places` is a shared geocode cache that no household owns.
 */
const ownedContent = (householdId: string) => [
  db.select({ one: sql<number>`1` }).from(trips).where(eq(trips.ownerId, householdId)),
  db.select({ one: sql<number>`1` }).from(saves).where(eq(saves.ownerId, householdId)),
  db.select({ one: sql<number>`1` }).from(rigs).where(eq(rigs.ownerId, householdId)),
];

/** Has this household planned anything at all? The question Q4 = A turns on:
 * only an empty account may join, because a merge would have to destroy one of
 * two rigs and one of two prefs rows (schema.ts). */
export async function householdIsEmpty(householdId: string): Promise<boolean> {
  for (const query of ownedContent(householdId)) {
    if ((await query.limit(1)).length > 0) return false;
  }
  return true;
}

/** A second redeemer got there between our lock and our stamp. Thrown so the
 * transaction rolls back rather than returning a value (which would commit the
 * household we had already deleted); caught below and answered `invite_used`. */
class InviteAlreadySpent extends Error {}

/**
 * Redeem a join link: the whole of §4's "On success, in ONE transaction".
 *
 * The three writes have to be all-or-nothing, and their ORDER is what makes
 * each refusal safe to return:
 *
 *   1. the visitor's own household is deleted — CONDITIONALLY, re-stating
 *      `ownedContent` in SQL. Nothing else has been written yet, so a household
 *      that picked up a trip since the verdict simply returns
 *      `account_not_empty` with `redeemed_at` still null, which is exactly the
 *      promise the refusal card makes ("the link still works for the right
 *      account"). The cascade takes her old membership row with it, which is
 *      what lets the insert below satisfy `user_id`'s unique index.
 *   2. her prefs row goes with it (no FK, so no cascade does this for us) — it
 *      is keyed by a household id that no longer exists, and she reads the
 *      household's row from here on.
 *   3. the member row, then the stamp. `expires_at`/`redeemed_at` are re-read
 *      under `FOR UPDATE`, so a second redeemer blocks here and then sees the
 *      stamp rather than a second seat.
 */
export async function redeemHouseholdInvite(
  token: string,
  visitor: { userId: string; householdId: string },
): Promise<JoinVerdict> {
  const invite = await getHouseholdInvite(token);
  const empty = await householdIsEmpty(visitor.householdId);
  const verdict = joinVerdict({
    invite,
    now: new Date(),
    visitorHousehold: visitor.householdId,
    visitorHouseholdIsEmpty: empty,
  });
  if (verdict !== "ok") return verdict;

  try {
    return await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(householdInvites)
        .where(eq(householdInvites.token, token))
        .limit(1)
        .for("update");

      const settled = joinVerdict({
        invite: locked ?? null,
        now: new Date(),
        visitorHousehold: visitor.householdId,
        visitorHouseholdIsEmpty: empty,
      });
      if (settled !== "ok") return settled;

      const dropped = await tx
        .delete(households)
        .where(
          and(
            eq(households.id, visitor.householdId),
            ...ownedContent(visitor.householdId).map((query) => notExists(query)),
          ),
        )
        .returning({ id: households.id });

      if (dropped.length === 0) {
        // Either the guard refused (she planned something between the verdict
        // and here) or there was no household ROW to delete at all — which is
        // legitimate: keyless, `getOwner()` answers the `dev-household` literal
        // without ever looking it up. The row's continued existence is what
        // tells the two apart.
        const [survivor] = await tx
          .select({ id: households.id })
          .from(households)
          .where(eq(households.id, visitor.householdId))
          .limit(1);
        if (survivor) return "account_not_empty";
      }

      await tx.delete(userPrefs).where(eq(userPrefs.ownerId, visitor.householdId));
      await tx
        .insert(householdMembers)
        .values({ householdId: locked!.householdId, userId: visitor.userId, role: "member" });

      const stamped = await tx
        .update(householdInvites)
        .set({ redeemedAt: new Date() })
        .where(and(eq(householdInvites.token, token), isNull(householdInvites.redeemedAt)))
        .returning({ token: householdInvites.token });
      if (stamped.length === 0) throw new InviteAlreadySpent();

      return "ok";
    });
  } catch (err) {
    if (err instanceof InviteAlreadySpent) return "invite_used";
    throw err;
  }
}
