import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #131 · #126 — the trip frame, asserted as SOURCE (the `plan-undo.test.ts`
 * idiom): apps/web's vitest is `environment: "node"` with no DOM, so the
 * render cannot be clicked here. What these pin is the regression that
 * matters — the tab row reverting to Route · Timeline · Journal (or, #177, to
 * Itinerary · Ideas · Journal), or a picker
 * going back to biasing on the home base. The walk is the executed check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(join(HERE, f), "utf8");
const planner = src("TripPlanner.tsx");

/** The ToggleTab row: from the `<div` opening the first `<ToggleTab` to the `</div>` closing it. */
const firstTab = planner.indexOf("<ToggleTab");
const tabRow = planner.slice(planner.lastIndexOf("<div", firstTab), planner.indexOf("</div>", firstTab));

/** Source with `//` and `/* … *\/` comments stripped (JSX `{/* … *\/}` included):
 * comments and identifiers may keep the word Itinerary; copy may not. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
const page = readFileSync(join(HERE, "../../app/trips/[id]/page.tsx"), "utf8");

describe("#131 · #177 · TripPlanner renders Journal · Agenda · Ideas", () => {
  it("the ToggleTab row maps core's TRIP_TABS with TRIP_TAB_LABEL — Journal · Agenda · Ideas", () => {
    // The order itself is core's (`TRIP_TABS`, unit tested in planner/trip-tab.test.ts).
    expect(planner).toMatch(/import \{[^}]*\bTRIP_TABS\b[^}]*\} from "@rv-trip\/core"/);
    expect(tabRow).toContain("{TRIP_TABS.map((t) => (");
    expect(tabRow).toContain("{TRIP_TAB_LABEL[t]}");
    expect(tabRow).toContain("active={tab === t}");
    // Each tab keeps its icon: Journal BookOpen · Agenda Route · Ideas Lightbulb + count.
    const at = (w: string) => tabRow.indexOf(w);
    expect(at('t === "journal" ?')).toBeGreaterThan(-1);
    expect(at("<BookOpen")).toBeGreaterThan(at('t === "journal" ?'));
    expect(at('t === "agenda" ?')).toBeGreaterThan(at("<BookOpen"));
    expect(at("<Route")).toBeGreaterThan(at('t === "agenda" ?'));
    expect(at("<Lightbulb")).toBeGreaterThan(at("<Route"));
    expect(tabRow).toContain('{t === "ideas" && <small className="font-mono text-[11px] text-rv-ink-faded">{ideaCount}</small>}');
    expect(tabRow).not.toContain('"itinerary"');
  });

  it("the tab it opens on is core's defaultTripTab, read with today", () => {
    expect(planner).toContain("useState<TripTab>(defaultTripTab(initialTrip, today))");
    expect(planner).not.toContain('"itinerary"');
  });

  it("no user-facing copy says Itinerary — only comments and identifiers may", () => {
    expect(code(planner)).not.toMatch(/Itinerary/);
    expect(code(src("IdeasLens.tsx"))).not.toMatch(/Itinerary/);
    expect(src("IdeasLens.tsx")).toContain("it becomes a destination on the Agenda.");
  });

  it("trips/[id]/page.tsx reads the tz cookie and passes today and now", () => {
    expect(page).toContain("(await cookies()).get(TZ_COOKIE)?.value");
    expect(page).toContain("const today = tz ? isoDateInZone(new Date(), tz) : null;");
    expect(page).toContain("const now = new Date().toISOString();");
    expect(page).toContain("today={today}");
    expect(page).toContain("now={now}");
  });

  it("Route · Timeline is Agenda's SegmentedControl sub-lens", () => {
    expect(planner).toMatch(/<SegmentedControl\s+mono\s+value=\{sub\}/);
    expect(planner).toContain('{ value: "route", label: "Route", Icon: Route }');
    expect(planner).toContain('{ value: "timeline", label: "Timeline", Icon: ChartNoAxesGantt }');
  });

  it("the Add menu is tab-scoped and hidden on Journal", () => {
    expect(planner).toContain('{tab !== "journal" && (');
    expect(planner).toContain("Add to Agenda · the knowns");
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
