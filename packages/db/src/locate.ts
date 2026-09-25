import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { LocateRow, LocateStore, LocateTarget, PlaceSummary } from "@rv-trip/core";
import { db } from "./index";
import { ideas, legs, saves, stops, trips } from "./schema";

/**
 * The database half of Locate (docs/design/41 §6). The decision tree — the cap,
 * the query, the partial-batch arithmetic — is `locatePlaces` in
 * @rv-trip/core; this is the owner-scoped seam it reads names through and
 * writes coordinates through.
 *
 * Two guarantees live here and nowhere else:
 *
 * 1. **Only this owner's rows.** Stops scope through leg → trip exactly as
 *    mutations.ts scopes every stop write; ideas join straight to their own
 *    `trip_id` (#80 — a shelf idea has no stop to walk through); saved places
 *    scope on `owner_id` directly. Another tenant's id simply does not come back, so it
 *    is never geocoded and never written.
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
const coordlessPlace = or(isNull(saves.lat), isNull(saves.lng));
const coordlessIdea = or(isNull(ideas.lat), isNull(ideas.lng));

/** The leg-through-trip owner scope, mirrored from mutations.ts (which keeps
 * its copy private to the write path). */
const ownedLegIds = (owner: string) =>
  db
    .select({ id: legs.id })
    .from(legs)
    .innerJoin(trips, eq(legs.tripId, trips.id))
    .where(eq(trips.ownerId, owner));

/** The IDEA scope (#80). An idea carries `trip_id` attached or not, so the walk
 * is one hop, not four — and a shelf idea (NULL `stop_id`) is in no
 * `ownedStopIds` list, which is why this is the only correct scope for an idea
 * write. Mirrored from mutations.ts by the same rule the two above are. */
const ownedTripIds = (owner: string) =>
  db.select({ id: trips.id }).from(trips).where(eq(trips.ownerId, owner));

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
    .select({ id: saves.id, name: saves.name, region: saves.region })
    .from(saves)
    .where(and(eq(saves.ownerId, owner), inArray(saves.id, ids), coordlessPlace));
  return rows.map((r) => ({ kind: "place" as const, id: r.id, name: r.name, region: r.region }));
}

/**
 * An idea's search text (#80 i3): **`coalesce(place_name, title)`**.
 *
 * A stop searches on `stops.place_name`, and an idea now does the same thing
 * when it has one. It usually does not — `place_name` is null until something
 * locates the row — but the picker's free-text escape row lets a HUMAN type a
 * place onto an idea without ever giving it coordinates ("Tumalo Falls, the
 * upper lot" on a row titled "waterfall hike"). That typed name is a far better
 * geocode query than the title beside it, so preferring it resolves more rows
 * per batch. `title` is the fallback, and for most ideas it is still the only
 * text there is — so "Tumalo Falls trailhead" resolves and "Deschutes River
 * float" never will, which is a fact about that idea rather than a failure.
 *
 * `coalesce` is enough on its own: the `place` grammar declares
 * `name: z.string().min(1)` (core/domain/types.ts:36-41), so the column is
 * either NULL or real text — an empty string can never reach it and be
 * geocoded as a blank query.
 *
 * The mirror of this rule on the WRITE side is `writeIdeaPin` below, which
 * coalesces the other way round — Google's name fills the column only when it
 * is empty. Read prefers what the human typed; write never overwrites it. The
 * two are the same preference stated twice.
 */
const ideaSearchText = sql<string>`coalesce(${ideas.placeName}, ${ideas.title})`;

/** `region` is null for the same reason a stop's is: the trip's geography is
 * not a fact about this idea. */
async function loadIdeas(owner: string, ids: string[]): Promise<LocateTarget[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: ideas.id, name: ideaSearchText })
    .from(ideas)
    .innerJoin(trips, eq(ideas.tripId, trips.id))
    .where(and(eq(trips.ownerId, owner), inArray(ideas.id, ids), coordlessIdea));
  return rows.map((r) => ({ kind: "idea" as const, id: r.id, name: r.name, region: null }));
}

/**
 * Every coordless row this owner has, all three kinds — what `pnpm backfill:places`
 * walks. The page never calls this: the map already knows its unmapped rows and
 * sends the ids it is showing.
 *
 * The idea arm reads the same `ideaSearchText` the batch loader does. The two
 * entry points geocoding an idea under different names would be a silent
 * disagreement about what the row is called.
 */
export async function listLocateTargetsForOwner(owner: string): Promise<LocateTarget[]> {
  const [stopRows, placeRows, ideaRows] = await Promise.all([
    db
      .select({ id: stops.id, name: stops.placeName })
      .from(stops)
      .innerJoin(legs, eq(stops.legId, legs.id))
      .innerJoin(trips, eq(legs.tripId, trips.id))
      .where(and(eq(trips.ownerId, owner), coordlessStop)),
    db
      .select({ id: saves.id, name: saves.name, region: saves.region })
      .from(saves)
      .where(and(eq(saves.ownerId, owner), coordlessPlace)),
    db
      .select({ id: ideas.id, name: ideaSearchText })
      .from(ideas)
      .innerJoin(trips, eq(ideas.tripId, trips.id))
      .where(and(eq(trips.ownerId, owner), coordlessIdea)),
  ]);
  return [
    ...stopRows.map((r) => ({ kind: "stop" as const, id: r.id, name: r.name, region: null })),
    ...placeRows.map((r) => ({
      kind: "place" as const,
      id: r.id,
      name: r.name,
      region: r.region,
    })),
    ...ideaRows.map((r) => ({ kind: "idea" as const, id: r.id, name: r.name, region: null })),
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
    .update(saves)
    .set({
      lat: found.location!.lat,
      lng: found.location!.lng,
      googlePlaceId: found.googlePlaceId,
    })
    .where(and(eq(saves.id, placeId), eq(saves.ownerId, owner)))
    .returning({ id: saves.id });
  return rows.length > 0;
}

/**
 * Write the pin Google found onto an idea. The one asymmetry with the two
 * writers above: an idea must also end up with a `place_name`, because
 * `mapIdea` (queries.ts:395) keys the whole nested `place` off that column —
 * write only lat/lng and the coordinates would be invisible to every reader.
 *
 * `coalesce`, not an overwrite: the picker's free-text escape row means an idea
 * can already carry a name the HUMAN typed, and pressing a batch button must
 * not replace it with Google's. Google's name fills the column only when it is
 * empty, which is the case the batch exists for.
 */
async function writeIdeaPin(
  owner: string,
  ideaId: string,
  found: PlaceSummary,
): Promise<boolean> {
  const rows = await db
    .update(ideas)
    .set({
      lat: found.location!.lat,
      lng: found.location!.lng,
      googlePlaceId: found.googlePlaceId,
      placeName: sql`coalesce(${ideas.placeName}, ${found.name})`,
    })
    .where(and(eq(ideas.id, ideaId), inArray(ideas.tripId, ownedTripIds(owner))))
    .returning({ id: ideas.id });
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
        loadIdeas(owner, ids("idea")),
      ]).then(([s, p, i]) => [...s, ...p, ...i]);
    },
    saveCoords(target: LocateTarget, found: PlaceSummary) {
      if (target.kind === "stop") return setStopCoords(owner, target.id, found);
      if (target.kind === "idea") return writeIdeaPin(owner, target.id, found);
      return setSavedPlaceCoords(owner, target.id, found);
    },
  };
}
