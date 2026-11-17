import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #177 · #181 i1 — the phone trip screen's tabs, read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-landing.test.ts: the
 * rule itself (`defaultTripTab`, `TRIP_TABS`) is unit tested in
 * `planner/trip-tab.test.ts`; what is pinned HERE is that the trip screen
 * reads it, renders the tabs in core's order with core's labels, and shows no
 * "Itinerary" copy. Which tab a real trip opens on is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const tripScreen = read("app/(tabs)/(trips)/trips/[id]/index.tsx");
const itinerary = read("src/itinerary.tsx");

/** Source with comments stripped — comments and identifiers may keep the word
 * Itinerary; copy may not. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

describe("phone trip screen · Journal · Agenda · Ideas", () => {
  it("derives the tab from core's defaultTripTab with the device's local date", () => {
    expect(tripScreen).toContain("const tab: TripTab = picked ?? defaultTripTab(trip, localIsoDate());");
    expect(tripScreen).toContain("useState<TripTab | null>(null)");
  });

  it("maps core's TRIP_TABS with TRIP_TAB_LABEL, keeping the green underline and the ideas count", () => {
    expect(tripScreen).toContain("{TRIP_TABS.map((t) => (");
    expect(tripScreen).toContain("{TRIP_TAB_LABEL[t]}");
    expect(tripScreen).toContain("style={[styles.tab, tab === t && styles.tabOn]}");
    expect(tripScreen).toContain("tabOn: { borderBottomColor: C.green }");
    expect(tripScreen).toContain('{t === "ideas" && <Text style={styles.tabCount}> {ideaCount}</Text>}');
  });

  it("hides + Add on Journal and shows the sub-lens on Agenda", () => {
    expect(tripScreen).toContain('{tab !== "journal" && (');
    expect(tripScreen).toContain('{tab === "agenda" && <Segmented value={sub} options={SUBS} onChange={setSub} />}');
    expect(tripScreen).not.toContain('"itinerary"');
  });

  it("the Add sheet heads Agenda's knowns", () => {
    expect(itinerary).toContain("Add to Agenda · the knowns");
    expect(itinerary).toContain('tab: "agenda" | "ideas";');
    expect(itinerary).not.toContain('"itinerary"');
  });

  it("no user-facing copy says Itinerary — only comments and identifiers may", () => {
    expect(code(tripScreen)).not.toMatch(/Itinerary/);
    expect(code(itinerary)).not.toMatch(/Itinerary/);
  });
});
