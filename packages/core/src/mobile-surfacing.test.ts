import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #111 i3 — the phone's trip-surfacing WIRING, read as source.
 *
 * `apps/mobile` has no test runner (the mobile-capture.test.ts pattern): the
 * numbers and copy are unit tested in planner/nearby-saves.test.ts, and the
 * routes in apps/web; what is pinned HERE is that the trip screen and the
 * sheet route through them. How the banner, the Modal sheet and the chips
 * render on a device is the walk's (render-required, dev-notes.md).
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const screen = code(read("app/(tabs)/(trips)/trips/[id]/index.tsx"));
const nearby = code(read("src/nearby.tsx"));
const store = code(read("src/store.ts"));

describe("the Ideas tab (#131 · Q1 A — the banner and the maybes moved off Route)", () => {
  it("draws the banner, then the Ideas list, in the Ideas branch — before the Rhythm (Timeline) card", () => {
    const ideasBranch = screen.indexOf('lens === "ideas" ? (');
    const banner = screen.indexOf("<NearbyBanner");
    const ideas = screen.indexOf("<IdeasTab");
    const rhythm = screen.indexOf("<Kicker>Rhythm</Kicker>");
    expect(ideasBranch).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(ideasBranch);
    expect(banner).toBeLessThan(ideas);
    expect(ideas).toBeLessThan(rhythm);
    expect(screen).not.toContain("<IdeasSection");
  });

  it("shows the banner only while a save is surfaced, and Dismiss sends every surfaced id", () => {
    expect(screen).toMatch(/nearby\.items\.length > 0/);
    expect(screen).toMatch(/dismissNearby\(\s*trip\.id,\s*surfaced\.items\.map\(\(i\) => i\.saveId\)/);
  });
});

describe("the copy comes from core", () => {
  it("banner, Ideas heading and empty copy", () => {
    expect(nearby).toContain("nearbyBanner(nearby.items.length, nearby.radiusMi)");
    expect(nearby).toContain("ideasHeading(rows.length)");
    expect(nearby).toContain("IDEAS_EMPTY_COPY");
  });

  it("the sheet's count, rows, beyond line and Add all", () => {
    expect(nearby).toContain("Near this trip");
    expect(nearby).toContain("nearbyCountLabel(rows.length)");
    expect(nearby).toContain("nearbyRowLine(item)");
    expect(nearby).toContain("nearbyBeyondLine(nearby.beyond, nearby.radiusMi)");
    expect(nearby).toContain("addAllLabel(toAdd.length)");
    expect(nearby).toContain('"✓ Idea"');
  });
});

describe("the sheet's writes", () => {
  it("the chips are the four radii and write the trip's radius", () => {
    expect(nearby).toContain("SURFACE_RADII.map(");
    expect(nearby).toContain("setSurfaceRadius(tripId, r)");
    expect(store).toContain("api.trips.patch(tripId, { surfaceRadiusMi: radius })");
  });

  it("Add copies the save through POST /api/ideas and splices the 201 onto the shelf", () => {
    expect(store).toContain("api.ideas.create(nearbyIdeaBody(tripId, item))");
    expect(store).toContain("appendShelfIdea(t, created)");
  });

  it("Dismiss posts the ids for this trip", () => {
    expect(store).toContain("api.trips.dismissSaves(tripId, saveIds)");
  });
});
