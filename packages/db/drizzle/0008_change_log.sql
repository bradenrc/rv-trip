CREATE TYPE "public"."change_entity" AS ENUM('stop', 'idea', 'reservation', 'savedPlace');--> statement-breakpoint
CREATE TYPE "public"."change_field" AS ENUM('rating', 'notes', 'status');--> statement-breakpoint
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
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity","entity_id","at");