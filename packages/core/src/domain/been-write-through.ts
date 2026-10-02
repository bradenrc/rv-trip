import { categoryOf } from "../theme/tokens";
import { isAlreadySaved, type MatchCandidate } from "./places";
import type { IdeaCategory, IdeaStatus, Place, ReservationType } from "./types";

/**
 * The Been write-through (#113 · W3 Journal, Q7 B) — the DECISION half.
 *
 * A thing checked off, rated or marked Again on a trip becomes (or updates) a
 * "been" save, so #107's "Last time here" card can find it on the next trip
 * that goes back there. packages/db's `writeThroughBeen` does the writing; the
 * choice of skip / update / create is made here, pure, where a test runner
 * runs it.
 *
 * The rules, in order:
 *
 * 1. Only a JOURNAL-WORTHY thing writes through: `status = 'done'` (ideas), a
 *    rating, or `again` set. Anything else is skipped — and nothing is ever
 *    deleted: an un-check leaves the Been save where it is.
 * 2. A reservation in the Travel category (a flight, a ferry) is skipped —
 *    you don't go back to a flight.
 * 3. The candidate is the thing's OWN place. An idea or destination with neither a
 *    Google id nor coordinates has nothing to anchor, so it is skipped. A
 *    reservation is NAME-ONLY (rule 4 of domain/places.ts: a reservation never
 *    borrows its destination's pin for matching); the destination's point only feeds the
 *    area resolver, in packages/db.
 * 4. A library row the shipped `isAlreadySaved` rule matches is UPDATED
 *    (graduated to been) — the same rule the "Been there?" shelf and nearby
 *    surfacing use, so every surface agrees on what "the same place" is.
 *    Otherwise a new save is CREATED.
 */

/** The three things that can write through, as the rule sees them. */
export type BeenThing =
  | {
      kind: "idea";
      title: string;
      category: IdeaCategory;
      status: IdeaStatus;
      place: Place | null;
      rating: number | null;
      again: boolean | null;
    }
  | {
      kind: "destination";
      place: Place;
      rating: number | null;
      again: boolean | null;
    }
  | {
      kind: "reservation";
      name: string;
      type: ReservationType;
      rating: number | null;
      again: boolean | null;
    };

/** A library row: the match candidate plus the id an update addresses. */
export interface BeenLibraryRow extends MatchCandidate {
  id: string;
}

export type BeenSkipReason = "not-journal-worthy" | "travel" | "no-place";

export type BeenDecision =
  | { action: "skip"; reason: BeenSkipReason }
  | { action: "update"; saveId: string }
  | { action: "create"; candidate: MatchCandidate; type: ReservationType };

/** Rule 1 — the journal's own predicate (`tripJournal` uses it too). */
export function isJournalWorthy(t: {
  status?: IdeaStatus | null;
  rating: number | null;
  again: boolean | null;
}): boolean {
  return t.status === "done" || t.rating !== null || t.again !== null;
}

/**
 * An idea's kind as the save type it is filed under (vet MED "pin the type
 * mapping"): Eat → dining, Stay → lodging, Do → activity. The reverse — a save
 * type back to an idea kind — is `ideaCategoryOfSaveType` (nearby-saves.ts),
 * which is what a "Did it" made from a place capture sends.
 */
export function saveTypeOfIdeaCategory(category: IdeaCategory): ReservationType {
  switch (category) {
    case "eat":
      return "dining";
    case "stay":
      return "lodging";
    default:
      return "activity";
  }
}

const hasPlace = (p: Place | null): p is Place =>
  p !== null && (p.googlePlaceId !== null || (p.lat !== null && p.lng !== null));

/** The candidate a thing is matched and created by — its OWN place. */
function candidateOf(thing: BeenThing): MatchCandidate | null {
  switch (thing.kind) {
    case "idea":
      if (!hasPlace(thing.place)) return null;
      // An idea's title is what the traveller called it; its place is where.
      return { ...thing.place, name: thing.place.name || thing.title };
    case "destination":
      return hasPlace(thing.place) ? { ...thing.place } : null;
    case "reservation":
      // Rule 4: name only. Never the destination's coordinates.
      return { name: thing.name, lat: null, lng: null, googlePlaceId: null };
  }
}

function typeOf(thing: BeenThing): ReservationType {
  switch (thing.kind) {
    case "idea":
      return saveTypeOfIdeaCategory(thing.category);
    case "destination":
      // `destinations` carry no category — a town is not a campground (places.ts).
      return "other";
    case "reservation":
      return thing.type;
  }
}

export function beenWriteThrough(thing: BeenThing, library: readonly BeenLibraryRow[]): BeenDecision {
  const status = thing.kind === "idea" ? thing.status : null;
  if (!isJournalWorthy({ status, rating: thing.rating, again: thing.again })) {
    return { action: "skip", reason: "not-journal-worthy" };
  }
  if (thing.kind === "reservation" && categoryOf(thing.type).cat === "Travel") {
    return { action: "skip", reason: "travel" };
  }
  const candidate = candidateOf(thing);
  if (!candidate) return { action: "skip", reason: "no-place" };
  const hit = library.find((row) => isAlreadySaved(candidate, [row]));
  if (hit) return { action: "update", saveId: hit.id };
  return { action: "create", candidate, type: typeOf(thing) };
}
