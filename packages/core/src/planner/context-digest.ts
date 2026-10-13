import { z } from "zod";
import { deriveDays } from "../domain/derive-days";
import type { ForNextTime, IsoDate, NearbySaves, NextTimeRow, Trip } from "../domain/types";
import { isScheduled, tripStatus, travelMode } from "../domain/types";

/**
 * #162 · Q1 B — `get_context`, the MCP session's FIRST call: a flat digest of
 * every id a session needs to write against, plus the gaps worth filling. A
 * PURE projection of three reads that already ship — the trip tree
 * (`getTripById`), the saves near it (`nearbySaves`) and "Last time here"
 * (`forNextTime`) — the same way those two are pure over theirs.
 *
 * No note bodies and no booking bodies, so the size stays bounded on a
 * 28-day trip; `get_trip` is the drill-down for those (`more`).
 */

const mmdd = z.string().regex(/^\d{2}-\d{2}$/);

export const contextDigestRoute = z.object({
  id: z.string(),
  name: z.string(),
  /** `MM-DD` pair — absent on a floating destination. */
  dates: z.tuple([mmdd, mmdd]).optional(),
  floating: z.literal(true).optional(),
  /** The first lodging/campground reservation's name, else null. */
  stay: z.string().nullable(),
  ideas: z.number().int(),
  bookings: z.number().int(),
  /** Only when set. */
  rating: z.number().int().optional(),
});

export const contextDigestResponse = z.object({
  trip: z.object({
    id: z.string(),
    title: z.string(),
    dates: z.tuple([z.string(), z.string()]),
    status: tripStatus,
    defaults: z.object({ mode: travelMode, rig: z.boolean() }),
    homeBase: z.string().nullable(),
  }),
  route: z.array(contextDigestRoute),
  hops: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      mode: travelMode,
      timed: z.boolean(),
    }),
  ),
  gaps: z.object({
    /** Open-day runs, `MM-DD..MM-DD`. */
    open: z.array(z.string()),
    /** Ids of SCHEDULED destinations with no stay. A floating one is never listed. */
    noStay: z.array(z.string()),
  }),
  nearby: z.array(
    z.object({
      saveId: z.string(),
      name: z.string(),
      near: z.string(),
      mi: z.number(),
      source: z.string().optional(),
    }),
  ),
  lastTime: z.array(
    z.object({
      near: z.string(),
      trip: z.string(),
      again: z.array(z.string()),
      once: z.array(z.string()),
    }),
  ),
  more: z.string(),
});
export type ContextDigest = z.infer<typeof contextDigestResponse>;

/** The fixed drill-down hint (§2). */
export const CONTEXT_MORE = "get_trip { tripId } for notes + booking details";

/** The literal a home end of a hop reads as. */
const HOME = "home";

const md = (d: IsoDate): string => d.slice(5);

const STAY_TYPES = new Set(["lodging", "campground"]);

export function contextDigest(trip: Trip, nearby: Pick<NearbySaves, "items">, nextTime: Pick<ForNextTime, "cards">): ContextDigest {
  const chapters = [...trip.chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const destinations = chapters.flatMap((c) => [...c.destinations].sort((a, b) => a.sortOrder - b.sortOrder));

  const stayOf = (d: Trip["chapters"][number]["destinations"][number]) =>
    d.reservations.find((r) => STAY_TYPES.has(r.type))?.name ?? null;

  const route = destinations.map((d) => ({
    id: d.id,
    name: d.place.name,
    ...(isScheduled(d) ? { dates: [md(d.arriveDate), md(d.departDate)] as [string, string] } : { floating: true as const }),
    stay: stayOf(d),
    ideas: d.ideas.length,
    bookings: d.reservations.length,
    ...(d.rating !== null ? { rating: d.rating } : {}),
  }));

  const hops = [...trip.segments]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({
      id: s.id,
      from: s.fromDestinationId ?? HOME,
      to: s.toDestinationId ?? HOME,
      mode: s.mode,
      timed: s.departAt !== null && s.arriveAt !== null,
    }));

  // gaps.open — the trip's open-day runs from the shipped day projection.
  const { days } = deriveDays(trip, destinations, trip.segments);
  const open: string[] = [];
  let runStart: IsoDate | null = null;
  let runEnd: IsoDate | null = null;
  for (const day of days) {
    if (day.kind === "empty") {
      runStart ??= day.date;
      runEnd = day.date;
    } else if (runStart !== null) {
      open.push(`${md(runStart)}..${md(runEnd!)}`);
      runStart = runEnd = null;
    }
  }
  if (runStart !== null) open.push(`${md(runStart)}..${md(runEnd!)}`);

  const noStay = destinations.filter((d) => isScheduled(d) && stayOf(d) === null).map((d) => d.id);

  const rated = (r: NextTimeRow) => (r.rating !== null ? `${r.name} ★${r.rating}` : r.name);

  return {
    trip: {
      id: trip.id,
      title: trip.title,
      dates: [trip.startDate, trip.endDate],
      status: trip.status,
      defaults: { mode: trip.defaultMode, rig: trip.rigOn },
      homeBase: trip.homeBase,
    },
    route,
    hops,
    gaps: { open, noStay },
    nearby: nearby.items.map((n) => ({
      saveId: n.saveId,
      name: n.name,
      near: n.nearestDestination.id,
      mi: Math.round(n.distanceMi * 10) / 10,
      ...(n.source ? { source: n.source } : {}),
    })),
    lastTime: nextTime.cards.map((c) => ({
      near: c.destination.id,
      trip: c.pastTrip.title,
      again: c.again.map(rated),
      once: c.once.map(rated),
    })),
    more: CONTEXT_MORE,
  };
}
