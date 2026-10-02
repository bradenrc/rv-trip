import "./load-env";
import { db, schema } from "./index";
import { sql } from "drizzle-orm";
import { seedAreas, seedSaves, seedTrips } from "@rv-trip/core/seeds";
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
  await db.execute(sql`delete from ${schema.saves} where ${schema.saves.ownerId} = ${OWNER}`);
  await db.execute(
    sql`delete from ${schema.areas} where ${schema.areas.ownerId} = ${OWNER}`,
  );

  // ── Saves: the cross-trip queue + archive, grouped by area (#111 i2) ─
  // PURE DATA in @rv-trip/core/seeds (saves.ts), judged in seeds.test.ts — the
  // walk's Saves tab. Areas first, so each save — and (#155 · Q2 A) a trip's
  // own area — can point at its row.
  const destIds = new Map<string, string>();
  const dests = await db
    .insert(schema.areas)
    .values(
      seedAreas().map((d) => ({
        ownerId: OWNER,
        googlePlaceId: d.googlePlaceId,
        name: d.name,
        region: d.region,
        lat: d.lat,
        lng: d.lng,
      })),
    )
    .returning();
  for (const d of seedAreas()) {
    destIds.set(d.key, dests.find((r) => r.googlePlaceId === d.googlePlaceId)!.id);
  }
  const areaIdByPlace = new Map(dests.map((r) => [r.googlePlaceId, r.id]));
  for (const t of trips) await writeTrip(t, ids, areaIdByPlace);
  const saves = seedSaves();
  await db.insert(schema.saves).values(
    saves.map((s) => ({
      ownerId: OWNER,
      name: s.name,
      region: s.region,
      anchor: s.anchor,
      areaLabel: s.areaLabel,
      lat: s.lat,
      lng: s.lng,
      areaId: s.area === null ? null : destIds.get(s.area)!,
      type: s.type,
      status: s.status,
      source: s.source,
      rating: s.rating,
      // #113 · the two coast Been saves carry `again: true` (the Last-time card).
      again: s.again,
      tripId: s.trip === null ? null : ids.get(s.trip)!,
      note: s.note,
      suggestedPlace: s.suggestedPlace,
      createdAt: new Date(s.createdAt),
    })),
  );

  console.log(`Seeded ${trips.length} trips + ${saves.length} saves.`);
  process.exit(0);
}

const instant = (v: string | null) => (v === null ? null : new Date(v));

/** One seed trip, top to bottom: trip → chapters → destinations → segments → paperwork. */
async function writeTrip(t: Trip, ids: Map<string, string>, areaIdByPlace: Map<string, string>) {
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
      // #155 · Q2 A — the trip's area, by the seeded areas row's place id.
      areaId: t.area ? (areaIdByPlace.get(t.area.googlePlaceId) ?? null) : null,
    })
    .returning();
  ids.set(t.id, trip!.id);
  const id = (local: string | null) => (local === null ? null : ids.get(local)!);

  for (const l of t.chapters) {
    const [chapter] = await db
      .insert(schema.chapters)
      .values({ tripId: trip!.id, title: l.title, sortOrder: l.sortOrder })
      .returning();
    ids.set(l.id, chapter!.id);
    for (const s of l.destinations) {
      const [destination] = await db
        .insert(schema.destinations)
        .values({
          chapterId: chapter!.id,
          placeName: s.place.name,
          lat: s.place.lat,
          lng: s.place.lng,
          googlePlaceId: s.place.googlePlaceId,
          arriveDate: s.arriveDate,
          departDate: s.departDate,
          sortOrder: s.sortOrder,
          rating: s.rating,
          again: s.again,
          notes: s.notes,
        })
        .returning();
      ids.set(s.id, destination!.id);
    }
  }

  for (const seg of t.segments) {
    const [row] = await db
      .insert(schema.travelSegments)
      .values({
        tripId: trip!.id,
        fromDestinationId: id(seg.fromDestinationId),
        toDestinationId: id(seg.toDestinationId),
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

  const destinations = t.chapters.flatMap((l) => l.destinations);
  const paperwork = [
    ...destinations.flatMap((s) => s.reservations),
    ...t.segments.flatMap((s) => s.reservations),
  ];
  if (paperwork.length > 0) {
    await db.insert(schema.reservations).values(
      paperwork.map((r) => ({
        destinationId: id(r.destinationId),
        segmentId: id(r.segmentId),
        type: r.type,
        name: r.name,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        confirmationNumber: r.confirmationNumber,
        cost: r.cost === null ? null : r.cost.toFixed(2),
        rating: r.rating,
        again: r.again,
        notes: r.notes,
        startsAt: instant(r.startsAt),
        endsAt: instant(r.endsAt),
        startsTz: r.startsTz,
        endsTz: r.endsTz,
        lodgingKind: r.lodgingKind,
        transportKind: r.transportKind,
      })),
    );
  }

  const ideas = [...destinations.flatMap((s) => s.ideas), ...t.ideas];
  if (ideas.length > 0) {
    await db.insert(schema.ideas).values(
      ideas.map((i) => ({
        tripId: trip!.id,
        destinationId: id(i.destinationId),
        title: i.title,
        category: i.category,
        status: i.status,
        placeName: i.place?.name ?? null,
        lat: i.place?.lat ?? null,
        lng: i.place?.lng ?? null,
        googlePlaceId: i.place?.googlePlaceId ?? null,
        rating: i.rating,
        again: i.again,
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
