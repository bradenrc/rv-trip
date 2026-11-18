import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i7 · #185 on the web: the Places map panel beside the grid
 * (docs/design/186 §4 · q9 A). At md and up the grid and a sticky 360px map
 * panel sit side by side and the Grid ⇄ Map switch is hidden; below md the
 * shipped lens is unchanged.
 *
 * This vitest has no DOM and MapMount needs a browser (mapbox-gl), so the
 * wiring is read as source. Hover, pin clicks, the scroll and the pixels are
 * the walk's: render-required, see dev-notes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const library = readFileSync(join(HERE, "PlacesLibrary.tsx"), "utf8");

/** The JSX from the first match of `start` to the end of the file. */
const from = (start: RegExp) => {
  const m = start.exec(library);
  return m ? library.slice(m.index) : "";
};

describe("PlacesLibrary · the md+ map panel (source)", () => {
  it("wraps the ViewSwitch in an md:hidden element", () => {
    expect(library).toMatch(/<div className="md:hidden">\s*<ViewSwitch/);
  });

  it("keeps the shipped lens below md only, so one map shows per breakpoint (vet MED)", () => {
    const lens = from(/\{view === "map" && \(/);
    expect(lens, 'the lens is its own view === "map" branch').not.toBe("");
    expect(lens).toMatch(/^\{view === "map" && \(\s*<div className="md:hidden">/);
    // At md+ the split always shows, whatever the lens state says.
    expect(library).toMatch(/view === "map" \? "hidden md:grid" : "grid"/);
  });

  it("renders MapMount inside an md:grid-cols-[1fr_360px] split, outside the lens branch", () => {
    const split = from(/\{\/\* #186 i7[\s\S]*?md:grid-cols-\[1fr_360px\]/);
    expect(split, "the panel split").not.toBe("");
    const panel = /<aside[\s\S]*?<\/aside>/.exec(split)?.[0] ?? "";
    expect(panel).toContain("<MapMount");
    expect(panel).toMatch(/hidden[^"]*md:flex/);
    expect(panel).toMatch(/md:sticky/);
    expect(panel).toMatch(/height="520px"/);
  });

  it("feeds the panel buildMapModel([], list) — exactly what the grid lists", () => {
    expect(library).toMatch(
      /const lens = useMemo\(\(\) => buildMapModel\(\[\], list\), \[list\]\)/,
    );
    const panel = /<aside[\s\S]*?<\/aside>/.exec(library)?.[0] ?? "";
    expect(panel).toMatch(/pins=\{lens\.pins\}/);
    expect(panel).toMatch(/unmappedCount=\{lens\.unmapped\.length\}/);
  });

  it("passes selectedId and onSelect, and a pin scrolls its card into view", () => {
    const panel = /<aside[\s\S]*?<\/aside>/.exec(library)?.[0] ?? "";
    expect(panel).toMatch(/selectedId=\{selectedId\}/);
    expect(panel).toMatch(/onSelect=\{selectPin\}/);
    expect(library).toContain("const [selectedId, setSelectedId] = useState<string | null>(null);");
    expect(library).toContain('scrollIntoView({ block: "nearest" })');
  });

  it("selects a card on hover or click and rings the selected one", () => {
    const card = /const cardFor = [\s\S]*?\n  \);/.exec(library)?.[0] ?? "";
    expect(card).toMatch(/onMouseEnter=\{\(\) => setSelectedId\(p\.id\)\}/);
    expect(card).toMatch(/onClick=\{\(\) => setSelectedId\(p\.id\)\}/);
    expect(card).toContain("ring-2 ring-rv-green shadow-rv-lg");
    expect(card).toMatch(/data-save-id=\{p\.id\}/);
  });

  it("heads the panel with the mono mapped-of-listed kicker", () => {
    const panel = /<aside[\s\S]*?<\/aside>/.exec(library)?.[0] ?? "";
    expect(panel).toMatch(/On the map · \{lens\.pins\.length\} of \{list\.length\} listed/);
    expect(panel).toMatch(/font-mono/);
  });
});
