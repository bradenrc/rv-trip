CREATE TYPE "public"."idea_status" AS ENUM('idea', 'planned', 'done');--> statement-breakpoint
CREATE TYPE "public"."reservation_type" AS ENUM('campground', 'lodging', 'dining', 'event', 'tour', 'activity', 'transport', 'other');--> statement-breakpoint
CREATE TYPE "public"."rig_type" AS ENUM('motorhome', 'trailer');--> statement-breakpoint
CREATE TYPE "public"."saved_place_status" AS ENUM('want', 'been');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planning', 'upcoming', 'complete');--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "idea_status" DEFAULT 'idea' NOT NULL,
	"place_name" text,
	"lat" double precision,
	"lng" double precision,
	"google_place_id" text,
	"rating" smallint,
	"notes" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid NOT NULL,
	"idea_id" uuid,
	"type" "reservation_type" NOT NULL,
	"name" text NOT NULL,
	"check_in" date,
	"check_out" date,
	"confirmation_number" text,
	"cost" numeric(10, 2),
	"rating" smallint,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rigs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "rig_type" NOT NULL,
	"height_meters" numeric(6, 4) NOT NULL,
	"width_meters" numeric(6, 4) NOT NULL,
	"length_meters" numeric(6, 4) NOT NULL,
	"gross_weight_kg" numeric(10, 2) NOT NULL,
	"propane_on_board" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rigs_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"lat" double precision,
	"lng" double precision,
	"google_place_id" text,
	"type" "reservation_type" DEFAULT 'other' NOT NULL,
	"status" "saved_place_status" DEFAULT 'want' NOT NULL,
	"note" text,
	"source" text,
	"rating" smallint,
	"trip_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leg_id" uuid NOT NULL,
	"place_name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"google_place_id" text,
	"arrive_date" date,
	"depart_date" date,
	"sort_order" integer NOT NULL,
	"rating" smallint,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"home_base" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "trip_status" DEFAULT 'planning' NOT NULL,
	"status_auto" boolean DEFAULT true NOT NULL,
	"rating" smallint,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_leg_id_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_stop_idx" ON "ideas" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "legs_trip_idx" ON "legs" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "reservations_stop_idx" ON "reservations" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "saved_places_owner_idx" ON "saved_places" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "stops_leg_idx" ON "stops" USING btree ("leg_id");--> statement-breakpoint
CREATE INDEX "trips_owner_idx" ON "trips" USING btree ("owner_id");