import type { IsoDate, Trip } from "../domain/types";
import { daysUntil } from "../domain/trip-status";
import { categoryOf } from "../theme/tokens";
import { activeTrip, unratedOf } from "./journal";
import { TRIP_TAB_LABEL, defaultTripTab, type TripTab } from "./trip-tab";

/**
 * The trip card at the top of Places (#183 · q5 A). Phone and web both read
 * `tripCard` + `tripCardLines`, so the two screens cannot disagree about which
 * trip it names, what it says, or which tab its link opens.
 *
 * - now: the trip whose dates cover today (`activeTrip`), day D of N.
 * - starting: a trip whose startDate is 1–7 days after today; the closest wins.
 * - ended: a trip whose endDate is 1–7 days before today; the closest wins. It
 *   stays even when nothing is left to rate (q5 A: "Finish the journal").
 * - Priority now → starting → ended. No match is null (no card).
 * - tab is `defaultTripTab` — the tab the trip page itself opens on (#177).
 */
export type TripCard =
  | { kind: "starting"; tripId: string; title: string; days: number; tab: TripTab }
  | { kind: "now"; tripId: string; title: string; day: number; of: number; tab: TripTab }
  | { kind: "ended"; tripId: string; title: string; days: number; toRate: number; tab: TripTab };

/** How far ahead (or back) a trip still earns the card, in days. */
export const TRIP_CARD_WINDOW_DAYS = 7;

/** The trip's stays that still wait for "How was it?" — `unratedOf`'s rows, Stay only. */
function staysToRate(trip: Trip): number {
  return trip.chapters
    .flatMap((c) => c.destinations)
    .flatMap((d) => unratedOf(d))
    .filter((r) => categoryOf(r.type).cat === "Stay").length;
}

/** The trip `within(trip)` days away (1..7) with the fewest days; ties keep input order. */
function closest(trips: readonly Trip[], within: (t: Trip) => number): { trip: Trip; days: number } | null {
  let best: { trip: Trip; days: number } | null = null;
  for (const trip of trips) {
    if (!trip.startDate || !trip.endDate) continue;
    const days = within(trip);
    if (days < 1 || days > TRIP_CARD_WINDOW_DAYS) continue;
    if (!best || days < best.days) best = { trip, days };
  }
  return best;
}

export function tripCard(trips: readonly Trip[], today: IsoDate): TripCard | null {
  const now = activeTrip(trips, today);
  if (now) {
    return {
      kind: "now",
      tripId: now.id,
      title: now.title,
      day: daysUntil(today, now.startDate) + 1,
      of: daysUntil(now.endDate, now.startDate) + 1,
      tab: defaultTripTab(now, today),
    };
  }
  const starting = closest(trips, (t) => daysUntil(t.startDate, today));
  if (starting) {
    const { trip, days } = starting;
    return { kind: "starting", tripId: trip.id, title: trip.title, days, tab: defaultTripTab(trip, today) };
  }
  const ended = closest(trips, (t) => daysUntil(today, t.endDate));
  if (ended) {
    const { trip, days } = ended;
    return {
      kind: "ended",
      tripId: trip.id,
      title: trip.title,
      days,
      toRate: staysToRate(trip),
      tab: defaultTripTab(trip, today),
    };
  }
  return null;
}

const dayWord = (n: number) => (n === 1 ? "day" : "days");

/** The card's words: its title, when, the ended trip's line, and the link. */
export function tripCardLines(card: TripCard): {
  title: string;
  when: string;
  line: string | null;
  amber: boolean;
  cta: string;
} {
  const cta = `${TRIP_TAB_LABEL[card.tab]} →`;
  switch (card.kind) {
    case "starting":
      return { title: card.title, when: `in ${card.days} ${dayWord(card.days)}`, line: null, amber: false, cta };
    case "now":
      return { title: card.title, when: `day ${card.day} of ${card.of}`, line: null, amber: false, cta };
    case "ended": {
      const when = `back ${card.days} ${dayWord(card.days)}`;
      if (card.toRate > 0) {
        const n = card.toRate;
        const line = `${n} ${n === 1 ? "stay still needs" : "stays still need"} a “How was it?”`;
        return { title: card.title, when, line, amber: true, cta };
      }
      return { title: card.title, when, line: "Finish the journal", amber: false, cta };
    }
  }
}
