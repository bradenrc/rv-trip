import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * Navigate on a drive (#180 · docs/design/181 frames 2 and 5), asserted where
 * it CAN be. It replaced the split Navigate control of docs/design/43 §4.
 *
 * There is no DOM in this repo to render it in: apps/web's vitest is
 * `environment: "node"`, collects only `.test.ts`, and the workspace ships no
 * jsdom or @testing-library/react. So it is asserted in two honest halves:
 *
 *  · the URLS and the COPY — the parts that are logic — are pure functions in
 *    @rv-trip/core and executed by packages/core's suite (`navigateLinks` in
 *    navigation.test.ts, `navigationCaption` in planner.test.ts);
 *  · the WIRING and the CLASSES are asserted here, as source text, in the same
 *    idiom packages/core/src/theme/nightfall-tokens.test.ts uses.
 *
 * What neither half can prove is that the Apple Maps and Waze links hand off
 * to the native apps. That is render-required at the walk.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(HERE, "RouteView.tsx"), "utf8");
const links = readFileSync(join(HERE, "NavigateLinks.tsx"), "utf8");

describe("RouteView's Navigate, as source", () => {
  it("retires the split NavigateButton and its accent pill", () => {
    expect(route).not.toContain("function NavigateButton(");
    expect(route).not.toContain("<NavigateButton");
    expect(route).not.toContain("NAV_PILL");
    expect(route).not.toContain("navigationOptions");
  });

  it("renders NavigateLinks and the RV route line in BOTH drive renderings", () => {
    // The clean one-liner and the restricted card — there is no third.
    expect(route.match(/<NavigateLinks drive=\{drive\} toName=\{toName\}/g)).toHaveLength(2);
    expect(
      route.match(/<RvRouteLine drive=\{drive\} rigOn=\{rigOn\} fromName=\{fromName\} \/>/g),
    ).toHaveLength(2);
    // The restricted card's standalone caption moved into the RV line.
    expect(route).not.toContain("DriveCaption");
    expect(route).toContain("rigOn={trip.rigOn}");
  });
});

describe("NavigateLinks, as source", () => {
  it("reads its three URLs from core's navigateLinks, destination only", () => {
    expect(links).toContain("navigateLinks(drive.navTo)");
    for (const href of ["links.google", "links.apple", "links.waze"]) {
      expect(links).toContain(`href={${href}} target="_blank" rel="noreferrer"`);
    }
    expect(links).not.toMatch(/https?:\/\//);
  });

  it("draws the RV route line only under rigOn", () => {
    const at = links.indexOf("export function RvRouteLine");
    const line = links.slice(at);
    const guard = line.indexOf("if (!rigOn) return null;");
    expect(guard).toBeGreaterThan(-1);
    expect(line.indexOf("RV route · from {")).toBeGreaterThan(guard);
    // And nowhere outside that component.
    expect(links.slice(0, at)).not.toContain("RV route · from {");
  });

  it("puts the ✓ on the checked Google link only, and reads the caption from core", () => {
    expect(links).toContain("href={drive.navUrl}");
    expect(links).toContain("href={drive.navWegoUrl}");
    expect(links).toContain('{checked && <span className="text-rv-green">✓</span>}');
    expect(links).toContain('const checked = drive.navVerdict === "checked";');
    expect(links).toContain("navigationCaption(drive)");
    expect(links).toContain('caption.tone === "checked" ? "text-rv-green" : "text-rv-warning"');
    expect(links).toContain("{caption.text}");
    expect(links).not.toContain("RV-safe");
  });

  it("wears the neutral pill with the 32px floor, and no raw colour", () => {
    expect(links).toContain("min-h-8");
    expect(links).toContain("rounded-rv-pill bg-rv-navy-soft");
    expect(links).toContain("text-[12px] font-bold text-rv-ink");
    // Code, not the doc comment (which cites issue numbers like #180).
    expect(links.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(links).not.toContain("accent-deep");
  });
});
