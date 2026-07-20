import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  date,
  doublePrecision,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    homeBase: text("home_base"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
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

export const tripsRelations = relations(trips, ({ many }) => ({
  legs: many(legs),
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
