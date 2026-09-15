CREATE TABLE "places" (
	"google_place_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"rating" double precision,
	"user_rating_count" integer,
	"website_uri" text,
	"national_phone_number" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "places_fetched_at_idx" ON "places" USING btree ("fetched_at");