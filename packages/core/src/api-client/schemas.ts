import { z } from "zod";
import { trip, tripSummary, savedPlace, reservation, idea, nearbySavesResponse } from "../domain/types";
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
/** `POST /api/places` — the created row (201) or, on a replayed clientId, the
 * row that already existed (200). One shape either way (#111). */
export const savedPlaceSchema = savedPlace;

/** `GET /api/trips/:id/nearby-saves` (#111 i3) — core's `nearbySaves` result. */
export const nearbySavesSchema = nearbySavesResponse;

/** `POST /api/ideas` → 201: the created idea, already in the domain shape
 * (`createIdea` returns `mapIdea` of the inserted row). */
export const ideaSchema = idea;

const latLngSchema = z.object({ lat: z.number(), lng: z.number() });

/** One search row — `PlaceSummary`, with #111's two type fields. */
export const placeSummarySchema = z.object({
  googlePlaceId: z.string(),
  name: z.string(),
  location: latLngSchema.nullable(),
  rating: z.number().nullable(),
  address: z.string().nullable(),
  primaryType: z.string().nullable().optional(),
  primaryTypeDisplayName: z.string().nullable().optional(),
});

/** `GET /api/places/search` — healthy and degraded share this one envelope
 * (providers/places-search.ts). */
export const placesEnvelopeSchema = z.object({
  results: z.array(placeSummarySchema),
  degraded: z.boolean(),
  reason: z.enum(["no_provider", "upstream_error", "rate_limited"]).optional(),
  retryAfterMs: z.number().optional(),
  sessionToken: z.string().optional(),
});
export type PlacesSearchEnvelope = z.infer<typeof placesEnvelopeSchema>;

/** `GET /api/destinations/resolve` — the locality, or null (#111). */
export const resolvedDestinationSchema = z
  .object({
    googlePlaceId: z.string(),
    name: z.string(),
    region: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
  })
  .nullable();
export const rigResponseSchema = rigProfile.nullable();

/** `POST /api/routes` — echoes the routing hash it keyed with. */
export const routePairsResponseSchema = z.object({
  routingHash: z.string(),
  routes: z.record(z.string(), routeResultSchema),
});

/**
 * Creates return the reservation (`mapReservation` of the inserted row) —
 * coerced leniently into the domain reservation, because an older server may
 * send the raw row (numeric columns as strings) and the phone ships on its own
 * cadence. Every #104/#105 field is read, not hard-coded: a flight added on a
 * hop comes back with its segment and its clock, and a stay with its kind
 * (vet HIGH — this parser used to null the segment half out).
 */
export const reservationRowSchema = z
  .object({
    id: z.string(),
    stopId: z.string().nullable().optional(),
    segmentId: z.string().nullable().optional(),
    ideaId: z.string().nullable().optional(),
    type: reservation.shape.type,
    name: z.string(),
    checkIn: z.string().nullable().optional(),
    checkOut: z.string().nullable().optional(),
    confirmationNumber: z.string().nullable().optional(),
    cost: z.union([z.number(), z.string()]).nullable().optional(),
    rating: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    startsTz: z.string().nullable().optional(),
    endsTz: z.string().nullable().optional(),
    lodgingKind: reservation.shape.lodgingKind.optional(),
  })
  .transform((r) => ({
    id: r.id,
    stopId: r.stopId ?? null,
    segmentId: r.segmentId ?? null,
    ideaId: r.ideaId ?? null,
    type: r.type,
    name: r.name,
    checkIn: r.checkIn ?? null,
    checkOut: r.checkOut ?? null,
    confirmationNumber: r.confirmationNumber ?? null,
    cost: r.cost == null ? null : Number(r.cost),
    rating: r.rating ?? null,
    notes: r.notes ?? null,
    startsAt: r.startsAt ?? null,
    endsAt: r.endsAt ?? null,
    startsTz: r.startsTz ?? null,
    endsTz: r.endsTz ?? null,
    lodgingKind: r.lodgingKind ?? null,
    // A row that was just CREATED has no history yet, and the create response
    // carries none (#78 §6: the byline is joined on the READ path). The client
    // splices this shape straight into its trip, so the field has to be there.
    lastChange: null,
  }));

/** `POST /api/trips` → 201: the created trip's whole tree. */
export const tripSchema = trip;
