CREATE TABLE "trip_dismissed_saves" (
	"trip_id" uuid NOT NULL,
	"save_id" uuid NOT NULL,
	CONSTRAINT "trip_dismissed_saves_trip_id_save_id_pk" PRIMARY KEY("trip_id","save_id")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "surface_radius_mi" smallint;--> statement-breakpoint
ALTER TABLE "trip_dismissed_saves" ADD CONSTRAINT "trip_dismissed_saves_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_dismissed_saves" ADD CONSTRAINT "trip_dismissed_saves_save_id_saves_id_fk" FOREIGN KEY ("save_id") REFERENCES "public"."saves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_surface_radius_mi_ck" CHECK ("trips"."surface_radius_mi" IN (25, 50, 100, 200));