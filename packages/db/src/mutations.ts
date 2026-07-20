import { eq, and, inArray } from "drizzle-orm";
import { db } from "./index";
import { legs, stops, ideas, reservations, trips } from "./schema";
import type { ReservationType, IdeaStatus, IsoDate } from "@rv-trip/core";

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
