import { describe, expect, it } from "vitest";
import type { Idea, Destination, Trip } from "../domain/types";
import { costaRicaTrip, pnwTrip, seedTrips } from "../seeds/index";
import {
  JOURNAL_EMPTY_COPY,
  activeTrip,
  captureTarget,
  didItContext,
  matchingOpenIdea,
  isoDateInZone,
  isRootLaunchUrl,
  againBadge,
  checkOffStatus,
  didntGetToLabel,
  isRateableReservation,
  journalIsEmpty,
  journalTallyParts,
  setIdeaFields,
  setDestinationReservationFields,
  setDestinationFields,
  destinationsInDateOrder,
  todaysDestination,
  toggleAgain,
  travelFoldLabel,
  tripJournal,
  journalToday,
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

describe("activeTrip (#173 · the landing rule, Q4 A)", () => {
  // The wireframe's worked table: Loop AUG 01–28 · Crater Lake AUG 21–23 · Bellingham NOV 11–15.
  const t = (id: string, startDate: string, endDate: string, extra: Partial<Trip> = {}) => ({
    id,
    startDate,
    endDate,
    ...extra,
  });
  const loop = t("loop", "2026-08-01", "2026-08-28");
  const crater = t("crater", "2026-08-21", "2026-08-23");
  const bham = t("bham", "2026-11-11", "2026-11-15");
  const trips = [loop, crater, bham];

  it("is null with no trips", () => {
    expect(activeTrip([], "2026-08-10")).toBeNull();
  });

  it("returns the one trip covering today", () => {
    expect(activeTrip(trips, "2026-08-10")?.id).toBe("loop");
  });

  it("picks the later start when two trips overlap", () => {
    expect(activeTrip(trips, "2026-08-22")?.id).toBe("crater");
    expect(activeTrip([crater, loop], "2026-08-22")?.id).toBe("crater");
  });

  it("keeps the first in input order on an equal start", () => {
    const a = t("a", "2026-08-21", "2026-08-25");
    const b = t("b", "2026-08-21", "2026-08-23");
    expect(activeTrip([a, b], "2026-08-22")?.id).toBe("a");
    expect(activeTrip([b, a], "2026-08-22")?.id).toBe("b");
  });

  it("never counts an undated trip", () => {
    expect(activeTrip([t("u", "", "")], "2026-08-22")).toBeNull();
  });

  it("is inclusive at both ends, and null the day before and after", () => {
    expect(activeTrip(trips, "2026-07-31")).toBeNull();
    expect(activeTrip(trips, "2026-08-01")?.id).toBe("loop");
    expect(activeTrip(trips, "2026-08-28")?.id).toBe("loop");
    expect(activeTrip(trips, "2026-08-29")).toBeNull();
    expect(activeTrip(trips, "2026-11-15")?.id).toBe("bham");
    expect(activeTrip(trips, "2026-11-16")).toBeNull();
  });

  it("reads dates only — a complete trip with statusAuto:false covering today is still active", () => {
    const pinned = t("done", "2026-11-11", "2026-11-15", { status: "complete", statusAuto: false });
    expect(activeTrip([pinned], "2026-11-13")?.id).toBe("done");
  });
});

describe("captureTarget (#176 · the trip first, then the destination)", () => {
  // docs/design/176 §1: the Pacific Northwest Loop, AUG 01–28 — Astoria Aug 2–5,
  // Newport Aug 5–9, Bend Aug 12–16, Crater Lake floating.
  const trips = [pnwTrip()];

  it("Aug 7, a stay day → the trip and Newport", () => {
    const t = captureTarget(trips, "2026-08-07");
    expect(t?.trip.id).toBe("trip_pnw");
    expect(t?.destination?.id).toBe("stp_newport");
  });

  it("Aug 5, a changeover → Newport, the destination you're arriving at", () => {
    expect(captureTarget(trips, "2026-08-05")?.destination?.id).toBe("stp_newport");
  });

  it("Aug 10, a travel-day gap → the trip with no destination", () => {
    const t = captureTarget(trips, "2026-08-10");
    expect(t?.trip.id).toBe("trip_pnw");
    expect(t?.destination).toBeNull();
  });

  it("Aug 20, only a floating destination left → the trip with no destination", () => {
    const t = captureTarget(trips, "2026-08-20");
    expect(t?.trip.id).toBe("trip_pnw");
    expect(t?.destination).toBeNull();
  });

  it("Sep 3, the trip is over → null", () => {
    expect(captureTarget(trips, "2026-09-03")).toBeNull();
    expect(captureTarget([], "2026-08-07")).toBeNull();
  });
});

describe("didItContext (#176 · a shelf capture)", () => {
  it("names the destination, or reads Around the trip with none", () => {
    expect(didItContext("Pacific Northwest Loop", "Newport, OR")).toBe("Pacific Northwest Loop · Newport, OR · today");
    expect(didItContext("Pacific Northwest Loop", null)).toBe("Pacific Northwest Loop · Around the trip · today");
  });
});

describe("matchingOpenIdea (#176 · Q3 B, check off instead of a twin)", () => {
  const gid = "ChIJ_rogue_ales";
  const rogue = idea({
    id: "i_rogue",
    title: "Rogue Ales brewery lunch",
    place: { name: "Rogue Ales Brewery", lat: 44.62, lng: -124.05, googlePlaceId: gid },
    sortOrder: 1,
  });
  const hit = { name: "Rogue Ales & Spirits", lat: 44.6201, lng: -124.0501, googlePlaceId: gid };

  it("returns an open idea the capture's Google id matches", () => {
    expect(matchingOpenIdea([rogue], hit)?.id).toBe("i_rogue");
  });

  it("never matches the same idea once it is done", () => {
    expect(matchingOpenIdea([{ ...rogue, status: "done" }], hit)).toBeNull();
  });

  it("matches a coordless idea by its title alone", () => {
    const sisters = idea({ id: "i_sisters", title: "Sisters Coffee", destinationId: null });
    const note = { name: "sisters coffee", lat: 44.29, lng: -121.55, googlePlaceId: null };
    expect(matchingOpenIdea([sisters], note)?.id).toBe("i_sisters");
    expect(matchingOpenIdea([sisters], { ...note, name: "Sisters Bakery" })).toBeNull();
  });

  it("picks the lower sortOrder when two open ideas match", () => {
    const later = { ...rogue, id: "i_later", sortOrder: 5 };
    const earlier = { ...rogue, id: "i_earlier", sortOrder: 0 };
    expect(matchingOpenIdea([later, earlier], hit)?.id).toBe("i_earlier");
    expect(matchingOpenIdea([earlier, later], hit)?.id).toBe("i_earlier");
  });
});

describe("isoDateInZone (#173 · the web's today from a tz cookie)", () => {
  const now = new Date("2026-11-16T01:00:00Z"); // 6 pm Nov 15 in Boise

  it("gives the zone's calendar date, not the server's", () => {
    expect(isoDateInZone(now, "America/Boise")).toBe("2026-11-15");
    expect(isoDateInZone(now, "UTC")).toBe("2026-11-16");
  });

  it("is null for an invalid zone", () => {
    expect(isoDateInZone(now, "Not/AZone")).toBeNull();
  });
});

describe("isRootLaunchUrl (#173 i5 · a plain cold start vs a deep link)", () => {
  // Inputs are expo-linking's `parse(url)` shape: { scheme, hostname, path }.
  it("is root for the bare custom scheme and for Expo Go / Metro hosts", () => {
    expect(isRootLaunchUrl({ scheme: "tripcaddie", hostname: null, path: null })).toBe(true);
    expect(isRootLaunchUrl({ scheme: "exp", hostname: "192.168.1.5", path: null })).toBe(true);
    expect(isRootLaunchUrl({ scheme: "http", hostname: "localhost", path: "/" })).toBe(true);
    expect(isRootLaunchUrl({ scheme: "tripcaddie", hostname: "expo-development-client", path: null })).toBe(true);
  });

  it("is not root when a path or a custom-scheme host names a screen", () => {
    expect(isRootLaunchUrl({ scheme: "exp", hostname: null, path: "trips/abc" })).toBe(false);
    expect(isRootLaunchUrl({ scheme: "tripcaddie", hostname: "trips", path: "abc" })).toBe(false);
    expect(isRootLaunchUrl({ scheme: "tripcaddie", hostname: "saves", path: null })).toBe(false);
  });
});

describe("journalToday (#178 · #181 i3)", () => {
  const withRes = (trip: Trip, id: string, patch: Parameters<typeof setDestinationReservationFields>[2]) =>
    setDestinationReservationFields(trip, id, patch);

  it("Aug 7: Today is Newport, and Earlier is Astoria", () => {
    const j = journalToday(pnwTrip(), "2026-08-07");
    expect(j.today.heading).toBe("Today · Fri Aug 7 · Newport, OR");
    expect(j.today.destination?.id).toBe("stp_newport");
    expect(j.today.entries.map((e) => e.id)).toEqual(["res_southbeach"]);
    expect(j.earlier.map((g) => g.heading)).toEqual(["Astoria, OR"]);
    expect(j.earlier[0]).toMatchObject({ rating: 5, again: null });
  });

  it("Aug 10, between destinations: Around the trip, and Earlier is Newport then Astoria", () => {
    const j = journalToday(pnwTrip(), "2026-08-10");
    expect(j.today.heading).toBe("Today · Mon Aug 10 · Around the trip");
    expect(j.today.heading.endsWith("Around the trip")).toBe(true);
    expect(j.today.destination).toBeNull();
    expect(j.today.toRate).toEqual([]);
    expect(j.earlier.map((g) => g.destination?.id)).toEqual(["stp_newport", "stp_astoria"]);
  });

  it("an unrated KOA lands in Astoria's toRate; a rated one does not", () => {
    const unrated = withRes(pnwTrip(), "res_koa", { rating: null, again: null });
    const astoria = journalToday(unrated, "2026-08-07").earlier.find((g) => g.destination?.id === "stp_astoria")!;
    expect(astoria.toRate.map((r) => r.id)).toContain("res_koa");

    const rated = journalToday(pnwTrip(), "2026-08-07").earlier.find((g) => g.destination?.id === "stp_astoria")!;
    expect(rated.toRate.map((r) => r.id)).not.toContain("res_koa");
  });

  it("keeps a past destination whose only row is an unrated stay (vet MED)", () => {
    let t = withRes(pnwTrip(), "res_koa", { rating: null, again: null });
    t = setDestinationFields(t, "stp_astoria", { rating: null, again: null });
    // tripJournal drops Astoria — nothing journal-worthy and no ★ of its own …
    expect(tripJournal(t).destinations.map((g) => g.destination.id)).not.toContain("stp_astoria");
    // … but Today's Earlier still shows it, with its "How was it?" pill.
    const astoria = journalToday(t, "2026-08-07").earlier.find((g) => g.destination?.id === "stp_astoria")!;
    expect(astoria.entries).toEqual([]);
    expect(astoria.toRate.map((r) => r.id)).toContain("res_koa");
  });

  it("closes Earlier with Around the trip when today has a destination and the shelf has entries", () => {
    const t = { ...pnwTrip() };
    t.ideas = t.ideas.map((i) => (i.id === "idea_kiwanda" ? { ...i, status: "done" as const } : i));
    const j = journalToday(t, "2026-08-07");
    expect(j.earlier.at(-1)).toMatchObject({ destination: null, heading: "Around the trip" });
    expect(j.earlier.at(-1)!.entries.map((e) => e.id)).toEqual(["idea_kiwanda"]);
    // With no destination today the shelf IS Today, so it is not repeated.
    const gap = journalToday(t, "2026-08-10");
    expect(gap.today.entries.map((e) => e.id)).toEqual(["idea_kiwanda"]);
    expect(gap.earlier.some((g) => g.destination === null)).toBe(false);
  });
});
