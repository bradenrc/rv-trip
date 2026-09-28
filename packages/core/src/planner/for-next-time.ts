import { hasCoords } from "../domain/bounds";
import { SUGGESTION_MIN_RATING, isAlreadySaved, type MatchCandidate } from "../domain/places";
import type {
  ForNextTime,
  IdeaCreateInput,
  NextTimeCard,
  NextTimeRow,
  SavedPlace,
  Trip,
  TripStatus,
} from "../domain/types";
import { haversineMeters } from "../providers/index";
import { categoryOf } from "../theme/tokens";
import { dateRange } from "./dates";
import { ideaCategoryOfSaveType } from "./nearby-saves";
import { METERS_PER_MILE, NEAR_RADIUS_MI, locatedStops, type StopAnchor } from "./shelf";

/**
 * "For next time" (#113 · #107, Q7 B · Q8 B): a trip that goes back near
 * somewhere you've been shows a "Last time here" card per PAST trip ×
 * destination, above the nearby banner.
 *
 * Pure, like `nearbySaves`: `GET /api/trips/:id/for-next-time` (the phone) and
 * app/trips/[id]/page.tsx (the web) are both a read of three things and a call
 * to this, so the two clients draw one answer.
 *
 * - Past trips: `status = complete`, other than this one, most recent first.
 * - A save belongs to a card when it is a BEEN save whose `trip_id` is that
 *   trip and whose DESTINATION point is within this trip's surfacing radius
 *   (`surfaceRadiusMi ?? 50`) of a located stop. A save with no destination
 *   (the keyless stub resolves nothing) is measured from its own point and the
 *   card is named by the nearest stop — so a walk without a Google key still
 *   shows its write-through saves (dev default, see dev-notes).
 * - Again group: `again = true`, plus `again` not said with ★ ≥
 *   SUGGESTION_MIN_RATING — those carry no badge, so a Been save from before
 *   W3 isn't lost. Once group: `again = false`. Anything else stays out, and a
 *   card with no rows isn't drawn.
 * - `onThisTrip`: "reservation" when a booking on THIS trip matches by the
 *   shipped `isAlreadySaved` rule (a reservation is name-only, rule 4), "idea"
 *   when an idea on the trip does (attached or on the shelf), else null.
 * - `saveIds` is every save on a card — the nearby banner leaves them out.
 */

/** The dashboard row satisfies this, and so does a whole `Trip`. */
export type PastTrip = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  rating: number | null;
  note: string | null;
};

/** The Stay · Eat · Do order rows of one ★ read in (the shelf's order). */
const CATEGORY_RANK: Record<string, number> = { Stay: 0, Eat: 1, Do: 2, Travel: 3, Other: 4 };

function byRowOrder(a: NextTimeRow, b: NextTimeRow): number {
  return (
    (b.rating ?? 0) - (a.rating ?? 0) ||
    CATEGORY_RANK[categoryOf(a.type).cat]! - CATEGORY_RANK[categoryOf(b.type).cat]! ||
    a.name.localeCompare(b.name)
  );
}

/** Which group a been save joins, or null when it stays out. */
export function nextTimeGroup(s: Pick<SavedPlace, "again" | "rating">): "again" | "once" | null {
  if (s.again === true) return "again";
  if (s.again === false) return "once";
  return s.rating !== null && s.rating >= SUGGESTION_MIN_RATING ? "again" : null;
}

/** The point a save is placed BY: its destination's, else its own. */
function destinationPoint(s: SavedPlace): { lat: number; lng: number } | null {
  const d = s.destination;
  if (d && d.lat !== null && d.lng !== null) return { lat: d.lat, lng: d.lng };
  if (hasCoords(s.place)) return { lat: s.place.lat, lng: s.place.lng };
  return null;
}

function nearestAnchor(point: { lat: number; lng: number }, anchors: StopAnchor[]) {
  let best = anchors[0]!;
  let bestM = haversineMeters(point, best);
  for (const a of anchors.slice(1)) {
    const m = haversineMeters(point, a);
    if (m < bestM) {
      best = a;
      bestM = m;
    }
  }
  return { anchor: best, mi: bestM / METERS_PER_MILE };
}

/** What is already on THIS trip, as the match rule sees it. */
function onTrip(trip: Trip): { reservations: MatchCandidate[]; ideas: MatchCandidate[] } {
  const stops = trip.legs.flatMap((l) => l.stops);
  const bookings = [...stops.flatMap((s) => s.reservations), ...trip.segments.flatMap((s) => s.reservations)];
  const ideas = [...trip.ideas, ...stops.flatMap((s) => s.ideas)];
  return {
    // Rule 4: a reservation is name-only.
    reservations: bookings.map((r) => ({ name: r.name, lat: null, lng: null, googlePlaceId: null })),
    ideas: ideas.map((i) => i.place ?? { name: i.title, lat: null, lng: null, googlePlaceId: null }),
  };
}

export function forNextTime(
  trip: Trip,
  pastTrips: readonly PastTrip[],
  saves: readonly SavedPlace[],
  radiusMi: number | null = trip.surfaceRadiusMi,
): ForNextTime {
  const radius = radiusMi ?? NEAR_RADIUS_MI;
  const anchors = locatedStops(trip);
  if (anchors.length === 0) return { cards: [], saveIds: [] };
  const stopById = new Map(trip.legs.flatMap((l) => l.stops).map((s) => [s.id, s]));
  const here = onTrip(trip);
  const past = pastTrips
    .filter((t) => t.status === "complete" && t.id !== trip.id)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const cards: NextTimeCard[] = [];
  for (const pt of past) {
    const groups = new Map<string, NextTimeCard>();
    for (const s of saves) {
      if (s.status !== "been" || s.tripId !== pt.id) continue;
      const group = nextTimeGroup(s);
      if (!group) continue;
      const point = destinationPoint(s);
      if (!point) continue;
      const { anchor, mi } = nearestAnchor(point, anchors);
      if (mi > radius) continue;
      const key = s.destination?.id ?? `stop:${anchor.id}`;
      let card = groups.get(key);
      if (!card) {
        const stop = stopById.get(anchor.id)!;
        card = {
          destination: s.destination
            ? { id: s.destination.id, name: s.destination.name }
            : { id: null, name: anchor.name },
          stop: { id: stop.id, name: stop.place.name, arriveDate: stop.arriveDate, departDate: stop.departDate },
          pastTrip: {
            id: pt.id,
            title: pt.title,
            startDate: pt.startDate,
            endDate: pt.endDate,
            rating: pt.rating,
            note: pt.note,
          },
          again: [],
          once: [],
        };
        groups.set(key, card);
      }
      const onThisTrip = isAlreadySaved(s.place, here.reservations)
        ? "reservation"
        : isAlreadySaved(s.place, here.ideas)
          ? "idea"
          : null;
      card[group].push({
        saveId: s.id,
        name: s.place.name,
        type: s.type,
        rating: s.rating,
        again: s.again,
        note: s.note,
        place: s.place,
        onThisTrip,
      });
    }
    const mine = [...groups.values()].filter((c) => c.again.length + c.once.length > 0);
    for (const c of mine) {
      c.again.sort(byRowOrder);
      c.once.sort(byRowOrder);
    }
    // Inside one past trip: in this trip's route order by date, then by name.
    mine.sort(
      (a, b) =>
        (a.stop.arriveDate ?? "9999").localeCompare(b.stop.arriveDate ?? "9999") ||
        a.destination.name.localeCompare(b.destination.name),
    );
    cards.push(...mine);
  }
  const saveIds = cards.flatMap((c) => [...c.again, ...c.once].map((r) => r.saveId));
  return { cards, saveIds };
}

// ── copy ─────────────────────────────────────────────────────────────────────

/** "For next time · Newport, OR". */
export function nextTimeKicker(card: NextTimeCard): string {
  return `For next time · ${card.destination.name}`;
}

/** "May 23–26, 2025 · you're back Aug 5–9" — the second clause only when the
 * stop has dates. */
export function nextTimeDatesLine(card: NextTimeCard): string {
  const pt = card.pastTrip;
  const then = `${dateRange(pt.startDate, pt.endDate)}, ${pt.endDate.slice(0, 4)}`;
  const { arriveDate, departDate } = card.stop;
  return arriveDate && departDate ? `${then} · you’re back ${dateRange(arriveDate, departDate)}` : then;
}

/** A row's trailing control: "Booked ✓", "On shelf ✓", or "Add" (Again rows
 * only — a Once-was-enough row gets no control). */
export function nextTimeRowAction(row: NextTimeRow, group: "again" | "once"): "Booked ✓" | "On shelf ✓" | "Add" | null {
  if (row.onThisTrip === "reservation") return "Booked ✓";
  if (row.onThisTrip === "idea") return "On shelf ✓";
  return group === "again" ? "Add" : null;
}

/** Add → the same shelf idea the nearby sheet's Add creates (a one-way copy of
 * the save: name, place, type as category). */
export function nextTimeIdeaBody(tripId: string, row: NextTimeRow): IdeaCreateInput {
  return {
    tripId,
    stopId: null,
    category: ideaCategoryOfSaveType(row.type),
    title: row.name,
    status: "idea",
    place: row.place,
    rating: null,
    again: null,
    notes: null,
  };
}

/** After an Add, the row reads "On shelf ✓" without a refetch. */
export function markRowOnShelf(nt: ForNextTime, saveId: string): ForNextTime {
  const mark = (r: NextTimeRow) => (r.saveId === saveId ? { ...r, onThisTrip: "idea" as const } : r);
  return { ...nt, cards: nt.cards.map((c) => ({ ...c, again: c.again.map(mark), once: c.once.map(mark) })) };
}
