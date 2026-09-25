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

/**
 * What KIND of maybe an idea is — the three words the product speaks (#80
 * Q2 → A). Deliberately NOT a reuse of `reservationType`: the shelf groups on
 * Stay / Eat / Do and nothing else, and a five-value vocabulary would have to
 * be narrowed at every render. The bridge INTO the DS's five-category language
 * is `ideaCategoryMeta` (packages/ui/src/category.ts) — one lookup, never two
 * drifting ones.
 */
export const ideaCategory = z.enum(["do", "eat", "stay"]);
export type IdeaCategory = z.infer<typeof ideaCategory>;

/** 1-5 stars, or null when unrated. Seeds the memory layer ("what we loved"). */
export const rating = z.number().int().min(1).max(5).nullable();

/**
 * The three fields a household shares a VOICE on (#78 · docs/design/81 §6) —
 * the only ones a change is worth keeping. `notes` is the canonical spelling
 * even though `saved_places` names its column `note`: one vocabulary on the
 * wire, or the /places byline could never match the set it renders from (the
 * mapping happens once, at the write site in packages/db).
 */
export const changeField = z.enum(["rating", "notes", "status"]);
export type ChangeField = z.infer<typeof changeField>;

/** The four things a change is logged against. `save` was `savedPlace` before
 * the W0 reset (#110 §5) — the table it names is now `saves`. */
export const changeEntity = z.enum(["stop", "idea", "reservation", "save"]);
export type ChangeEntity = z.infer<typeof changeEntity>;

/**
 * The ONE joined row the list read carries — "rated by Jess · Sep 12". It rides
 * along on the thing that changed, so the glance answer costs no second fetch;
 * the older changes behind it are `GET /api/history`, fetched only when the
 * byline is opened.
 *
 * `memberName` is the best name the server has for the person: a real display
 * name where the identity provider knows one, otherwise the member id itself.
 * `at` is an instant (ISO 8601 with a zone), NOT one of this grammar's plain
 * `YYYY-MM-DD` trip dates — an audit timestamp has a clock, a trip day does not.
 */
export const lastChange = z.object({
  field: changeField,
  memberName: z.string(),
  at: z.string(),
});
export type LastChange = z.infer<typeof lastChange>;

/**
 * One line of the opened popover — the same row plus what it moved FROM and TO.
 * `from`/`to` are text (a rating travels as its decimal digits) and NULL is a
 * genuinely absent value, which is how "— → ★★★★" tells "cleared" from "never
 * set".
 */
export const changeHistoryRow = z.object({
  field: changeField,
  from: z.string().nullable(),
  to: z.string().nullable(),
  memberName: z.string(),
  at: z.string(),
});
export type ChangeHistoryRow = z.infer<typeof changeHistoryRow>;

/**
 * Every entity that carries a byline spells the field the same way: nullable
 * with a `null` default, so a payload written before #78 — a cached bundle, a
 * phone build on its own release cadence — still parses, and "nothing has ever
 * been changed here" and "this server does not send it" are one state.
 */
const lastChangeField = lastChange.nullable().default(null);

/** A place reference. Coords optional (a floating idea may just be a name);
 * googlePlaceId links to Google Places for details/reviews when available. */
export const place = z.object({
  name: z.string().min(1),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
  googlePlaceId: z.string().nullable().default(null),
});
export type Place = z.infer<typeof place>;

/**
 * How a hop between two stops is travelled (#110 · Q1 A). Mode lives on the
 * SEGMENT, never on a stop or a day: HERE routing and the RV-safety corridor key
 * off `drive` only. `train` is a later wave.
 */
export const travelMode = z.enum(["drive", "fly", "ferry"]);
export type TravelMode = z.infer<typeof travelMode>;

/** A trip's lodging default (#110 §5, Q7 A) — a default, never a constraint. */
export const lodgingKind = z.enum(["hotel", "friends", "airbnb", "campground"]);
export type LodgingKind = z.infer<typeof lodgingKind>;

/**
 * An INSTANT (ISO 8601 with a zone), as a timed segment or a flight carries it.
 * Unlike `isoDate` this has a clock; its IANA zone travels beside it
 * (`departTz`, `startsTz`, …) so a local wall clock and a local DATE can be
 * recovered (`localDate`, segments.ts).
 */
const instant = z.string().nullable().default(null);
/** An IANA zone name ("America/Boise"), or null when the instant is untimed. */
const ianaZone = z.string().nullable().default(null);

/**
 * A reservation hangs on EXACTLY ONE parent (#110 Q2 A): a stop (lodging, a
 * tour) or a travel segment (a flight, a ferry ticket). The database enforces
 * it with `CHECK num_nonnulls(stop_id, segment_id) = 1`; `stop.reservations`
 * carries only the stop-attached rows and `segment.reservations` the rest.
 */
export const reservation = z.object({
  id: z.string(),
  stopId: z.string().nullable(),
  segmentId: z.string().nullable().default(null),
  ideaId: z.string().nullable().default(null),
  type: reservationType,
  name: z.string().min(1),
  checkIn: isoDate.nullable().default(null),
  checkOut: isoDate.nullable().default(null),
  confirmationNumber: z.string().nullable().default(null),
  cost: z.number().nonnegative().nullable().default(null),
  rating,
  notes: z.string().nullable().default(null),
  /** A transport booking's clock (#110 §6): when it leaves and lands, each in
   * its own zone. Lodging keeps the day-grain `checkIn`/`checkOut`. */
  startsAt: instant,
  endsAt: instant,
  startsTz: ianaZone,
  endsTz: ianaZone,
  lastChange: lastChangeField,
});
export type Reservation = z.infer<typeof reservation>;

/**
 * An idea is the grammar's MAYBE. It belongs to the TRIP (#80): `tripId` is
 * always set — it is the single ownership path every idea write scopes on —
 * and `stopId` is optional. A null `stopId` is a *shelf* idea: a maybe you have
 * not committed to a stop yet, which is the whole of #80.
 */
export const idea = z.object({
  id: z.string(),
  tripId: z.string(),
  stopId: z.string().nullable().default(null),
  title: z.string().min(1),
  category: ideaCategory.default("do"),
  status: ideaStatus.default("idea"),
  place: place.nullable().default(null),
  rating,
  notes: z.string().nullable().default(null),
  sortOrder: z.number().int(),
  lastChange: lastChangeField,
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
  lastChange: lastChangeField,
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

/**
 * One hop of the journey (#110 · Q1 A): every adjacent pair of the route
 * sequence has a row, plus home → first stop when the trip has a home base.
 * `fromStopId === null` is the home base; `toStopId === null` is home. The row
 * set is kept dense by `reconcileSegments` (segments.ts) — never hand-edited.
 *
 * Timed (`departAt` + `arriveAt`) or untimed. A timed segment is travel on
 * every LOCAL date it touches (Q4 B); an untimed one borrows its day from the
 * stop it arrives at (derive-days.ts).
 */
export const segment = z.object({
  id: z.string(),
  tripId: z.string(),
  fromStopId: z.string().nullable(),
  toStopId: z.string().nullable(),
  mode: travelMode,
  departAt: instant,
  arriveAt: instant,
  departTz: ianaZone,
  arriveTz: ianaZone,
  sortOrder: z.number().int(),
  reservations: z.array(reservation).default([]),
});
export type Segment = z.infer<typeof segment>;

export const tripStatus = z.enum(["planning", "upcoming", "complete"]);
export type TripStatus = z.infer<typeof tripStatus>;

export const trip = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string().min(1),
  homeBase: z.string().nullable().default(null),
  /**
   * Home base as a real PLACE — name, coordinates and place id together (#60
   * Q4 → B). `homeBase` above stays the NAME column so every shipped read path
   * (`tripSummary`, the dashboard card, the phone) is untouched; this is the
   * anchor the planner's first-stop search biases to when there is no previous
   * stop above it. One object on the wire, three nullable columns underneath —
   * the same shape the stop write uses, and for the same reason
   * (`pickedCoordLabel`: half a coordinate is no coordinate).
   */
  homeBasePlace: place.nullable().default(null),
  startDate: isoDate,
  endDate: isoDate,
  status: tripStatus.default("planning"),
  /** Whether `status` is derived from the dates (`deriveTripStatus`) or pinned.
   * `false` is the ONLY thing stored about status — a manual choice, which the
   * derivation then steps aside for and never re-derives. */
  statusAuto: z.boolean().default(true),
  rating: rating,
  note: z.string().nullable().default(null),
  /**
   * The trip's three plain DEFAULTS (#110 Q7 A) — never constraints. A newly
   * reconciled segment takes `defaultMode`; W0 stores and seeds the other two.
   */
  defaultMode: travelMode.default("drive"),
  lodgingDefault: lodgingKind.nullable().default(null),
  rigOn: z.boolean().default(true),
  legs: z.array(leg).default([]),
  /** Every hop of the journey, by `sortOrder` (#110 Q1 A). */
  segments: z.array(segment).default([]),
  /**
   * The idea SHELF (#80) — the trip's unattached maybes, the rows whose
   * `stopId` is null. It sits beside `legs`, not inside it, because that is
   * exactly what the column says: one row, one home. An idea attached to a stop
   * keeps rendering under that stop (`stop.ideas`) and is NOT mirrored here.
   */
  ideas: z.array(idea).default([]),
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
  // Explicit, not inherited: `.pick()` is a closed list, so a key omitted here
  // is a key `safeParse` DROPS silently at the handler — the whole home-base
  // migration would be a no-op on the wire.
  homeBasePlace: true,
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
    homeBasePlace: true,
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
  .extend({
    placeName: place.shape.name,
    /**
     * The whole place — name, coordinates and place id together (#60). One key
     * rather than three, because `pickedCoordLabel` already refuses half a
     * coordinate: a lone latitude cannot be drawn, and a patch that could send
     * one would be a way to manufacture exactly that.
     *
     * There is no `place` COLUMN — `updateStopFields` spreads its patch into
     * drizzle's `.set()` — so the handler flattens this through
     * `stopPatchColumns` (place-form.ts) before the mutation sees it. When a
     * body carries both keys the whole place wins; `placeName` is the cheap
     * rename and cannot outrank the thing that carries coordinates.
     */
    place,
    legId: z.string().uuid(),
  })
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

/**
 * `POST /api/ideas` — the stop sheet's "Add idea", the shelf's "+ Add", the
 * Add-from-Places copy, and the undo.
 *
 * `tripId` is REQUIRED (#80): an idea belongs to the trip whether or not it is
 * attached to a stop, and that is the column every idea write is owner-scoped
 * on. `stopId` is nullable and defaults to null — a shelf idea is the create
 * with no stop in hand, and the handler's 404 arm proves the TRIP in that case.
 */
export const ideaCreateInput = idea
  .pick({ title: true, status: true, place: true, notes: true, category: true })
  .extend({
    tripId: z.string().uuid(),
    stopId: z.string().uuid().nullable().default(null),
    rating: rating.default(null),
  });
export type IdeaCreateInput = z.infer<typeof ideaCreateInput>;

/**
 * `PATCH /api/ideas/:id` — the status pill, the stars, the note, and (#69) the
 * place the row's Locate picker chose.
 *
 * Every key optional, because every shipped caller sends exactly one: the pill
 * sends `{status}`, the stars `{rating}`, the note `{notes}`. That is why an
 * ABSENT key must stay absent — `updateIdeaFields` spreads the patch into
 * drizzle's `.set()`, so a phantom `place: null` on a status cycle would wipe
 * place_name/lat/lng/google_place_id off a located idea.
 *
 * There is no `place` COLUMN — the handler flattens this through
 * `ideaPatchColumns` (leaf-form.ts) before the mutation sees it, exactly as the
 * stop write flattens through `stopPatchColumns`.
 */
export const ideaPatchInput = idea
  .pick({ status: true, rating: true, notes: true, place: true, category: true })
  .extend({
    /**
     * The drop (#80). Unlike `place`, `stop_id` IS a real column, so this key
     * passes through `ideaPatchColumns` untouched. Three gestures write it: a
     * stay-idea dropped on open days (the new stop's id), a do/eat idea dropped
     * on a stop bar (that stop's id), and an attached idea dragged back to the
     * shelf (an EXPLICIT null). Absent still means "leave it alone".
     */
    stopId: z.string().uuid().nullable(),
  })
  .partial();
export type IdeaPatchInput = z.infer<typeof ideaPatchInput>;

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
  lastChange: lastChangeField,
});
export type SavedPlace = z.infer<typeof savedPlace>;

/**
 * A cached Google row — the READ grammar for the `places` table (#82 Q3 → A).
 *
 * Its own schema and not a slice of `savedPlace`, because it describes a
 * REAL-WORLD place rather than one of ours: it is not owner-scoped, it has no
 * status and no note, and it expires. `rating` here is GOOGLE's 0–5 float, so
 * it is deliberately NOT the domain `rating` above (an integer 1–5) — that one
 * is ours, rendered in Sky <Stars>; this one renders font-mono and faded, and
 * the two must never be mistaken for each other.
 */
export const placeEnrichment = z.object({
  googlePlaceId: z.string(),
  name: z.string(),
  rating: z.number().nullable().default(null),
  userRatingCount: z.number().int().nullable().default(null),
  websiteUri: z.string().nullable().default(null),
  nationalPhoneNumber: z.string().nullable().default(null),
  // #91. `.default(null)` is load-bearing here: a row cached BEFORE the
  // `google_maps_uri` column existed must still PARSE (a hit with no link),
  // never fail into a hard miss that re-bills Google for what we already hold.
  googleMapsUri: z.string().nullable().default(null),
});
export type PlaceEnrichment = z.infer<typeof placeEnrichment>;

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
  /** At least one drive on the trip fell back to a straight-line estimate, so
   * `miles` is not (yet) a road distance. The card renders the neutral
   * `EstimateChip` beside the number — the same honesty rule the route rail
   * already follows, never an amber warning. */
  milesEstimated: z.boolean(),
  open: z.number().int(),
});
export type TripSummary = z.infer<typeof tripSummary>;
