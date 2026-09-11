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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { RouteResult } from "@rv-trip/core";

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

export const ideas = pgTable(
  "ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stopId: uuid("stop_id")
      .notNull()
      .references(() => stops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: ideaStatus("status").notNull().default("idea"),
    placeName: text("place_name"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    googlePlaceId: text("google_place_id"),
    rating: smallint("rating"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [index("ideas_stop_idx").on(t.stopId)],
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
    source: routeSource("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("routes_fetched_at_idx").on(t.fetchedAt)],
);

export const tripsRelations = relations(trips, ({ many }) => ({
  legs: many(legs),
  savedPlaces: many(savedPlaces),
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
  stop: one(stops, { fields: [ideas.stopId], references: [stops.id] }),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  stop: one(stops, { fields: [reservations.stopId], references: [stops.id] }),
  idea: one(ideas, { fields: [reservations.ideaId], references: [ideas.id] }),
}));
