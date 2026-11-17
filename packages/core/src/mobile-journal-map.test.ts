import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #179 · #181 i5 — the phone's Journal map, read as source. `apps/mobile` has
 * no test runner, so this follows mobile-journal-today.test.ts: `journalMap` is
 * unit tested in planner/journal-map.test.ts, and what is pinned HERE is that
 * the whole-trip Journal draws it through the shipped TripMap with a Map · List
 * only toggle remembered under "rv-journal-map". How it looks (and pans inside
 * the ScrollView) on a device is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const journal = flat(code(read("src/journal.tsx")));
const map = flat(code(read("src/map.tsx")));

describe("phone TripMap accepts the Journal's join, entries and selection (#179)", () => {
  it("TripMapProps gains join, entries, selectedId and onSelect", () => {
    expect(map).toContain("join?: [number, number][];");
    expect(map).toContain("entries?: TripMapEntry[];");
    expect(map).toContain("selectedId?: string | null;");
    expect(map).toContain("onSelect?: (id: string) => void;");
  });

  it("draws the join as one dashed line at the arc paint, and entries as category discs", () => {
    expect(map).toContain('const JOIN_ID = "rv-journal-join";');
    expect(map).toContain("<ShapeSource id={JOIN_ID} shape={joinShape}>");
    expect(map).toMatch(
      /joinDash: LineLayerStyle = \{ lineCap: "round", lineColor: palette\.arcLine, lineWidth: palette\.arcWidth, lineOpacity: palette\.arcOpacity, lineDasharray: ESTIMATE_DASH, \}/,
    );
    expect(map).toContain("backgroundColor: palette.category[e.category]");
  });

  it("is empty only when there is neither a disc nor an entry", () => {
    expect(map).toContain('if (pins.length === 0 && entries.length === 0) return <MapFrame state="empty" height={height} />');
  });
});

describe("phone JournalView · the whole-trip map (#179 · q5 A · q7 A)", () => {
  it("reads and writes rv-journal-map, defaulting to map", () => {
    expect(journal).toContain('export const JOURNAL_MAP_PREF_KEY = "rv-journal-map";');
    expect(journal).toContain("AsyncStorage.getItem(JOURNAL_MAP_PREF_KEY)");
    expect(journal).toContain("AsyncStorage.setItem(JOURNAL_MAP_PREF_KEY, next)");
    expect(journal).toContain('raw === "list" ? "list" : "map"');
  });

  it("renders a mono Segmented Map · List only", () => {
    expect(journal).toContain('{ value: "map", label: "Map" }');
    expect(journal).toContain('{ value: "list", label: "List only" }');
    expect(journal).toMatch(/<Segmented mono value=\{choice\} options=\{JOURNAL_MAP_SEGMENTS\} onChange=\{setChoice\} \/>/);
  });

  it("draws core's journalMap through TripMap at 196pt with no labels and two-way selection", () => {
    expect(journal).toContain("journalMap(trip, today)");
    expect(journal).toMatch(
      /<TripMap pins=\{pins\} entries=\{entries\} join=\{m\.join\} mode=\{mode\} showLabels=\{false\} height=\{JOURNAL_MAP_HEIGHT\} selectedId=\{selectedId\} onSelect=\{setSelectedId\} \/>/,
    );
    expect(journal).toContain("const JOURNAL_MAP_HEIGHT = 196;");
  });

  it("covers loading with MapFrame and omits map and toggle on an empty journal", () => {
    expect(journal).toContain('<MapFrame state="loading" height={JOURNAL_MAP_HEIGHT} />');
    expect(journal).toContain("{!journalIsEmpty(j) && (");
  });

  it("makes no request on the way", () => {
    expect(journal).not.toMatch(/routeTrip|fetch\(/);
  });
});
