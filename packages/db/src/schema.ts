import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  date,
  boolean,
  doublePrecision,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { NavCheck, RouteResult } from "@rv-trip/core";

/**
 * Relational schema for the trip grammar. Mirrors @rv-trip/core/domain.
 * Points at local Postgres now; the same schema targets Neon later.
 *
 * Multi-tenant: every trip carries ownerId (Clerk userId; local dev = 'dev-user').
 * Children cascade-delete from their parent. Dates are plain `date` (no tz).
 */

export const reservationType = pgEnum("reservation_type", [
  "campground",
  "lodging",
  "dining",
  "event",
  "tour",
  "activity",
  "transport",
  "other",
]);

export const ideaStatus = pgEnum("idea_status", ["idea", "planned", "done"]);

// What KIND of maybe an idea is (#80 Q2 = A). Its OWN vocabulary, not a reuse
// of reservation_type: the shelf groups on Stay/Eat/Do and nothing else. The
// bridge into the DS's five-category language is ideaCategoryMeta in
// packages/ui/src/category.ts.
export const ideaCategory = pgEnum("idea_category", ["do", "eat", "stay"]);

// Lifecycle of a trip on the dashboard: actively planning, scheduled ahead, or done.
export const tripStatus = pgEnum("trip_status", ["planning", "upcoming", "complete"]);

// Places library shelves. One record, one status — want graduates to been.
export const savedPlaceStatus = pgEnum("saved_place_status", ["want", "been"]);

// What the rig IS, not what class it was picked from. The four rig classes on
// /rig (Class A / Class C / travel trailer / fifth wheel) are a presentation
// preset in @rv-trip/core (RIG_PRESETS) — they fill these fields and are not
// stored. See docs/design/9 §4 G5.
export const rigType = pgEnum("rig_type", ["motorhome", "trailer"]);

// What a CACHED route came from. One value on purpose: an "estimate" is an
// unfinished measurement (no rig, no credentials, or a failed vendor call), and
// caching one would poison the key for 30 days. See docs/design/43 §1 ④.
export const routeSource = pgEnum("route_source", ["here"]);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    homeBase: text("home_base"),
    // Home base as a real place (#60 Q4 → B). `home_base` stays the NAME; these
    // three are the anchor the planner's first-stop search biases to. Additive
    // and nullable — an existing trip keeps its string and simply has no anchor
    // until someone re-picks.
    homeBaseLat: doublePrecision("home_base_lat"),
    homeBaseLng: doublePrecision("home_base_lng"),
    homeBasePlaceId: text("home_base_place_id"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: tripStatus("status").notNull().default("planning"),
    // Whether `status` is derived from the dates at read (deriveTripStatus) or
    // pinned by hand. The override is the only thing stored about status.
    statusAuto: boolean("status_auto").notNull().default(true),
    // Trip-level "revisit" memory shown on the dashboard's Traveled cards.
    rating: smallint("rating"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("trips_owner_idx").on(t.ownerId)],
);

export const legs = pgTable(
  "legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("legs_trip_idx").on(t.tripId)],
);

export const stops = pgTable(
  "stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legId: uuid("leg_id")
      .notNull()
      .references(() => legs.id, { onDelete: "cascade" }),
    placeName: text("place_name").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    googlePlaceId: text("google_place_id"),
    // Optional dates: null => "floating" (sequence only); set => "scheduled".
    arriveDate: date("arrive_date"),
    departDate: date("depart_date"),
    sortOrder: integer("sort_order").notNull(),
    rating: smallint("rating"),
    notes: text("notes"),
  },
  (t) => [index("stops_leg_idx").on(t.legId)],
);

/**
 * An idea belongs to the TRIP; a stop is optional (#80).
 *
 * `trip_id` is NOT NULL for every idea, attached or not, and it is the single
 * ownership path every idea write scopes on — a NULL `stop_id` is in no
 * `ownedStopIds` list, so scoping through the stop would make every shelf
 * write a silent no-op on exactly the rows this epic exists to create.
 *
 * The one invariant no FK can span the join: when `stop_id` is set, that stop's
 * leg must belong to `trip_id`. `createIdea` proves it; nothing else may set
 * the pair.
 */
export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    // Null => a SHELF idea: a maybe not committed to a stop yet.
    stopId: uuid("stop_id").references(() => stops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Every idea shipped before #80 was a blue "Do", so that is the default the
    // backfill leaves them on.
    category: ideaCategory("category").notNull().default("do"),
    status: ideaStatus("status").notNull().default("idea"),
    placeName: text("place_name"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    googlePlaceId: text("google_place_id"),
    rating: smallint("rating"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("ideas_stop_idx").on(t.stopId), index("ideas_trip_idx").on(t.tripId)],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stopId: uuid("stop_id")
      .notNull()
      .references(() => stops.id, { onDelete: "cascade" }),
    // A reservation can be promoted from an idea; keep the link, don't require it.
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    type: reservationType("type").notNull(),
    name: text("name").notNull(),
    checkIn: date("check_in"),
    checkOut: date("check_out"),
    confirmationNumber: text("confirmation_number"),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    rating: smallint("rating"),
    notes: text("notes"),
  },
  (t) => [index("reservations_stop_idx").on(t.stopId)],
);

/**
 * The Places library. Account-scoped (ownerId), NOT trip-scoped — this is the
 * cross-trip backlog/archive a user plans from. A "been" place points back at
 * the trip it was visited on; that link goes null if the trip is deleted, the
 * place itself survives.
 */
export const savedPlaces = pgTable(
  "saved_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    region: text("region"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    googlePlaceId: text("google_place_id"),
    type: reservationType("type").notNull().default("other"),
    status: savedPlaceStatus("status").notNull().default("want"),
    note: text("note"),
    // "want" shelf only: free-text attribution for where the tip came from.
    source: text("source"),
    // "been" shelf only.
    rating: smallint("rating"),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("saved_places_owner_idx").on(t.ownerId)],
);

/**
 * The rig — ONE per account, and the routing input for every drive on every
 * trip. Owner-scoped like everything else; the unique constraint on owner_id is
 * what makes the upsert a real upsert.
 *
 * Dimensions are stored METRIC at millimetre precision (numeric, never float):
 * 11'6" is exactly 3.5052 m, so the imperial round-trip on /rig is lossless.
 * Whole centimetres are what the vendor is handed, never what we store.
 */
export const rigs = pgTable(
  "rigs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull().unique(),
    name: text("name").notNull(),
    type: rigType("type").notNull(),
    heightMeters: numeric("height_meters", { precision: 6, scale: 4 }).notNull(),
    widthMeters: numeric("width_meters", { precision: 6, scale: 4 }).notNull(),
    lengthMeters: numeric("length_meters", { precision: 6, scale: 4 }).notNull(),
    grossWeightKg: numeric("gross_weight_kg", { precision: 10, scale: 2 }).notNull(),
    propaneOnBoard: boolean("propane_on_board").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // No owner index: `.unique()` on owner_id already gives Postgres a btree, and
  // it is the only way this table is ever read. A second one is write cost for
  // nothing — the other tables index owner_id because theirs is NOT unique.
  () => [],
);

/**
 * The route cache (docs/design/43 §1). Today's cache is a module-scope Map in
 * apps/web/src/lib/routing.ts: per-instance on Vercel Functions and gone on
 * every cold start, so a deploy re-bills HERE for every drive on every open
 * trip. This table is the layer between that Map and the vendor.
 *
 * NO owner_id, on purpose: a route between two coordinates under a given
 * ROUTING hash is the same route for everyone — which is only true now that the
 * rig's name is out of the hash (core's `routingHash`, not `rigHash`).
 *
 * `result` is a RouteResult, verbatim, so RouteMap and the client contract are
 * untouched. TTL is a READ filter (fetched_at > now() - 30 days) and a stale
 * row is simply re-fetched and upserted — there is no sweeper in this epic;
 * routes_fetched_at_idx is here so the eventual cron or lazy delete is an
 * index-only follow-up rather than a migration.
 */
export const routes = pgTable(
  "routes",
  {
    /** `routeCacheKey(from, to, routingHash)` — core owns the format. */
    key: text("key").primaryKey(),
    result: jsonb("result").$type<RouteResult>().notNull(),
    /**
     * The (billable) Google corridor check for the SAME key — nullable, because
     * most rows have never been checked and a row is written by the route
     * fetch, not the check (docs/design/43 §4). Its own column rather than a
     * field inside `result`, so #29's contract — "the row IS a RouteResult,
     * verbatim" — stays literally true and RouteMap does not change shape. It
     * shares the row's `fetched_at`, hence the same 30-day TTL: a stale route
     * and a stale verdict expire together.
     *
     * Only ever set where `source = 'here'` — the validator needs a HERE
     * polyline to measure against.
     */
    nav: jsonb("nav").$type<NavCheck>(),
    source: routeSource("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("routes_fetched_at_idx").on(t.fetchedAt)],
);

/**
 * The Google enrichment cache (#82 Q3 → A) — the quiet "G ★ 4.6 · 812 · website
 * · call" line, remembered for 30 days.
 *
 * Modelled on `routes` above, deliberately: a text primary key, a `fetched_at`
 * with a 30-day TTL read as a FILTER (no sweeper), and an index on it so the
 * eventual cron is a follow-up rather than a migration.
 *
 * NOT owner-scoped — a real-world place is not anybody's, the same reason a
 * route between two coordinates isn't. The `google_place_id` columns on `stops`
 * (:115), `ideas` (:155) and `saved_places` (:199) are the join key, with NO
 * foreign key in either direction, because a place row is a CACHE: a missing one
 * must degrade to "no G-line", never to a broken read.
 *
 * Only the fields the G-line renders. Coordinates and the formatted address stay
 * on the rows that already carry them (the picker writes those through
 * `/api/places/search`), so this table never becomes a second, staler copy of a
 * place we already own.
 */
export const places = pgTable(
  "places",
  {
    googlePlaceId: text("google_place_id").primaryKey(),
    displayName: text("display_name").notNull(),
    /** GOOGLE's 0-5 float — not our integer `rating`. */
    rating: doublePrecision("rating"),
    userRatingCount: integer("user_rating_count"),
    websiteUri: text("website_uri"),
    nationalPhoneNumber: text("national_phone_number"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("places_fetched_at_idx").on(t.fetchedAt)],
);

/**
 * Preferences that follow the account (docs/design/45 §Q6, issue #38).
 *
 * ONE row per account and `owner_id` IS the primary key — the same
 * singleton-per-account shape `rigs` has (rigs.ownerId is a surrogate-keyed
 * table with `.unique()` on owner_id; here there is nothing else to key by, so
 * the owner is the key outright and the upsert conflicts on it directly).
 *
 * EVERY preference column is nullable on purpose: null means "never chosen", so
 * the product default still wins and no existing account needs a backfill row.
 * That is also why these are `text` rather than `pgEnum` — a preference is a
 * display choice each reader already narrows with a fallback, and a new map
 * style should not need an ALTER TYPE before the UI can offer it.
 *
 * No `created_at`: a preference row has no interesting birthday, only a last
 * word.
 */
export const userPrefs = pgTable("user_prefs", {
  ownerId: text("owner_id").primaryKey(),
  theme: text("theme"), // 'dark' | 'light'
  units: text("units"), // 'imperial' | 'metric'
  mapStyle: text("map_style"), // 'night' | 'day' | 'sat'
  trackCosts: boolean("track_costs"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The HOUSEHOLD — the tenant every `owner_id` above points at from #77 on
 * (docs/design/81 §2, Q1 = A, Q2 = A).
 *
 * Deliberately appended at the END of this file, after the four tables that
 * carry `owner_id`: nothing above it changes. Q2 = A is that the four owner
 * columns move by VALUE — a Clerk user id becomes a household id — with no DDL
 * on trips, saved_places, rigs or user_prefs. There is no foreign key from
 * those columns to `households.id` for the same reason: adding one would be
 * exactly the ALTER the survey ruled out, and it would also tie the route/test
 * fixtures' bare owner strings to a row that has to exist first.
 *
 * `id` is `text`, not `uuid`, because one household id is a literal the app
 * must be able to name without a key: the keyless dev tenant, seeded as
 * `dev-household` (seed.ts), which is what `getOwner()` answers when Clerk is
 * unconfigured so walks and the route tests stay key-free.
 */
export const households = pgTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("My household"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Who a member is TO the household. Two values, and no third is planned —
 * #77 keeps the v1 spec's group exclusion, so this is "who may not be removed"
 * and nothing more. `text` rather than a pgEnum (the user_prefs precedent at
 * :336): a role is read with a fallback everywhere, and a vocabulary this small
 * should not cost an ALTER TYPE to extend. `$type` keeps it narrow in TS. */
export type HouseholdRole = "owner" | "member";

/**
 * Membership. ONE ROW PER PERSON, ever — `user_id` is unique across the whole
 * table, which is the premise Q4 = A rests on: a person belongs to exactly one
 * household, so joining is a one-way door and no merge has to reconcile two
 * rigs (rigs.owner_id is `.unique()`, :226) or two prefs rows (user_prefs's
 * primary key, :336).
 *
 * The composite primary key `(household_id, user_id)` is the row's identity;
 * the separate index the design asks for on `user_id` IS the unique constraint,
 * declared as a named unique INDEX so there is one btree rather than two. The
 * lookup that matters — Clerk user id → household — rides it. (Same reasoning
 * as rigs' comment at :232: a second index on a unique column is write cost for
 * nothing.)
 */
export const householdMembers = pgTable(
  "household_members",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").$type<HouseholdRole>().notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    uniqueIndex("household_members_user_idx").on(t.userId),
  ],
);

/**
 * An invite is a LINK, not a mail (Q3 = B): one row becomes
 * `/join/<token>`, sent however the household already talks to each other.
 *
 * The token is the primary key because it IS the path segment — one row, one
 * URL, and a collision is impossible rather than merely unlikely. `redeemed_at`
 * is null until it is used, and that null is the whole of "one use": the join
 * path refuses a row that already carries a timestamp, and leaves it null when
 * it refuses for any other reason. `expires_at` is written by the creator
 * (created_at + 14 days) rather than defaulted in DDL, so the window is the
 * app's to state and to change.
 */
export const householdInvites = pgTable("household_invites", {
  token: text("token").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
});

/**
 * WHAT was changed, on a thing the household shares a voice on (#78 ·
 * docs/design/81 §6). Four entities, three fields — deliberately not an
 * every-write firehose: the four `update*Fields` mutations in mutations.ts are
 * the only writers, and they log only when a value actually moves.
 */
export const changeEntity = pgEnum("change_entity", [
  "stop",
  "idea",
  "reservation",
  "savedPlace",
]);

/**
 * The three shared-voice fields, as the LOG names them.
 *
 * `notes` is canonical even though `saved_places` spells its column `note`
 * (:204) — one vocabulary on the wire, or the /places byline could never match
 * the set it renders from. The mapping happens at the one write site
 * (`updateSavedPlaceFields`), never here.
 */
export const changeField = pgEnum("change_field", ["rating", "notes", "status"]);

/**
 * One row per changed field. Two reads consume it (§6): the newest row per
 * entity, joined onto the list read as `lastChange`, and the last five for one
 * entity behind `GET /api/history`.
 *
 * `household_id` is the tenant — `getOwner()` — and `member_id` is the PERSON —
 * `getActor()`. They are different strings from #77 on, and the whole feature
 * rests on the difference: the household owns the row, a member changed it.
 *
 * Neither carries a foreign key, for the same reason the four `owner_id`
 * columns do not (see `households` above): a household id is an opaque string
 * that need not have a row (the keyless `dev-household`, every route-test
 * fixture), and a member id is a Clerk user id that is only a member while they
 * are one — removing a co-pilot must not erase the history of what they wrote.
 *
 * `from`/`to` are plain `text` and nullable: one pair of columns carries a
 * smallint rating, a free-text note and an enum status, so the widest of the
 * three is the storage, and NULL is a genuinely absent value (an unrated stop,
 * a cleared note). A rating is written as its decimal digits ("4") and parsed
 * back by the reader that renders stars.
 */
export const changeLog = pgTable(
  "change_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: text("household_id").notNull(),
    entity: changeEntity("entity").notNull(),
    /** Every one of the four entities has a `uuid` primary key. */
    entityId: uuid("entity_id").notNull(),
    field: changeField("field").notNull(),
    from: text("from"),
    to: text("to"),
    memberId: text("member_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Both reads are "this entity's rows, newest first" — one btree serves the
    // joined `lastChange` and the five-row history alike.
    index("change_log_entity_idx").on(t.entity, t.entityId, t.at),
  ],
);

export const householdsRelations = relations(households, ({ many }) => ({
  members: many(householdMembers),
  invites: many(householdInvites),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
}));

export const householdInvitesRelations = relations(householdInvites, ({ one }) => ({
  household: one(households, { fields: [householdInvites.householdId], references: [households.id] }),
}));

export const tripsRelations = relations(trips, ({ many }) => ({
  legs: many(legs),
  savedPlaces: many(savedPlaces),
  // The shelf (#80). Every idea is here, attached or not; the read path filters
  // to `stop_id IS NULL` so the tree carries each row exactly once.
  ideas: many(ideas),
}));

export const savedPlacesRelations = relations(savedPlaces, ({ one }) => ({
  trip: one(trips, { fields: [savedPlaces.tripId], references: [trips.id] }),
}));

export const legsRelations = relations(legs, ({ one, many }) => ({
  trip: one(trips, { fields: [legs.tripId], references: [trips.id] }),
  stops: many(stops),
}));

export const stopsRelations = relations(stops, ({ one, many }) => ({
  leg: one(legs, { fields: [stops.legId], references: [legs.id] }),
  ideas: many(ideas),
  reservations: many(reservations),
}));

export const ideasRelations = relations(ideas, ({ one }) => ({
  trip: one(trips, { fields: [ideas.tripId], references: [trips.id] }),
  stop: one(stops, { fields: [ideas.stopId], references: [stops.id] }),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  stop: one(stops, { fields: [reservations.stopId], references: [stops.id] }),
  idea: one(ideas, { fields: [reservations.ideaId], references: [ideas.id] }),
}));
