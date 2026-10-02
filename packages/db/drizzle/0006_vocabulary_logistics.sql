-- #155 · Q5 B — the full vocabulary rename, plus Q1 A (optional chapters) and
-- Q4 A (reservations.transport_kind). Hand-written: roadvalet.com is live on
-- Neon, so every step is an ALTER … RENAME (never a drop and create), and
-- drizzle-kit generate would only prompt for these renames interactively.
-- ORDER MATTERS: the name "destinations" is taken until step 1 has run.

-- 1 · destinations → areas (the trip-level locality a household plans toward)
ALTER TABLE "destinations" RENAME TO "areas";--> statement-breakpoint
ALTER INDEX "destinations_pkey" RENAME TO "areas_pkey";--> statement-breakpoint
ALTER TABLE "areas" RENAME CONSTRAINT "destinations_owner_place_uq" TO "areas_owner_place_uq";--> statement-breakpoint
ALTER TABLE "trips" RENAME COLUMN "destination_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "trips" RENAME CONSTRAINT "trips_destination_id_destinations_id_fk" TO "trips_area_id_areas_id_fk";--> statement-breakpoint
ALTER TABLE "saves" RENAME COLUMN "destination_id" TO "area_id";--> statement-breakpoint
ALTER TABLE "saves" RENAME CONSTRAINT "saves_destination_id_destinations_id_fk" TO "saves_area_id_areas_id_fk";--> statement-breakpoint

-- 2 · stops → destinations (an itinerary entry)
ALTER TABLE "stops" RENAME TO "destinations";--> statement-breakpoint
ALTER INDEX "stops_pkey" RENAME TO "destinations_pkey";--> statement-breakpoint
ALTER TABLE "destinations" RENAME COLUMN "leg_id" TO "chapter_id";--> statement-breakpoint
ALTER INDEX "stops_leg_idx" RENAME TO "destinations_chapter_idx";--> statement-breakpoint
ALTER TABLE "reservations" RENAME COLUMN "stop_id" TO "destination_id";--> statement-breakpoint
ALTER INDEX "reservations_stop_idx" RENAME TO "reservations_destination_idx";--> statement-breakpoint
ALTER TABLE "reservations" RENAME CONSTRAINT "reservations_stop_id_stops_id_fk" TO "reservations_destination_id_destinations_id_fk";--> statement-breakpoint
ALTER TABLE "ideas" RENAME COLUMN "stop_id" TO "destination_id";--> statement-breakpoint
ALTER INDEX "ideas_stop_idx" RENAME TO "ideas_destination_idx";--> statement-breakpoint
ALTER TABLE "ideas" RENAME CONSTRAINT "ideas_stop_id_stops_id_fk" TO "ideas_destination_id_destinations_id_fk";--> statement-breakpoint
ALTER TABLE "travel_segments" RENAME COLUMN "from_stop_id" TO "from_destination_id";--> statement-breakpoint
ALTER TABLE "travel_segments" RENAME COLUMN "to_stop_id" TO "to_destination_id";--> statement-breakpoint
ALTER TABLE "travel_segments" RENAME CONSTRAINT "travel_segments_from_stop_id_stops_id_fk" TO "travel_segments_from_destination_id_destinations_id_fk";--> statement-breakpoint
ALTER TABLE "travel_segments" RENAME CONSTRAINT "travel_segments_to_stop_id_stops_id_fk" TO "travel_segments_to_destination_id_destinations_id_fk";--> statement-breakpoint

-- 3 · legs → chapters; the title goes optional (Q1 A), and the auto-numbered
-- "Leg N" titles every trip was seeded with become unnamed chapters
ALTER TABLE "legs" RENAME TO "chapters";--> statement-breakpoint
ALTER INDEX "legs_pkey" RENAME TO "chapters_pkey";--> statement-breakpoint
ALTER INDEX "legs_trip_idx" RENAME TO "chapters_trip_idx";--> statement-breakpoint
ALTER TABLE "chapters" RENAME CONSTRAINT "legs_trip_id_trips_id_fk" TO "chapters_trip_id_trips_id_fk";--> statement-breakpoint
ALTER TABLE "destinations" RENAME CONSTRAINT "stops_leg_id_legs_id_fk" TO "destinations_chapter_id_chapters_id_fk";--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "title" DROP NOT NULL;--> statement-breakpoint
UPDATE "chapters" SET "title" = NULL WHERE "title" ~ '^Leg [0-9]+$';--> statement-breakpoint

-- 4 · the change log's entity names the new noun
ALTER TYPE "public"."change_entity" RENAME VALUE 'stop' TO 'destination';--> statement-breakpoint

-- 5 · what a transport booking IS (Q4 A) — nullable: null reads as the hop's mode
CREATE TYPE "public"."transport_kind" AS ENUM('flight', 'ferry', 'shuttle', 'train', 'car');--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "transport_kind" "transport_kind";
