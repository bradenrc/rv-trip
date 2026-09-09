import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { LocateRow, LocateStore, LocateTarget, PlaceSummary } from "@rv-trip/core";
import { db } from "./index";
import { legs, savedPlaces, stops, trips } from "./schema";

/**
 * The database half of Locate (docs/design/41 §6). The decision tree — the cap,
 * the query, the partial-batch arithmetic — is `locatePlaces` in
 * @rv-trip/core; this is the owner-scoped seam it reads names through and
 * writes coordinates through.
 *
 * Two guarantees live here and nowhere else:
 *
 * 1. **Only this owner's rows.** Stops scope through leg → trip exactly as
 *    mutations.ts scopes every stop write; saved places scope on `owner_id`
 *    directly. Another tenant's id simply does not come back, so it is never
 *    geocoded and never written.
 * 2. **Only coordless rows.** A row that already has a pin is not re-read and
 *    not re-billed, and a coordinate the user placed by hand can never be
 *    moved by pressing Locate.
 *
 * Both mean an unknown id, a foreign id and an already-mapped id all resolve
 * identically: nothing loads, and `locatePlaces` counts the row as still
 * unmapped.
 */

/** A stop is coordless when either half of the pair is missing — the same test
 * `hasCoords` makes in the domain. */
const coordlessStop = or(isNull(stops.lat), isNull(stops.lng));
const coordlessPlace = or(isNull(savedPlaces.lat), isNull(savedPlaces.lng));

/** The leg-through-trip owner scope, mirrored from mutations.ts (which keeps
 * its copy private to the write path). */
const ownedLegIds = (owner: string) =>
  db
    .select({ id: legs.id })
    .from(legs)
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(eq(trips.ownerId, owner));

async function loadStops(owner: string, ids: string[]): Promise<LocateTarget[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: stops.id, name: stops.placeName })
    .from(stops)
    .innerJoin(legs, eq(stops.legId, legs.id))
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(and(eq(trips.ownerId, owner), inArray(stops.id, ids), coordlessStop));
  // A stop has no region column — the trip's own geography is not a fact about
  // this pullout, so nothing is borrowed and the query is the bare name.
  return rows.map((r) => ({ kind: "stop" as const, id: r.id, name: r.name, region: null }));
}

async function loadPlaces(owner: string, ids: string[]): Promise<LocateTarget[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: savedPlaces.id, name: savedPlaces.name, region: savedPlaces.region })
    .from(savedPlaces)
    .where(and(eq(savedPlaces.ownerId, owner), inArray(savedPlaces.id, ids), coordlessPlace));
  return rows.map((r) => ({ kind: "place" as const, id: r.id, name: r.name, region: r.region }));
}

/**
 * Every coordless row this owner has, both kinds — what `pnpm backfill:places`
 * walks. The page never calls this: the map already knows its unmapped rows and
 * sends the ids it is showing.
 */
export async function listLocateTargetsForOwner(owner: string): Promise<LocateTarget[]> {
  const [stopRows, placeRows] = await Promise.all([
    db
      .select({ id: stops.id, name: stops.placeName })
      .from(stops)
      .innerJoin(legs, eq(stops.legId, legs.id))
      .innerJoin(trips, eq(legs.tripId, trips.id))
      .where(and(eq(trips.ownerId, owner), coordlessStop)),
    db
      .select({ id: savedPlaces.id, name: savedPlaces.name, region: savedPlaces.region })
      .from(savedPlaces)
      .where(and(eq(savedPlaces.ownerId, owner), coordlessPlace)),
  ]);
  return [
    ...stopRows.map((r) => ({ kind: "stop" as const, id: r.id, name: r.name, region: null })),
    ...placeRows.map((r) => ({
      kind: "place" as const,
      id: r.id,
      name: r.name,
      region: r.region,
    })),
  ];
}

/** Write the pin Google found onto a stop. Returns false when the id is not
 * this owner's — the same "the WHERE matched nothing" answer the saved-place
 * mutations give. */
async function setStopCoords(
  owner: string,
  stopId: string,
  found: PlaceSummary,
): Promise<boolean> {
  const rows = await db
    .update(stops)
    .set({
      lat: found.location!.lat,
      lng: found.location!.lng,
      googlePlaceId: found.googlePlaceId,
    })
    .where(and(eq(stops.id, stopId), inArray(stops.legId, ownedLegIds(owner))))
    .returning({ id: stops.id });
  return rows.length > 0;
}

async function setSavedPlaceCoords(
  owner: string,
  placeId: string,
  found: PlaceSummary,
): Promise<boolean> {
  const rows = await db
    .update(savedPlaces)
    .set({
      lat: found.location!.lat,
      lng: found.location!.lng,
      googlePlaceId: found.googlePlaceId,
    })
    .where(and(eq(savedPlaces.id, placeId), eq(savedPlaces.ownerId, owner)))
    .returning({ id: savedPlaces.id });
  return rows.length > 0;
}

/** The `LocateStore` @rv-trip/core's `locatePlaces` runs against, bound to one
 * owner. The route and `pnpm backfill:places` both build it this way. */
export function dbLocateStore(owner: string): LocateStore {
  return {
    load(rows: LocateRow[]) {
      const ids = (kind: LocateRow["kind"]) =>
        rows.filter((r) => r.kind === kind).map((r) => r.id);
      return Promise.all([
        loadStops(owner, ids("stop")),
        loadPlaces(owner, ids("place")),
      ]).then(([s, p]) => [...s, ...p]);
    },
    saveCoords(target: LocateTarget, found: PlaceSummary) {
      return target.kind === "stop"
        ? setStopCoords(owner, target.id, found)
        : setSavedPlaceCoords(owner, target.id, found);
    },
  };
}
