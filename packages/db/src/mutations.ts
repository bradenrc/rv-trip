import { eq, and, inArray } from "drizzle-orm";
import { db } from "./index";
import { legs, stops, ideas, reservations, trips, rigs, savedPlaces } from "./schema";
import type {
  ReservationType,
  IdeaStatus,
  IsoDate,
  RigProfile,
  RigProfileInput,
  SavedPlace,
  SavedPlaceCreate,
  SavedPlacePatch,
} from "@rv-trip/core";
import { mapRigRow, mapSavedPlaceRow } from "./queries";

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

export async function updateStopFields(
  owner: string,
  stopId: string,
  patch: {
    rating?: number | null;
    notes?: string | null;
    arriveDate?: IsoDate | null;
    departDate?: IsoDate | null;
  },
): Promise<void> {
  await db
    .update(stops)
    .set(patch)
    .where(and(eq(stops.id, stopId), inArray(stops.legId, ownedLegIds(owner))));
}

export async function createReservation(
  owner: string,
  input: { stopId: string; type: ReservationType; name: string; cost: number | null; checkIn: IsoDate | null },
) {
  const owned = await db
    .select({ id: stops.id })
    .from(stops)
    .where(and(eq(stops.id, input.stopId), inArray(stops.legId, ownedLegIds(owner))));
  if (!owned.length) throw new Error("stop not found");
  const [row] = await db
    .insert(reservations)
    .values({
      stopId: input.stopId,
      type: input.type,
      name: input.name,
      cost: input.cost == null ? null : String(input.cost),
      checkIn: input.checkIn,
    })
    .returning();
  return row!;
}

export async function updateReservationFields(
  owner: string,
  resId: string,
  patch: { rating?: number | null; notes?: string | null },
): Promise<void> {
  await db
    .update(reservations)
    .set(patch)
    .where(and(eq(reservations.id, resId), inArray(reservations.stopId, ownedStopIds(owner))));
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

export async function promoteIdeaToReservation(owner: string, ideaId: string) {
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
        type: "activity",
        name: idea.title,
        notes: "Promoted from idea",
      })
      .returning();
    return res!;
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
