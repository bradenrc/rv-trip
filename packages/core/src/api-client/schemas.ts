import { z } from "zod";
import { trip, tripSummary, savedPlace, reservation } from "../domain/types";
import { rigProfile } from "../domain/rig";

/**
 * Wire schemas for the REST API — what the api-client validates responses
 * against. The domain schemas are reused wherever a response IS a domain
 * object; the few shapes that only exist on the wire live here.
 *
 * A mismatch throws a ZodError in the client, which is the point: a drift
 * between the handlers and the clients fails loudly in development instead of
 * rendering as an undefined somewhere three screens later.
 */

export const routeNoticeSchema = z.object({
  code: z.string(),
  kind: z.enum(["height", "width", "length", "weight", "propane", "other"]),
  roadName: z.string().nullable(),
  limitMeters: z.number().nullable(),
  message: z.string(),
});

export const routeResultSchema = z.object({
  durationSeconds: z.number(),
  distanceMeters: z.number(),
  polyline: z.string().nullable(),
  primaryRoad: z.string().nullable(),
  source: z.enum(["here", "estimate"]),
  notices: z.array(routeNoticeSchema),
});

/** `GET /api/trips/:id` — the exact bundle the web planner page hands `TripPlanner`. */
export const tripBundleSchema = z.object({
  trip,
  routes: z.record(z.string(), routeResultSchema),
  rigHash: z.string(),
  hasRig: z.boolean(),
});
export type TripBundle = z.infer<typeof tripBundleSchema>;

export const tripSummaryListSchema = z.array(tripSummary);
export const savedPlaceListSchema = z.array(savedPlace);
export const rigResponseSchema = rigProfile.nullable();

/** `POST /api/routes` — echoes the routing hash it keyed with. */
export const routePairsResponseSchema = z.object({
  routingHash: z.string(),
  routes: z.record(z.string(), routeResultSchema),
});

/**
 * Creates return the raw DB row (numeric columns arrive as strings, dates as
 * plain strings). Coerce into the domain reservation so callers never see the
 * row shape — the same mapping `TripPlanner.mapRes` did by hand.
 */
export const reservationRowSchema = z
  .object({
    id: z.string(),
    stopId: z.string(),
    ideaId: z.string().nullable().optional(),
    type: reservation.shape.type,
    name: z.string(),
    checkIn: z.string().nullable().optional(),
    checkOut: z.string().nullable().optional(),
    confirmationNumber: z.string().nullable().optional(),
    cost: z.union([z.number(), z.string()]).nullable().optional(),
    rating: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .transform((r) => ({
    id: r.id,
    stopId: r.stopId,
    ideaId: r.ideaId ?? null,
    type: r.type,
    name: r.name,
    checkIn: r.checkIn ?? null,
    checkOut: r.checkOut ?? null,
    confirmationNumber: r.confirmationNumber ?? null,
    cost: r.cost == null ? null : Number(r.cost),
    rating: r.rating ?? null,
    notes: r.notes ?? null,
  }));
