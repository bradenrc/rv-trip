import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i6 · #184 on the web (docs/design/186 §5 · q8 A): /map's first chip row
 * is the four single-select filters, All · Been there · Want to go · One trip.
 * The rule is core's `libraryFilterKeeps` (planner/library-map.test.ts) and
 * the counts / arc rule are pins.ts's (pins.test.ts). What is pinned here is
 * the wiring, read as source: the layer chips are gone, One trip is the
 * shipped dropdown-menu, and the destination disc draws hollow from its own
 * `been`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const overview = readFileSync(join(HERE, "MapOverview.tsx"), "utf8");
const view = readFileSync(join(HERE, "MapView.tsx"), "utf8");
const pins = readFileSync(join(HERE, "pins.ts"), "utf8");
const page = readFileSync(join(SRC, "app/map/page.tsx"), "utf8");

/** The body of a top-level `function name(` up to the next top-level function. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = src.indexOf("\nfunction ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("web /map · the four filters", () => {
  it("no longer maps LAYER_ORDER to chips, and pins.ts no longer exports it", () => {
    expect(overview).not.toMatch(/LAYER_ORDER/);
    expect(overview).not.toMatch(/toggleLayer|layerCounts/);
    expect(pins).not.toMatch(/LAYER_ORDER|function layerCounts/);
  });

  it("draws All · Been there · Want to go · One trip, landing on All", () => {
    expect(overview).toContain('useState<LibraryFilter>({ kind: "all" })');
    for (const label of ['label="All"', 'label="Been there"', 'label="Want to go"']) {
      expect(overview).toContain(label);
    }
    expect(overview).toContain('"One trip"');
    expect(overview).toContain('" ▾"');
  });

  it("filters pins through core's libraryFilterKeeps and arcs through arcKept", () => {
    expect(overview).toMatch(/\blibraryFilterKeeps\(/);
    expect(overview).toMatch(/\barcKept\(/);
    expect(overview).toMatch(/\bfilterCounts\(/);
  });

  it("lists libraryTrips in the shipped dropdown-menu", () => {
    expect(overview).toContain('from "@/components/ui/dropdown-menu"');
    expect(overview).toMatch(/\blibraryTrips\(/);
    expect(overview).toContain("<DropdownMenuItem");
  });

  it("keeps the category FilterChip row and the legend", () => {
    expect(overview).toContain("CAT_CHIPS.map(");
    expect(overview).toContain("Trip destination, in order");
  });
});

describe("web /map · been from destinationBeen", () => {
  it("DestinationDisc reads pin.been, not the trip's layer", () => {
    const disc = fnBody(view, "DestinationDisc");
    expect(disc).toContain("pin.been");
    expect(disc).not.toContain('pin.layer === "been"');
  });

  it("PlaceDrop still draws filled for want, hollow for been", () => {
    const drop = fnBody(view, "PlaceDrop");
    expect(drop).toContain('const been = pin.status === "been"');
    expect(drop).toContain("background: been ? palette.hollowGround : color");
  });

  it("pins.ts takes each destination's been from core's destinationBeen", () => {
    expect(pins).toMatch(/\bdestinationBeen\(/);
    expect(pins).toMatch(/\bsavePoint\(/);
  });

  it("map/page.tsx reads the tz cookie and passes today", () => {
    expect(page).toContain("TZ_COOKIE");
    expect(page).toMatch(/isoDateInZone\(/);
    expect(page).toContain("today={today}");
  });
});
