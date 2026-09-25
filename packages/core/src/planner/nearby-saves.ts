import { hasCoords } from "../domain/bounds";
import { isAlreadySaved, type MatchCandidate } from "../domain/places";
import type {
  Idea,
  IdeaCategory,
  IdeaCreateInput,
  NearbySave,
  NearbySaves,
  NearbySavesBeyond,
  SavedPlace,
  SurfaceRadiusMi,
  Trip,
} from "../domain/types";
import { SURFACE_RADII } from "../domain/types";
import { haversineMeters } from "../providers/index";
import { categoryOf } from "../theme/tokens";
import { METERS_PER_MILE, NEAR_RADIUS_MI, locatedStops, shelfMiles, type StopAnchor } from "./shelf";

/**
 * Trip surfacing (#111 i3 · docs/design/111 "#102 · trip surfacing", Q6 A ·
 * Q7 B): which of your saves sit near this trip.
 *
 * A PURE function of the trip, the library and the trip's dismissals, so the
 * phone's banner, the review sheet and (i4) the web's server-rendered banner
 * all draw the same numbers from one place. The route handler
 * (`GET /api/trips/:id/nearby-saves`) is a read of three things and a call to
 * this.
 */

/** One save, measured: the save, its nearest located stop, and the raw miles. */
interface Measured {
  save: SavedPlace;
  stop: StopAnchor;
  mi: number;
}

/**
 * The point a save is measured FROM: its own lat/lng, or — for an area save
 * that has none (a web note, "in the Bandon area") — its destination's. A save
 * with neither measures nothing and is skipped. The destination's point is used
 * for distance ONLY; the match against the trip's ideas (`isAlreadySaved`)
 * sees the save's own coordinates (rule 4 in domain/places.ts: borrowed
 * coordinates never enter a comparison).
 */
function pointOf(s: SavedPlace): { lat: number; lng: number } | null {
  if (hasCoords(s.place)) return { lat: s.place.lat, lng: s.place.lng };
  const d = s.destination;
  if (d && d.lat !== null && d.lng !== null) return { lat: d.lat, lng: d.lng };
  return null;
}

function nearest(point: { lat: number; lng: number }, anchors: StopAnchor[]): { stop: StopAnchor; mi: number } {
  let best = anchors[0]!;
  let bestM = haversineMeters(point, best);
  for (const a of anchors.slice(1)) {
    const m = haversineMeters(point, a);
    if (m < bestM) {
      best = a;
      bestM = m;
    }
  }
  return { stop: best, mi: bestM / METERS_PER_MILE };
}

/** Every idea already on the trip — the shelf's AND the ones attached to a
 * stop, since an added save dragged onto a stop is still on this trip. Only an
 * idea with a place can match a save. */
function ideaPlaces(trip: Trip): MatchCandidate[] {
  const all: Idea[] = [...trip.ideas, ...trip.legs.flatMap((l) => l.stops.flatMap((s) => s.ideas))];
  return all.flatMap((i) => (i.place ? [i.place] : []));
}

/** The chip after this one (25 → 50 → 100 → 200), or null past the last. */
export function nextSurfaceRing(radiusMi: number): SurfaceRadiusMi | null {
  return SURFACE_RADII.find((r) => r > radiusMi) ?? null;
}

const oneDecimal = (mi: number) => Math.round(mi * 10) / 10;

/**
 * The saves within `radiusMi` of a located stop (floating stops count),
 * nearest first, and the `beyond` hint for the next ring out.
 *
 * - `radiusMi` null → `NEAR_RADIUS_MI` (the trip has never picked a chip).
 * - Left out: dismissed ids, and saves already on the trip as an idea.
 * - Items carry distance at the shelf's precision (`shelfMiles`); membership
 *   and order use the RAW miles, so 6.17 sorts before 6.20 though both print
 *   "6.2".
 * - `beyond` counts the saves past the radius but inside the next ring, with
 *   the nearest at one decimal. Null at 200 (no next ring) and when that ring
 *   is empty — the line has nothing to say.
 */
export function nearbySaves(
  trip: Trip,
  saves: SavedPlace[],
  dismissedSaveIds: Iterable<string>,
  radiusMi: number | null,
): NearbySaves {
  const radius = radiusMi ?? NEAR_RADIUS_MI;
  const anchors = locatedStops(trip);
  if (anchors.length === 0) return { radiusMi: radius, items: [], beyond: null };

  const dismissed = new Set(dismissedSaveIds);
  const onTrip = ideaPlaces(trip);

  const measured: Measured[] = [];
  for (const save of saves) {
    if (dismissed.has(save.id)) continue;
    const point = pointOf(save);
    if (!point) continue;
    if (isAlreadySaved(save.place, onTrip)) continue;
    const { stop, mi } = nearest(point, anchors);
    measured.push({ save, stop, mi });
  }
  measured.sort((a, b) => a.mi - b.mi || a.save.place.name.localeCompare(b.save.place.name));

  const items = measured.filter((m) => m.mi <= radius).map(toItem);

  const ring = nextSurfaceRing(radius);
  let beyond: NearbySavesBeyond | null = null;
  if (ring !== null) {
    const past = measured.filter((m) => m.mi > radius && m.mi <= ring);
    if (past.length > 0) {
      beyond = {
        radiusMi: ring,
        count: past.length,
        nearestMi: oneDecimal(past[0]!.mi),
        nearestName: past[0]!.save.place.name,
      };
    }
  }
  return { radiusMi: radius, items, beyond };
}

function toItem({ save, stop, mi }: Measured): NearbySave {
  return {
    saveId: save.id,
    name: save.place.name,
    type: save.type,
    status: save.status,
    rating: save.rating,
    source: save.source,
    place: save.place,
    nearestStop: { id: stop.id, name: stop.name },
    distanceMi: shelfMiles(mi),
  };
}

// ── copy ─────────────────────────────────────────────────────────────────────
// The design's strings, in one place, so the phone (i3) and the web (i4) say
// the same thing.

/** The rv-info banner at the top of the Route lens. */
export function nearbyBanner(n: number, radiusMi: number): { title: string; sub: string; dismiss: string } {
  return {
    title: n === 1 ? "1 of your saves is near this trip" : `${n} of your saves are near this trip`,
    sub: `within ${radiusMi} mi of a stop · tap to review`,
    dismiss: "Dismiss",
  };
}

/** The sheet head's mono count ("4 saves"). */
export function nearbyCountLabel(n: number): string {
  return `${n} save${n === 1 ? "" : "s"}`;
}

/** A row's second line: distance · nearest stop · who. A been save reads
 * "Been" there — the Stars are drawn after it. */
export function nearbyRowLine(item: NearbySave): string {
  const who = item.status === "been" ? "Been" : item.source;
  return [`${item.distanceMi} mi`, item.nearestStop.name, who].filter(Boolean).join(" · ");
}

/** The dashed line under the rows: "**1 more just past 50 mi**, the nearest at
 * 50.3 mi (Cape Lookout State Park). Tap 100 mi." — `lead` is the bold half. */
export function nearbyBeyondLine(beyond: NearbySavesBeyond, radiusMi: number): { lead: string; rest: string } {
  return {
    lead: `${beyond.count} more just past ${radiusMi} mi`,
    rest: `, the nearest at ${beyond.nearestMi} mi (${beyond.nearestName}). Tap ${beyond.radiusMi} mi.`,
  };
}

/** The ghost button — N is what is still to add in the open sheet. */
export function addAllLabel(n: number): string {
  return `Add all ${n} to ideas`;
}

/** The Route lens's compact shelf head. */
export function ideasHeading(n: number): string {
  return `Ideas · ${n}`;
}

export const IDEAS_EMPTY_COPY = "No ideas yet. Your saves above are the fastest way to start.";

/** A save's type as the idea category it is born with — the five-category
 * language (`categoryOf(type).cat`): Stay → stay, Eat → eat, the rest → do.
 * The same bridge as the DS's `ideaCategoryOfType` (packages/ui/src/category.ts),
 * which the phone cannot import. */
function ideaCategoryOf(type: NearbySave["type"]): IdeaCategory {
  switch (categoryOf(type).cat) {
    case "Stay":
      return "stay";
    case "Eat":
      return "eat";
    default:
      return "do";
  }
}

/**
 * Add → the shipped `POST /api/ideas` body: a shelf idea (`stopId` null) that
 * COPIES the save — name, place, type as category, source as the note — the
 * same one-way copy as the web's "Add from Places" (TripPlanner
 * `addIdeaFromPlace`). No link back to the save.
 */
export function nearbyIdeaBody(tripId: string, item: NearbySave): IdeaCreateInput {
  return {
    tripId,
    stopId: null,
    category: ideaCategoryOf(item.type),
    title: item.name,
    status: "idea",
    place: item.place,
    rating: null,
    notes: item.source,
  };
}
