import { describe, expect, it } from "vitest";
import type { Destination, Reservation, Trip } from "../domain/types";
import { pnwTrip } from "../seeds/index";
import { tripCard, tripCardLines } from "./trip-card";

/**
 * #183 · #186 i3 — the wireframe's §1 #183 table, row for row. The Pacific
 * Northwest Loop (Aug 1–28) carries one unrated Stay reservation; Bellingham
 * (Nov 11–15) carries two. Both read `complete` once their dates are behind
 * them (what `deriveTripStatus` gives an auto trip), so an ended card offers
 * the Journal, as the table's CTA column shows.
 */

const template = pnwTrip().chapters[0]!.destinations[0]!;
const resTemplate = template.reservations[0]!;

function res(id: string, destinationId: string, over: Partial<Reservation>): Reservation {
  return { ...resTemplate, id, destinationId, rating: null, again: null, ...over };
}

function destination(id: string, reservations: Reservation[]): Destination {
  return { ...template, id, ideas: [], reservations };
}

function trip(
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  reservations: Reservation[],
  status: Trip["status"],
): Trip {
  const base = pnwTrip();
  const chapter = base.chapters[0]!;
  return {
    ...base,
    id,
    title,
    startDate,
    endDate,
    status,
    statusAuto: false,
    ideas: [],
    segments: [],
    chapters: [{ ...chapter, tripId: id, destinations: [destination(`${id}_d1`, reservations)] }],
  };
}

/** The Loop: one unrated stay, one rated stay, and an unrated meal that never counts. */
function loop(status: Trip["status"] = "upcoming"): Trip {
  return trip(
    "trip_pnw",
    "Pacific Northwest Loop",
    "2026-08-01",
    "2026-08-28",
    [
      res("res_koa", "trip_pnw_d1", { type: "campground", rating: 5 }),
      res("res_newport", "trip_pnw_d1", { type: "campground" }),
      res("res_lunch", "trip_pnw_d1", { type: "dining" }),
    ],
    status,
  );
}

function bellingham(status: Trip["status"] = "upcoming", rated = false): Trip {
  return trip(
    "trip_bham",
    "Bellingham",
    "2026-11-11",
    "2026-11-15",
    [
      res("res_inn", "trip_bham_d1", { type: "lodging", rating: rated ? 4 : null }),
      res("res_camp", "trip_bham_d1", { type: "campground", again: rated ? true : null }),
      res("res_aslan", "trip_bham_d1", { type: "dining" }),
    ],
    status,
  );
}

function mccall(): Trip {
  return trip("trip_mccall", "McCall weekend", "2026-11-06", "2026-11-08", [], "complete");
}

describe("tripCard (#183 · the trip card on Places)", () => {
  it("Fri Jul 24 · starts in 8 days → none (start edge, outside)", () => {
    expect(tripCard([loop()], "2026-07-24")).toBeNull();
  });

  it("Sat Jul 25 · starts in 7 days → the Loop, in 7 days, Agenda →", () => {
    const card = tripCard([loop()], "2026-07-25");
    expect(card).toEqual({ kind: "starting", tripId: "trip_pnw", title: "Pacific Northwest Loop", days: 7, tab: "agenda" });
    expect(tripCardLines(card!)).toEqual({
      title: "Pacific Northwest Loop",
      when: "in 7 days",
      line: null,
      amber: false,
      cta: "Agenda →",
    });
  });

  it("Fri Aug 7 · covers today → the Loop, day 7 of 28, Journal →", () => {
    const card = tripCard([loop()], "2026-08-07");
    expect(card).toEqual({ kind: "now", tripId: "trip_pnw", title: "Pacific Northwest Loop", day: 7, of: 28, tab: "journal" });
    expect(tripCardLines(card!)).toEqual({
      title: "Pacific Northwest Loop",
      when: "day 7 of 28",
      line: null,
      amber: false,
      cta: "Journal →",
    });
  });

  it("Fri Sep 4 · ended 7 days ago → back 7 days, 1 stay still needs a “How was it?”", () => {
    const card = tripCard([loop("complete")], "2026-09-04");
    expect(card).toEqual({
      kind: "ended",
      tripId: "trip_pnw",
      title: "Pacific Northwest Loop",
      days: 7,
      toRate: 1,
      tab: "journal",
    });
    expect(tripCardLines(card!)).toEqual({
      title: "Pacific Northwest Loop",
      when: "back 7 days",
      line: "1 stay still needs a “How was it?”",
      amber: true,
      cta: "Journal →",
    });
  });

  it("Sat Sep 5 · ended 8 days ago → none (end edge, outside)", () => {
    expect(tripCard([loop("complete")], "2026-09-05")).toBeNull();
  });

  it("Tue Nov 10 · with a McCall weekend Nov 6–8 → starting beats ended: Bellingham, in 1 day", () => {
    const card = tripCard([mccall(), bellingham()], "2026-11-10");
    expect(card).toEqual({ kind: "starting", tripId: "trip_bham", title: "Bellingham", days: 1, tab: "agenda" });
    expect(tripCardLines(card!)).toMatchObject({ when: "in 1 day", line: null, cta: "Agenda →" });
  });

  it("Tue Nov 17 · ended 2 days ago → back 2 days, 2 stays to rate, amber", () => {
    const card = tripCard([loop("complete"), bellingham("complete")], "2026-11-17");
    expect(card).toEqual({ kind: "ended", tripId: "trip_bham", title: "Bellingham", days: 2, toRate: 2, tab: "journal" });
    expect(tripCardLines(card!)).toEqual({
      title: "Bellingham",
      when: "back 2 days",
      line: "2 stays still need a “How was it?”",
      amber: true,
      cta: "Journal →",
    });
  });

  it("Tue Nov 17 · both stays rated → the card stays: Finish the journal, not amber (q5 A)", () => {
    const card = tripCard([bellingham("complete", true)], "2026-11-17");
    expect(card).toMatchObject({ kind: "ended", days: 2, toRate: 0 });
    expect(tripCardLines(card!)).toEqual({
      title: "Bellingham",
      when: "back 2 days",
      line: "Finish the journal",
      amber: false,
      cta: "Journal →",
    });
  });

  it("Sun Sep 20 · Bellingham starts in 52 days, the Loop ended 23 days ago → none", () => {
    expect(tripCard([loop("complete"), bellingham()], "2026-09-20")).toBeNull();
  });

  it("an unrated Eat reservation does not count toward toRate", () => {
    const card = tripCard([bellingham("complete", true)], "2026-11-17");
    // res_aslan (dining) is unrated, yet toRate is 0.
    expect(card).toMatchObject({ toRate: 0 });
  });

  it("now beats starting and ended", () => {
    const card = tripCard([mccall(), loop(), bellingham()], "2026-08-07");
    expect(card?.kind).toBe("now");
  });

  it("the closest start wins, and the closest end wins", () => {
    const soon = trip("trip_soon", "Soon", "2026-11-12", "2026-11-13", [], "upcoming");
    const later = trip("trip_later", "Later", "2026-11-15", "2026-11-16", [], "upcoming");
    expect(tripCard([later, soon], "2026-11-10")).toMatchObject({ tripId: "trip_soon", days: 2 });
    const a = trip("trip_a", "A", "2026-11-01", "2026-11-05", [], "complete");
    const b = trip("trip_b", "B", "2026-11-01", "2026-11-08", [], "complete");
    expect(tripCard([a, b], "2026-11-10")).toMatchObject({ tripId: "trip_b", days: 2 });
  });

  it("singular day at 1: back 1 day, 1 stay still needs", () => {
    expect(
      tripCardLines({ kind: "ended", tripId: "t", title: "T", days: 1, toRate: 1, tab: "journal" }),
    ).toMatchObject({ when: "back 1 day", line: "1 stay still needs a “How was it?”" });
  });

  it("no trips → null", () => {
    expect(tripCard([], "2026-11-17")).toBeNull();
  });
});
