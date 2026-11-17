import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #179 · #181 i5 — the web Journal map, read as source (this vitest has no
 * DOM; `journalMap` itself is unit tested in packages/core's
 * planner/journal-map.test.ts). How it looks on a canvas is the walk's.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
/** Source with comments stripped, so a comment cannot satisfy a claim. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const lens = flat(code(read("components/trip/JournalLens.tsx")));
const jmap = flat(code(read("components/trip/JournalMap.tsx")));
const mapView = flat(code(read("components/map/MapView.tsx")));
const mapMount = flat(code(read("components/map/MapMount.tsx")));
const pins = flat(code(read("components/map/pins.ts")));

describe("JournalMap (#179)", () => {
  it("reads core's journalMap and makes no request", () => {
    expect(jmap).toContain("journalMap(trip, today)");
    for (const src of [jmap]) {
      expect(src).not.toMatch(/routeTrip|fetch\(|providers|routing|\/api\//);
    }
  });

  it("maps points onto DestinationPin (been layer when been) and IdeaPin with a category", () => {
    expect(jmap).toContain('kind: "destination"');
    expect(jmap).toContain('layer: p.been ? "been" : layer');
    expect(jmap).toContain('kind: "idea"');
    expect(jmap).toContain("category: p.category");
  });

  it("passes the join, the unmapped count and the two-way selection to MapMount", () => {
    expect(jmap).toMatch(/<MapMount pins=\{pins\} join=\{m\.join\} unmappedCount=\{m\.unmapped\} selectedId=\{selectedId\} onSelect=\{onSelect\}/);
  });
});

describe("JournalLens · the map beside the list (#179 · q6 A)", () => {
  it("renders JournalMap in one md:grid-cols split around both forms", () => {
    expect(lens).toContain('className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(300px,420px)_1fr]"');
    expect(lens).toContain("<JournalMap trip={trip} today={today}");
    // One grid, both forms inside its left column.
    expect(lens.indexOf("md:grid-cols-[minmax(300px,420px)_1fr]")).toBeLessThan(lens.indexOf("midTrip && !whole ? ("));
    expect(lens.indexOf("midTrip && !whole ? (")).toBeLessThan(lens.indexOf("<JournalMap"));
    expect(lens.match(/md:grid-cols-/g)).toHaveLength(1);
  });

  it("omits the map when the journal is empty, and stacks it above the list at 200px below md", () => {
    expect(lens).toContain("!journalIsEmpty(tripJournal(trip)) && (");
    expect(jmap).toMatch(/className="order-first [^"]*\bmd:order-none\b/);
    expect(jmap).toContain("h-[200px]");
    expect(jmap).toContain("md:min-h-[440px]");
  });

  it("selects both ways: a row or a heading selects its pin, a pin selects its row or heading", () => {
    expect(lens).toContain("const [selectedId, setSelectedId] = useState<string | null>(null);");
    expect(lens).toContain("onSelect={setSelectedId}");
    expect(lens).toContain("bg-rv-navy-soft shadow-[inset_3px_0_0_var(--color-rv-ink)]");
  });
});

describe("MapView / MapMount draw the join; IdeaPin carries a category", () => {
  it("MapMount passes join through", () => {
    expect(mapMount).toContain("join?: [number, number][];");
    expect(mapMount).toContain("join={join}");
  });

  it("MapView draws join as one dashed line at the arc paint, with no label", () => {
    expect(mapView).toContain("join?: [number, number][];");
    expect(mapView).toMatch(/<Source id="rv-journal-join" type="geojson" data=\{joinGeoJson\}>/);
    expect(mapView).toMatch(
      /id="rv-journal-join-dash" type="line" layout=\{\{ "line-cap": "round" \}\} paint=\{\{ "line-color": palette\.arcLine, "line-width": palette\.arcWidth, "line-opacity": palette\.arcOpacity, "line-dasharray": \[2\.2, 1\.8\], \}\}/,
    );
  });

  it("IdeaPin's optional category paints with palette.category", () => {
    expect(pins).toContain("category?: CategoryLabel;");
    expect(mapView).toContain("palette.category[category]");
  });
});
