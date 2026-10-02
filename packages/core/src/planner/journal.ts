import { countTransportKind, effectiveTransportKind } from "../domain/transport-kind";
import { isJournalWorthy, saveTypeOfIdeaCategory } from "../domain/been-write-through";
import type {
  Idea,
  IdeaStatus,
  IsoDate,
  Reservation,
  ReservationType,
  Destination,
  Trip,
  TravelMode,
} from "../domain/types";
import { categoryOf } from "../theme/tokens";

/**
 * The Journal lens (#113 · #106, Q1 B · Q4 B): a READ over the trip, not a
 * table. Phone and web both render `tripJournal(trip)`, so the two screens
 * cannot disagree about what a traveled trip left behind.
 *
 * - An ENTRY is an idea or a destination-attached reservation whose `status` is
 *   `done`, or that carries a rating or an `again` answer
 *   (`isJournalWorthy`, the same predicate the Been write-through uses).
 * - Entries are grouped under their destination, destinations in DESTINATION-DATE order: scheduled
 *   destinations by arrival, then floating destinations (no dates) in route sequence — a
 *   floating destination's entries still qualify (vet MED: pinned here).
 * - Inside a destination: Again first, then not said, then Once was enough; inside
 *   each, ★ high to low, then name. It reads as advice for your future self.
 * - A destination's OWN ★ and Again sit on its header line; a destination with no entries
 *   is shown only when it carries one of those itself.
 * - Shelf ideas (no destination) that qualify go in the last group, "Around the trip".
 * - Folds: "Didn't get to" holds every idea still at idea/planned; "Travel"
 *   holds the segment bookings (and any Travel-category destination booking) —
 *   transport is never rated here.
 */

export type JournalEntryKind = "idea" | "reservation";

export interface JournalEntry {
  kind: JournalEntryKind;
  id: string;
  name: string;
  /** What the row's CategoryTile reads — an idea's kind as its save type. */
  type: ReservationType;
  /** An idea's status; null for a reservation. */
  status: IdeaStatus | null;
  rating: number | null;
  again: boolean | null;
  notes: string | null;
}

export interface JournalDestination {
  destination: Destination;
  rating: number | null;
  again: boolean | null;
  entries: JournalEntry[];
}

export interface JournalTally {
  /** Entries plus destinations that carry their own ★ or Again. */
  logged: number;
  again: number;
  once: number;
  /** "Didn't get to". */
  skipped: number;
}

export interface TripJournal {
  trip: { rating: number | null; note: string | null };
  tally: JournalTally;
  destinations: JournalDestination[];
  /** Qualifying shelf ideas — "Around the trip". */
  around: JournalEntry[];
  didntGetTo: Idea[];
  travel: Reservation[];
}

const isTravel = (r: Reservation) => categoryOf(r.type).cat === "Travel";

function ideaEntry(i: Idea): JournalEntry {
  return {
    kind: "idea",
    id: i.id,
    name: i.title,
    type: saveTypeOfIdeaCategory(i.category),
    status: i.status,
    rating: i.rating,
    again: i.again,
    notes: i.notes,
  };
}

function reservationEntry(r: Reservation): JournalEntry {
  return {
    kind: "reservation",
    id: r.id,
    name: r.name,
    type: r.type,
    status: null,
    rating: r.rating,
    again: r.again,
    notes: r.notes,
  };
}

/** Again (true) → not said (null) → Once was enough (false). */
const againRank = (a: boolean | null) => (a === true ? 0 : a === null ? 1 : 2);

/** The within-destination order: Again group, ★ desc, then name. */
export function byJournalOrder(a: JournalEntry, b: JournalEntry): number {
  return (
    againRank(a.again) - againRank(b.again) ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Every destination in DESTINATION-DATE order: scheduled destinations by `arriveDate`, then the
 * floating ones after them in route sequence (chapter order, then sortOrder). Ties
 * on a date keep route sequence.
 */
export function destinationsInDateOrder(trip: Trip): Destination[] {
  const inRoute = [...trip.chapters]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((l) => [...l.destinations].sort((a, b) => a.sortOrder - b.sortOrder));
  const scheduled = inRoute.filter((s) => s.arriveDate !== null);
  const floating = inRoute.filter((s) => s.arriveDate === null);
  // Array.prototype.sort is stable, so equal dates keep route order.
  scheduled.sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
  return [...scheduled, ...floating];
}

export function tripJournal(trip: Trip): TripJournal {
  const destinations: JournalDestination[] = [];
  const didntGetTo: Idea[] = [];
  const travel: Reservation[] = trip.segments.flatMap((s) => s.reservations);
  const tally: JournalTally = { logged: 0, again: 0, once: 0, skipped: 0 };
  const count = (t: { again: boolean | null }) => {
    tally.logged += 1;
    if (t.again === true) tally.again += 1;
    if (t.again === false) tally.once += 1;
  };

  for (const destination of destinationsInDateOrder(trip)) {
    const entries: JournalEntry[] = [];
    for (const r of destination.reservations) {
      if (isTravel(r)) {
        travel.push(r);
        continue;
      }
      if (isJournalWorthy(r)) entries.push(reservationEntry(r));
    }
    for (const i of destination.ideas) {
      if (isJournalWorthy(i)) entries.push(ideaEntry(i));
      else didntGetTo.push(i);
    }
    const own = destination.rating !== null || destination.again !== null;
    if (entries.length === 0 && !own) continue;
    entries.sort(byJournalOrder);
    entries.forEach(count);
    if (own) count(destination);
    destinations.push({ destination, rating: destination.rating, again: destination.again, entries });
  }

  const around: JournalEntry[] = [];
  for (const i of trip.ideas) {
    if (isJournalWorthy(i)) around.push(ideaEntry(i));
    else didntGetTo.push(i);
  }
  around.sort(byJournalOrder);
  around.forEach(count);

  tally.skipped = didntGetTo.length;
  return { trip: { rating: trip.rating, note: trip.note }, tally, destinations, around, didntGetTo, travel };
}

/** Anything to show above the folds? */
export function journalIsEmpty(j: TripJournal): boolean {
  return j.destinations.length === 0 && j.around.length === 0;
}

// ── copy ─────────────────────────────────────────────────────────────────────
// The wireframe's strings, once, so the phone and the web say the same thing.

export const JOURNAL_EMPTY_COPY =
  "Nothing logged on this trip yet. Rate a destination or tick an idea off to start its journal.";

export const JOURNAL_AROUND_HEADING = "Around the trip";

/** The tally line: "4 in the journal · 3 again · 1 once was enough · 1 didn't get to". */
export function journalTallyParts(t: JournalTally): { n: number; label: string }[] {
  return [
    { n: t.logged, label: "in the journal" },
    { n: t.again, label: "again" },
    { n: t.once, label: "once was enough" },
    { n: t.skipped, label: "didn’t get to" },
  ];
}

/** "Didn't get to · 1". */
export function didntGetToLabel(n: number): string {
  return `Didn’t get to · ${n}`;
}

/** "Travel · 2 flights" — worded by what the bookings ARE (#155 · Q4 A: the
 * stored kind, or the hop's mode for a row with none). Mixed kinds — two
 * flights and a shuttle — read "bookings". */
export function travelFoldLabel(trip: Trip, travel: Reservation[]): string {
  const modeOf = new Map<string, TravelMode>(trip.segments.map((s) => [s.id, s.mode]));
  const kinds = new Set(
    travel.map((r) => {
      const mode = r.segmentId ? modeOf.get(r.segmentId) : undefined;
      return mode && mode !== "drive" ? effectiveTransportKind(r, mode) : (r.transportKind ?? undefined);
    }),
  );
  const n = travel.length;
  const [only] = [...kinds];
  if (kinds.size === 1 && only) return `Travel · ${countTransportKind(only, n)}`;
  return `Travel · ${n} ${n === 1 ? "booking" : "bookings"}`;
}

/** The badge an `again` answer wears — null draws none (Q9 A). */
export function againBadge(again: boolean | null): { label: string; once: boolean } | null {
  if (again === true) return { label: "again", once: false };
  if (again === false) return { label: "once was enough", once: true };
  return null;
}

/** The "How was it?" sheet's pair (Q3 B): tapping the lit one clears it. */
export function toggleAgain(current: boolean | null, tapped: boolean): boolean | null {
  return current === tapped ? null : tapped;
}

// ── #113 · the check-off, as the destination screen applies it ─────────────────────

/** The fields the "How was it?" sheet writes. */
export interface HowWasIt {
  rating: number | null;
  again: boolean | null;
  notes: string | null;
}

function mapDestinationIdeas(trip: Trip, fn: (i: Idea) => Idea): Trip {
  return {
    ...trip,
    ideas: trip.ideas.map(fn),
    chapters: trip.chapters.map((l) => ({ ...l, destinations: l.destinations.map((s) => ({ ...s, ideas: s.ideas.map(fn) })) })),
  };
}

/** Patch one idea anywhere on the trip (a destination's or the shelf's). */
export function setIdeaFields(trip: Trip, ideaId: string, patch: Partial<Idea>): Trip {
  return mapDestinationIdeas(trip, (i) => (i.id === ideaId ? { ...i, ...patch } : i));
}

/** Patch one destination-attached reservation. */
export function setDestinationReservationFields(trip: Trip, resId: string, patch: Partial<Reservation>): Trip {
  return {
    ...trip,
    chapters: trip.chapters.map((l) => ({
      ...l,
      destinations: l.destinations.map((s) => ({
        ...s,
        reservations: s.reservations.map((r) => (r.id === resId ? { ...r, ...patch } : r)),
      })),
    })),
  };
}

/** Patch one destination's own journal fields. */
export function setDestinationFields(trip: Trip, destinationId: string, patch: Partial<Destination>): Trip {
  return {
    ...trip,
    chapters: trip.chapters.map((l) => ({
      ...l,
      destinations: l.destinations.map((s) => (s.id === destinationId ? { ...s, ...patch } : s)),
    })),
  };
}

/** A destination's check circle: done ⇄ idea. One tap commits (Q3 B); tapping a done
 * idea again un-checks it back to `idea`. */
export function checkOffStatus(status: IdeaStatus): IdeaStatus {
  return status === "done" ? "idea" : "done";
}

/** Reservations that earn a "How was it?" pill: a stay, a meal or a thing to
 * do — never Travel, never Other. */
export function isRateableReservation(r: Pick<Reservation, "type">): boolean {
  const cat = categoryOf(r.type).cat;
  return cat === "Stay" || cat === "Eat" || cat === "Do";
}

// ── #113 · "Did it": today's destination ──────────────────────────────────────────

/**
 * The destination "Did it" files onto: a destination on a trip in progress
 * (`startDate ≤ today ≤ endDate`) whose own dates cover today
 * (`arriveDate ≤ today ≤ departDate`). On a changeover day two destinations match,
 * and the one you're ARRIVING at wins — the later `arriveDate`. A floating
 * destination never matches, and no match is null (the chip isn't shown).
 */
export function todaysDestination<T extends Pick<Trip, "id" | "title" | "startDate" | "endDate" | "chapters">>(
  trips: readonly T[],
  today: IsoDate,
): { trip: T; destination: Destination } | null {
  let best: { trip: T; destination: Destination } | null = null;
  for (const trip of trips) {
    if (trip.startDate > today || trip.endDate < today) continue;
    for (const destination of trip.chapters.flatMap((l) => l.destinations)) {
      if (destination.arriveDate === null || destination.departDate === null) continue;
      if (destination.arriveDate > today || destination.departDate < today) continue;
      if (!best || destination.arriveDate > best.destination.arriveDate!) best = { trip, destination };
    }
  }
  return best;
}

/** The local calendar date on this device, as a plain `YYYY-MM-DD`. */
export function localIsoDate(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "Costa Rica Fly & Stay · Westin Reserva Conchal · today". */
export function didItContext(tripTitle: string, destinationName: string): string {
  return `${tripTitle} · ${destinationName} · today`;
}
