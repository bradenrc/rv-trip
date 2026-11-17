import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #180 · #181 i2 — the phone's Navigate, read as source.
 *
 * `apps/mobile` has no test runner, so this follows mobile-trip-tabs.test.ts:
 * the URLs are unit tested in providers/navigation.test.ts (`navigateLinks`)
 * and the caption in planner/planner.test.ts (`navigationCaption`); what is
 * pinned HERE is that the phone reads them, draws the RV route line only on a
 * rig-on trip, and no longer hands a lone Navigate button `drive.navUrl`.
 * That the pills open Google, Apple Maps and Waze natively is the walk's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const tripScreen = read("app/(tabs)/(trips)/trips/[id]/index.tsx");
const navigate = read("src/navigate.tsx");

describe("phone NavigateLinks", () => {
  it("reads its three URLs from core's navigateLinks and opens each through Linking", () => {
    expect(navigate).toContain("const links = navigateLinks(drive.navTo);");
    expect(navigate).toContain('<Pill label="Google" url={links.google} />');
    expect(navigate).toContain('<Pill label="Apple" url={links.apple} />');
    expect(navigate).toContain('<Pill label="Waze" url={links.waze} />');
    expect(navigate).toContain("onPress={() => void Linking.openURL(url)}");
    expect(navigate).not.toMatch(/https?:\/\//);
  });

  it("draws 'RV route · from' only under rigOn", () => {
    const guard = navigate.indexOf("{rigOn && (");
    expect(guard).toBeGreaterThan(-1);
    const label = navigate.indexOf("RV route · from {");
    expect(label).toBeGreaterThan(guard);
    expect(navigate.indexOf("RV route · from {", label + 1)).toBe(-1);
    expect(navigate).toContain('<Pill label="Google" url={drive.navUrl} ok={checked} />');
    expect(navigate).toContain('<Pill label="HERE WeGo" url={drive.navWegoUrl} />');
  });

  it("reads the caption text and tone from core's navigationCaption", () => {
    expect(navigate).toContain("const caption = navigationCaption(drive);");
    expect(navigate).toContain('caption.tone === "checked" ? C.green : C.warning');
    expect(navigate).toContain("{caption.text}");
    expect(navigate).not.toContain("RV-safe");
  });

  it("wears the neutral pill with the 32pt floor and no raw colour", () => {
    expect(navigate).toContain("minHeight: 32");
    expect(navigate).toContain("backgroundColor: C.navySoft");
    expect(navigate).toContain('pillText: { color: C.ink, fontSize: 12, fontWeight: "700" }');
    // Code, not the doc comment (which cites issue numbers like #180).
    expect(navigate.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("phone trip screen · Drive", () => {
  it("renders NavigateLinks with the trip's rigOn, not a lone Navigate button", () => {
    expect(tripScreen).toContain(
      "<NavigateLinks drive={drive} rigOn={rigOn} toName={toName} fromName={fromName} />",
    );
    expect(tripScreen).toContain("rigOn={trip.rigOn}");
    expect(tripScreen).not.toContain("Linking.openURL(drive.navUrl)");
    expect(tripScreen).not.toContain(">Navigate</Button>");
  });

  it("drops the standalone amber caption — it lives in the RV route line now", () => {
    expect(tripScreen).not.toContain("Navigation may not follow the RV-safe route");
  });
});
