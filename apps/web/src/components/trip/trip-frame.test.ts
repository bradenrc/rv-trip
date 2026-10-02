import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #131 · #126 — the trip frame, asserted as SOURCE (the `plan-undo.test.ts`
 * idiom): apps/web's vitest is `environment: "node"` with no DOM, so the
 * render cannot be clicked here. What these pin is the regression that
 * matters — the tab row reverting to Route · Timeline · Journal, or a picker
 * going back to biasing on the home base. The walk is the executed check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(HERE, f), "utf8");
const planner = src("TripPlanner.tsx");

/** The ToggleTab row: from the first `<ToggleTab` to the `</div>` closing it. */
const tabRow = planner.slice(planner.indexOf("<ToggleTab"), planner.indexOf("</div>", planner.indexOf("<ToggleTab")));

describe("#131 · TripPlanner renders Itinerary · Ideas · Journal", () => {
  it("the ToggleTab row is the three mindset tabs, in order", () => {
    expect(tabRow).toContain('tab === "itinerary"');
    const at = (w: string) => tabRow.indexOf(`\n                ${w}\n`);
    expect(at("Itinerary")).toBeGreaterThan(-1);
    expect(at("Ideas")).toBeGreaterThan(at("Itinerary"));
    expect(at("Journal")).toBeGreaterThan(at("Ideas"));
    expect(at("Route")).toBe(-1);
    expect(at("Timeline")).toBe(-1);
  });

  it("Route · Timeline is Itinerary's SegmentedControl sub-lens", () => {
    expect(planner).toMatch(/<SegmentedControl\s+mono\s+value=\{sub\}/);
    expect(planner).toContain('{ value: "route", label: "Route", Icon: Route }');
    expect(planner).toContain('{ value: "timeline", label: "Timeline", Icon: ChartNoAxesGantt }');
  });

  it("the Add menu is tab-scoped and hidden on Journal", () => {
    expect(planner).toContain('{tab !== "journal" && (');
    expect(planner).toContain("Add to Itinerary · the knowns");
    expect(planner).toContain("Add to Ideas · the maybes");
  });

  it("the old toast refusal is gone — Fly → Drive asks keep-or-remove (vet MED 3)", () => {
    expect(planner).not.toContain("Remove this hop's bookings before switching it to Drive.");
    expect(planner).toContain("<HopModePrompt");
  });
});

describe("#126 · every trip-context picker reads searchAnchor, never the home base", () => {
  for (const f of ["TripPlanner.tsx", "RouteView.tsx", "DestinationDetailSheet.tsx"]) {
    it(`${f} has no nearOf(…, homeBasePlace)`, () => {
      const s = src(f);
      expect(s).not.toMatch(/nearOf\(/);
      expect(s).not.toMatch(/near=\{[^}]*homeBasePlace/);
    });
  }
});
