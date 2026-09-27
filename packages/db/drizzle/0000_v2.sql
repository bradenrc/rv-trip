CREATE TYPE "public"."change_entity" AS ENUM('stop', 'idea', 'reservation', 'save');--> statement-breakpoint
CREATE TYPE "public"."change_field" AS ENUM('rating', 'notes', 'status');--> statement-breakpoint
CREATE TYPE "public"."idea_category" AS ENUM('do', 'eat', 'stay');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('idea', 'planned', 'done');--> statement-breakpoint
CREATE TYPE "public"."lodging_kind" AS ENUM('hotel', 'friends', 'airbnb', 'campground');--> statement-breakpoint
CREATE TYPE "public"."reservation_type" AS ENUM('campground', 'lodging', 'dining', 'event', 'tour', 'activity', 'transport', 'other');--> statement-breakpoint
CREATE TYPE "public"."rig_type" AS ENUM('motorhome', 'trailer');--> statement-breakpoint
CREATE TYPE "public"."route_source" AS ENUM('here');--> statement-breakpoint
CREATE TYPE "public"."save_anchor" AS ENUM('place', 'area', 'pin');--> statement-breakpoint
CREATE TYPE "public"."save_status" AS ENUM('want', 'been');--> statement-breakpoint
CREATE TYPE "public"."travel_mode" AS ENUM('drive', 'fly', 'ferry');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('planning', 'upcoming', 'complete');--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" text NOT NULL,
	"entity" "change_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" "change_field" NOT NULL,
	"from" text,
	"to" text,
	"member_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"google_place_id" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destinations_owner_place_uq" UNIQUE("owner_id","google_place_id")
);
--> statement-breakpoint
CREATE TABLE "household_invites" (
	"token" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'My household' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"stop_id" uuid,
	"title" text NOT NULL,
	"category" "idea_category" DEFAULT 'do' NOT NULL,
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
CREATE TABLE "places" (
	"google_place_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"rating" double precision,
	"user_rating_count" integer,
	"website_uri" text,
	"national_phone_number" text,
	"google_maps_uri" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stop_id" uuid,
	"segment_id" uuid,
	"idea_id" uuid,
	"type" "reservation_type" NOT NULL,
	"name" text NOT NULL,
	"check_in" date,
	"check_out" date,
	"confirmation_number" text,
	"cost" numeric(10, 2),
	"rating" smallint,
	"notes" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"starts_tz" text,
	"ends_tz" text,
	CONSTRAINT "reservations_one_parent" CHECK (num_nonnulls("reservations"."stop_id", "reservations"."segment_id") = 1)
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
CREATE TABLE "routes" (
	"key" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"nav" jsonb,
	"source" "route_source" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"anchor" "save_anchor" NOT NULL,
	"area_label" text,
	"lat" double precision,
	"lng" double precision,
	"google_place_id" text,
	"destination_id" uuid,
	"type" "reservation_type" DEFAULT 'other' NOT NULL,
	"status" "save_status" DEFAULT 'want' NOT NULL,
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
CREATE TABLE "travel_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_stop_id" uuid,
	"to_stop_id" uuid,
	"mode" "travel_mode" NOT NULL,
	"depart_at" timestamp with time zone,
	"arrive_at" timestamp with time zone,
	"depart_tz" text,
	"arrive_tz" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"home_base" text,
	"home_base_lat" double precision,
	"home_base_lng" double precision,
	"home_base_place_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "trip_status" DEFAULT 'planning' NOT NULL,
	"status_auto" boolean DEFAULT true NOT NULL,
	"rating" smallint,
	"note" text,
	"default_mode" "travel_mode" DEFAULT 'drive' NOT NULL,
	"lodging_default" "lodging_kind",
	"rig_on" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"theme" text,
	"units" text,
	"map_style" text,
	"track_costs" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_stop_id_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_segment_id_travel_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."travel_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_leg_id_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_segments" ADD CONSTRAINT "travel_segments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_segments" ADD CONSTRAINT "travel_segments_from_stop_id_stops_id_fk" FOREIGN KEY ("from_stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_segments" ADD CONSTRAINT "travel_segments_to_stop_id_stops_id_fk" FOREIGN KEY ("to_stop_id") REFERENCES "public"."stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ideas_stop_idx" ON "ideas" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "ideas_trip_idx" ON "ideas" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "legs_trip_idx" ON "legs" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "places_fetched_at_idx" ON "places" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "reservations_stop_idx" ON "reservations" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "reservations_segment_idx" ON "reservations" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "routes_fetched_at_idx" ON "routes" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "saves_owner_idx" ON "saves" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "stops_leg_idx" ON "stops" USING btree ("leg_id");--> statement-breakpoint
CREATE INDEX "travel_segments_trip_idx" ON "travel_segments" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trips_owner_idx" ON "trips" USING btree ("owner_id");