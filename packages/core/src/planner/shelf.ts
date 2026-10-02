import { hasCoords } from "../domain/bounds";
import type { Idea, IdeaCategory, Trip } from "../domain/types";
import { haversineMeters } from "../providers/index";

/**
 * The trip's idea SHELF — the side-rail model for #80.
 *
 * Everything the rail draws is decided here, so the rail itself is JSX over a
 * model: which rows are on the shelf (`destinationId === null` and nothing else),
 * which of the three groups each one sits in, how far it is from the nearest
 * destination you have actually placed, and what the proximity chips above them say.
 *
 * It is a PURE function of the trip, which is why it lives beside the timeline
 * model rather than inside the React tree: the web renders it in a `useMemo`
 * and the phone will render the same numbers from the same function.
 */

/**
 * "Near" is 50 miles. One named constant rather than a magic number at the two
 * places that need it (the chip's membership test and the chip's count),
 * because the radius is a product decision — an RV hour — not an implementation
 * detail.
 */
export const NEAR_RADIUS_MI = 50;

export const METERS_PER_MILE = 1609.344;

/** Stay first, then Eat, then Do — the frame's order, and the order the groups
 * are built in so the rail never has to sort them. */
export const SHELF_CATEGORY_ORDER: IdeaCategory[] = ["stay", "eat", "do"];

/** The three words the product speaks, as the group headings render them. */
export const SHELF_CATEGORY_LABEL: Record<IdeaCategory, string> = {
  stay: "Stay",
  eat: "Eat",
  do: "Do",
};

/** One shelf row: the idea, plus where it sits relative to the trip. */
export interface ShelfIdea {
  idea: Idea;
  /** The nearest destination that HAS coordinates, or null when either side has none.
   * This is the source of the row's "… · 12 mi" line — there is no city column
   * on an idea, so the anchor named is a destination the trip already owns. */
  nearestDestinationId: string | null;
  nearestDestinationName: string | null;
  /** Miles to that destination, rounded to one decimal under 10 and whole above it —
   * the precision the frame draws ("1.4 mi", "33 mi"). Null with no anchor. */
  distanceMi: number | null;
}

export interface ShelfGroup {
  category: IdeaCategory;
  label: string;
  ideas: ShelfIdea[];
}

/** Which chip is pressed. `all` is the default and the reset. */
export type ShelfFilter =
  | { kind: "all" }
  | { kind: "near"; destinationId: string }
  | { kind: "coordless" };

export interface ShelfChip {
  /** Stable key for React and for the pressed-state comparison. */
  key: string;
  label: string;
  count: number;
  filter: ShelfFilter;
  /**
   * The amber one. "No place yet" is not another slice of the same pile — it is
   * the pile #74's Clear place and #75's Locate do their work on, so it carries
   * the documented attention colour rather than the neutral chip.
   */
  warn: boolean;
}

export interface IdeaShelf {
  /** Every unattached idea, whatever the filter — the head's "9". */
  total: number;
  /** How many of those have no coordinates — the head's "2 not on the map". */
  coordlessCount: number;
  /** The head line under the title, or null when the shelf is empty. */
  countLabel: string | null;
  chips: ShelfChip[];
  /** The groups AFTER the filter, empty groups dropped. */
  groups: ShelfGroup[];
}

/** Miles at the precision a shelf row prints — one decimal under 10, whole
 * above ("1.4 mi", "33 mi"). Shared with `nearbySaves` (#111 i3), whose rows
 * the design draws at the same precision. */
export function shelfMiles(mi: number): number {
  return mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
}

/** Miles, at the precision the row line prints. */
function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return shelfMiles(haversineMeters(a, b) / METERS_PER_MILE);
}

/** One destination that can anchor a distance. */
export interface DestinationAnchor {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** The trip's destinations that can anchor a distance — a coordless destination measures
 * nothing, which is the same honesty rule the map's pins already follow.
 *
 * Resolved ONCE per shelf and passed down, never rebuilt per row: `ideaShelf`
 * asks the filter question once per (located destination × row) pair, so a call in
 * there would walk every chapter of the trip on each of them. */
export function locatedDestinations(trip: Trip): DestinationAnchor[] {
  return trip.chapters
    .flatMap((l) => l.destinations)
    .map((s) => ({ id: s.id, name: s.place.name, lat: s.place.lat, lng: s.place.lng }))
    .filter(hasCoords);
}

/** The shelf rows: `destinationId === null`, in group-then-sortOrder order. An idea
 * attached to a destination has ONE home and it is not this one. */
export function shelfIdeas(trip: Trip, anchors: DestinationAnchor[] = locatedDestinations(trip)): ShelfIdea[] {
  return trip.ideas
    .filter((i) => i.destinationId === null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((idea) => {
      const place = idea.place;
      if (!place || !hasCoords(place) || anchors.length === 0) {
        return { idea, nearestDestinationId: null, nearestDestinationName: null, distanceMi: null };
      }
      let best = anchors[0]!;
      let bestM = haversineMeters(place, best);
      for (const a of anchors.slice(1)) {
        const m = haversineMeters(place, a);
        if (m < bestM) {
          best = a;
          bestM = m;
        }
      }
      return {
        idea,
        nearestDestinationId: best.id,
        nearestDestinationName: best.name,
        distanceMi: milesBetween(place, best),
      };
    });
}

/** Is this row within the radius of that destination? A coordless row is within
 * nothing — it answers the "No place yet" chip instead.
 *
 * It takes the ANCHORS, not the trip: the caller already has them, and this is
 * the function asked (located destinations × rows) times. */
function matchesFilter(row: ShelfIdea, anchors: DestinationAnchor[], filter: ShelfFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "coordless") {
    return row.idea.place === null || !hasCoords(row.idea.place);
  }
  const place = row.idea.place;
  if (!place || !hasCoords(place)) return false;
  const destination = anchors.find((s) => s.id === filter.destinationId);
  if (!destination) return false;
  return haversineMeters(place, destination) / METERS_PER_MILE <= NEAR_RADIUS_MI;
}

/**
 * The whole rail, for one pressed chip.
 *
 * The proximity pairs are ideas × LOCATED destinations — single digits on a real trip
 * — but this runs in a client `useMemo` on every render of the planner, so the
 * anchors are resolved once here rather than per row, the same bounded-pairs
 * discipline the route model already keeps.
 */
export function ideaShelf(trip: Trip, filter: ShelfFilter = { kind: "all" }): IdeaShelf {
  const anchors = locatedDestinations(trip);
  const rows = shelfIdeas(trip, anchors);
  const total = rows.length;
  const coordless = rows.filter((r) => r.idea.place === null || !hasCoords(r.idea.place));
  const coordlessCount = coordless.length;

  const chips: ShelfChip[] = [];
  for (const destination of anchors) {
    const count = rows.filter((r) =>
      matchesFilter(r, anchors, { kind: "near", destinationId: destination.id }),
    ).length;
    if (count > 0) {
      chips.push({
        key: `near:${destination.id}`,
        label: `Near ${destination.name}`,
        count,
        filter: { kind: "near", destinationId: destination.id },
        warn: false,
      });
    }
  }
  chips.push({ key: "all", label: "Anywhere", count: total, filter: { kind: "all" }, warn: false });
  if (coordlessCount > 0) {
    chips.push({
      key: "coordless",
      label: "No place yet",
      count: coordlessCount,
      filter: { kind: "coordless" },
      warn: true,
    });
  }

  const visible = rows.filter((r) => matchesFilter(r, anchors, filter));
  const groups = SHELF_CATEGORY_ORDER.map((category) => ({
    category,
    label: SHELF_CATEGORY_LABEL[category],
    ideas: visible.filter((r) => r.idea.category === category),
  })).filter((g) => g.ideas.length > 0);

  const countLabel =
    total === 0 ? null : coordlessCount > 0 ? `${total} · ${coordlessCount} not on the map` : `${total}`;

  return { total, coordlessCount, countLabel, chips, groups };
}

// ── the shelf's pure mutations ─────────────────────────────────────────────
//
// The optimistic halves of the four shelf writes. Each returns a new Trip and
// takes the SAME value the PATCH body carries, so the screen and the row can
// never disagree about what was sent — the discipline every other planner
// mutation already keeps.

/** Splice the idea `POST /api/ideas` just created onto the shelf. Only the
 * server can mint an id, so this takes the row the 201 handed back. */
export function appendShelfIdea(trip: Trip, i: Idea): Trip {
  return { ...trip, ideas: [...trip.ideas, i] };
}

/** The shelf's delete — optimistic, reversed by re-appending the 201's row. */
export function removeShelfIdea(trip: Trip, ideaId: string): Trip {
  return { ...trip, ideas: trip.ideas.filter((i) => i.id !== ideaId) };
}

/** Any field of a shelf idea, applied the way `setReservationFields` applies a
 * reservation's: the patch that was sent, and nothing else. */
export function setShelfIdeaFields(trip: Trip, ideaId: string, patch: Partial<Idea>): Trip {
  return {
    ...trip,
    ideas: trip.ideas.map((i) => (i.id === ideaId ? { ...i, ...patch } : i)),
  };
}

/**
 * The drop that ATTACHES: the idea leaves the shelf and appears under a destination.
 * One tree update, so the rail and the destination never render it twice.
 */
export function attachIdeaToDestination(trip: Trip, ideaId: string, destinationId: string): Trip {
  const moving = trip.ideas.find((i) => i.id === ideaId);
  if (!moving) return trip;
  const attached: Idea = { ...moving, destinationId };
  return {
    ...trip,
    ideas: trip.ideas.filter((i) => i.id !== ideaId),
    chapters: trip.chapters.map((l) => ({
      ...l,
      destinations: l.destinations.map((s) => (s.id === destinationId ? { ...s, ideas: [...s.ideas, attached] } : s)),
    })),
  };
}

/** …and its mirror: an attached idea dragged back to the shelf. */
export function detachIdeaToShelf(trip: Trip, ideaId: string): Trip {
  const moving = trip.chapters
    .flatMap((l) => l.destinations)
    .flatMap((s) => s.ideas)
    .find((i) => i.id === ideaId);
  if (!moving) return trip;
  return {
    ...trip,
    ideas: [...trip.ideas, { ...moving, destinationId: null }],
    chapters: trip.chapters.map((l) => ({
      ...l,
      destinations: l.destinations.map((s) => ({ ...s, ideas: s.ideas.filter((i) => i.id !== ideaId) })),
    })),
  };
}
