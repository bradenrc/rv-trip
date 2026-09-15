CREATE TYPE "public"."idea_category" AS ENUM('do', 'eat', 'stay');--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "stop_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
UPDATE "ideas" AS i SET "trip_id" = l."trip_id" FROM "stops" AS s JOIN "legs" AS l ON l."id" = s."leg_id" WHERE s."id" = i."stop_id";--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "category" "idea_category" DEFAULT 'do' NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_trip_idx" ON "ideas" USING btree ("trip_id");