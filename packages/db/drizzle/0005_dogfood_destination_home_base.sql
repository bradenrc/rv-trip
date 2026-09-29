ALTER TABLE "trips" ADD COLUMN "destination_id" uuid;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD COLUMN "home_base" text;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD COLUMN "home_base_lat" double precision;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD COLUMN "home_base_lng" double precision;--> statement-breakpoint
ALTER TABLE "user_prefs" ADD COLUMN "home_base_place_id" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;