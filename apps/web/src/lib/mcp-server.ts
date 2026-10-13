import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodError } from "zod";
import {
  contextDigest,
  ideaCategory,
  isoDate,
  lodgingKind,
  nearbySaves,
  orderedDestinations,
  reservationCreateInput,
  reservationType,
  saveAnchor,
  savedPlaceCreate,
  transportKind,
  travelMode,
  type LatLng,
  type Place,
  type Trip,
} from "@rv-trip/core";
import {
  NoHomeBase,
  SegmentDateMismatch,
  createDestinationOnce,
  createIdea,
  createReservationOnce,
  createSave,
  createTripOnce,
  ensureReturnHop,
  getJournalThing,
  getTripById,
  listDismissedSaveIds,
  listSavedPlacesForOwner,
  listTripsForOwner,
  updateDestinationFields,
  updateIdeaFields,
  updateReservationFields,
  updateSegmentMode,
} from "@rv-trip/db";
import { defineTool } from "@/lib/mcp-tools";
import { nextTimeFor } from "@/lib/next-time";
import { areaResolver, placesProvider } from "@/lib/places";

/**
 * The trip grammar as MCP tools (#161 substrate · #162). Each calls the SAME
 * query/mutation its REST route calls, with `owner` and `actor` from the key —
 * so household scoping, validation, idempotent replay and change_log
 * attribution are the app's, not a second copy. Nothing here deletes.
 *
 * Re-runs (#162 · Q4 C): ideas and saves replay on their shipped `clientId`;
 * trips, destinations and reservations on a natural key (title + start date ·
 * place name · parent + name) — each lookup sits inside its mutation's
 * transaction, and a replay answers `replayed: true` and writes nothing.
 */

/** http(s) only: the model may have read this URL off a page it was
 * researching, and notes must never carry a javascript:/data: link. */
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), { message: "sourceUrl must be an http(s) URL" });

const uuid = z.string().uuid();
const stars = z.number().int().min(1).max(5);

/** A zod failure the model can read — "path: message; path: message". */
function zodMessage(e: ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
}

async function ownedTrip(householdId: string, tripId: string): Promise<Trip> {
  const trip = await getTripById(householdId, tripId);
  if (!trip) throw new Error("trip not found");
  return trip;
}

/** A hop end, by name: a destination's place, or "home". */
function endName(trip: Trip, end: string): string {
  if (end === "home") return "home";
  const d = trip.chapters.flatMap((c) => c.destinations).find((x) => x.id === end);
  return d ? d.place.name : end;
}

/**
 * #162 · Q5 B — a bare place string resolved server-side. The search is
 * biased near the trip's previous destination with coordinates, else its home
 * base. The stored NAME is the one typed ("Seattle, WA" — what the card
 * shows, and what Q4 C's replay compares); the top hit gives only the pin, and
 * is echoed as `resolved` so the model can catch a wrong match.
 *
 * Keyless, no hit, or a search that throws (vet MED): the name as typed with
 * null coordinates, `resolved: null` — the row's coordless warning does the rest.
 */
async function resolvePlace(
  trip: Trip,
  name: string,
): Promise<{ place: Place; resolved: { name: string; googlePlaceId: string } | null }> {
  const typed: Place = { name, lat: null, lng: null, googlePlaceId: null };
  const { provider, configured } = placesProvider();
  if (!configured) return { place: typed, resolved: null };
  const prev = orderedDestinations(trip)
    .map((d) => d.place)
    .filter((pl) => pl.lat !== null && pl.lng !== null)
    .at(-1);
  const home = trip.homeBasePlace;
  const near: LatLng | undefined = prev
    ? { lat: prev.lat!, lng: prev.lng! }
    : home && home.lat !== null && home.lng !== null
      ? { lat: home.lat, lng: home.lng }
      : undefined;
  try {
    const [hit] = await provider.search(name, near);
    if (!hit) return { place: typed, resolved: null };
    return {
      place: { name, lat: hit.location?.lat ?? null, lng: hit.location?.lng ?? null, googlePlaceId: hit.googlePlaceId },
      resolved: { name: hit.name, googlePlaceId: hit.googlePlaceId },
    };
  } catch {
    return { place: typed, resolved: null };
  }
}

export function registerTools(server: McpServer): void {
  defineTool(
    server,
    "list_trips",
    {
      title: "List trips",
      description: "Every trip in this household: id, title, dates, status, home base, counts. Call this first to find a trip id.",
      inputSchema: {},
    },
    async (_args, p) => listTripsForOwner(p.householdId),
  );

  defineTool(
    server,
    "get_trip",
    {
      title: "Get a trip",
      description: "The full trip: chapters → destinations (with their ideas and reservations), travel segments, dates, rig/mode defaults.",
      inputSchema: { tripId: uuid },
    },
    async ({ tripId }, p) => ownedTrip(p.householdId, tripId),
  );

  // ── #162 · Q1 B — the digest ─────────────────────────────────────────────
  defineTool(
    server,
    "get_context",
    {
      title: "Get trip context",
      description:
        "Call this first in a session about one trip: a flat digest of every destination, hop and id, the open days and destinations with no stay, saves nearby, and what you loved near here last time. No notes or booking details — get_trip has those.",
      inputSchema: { tripId: uuid },
    },
    async ({ tripId }, p) => {
      const trip = await ownedTrip(p.householdId, tripId);
      const [saves, dismissed] = await Promise.all([
        listSavedPlacesForOwner(p.householdId),
        listDismissedSaveIds(p.householdId, tripId),
      ]);
      const nextTime = await nextTimeFor(p.householdId, trip, saves);
      const nearby = nearbySaves(trip, saves, dismissed, trip.surfaceRadiusMi, nextTime.saveIds);
      return contextDigest(trip, nearby, nextTime);
    },
  );

  // ── creates ───────────────────────────────────────────────────────────────
  defineTool(
    server,
    "create_trip",
    {
      title: "Create a trip",
      description:
        "Create an empty trip (one unnamed chapter, no destinations — add those with add_destination). The home base is the household default. Re-running with the same title and start date returns the existing trip (replayed: true).",
      inputSchema: {
        title: z.string().trim().min(1).max(200),
        startDate: isoDate,
        endDate: isoDate,
        defaultMode: travelMode.optional(),
        lodgingDefault: lodgingKind.nullable().optional(),
        rigOn: z.boolean().optional(),
      },
    },
    async ({ title, startDate, endDate, defaultMode, lodgingDefault, rigOn }, p) => {
      if (endDate < startDate) throw new Error("endDate is before startDate");
      // No `area`: with one, createTrip writes a destination spanning the whole
      // trip, and a paste's destinations come from add_destination instead.
      // `homeBase: null` lets the household default coalesce (getTripById).
      const { trip: row, replayed } = await createTripOnce(p.householdId, {
        title,
        startDate,
        endDate,
        homeBase: null,
        defaultMode,
        lodgingDefault,
        rigOn,
      });
      const trip = await ownedTrip(p.householdId, row.id);
      const [first] = [...trip.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
      return { tripId: trip.id, chapterId: first?.id ?? null, homeBase: trip.homeBase, replayed };
    },
  );

  defineTool(
    server,
    "add_destination",
    {
      title: "Add a destination",
      description:
        'Add a place the trip goes to, at the end of a chapter (default: the trip\'s first). `place` may be a bare name ("Blaine, WA") — the server looks it up and echoes the match as `resolved` (null when nothing matched: the destination is saved unmapped) — or {name, lat, lng, googlePlaceId}, stored as given. Give both dates or neither (floating). Re-running with the same place on the same trip returns the existing destination (replayed: true).',
      inputSchema: {
        tripId: uuid,
        place: z.union([
          z.string().trim().min(1).max(200),
          z.object({
            name: z.string().trim().min(1).max(200),
            lat: z.number().nullable(),
            lng: z.number().nullable(),
            googlePlaceId: z.string().nullable(),
          }),
        ]),
        arriveDate: isoDate.optional(),
        departDate: isoDate.optional(),
        chapterId: uuid.optional(),
      },
    },
    async ({ tripId, place, arriveDate, departDate, chapterId }, p) => {
      if ((arriveDate === undefined) !== (departDate === undefined)) {
        throw new Error("arriveDate and departDate go together — give both, or neither for a floating destination");
      }
      if (arriveDate && departDate && departDate < arriveDate) throw new Error("departDate is before arriveDate");
      const trip = await ownedTrip(p.householdId, tripId);
      const chapters = [...trip.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
      const chapter = chapterId ? chapters.find((c) => c.id === chapterId) : chapters[0];
      if (!chapter) throw new Error("chapter not found on this trip");
      const { place: stored, resolved } =
        typeof place === "string" ? await resolvePlace(trip, place) : { place, resolved: null };
      const { destination, replayed } = await createDestinationOnce(
        p.householdId,
        { chapterId: chapter.id, place: stored, arriveDate: arriveDate ?? null, departDate: departDate ?? null },
        p.actor,
      );
      return { destination, resolved, replayed };
    },
  );

  defineTool(
    server,
    "add_segment",
    {
      title: "Set how a hop is travelled",
      description:
        'Set the mode (drive / fly / ferry) of the hop between two ADJACENT stops — destination ids, or "home" for the trip\'s home base. Hops between destinations already exist (the app keeps one per adjacent pair); this only sets their mode. `to: "home"` creates the hop home when the trip has none yet (born: true). Calling it again is harmless.',
      inputSchema: {
        tripId: uuid,
        from: z.union([z.literal("home"), uuid]),
        to: z.union([z.literal("home"), uuid]),
        mode: travelMode,
      },
    },
    async ({ tripId, from, to, mode }, p) => {
      if (from === "home" && to === "home") throw new Error("a hop goes from home or to home, not both");
      let trip = await ownedTrip(p.householdId, tripId);
      let born = false;
      if (to === "home" && !trip.segments.some((s) => s.toDestinationId === null && s.fromDestinationId !== null)) {
        try {
          const made = await ensureReturnHop(p.householdId, tripId);
          if (!made) throw new Error("trip not found");
          born = made.born;
        } catch (e) {
          if (e instanceof NoHomeBase) {
            throw new Error("no home base: set one on the trip or the household before adding the hop home");
          }
          throw e;
        }
        trip = await ownedTrip(p.householdId, tripId);
      }
      const end = (x: string) => (x === "home" ? null : x);
      const hop = trip.segments.find((s) => s.fromDestinationId === end(from) && s.toDestinationId === end(to));
      if (!hop) {
        throw new Error(
          `"${endName(trip, from)}" → "${endName(trip, to)}" are not adjacent in the route — add_segment only sets the mode of an existing hop`,
        );
      }
      if (!(await updateSegmentMode(p.householdId, hop.id, mode))) throw new Error("segment not found");
      return { segmentId: hop.id, from, to, mode, born };
    },
  );

  defineTool(
    server,
    "add_reservation",
    {
      title: "Add a reservation",
      description:
        "Book something on a destination (a stay, a table, a tour) or on a hop (a flight, ferry, rental car — use get_context's hop ids). A stay's check-in/out times go in startsAt/endsAt (ISO 8601 with offset) with their IANA zone in startsTz/endsTz. Re-running with the same name on the same parent returns the existing booking (replayed: true).",
      inputSchema: {
        destinationId: uuid.optional(),
        segmentId: uuid.optional(),
        type: reservationType,
        name: z.string().trim().min(1).max(200),
        checkIn: isoDate.optional(),
        checkOut: isoDate.optional(),
        startsAt: z.string().optional(),
        startsTz: z.string().optional(),
        endsAt: z.string().optional(),
        endsTz: z.string().optional(),
        lodgingKind: lodgingKind.optional(),
        transportKind: transportKind.optional(),
        notes: z.string().max(4000).optional(),
        confirmationNumber: z.string().max(200).optional(),
        cost: z.number().nonnegative().optional(),
      },
    },
    async (args, p) => {
      // An MCP inputSchema is a raw shape, so the create contract's refine
      // (exactly one parent, a clock needs its zone, lands before it leaves)
      // only runs here (vet MED) — the same schema POST /api/reservations parses.
      const parsed = reservationCreateInput.safeParse(args);
      if (!parsed.success) throw new Error(zodMessage(parsed.error));
      try {
        return await createReservationOnce(p.householdId, parsed.data, p.actor);
      } catch (e) {
        // Destination dates win (Q3 A) — the REST twin's 409, readable.
        if (e instanceof SegmentDateMismatch) {
          throw new Error(
            `segment_date_mismatch: this booking puts the hop on ${e.conflict.actual}, but the destination's date is ${e.conflict.expected} — fix the booking or the destination's dates`,
          );
        }
        throw e;
      }
    },
  );

  defineTool(
    server,
    "add_save",
    {
      title: "Save a place to the library",
      description:
        'Save a place to the household\'s library (want-to-go by default) — anchored to a Google place (googlePlaceId), a named area (areaLabel: "the Bandon area") or a dropped pin (lat + lng). Optionally tied to a trip. Re-running with the same clientId returns the existing save.',
      inputSchema: {
        anchor: saveAnchor,
        name: z.string().trim().min(1).max(200),
        type: reservationType,
        googlePlaceId: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        areaLabel: z.string().max(200).optional(),
        region: z.string().max(200).optional(),
        note: z.string().max(4000).optional(),
        source: z.string().max(200).optional(),
        tripId: uuid.optional(),
        clientId: z.string().min(1).max(64).optional(),
      },
    },
    async (args, p) => {
      if (args.anchor === "area" && !args.areaLabel) throw new Error("areaLabel: an area save needs its area's name");
      const parsed = savedPlaceCreate.safeParse(args);
      if (!parsed.success) throw new Error(zodMessage(parsed.error));
      return createSave(p.householdId, parsed.data, { resolveArea: areaResolver(), actor: p.actor });
    },
  );

  defineTool(
    server,
    "add_idea",
    {
      title: "Add an idea",
      description:
        "Add an idea (something to do, eat, or stay at) to a trip, optionally under one of its destinations. Notes and a source link are kept with it. Re-running with the same clientId returns the existing idea instead of a duplicate.",
      inputSchema: {
        tripId: uuid,
        destinationId: uuid.nullable().default(null),
        title: z.string().min(1).max(200),
        category: ideaCategory,
        notes: z.string().max(4000).optional(),
        sourceUrl: httpUrl.optional(),
        clientId: z.string().min(1).max(64).optional(),
      },
    },
    async ({ tripId, destinationId, title, category, notes, sourceUrl, clientId }, p) => {
      const body = [notes?.trim() || null, sourceUrl ? `Source: ${sourceUrl}` : null].filter(Boolean).join("\n\n") || null;
      return createIdea(
        p.householdId,
        { tripId, destinationId, title, category, status: "idea", place: null, rating: null, notes: body, clientId },
        { actor: p.actor, resolveArea: areaResolver() },
      );
    },
  );

  // ── #162 · Q7 B — the journal ────────────────────────────────────────────
  defineTool(
    server,
    "journal_entry",
    {
      title: "Journal what happened",
      description:
        'Record how something went. With target {kind, id}: patch an idea, destination or reservation — rating (1–5), again (would do it again: true / once was enough: false), notes; an IDEA may also be marked status "done". With target {tripId, destinationId?, title, category}: something you did that was never planned ("we ate at Sunny\'s Smokehouse") — created as a done idea; same clientId twice returns the existing one.',
      inputSchema: {
        target: z.union([
          z.object({ kind: z.enum(["idea", "destination", "reservation"]), id: uuid }),
          z.object({
            tripId: uuid,
            destinationId: uuid.nullable().optional(),
            title: z.string().trim().min(1).max(200),
            category: ideaCategory,
          }),
        ]),
        status: z.literal("done").optional(),
        rating: stars.optional(),
        again: z.boolean().optional(),
        notes: z.string().max(4000).optional(),
        clientId: z.string().min(1).max(64).optional(),
      },
    },
    async ({ target, status, rating, again, notes, clientId }, p) => {
      const deps = { resolveArea: areaResolver() };
      if ("kind" in target) {
        // Only ideas have a status (vet MED): a destination or a booking is
        // journaled by its stars, its again and its note.
        if (status !== undefined && target.kind !== "idea") {
          throw new Error(`status applies to ideas only — journal a ${target.kind} with rating / again / notes`);
        }
        const patch = {
          ...(status !== undefined && { status }),
          ...(rating !== undefined && { rating }),
          ...(again !== undefined && { again }),
          ...(notes !== undefined && { notes }),
        };
        if (Object.keys(patch).length === 0) throw new Error("nothing to write: give status, rating, again or notes");
        if (target.kind === "idea") {
          // updateIdeaFields is a silent no-op on a foreign id; say so instead.
          if (!(await getJournalThing(p.householdId, target))) throw new Error("idea not found");
          await updateIdeaFields(p.householdId, target.id, patch, p.actor, deps);
        } else if (target.kind === "destination") {
          if (!(await updateDestinationFields(p.householdId, target.id, patch, p.actor, deps))) {
            throw new Error("destination not found");
          }
        } else if (!(await updateReservationFields(p.householdId, target.id, patch, p.actor, deps))) {
          throw new Error("reservation not found");
        }
        return getJournalThing(p.householdId, target);
      }
      // Never planned: born done, through the same write-through, so "Last
      // time here" finds it on the next trip. It writes its `created` row.
      return createIdea(
        p.householdId,
        {
          tripId: target.tripId,
          destinationId: target.destinationId ?? null,
          title: target.title,
          category: target.category,
          status: "done",
          place: null,
          rating: rating ?? null,
          again: again ?? null,
          notes: notes ?? null,
          clientId,
        },
        { ...deps, actor: p.actor },
      );
    },
  );
}
