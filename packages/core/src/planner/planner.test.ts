import { describe, it, expect } from "vitest";
import type { Idea, Leg, Reservation, Trip, Stop } from "../domain/types";
import { orderedLegStops, orderedPairs, routeCacheKey } from "../domain/route-order";
import { estimateRoute, type RouteResult } from "../providers/index";
import { driveMiles } from "../providers/route-format";
import {
  timelineModel,
  routeModel,
  routeSummary,
  scheduleFloating,
  reorderFloating,
  cycleIdeaStatus,
  setStopRating,
  allStops,
  appendLeg,
  appendStop,
  canMoveLeg,
  legOrder,
  moveLeg,
  moveStopToLeg,
  removeLeg,
  removeStop,
  renameLeg,
  renameStop,
  setStopDates,
  appendReservation,
  removeReservation,
  setReservationFields,
  appendIdea,
  removeIdea,
  applyPromotion,
  dateRange,
  fullRange,
  addDays,
  navigationCaption,
  navigationOptions,
  type NavMap,
  type RouteMap,
} from "./index";

/**
 * A ten-day trip, hand-classified so every expectation below is arithmetic
 * you can check on paper:
 *
 *   08-01 open · 08-02 drive→S1 · 08-03 stay S1 · 08-04 drive→S2 (arrival
 *   wins the shared day) · 08-05 stay · 08-06 stay · 08-07 open · 08-08
 *   drive→S3 · 08-09 stay S3 · 08-10 open
 *
 * S4 is floating with coordinates; S5 is floating WITHOUT coordinates, so the
 * S4→S5 pair yields no drive at all (coordinates, not dates, are the
 * precondition for a connector).
 */
function stop(partial: Partial<Stop> & Pick<Stop, "id" | "legId" | "sortOrder">): Stop {
  return {
    place: { name: partial.id, lat: null, lng: null, googlePlaceId: null },
    arriveDate: null,
    departDate: null,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    ...partial,
  };
}

/**
 * The SEED trip (packages/db/src/seed.ts) as a plain fixture: Aug 1–28, two
 * legs, three dated stops and Crater Lake floating. Its open runs are what the
 * gantt drop is specified against, so the drop tests read off the real trip
 * rather than a shape invented for them.
 */
function seedTrip(): Trip {
  return {
    id: "seed",
    ownerId: "o",
    title: "Pacific Northwest Loop",
    homeBase: "Boise, ID",
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    status: "planning",
    statusAuto: false,
    rating: null,
    note: null,
    legs: [
      {
        id: "coast",
        tripId: "seed",
        title: "Oregon Coast",
        sortOrder: 0,
        stops: [
          stop({
            id: "astoria",
            legId: "coast",
            sortOrder: 0,
            place: { name: "Astoria, OR", lat: 46.1879, lng: -123.8313, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-05",
          }),
          stop({
            id: "newport",
            legId: "coast",
            sortOrder: 1,
            place: { name: "Newport, OR", lat: 44.6365, lng: -124.053, googlePlaceId: null },
            arriveDate: "2026-08-05",
            departDate: "2026-08-09",
          }),
        ],
      },
      {
        id: "mountains",
        tripId: "seed",
        title: "Cascades & Home",
        sortOrder: 1,
        stops: [
          stop({
            id: "bend",
            legId: "mountains",
            sortOrder: 0,
            place: { name: "Bend, OR", lat: 44.0582, lng: -121.3153, googlePlaceId: null },
            arriveDate: "2026-08-12",
            departDate: "2026-08-16",
          }),
          stop({
            id: "crater",
            legId: "mountains",
            sortOrder: 1,
            place: { name: "Crater Lake NP", lat: 42.9446, lng: -122.109, googlePlaceId: null },
          }),
        ],
      },
    ],
  };
}

/** Crater Lake's [arrive, depart] after a drop. */
function crater(trip: Trip): (string | null)[] {
  const s = trip.legs[1]!.stops.find((x) => x.id === "crater")!;
  return [s.arriveDate, s.departDate];
}

function fixture(endDate = "2026-08-10"): Trip {
  return {
    id: "t",
    ownerId: "o",
    title: "Ten days",
    homeBase: null,
    startDate: "2026-08-01",
    endDate,
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    legs: [
      {
        id: "A",
        tripId: "t",
        title: "Coast",
        sortOrder: 0,
        stops: [
          stop({
            id: "S1",
            legId: "A",
            sortOrder: 0,
            place: { name: "S1", lat: 46.18, lng: -123.83, googlePlaceId: null },
            arriveDate: "2026-08-02",
            departDate: "2026-08-04",
            rating: 5,
            reservations: [
              {
                id: "r1",
                stopId: "S1",
                ideaId: null,
                type: "campground",
                name: "KOA",
                checkIn: "2026-08-02",
                checkOut: "2026-08-04",
                confirmationNumber: null,
                cost: 120,
                rating: null,
                notes: null,
              },
            ],
          }),
          stop({
            id: "S2",
            legId: "A",
            sortOrder: 1,
            place: { name: "S2", lat: 44.63, lng: -124.05, googlePlaceId: null },
            arriveDate: "2026-08-04",
            departDate: "2026-08-06",
          }),
        ],
      },
      {
        id: "B",
        tripId: "t",
        title: "Mountains",
        sortOrder: 1,
        stops: [
          stop({
            id: "S3",
            legId: "B",
            sortOrder: 0,
            place: { name: "S3", lat: 44.05, lng: -121.31, googlePlaceId: null },
            arriveDate: "2026-08-08",
            departDate: "2026-08-09",
            ideas: [
              {
                id: "i1",
                stopId: "S3",
                title: "Float",
                status: "idea",
                place: null,
                rating: null,
                notes: null,
                sortOrder: 0,
              },
            ],
          }),
          stop({
            id: "S4",
            legId: "B",
            sortOrder: 1,
            place: { name: "S4", lat: 42.94, lng: -122.1, googlePlaceId: null },
          }),
          stop({ id: "S5", legId: "B", sortOrder: 2 }),
        ],
      },
    ],
  };
}

describe("timelineModel", () => {
  const m = timelineModel(fixture());

  it("has one rhythm cell per trip day, classified", () => {
    expect(m.rhythm).toHaveLength(10);
    expect(m.rhythm.map((c) => c.kind)).toEqual([
      "empty", "drive", "stay", "drive", "stay", "stay", "empty", "drive", "stay", "empty",
    ]);
  });

  it("turns contiguous same-stop runs into bars (1-based columns)", () => {
    expect(m.legs.map((l) => l.bars.map((b) => [b.stopId, b.startCol, b.span]))).toEqual([
      [["S1", 2, 2], ["S2", 4, 3]],
      [["S3", 8, 2]],
    ]);
    expect(m.legs[0]!.bars[0]).toMatchObject({ range: "Aug 2–4", rating: 5, resCount: 1, showMeta: true });
  });

  it("turns contiguous open runs into gaps and counts them", () => {
    expect(m.gaps).toEqual([
      { startCol: 1, span: 1 },
      { startCol: 7, span: 1 },
      { startCol: 10, span: 1 },
    ]);
    expect(m.openCount).toBe(3);
    expect(m.gapCount).toBe(3);
    expect(m.openLabel).toBe("3 open days across 3 gaps");
  });

  it("lists floating stops in sortOrder, off the calendar", () => {
    expect(m.floating.map((f) => f.id)).toEqual(["S4", "S5"]);
    expect(m.allScheduled).toBe(false);
  });

  it("says every day is planned when nothing is open", () => {
    const t = fixture("2026-08-09");
    t.legs[0]!.stops[0]!.arriveDate = "2026-08-01";
    t.legs[0]!.stops[1]!.departDate = "2026-08-08";
    expect(timelineModel(t).openLabel).toBe("Every day planned");
  });
});

describe("routeModel", () => {
  it("draws a drive out of every stop that has a routable successor in the same leg", () => {
    const legs = routeModel(fixture());
    expect(legs[0]!.rows.map((r) => r.drive !== null)).toEqual([true, false]);
    // S3→S4 is a drive (both have coords); S4→S5 is not (S5 has none).
    expect(legs[1]!.rows.map((r) => r.drive !== null)).toEqual([true, false, false]);
  });

  it("hangs the leg-crossing drive on the leg it leaves, with its seam label", () => {
    const legs = routeModel(fixture());
    expect(legs[0]!.outboundDrive).not.toBeNull();
    expect(legs[0]!.outboundSeam).toBe("Leg 1 → Leg 2");
    expect(legs[1]!.outboundDrive).toBeNull();
  });

  it("labels an un-routed pair as an estimate and a routed one as real", () => {
    const trip = fixture();
    const from = { lat: 46.18, lng: -123.83 };
    const to = { lat: 44.63, lng: -124.05 };
    const here: RouteResult = {
      durationSeconds: 3 * 3600,
      distanceMeters: 200_000,
      polyline: null,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const routes: RouteMap = { [routeCacheKey(from, to, "rig-x")]: here };
    const legs = routeModel(trip, routes, "rig-x");
    expect(legs[0]!.rows[0]!.drive).toMatchObject({ estimate: false, primaryRoad: "US-101" });
    expect(legs[0]!.outboundDrive).toMatchObject({ estimate: true });
  });

  it("gives every drive a Google Maps handoff URL", () => {
    const d = routeModel(fixture())[0]!.rows[0]!.drive!;
    expect(d.navUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=46\.18/);
  });

  /**
   * The corridor verdict (docs/design/43 §4). `toDrive` no longer decides
   * anything about it — it READS the server-resolved NavMap, keyed by the same
   * routeCacheKey `routes` is, and defaults to "plain" when the key is absent.
   * Absent is the normal case: no Google key, a drive nobody checked, or a pair
   * the client just invented by dragging a floating stop.
   */
  describe("the Navigate verdict, read off the NavMap", () => {
    const HASH = "rig-x";
    const FROM = { lat: 46.18, lng: -123.83 };
    const TO = { lat: 44.63, lng: -124.05 };
    const KEY = routeCacheKey(FROM, TO, HASH);

    const routed: RouteResult = {
      durationSeconds: 3 * 3600 + 12 * 60,
      distanceMeters: 218_866,
      polyline: null,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const routes: RouteMap = { [KEY]: routed };
    const first = (nav: NavMap) => routeModel(fixture(), routes, HASH, nav)[0]!.rows[0]!.drive!;

    it("is 'plain' with no NavMap at all — every shipped call site's answer", () => {
      const d = first({});
      expect(d.navVerdict).toBe("plain");
      expect(d.navDeviationMeters).toBeNull();
      // routeModel's third-arity call (apps/mobile) must keep working.
      expect(routeModel(fixture(), routes, HASH)[0]!.rows[0]!.drive!.navVerdict).toBe("plain");
    });

    it("is 'checked' when the cached check came back inside the tolerance", () => {
      const d = first({ [KEY]: { deviationMeters: 180, intermediates: [] } });
      expect(d.navVerdict).toBe("checked");
      expect(d.navDeviationMeters).toBe(180);
    });

    it("is 'plain' when the cached check came back outside it", () => {
      const d = first({ [KEY]: { deviationMeters: 1340, intermediates: [] } });
      expect(d.navVerdict).toBe("plain");
      expect(d.navDeviationMeters).toBe(1340);
    });

    it("is 'plain' when the check ran and could not conclude", () => {
      const d = first({ [KEY]: { deviationMeters: null, intermediates: [] } });
      expect(d.navVerdict).toBe("plain");
      expect(d.navDeviationMeters).toBeNull();
    });

    it("keeps today's Google url and adds a WeGo one, in every verdict", () => {
      for (const nav of [{}, { [KEY]: { deviationMeters: 180, intermediates: [] } }]) {
        const d = first(nav);
        expect(d.navUrl).toBe(
          "https://www.google.com/maps/dir/?api=1&origin=46.1800,-123.8300&destination=44.6300,-124.0500&travelmode=driving",
        );
        expect(d.navWegoUrl).toBe(
          "https://wego.here.com/directions/drive/46.1800,-123.8300/44.6300,-124.0500",
        );
      }
    });

    it("cannot be fooled by a NavMap keyed on another rig", () => {
      const stale: NavMap = {
        [routeCacheKey(FROM, TO, "some-other-rig")]: { deviationMeters: 10, intermediates: [] },
      };
      expect(first(stale).navVerdict).toBe("plain");
    });
  });

  /**
   * The split control's copy and order, as pure functions of the drive — the
   * only way this epic's acceptance can actually EXECUTE. apps/web's vitest is
   * `environment: "node"`, collects only `.test.ts` files, and the workspace
   * ships no jsdom / testing-library (the vet's HIGH against i4's render
   * test) — so RouteView renders these strings and asserts nothing about them.
   * They are asserted here instead.
   */
  describe("navigationOptions / navigationCaption", () => {
    const HASH = "rig-x";
    const FROM = { lat: 46.18, lng: -123.83 };
    const TO = { lat: 44.63, lng: -124.05 };
    const KEY = routeCacheKey(FROM, TO, HASH);
    const routed: RouteResult = {
      durationSeconds: 11_520,
      distanceMeters: 218_866,
      polyline: null,
      primaryRoad: "US-101",
      source: "here",
      notices: [],
    };
    const drive = (nav: NavMap) =>
      routeModel(fixture(), { [KEY]: routed }, HASH, nav)[0]!.rows[0]!.drive!;
    const checked = drive({ [KEY]: { deviationMeters: 180, intermediates: [] } });
    const plain = drive({});

    it("leads with Google when the corridor was checked", () => {
      const [primary, alternate] = navigationOptions(checked);
      expect(primary).toMatchObject({
        id: "google",
        title: "Google Maps · RV-checked",
        caption: "within 180 m of your corridor",
        url: checked.navUrl,
        primary: true,
      });
      expect(alternate).toMatchObject({
        id: "wego",
        title: "HERE WeGo · truck profile",
        url: checked.navWegoUrl,
        primary: false,
      });
    });

    it("leads with HERE WeGo when it did not — a worse route must not wear the label", () => {
      const [primary, alternate] = navigationOptions(plain);
      expect(primary).toMatchObject({ id: "wego", title: "HERE WeGo · truck profile" });
      expect(alternate).toMatchObject({
        id: "google",
        title: "Google Maps · plain",
        caption: "endpoints only — not the checked corridor",
      });
    });

    it("puts WeGo first EXACTLY when the verdict is plain", () => {
      for (const nav of [
        {},
        { [KEY]: { deviationMeters: null, intermediates: [] } },
        { [KEY]: { deviationMeters: 401, intermediates: [] } },
      ]) {
        expect(navigationOptions(drive(nav))[0]!.id).toBe("wego");
      }
      for (const nav of [
        { [KEY]: { deviationMeters: 0, intermediates: [] } },
        { [KEY]: { deviationMeters: 400, intermediates: [] } },
      ]) {
        expect(navigationOptions(drive(nav))[0]!.id).toBe("google");
      }
    });

    it("marks exactly one option primary, and it is the first", () => {
      for (const d of [checked, plain]) {
        const options = navigationOptions(d);
        expect(options.filter((o) => o.primary)).toHaveLength(1);
        expect(options[0]!.primary).toBe(true);
        expect(options.map((o) => o.id).sort()).toEqual(["google", "wego"]);
      }
    });

    it("captions a checked drive green, naming the measured deviation", () => {
      expect(navigationCaption(checked)).toEqual({
        tone: "checked",
        text: "Checked against the RV-safe corridor — within 180 m.",
      });
      // The number is rounded to whole meters; a corridor is not measured in cm.
      expect(
        navigationCaption(drive({ [KEY]: { deviationMeters: 180.4, intermediates: [] } })).text,
      ).toBe("Checked against the RV-safe corridor — within 180 m.");
    });

    it("captions a plain drive with the shipped amber string, character for character", () => {
      expect(navigationCaption(plain)).toEqual({
        tone: "plain",
        text: "Navigation may not follow the RV-safe route — check notices.",
      });
    });
  });
});

describe("routeSummary", () => {
  it("is exactly the sum of the drives the route view shows", () => {
    const trip = fixture();
    const legs = routeModel(trip);
    const visible = legs.flatMap((l) => [
      ...l.rows.map((r) => r.drive).filter((d) => d !== null),
      ...(l.outboundDrive ? [l.outboundDrive] : []),
    ]);
    const s = routeSummary(trip);
    expect(visible).toHaveLength(3);
    expect(s.driveMiles).toBe(visible.reduce((a, d) => a + d.miles, 0));
  });

  /**
   * The dashboard card's number (`summarize` in packages/db/src/queries.ts) is
   * now THIS expression — `routeSummary(trip, routes, hash).driveMiles` — over
   * the same `orderedPairs` the rail walks. The card used to sum a haversine
   * over adjacent SCHEDULED stops only, so it disagreed with the rail twice:
   * the metric (chord, not road) and the pair set (it never counted the drive
   * to a floating stop). Both gaps are asserted here, on the seed-shaped trip
   * the design is written against (docs/design/43 §3).
   */
  describe("the dashboard card's miles, over a Pacific-NW-Loop-shaped trip", () => {
    const HASH = "rig-x";
    const key = (p: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }) =>
      routeCacheKey(p.from, p.to, HASH);

    /** 136 mi of US-101, in HERE's units. */
    const routed = (meters: number, road: string): RouteResult => ({
      durationSeconds: 3 * 3600,
      distanceMeters: meters,
      polyline: null,
      primaryRoad: road,
      source: "here",
      notices: [],
    });

    it("counts every orderedPairs pair, INCLUDING the drive to the floating stop", () => {
      const trip = seedTrip();
      const pairs = orderedPairs(trip);
      // Astoria→Newport, Newport→Bend (the leg crossing) and Bend→Crater Lake
      // (floating, at the end of ITS leg) — the pair the card never had.
      expect(pairs.map((p) => [p.fromStopId, p.toStopId])).toEqual([
        ["astoria", "newport"],
        ["newport", "bend"],
        ["bend", "crater"],
      ]);
      const s = routeSummary(trip, {}, HASH);
      expect(s.driveMiles).toBe(
        pairs.reduce((a, p) => a + driveMiles(estimateRoute(p.from, p.to)), 0),
      );
      // The floating pair is not free — dropping it changes the total.
      const withoutFloating = pairs
        .slice(0, 2)
        .reduce((a, p) => a + driveMiles(estimateRoute(p.from, p.to)), 0);
      expect(s.driveMiles).toBeGreaterThan(withoutFloating);
    });

    it("takes the routed distance for a hit and estimateRoute for a miss", () => {
      const trip = seedTrip();
      const [coast, crossing, floating] = orderedPairs(trip);
      // Partially populated, exactly as a cold-ish cache answers: one hit.
      const routes: RouteMap = { [key(coast!)]: routed(218_866, "US-101") };
      const s = routeSummary(trip, routes, HASH);
      expect(driveMiles(routes[key(coast!)]!)).toBe(136);
      expect(s.driveMiles).toBe(
        136 +
          driveMiles(estimateRoute(crossing!.from, crossing!.to)) +
          driveMiles(estimateRoute(floating!.from, floating!.to)),
      );
      // And the flag the card reads off the SAME RouteMap: two keys missed.
      expect(orderedPairs(trip).filter((p) => !routes[key(p)])).toHaveLength(2);
      expect(orderedPairs(trip).some((p) => !routes[key(p)])).toBe(true);
    });

    it("is not estimating once every pair is cached", () => {
      const trip = seedTrip();
      const pairs = orderedPairs(trip);
      const routes: RouteMap = Object.fromEntries(
        pairs.map((p, i) => [key(p), routed(100_000 * (i + 1), "US-20")]),
      );
      expect(routeSummary(trip, routes, HASH).driveMiles).toBe(62 + 124 + 186);
      expect(pairs.some((p) => !routes[key(p)])).toBe(false);
    });

    it("a routingHash mismatch is a clean miss, not a wrong number", () => {
      const trip = seedTrip();
      const routes: RouteMap = Object.fromEntries(
        orderedPairs(trip).map((p) => [
          routeCacheKey(p.from, p.to, "other-rig"),
          routed(999_999, "US-101"),
        ]),
      );
      expect(routeSummary(trip, routes, HASH).driveMiles).toBe(
        routeSummary(trip, {}, HASH).driveMiles,
      );
    });
  });

  it("counts stops, days, gaps and cost", () => {
    const s = routeSummary(fixture());
    expect(s).toMatchObject({
      stops: 5,
      scheduled: 3,
      floating: 2,
      days: 10,
      openCount: 3,
      gapCount: 3,
      totalCost: 120,
      restrictionCount: 0,
    });
    expect(s.legs.map((l) => [l.name, l.stops, l.cost])).toEqual([
      ["Coast", 2, 120],
      ["Mountains", 3, 0],
    ]);
  });
});

describe("pure mutations", () => {
  it("scheduleFloating drops the stop into the LARGEST open run, up to `nights`", () => {
    // 08-10..08-12 is the longest open run (3 days) once the trip runs to 08-12.
    const next = scheduleFloating(fixture("2026-08-12"), "S4");
    const s4 = next.legs[1]!.stops.find((s) => s.id === "S4")!;
    expect([s4.arriveDate, s4.departDate]).toEqual(["2026-08-10", "2026-08-12"]);
  });

  it("scheduleFloating clamps to the run when it is shorter than `nights`", () => {
    // Every open run is a single day; the first one wins ties.
    const next = scheduleFloating(fixture(), "S4");
    const s4 = next.legs[1]!.stops.find((s) => s.id === "S4")!;
    expect([s4.arriveDate, s4.departDate]).toEqual(["2026-08-01", "2026-08-01"]);
  });

  it("scheduleFloating is a no-op with no open day", () => {
    const t = fixture("2026-08-09");
    t.legs[0]!.stops[0]!.arriveDate = "2026-08-01";
    t.legs[0]!.stops[1]!.departDate = "2026-08-08";
    expect(scheduleFloating(t, "S4")).toBe(t);
  });

  /**
   * The gantt drop (#40 i5). The dates below are the SEED trip's, so the three
   * gaps are the ones the masthead counts — "15 open days across 3 gaps":
   *
   *   Aug 1 (1 day, before the first arrival) · Aug 10–11 (2, between Newport
   *   and Bend) · Aug 17–28 (12, the tail after Bend).
   */
  describe("scheduleFloating takes the gap it was dropped on", () => {
    it("the seed trip really has those three gaps", () => {
      expect(timelineModel(seedTrip()).gaps).toEqual([
        { startCol: 1, span: 1 },
        { startCol: 10, span: 2 },
        { startCol: 17, span: 12 },
      ]);
    });

    it.each([
      ["Aug 1", { startCol: 1, span: 1 }, ["2026-08-01", "2026-08-01"]],
      ["Aug 10–11", { startCol: 10, span: 2 }, ["2026-08-10", "2026-08-11"]],
      ["Aug 17–28", { startCol: 17, span: 12 }, ["2026-08-17", "2026-08-19"]],
    ] as const)("dropped on %s → %s", (_label, gap, dates) => {
      const next = scheduleFloating(seedTrip(), "crater", gap);
      expect(crater(next)).toEqual(dates);
    });

    it("a one-day gap yields arrive === depart", () => {
      const next = scheduleFloating(seedTrip(), "crater", { startCol: 1, span: 1 });
      const [arrive, depart] = crater(next);
      expect(arrive).toBe(depart);
    });

    it("gap === null keeps the longest-run behaviour the sheet's Schedule button uses", () => {
      expect(crater(scheduleFloating(seedTrip(), "crater", null))).toEqual([
        "2026-08-17",
        "2026-08-19",
      ]);
      // …and omitting the argument entirely is the same call.
      expect(crater(scheduleFloating(seedTrip(), "crater"))).toEqual([
        "2026-08-17",
        "2026-08-19",
      ]);
    });

    it("clamps the span to `nights`, and `nights` to the gap", () => {
      expect(crater(scheduleFloating(seedTrip(), "crater", { startCol: 17, span: 12 }, 5))).toEqual([
        "2026-08-17",
        "2026-08-21",
      ]);
      expect(crater(scheduleFloating(seedTrip(), "crater", { startCol: 10, span: 2 }, 5))).toEqual([
        "2026-08-10",
        "2026-08-11",
      ]);
    });

    it("a gap that starts outside the trip window is a no-op", () => {
      const t = seedTrip();
      expect(scheduleFloating(t, "crater", { startCol: 99, span: 3 })).toBe(t);
      expect(scheduleFloating(t, "crater", { startCol: 0, span: 3 })).toBe(t);
    });

    it("no sortOrder is written — the dates alone reorder the leg", () => {
      const next = scheduleFloating(seedTrip(), "crater", { startCol: 10, span: 2 });
      const leg = next.legs[1]!;
      expect(leg.stops.map((s) => [s.id, s.sortOrder])).toEqual([
        ["bend", 0],
        ["crater", 1],
      ]);
      expect(orderedLegStops(leg.stops).map((s) => s.id)).toEqual(["crater", "bend"]);
    });

    it("does not mutate its input", () => {
      const t = seedTrip();
      const before = JSON.stringify(t);
      scheduleFloating(t, "crater", { startCol: 10, span: 2 });
      expect(JSON.stringify(t)).toBe(before);
    });
  });

  it("reorderFloating moves the dragged stop before the target and renumbers the leg", () => {
    const next = reorderFloating(fixture(), "B", "S5", "S4");
    const order = [...next.legs[1]!.stops].sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.id);
    expect(order).toEqual(["S3", "S5", "S4"]);
  });

  it("does not mutate its input", () => {
    const t = fixture();
    const before = JSON.stringify(t);
    reorderFloating(t, "B", "S5", "S4");
    scheduleFloating(t, "S4");
    setStopRating(t, "S1", 3);
    expect(JSON.stringify(t)).toBe(before);
  });

  it("cycleIdeaStatus walks idea → planned → done → idea", () => {
    let t = fixture();
    const status = () => t.legs[1]!.stops[0]!.ideas[0]!.status;
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("planned");
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("done");
    t = cycleIdeaStatus(t, "S3", "i1");
    expect(status()).toBe("idea");
  });

  it("setStopRating(0) clears the rating", () => {
    const t = setStopRating(fixture(), "S1", 0);
    expect(t.legs[0]!.stops[0]!.rating).toBeNull();
  });
});

describe("dates", () => {
  it("formats ranges the way the planner reads them", () => {
    expect(dateRange("2026-08-02", "2026-08-05")).toBe("Aug 2–5");
    expect(dateRange("2026-08-30", "2026-09-02")).toBe("Aug 30 – Sep 2");
    expect(dateRange("2026-08-02", "2026-08-02")).toBe("Aug 2");
    expect(fullRange("2026-08-01", "2026-08-10")).toBe("Aug 1 – 10, 2026");
    expect(fullRange("2026-08-25", "2026-09-03")).toBe("Aug 25 – Sep 3, 2026");
  });

  it("adds days across a month boundary in UTC", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // a DST Sunday in the US; plain dates don't care
  });
});

/**
 * The leg + stop structure mutations behind the planner's row menus. Creates
 * are NOT optimistic — the server mints the id and hands the row back — so the
 * two "append" helpers take a real row; everything else is optimistic and its
 * caller holds the pre-change trip as the rollback snapshot.
 */
describe("leg and stop structure mutations", () => {
  const newLeg = (id: string, sortOrder: number): Leg => ({
    id,
    tripId: "t",
    title: id,
    sortOrder,
    stops: [],
  });

  it("appendLeg splices the created leg in at the end", () => {
    const next = appendLeg(fixture(), newLeg("C", 2));
    expect(next.legs.map((l) => l.id)).toEqual(["A", "B", "C"]);
  });

  it("appendStop splices the created stop into its own leg, and nowhere else", () => {
    const created = stop({ id: "S6", legId: "A", sortOrder: 2 });
    const next = appendStop(fixture(), created);
    expect(next.legs[0]!.stops.map((s) => s.id)).toEqual(["S1", "S2", "S6"]);
    expect(next.legs[1]!.stops).toHaveLength(3);
  });

  it("renameLeg / renameStop rewrite exactly one title", () => {
    const next = renameStop(renameLeg(fixture(), "B", "Cascades"), "S3", "Bend, OR");
    expect(next.legs[1]!.title).toBe("Cascades");
    expect(next.legs[1]!.stops[0]!.place.name).toBe("Bend, OR");
    // the coordinates are NOT the rename's business
    expect(next.legs[1]!.stops[0]!.place.lat).toBe(44.05);
  });

  it("removeLeg takes its stops with it, the way the DB cascade does", () => {
    const next = removeLeg(fixture(), "A");
    expect(next.legs.map((l) => l.id)).toEqual(["B"]);
    expect(allStops(next).map((s) => s.id)).toEqual(["S3", "S4", "S5"]);
  });

  it("removeStop takes one stop and leaves the leg", () => {
    const next = removeStop(fixture(), "S4");
    expect(next.legs[1]!.stops.map((s) => s.id)).toEqual(["S3", "S5"]);
  });

  it("legOrder is the whole new order the reorder POST sends", () => {
    expect(legOrder(fixture())).toEqual(["A", "B"]);
    expect(legOrder(moveLeg(fixture(), "B", -1))).toEqual(["B", "A"]);
  });

  it("moveLeg renumbers so two legs can never share a sortOrder", () => {
    // Array position is left alone and sortOrder is rewritten — the same
    // convention reorderFloating follows, and what routeModel sorts on.
    const next = moveLeg(fixture(), "A", 1);
    expect(next.legs.map((l) => [l.id, l.sortOrder])).toEqual([
      ["A", 1],
      ["B", 0],
    ]);
  });

  it("moveLeg off either end is a no-op — the menu item is disabled there", () => {
    const t = fixture();
    expect(moveLeg(t, "A", -1)).toBe(t);
    expect(moveLeg(t, "B", 1)).toBe(t);
    expect(canMoveLeg(t, "A", -1)).toBe(false);
    expect(canMoveLeg(t, "A", 1)).toBe(true);
    expect(canMoveLeg(t, "B", 1)).toBe(false);
  });

  it("moveStopToLeg re-parents the stop and appends it to the destination", () => {
    const next = moveStopToLeg(fixture(), "S1", "B");
    expect(next.legs[0]!.stops.map((s) => s.id)).toEqual(["S2"]);
    expect(next.legs[1]!.stops.map((s) => s.id)).toEqual(["S3", "S4", "S5", "S1"]);
    const moved = next.legs[1]!.stops.at(-1)!;
    expect(moved.legId).toBe("B");
    // appended past the highest sortOrder in the destination (S5 is 2)
    expect(moved.sortOrder).toBe(3);
  });

  it("moveStopToLeg into the leg it is already in changes nothing", () => {
    const t = fixture();
    expect(moveStopToLeg(t, "S1", "A")).toBe(t);
  });

  it("setStopDates schedules, and both-null unschedules back to floating", () => {
    const scheduled = setStopDates(fixture(), "S4", "2026-08-12", "2026-08-14");
    const s4 = scheduled.legs[1]!.stops.find((s) => s.id === "S4")!;
    expect([s4.arriveDate, s4.departDate]).toEqual(["2026-08-12", "2026-08-14"]);

    const floating = setStopDates(fixture(), "S1", null, null);
    const s1 = floating.legs[0]!.stops.find((s) => s.id === "S1")!;
    expect([s1.arriveDate, s1.departDate]).toEqual([null, null]);
  });

  it("none of them mutates its input", () => {
    const t = fixture();
    const before = JSON.stringify(t);
    appendLeg(t, newLeg("C", 2));
    appendStop(t, stop({ id: "S6", legId: "A", sortOrder: 2 }));
    renameLeg(t, "A", "x");
    renameStop(t, "S1", "x");
    removeLeg(t, "A");
    removeStop(t, "S1");
    moveLeg(t, "A", 1);
    moveStopToLeg(t, "S1", "B");
    setStopDates(t, "S1", null, null);
    expect(JSON.stringify(t)).toBe(before);
  });
});

/**
 * The two LEAVES. A reservation and an idea are the only rows the sheet
 * creates, deletes and puts BACK — so the tree helpers under those gestures are
 * pinned here, including the one an "Undo" runs.
 */
describe("reservation and idea tree mutations", () => {
  function res(over: Partial<Reservation> = {}): Reservation {
    return {
      id: "r1",
      stopId: "S1",
      ideaId: null,
      type: "dining",
      name: "Rogue Ales brewery lunch",
      checkIn: null,
      checkOut: null,
      confirmationNumber: null,
      cost: 64,
      rating: null,
      notes: null,
      ...over,
    };
  }
  function ideaRow(over: Partial<Idea> = {}): Idea {
    return {
      id: "i1",
      stopId: "S1",
      title: "Rogue Ales brewery lunch",
      status: "planned",
      place: null,
      rating: null,
      notes: null,
      sortOrder: 0,
      ...over,
    };
  }
  /** A trip with one stop carrying one reservation and one idea. */
  function leafTrip(): Trip {
    const base = fixture();
    return {
      ...base,
      legs: base.legs.map((l) =>
        l.id === "A"
          ? {
              ...l,
              stops: l.stops.map((s) =>
                s.id === "S1" ? { ...s, reservations: [res()], ideas: [ideaRow()] } : s,
              ),
            }
          : l,
      ),
    };
  }

  it("appendReservation splices the row the 201 handed back", () => {
    const next = appendReservation(leafTrip(), "S1", res({ id: "r2", name: "Fort Stevens" }));
    expect(next.legs[0]!.stops[0]!.reservations.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("removeReservation drops it — and appendReservation puts it back (the Undo)", () => {
    const t = leafTrip();
    const gone = removeReservation(t, "S1", "r1");
    expect(gone.legs[0]!.stops[0]!.reservations).toEqual([]);
    // Undo re-POSTs the row, so it comes back with a NEW id and the same fields.
    const back = appendReservation(gone, "S1", res({ id: "r9" }));
    expect(back.legs[0]!.stops[0]!.reservations[0]).toMatchObject({
      id: "r9",
      name: "Rogue Ales brewery lunch",
      cost: 64,
    });
  });

  it("setReservationFields applies only the keys the patch carries", () => {
    const next = setReservationFields(leafTrip(), "S1", "r1", {
      name: "Rogue Ales lunch",
      cost: null,
    });
    const r = next.legs[0]!.stops[0]!.reservations[0]!;
    expect(r.name).toBe("Rogue Ales lunch");
    expect(r.cost).toBeNull();
    // untouched keys survive
    expect(r.type).toBe("dining");
  });

  it("appendIdea and removeIdea are the idea's create and delete", () => {
    const added = appendIdea(leafTrip(), "S1", ideaRow({ id: "i2", title: "Cape Perpetua" }));
    expect(added.legs[0]!.stops[0]!.ideas.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(removeIdea(added, "S1", "i1").legs[0]!.stops[0]!.ideas.map((i) => i.id)).toEqual(["i2"]);
  });

  it("applyPromotion swaps the idea for the reservation the server minted", () => {
    // The chosen type is the SERVER's answer, not a client guess — this used to
    // hardcode "activity".
    const next = applyPromotion(leafTrip(), "S1", "i1", res({ id: "r5", type: "dining" }));
    const s = next.legs[0]!.stops[0]!;
    expect(s.ideas).toEqual([]);
    expect(s.reservations.map((r) => [r.id, r.type])).toEqual([
      ["r1", "dining"],
      ["r5", "dining"],
    ]);
  });

  it("none of them mutates its input", () => {
    const t = leafTrip();
    const before = JSON.stringify(t);
    appendReservation(t, "S1", res({ id: "r2" }));
    removeReservation(t, "S1", "r1");
    setReservationFields(t, "S1", "r1", { name: "x" });
    appendIdea(t, "S1", ideaRow({ id: "i2" }));
    removeIdea(t, "S1", "i1");
    applyPromotion(t, "S1", "i1", res({ id: "r5" }));
    expect(JSON.stringify(t)).toBe(before);
  });
});
