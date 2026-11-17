import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #173 i5 (#172 · Q4 A) — the phone's landing rule, read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-capture.test.ts:
 * the rule itself (`activeTrip`, `isRootLaunchUrl`) is unit tested in
 * `planner/journal.test.ts`; what is pinned HERE is that the tabs layout runs
 * it once per launch, after the deep-link check, with the offline fallback.
 * Whether a cold start actually lands (and a deep link beats it) is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const tabs = read("app/(tabs)/_layout.tsx");
const store = read("src/store.ts");

describe("phone landing · (tabs)/_layout.tsx", () => {
  it("runs activeTrip over the trips with the device's local date", () => {
    expect(tabs).toMatch(/activeTrip\(\w+, localIsoDate\(\)\)/);
    expect(tabs).toContain("useTrips()");
  });

  it("checks Linking.getInitialURL — by parsed path — before landing", () => {
    expect(tabs).toContain('import * as Linking from "expo-linking"');
    expect(tabs).toContain("Linking.getInitialURL()");
    expect(tabs).toContain("isRootLaunchUrl(Linking.parse(");
    expect(tabs.indexOf("Linking.getInitialURL()")).toBeLessThan(tabs.indexOf("activeTrip("));
  });

  it("guards with a module-level once-per-launch flag", () => {
    expect(tabs).toMatch(/^let landed = false;$/m);
    expect(tabs.match(/landed = true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(tabs).toContain("if (landed");
  });

  it("falls back to the persisted in-progress bundles offline", () => {
    expect(tabs).toContain("await hydrateInProgress()");
    expect(tabs).toContain("heldTrips()");
    expect(store).toMatch(/export function heldTrips\(\)/);
  });

  it("pushes the active trip inside the Trips stack, else navigates to Places", () => {
    expect(tabs).toContain("router.push(`/trips/${active.id}`)");
    expect(tabs).toContain('router.navigate("/saves")');
  });
});
