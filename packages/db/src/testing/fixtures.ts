import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "../index";
import { ideas, legs, reservations, rigs, routes, savedPlaces, stops, trips } from "../schema";

/**
 * Typed fixture factories over the real schema — the rows the API integration
 * tests write before they call a handler (issue #30 §4).
 *
 * Like ./truncate.ts and unlike ./lifecycle.ts, this module uses the shipped
 * `db` handle, so it may only be imported from a vitest WORKER, after
 * apps/web/src/test/setup.ts has pointed DATABASE_URL at the run database. A
 * test file's own imports evaluate after its setupFiles, which is what makes
 * `import { fx } from "@rv-trip/db/testing"` safe inside a *.test.ts.
 *
 * Every factory takes a partial and fills the rest from the worked trip's real
 * values (packages/db/src/seed.ts). `owner` defaults to DEV_OWNER so the keyless
 * handler sees its own rows; pass OTHER_OWNER to make a row foreign.
 */

/** Mirrors apps/web/src/lib/owner.ts:14 — the tenant a keyless process runs as. */
export const DEV_OWNER = "dev-user";
/** The second seeded tenant. Q3 = A: two real owners, zero `vi.mock`. */
export const OTHER_OWNER = "other-user";

export type TripRow = typeof trips.$inferSelect;
export type LegRow = typeof legs.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type IdeaRow = typeof ideas.$inferSelect;
export type ReservationRow = typeof reservations.$inferSelect;
export type SavedPlaceRow = typeof savedPlaces.$inferSelect;
export type RigRow = typeof rigs.$inferSelect;
export type RouteRow = typeof routes.$inferSelect;

/** A stop the route helpers accept: `routeCacheKey`/`estimateRoute` want
 * non-nullable lat/lng, and `stops.lat`/`lng` are nullable columns. */
export type PlacedStopRow = StopRow & { lat: number; lng: number };

export interface TripSeed {
  owner: string;
  title: string;
  homeBase: string | null;
  startDate: string;
  endDate: string;
  status: "planning" | "upcoming" | "complete";
  /**
   * Deliberately unlike seed.ts:24, which pins `false` so the demo trip stays
   * "planning" forever. The factory leaves the derivation switched ON, because
   * with the clock pinned that is the only way `deriveTripStatus` is exercised
   * at the handler level at all.
   */
  statusAuto: boolean;
  rating: number | null;
  note: string | null;
}

export interface LegSeed {
  title: string;
  sortOrder: number;
}

export interface StopSeed {
  placeName: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  arriveDate: string | null;
  departDate: string | null;
  sortOrder: number;
  rating: number | null;
  notes: string | null;
}

export interface IdeaSeed {
  title: string;
  status: "idea" | "planned" | "done";
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  rating: number | null;
  notes: string | null;
  sortOrder: number;
}

export type ResType =
  | "campground"
  | "lodging"
  | "dining"
  | "event"
  | "tour"
  | "activity"
  | "transport"
  | "other";

export interface ResSeed {
  type: ResType;
  name: string;
  checkIn: string | null;
  checkOut: string | null;
  confirmationNumber: string | null;
  /** Wire/number in, `numeric(10,2)` string out — the same coercion the
   * mutations do. */
  cost: number | null;
  rating: number | null;
  notes: string | null;
}

export interface PlaceSeed {
  owner: string;
  name: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
  type: ResType;
  status: "want" | "been";
  note: string | null;
  source: string | null;
  rating: number | null;
  tripId: string | null;
}

export interface RigSeed {
  owner: string;
  name: string;
  type: "motorhome" | "trailer";
  heightMeters: number;
  widthMeters: number;
  lengthMeters: number;
  grossWeightKg: number;
  propaneOnBoard: boolean;
}

/** The worked trip, whole — 2 legs, exactly 3 coordinate-bearing scheduled
 * stops (so `orderedPairs` yields exactly two route keys), 1 reservation,
 * 1 idea. The bundle fixture (§6.5). */
export interface LoopFixture {
  trip: TripRow;
  legCoast: LegRow;
  legMountains: LegRow;
  astoria: PlacedStopRow;
  newport: PlacedStopRow;
  bend: PlacedStopRow;
  reservation: ReservationRow;
  idea: IdeaRow;
}

async function insertTrip(p: Partial<TripSeed> = {}): Promise<TripRow> {
  const [row] = await db
    .insert(trips)
    .values({
      ownerId: p.owner ?? DEV_OWNER,
      title: p.title ?? "Pacific Northwest Loop",
      homeBase: p.homeBase === undefined ? "Boise, ID" : p.homeBase,
      startDate: p.startDate ?? "2026-08-01",
      endDate: p.endDate ?? "2026-08-28",
      status: p.status ?? "planning",
      statusAuto: p.statusAuto ?? true,
      rating: p.rating ?? null,
      note: p.note ?? null,
    })
    .returning();
  return row!;
}

async function insertLeg(p: { tripId: string } & Partial<LegSeed>): Promise<LegRow> {
  const [row] = await db
    .insert(legs)
    .values({
      tripId: p.tripId,
      title: p.title ?? "Oregon Coast",
      sortOrder: p.sortOrder ?? 0,
    })
    .returning();
  return row!;
}

async function insertStop(p: { legId: string } & Partial<StopSeed>): Promise<StopRow> {
  const [row] = await db
    .insert(stops)
    .values({
      legId: p.legId,
      placeName: p.placeName ?? "Astoria, OR",
      lat: p.lat === undefined ? 46.1879 : p.lat,
      lng: p.lng === undefined ? -123.8313 : p.lng,
      googlePlaceId: p.googlePlaceId ?? null,
      arriveDate: p.arriveDate === undefined ? "2026-08-02" : p.arriveDate,
      departDate: p.departDate === undefined ? "2026-08-05" : p.departDate,
      sortOrder: p.sortOrder ?? 0,
      rating: p.rating ?? null,
      notes: p.notes ?? null,
    })
    .returning();
  return row!;
}

async function insertIdea(p: { stopId: string } & Partial<IdeaSeed>): Promise<IdeaRow> {
  const [row] = await db
    .insert(ideas)
    .values({
      stopId: p.stopId,
      title: p.title ?? "Fort Stevens bike loop",
      status: p.status ?? "idea",
      placeName: p.placeName ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      googlePlaceId: p.googlePlaceId ?? null,
      rating: p.rating ?? null,
      notes: p.notes ?? null,
      sortOrder: p.sortOrder ?? 0,
    })
    .returning();
  return row!;
}

async function insertReservation(
  p: { stopId: string } & Partial<ResSeed>,
): Promise<ReservationRow> {
  const [row] = await db
    .insert(reservations)
    .values({
      stopId: p.stopId,
      type: p.type ?? "campground",
      name: p.name ?? "Astoria/Warrenton KOA",
      checkIn: p.checkIn === undefined ? "2026-08-02" : p.checkIn,
      checkOut: p.checkOut === undefined ? "2026-08-05" : p.checkOut,
      confirmationNumber: p.confirmationNumber === undefined ? "KOA-88213" : p.confirmationNumber,
      cost: p.cost === undefined ? "204.00" : p.cost === null ? null : String(p.cost),
      rating: p.rating ?? null,
      notes: p.notes ?? null,
    })
    .returning();
  return row!;
}

async function insertSavedPlace(p: Partial<PlaceSeed> = {}): Promise<SavedPlaceRow> {
  const [row] = await db
    .insert(savedPlaces)
    .values({
      ownerId: p.owner ?? DEV_OWNER,
      name: p.name ?? "Cape Lookout State Park",
      region: p.region === undefined ? "Tillamook, OR" : p.region,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      googlePlaceId: p.googlePlaceId ?? null,
      type: p.type ?? "campground",
      status: p.status ?? "want",
      note: p.note ?? null,
      source: p.source ?? null,
      rating: p.rating ?? null,
      tripId: p.tripId ?? null,
    })
    .returning();
  return row!;
}

async function insertRig(p: Partial<RigSeed> = {}): Promise<RigRow> {
  const [row] = await db
    .insert(rigs)
    .values({
      ownerId: p.owner ?? DEV_OWNER,
      name: p.name ?? "Big Blue",
      type: p.type ?? "motorhome",
      heightMeters: String(p.heightMeters ?? 3.5052),
      widthMeters: String(p.widthMeters ?? 2.591),
      lengthMeters: String(p.lengthMeters ?? 10.972),
      grossWeightKg: String(p.grossWeightKg ?? 11793.4),
      propaneOnBoard: p.propaneOnBoard ?? true,
    })
    .returning();
  return row!;
}

/** `stops.lat`/`lng` are nullable columns; the route helpers are not. */
function placed(row: StopRow): PlacedStopRow {
  if (row.lat == null || row.lng == null) {
    throw new Error(`fixture stop "${row.placeName}" has no coordinates`);
  }
  return row as PlacedStopRow;
}

async function pacificNorthwestLoop(owner: string = DEV_OWNER): Promise<LoopFixture> {
  const trip = await insertTrip({ owner });
  const legCoast = await insertLeg({ tripId: trip.id, title: "Oregon Coast", sortOrder: 0 });
  const legMountains = await insertLeg({
    tripId: trip.id,
    title: "Cascades & Home",
    sortOrder: 1,
  });
  const astoria = placed(
    await insertStop({
      legId: legCoast.id,
      placeName: "Astoria, OR",
      lat: 46.1879,
      lng: -123.8313,
      arriveDate: "2026-08-02",
      departDate: "2026-08-05",
      sortOrder: 0,
      rating: 5,
      notes: "Loved the riverwalk. Book the same RV park next time.",
    }),
  );
  const newport = placed(
    await insertStop({
      legId: legCoast.id,
      placeName: "Newport, OR",
      lat: 44.6365,
      lng: -124.053,
      arriveDate: "2026-08-05",
      departDate: "2026-08-09",
      sortOrder: 1,
      rating: 4,
    }),
  );
  const bend = placed(
    await insertStop({
      legId: legMountains.id,
      placeName: "Bend, OR",
      lat: 44.0582,
      lng: -121.3153,
      arriveDate: "2026-08-12",
      departDate: "2026-08-16",
      sortOrder: 0,
    }),
  );
  const reservation = await insertReservation({
    stopId: astoria.id,
    rating: 5,
    notes: "Full hookups, site A12 backs to the trees.",
  });
  const idea = await insertIdea({ stopId: astoria.id });
  return { trip, legCoast, legMountains, astoria, newport, bend, reservation, idea };
}

/**
 * Push a cached route's `fetched_at` into the past. The TTL is a SQL
 * comparison against `now()` (queries.ts `getCachedRoutes`), so ageing has to
 * happen on the DATABASE clock — apps/web's suite freezes the JS one.
 */
async function ageCachedRoute(key: string, days: number): Promise<void> {
  await db
    .update(routes)
    .set({ fetchedAt: sql`now() - ${`${days} days`}::interval` })
    .where(eq(routes.key, key));
}

export const fx = {
  trip: insertTrip,
  /** Backdate a cached route, so the 30-day TTL can be read from both sides. */
  ageCachedRoute,
  leg: insertLeg,
  stop: insertStop,
  idea: insertIdea,
  reservation: insertReservation,
  savedPlace: insertSavedPlace,
  rig: insertRig,
  pacificNorthwestLoop,
};

/**
 * Read-back helpers, so a "no-op" assertion reads the ROW, not the response —
 * the response of a 404 tells you nothing about whether the write happened.
 * Deliberately NOT owner-scoped: that is the whole point.
 */
export const read = {
  async trip(id: string): Promise<TripRow | null> {
    const [row] = await db.select().from(trips).where(eq(trips.id, id));
    return row ?? null;
  },
  async leg(id: string): Promise<LegRow | null> {
    const [row] = await db.select().from(legs).where(eq(legs.id, id));
    return row ?? null;
  },
  async stop(id: string): Promise<StopRow | null> {
    const [row] = await db.select().from(stops).where(eq(stops.id, id));
    return row ?? null;
  },
  async idea(id: string): Promise<IdeaRow | null> {
    const [row] = await db.select().from(ideas).where(eq(ideas.id, id));
    return row ?? null;
  },
  async reservation(id: string): Promise<ReservationRow | null> {
    const [row] = await db.select().from(reservations).where(eq(reservations.id, id));
    return row ?? null;
  },
  async savedPlace(id: string): Promise<SavedPlaceRow | null> {
    const [row] = await db.select().from(savedPlaces).where(eq(savedPlaces.id, id));
    return row ?? null;
  },
  /** The ROW, not the payload: `RigProfile` carries no timestamp (C3), so the
   * upsert's touch can only be asserted here. */
  async routeRow(key: string): Promise<RouteRow | null> {
    const [row] = await db.select().from(routes).where(eq(routes.key, key));
    return row ?? null;
  },
  async countRoutes(): Promise<number> {
    const [row] = await db.select({ n: count() }).from(routes);
    return Number(row!.n);
  },
  async rigRow(owner: string): Promise<RigRow | null> {
    const [row] = await db.select().from(rigs).where(eq(rigs.ownerId, owner));
    return row ?? null;
  },
  /** Leg ids, by sortOrder. */
  async legOrder(tripId: string): Promise<string[]> {
    const rows = await db
      .select({ id: legs.id })
      .from(legs)
      .where(eq(legs.tripId, tripId))
      .orderBy(asc(legs.sortOrder));
    return rows.map((r) => r.id);
  },
  async legRows(tripId: string): Promise<{ id: string; sortOrder: number }[]> {
    return db
      .select({ id: legs.id, sortOrder: legs.sortOrder })
      .from(legs)
      .where(eq(legs.tripId, tripId))
      .orderBy(asc(legs.sortOrder));
  },
  async stopRows(legId: string): Promise<{ id: string; sortOrder: number }[]> {
    return db
      .select({ id: stops.id, sortOrder: stops.sortOrder })
      .from(stops)
      .where(eq(stops.legId, legId))
      .orderBy(asc(stops.sortOrder));
  },
  async countLegs(tripId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(legs).where(eq(legs.tripId, tripId));
    return Number(row!.n);
  },
  async countStops(legId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(stops).where(eq(stops.legId, legId));
    return Number(row!.n);
  },
  async countIdeas(stopId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(ideas).where(eq(ideas.stopId, stopId));
    return Number(row!.n);
  },
  async countReservations(stopId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(reservations)
      .where(eq(reservations.stopId, stopId));
    return Number(row!.n);
  },
  async countSavedPlaces(owner: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(savedPlaces)
      .where(eq(savedPlaces.ownerId, owner));
    return Number(row!.n);
  },
  async countRigs(owner: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(rigs).where(eq(rigs.ownerId, owner));
    return Number(row!.n);
  },
};
