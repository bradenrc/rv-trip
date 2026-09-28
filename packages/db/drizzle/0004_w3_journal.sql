ALTER TYPE "public"."change_field" ADD VALUE 'again';--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "again" boolean;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "again" boolean;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "again" boolean;--> statement-breakpoint
ALTER TABLE "stops" ADD COLUMN "again" boolean;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_trip_client_uq" UNIQUE("trip_id","client_id");