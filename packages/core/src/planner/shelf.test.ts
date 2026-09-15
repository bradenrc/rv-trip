import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { Idea, Stop, Trip } from "../domain/types";
import { trip as tripSchema } from "../domain/types";
import { ideaShelf, shelfIdeas, NEAR_RADIUS_MI } from "./shelf";
import { planIdeaOnGap, scheduleFloating, timelineModel } from "./index";

/**
 * The trip's idea shelf (#80 i1) — the rail's whole model.
 *
 * Everything here is a pure function of a `Trip`, which is why it is asserted
 * in packages/core rather than against a rendered rail: what the walk has to
 * prove is the two-payload DRAG, which is pointer behaviour no unit test can
 * reach. What is proved here is the arithmetic the rail draws — which rows are
 * on the shelf, which group they sit in, and what each chip counts.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
/** Source with comments stripped — a claim about CODE must not be satisfied by
 * a comment that merely mentions the thing. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Truckee, CA — the design's own geography, so the distances are real ones.
const TRUCKEE = { lat: 39.328, lng: -120.1833 };
// ~33 mi south-east, still inside the 50-mile radius.
const ZEPHYR = { lat: 38.9946, lng: -119.9482 };
// Bridgeport, CA — ~70 mi south, outside it.
const BRIDGEPORT = { lat: 38.2574, lng: -119.2313 };

function stop(over: Partial<Stop> & { id: string }): Stop {
  return {
    legId: "L1",
    place: { name: "Village Camp Truckee", ...TRUCKEE, googlePlaceId: null },
    arriveDate: "2026-10-10",
    departDate: "2026-10-17",
    sortOrder: 0,
    rating: null,
    notes: null,
    reservations: [],
    ideas: [],
    ...over,
  };
}

function idea(over: Partial<Idea> & { id: string }): Idea {
  return {
    tripId: "T1",
    stopId: null,
    title: "A maybe",
    category: "do",
    status: "idea",
    place: null,
    rating: null,
    notes: null,
    sortOrder: 0,
    ...over,
  };
}

const placed = (name: string, at: { lat: number; lng: number }) => ({
  name,
  ...at,
  googlePlaceId: null,
});

function fixture(ideas: Idea[], stops: Stop[] = [stop({ id: "S1" })]): Trip {
  return {
    id: "T1",
    ownerId: "dev-user",
    title: "Truckee & the Eastern Sierra",
    homeBase: null,
    homeBasePlace: null,
    startDate: "2026-10-10",
    endDate: "2026-11-10",
    status: "planning",
    statusAuto: true,
    rating: null,
    note: null,
    ideas,
    legs: [{ id: "L1", tripId: "T1", title: "Tahoe North", sortOrder: 0, stops }],
  };
}

/** The design's frame: 2 stays, 3 eats, 4 dos, two of them with no coordinates. */
function shelfTrip(): Trip {
  return fixture([
    idea({
      id: "i1",
      category: "stay",
      title: "Coachland RV Park",
      place: placed("Coachland RV Park", { lat: 39.3438, lng: -120.2046 }),
      sortOrder: 0,
    }),
    idea({
      id: "i2",
      category: "stay",
      title: "Zephyr Cove RV Park",
      place: placed("Zephyr Cove RV Park", ZEPHYR),
      sortOrder: 1,
    }),
    idea({
      id: "i3",
      category: "eat",
      title: "Full Belly Deli",
      place: placed("Full Belly Deli", { lat: 39.3266, lng: -120.1856 }),
      sortOrder: 2,
    }),
    idea({
      id: "i4",
      category: "do",
      title: "Mt Rose Meadows hike",
      // The picker's free-text escape row: a NAME with no coordinates.
      place: { name: "Mt Rose Meadows", lat: null, lng: null, googlePlaceId: null },
      sortOrder: 3,
    }),
    idea({ id: "i5", category: "do", title: "Hot springs south of Bridgeport", sortOrder: 4 }),
    idea({
      id: "i6",
      category: "do",
      title: "Bodie ghost town",
      place: placed("Bodie", BRIDGEPORT),
      sortOrder: 5,
    }),
    // ATTACHED — it has a stop, so it is NOT on the shelf.
    idea({ id: "i7", category: "do", title: "Donner Memorial", stopId: "S1", sortOrder: 6 }),
  ]);
}

describe("shelfIdeas — only the unattached rows", () => {
  it("returns stopId === null rows and nothing else", () => {
    expect(shelfIdeas(shelfTrip()).map((r) => r.idea.id)).toEqual([
      "i1",
      "i2",
      "i3",
      "i4",
      "i5",
      "i6",
    ]);
  });

  it("names the nearest LOCATED stop and how far, for the row's second line", () => {
    const rows = shelfIdeas(shelfTrip());
    const coachland = rows.find((r) => r.idea.id === "i1")!;
    expect(coachland.nearestStopId).toBe("S1");
    expect(coachland.nearestStopName).toBe("Village Camp Truckee");
    expect(coachland.distanceMi).toBeGreaterThan(0);
    expect(coachland.distanceMi).toBeLessThan(5);
  });

  it("measures nothing for a coordless row — half a fact is not a distance", () => {
    const rows = shelfIdeas(shelfTrip());
    for (const id of ["i4", "i5"]) {
      const row = rows.find((r) => r.idea.id === id)!;
      expect(row.distanceMi).toBeNull();
      expect(row.nearestStopName).toBeNull();
    }
  });

  it("measures nothing when the trip has no located stop to measure FROM", () => {
    const noAnchor = fixture(
      [idea({ id: "i1", place: placed("Coachland", TRUCKEE) })],
      [stop({ id: "S1", place: { name: "Somewhere", lat: null, lng: null, googlePlaceId: null } })],
    );
    expect(shelfIdeas(noAnchor)[0]!.distanceMi).toBeNull();
  });
});

describe("ideaShelf — the groups, the chips and the counts", () => {
  it("groups Stay / Eat / Do, in that order, dropping the empty ones", () => {
    const shelf = ideaShelf(shelfTrip());
    expect(shelf.groups.map((g) => g.label)).toEqual(["Stay", "Eat", "Do"]);
    expect(shelf.groups.map((g) => g.ideas.length)).toEqual([2, 1, 3]);
  });

  it("counts the whole shelf and the rows with no coordinates", () => {
    const shelf = ideaShelf(shelfTrip());
    expect(shelf.total).toBe(6);
    expect(shelf.coordlessCount).toBe(2);
    expect(shelf.countLabel).toBe("6 · 2 not on the map");
  });

  it("produces one proximity chip per located stop, plus Anywhere and the amber one", () => {
    const shelf = ideaShelf(shelfTrip());
    expect(shelf.chips.map((c) => [c.label, c.count])).toEqual([
      // Coachland, Zephyr Cove and Full Belly are inside 50 mi of the stop;
      // Bodie (~70 mi) is not, and the two coordless rows are in no radius.
      ["Near Village Camp Truckee", 3],
      ["Anywhere", 6],
      ["No place yet", 2],
    ]);
    expect(shelf.chips.find((c) => c.label === "No place yet")!.warn).toBe(true);
    expect(shelf.chips.find((c) => c.label === "Anywhere")!.warn).toBe(false);
  });

  it("drops the amber chip when every row is on the map", () => {
    const mapped = fixture([idea({ id: "i1", place: placed("Coachland", TRUCKEE) })]);
    const shelf = ideaShelf(mapped);
    expect(shelf.chips.map((c) => c.label)).not.toContain("No place yet");
    expect(shelf.countLabel).toBe("1");
  });

  it("the near chip filters to what is within NEAR_RADIUS_MI of that stop", () => {
    const shelf = ideaShelf(shelfTrip(), { kind: "near", stopId: "S1" });
    const ids = shelf.groups.flatMap((g) => g.ideas.map((r) => r.idea.id));
    expect(ids).toEqual(["i1", "i2", "i3"]);
    expect(NEAR_RADIUS_MI).toBe(50);
  });

  it("the amber chip filters to BOTH coordless states — a bare name and nothing at all", () => {
    const shelf = ideaShelf(shelfTrip(), { kind: "coordless" });
    expect(shelf.groups.flatMap((g) => g.ideas.map((r) => r.idea.id))).toEqual(["i4", "i5"]);
  });

  it("an empty shelf has no chips to press but Anywhere, and no count line", () => {
    const shelf = ideaShelf(fixture([]));
    expect(shelf.total).toBe(0);
    expect(shelf.countLabel).toBeNull();
    expect(shelf.groups).toEqual([]);
    expect(shelf.chips.map((c) => c.label)).toEqual(["Anywhere"]);
  });
});

describe("planIdeaOnGap — the drop's dates are scheduleFloating's dates", () => {
  /** Oct 10 – Nov 10 with one stop scheduled Oct 10–17: the open run starts
   * Oct 18, exactly as the design's frame draws it. */
  function dropTrip(): Trip {
    return fixture(
      [idea({ id: "i1", category: "stay", place: placed("Coachland", TRUCKEE) })],
      [
        stop({ id: "S1", arriveDate: "2026-10-10", departDate: "2026-10-17" }),
        {
          ...stop({ id: "S2" }),
          place: { name: "Floater", ...TRUCKEE, googlePlaceId: null },
          arriveDate: null,
          departDate: null,
          sortOrder: 1,
        },
      ],
    );
  }

  it("takes the dropped span's FIRST date and min(3, span) days", () => {
    const t = dropTrip();
    const gap = timelineModel(t).gaps[0]!;
    expect(planIdeaOnGap(t, gap)).toEqual({
      arriveDate: "2026-10-18",
      departDate: "2026-10-20",
    });
  });

  it("is the same rule the floating-stop drop uses — identical means identical", () => {
    const t = dropTrip();
    const gap = timelineModel(t).gaps[0]!;
    const scheduled = scheduleFloating(t, "S2", gap).legs[0]!.stops.find((s) => s.id === "S2")!;
    expect(planIdeaOnGap(t, gap)).toEqual({
      arriveDate: scheduled.arriveDate,
      departDate: scheduled.departDate,
    });
  });

  it("a one-day span is a legal single-day stay, not a three-day guess", () => {
    const t = dropTrip();
    const gap = timelineModel(t).gaps[0]!;
    expect(planIdeaOnGap(t, { startCol: gap.startCol, span: 1 })).toEqual({
      arriveDate: "2026-10-18",
      departDate: "2026-10-18",
    });
  });

  it("a gap the trip no longer has is a no-op, never a guess", () => {
    const t = dropTrip();
    expect(planIdeaOnGap(t, { startCol: 9999, span: 3 })).toBeNull();
  });
});

describe("the trip tree carries the shelf", () => {
  it("parses a tree with ideas[] beside legs[]", () => {
    const parsed = tripSchema.parse(shelfTrip());
    expect(parsed.ideas.map((i) => i.id)).toHaveLength(7);
    expect(parsed.ideas.filter((i) => i.stopId === null)).toHaveLength(6);
  });

  it("defaults ideas[] to empty — every shipped caller predates the shelf", () => {
    const { ideas: _dropped, ...withoutShelf } = shelfTrip();
    expect(tripSchema.parse(withoutShelf).ideas).toEqual([]);
  });
});

describe("the do/eat/stay vocabulary has ONE door into the five-category language", () => {
  it("no hardcoded activity type is left in the planner or the idea card", () => {
    expect(code(read("packages/core/src/planner/index.ts"))).not.toContain('"activity"');
    expect(code(read("packages/ui/src/DetailCards.tsx"))).not.toContain('categoryMeta("activity")');
    expect(code(read("packages/ui/src/DetailCards.tsx"))).toContain(
      "ideaCategoryMeta(idea.category)",
    );
  });

  it("ideaCategoryMeta maps stay/eat/do onto Stay/Eat/Do", () => {
    const src = code(read("packages/ui/src/category.ts"));
    expect(src).toContain("export function ideaCategoryMeta");
    // The bridge is `categoryMeta` itself — one lookup, not a second table.
    expect(src).toContain("return categoryMeta(ideaCategoryType(c));");
    expect(src).toMatch(/case "stay":\s*return "campground";/);
    expect(src).toMatch(/case "eat":\s*return "dining";/);
  });

  /** Q6's copy walks the SAME bridge the other way: `saved_places.type` becomes
   * the idea category through `categoryMeta(type).cat`, never a second table of
   * eight types. */
  it("ideaCategoryOfType reads the five-category label rather than re-listing the types", () => {
    const src = code(read("packages/ui/src/category.ts"));
    expect(src).toContain("export function ideaCategoryOfType");
    expect(src).toContain("switch (categoryMeta(type).cat)");
    expect(src).toMatch(/case "Stay":\s*return "stay";/);
    expect(src).toMatch(/case "Eat":\s*return "eat";/);
  });

  /** Q7's binding comment: every path that learns a place persists Google's id.
   * The two the shelf adds are the Add-from-Places copy and the drop's stop
   * create — both send the whole nested `place`, which carries all four
   * columns together rather than a name and a pair of coordinates. */
  it("the shelf's two new place paths carry googlePlaceId", () => {
    const planner = code(read("apps/web/src/components/trip/TripPlanner.tsx"));
    // The copy hands the saved place's whole `place` across.
    expect(planner).toMatch(/addIdeaFromPlace[\s\S]*?place: p\.place,/);
    // The drop's stop create hands the idea's whole `place` across.
    expect(planner).toMatch(/tripApi\.createStop\(\{[\s\S]*?place: it\.place \?\?/);
  });
});
