import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #111 i1 — the phone's capture WIRING, read as source.
 *
 * `apps/mobile` has no test runner, so the pattern is mobile-auth.test.ts's:
 * the rules themselves (queue order / retry / drop, the sheet's rows, bodies
 * and toasts) are unit tested in `capture/queue.test.ts` and
 * `capture/sheet.test.ts`; what is pinned HERE is that the screens actually
 * route through them. Whether the tab bar, the formSheet, NetInfo's real
 * offline → online transition and the GPS fix behave on a device is the walk's
 * — flagged render-required in docs/design/111/dev-notes.md.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
const appJson = read("app.json");
const root = read("app/_layout.tsx");
const tabs = read("app/(tabs)/_layout.tsx");
const sheet = read("app/capture.tsx");
const runtime = read("src/capture.ts");
const saves = read("app/(tabs)/saves.tsx");

describe("capture · the two new native dependencies", () => {
  it("declares netinfo and expo-location, SDK-aligned", () => {
    expect(pkg.dependencies["@react-native-community/netinfo"]).toBeTruthy();
    expect(pkg.dependencies["expo-location"]).toMatch(/^~?57\./);
  });

  it("registers expo-location's config plugin with a when-in-use string", () => {
    expect(appJson).toContain('"expo-location"');
    expect(appJson).toContain("locationWhenInUsePermission");
  });
});

describe("capture · the tabs (Q1 A)", () => {
  it("draws Trips · + · Saves, in that order", () => {
    const at = (name: string) => tabs.indexOf(`name="${name}"`);
    expect(at("(trips)")).toBeGreaterThan(-1);
    expect(at("(trips)")).toBeLessThan(at("add"));
    expect(at("add")).toBeLessThan(at("saves"));
    expect(tabs).toContain('title: "Trips"');
    expect(tabs).toContain('title: "Save"');
    expect(tabs).toContain('title: "Saves"');
  });

  it("intercepts the + and opens the capture sheet instead of a tab", () => {
    expect(tabs).toMatch(/tabPress: \(e\) => \{\s*e\.preventDefault\(\);\s*router\.push\("\/capture"\);/);
  });

  it("badges Saves with the queue count until it drains", () => {
    expect(tabs).toContain("tabBarBadge: queue.length > 0 ? queue.length : undefined");
  });

  it("opens capture as a ROOT formSheet, inside Shell and so inside the gate", () => {
    const shellAt = root.indexOf("function Shell(");
    const capture = root.indexOf('name="capture"');
    expect(capture).toBeGreaterThan(shellAt);
    expect(root.slice(capture, capture + 200)).toContain('presentation: "formSheet"');
    expect(root).toContain("useCaptureRuntime()");
  });
});

describe("capture · the sheet routes through core", () => {
  it("orders its rows by captureRows and writes the core bodies", () => {
    for (const fn of ["captureRows(", "placeCaptureBody(", "noteCaptureBody(", "pinCaptureBody(", "reservationTypeOfGoogle("]) {
      expect(sheet).toContain(fn);
    }
  });

  it("uses the pin map from src/map.tsx", () => {
    expect(sheet).toMatch(/import \{[^}]*PinMap[^}]*\} from "\.\.\/src\/map"/);
  });
});

describe("capture · the queue runtime", () => {
  it("persists under core's key and flushes through core's rules", () => {
    expect(runtime).toContain("AsyncStorage.setItem(CAPTURE_QUEUE_KEY");
    expect(runtime).toContain("flushCaptureQueue");
    expect(runtime).toContain("parseCaptureQueue");
  });

  it("flushes on the way back online, on foreground, and after each enqueue", () => {
    expect(runtime).toContain("NetInfo.addEventListener");
    expect(runtime).toMatch(/AppState\.addEventListener\("change"/);
    expect(runtime).toMatch(/await flush\(\{ kind: "capture", clientId \}\)/);
  });

  it("hands the queue an HTTP status for an ApiError and a throw for anything else", () => {
    expect(runtime).toContain("if (e instanceof ApiError) return { status: e.status };");
  });

  it("the Saves tab shows the waiting count", () => {
    expect(saves).toContain("queuedToast(queue.length)");
  });
});

// ── #111 i2 · the Saves tab, read as source ────────────────────────────────

const store = read("src/store.ts");

describe("saves · the tab renders core's shelves", () => {
  it("groups through savesShelves and draws each row's line through saveRowLine", () => {
    expect(saves).toContain("savesShelves(saves, status)");
    expect(saves).toContain("saveRowLine(s)");
    expect(saves).toContain("shelfCounts(saves)");
  });

  it("draws Unanchored after the regions, with the wireframe's note", () => {
    expect(saves.indexOf("regions.map")).toBeLessThan(saves.indexOf(">Unanchored<"));
    expect(saves).toContain("Unanchored saves have no town within 25 mi. They still");
  });

  it("wires the strip: tap upgrades, Dismiss clears — then refetches", () => {
    expect(saves).toContain("patchSave(save.id, { upgradeToSuggested: true })");
    expect(saves).toContain("patchSave(save.id, { suggestedPlace: null })");
    expect(store).toContain("await api.places.patch(id, patch);");
    expect(store).toMatch(/finally \{\s*await loadSaves\(\);/);
  });

  it("shows Stars on a Been there row", () => {
    expect(saves).toMatch(/s\.status === "been" && s\.rating \? \(\s*<Stars value=\{s\.rating\}/);
  });
});
