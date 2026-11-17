import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i6 · #184 on the phone — the Map tab (docs/design/186 §3 · q6 A · q7 A
 * · q11 A), read as source. `apps/mobile` has no test runner, so this follows
 * mobile-journal-map.test.ts: `libraryMap`, `libraryTrips` and the filter rule
 * are unit tested in planner/library-map.test.ts; what is pinned HERE is that
 * the tab exists in the right place, draws core's library map through the
 * shipped TripMap with no drive arcs, and that a been save is a ring. How it
 * looks on a dev-client build is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const layout = code(read("app/(tabs)/_layout.tsx"));
const rawTab = read("app/(tabs)/map.tsx");
const tab = flat(code(rawTab));
const map = flat(code(read("src/map.tsx")));

describe("phone tabs · the Map tab sits between Capture and You", () => {
  it("declares (trips) · saves · add · map · you, in that order", () => {
    const names = [...layout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["(trips)", "saves", "add", "map", "you"]);
  });

  it("titles it Map with a Text glyph, like its siblings", () => {
    expect(flat(layout)).toMatch(
      /name="map" options=\{\{ title: "Map", tabBarIcon: \(\{ color \}\) => <Text style=\{\[styles\.glyph, \{ color \}\]\}>◎<\/Text>,/,
    );
  });
});

describe("phone Map tab · app/(tabs)/map.tsx", () => {
  it("reads core's libraryMap over the trip trees and the saves, and libraryTrips", () => {
    expect(tab).toMatch(/libraryMap\(trees \?\? \[\], saves \?\? \[\], today, filter\)/);
    expect(tab).toMatch(/\blibraryTrips\(/);
    expect(tab).toContain("useTripTrees()");
    expect(tab).toContain("useSaves()");
  });

  it("renders TripMap (pins + entries, no arcs) and MapFrame", () => {
    expect(tab).toContain("<TripMap");
    expect(tab).toContain("<MapFrame");
    expect(tab).not.toMatch(/\barcs=/);
    expect(tab).not.toMatch(/tripArcs/);
  });

  it("imports no routing module and never asks a server for a drive", () => {
    expect(rawTab).not.toMatch(/routing|routeTrip|api\.routes|fetch\(/);
  });

  it("draws the four chips — active on navy with ink, idle on surfaceAlt with borderHi", () => {
    for (const label of ['"All"', '"Been there"', '"Want to go"', '"One trip"']) expect(tab).toContain(label);
    expect(tab).toContain('" ▾"');
    expect(tab).toMatch(/backgroundColor: C\.navy, borderColor: "transparent"/);
    expect(tab).toMatch(/backgroundColor: C\.surfaceAlt, borderColor: C\.borderHi/);
  });

  it("opens a Show one trip sheet listing each trip's dates and destinations", () => {
    expect(tab).toContain("Show one trip");
    expect(tab).toContain("<Modal");
    expect(tab).toMatch(/\{t\.dates\} · \{destinationsLabel\(t\.destinations\)\}/);
  });

  it("raises a card: a save's shelf, trip and Stars; a destination's stop and Trip →", () => {
    expect(tab).toContain("<CategoryTile");
    expect(tab).toContain("<Stars");
    expect(tab).toContain('"Been there"');
    expect(tab).toMatch(/· stop \$\{/);
    expect(tab).toContain("Trip →");
    expect(tab).toContain("router.push(`/trips/${");
  });
});

describe("phone TripMap · a been save is a ring (q6 A)", () => {
  it("TripMapEntry gains an optional been", () => {
    expect(map).toMatch(/export interface TripMapEntry \{[^}]*been\?: boolean;/);
  });

  it("draws been as a category ring on hollowGround, otherwise the shipped filled disc", () => {
    expect(map).toContain(
      "e.been === true ? { backgroundColor: palette.hollowGround, borderColor: palette.category[e.category] } : { backgroundColor: palette.category[e.category], borderColor: palette.hollowGround }",
    );
  });
});
