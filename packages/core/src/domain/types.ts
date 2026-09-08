import { z } from "zod";

/**
 * The trip grammar. These schemas are the single source of truth for the shape
 * of a trip; the API validates against them (in and out) and the web/native
 * clients import them verbatim. See docs/superpowers/specs for the design.
 */

/** ISO calendar date, 'YYYY-MM-DD'. We work in plain dates, never timestamps —
 * a trip day has no timezone, and this avoids DST/offset bugs in the calendar. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof isoDate>;

export const reservationType = z.enum([
  "campground",
  "lodging",
  "dining",
  "event",
  "tour",
  "activity",
  "transport",
  "other",
]);
export type ReservationType = z.infer<typeof reservationType>;

export const ideaStatus = z.enum(["idea", "planned", "done"]);
export type IdeaStatus = z.infer<typeof ideaStatus>;

/** 1-5 stars, or null when unrated. Seeds the memory layer ("what we loved"). */
export const rating = z.number().int().min(1).max(5).nullable();

/** A place reference. Coords optional (a floating idea may just be a name);
 * googlePlaceId links to Google Places for details/reviews when available. */
export const place = z.object({
  name: z.string().min(1),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  googlePlaceId: z.string().nullable().default(null),
});
export type Place = z.infer<typeof place>;

export const reservation = z.object({
  id: z.string(),
  stopId: z.string(),
  ideaId: z.string().nullable().default(null),
  type: reservationType,
  name: z.string().min(1),
  checkIn: isoDate.nullable().default(null),
  checkOut: isoDate.nullable().default(null),
  confirmationNumber: z.string().nullable().default(null),
  cost: z.number().nonnegative().nullable().default(null),
  rating,
  notes: z.string().nullable().default(null),
});
export type Reservation = z.infer<typeof reservation>;

export const idea = z.object({
  id: z.string(),
  stopId: z.string(),
  title: z.string().min(1),
  status: ideaStatus.default("idea"),
  place: place.nullable().default(null),
  rating,
  notes: z.string().nullable().default(null),
  sortOrder: z.number().int(),
});
export type Idea = z.infer<typeof idea>;

/**
 * A Stop is a place you go — the anchor of the grammar.
 * sortOrder is ALWAYS present (defines sequence within the leg).
 * arriveDate/departDate are OPTIONAL: a stop with dates is "scheduled" (it
 * contributes to the calendar and to derived drive/stay days); a stop without
 * dates is "floating" (it lives in the route sequence only). A trip freely
 * mixes both.
 */
export const stop = z.object({
  id: z.string(),
  legId: z.string(),
  place,
  arriveDate: isoDate.nullable().default(null),
  departDate: isoDate.nullable().default(null),
  sortOrder: z.number().int(),
  rating,
  notes: z.string().nullable().default(null),
  reservations: z.array(reservation).default([]),
  ideas: z.array(idea).default([]),
});
export type Stop = z.infer<typeof stop>;

/** A named segment of the journey ("Pacific Coast"), grouping stops. */
export const leg = z.object({
  id: z.string(),
  tripId: z.string(),
  title: z.string().min(1),
  sortOrder: z.number().int(),
  stops: z.array(stop).default([]),
});
export type Leg = z.infer<typeof leg>;

export const tripStatus = z.enum(["planning", "upcoming", "complete"]);
export type TripStatus = z.infer<typeof tripStatus>;

export const trip = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string().min(1),
  homeBase: z.string().nullable().default(null),
  startDate: isoDate,
  endDate: isoDate,
  status: tripStatus.default("planning"),
  rating: rating,
  note: z.string().nullable().default(null),
  legs: z.array(leg).default([]),
});
export type Trip = z.infer<typeof trip>;

/**
 * The Places library: an account-scoped, cross-trip collection of spots.
 * ONE record with ONE status field — a place graduates want -> been after a
 * visit rather than being re-entered into a second collection.
 */
export const savedPlaceStatus = z.enum(["want", "been"]);
export type SavedPlaceStatus = z.infer<typeof savedPlaceStatus>;

export const savedPlace = z.object({
  id: z.string(),
  ownerId: z.string(),
  place,
  /** Human region line ("Olympic NP, WA") — display only, not geocoded. */
  region: z.string().nullable().default(null),
  /** Reused so the five-category language (Stay/Eat/Do/Travel/Other) resolves
   * through the same categoryMeta lookup every other surface uses. */
  type: reservationType,
  status: savedPlaceStatus.default("want"),
  note: z.string().nullable().default(null),
  /** "want" shelf: who/what the tip came from ("Jane & Rick", "Forum tip"). */
  source: z.string().nullable().default(null),
  /** "been" shelf: the rating and the trip it was visited on. */
  rating,
  tripId: z.string().nullable().default(null),
  tripName: z.string().nullable().default(null),
});
export type SavedPlace = z.infer<typeof savedPlace>;

/** A stop is "scheduled" iff it has both dates. */
export function isScheduled(
  s: Pick<Stop, "arriveDate" | "departDate">,
): s is Stop & { arriveDate: IsoDate; departDate: IsoDate } {
  return s.arriveDate !== null && s.departDate !== null;
}

/**
 * A dashboard row: the trip's identity + status/memory + the stats the cards
 * show. Computed server-side (`listTripsForOwner`), returned by
 * `GET /api/trips`, validated by the api-client on the way in.
 */
export const tripSummary = z.object({
  id: z.string(),
  title: z.string(),
  homeBase: z.string().nullable(),
  startDate: isoDate,
  endDate: isoDate,
  status: tripStatus,
  rating,
  note: z.string().nullable(),
  days: z.number().int(),
  stops: z.number().int(),
  legs: z.number().int(),
  miles: z.number(),
  open: z.number().int(),
});
export type TripSummary = z.infer<typeof tripSummary>;
