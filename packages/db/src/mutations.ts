import { eq, and, inArray } from "drizzle-orm";
import { db } from "./index";
import { legs, stops, ideas, reservations, trips, rigs } from "./schema";
import type {
  ReservationType,
  IdeaStatus,
  IsoDate,
  RigProfile,
  RigProfileInput,
  TripStatus,
} from "@rv-trip/core";
import { mapRigRow } from "./queries";

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
