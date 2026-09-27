import type {
  ReservationType,
  SaveDestination,
  SavedPlace,
  SavedPlaceStatus,
  SuggestedPlace,
} from "../domain/types";
import type { PlaceSummary } from "../providers/index";
import { formatCoords, placeRowSubline } from "./sheet";

/**
 * The Saves tab (#111 i2 · docs/design/111 "The Saves tab", Q4 B), pure, so
 * the phone and the web (i4) render one answer and the order is tested where a
 * runner runs.
 */

export interface DestinationShelf {
  destination: SaveDestination;
  /** Newest first by `createdAt`. */
  saves: SavedPlace[];
}

export interface RegionShelf {
  /** `destinations.region` ("Oregon", "Costa Rica"). A header only. Null when
   * the resolver named no region — those destinations still group together. */
  region: string | null;
  /** Saves under this header, summed across its destinations. */
  count: number;
  /** Alphabetical by name. */
  destinations: DestinationShelf[];
}

export interface SavesShelves {
  /** Most saves first; a tie goes to the region name. */
  regions: RegionShelf[];
  /** `destination` null — no locality within 25 mi, or no provider key.
   * Newest first. Always drawn last. */
  unanchored: SavedPlace[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** Newest first; a save with no `createdAt` (an older server) sorts last,
 * keeping its input order (Array.prototype.sort is stable). */
function newestFirst(a: SavedPlace, b: SavedPlace): number {
  if (a.createdAt === b.createdAt) return 0;
  if (a.createdAt === null) return 1;
  if (b.createdAt === null) return -1;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

/**
 * One shelf (`status`) of the library, grouped by destination under region
 * headers: regions by save count (most first, ties by name), destinations
 * alphabetically, saves newest first, and the saves with no destination in
 * `unanchored`.
 */
export function savesShelves(saves: SavedPlace[], status: SavedPlaceStatus): SavesShelves {
  const regions = new Map<string | null, Map<string, DestinationShelf>>();
  const unanchored: SavedPlace[] = [];
  for (const s of saves) {
    if (s.status !== status) continue;
    if (!s.destination) {
      unanchored.push(s);
      continue;
    }
    const region = s.destination.region;
    let dests = regions.get(region);
    if (!dests) regions.set(region, (dests = new Map()));
    let shelf = dests.get(s.destination.id);
    if (!shelf) dests.set(s.destination.id, (shelf = { destination: s.destination, saves: [] }));
    shelf.saves.push(s);
  }
  const out: RegionShelf[] = [...regions].map(([region, dests]) => {
    const destinations = [...dests.values()]
      .map((d) => ({ ...d, saves: [...d.saves].sort(newestFirst) }))
      .sort((a, b) => byName(a.destination.name, b.destination.name));
    return { region, count: destinations.reduce((n, d) => n + d.saves.length, 0), destinations };
  });
  out.sort((a, b) => b.count - a.count || byName(a.region ?? "", b.region ?? ""));
  return { regions: out, unanchored: unanchored.sort(newestFirst) };
}

/** The Want to go / Been there segment's counts. */
export function shelfCounts(saves: Pick<SavedPlace, "status">[]): Record<SavedPlaceStatus, number> {
  const counts: Record<SavedPlaceStatus, number> = { want: 0, been: 0 };
  for (const s of saves) counts[s.status] += 1;
  return counts;
}

/**
 * A place save's kind word, the way the wireframe's "Restaurant · Bend, OR"
 * row reads it. The read shape keeps our type, not Google's display name.
 */
const KIND_WORD: Record<ReservationType, string> = {
  campground: "Campground",
  lodging: "Lodging",
  dining: "Restaurant",
  event: "Event",
  tour: "Tour",
  activity: "Activity",
  transport: "Transport",
  other: "Place",
};

/** "Bandon, OR" → "Bandon". */
const town = (label: string) => label.split(",")[0]!.trim();

/**
 * A row's second line. The tip's source wins ("Heard from Jane & Rick", as the
 * shipped `PlaceCard` draws it); otherwise the anchor line: "pin · 43.0500,
 * −124.3300", "note · Bandon area", or "Restaurant · Bend, OR".
 */
export function saveRowLine(s: SavedPlace): string {
  if (s.source) return `Heard from ${s.source}`;
  if (s.anchor === "pin" && s.place.lat != null && s.place.lng != null) {
    return `pin · ${formatCoords(s.place.lat, s.place.lng)}`;
  }
  if (s.anchor === "area") {
    const label = s.areaLabel ?? s.destination?.name ?? null;
    return label ? `note · ${town(label)} area` : "note";
  }
  const where = s.destination?.name ?? s.region;
  return where ? `${KIND_WORD[s.type]} · ${where}` : KIND_WORD[s.type];
}

/**
 * The Q3 A offer for an offline note: the TOP text-search hit near where it
 * was typed, as `saves.suggested_place` stores it. Null for no hits.
 */
export function suggestedPlaceFromSearch(results: PlaceSummary[]): SuggestedPlace | null {
  const top = results[0];
  if (!top) return null;
  const subline = placeRowSubline(top);
  return {
    name: top.name,
    googlePlaceId: top.googlePlaceId,
    lat: top.location?.lat ?? null,
    lng: top.location?.lng ?? null,
    subline: subline || null,
  };
}

/** The rv-info strip under a save with a suggestion. Tapping it upgrades. */
export function suggestionStrip(p: SuggestedPlace): { title: string; sub: string | null; dismiss: string } {
  return { title: `Did you mean ${p.name}?`, sub: p.subline, dismiss: "Dismiss" };
}
