import { haversineMeters } from "../providers/index";
import type {
  IsoDate,
  ReservationType,
  SavedPlace,
  SavedPlaceCreate,
  Trip,
} from "./types";

/**
 * "Been there?" suggestions and the rule that decides one — docs/design/41 §7.
 *
 * All of it is pure and lives here because the two surfaces that consume it
 * (the /places server component and its client island) have no test runner.
 * The database query is a `SELECT` plus `suggestionsFromTrips`; the shelf is a
 * `buildSuggestionShelf` call plus JSX. Every decision is in this file.
 */

/** The shape the match rule compares. Deliberately narrow: a name, the row's
 * OWN coordinates, and its own Google id. See rule 4. */
export interface MatchCandidate {
  name: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId: string | null;
}

/** Rule 3's guard: two rows of the same name farther apart than this are two
 * different places (§7). */
export const SAME_PLACE_METERS = 150;

/** Q4=B: only stops and reservations you actually liked graduate. */
export const SUGGESTION_MIN_RATING = 4;

/**
 * Rule 2's comparison form: lowercase, trim, collapse internal whitespace,
 * strip `.` `,` `'` `&`. Nothing fuzzier — Q5=C was rejected precisely so that
 * a shared region word ("Newport, OR" vs "Local Ocean Seafoods") can never
 * collapse two places into one.
 */
export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'&’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCoords(c: MatchCandidate): c is MatchCandidate & { lat: number; lng: number } {
  return c.lat !== null && c.lng !== null;
}

/**
 * Is this candidate already in the library? The four rules of §7, in order:
 *
 * 1. Both sides carry a non-null `googlePlaceId` and they are equal → match.
 *    Nothing else is consulted.
 * 2. Otherwise the normalized names must be equal. Unequal → no match, at any
 *    distance. (Fishing Bridge, WY and Fishing Bridge RV Park sit on identical
 *    coordinates in the seed and stay separate: a campground is not its town.)
 * 3. Names being equal, coordinates are a tiebreaker rather than a
 *    requirement. Both sides carrying real coordinates → `haversineMeters` must
 *    be within {@link SAME_PLACE_METERS}. Either side coordless → the guard has
 *    nothing to measure, so name equality alone matches (Gap 3).
 * 4. Borrowed coordinates never enter the comparison. That is a contract on the
 *    CALLER: a reservation may inherit its stop's pin for display, never for
 *    matching, so {@link suggestionsFromTrips} leaves a reservation's lat/lng
 *    null rather than copying the stop's. Comparing a campground against a town
 *    centroid is the bug this rule exists to avoid.
 */
export function isAlreadySaved(c: MatchCandidate, library: MatchCandidate[]): boolean {
  const name = normalizePlaceName(c.name);
  return library.some((row) => {
    if (c.googlePlaceId !== null && row.googlePlaceId === c.googlePlaceId) return true;
    if (normalizePlaceName(row.name) !== name) return false;
    if (!hasCoords(c) || !hasCoords(row)) return true;
    return haversineMeters(c, row) <= SAME_PLACE_METERS;
  });
}

/** A library row as the rule sees it. */
export function matchCandidateFromSaved(p: SavedPlace): MatchCandidate {
  return {
    name: p.place.name,
    lat: p.place.lat,
    lng: p.place.lng,
    googlePlaceId: p.place.googlePlaceId,
  };
}

/** Where a suggestion came from. A reservation names an actual place; a stop
 * names a town — both graduate under Q4=B. */
export type SuggestionKind = "stop" | "reservation";

/**
 * A rated row from a complete trip, offered to the library. It is NOT a
 * `SavedPlace`: it has no `id` of its own in `saved_places` and no `ownerId`
 * until it is accepted, which is why the suggested card is app-local rather
 * than the DS `PlaceCard`.
 */
export interface PlaceSuggestion extends MatchCandidate {
  /** `${kind}:${id}` — stable, and the key "Not now" dismisses by. */
  key: string;
  kind: SuggestionKind;
  /** The source row's id (a stop id or a reservation id). */
  id: string;
  /** Display region. A reservation borrows its parent stop's NAME for the line
   * under the title — a display string, never a coordinate. */
  region: string | null;
  type: ReservationType;
  /** Always >= {@link SUGGESTION_MIN_RATING}; that is what makes it a candidate. */
  rating: number;
  note: string | null;
  tripId: string;
  tripTitle: string;
  tripEndDate: IsoDate;
}

/**
 * The candidate set (Q4=B): every stop AND every reservation rated >= 4 on a
 * trip that is `complete`. Ordered most-recent trip first, then by rating, then
 * by name — so the shelf's headline names the trip you just finished.
 *
 * Against the seed exactly as it ships this is EMPTY: the trip with ratings is
 * still `planning` and the two complete trips rate nothing (docs/design/41
 * Gap 3b). Mark Pacific Northwest Loop complete and it is four candidates —
 * two stops (Astoria ★5, Newport ★4) and two reservations (the KOA ★5, South
 * Beach ★4) — of which South Beach is already in the library, leaving three
 * suggestions. The wireframe's §7 worked example counted only reservations and
 * so said one; the rule it specifies is implemented here verbatim, and Q4=B is
 * what makes the stops candidates too.
 */
export function suggestionsFromTrips(trips: Trip[]): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  for (const trip of trips) {
    if (trip.status !== "complete") continue;
    const from = { tripId: trip.id, tripTitle: trip.title, tripEndDate: trip.endDate };
    for (const leg of trip.legs) {
      for (const stop of leg.stops) {
        if (stop.rating !== null && stop.rating >= SUGGESTION_MIN_RATING) {
          out.push({
            key: `stop:${stop.id}`,
            kind: "stop",
            id: stop.id,
            name: stop.place.name,
            lat: stop.place.lat,
            lng: stop.place.lng,
            googlePlaceId: stop.place.googlePlaceId,
            // A stop's own name IS the region line; it has no second one.
            region: null,
            // `stops` carry no category — a town is not a campground.
            type: "other",
            rating: stop.rating,
            note: stop.notes,
            ...from,
          });
        }
        for (const res of stop.reservations) {
          if (res.rating === null || res.rating < SUGGESTION_MIN_RATING) continue;
          out.push({
            key: `reservation:${res.id}`,
            kind: "reservation",
            id: res.id,
            name: res.name,
            // Rule 4: `reservations` has no lat/lng column and never borrows
            // the stop's pin. A graduated reservation lands coordless and shows
            // up in the map's "N unmapped" count until Locate places it.
            lat: null,
            lng: null,
            googlePlaceId: null,
            region: stop.place.name,
            type: res.type,
            rating: res.rating,
            note: res.notes,
            ...from,
          });
        }
      }
    }
  }
  return out.sort(bySuggestionOrder);
}

/** Most recent trip first, then the strongest rating, then the name. The
 * shelf's headline reads the head of this order, so it is applied wherever a
 * suggestion list is built — not left to the caller. */
function bySuggestionOrder(a: PlaceSuggestion, b: PlaceSuggestion): number {
  return (
    b.tripEndDate.localeCompare(a.tripEndDate) ||
    b.rating - a.rating ||
    a.name.localeCompare(b.name)
  );
}

/** The suggestion bar plus the cards under it — or nothing at all. */
export interface SuggestionShelf {
  /** "Pacific Northwest Loop is complete." */
  headline: string;
  /** "1 place you rated ★4 or better isn't in your library yet." */
  detail: string;
  suggestions: PlaceSuggestion[];
}

/**
 * The shelf, or `null` when there is nothing to show.
 *
 * `null` is the whole of Gap 3b: the bar and the suggested cards are ABSENT,
 * never empty-stated. A shelf that says "nothing here" on a page that already
 * has content is noise, and `EmptyShelf` keeps its own job (an empty shelf).
 *
 * `library` is the account's saved places as {@link matchCandidateFromSaved}
 * sees them, so accepting a suggestion removes it from the shelf on the next
 * render without any second bookkeeping: the accepted row IS the library row
 * the rule now matches.
 */
export function buildSuggestionShelf(
  candidates: PlaceSuggestion[],
  library: MatchCandidate[],
  dismissedKeys: readonly string[] = [],
): SuggestionShelf | null {
  const dismissed = new Set(dismissedKeys);
  const suggestions = candidates
    .filter((c) => !dismissed.has(c.key) && !isAlreadySaved(c, library))
    .sort(bySuggestionOrder);
  if (suggestions.length === 0) return null;
  const n = suggestions.length;
  return {
    // Sorted most-recent-trip-first, so the head of the list names the trip the
    // user just finished. (The wireframe draws one trip's worth; when two
    // complete trips both contribute, the newer one is the one worth naming.)
    headline: `${suggestions[0]!.tripTitle} is complete.`,
    detail:
      n === 1
        ? "1 place you rated ★4 or better isn’t in your library yet."
        : `${n} places you rated ★4 or better aren’t in your library yet.`,
    suggestions,
  };
}

/**
 * Accepting a suggestion — the "Add to Been" button. The library row does not
 * exist yet, so this is a POST body (`tripApi.savePlace`), not a patch: the
 * rating and the trip come across as the archive metadata they already are,
 * and `source` stays null because nobody told you about a place you went to.
 */
export function suggestionToCreate(s: PlaceSuggestion): SavedPlaceCreate {
  return {
    name: s.name,
    region: s.region,
    lat: s.lat,
    lng: s.lng,
    googlePlaceId: s.googlePlaceId,
    type: s.type,
    status: "been",
    note: s.note,
    source: null,
    rating: s.rating,
    tripId: s.tripId,
  };
}
