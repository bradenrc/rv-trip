import { eq, and, inArray, max } from "drizzle-orm";
import { db } from "./index";
import { legs, stops, ideas, reservations, trips, rigs, savedPlaces } from "./schema";
import type {
  Idea,
  Leg,
  Stop,
  Place,
  Reservation,
  ReservationType,
  IdeaStatus,
  IsoDate,
  RigProfile,
  RigProfileInput,
  SavedPlace,
  SavedPlaceCreate,
  SavedPlacePatch,
  TripStatus,
} from "@rv-trip/core";
import {
  mapIdea,
  mapLeg,
  mapReservation,
  mapStop,
  mapRigRow,
  mapSavedPlaceRow,
} from "./queries";

/**
 * Owner-scoped writes. Every mutation is constrained to resources belonging to
 * a trip the owner owns (via subquery), so a caller can never touch another
 * tenant's data even if they pass a foreign id. `owner` is the Clerk userId;
 * local dev passes the dev stub.
 */

const ownedLegIds = (owner: string) =>
  db
    .select({ id: legs.id })
    .from(legs)
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(eq(trips.ownerId, owner));

const ownedStopIds = (owner: string) =>
  db.select({ id: stops.id }).from(stops).where(inArray(stops.legId, ownedLegIds(owner)));

// ── trips ─────────────────────────────────────────────────────────────────
//
// A trip is the ownership root: it carries `ownerId` itself, so its writes scope
// on that column directly rather than through the leg/stop subqueries below.
// Update and delete report whether the owner-scoped statement matched a row, so
// the handler can answer 404 instead of pretending a foreign id succeeded.

export async function createTrip(
  owner: string,
  input: {
    title: string;
    startDate: IsoDate;
    endDate: IsoDate;
    homeBase: string | null;
  },
) {
  // One empty leg in the SAME transaction: RouteView renders per leg, so a trip
  // with none opens with nothing to hang "Add stop" on.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trips)
      .values({
        ownerId: owner,
        title: input.title,
        startDate: input.startDate,
        endDate: input.endDate,
        homeBase: input.homeBase,
      })
      .returning();
    await tx.insert(legs).values({ tripId: row!.id, title: "Leg 1", sortOrder: 0 });
    return row!;
  });
}

export async function updateTripFields(
  owner: string,
  tripId: string,
  patch: {
    title?: string;
    homeBase?: string | null;
    startDate?: IsoDate;
    endDate?: IsoDate;
    status?: TripStatus;
    statusAuto?: boolean;
    rating?: number | null;
    note?: string | null;
  },
): Promise<boolean> {
  const scope = and(eq(trips.id, tripId), eq(trips.ownerId, owner));
  // An empty patch is a legal no-op, but `.set({})` is not a legal statement —
  // fall back to the existence check so the answer is still 204 vs 404.
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: trips.id }).from(trips).where(scope);
    return rows.length > 0;
  }
  const updated = await db
    .update(trips)
    .set({ ...patch, updatedAt: new Date() })
    .where(scope)
    .returning({ id: trips.id });
  return updated.length > 0;
}

export async function deleteTrip(owner: string, tripId: string): Promise<boolean> {
  // Legs -> stops -> reservations/ideas all cascade from the FK (schema.ts).
  const deleted = await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), eq(trips.ownerId, owner)))
    .returning({ id: trips.id });
  return deleted.length > 0;
}

// ── legs ──────────────────────────────────────────────────────────────────
//
// A leg has no owner column of its own, so every leg write scopes through
// `ownedLegIds` — except the two that address a leg that does not exist yet or
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

/** A leg the caller owns, proved through the shared subquery. */
async function assertOwnedLeg(
  tx: { select: typeof db.select },
  owner: string,
  legId: string,
): Promise<void> {
  const owned = await tx
    .select({ id: legs.id })
    .from(legs)
    .where(and(eq(legs.id, legId), inArray(legs.id, ownedLegIds(owner))));
  if (!owned.length) throw new Error("leg not found");
}

/**
 * "Add leg" — appended to the end of the trip. The sortOrder is read and
 * written in ONE transaction so two concurrent adds cannot claim the same
 * position. Returns the core `Leg` shape (with an empty `stops`) so the planner
 * can splice it straight into the tree it is holding.
 */
export async function createLeg(
  owner: string,
  input: { tripId: string; title: string },
): Promise<Leg> {
  return db.transaction(async (tx) => {
    await assertOwnedTrip(tx, owner, input.tripId);
    const [agg] = await tx
      .select({ highest: max(legs.sortOrder) })
      .from(legs)
      .where(eq(legs.tripId, input.tripId));
    const [row] = await tx
      .insert(legs)
      .values({
        tripId: input.tripId,
        title: input.title,
        sortOrder: (agg?.highest ?? -1) + 1,
      })
      .returning();
    return mapLeg({ ...row!, stops: [] });
  });
}

/** The inline rename. Reports whether the owner-scoped statement matched. */
export async function updateLegFields(
  owner: string,
  legId: string,
  patch: { title?: string },
): Promise<boolean> {
  const scope = and(eq(legs.id, legId), inArray(legs.id, ownedLegIds(owner)));
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: legs.id }).from(legs).where(scope);
    return rows.length > 0;
  }
  const updated = await db.update(legs).set(patch).where(scope).returning({ id: legs.id });
  return updated.length > 0;
}

/** Stops (and their reservations and ideas) cascade with the leg. */
export async function deleteLeg(owner: string, legId: string): Promise<boolean> {
  const deleted = await db
    .delete(legs)
    .where(and(eq(legs.id, legId), inArray(legs.id, ownedLegIds(owner))))
    .returning({ id: legs.id });
  return deleted.length > 0;
}

/**
 * "Move leg up/down" sends the whole new order and the rows are renumbered in
 * one transaction — the same pattern as `reorderLegStops` below, so a partial
 * write can never leave two legs sharing a sortOrder. Each statement also
 * carries `legs.tripId`, so an id from another trip renumbers nothing.
 */
export async function reorderTripLegs(
  owner: string,
  tripId: string,
  order: string[],
): Promise<void> {
  await assertOwnedTrip(db, owner, tripId);
  await db.transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(legs)
        .set({ sortOrder: i })
        .where(and(eq(legs.id, order[i]!), eq(legs.tripId, tripId)));
    }
  });
}

// ── stops ─────────────────────────────────────────────────────────────────

/**
 * "Add stop" — appended to the end of its leg, floating unless the caller
 * already has dates. The DESTINATION leg is checked explicitly (an insert has
 * no WHERE to match zero rows), and the append reads and writes the sortOrder
 * inside one transaction.
 */
export async function createStop(
  owner: string,
  input: {
    legId: string;
    place: Place;
    arriveDate: IsoDate | null;
    departDate: IsoDate | null;
  },
): Promise<Stop> {
  return db.transaction(async (tx) => {
    await assertOwnedLeg(tx, owner, input.legId);
    const [agg] = await tx
      .select({ highest: max(stops.sortOrder) })
      .from(stops)
      .where(eq(stops.legId, input.legId));
    const [row] = await tx
      .insert(stops)
      .values({
        legId: input.legId,
        placeName: input.place.name,
        lat: input.place.lat,
        lng: input.place.lng,
        googlePlaceId: input.place.googlePlaceId,
        arriveDate: input.arriveDate,
        departDate: input.departDate,
        sortOrder: (agg?.highest ?? -1) + 1,
      })
      .returning();
    return mapStop({ ...row!, reservations: [], ideas: [] });
  });
}

/**
 * The widened stop write: rename (`placeName`), move (`legId`), reorder
 * (`sortOrder`) and the dates, on top of the rating/notes it always had.
 *
 * `ownedLegIds` in the WHERE only proves the stop's CURRENT leg is owned — it
 * says nothing about a leg id being written INTO the row. So a move checks the
 * DESTINATION leg separately and throws, or "Move to leg" would be a way to
 * push an owned stop into someone else's trip.
 */
export async function updateStopFields(
  owner: string,
  stopId: string,
  patch: {
    placeName?: string;
    legId?: string;
    sortOrder?: number;
    rating?: number | null;
    notes?: string | null;
    arriveDate?: IsoDate | null;
    departDate?: IsoDate | null;
  },
): Promise<boolean> {
  if (patch.legId !== undefined) await assertOwnedLeg(db, owner, patch.legId);
  const scope = and(eq(stops.id, stopId), inArray(stops.legId, ownedLegIds(owner)));
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: stops.id }).from(stops).where(scope);
    return rows.length > 0;
  }
  const updated = await db.update(stops).set(patch).where(scope).returning({ id: stops.id });
  return updated.length > 0;
}

/** Reservations and ideas cascade with the stop. */
export async function deleteStop(owner: string, stopId: string): Promise<boolean> {
  const deleted = await db
    .delete(stops)
    .where(and(eq(stops.id, stopId), inArray(stops.legId, ownedLegIds(owner))))
    .returning({ id: stops.id });
  return deleted.length > 0;
}

// ── reservations and ideas: the two LEAVES ────────────────────────────────
//
// Neither table has an owner column, so an UPDATE/DELETE scopes through
// `ownedStopIds` and reports whether it matched a row (404 vs 204). A CREATE
// has no WHERE to match zero rows, so it proves the parent stop first and
// throws — the shape `createReservation` has always used, now shared.

/** A stop the caller owns, proved before an insert can point at it. */
async function assertOwnedStop(
  tx: { select: typeof db.select },
  owner: string,
  stopId: string,
): Promise<void> {
  const owned = await tx
    .select({ id: stops.id })
    .from(stops)
    .where(and(eq(stops.id, stopId), inArray(stops.legId, ownedLegIds(owner))));
  if (!owned.length) throw new Error("stop not found");
}

/**
 * The stop sheet's reservation form — and the body an undone DELETE re-POSTs,
 * which is why every column travels rather than the four the form used to
 * collect. `cost` is a numeric column: it arrives as a number and is written
 * as a string, exactly the way `mapReservation` reads it back.
 */
export async function createReservation(
  owner: string,
  input: {
    stopId: string;
    type: ReservationType;
    name: string;
    checkIn: IsoDate | null;
    checkOut: IsoDate | null;
    confirmationNumber: string | null;
    cost: number | null;
    rating: number | null;
    notes: string | null;
  },
): Promise<Reservation> {
  await assertOwnedStop(db, owner, input.stopId);
  const [row] = await db
    .insert(reservations)
    .values({
      stopId: input.stopId,
      type: input.type,
      name: input.name,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      confirmationNumber: input.confirmationNumber,
      cost: input.cost == null ? null : String(input.cost),
      rating: input.rating,
      notes: input.notes,
    })
    .returning();
  return mapReservation(row!);
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
    notes?: string | null;
  },
): Promise<boolean> {
  const scope = and(
    eq(reservations.id, resId),
    inArray(reservations.stopId, ownedStopIds(owner)),
  );
  if (Object.keys(patch).length === 0) {
    const rows = await db.select({ id: reservations.id }).from(reservations).where(scope);
    return rows.length > 0;
  }
  // `cost` is the one column whose wire type is not its stored type.
  const { cost, ...rest } = patch;
  const values = cost === undefined ? rest : { ...rest, cost: cost === null ? null : String(cost) };
  const updated = await db
    .update(reservations)
    .set(values)
    .where(scope)
    .returning({ id: reservations.id });
  return updated.length > 0;
}

/** A leaf delete — nothing cascades from it, which is why the client offers an
 * undo toast instead of a confirm dialog. */
export async function deleteReservation(owner: string, resId: string): Promise<boolean> {
  const deleted = await db
    .delete(reservations)
    .where(and(eq(reservations.id, resId), inArray(reservations.stopId, ownedStopIds(owner))))
    .returning({ id: reservations.id });
  return deleted.length > 0;
}

/**
 * "Add idea" — appended to the end of its stop's list. The sortOrder is read
 * and written in ONE transaction, so two concurrent adds cannot claim the same
 * position (the read path orders on it).
 */
export async function createIdea(
  owner: string,
  input: {
    stopId: string;
    title: string;
    status: IdeaStatus;
    place: Place | null;
    rating: number | null;
    notes: string | null;
  },
): Promise<Idea> {
  return db.transaction(async (tx) => {
    await assertOwnedStop(tx, owner, input.stopId);
    const [agg] = await tx
      .select({ highest: max(ideas.sortOrder) })
      .from(ideas)
      .where(eq(ideas.stopId, input.stopId));
    const [row] = await tx
      .insert(ideas)
      .values({
        stopId: input.stopId,
        title: input.title,
        status: input.status,
        placeName: input.place?.name ?? null,
        lat: input.place?.lat ?? null,
        lng: input.place?.lng ?? null,
        googlePlaceId: input.place?.googlePlaceId ?? null,
        rating: input.rating,
        notes: input.notes,
        sortOrder: (agg?.highest ?? -1) + 1,
      })
      .returning();
    return mapIdea(row!);
  });
}

export async function updateIdeaFields(
  owner: string,
  ideaId: string,
  patch: { status?: IdeaStatus; rating?: number | null; notes?: string | null },
): Promise<void> {
  await db
    .update(ideas)
    .set(patch)
    .where(and(eq(ideas.id, ideaId), inArray(ideas.stopId, ownedStopIds(owner))));
}

/** The other leaf delete. Same undo toast, same absence of a cascade. */
export async function deleteIdea(owner: string, ideaId: string): Promise<boolean> {
  const deleted = await db
    .delete(ideas)
    .where(and(eq(ideas.id, ideaId), inArray(ideas.stopId, ownedStopIds(owner))))
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
      .where(and(eq(ideas.id, ideaId), inArray(ideas.stopId, ownedStopIds(owner))));
    const idea = owned[0];
    if (!idea) throw new Error("idea not found");
    await tx.delete(ideas).where(eq(ideas.id, ideaId));
    const [res] = await tx
      .insert(reservations)
      .values({
        stopId: idea.stopId,
        type,
        name: idea.title,
        notes: "Promoted from idea",
      })
      .returning();
    return mapReservation(res!);
  });
}

export async function reorderLegStops(
  owner: string,
  legId: string,
  order: string[],
): Promise<void> {
  const owned = await db
    .select({ id: legs.id })
    .from(legs)
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(and(eq(legs.id, legId), eq(trips.ownerId, owner)));
  if (!owned.length) throw new Error("leg not found");
  await db.transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(stops)
        .set({ sortOrder: i })
        .where(and(eq(stops.id, order[i]!), eq(stops.legId, legId)));
    }
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
 * ── The Places library (docs/design/41 §3) ───────────────────────────────────
 *
 * saved_places is account-scoped, not trip-scoped, so these three scope on
 * `owner_id` directly rather than through the leg/stop subqueries above. The
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

export async function createSavedPlace(
  owner: string,
  input: SavedPlaceCreate,
): Promise<SavedPlace> {
  const tripName = await ownedTripTitle(owner, input.tripId);
  const [row] = await db
    .insert(savedPlaces)
    .values({ ownerId: owner, ...input })
    .returning();
  return mapSavedPlaceRow(row!, tripName);
}

/**
 * Patch a library row in place — the edit sheet, the graduation ("been" +
 * rating + tripId, source cleared) and the Locate coordinate backfill all land
 * here. Returns false when the id is not this owner's.
 */
export async function updateSavedPlaceFields(
  owner: string,
  placeId: string,
  patch: SavedPlacePatch,
): Promise<boolean> {
  if (patch.tripId !== undefined) await ownedTripTitle(owner, patch.tripId);
  const rows = await db
    .update(savedPlaces)
    .set(patch)
    .where(and(eq(savedPlaces.id, placeId), eq(savedPlaces.ownerId, owner)))
    .returning({ id: savedPlaces.id });
  return rows.length > 0;
}

/** Hard delete, owner-scoped. Returns false when the id is not this owner's. */
export async function deleteSavedPlace(owner: string, placeId: string): Promise<boolean> {
  const rows = await db
    .delete(savedPlaces)
    .where(and(eq(savedPlaces.id, placeId), eq(savedPlaces.ownerId, owner)))
    .returning({ id: savedPlaces.id });
  return rows.length > 0;
}
