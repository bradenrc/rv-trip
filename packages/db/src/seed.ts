import "./load-env";
import { db, schema } from "./index";
import { sql } from "drizzle-orm";

const OWNER = "dev-user";

async function main() {
  console.log("Seeding sample trip…");

  // Clean slate (dev only). Cascades handle children.
  await db.execute(sql`truncate table ${schema.trips} restart identity cascade`);

  const [trip] = await db
    .insert(schema.trips)
    .values({
      ownerId: OWNER,
      title: "Pacific Northwest Loop",
      homeBase: "Boise, ID",
      startDate: "2026-08-01",
      endDate: "2026-08-28",
    })
    .returning();

  const [legCoast, legMountains] = await db
    .insert(schema.legs)
    .values([
      { tripId: trip!.id, title: "Oregon Coast", sortOrder: 0 },
      { tripId: trip!.id, title: "Cascades & Home", sortOrder: 1 },
    ])
    .returning();

  // Scheduled stops (with dates) + one floating stop (no dates -> route only).
  const [astoria, newport, bend, floatingCrater] = await db
    .insert(schema.stops)
    .values([
      {
        legId: legCoast!.id,
        placeName: "Astoria, OR",
        lat: 46.1879,
        lng: -123.8313,
        arriveDate: "2026-08-02",
        departDate: "2026-08-05",
        sortOrder: 0,
        rating: 5,
        notes: "Loved the riverwalk. Book the same RV park next time.",
      },
      {
        legId: legCoast!.id,
        placeName: "Newport, OR",
        lat: 44.6365,
        lng: -124.053,
        arriveDate: "2026-08-05",
        departDate: "2026-08-09",
        sortOrder: 1,
        rating: 4,
        notes: null,
      },
      {
        legId: legMountains!.id,
        placeName: "Bend, OR",
        lat: 44.0582,
        lng: -121.3153,
        arriveDate: "2026-08-12",
        departDate: "2026-08-16",
        sortOrder: 0,
        rating: null,
        notes: null,
      },
      {
        legId: legMountains!.id,
        placeName: "Crater Lake NP",
        lat: 42.9446,
        lng: -122.109,
        arriveDate: null,
        departDate: null,
        sortOrder: 1,
        rating: null,
        notes: "Maybe on the way home if we have time — take it as it comes.",
      },
    ])
    .returning();

  await db.insert(schema.reservations).values([
    {
      stopId: astoria!.id,
      type: "campground",
      name: "Astoria/Warrenton KOA",
      checkIn: "2026-08-02",
      checkOut: "2026-08-05",
      confirmationNumber: "KOA-88213",
      cost: "204.00",
      rating: 5,
      notes: "Full hookups, site A12 backs to the trees.",
    },
    {
      stopId: newport!.id,
      type: "campground",
      name: "South Beach State Park",
      checkIn: "2026-08-05",
      checkOut: "2026-08-09",
      confirmationNumber: "ORP-40192",
      cost: "160.00",
      rating: 4,
      notes: null,
    },
    {
      stopId: astoria!.id,
      type: "tour",
      name: "Columbia River Maritime Museum",
      checkIn: "2026-08-03",
      checkOut: null,
      confirmationNumber: null,
      cost: "38.00",
      rating: null,
      notes: null,
    },
  ]);

  await db.insert(schema.ideas).values([
    {
      stopId: newport!.id,
      title: "Oregon Coast Aquarium",
      status: "planned",
      rating: null,
      notes: "Half day. Go early to beat crowds.",
      sortOrder: 0,
    },
    {
      stopId: newport!.id,
      title: "Rogue Ales brewery lunch",
      status: "idea",
      rating: null,
      notes: null,
      sortOrder: 1,
    },
    {
      stopId: bend!.id,
      title: "Deschutes River float",
      status: "idea",
      rating: null,
      notes: null,
      sortOrder: 0,
    },
    {
      stopId: floatingCrater!.id,
      title: "Rim Drive scenic loop",
      status: "idea",
      rating: null,
      notes: null,
      sortOrder: 0,
    },
  ]);

  console.log(`Seeded trip ${trip!.id} ("${trip!.title}").`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
