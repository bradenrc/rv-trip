CREATE TABLE "user_prefs" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"theme" text,
	"units" text,
	"map_style" text,
	"track_costs" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
