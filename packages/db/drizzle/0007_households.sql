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
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
-- ── the backfill (docs/design/81 §2, Q2 = A) ─────────────────────────────────
-- Every existing owner becomes a one-member household, and the four owner_id
-- columns are REPOINTED IN PLACE: a value swap, no DDL, no foreign key. The
-- four are trips, saved_places, rigs and user_prefs — reown.ts re-owned only
-- three, and a migrated account that lost user_prefs would silently lose its
-- theme, units and map style.
--
-- A DO block rather than four set-based statements because the new household id
-- has to be carried from the INSERT into the member row and into all four
-- UPDATEs; gen_random_uuid() cannot be correlated back across statements. One
-- statement, inside the migrator's transaction, deterministic for dev-user.
DO $$
DECLARE
  o RECORD;
  hid text;
BEGIN
  FOR o IN
    SELECT DISTINCT owner_id FROM (
      SELECT owner_id FROM trips
      UNION SELECT owner_id FROM saved_places
      UNION SELECT owner_id FROM rigs
      UNION SELECT owner_id FROM user_prefs
    ) owners
  LOOP
    -- The keyless dev tenant keeps a name the app can say without a key; every
    -- real account gets an opaque id (seed.ts seeds the same literal).
    hid := CASE WHEN o.owner_id = 'dev-user' THEN 'dev-household' ELSE gen_random_uuid()::text END;

    INSERT INTO households (id, name) VALUES (hid, 'My household');
    INSERT INTO household_members (household_id, user_id, role) VALUES (hid, o.owner_id, 'owner');

    UPDATE trips SET owner_id = hid WHERE owner_id = o.owner_id;
    UPDATE saved_places SET owner_id = hid WHERE owner_id = o.owner_id;
    UPDATE rigs SET owner_id = hid WHERE owner_id = o.owner_id;
    UPDATE user_prefs SET owner_id = hid WHERE owner_id = o.owner_id;
  END LOOP;
END $$;
