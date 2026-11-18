import type {
  ReservationType,
  SaveArea,
  SavedPlace,
  SavedPlaceStatus,
  SuggestedPlace,
} from "../domain/types";
import { haversineMeters, type LatLng, type PlaceSummary } from "../providers/index";
import { savePoint } from "../planner/nearby-saves";
import { METERS_PER_MILE, NEAR_RADIUS_MI } from "../planner/shelf";
import { categoryOf } from "../theme/tokens";
import { formatCoords, placeRowSubline } from "./sheet";

/**
 * The Saves tab (#111 i2 · docs/design/111 "The Saves tab", Q4 B), pure, so
 * the phone and the web (i4) render one answer and the order is tested where a
 * runner runs.
 */

export interface AreaShelf {
  area: SaveArea;
  /** Newest first by `createdAt`. */
  saves: SavedPlace[];
}

export interface RegionShelf {
  /** `areas.region` ("Oregon", "Costa Rica"). A header only. Null when
   * the resolver named no region — those areas still group together. */
  region: string | null;
  /** Saves under this header, summed across its areas. */
  count: number;
  /** Alphabetical by name. */
  areas: AreaShelf[];
}

export interface SavesShelves {
  /** Most saves first; a tie goes to the region name. */
  regions: RegionShelf[];
  /** `area` null — no locality within 25 mi, or no provider key.
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
 * One shelf (`status`) of the library, grouped by area under region
 * headers: regions by save count (most first, ties by name), areas
 * alphabetically, saves newest first, and the saves with no area in
 * `unanchored`.
 */
export function savesShelves(saves: SavedPlace[], status: SavedPlaceStatus): SavesShelves {
  const regions = new Map<string | null, Map<string, AreaShelf>>();
  const unanchored: SavedPlace[] = [];
  for (const s of saves) {
    if (s.status !== status) continue;
    if (!s.area) {
      unanchored.push(s);
      continue;
    }
    const region = s.area.region;
    let dests = regions.get(region);
    if (!dests) regions.set(region, (dests = new Map()));
    let shelf = dests.get(s.area.id);
    if (!shelf) dests.set(s.area.id, (shelf = { area: s.area, saves: [] }));
    shelf.saves.push(s);
  }
  const out: RegionShelf[] = [...regions].map(([region, dests]) => {
    const areas = [...dests.values()]
      .map((d) => ({ ...d, saves: [...d.saves].sort(newestFirst) }))
      .sort((a, b) => byName(a.area.name, b.area.name));
    return { region, count: areas.reduce((n, d) => n + d.saves.length, 0), areas };
  });
  out.sort((a, b) => b.count - a.count || byName(a.region ?? "", b.region ?? ""));
  return { regions: out, unanchored: unanchored.sort(newestFirst) };
}

/**
 * The Places tab's category chips (#186 i1 · #182, q3 A). Travel and Other
 * have no chip: those saves show under All only.
 */
export type PlacesCategory = "All" | "Stay" | "Eat" | "Do";
export const PLACES_CATEGORIES: readonly PlacesCategory[] = ["All", "Stay", "Eat", "Do"];

export interface NearYouSave {
  save: SavedPlace;
  /** Raw miles from `here` to `savePoint(save)`. Clients round for display. */
  mi: number;
}

export interface NearYou {
  /** Within `NEAR_RADIUS_MI` of `here`, nearest first. Empty when `here` is null. */
  near: NearYouSave[];
  /** Everything else on the shelf, grouped exactly as `savesShelves` does. */
  rest: SavesShelves;
  /** The filtered count (status + category) — the chip's number. */
  total: number;
}

/**
 * The Places tab with a "Near you" group on top (#186 i1 · #182, q1 A · q2
 * A · q3 A). Filters by shelf (`status`), then by chip (`cat`, matched on
 * `categoryOf(type).cat`). With no location (`here` null) there is no near
 * group and `rest` is today's `savesShelves` list. Otherwise every filtered
 * save whose `savePoint` (own lat/lng, else its area's) is within
 * `NEAR_RADIUS_MI` is near, nearest first; a save with no point is never near.
 */
export function nearYou(
  saves: SavedPlace[],
  status: SavedPlaceStatus,
  here: LatLng | null,
  cat: PlacesCategory,
): NearYou {
  const filtered = saves.filter(
    (s) => s.status === status && (cat === "All" || categoryOf(s.type).cat === cat),
  );
  if (!here) return { near: [], rest: savesShelves(filtered, status), total: filtered.length };

  const near: NearYouSave[] = [];
  const rest: SavedPlace[] = [];
  for (const save of filtered) {
    const point = savePoint(save);
    const mi = point ? haversineMeters(here, point) / METERS_PER_MILE : null;
    if (mi !== null && mi <= NEAR_RADIUS_MI) near.push({ save, mi });
    else rest.push(save);
  }
  near.sort((a, b) => a.mi - b.mi || a.save.place.name.localeCompare(b.save.place.name));
  return { near, rest: savesShelves(rest, status), total: filtered.length };
}

/** A stored chip value (`rv-places-cat`, #186 i2 · q4 A) narrowed to the four
 * chips this build draws — a stale "Travel" from before q3 A reads as absent. */
export function isPlacesCategory(v: unknown): v is PlacesCategory {
  return typeof v === "string" && (PLACES_CATEGORIES as readonly string[]).includes(v);
}

/**
 * The location chip's place name (#186 i2): the area of the nearest near save
 * that has one, else the resolved locality, else null — the chip then reads
 * "Near you". Pass the active shelf's All-category `near`, so the name does
 * not change with the chip you pick.
 */
export function nearYouName(near: NearYouSave[], resolved: string | null): string | null {
  for (const n of near) if (n.save.area) return n.save.area.name;
  return resolved;
}

const SHELF_WORDS: Record<SavedPlaceStatus, string> = { want: "Want to go", been: "Been there" };

/** The dashed line under a chip with nothing on this shelf: "No eat places on Want to go yet." */
export function placesCategoryEmpty(cat: Exclude<PlacesCategory, "All">, status: SavedPlaceStatus): string {
  return `No ${cat.toLowerCase()} places on ${SHELF_WORDS[status]} yet.`;
}

/** The "Near you" heading's right-hand note: "within 50 mi" (phone) or
 * "within 50 mi of Boise" (web). The radius is always miles (docs/design/186
 * "Units"): it is a fixed rule, not a measured distance. */
export function nearYouWithin(name: string | null): string {
  return `within ${NEAR_RADIUS_MI} mi${name ? ` of ${name}` : ""}`;
}

/** The dashed line under "Near you" when a fix is known and nothing is within the radius. */
export function nearYouNothing(name: string | null): string {
  return `Nothing on this shelf within ${NEAR_RADIUS_MI} mi${name ? ` of ${name}` : ""}.`;
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
    const label = s.areaLabel ?? s.area?.name ?? null;
    return label ? `note · ${town(label)} area` : "note";
  }
  const where = s.area?.name ?? s.region;
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
