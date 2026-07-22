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
      status: "planning",
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

  // ── more trips across the dashboard's statuses ───────────────────────────
  await addTrip(
    {
      title: "Desert Southwest Winter",
      homeBase: "Boise, ID",
      startDate: "2026-01-06",
      endDate: "2026-03-30",
      status: "upcoming",
    },
    [
      {
        title: "Utah",
        stops: [
          { placeName: "Moab, UT", lat: 38.5733, lng: -109.5498, arriveDate: "2026-01-10", departDate: "2026-01-20" },
          { placeName: "Zion NP", lat: 37.2982, lng: -113.0263, arriveDate: null, departDate: null },
        ],
      },
      {
        title: "Arizona",
        stops: [
          { placeName: "Sedona, AZ", lat: 34.8697, lng: -111.761, arriveDate: "2026-01-25", departDate: "2026-02-05" },
          { placeName: "Tucson, AZ", lat: 32.2226, lng: -110.9747, arriveDate: "2026-02-10", departDate: "2026-03-01" },
        ],
      },
    ],
  );

  const coastTrip = await addTrip(
    {
      title: "Oregon Coast Weekend",
      homeBase: "Boise, ID",
      startDate: "2025-05-23",
      endDate: "2025-05-26",
      status: "complete",
      rating: 5,
      note: "South Beach yurts booked early next time — sunset walks were the whole trip.",
    },
    [
      {
        title: "Coast",
        stops: [
          { placeName: "Newport, OR", lat: 44.6365, lng: -124.053, arriveDate: "2025-05-23", departDate: "2025-05-26" },
        ],
      },
    ],
  );

  const ystoneTrip = await addTrip(
    {
      title: "Yellowstone & Tetons",
      homeBase: "Boise, ID",
      startDate: "2024-09-08",
      endDate: "2024-09-19",
      status: "complete",
      rating: 4,
      note: "Fishing Bridge RV park is the only full-hookup in-park — worth the early reservation.",
    },
    [
      {
        title: "Yellowstone",
        stops: [
          { placeName: "Fishing Bridge, WY", lat: 44.5647, lng: -110.3735, arriveDate: "2024-09-08", departDate: "2024-09-14" },
        ],
      },
      {
        title: "Tetons",
        stops: [
          { placeName: "Jackson, WY", lat: 43.4799, lng: -110.7624, arriveDate: "2024-09-15", departDate: "2024-09-19" },
        ],
      },
    ],
  );

  // ── Places library: the cross-trip queue + archive ────────────────────────
  // "want" carries a source (where the tip came from); "been" carries a rating
  // and the trip it was visited on.
  await db.insert(schema.savedPlaces).values([
    {
      ownerId: OWNER,
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
      name: "South Beach State Park",
      region: "Newport, OR",
      lat: 44.6094,
      lng: -124.0631,
      type: "campground",
      status: "been",
      rating: 5,
      tripId: coastTrip.id,
      note: "Yurts are the move — book early next time. Sunset walks were the whole trip.",
    },
    {
      ownerId: OWNER,
      name: "Local Ocean Seafoods",
      region: "Newport, OR",
      lat: 44.6297,
      lng: -124.0526,
      type: "dining",
      status: "been",
      rating: 5,
      tripId: coastTrip.id,
      note: "Bayfront, watch the boats. Go before 6 or wait an hour.",
    },
    {
      ownerId: OWNER,
      name: "Fishing Bridge RV Park",
      region: "Yellowstone NP, WY",
      lat: 44.5647,
      lng: -110.3735,
      type: "campground",
      status: "been",
      rating: 4,
      tripId: ystoneTrip.id,
      note: "Only full-hookup in-park. Worth the early reservation; tight but level.",
    },
    {
      ownerId: OWNER,
      name: "Old Faithful Loop",
      region: "Yellowstone NP, WY",
      lat: 44.4605,
      lng: -110.8281,
      type: "activity",
      status: "been",
      rating: 4,
      tripId: ystoneTrip.id,
      note: "Beat the crowd — first eruption after opening. Biscuit Basin boardwalk was quieter.",
    },
  ]);

  console.log(`Seeded ${trip!.title} + 3 more trips + 8 saved places.`);
  process.exit(0);
}

type SeedStop = {
  placeName: string;
  lat: number | null;
  lng: number | null;
  arriveDate: string | null;
  departDate: string | null;
};
async function addTrip(
  t: {
    title: string;
    homeBase: string;
    startDate: string;
    endDate: string;
    status: "planning" | "upcoming" | "complete";
    rating?: number;
    note?: string;
  },
  legs: { title: string; stops: SeedStop[] }[],
) {
  const [trip] = await db.insert(schema.trips).values({ ownerId: OWNER, ...t }).returning();
  for (let li = 0; li < legs.length; li++) {
    const [leg] = await db
      .insert(schema.legs)
      .values({ tripId: trip!.id, title: legs[li]!.title, sortOrder: li })
      .returning();
    const stops = legs[li]!.stops;
    if (stops.length) {
      await db.insert(schema.stops).values(stops.map((s, i) => ({ legId: leg!.id, sortOrder: i, ...s })));
    }
  }
  return trip!;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
