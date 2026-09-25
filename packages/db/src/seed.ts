import "./load-env";
import { db, schema } from "./index";
import { sql } from "drizzle-orm";
import { seedTrips } from "@rv-trip/core/seeds";
import type { Trip } from "@rv-trip/core";

/**
 * The keyless dev tenant (#77 · docs/design/81 §2). From #77 on `owner_id` is a
 * HOUSEHOLD id, not a person's — so the seed's rows belong to `dev-household`,
 * the stable literal migration 0007's backfill also mints for `dev-user`, and
 * `dev-user` is a member of it rather than an owner of rows.
 *
 * Stable and spelled out rather than generated: a keyless `getOwner()` has to
 * be able to answer it without a database lookup and without a Clerk key, which
 * is what keeps walks and the apps/web route tests key-free.
 */
const HOUSEHOLD = "dev-household";
const MEMBER = "dev-user";
const OWNER = HOUSEHOLD;

async function main() {
  console.log("Seeding sample trips…");

  // Clean slate (dev only). Cascades handle children.
  await db.execute(sql`truncate table ${schema.trips} restart identity cascade`);

  // The household the seeded rows belong to. `onConflictDoNothing` on both, so
  // re-seeding never mints a second household and never trips `user_id`'s
  // unique index — the tenancy survives a truncate that only clears trips.
  await db.insert(schema.households).values({ id: HOUSEHOLD }).onConflictDoNothing();
  await db
    .insert(schema.householdMembers)
    .values({ householdId: HOUSEHOLD, userId: MEMBER, role: "owner" })
    .onConflictDoNothing();

  // The trips are PURE DATA in @rv-trip/core/seeds (#110 §7) — the same objects
  // the core tests assert day by day and check for zero segment conflicts. Here
  // each local id ("stp_conchal", "seg_out") is mapped to the uuid its insert
  // returns.
  const ids = new Map<string, string>();
  const trips = seedTrips();
  for (const t of trips) await writeTrip(t, ids);
  await db.execute(sql`delete from ${schema.saves} where ${schema.saves.ownerId} = ${OWNER}`);

  // ── Places library: the cross-trip queue + archive ────────────────────────
  // "want" carries a source (where the tip came from); "been" carries a rating
  // and the trip it was visited on.
  await db.insert(schema.saves).values([
    {
      ownerId: OWNER,
      // Every library row carries lat/lng and no Place ID → a pin (#110 §5).
      anchor: "pin",
      name: "Kalaloch Campground",
      region: "Olympic NP, WA",
      lat: 47.6118,
      lng: -124.3762,
      type: "campground",
      status: "want",
      source: "Jane & Rick",
      note: "Bluff sites right over the beach — they said book site A15 for the sunset.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Sunny's Smokehouse",
      region: "Bend, OR",
      lat: 44.0582,
      lng: -121.3153,
      type: "dining",
      status: "want",
      source: "Forum tip",
      note: "Brisket sells out by 2pm. Big lot, easy pull-through parking for the rig.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Crater Lake Rim Drive",
      region: "Crater Lake NP, OR",
      lat: 42.9446,
      lng: -122.1090,
      type: "activity",
      status: "want",
      source: "Marcy",
      note: "Do it clockwise early; east rim closes late season. Watanabe overlook is the one.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Flying J — Ontario",
      region: "Ontario, OR",
      lat: 44.0266,
      lng: -116.9629,
      type: "transport",
      status: "want",
      source: "Range planning",
      note: "Good midpoint fuel + dump on the I-84 run west. Wide lanes.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "South Beach State Park",
      region: "Newport, OR",
      lat: 44.6094,
      lng: -124.0631,
      type: "campground",
      status: "been",
      rating: 5,
      tripId: ids.get("trip_coast")!,
      note: "Yurts are the move — book early next time. Sunset walks were the whole trip.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Local Ocean Seafoods",
      region: "Newport, OR",
      lat: 44.6297,
      lng: -124.0526,
      type: "dining",
      status: "been",
      rating: 5,
      tripId: ids.get("trip_coast")!,
      note: "Bayfront, watch the boats. Go before 6 or wait an hour.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Fishing Bridge RV Park",
      region: "Yellowstone NP, WY",
      lat: 44.5647,
      lng: -110.3735,
      type: "campground",
      status: "been",
      rating: 4,
      tripId: ids.get("trip_ystone")!,
      note: "Only full-hookup in-park. Worth the early reservation; tight but level.",
    },
    {
      ownerId: OWNER,
      anchor: "pin",
      name: "Old Faithful Loop",
      region: "Yellowstone NP, WY",
      lat: 44.4605,
      lng: -110.8281,
      type: "activity",
      status: "been",
      rating: 4,
      tripId: ids.get("trip_ystone")!,
      note: "Beat the crowd — first eruption after opening. Biscuit Basin boardwalk was quieter.",
    },
  ]);

  console.log(`Seeded ${trips.length} trips + 8 saves.`);
  process.exit(0);
}

const instant = (v: string | null) => (v === null ? null : new Date(v));

/** One seed trip, top to bottom: trip → legs → stops → segments → paperwork. */
async function writeTrip(t: Trip, ids: Map<string, string>) {
  const [trip] = await db
    .insert(schema.trips)
    .values({
      ownerId: OWNER,
      title: t.title,
      homeBase: t.homeBase,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      statusAuto: t.statusAuto,
      rating: t.rating,
      note: t.note,
      defaultMode: t.defaultMode,
      lodgingDefault: t.lodgingDefault,
      rigOn: t.rigOn,
    })
    .returning();
  ids.set(t.id, trip!.id);
  const id = (local: string | null) => (local === null ? null : ids.get(local)!);

  for (const l of t.legs) {
    const [leg] = await db
      .insert(schema.legs)
      .values({ tripId: trip!.id, title: l.title, sortOrder: l.sortOrder })
      .returning();
    ids.set(l.id, leg!.id);
    for (const s of l.stops) {
      const [stop] = await db
        .insert(schema.stops)
        .values({
          legId: leg!.id,
          placeName: s.place.name,
          lat: s.place.lat,
          lng: s.place.lng,
          googlePlaceId: s.place.googlePlaceId,
          arriveDate: s.arriveDate,
          departDate: s.departDate,
          sortOrder: s.sortOrder,
          rating: s.rating,
          notes: s.notes,
        })
        .returning();
      ids.set(s.id, stop!.id);
    }
  }

  for (const seg of t.segments) {
    const [row] = await db
      .insert(schema.travelSegments)
      .values({
        tripId: trip!.id,
        fromStopId: id(seg.fromStopId),
        toStopId: id(seg.toStopId),
        mode: seg.mode,
        departAt: instant(seg.departAt),
        arriveAt: instant(seg.arriveAt),
        departTz: seg.departTz,
        arriveTz: seg.arriveTz,
        sortOrder: seg.sortOrder,
      })
      .returning();
    ids.set(seg.id, row!.id);
  }

  const stops = t.legs.flatMap((l) => l.stops);
  const paperwork = [
    ...stops.flatMap((s) => s.reservations),
    ...t.segments.flatMap((s) => s.reservations),
  ];
  if (paperwork.length > 0) {
    await db.insert(schema.reservations).values(
      paperwork.map((r) => ({
        stopId: id(r.stopId),
        segmentId: id(r.segmentId),
        type: r.type,
        name: r.name,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        confirmationNumber: r.confirmationNumber,
        cost: r.cost === null ? null : r.cost.toFixed(2),
        rating: r.rating,
        notes: r.notes,
        startsAt: instant(r.startsAt),
        endsAt: instant(r.endsAt),
        startsTz: r.startsTz,
        endsTz: r.endsTz,
      })),
    );
  }

  const ideas = [...stops.flatMap((s) => s.ideas), ...t.ideas];
  if (ideas.length > 0) {
    await db.insert(schema.ideas).values(
      ideas.map((i) => ({
        tripId: trip!.id,
        stopId: id(i.stopId),
        title: i.title,
        category: i.category,
        status: i.status,
        placeName: i.place?.name ?? null,
        lat: i.place?.lat ?? null,
        lng: i.place?.lng ?? null,
        googlePlaceId: i.place?.googlePlaceId ?? null,
        rating: i.rating,
        notes: i.notes,
        sortOrder: i.sortOrder,
      })),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
