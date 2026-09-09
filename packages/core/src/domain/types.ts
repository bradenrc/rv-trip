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
  /** Whether `status` is derived from the dates (`deriveTripStatus`) or pinned.
   * `false` is the ONLY thing stored about status — a manual choice, which the
   * derivation then steps aside for and never re-derives. */
  statusAuto: z.boolean().default(true),
  rating: rating,
  note: z.string().nullable().default(null),
  legs: z.array(leg).default([]),
});
export type Trip = z.infer<typeof trip>;

/**
 * The trip WRITE contract, derived from the grammar above rather than re-typed
 * beside it — so a new field lands in the schema once and the handlers inherit
 * it. `id`, `ownerId` and `legs` are never client-supplied.
 */

/** `POST /api/trips`. `homeBase` defaults to null when omitted. */
export const tripCreateInput = trip.pick({
  title: true,
  startDate: true,
  endDate: true,
  homeBase: true,
});
export type TripCreateInput = z.infer<typeof tripCreateInput>;

/** `PATCH /api/trips/:id` — every editable field, all optional, because the
 * settings dialog sends only what it changed. `.partial()` over a defaulted
 * field yields an ABSENT key, not the default, so an omitted field is left
 * alone rather than reset (pinned by trip-write-contract.test.ts). */
export const tripPatchInput = trip
  .pick({
    title: true,
    homeBase: true,
    startDate: true,
    endDate: true,
    status: true,
    statusAuto: true,
    rating: true,
    note: true,
  })
  .partial();
export type TripPatchInput = z.infer<typeof tripPatchInput>;

/**
 * The leg + stop WRITE contract — derived from the grammar above for the same
 * reason the trip one is: a field lands in the schema once and the handlers
 * inherit it. `id` and `sortOrder` are never client-supplied on a create (the
 * server appends), and `legs`/`stops`/`reservations`/`ideas` are never written
 * through their parent.
 *
 * The id-shaped fields are tightened to `.uuid()` here rather than in the
 * grammar: they address a real `uuid` column, so a malformed one is a 400 at
 * the boundary instead of a Postgres cast error deeper in. Same convention the
 * shipped handlers already use (`api/reservations/route.ts:7`).
 */

/** `POST /api/legs` — the "Add leg" button. The server appends the sortOrder. */
export const legCreateInput = leg
  .pick({ title: true })
  .extend({ tripId: z.string().uuid() });
export type LegCreateInput = z.infer<typeof legCreateInput>;

/** `PATCH /api/legs/:id` — the inline rename. Order moves through reorder. */
export const legPatchInput = leg.pick({ title: true }).partial();
export type LegPatchInput = z.infer<typeof legPatchInput>;

/** `POST /api/trips/:id/legs/reorder` — "Move leg up/down" sends the whole new
 * order, so the renumber is one transaction rather than a swap of two rows. */
export const legReorderInput = z.object({
  order: z.array(z.string().uuid()).min(1),
});
export type LegReorderInput = z.infer<typeof legReorderInput>;

/** `POST /api/stops` — per-leg "Add stop". A stop is born floating unless the
 * caller already has dates for it; the server appends the sortOrder. */
export const stopCreateInput = stop
  .pick({ place: true, arriveDate: true, departDate: true })
  .extend({ legId: z.string().uuid() });
export type StopCreateInput = z.infer<typeof stopCreateInput>;

/**
 * `PATCH /api/stops/:id` — the widened stop write. `placeName` is the rename
 * (the row menu edits the name, never the coordinates), `legId` is "Move to
 * leg", `sortOrder` is the floating-rail reorder, and both dates going null is
 * "Unschedule". Every key optional: the menu sends one field at a time.
 */
export const stopPatchInput = stop
  .pick({
    arriveDate: true,
    departDate: true,
    sortOrder: true,
    rating: true,
    notes: true,
  })
  .extend({ placeName: place.shape.name, legId: z.string().uuid() })
  .partial();
export type StopPatchInput = z.infer<typeof stopPatchInput>;

/**
 * The reservation + idea WRITE contract — the two LEAVES of the tree, derived
 * from the grammar for the same reason the trip/leg/stop ones are.
 *
 * Both creates carry the whole editable row rather than the handful of fields
 * the add form fills in, because a create is also how an UNDONE DELETE puts a
 * row back: the DELETE has already committed by the time the toast is gone, so
 * "Undo" re-POSTs the row it was holding rather than resurrecting the id. A
 * body that could not carry `rating`/`notes` would silently drop them.
 *
 * `id`, `stopId` (path/body-supplied) and `ideaId` (only `promote` sets it) are
 * never client-editable, and `sortOrder` is the server's to append.
 */

/** `POST /api/reservations` — the stop sheet's reservation form, and the undo. */
export const reservationCreateInput = reservation
  .pick({
    type: true,
    name: true,
    checkIn: true,
    checkOut: true,
    confirmationNumber: true,
    cost: true,
    notes: true,
  })
  .extend({ stopId: z.string().uuid(), rating: rating.default(null) });
export type ReservationCreateInput = z.infer<typeof reservationCreateInput>;

/** `PATCH /api/reservations/:id` — every editable field, all optional, because
 * the form sends only what it changed (and the card's stars/note send one). */
export const reservationPatchInput = reservation
  .pick({
    type: true,
    name: true,
    checkIn: true,
    checkOut: true,
    confirmationNumber: true,
    cost: true,
    rating: true,
    notes: true,
  })
  .partial();
export type ReservationPatchInput = z.infer<typeof reservationPatchInput>;

/** `POST /api/ideas` — the stop sheet's "Add idea", and the undo. */
export const ideaCreateInput = idea
  .pick({ title: true, status: true, place: true, notes: true })
  .extend({ stopId: z.string().uuid(), rating: rating.default(null) });
export type IdeaCreateInput = z.infer<typeof ideaCreateInput>;

/**
 * `POST /api/ideas/:id/promote` — the type the promoted reservation lands as.
 *
 * Optional, defaulting to the `"activity"` the mutation used to hardcode, so a
 * caller that posts no body at all (as the shipped client did) is unaffected.
 */
export const ideaPromoteInput = z.object({ type: reservationType.default("activity") });
export type IdeaPromoteInput = z.infer<typeof ideaPromoteInput>;

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

/**
 * The WRITE grammar for the Places library (docs/design/41 §3).
 *
 * `savedPlace` above is the READ shape: the place fields are nested under
 * `place`, `id`/`ownerId` are server-owned and `tripName` is joined. The bodies
 * the picker and the library sheets actually send are FLAT and — for a PATCH —
 * partial, so they get their own named schemas. Validating a create body
 * against `savedPlace` fails on the missing `place`/`id`/`ownerId` and silently
 * drops every flat key, which is exactly the bug these two exist to prevent.
 *
 * The field set is the mutable half of `saved_places` and maps 1:1 onto the
 * columns (packages/db/src/schema.ts), so the mutations pass it straight
 * through. `id`, `ownerId`, `createdAt` and the joined `tripName` are
 * server-owned and are stripped from any body that sends them.
 */
export const savedPlaceCreate = z.object({
  name: z.string().min(1),
  region: z.string().nullable().default(null),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  googlePlaceId: z.string().nullable().default(null),
  type: reservationType.default("other"),
  status: savedPlaceStatus.default("want"),
  note: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  /** Set on a POST only when a suggestion is accepted straight onto "been". */
  rating: rating.default(null),
  tripId: z.string().uuid().nullable().default(null),
});
/** Post-parse: every default resolved. What the mutations receive. */
export type SavedPlaceCreate = z.infer<typeof savedPlaceCreate>;
/** Pre-parse: `name` and whatever else the caller chose to send. What a client
 * hands `tripApi.savePlace`. */
export type SavedPlaceCreateInput = z.input<typeof savedPlaceCreate>;

/**
 * PATCH /api/places/:id — every field optional, absent keys left absent so a
 * patch never blanks a column it did not name. At least one recognized key is
 * required: an empty `.set({})` is a Drizzle error, and a body of nothing but
 * unknown keys is a caller bug that deserves a 400 rather than a 500.
 */
export const savedPlacePatch = savedPlaceCreate
  .partial()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must name at least one field",
  });
export type SavedPlacePatch = z.infer<typeof savedPlacePatch>;

/**
 * Graduation invariant, enforced server-side: "who told you about it" is queue
 * metadata, not archive metadata, so a patch that moves a row onto the "been"
 * shelf clears `source` whether or not the client remembered to send
 * `source: null`.
 */
export function normalizeSavedPlacePatch(patch: SavedPlacePatch): SavedPlacePatch {
  return patch.status === "been" ? { ...patch, source: null } : patch;
}

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
  /** Mirrors `trip.statusAuto` so the dashboard row and the trip agree about
   * whether the status it shows was derived or pinned. */
  statusAuto: z.boolean(),
  rating,
  note: z.string().nullable(),
  days: z.number().int(),
  stops: z.number().int(),
  legs: z.number().int(),
  miles: z.number(),
  open: z.number().int(),
});
export type TripSummary = z.infer<typeof tripSummary>;
