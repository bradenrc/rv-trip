import { describe, expect, it } from "vitest";
import type { Idea, Destination, Trip } from "../domain/types";
import { costaRicaTrip, pnwTrip, seedTrips } from "../seeds/index";
import {
  JOURNAL_EMPTY_COPY,
  againBadge,
  checkOffStatus,
  didntGetToLabel,
  isRateableReservation,
  journalIsEmpty,
  journalTallyParts,
  setIdeaFields,
  setDestinationReservationFields,
  destinationsInDateOrder,
  todaysDestination,
  toggleAgain,
  travelFoldLabel,
  tripJournal,
} from "./journal";

/**
 * #113 · the Journal lens (docs/design/113 Screen 3). The Costa Rica seed with
 * the wireframe's check-offs applied: the snorkel ★5 Again, the surf lesson ★3
 * Once was enough, the Westin ★4 Again (its "How was it?" pill), a "Did it"
 * sunset ★5 Again born done on the destination, and the Rincón day trip still an idea.
 */

function idea(over: Partial<Idea> & Pick<Idea, "id" | "title">): Idea {
  return {
    tripId: "trip_cr",
    destinationId: "stp_conchal",
    category: "do",
    status: "idea",
    place: null,
    rating: null,
    again: null,
    notes: null,
    sortOrder: 9,
    lastChange: null,
    ...over,
  };
}

function withDestinationIdeas(trip: Trip, destinationId: string, extra: Idea[]): Trip {
  return {
    ...trip,
    chapters: trip.chapters.map((l) => ({
      ...l,
      destinations: l.destinations.map((s) => (s.id === destinationId ? { ...s, ideas: [...s.ideas, ...extra] } : s)),
    })),
  };
}

function checkedOffCostaRica(): Trip {
  let t = costaRicaTrip();
  t = setIdeaFields(t, "idea_snorkel", {
    status: "done",
    rating: 5,
    again: true,
    notes: "Go at low tide from the Westin end. The reef is the rocks on the left.",
  });
  t = setIdeaFields(t, "idea_surf", {
    status: "done",
    rating: 3,
    again: false,
    notes: "Crowded. The 7am lesson is the only calm one.",
  });
  t = setDestinationReservationFields(t, "res_westin", {
    rating: 4,
    again: true,
    notes: "Ask for the ocean side, 3rd floor.",
  });
  return withDestinationIdeas(t, "stp_conchal", [
    idea({ id: "idea_sunset", title: "Sunset at Playa Flamingo", status: "done", rating: 5, again: true }),
    idea({ id: "idea_rincon", title: "Rincón de la Vieja day trip" }),
  ]);
}

describe("tripJournal (#113 · the Journal lens)", () => {
  it("groups the Costa Rica check-offs under the Westin in the wireframe's order", () => {
    const j = tripJournal(checkedOffCostaRica());
    expect(j.destinations.map((s) => s.destination.id)).toEqual(["stp_conchal"]);
    expect(j.destinations[0]!.entries.map((e) => e.name)).toEqual([
      "Playa Conchal snorkel",
      "Sunset at Playa Flamingo",
      "Westin Reserva Conchal",
      "Tamarindo surf lesson",
    ]);
    expect(j.destinations[0]!.entries.map((e) => [e.kind, e.again, e.rating])).toEqual([
      ["idea", true, 5],
      ["idea", true, 5],
      ["reservation", true, 4],
      ["idea", false, 3],
    ]);
  });

  it("tallies 4 in the journal · 3 again · 1 once was enough · 1 didn't get to", () => {
    const j = tripJournal(checkedOffCostaRica());
    expect(j.tally).toEqual({ logged: 4, again: 3, once: 1, skipped: 1 });
    expect(journalTallyParts(j.tally).map((p) => `${p.n} ${p.label}`)).toEqual([
      "4 in the journal",
      "3 again",
      "1 once was enough",
      "1 didn’t get to",
    ]);
  });

  it("folds the Rincón idea into Didn't get to, and the flights and shuttles into Travel", () => {
    const trip = checkedOffCostaRica();
    const j = tripJournal(trip);
    expect(j.didntGetTo.map((i) => i.title)).toEqual(["Rincón de la Vieja day trip"]);
    expect(didntGetToLabel(j.didntGetTo.length)).toBe("Didn’t get to · 1");
    expect(j.travel.map((r) => r.id)).toEqual(["res_aa2451", "res_aa2208", "res_shuttle_out", "res_shuttle_home"]);
    // #155 · two flights and two shuttles are mixed kinds — "bookings".
    expect(travelFoldLabel(trip, j.travel)).toBe("Travel · 4 bookings");
    expect(travelFoldLabel(trip, j.travel.slice(0, 2))).toBe("Travel · 2 flights");
    expect(j.trip).toEqual({ rating: null, note: null });
  });

  it("files an idea's kind as its tile's save type (Do → activity)", () => {
    const j = tripJournal(checkedOffCostaRica());
    expect(j.destinations[0]!.entries.find((e) => e.id === "idea_snorkel")!.type).toBe("activity");
    expect(j.destinations[0]!.entries.find((e) => e.id === "res_westin")!.type).toBe("lodging");
  });

  it("is empty on a traveled trip with nothing checked — the folds still show", () => {
    const j = tripJournal(costaRicaTrip());
    expect(journalIsEmpty(j)).toBe(true);
    expect(j.tally.logged).toBe(0);
    expect(j.didntGetTo.map((i) => i.id)).toEqual(["idea_snorkel", "idea_surf"]);
    expect(j.travel).toHaveLength(4);
    expect(JOURNAL_EMPTY_COPY).toBe(
      "Nothing logged on this trip yet. Rate a destination or tick an idea off to start its journal.",
    );
  });

  it("puts a destination's own ★ on its header, and floating destinations after the scheduled ones", () => {
    // PNW: Astoria ★5, Newport ★4 (scheduled); Crater Lake floating with an
    // idea marked Again; the done shelf idea goes Around the trip.
    let t = pnwTrip();
    t = setIdeaFields(t, "idea_rimdrive", { again: true });
    t = setIdeaFields(t, "idea_kiwanda", { status: "done" });
    const j = tripJournal(t);
    expect(j.destinations.map((s) => [s.destination.id, s.rating])).toEqual([
      ["stp_astoria", 5],
      ["stp_newport", 4],
      ["stp_crater", null],
    ]);
    expect(j.destinations[2]!.entries.map((e) => e.id)).toEqual(["idea_rimdrive"]);
    expect(j.around.map((e) => e.id)).toEqual(["idea_kiwanda"]);
    // Astoria's KOA ★5 is an entry; the museum tour (unrated) is not.
    expect(j.destinations[0]!.entries.map((e) => e.id)).toEqual(["res_koa"]);
  });

  it("orders destinations by date with floating ones last, in route sequence", () => {
    expect(destinationsInDateOrder(pnwTrip()).map((s) => s.id)).toEqual([
      "stp_astoria",
      "stp_newport",
      "stp_bend",
      "stp_crater",
    ]);
  });
});

describe("the check-off's small rules", () => {
  it("toggles the circle done ⇄ idea", () => {
    expect(checkOffStatus("idea")).toBe("done");
    expect(checkOffStatus("planned")).toBe("done");
    expect(checkOffStatus("done")).toBe("idea");
  });

  it("clears the lit Again / Once back to not said", () => {
    expect(toggleAgain(null, true)).toBe(true);
    expect(toggleAgain(true, true)).toBeNull();
    expect(toggleAgain(true, false)).toBe(false);
    expect(againBadge(true)).toEqual({ label: "again", once: false });
    expect(againBadge(false)).toEqual({ label: "once was enough", once: true });
    expect(againBadge(null)).toBeNull();
  });

  it("offers How was it? on a stay, a meal or a thing to do — never Travel or Other", () => {
    expect(isRateableReservation({ type: "lodging" })).toBe(true);
    expect(isRateableReservation({ type: "dining" })).toBe(true);
    expect(isRateableReservation({ type: "tour" })).toBe(true);
    expect(isRateableReservation({ type: "transport" })).toBe(false);
    expect(isRateableReservation({ type: "other" })).toBe(false);
  });
});

describe("todaysDestination (#113 · Did it)", () => {
  const destination = (id: string, arriveDate: string | null, departDate: string | null): Destination => ({
    id,
    chapterId: "L",
    place: { name: id, lat: 1, lng: 1, googlePlaceId: null },
    arriveDate,
    departDate,
    sortOrder: 0,
    rating: null,
    again: null,
    notes: null,
    reservations: [],
    ideas: [],
    lastChange: null,
  });
  const trip = (destinations: Destination[], startDate = "2027-05-10", endDate = "2027-05-20") => ({
    id: "T",
    title: "Greece",
    startDate,
    endDate,
    chapters: [{ id: "L", tripId: "T", title: "L", sortOrder: 0, destinations }],
  });

  it("finds the Westin mid-stay on the Costa Rica seed", () => {
    const hit = todaysDestination(seedTrips(), "2027-01-19");
    expect(hit?.trip.id).toBe("trip_cr");
    expect(hit?.destination.id).toBe("stp_conchal");
  });

  it("picks the destination you're arriving at on a changeover day", () => {
    // Greece: Mykonos departs May 16, Naxos arrives May 16.
    const hit = todaysDestination(seedTrips(), "2027-05-16");
    expect(hit?.destination.id).toBe("stp_naxos");
    const t = trip([destination("a", "2027-05-10", "2027-05-14"), destination("b", "2027-05-14", "2027-05-18")]);
    expect(todaysDestination([t], "2027-05-14")?.destination.id).toBe("b");
  });

  it("is null for a floating destination, and when no trip is in progress", () => {
    expect(todaysDestination([trip([destination("f", null, null)])], "2027-05-12")).toBeNull();
    expect(todaysDestination([trip([destination("a", "2027-05-10", "2027-05-14")])], "2027-06-01")).toBeNull();
    expect(todaysDestination([], "2027-05-12")).toBeNull();
  });
});
