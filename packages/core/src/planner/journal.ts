import { isJournalWorthy, saveTypeOfIdeaCategory } from "../domain/been-write-through";
import type {
  Idea,
  IdeaStatus,
  IsoDate,
  Reservation,
  ReservationType,
  Stop,
  Trip,
  TravelMode,
} from "../domain/types";
import { categoryOf } from "../theme/tokens";

/**
 * The Journal lens (#113 · #106, Q1 B · Q4 B): a READ over the trip, not a
 * table. Phone and web both render `tripJournal(trip)`, so the two screens
 * cannot disagree about what a traveled trip left behind.
 *
 * - An ENTRY is an idea or a stop-attached reservation whose `status` is
 *   `done`, or that carries a rating or an `again` answer
 *   (`isJournalWorthy`, the same predicate the Been write-through uses).
 * - Entries are grouped under their stop, stops in STOP-DATE order: scheduled
 *   stops by arrival, then floating stops (no dates) in route sequence — a
 *   floating stop's entries still qualify (vet MED: pinned here).
 * - Inside a stop: Again first, then not said, then Once was enough; inside
 *   each, ★ high to low, then name. It reads as advice for your future self.
 * - A stop's OWN ★ and Again sit on its header line; a stop with no entries
 *   is shown only when it carries one of those itself.
 * - Shelf ideas (no stop) that qualify go in the last group, "Around the trip".
 * - Folds: "Didn't get to" holds every idea still at idea/planned; "Travel"
 *   holds the segment bookings (and any Travel-category stop booking) —
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

export interface JournalStop {
  stop: Stop;
  rating: number | null;
  again: boolean | null;
  entries: JournalEntry[];
}

export interface JournalTally {
  /** Entries plus stops that carry their own ★ or Again. */
  logged: number;
  again: number;
  once: number;
  /** "Didn't get to". */
  skipped: number;
}

export interface TripJournal {
  trip: { rating: number | null; note: string | null };
  tally: JournalTally;
  stops: JournalStop[];
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

/** The within-stop order: Again group, ★ desc, then name. */
export function byJournalOrder(a: JournalEntry, b: JournalEntry): number {
  return (
    againRank(a.again) - againRank(b.again) ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Every stop in STOP-DATE order: scheduled stops by `arriveDate`, then the
 * floating ones after them in route sequence (leg order, then sortOrder). Ties
 * on a date keep route sequence.
 */
export function stopsInDateOrder(trip: Trip): Stop[] {
  const inRoute = [...trip.legs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((l) => [...l.stops].sort((a, b) => a.sortOrder - b.sortOrder));
  const scheduled = inRoute.filter((s) => s.arriveDate !== null);
  const floating = inRoute.filter((s) => s.arriveDate === null);
  // Array.prototype.sort is stable, so equal dates keep route order.
  scheduled.sort((a, b) => a.arriveDate!.localeCompare(b.arriveDate!));
  return [...scheduled, ...floating];
}

export function tripJournal(trip: Trip): TripJournal {
  const stops: JournalStop[] = [];
  const didntGetTo: Idea[] = [];
  const travel: Reservation[] = trip.segments.flatMap((s) => s.reservations);
  const tally: JournalTally = { logged: 0, again: 0, once: 0, skipped: 0 };
  const count = (t: { again: boolean | null }) => {
    tally.logged += 1;
    if (t.again === true) tally.again += 1;
    if (t.again === false) tally.once += 1;
  };

  for (const stop of stopsInDateOrder(trip)) {
    const entries: JournalEntry[] = [];
    for (const r of stop.reservations) {
      if (isTravel(r)) {
        travel.push(r);
        continue;
      }
      if (isJournalWorthy(r)) entries.push(reservationEntry(r));
    }
    for (const i of stop.ideas) {
      if (isJournalWorthy(i)) entries.push(ideaEntry(i));
      else didntGetTo.push(i);
    }
    const own = stop.rating !== null || stop.again !== null;
    if (entries.length === 0 && !own) continue;
    entries.sort(byJournalOrder);
    entries.forEach(count);
    if (own) count(stop);
    stops.push({ stop, rating: stop.rating, again: stop.again, entries });
  }

  const around: JournalEntry[] = [];
  for (const i of trip.ideas) {
    if (isJournalWorthy(i)) around.push(ideaEntry(i));
    else didntGetTo.push(i);
  }
  around.sort(byJournalOrder);
  around.forEach(count);

  tally.skipped = didntGetTo.length;
  return { trip: { rating: trip.rating, note: trip.note }, tally, stops, around, didntGetTo, travel };
}

/** Anything to show above the folds? */
export function journalIsEmpty(j: TripJournal): boolean {
  return j.stops.length === 0 && j.around.length === 0;
}

// ── copy ─────────────────────────────────────────────────────────────────────
// The wireframe's strings, once, so the phone and the web say the same thing.

export const JOURNAL_EMPTY_COPY =
  "Nothing logged on this trip yet. Rate a stop or tick an idea off to start its journal.";

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

/** "Travel · 2 flights" — worded by the hops the bookings hang on. */
export function travelFoldLabel(trip: Trip, travel: Reservation[]): string {
  const modeOf = new Map<string, TravelMode>(trip.segments.map((s) => [s.id, s.mode]));
  const modes = new Set(travel.map((r) => (r.segmentId ? modeOf.get(r.segmentId) : undefined)));
  const n = travel.length;
  const word =
    modes.size === 1 && modes.has("fly")
      ? n === 1
        ? "flight"
        : "flights"
      : modes.size === 1 && modes.has("ferry")
        ? n === 1
          ? "ferry"
          : "ferries"
        : n === 1
          ? "booking"
          : "bookings";
  return `Travel · ${n} ${word}`;
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

// ── #113 · the check-off, as the stop screen applies it ─────────────────────

/** The fields the "How was it?" sheet writes. */
export interface HowWasIt {
  rating: number | null;
  again: boolean | null;
  notes: string | null;
}

function mapStopIdeas(trip: Trip, fn: (i: Idea) => Idea): Trip {
  return {
    ...trip,
    ideas: trip.ideas.map(fn),
    legs: trip.legs.map((l) => ({ ...l, stops: l.stops.map((s) => ({ ...s, ideas: s.ideas.map(fn) })) })),
  };
}

/** Patch one idea anywhere on the trip (a stop's or the shelf's). */
export function setIdeaFields(trip: Trip, ideaId: string, patch: Partial<Idea>): Trip {
  return mapStopIdeas(trip, (i) => (i.id === ideaId ? { ...i, ...patch } : i));
}

/** Patch one stop-attached reservation. */
export function setStopReservationFields(trip: Trip, resId: string, patch: Partial<Reservation>): Trip {
  return {
    ...trip,
    legs: trip.legs.map((l) => ({
      ...l,
      stops: l.stops.map((s) => ({
        ...s,
        reservations: s.reservations.map((r) => (r.id === resId ? { ...r, ...patch } : r)),
      })),
    })),
  };
}

/** Patch one stop's own journal fields. */
export function setStopFields(trip: Trip, stopId: string, patch: Partial<Stop>): Trip {
  return {
    ...trip,
    legs: trip.legs.map((l) => ({
      ...l,
      stops: l.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)),
    })),
  };
}

/** A stop's check circle: done ⇄ idea. One tap commits (Q3 B); tapping a done
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

// ── #113 · "Did it": today's stop ──────────────────────────────────────────

/**
 * The stop "Did it" files onto: a stop on a trip in progress
 * (`startDate ≤ today ≤ endDate`) whose own dates cover today
 * (`arriveDate ≤ today ≤ departDate`). On a changeover day two stops match,
 * and the one you're ARRIVING at wins — the later `arriveDate`. A floating
 * stop never matches, and no match is null (the chip isn't shown).
 */
export function todaysStop<T extends Pick<Trip, "id" | "title" | "startDate" | "endDate" | "legs">>(
  trips: readonly T[],
  today: IsoDate,
): { trip: T; stop: Stop } | null {
  let best: { trip: T; stop: Stop } | null = null;
  for (const trip of trips) {
    if (trip.startDate > today || trip.endDate < today) continue;
    for (const stop of trip.legs.flatMap((l) => l.stops)) {
      if (stop.arriveDate === null || stop.departDate === null) continue;
      if (stop.arriveDate > today || stop.departDate < today) continue;
      if (!best || stop.arriveDate > best.stop.arriveDate!) best = { trip, stop };
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
export function didItContext(tripTitle: string, stopName: string): string {
  return `${tripTitle} · ${stopName} · today`;
}
