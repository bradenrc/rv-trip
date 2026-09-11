CREATE TYPE "public"."route_source" AS ENUM('here');--> statement-breakpoint
CREATE TABLE "routes" (
	"key" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"source" "route_source" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "routes_fetched_at_idx" ON "routes" USING btree ("fetched_at");