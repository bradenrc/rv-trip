import { hasCoords } from "../domain/bounds";
import { saveTypeOfIdeaCategory } from "../domain/been-write-through";
import type { Destination, Idea, IsoDate, Trip } from "../domain/types";
import { categoryOf, type RvCategory } from "../theme/tokens";
import { activeTrip, todaysDestination, tripJournal, type JournalEntry } from "./journal";
import { tripDestinationPins } from "./map-pins";

/**
 * #179 · #181 i5 — the Journal map (docs/design/181 frames 4 and 5): what the
 * Journal lists, as points. A pure function of the trip the screen already
 * holds; it makes no request of any kind.
 *
 * - Destination points come from `tripDestinationPins`, limited to the
 *   destinations `tripJournal` lists. While the trip covers today, only today's
 *   destination and the ones already arrived at are drawn (today's is drawn
 *   even before anything is logged there), so a future stop never shows up
 *   mid-trip. `ordinal` is `scheduledOrder`'s; `been` is `departDate < today`,
 *   or true when today is unknown.
 * - Entry points are the listed IDEA entries whose `idea.place` has
 *   coordinates, in their five-category colour. A reservation has no place of
 *   its own, so it sits under its destination's disc.
 * - `join` is the scheduled destination points in arrival order as `[lng, lat]`
 *   — one straight dashed line, never routed, never labelled.
 * - `unmapped` counts the listed destinations and idea entries with no
 *   coordinates.
 *
 * A destination point's id is the destination id (it selects the group
 * heading); an entry point's id is the idea id (it selects the row).
 */
export interface JournalMapPoint {
  id: string;
  kind: "destination" | "entry";
  lat: number;
  lng: number;
  name: string;
  /** 1-based scheduled position; null for an entry or a floating destination. */
  ordinal: number | null;
  been: boolean;
  /** The five-category language (`@rv-trip/ui`'s `CategoryLabel`). A
   * destination carries none of its own, so it is "Other". */
  category: RvCategory;
}

export interface JournalMap {
  points: JournalMapPoint[];
  join: [number, number][];
  unmapped: number;
}

export function journalMap(trip: Trip, today: IsoDate | null): JournalMap {
  const journal = tripJournal(trip);
  const midTrip = today !== null && activeTrip([trip], today) !== null;
  const here = midTrip ? (todaysDestination([trip], today)?.destination ?? null) : null;

  const allDestinations = trip.chapters.flatMap((c) => c.destinations);
  const listed = new Map<string, JournalEntry[]>(journal.destinations.map((g) => [g.destination.id, g.entries]));
  if (here && !listed.has(here.id)) listed.set(here.id, []);
  const shown = (d: Destination) =>
    listed.has(d.id) && (!midTrip || (d.arriveDate !== null && d.arriveDate <= today!));
  const destinations = allDestinations.filter(shown);
  const shownIds = new Set(destinations.map((d) => d.id));

  const been = (d: Destination) => today === null || (d.departDate !== null && d.departDate < today);
  const byId = new Map(allDestinations.map((d) => [d.id, d]));
  const destinationPoints: JournalMapPoint[] = tripDestinationPins(trip)
    .filter((p) => shownIds.has(p.id))
    .map((p) => ({
      id: p.id,
      kind: "destination",
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      ordinal: p.ordinal,
      been: been(byId.get(p.id)!),
      category: "Other",
    }));

  const ideas = new Map<string, Idea>(
    [...allDestinations.flatMap((d) => d.ideas), ...trip.ideas].map((i) => [i.id, i]),
  );
  const ideaEntries = [...destinations.flatMap((d) => listed.get(d.id) ?? []), ...journal.around].filter(
    (e) => e.kind === "idea",
  );
  const entryPoints: JournalMapPoint[] = [];
  let unmapped = destinations.filter((d) => !hasCoords(d.place)).length;
  for (const e of ideaEntries) {
    const idea = ideas.get(e.id);
    if (!idea?.place || !hasCoords(idea.place)) {
      unmapped += 1;
      continue;
    }
    entryPoints.push({
      id: idea.id,
      kind: "entry",
      lat: idea.place.lat,
      lng: idea.place.lng,
      name: idea.title,
      ordinal: null,
      been: true,
      category: categoryOf(saveTypeOfIdeaCategory(idea.category)).cat,
    });
  }

  const join = destinationPoints
    .filter((p) => p.ordinal !== null)
    .sort((a, b) => a.ordinal! - b.ordinal!)
    .map((p) => [p.lng, p.lat] as [number, number]);

  return { points: [...destinationPoints, ...entryPoints], join, unmapped };
}
