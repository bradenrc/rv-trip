ALTER TABLE "destinations" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "saves" ADD COLUMN "suggested_place" jsonb;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_owner_client_uq" UNIQUE("owner_id","client_id");