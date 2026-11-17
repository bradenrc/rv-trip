import { readdirSync, readFileSync } from "node:fs";
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

describe("capture · the tabs (#111 Q1 A · #173 i2)", () => {
  // #173 i2 (#171 · Q5 A · Q6 A): Trips · Places · Capture · You. `saves`
  // keeps its route name; only its title becomes "Places".
  it("draws Trips · Places · Capture · You, in that order", () => {
    const at = (name: string) => tabs.indexOf(`name="${name}"`);
    expect(at("(trips)")).toBeGreaterThan(-1);
    expect(at("(trips)")).toBeLessThan(at("saves"));
    expect(at("saves")).toBeLessThan(at("add"));
    expect(at("add")).toBeLessThan(at("you"));
    const title = (name: string) => /title: "([^"]+)"/.exec(tabs.slice(at(name)))?.[1];
    expect(title("(trips)")).toBe("Trips");
    expect(title("saves")).toBe("Places");
    expect(title("add")).toBe("Capture");
    expect(title("you")).toBe("You");
    expect(tabs).not.toContain('title: "Saves"');
    // Map is TL4's (#186), not this epic's.
    expect(tabs).not.toContain('name="map"');
  });

  it("keeps the + tab's accessibility label and draws You with the ◉ glyph", () => {
    expect(tabs).toContain('tabBarAccessibilityLabel: "Save a place, a note or a pin"');
    expect(tabs.slice(tabs.indexOf('name="you"'))).toContain(">◉<");
  });

  it("intercepts the + and opens the capture sheet instead of a tab", () => {
    expect(tabs).toMatch(/tabPress: \(e\) => \{\s*e\.preventDefault\(\);\s*router\.push\("\/capture"\);/);
  });

  it("badges the Places tab with the queue count until it drains", () => {
    const places = tabs.slice(tabs.indexOf('name="saves"'), tabs.indexOf('name="add"'));
    expect(places).toContain("tabBarBadge: queue.length > 0 ? queue.length : undefined");
    expect(tabs.match(/tabBarBadge:/g)).toHaveLength(1);
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
    // #113 · v2: the load migrates the v1 key's items (as saves) and clears it.
    expect(runtime).toContain("migrateCaptureQueue(v2, v1)");
    expect(runtime).toContain("AsyncStorage.removeItem(CAPTURE_QUEUE_KEY_V1)");
  });

  it("flushes on the way back online, on foreground, and after each enqueue", () => {
    expect(runtime).toContain("NetInfo.addEventListener");
    expect(runtime).toMatch(/AppState\.addEventListener\("change"/);
    expect(runtime).toMatch(/await flush\(\{ kind: "capture", clientId \}\)/);
  });

  it("hands the queue an HTTP status for an ApiError and a throw for anything else", () => {
    expect(runtime).toContain("if (e instanceof ApiError) return { status: e.status };");
  });

  it("the Places tab shows the waiting count", () => {
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

// ── #173 i2 · the library is called Places (Q6 A) ──────────────────────────

/** Every .ts/.tsx file under apps/mobile/{app,src}, repo-relative to apps/mobile. */
function mobileSources(dir: string): string[] {
  return readdirSync(join(REPO, "apps/mobile", dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return mobileSources(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

/** Source with block and line comments removed (a `//` inside a URL survives). */
const uncommented = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

describe("renames · Saves becomes Places on the phone", () => {
  it("titles the saves.tsx screen Places", () => {
    expect(saves).toMatch(/<Text style=\{styles\.title\}>Places<\/Text>/);
  });

  it("points the empty maybes line at Places", () => {
    expect(read("src/itinerary.tsx")).toContain("No maybes yet — + Add one, or pull one in from your Places.");
  });

  it("names the library Saves in no user-facing string", () => {
    const files = [...mobileSources("app"), ...mobileSources("src")];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      // Identifiers (useSaves, NearbySaves, dismissSaves) have no word boundary
      // before "Saves"; what is left is copy.
      expect(uncommented(read(f)), `${f} names the library "Saves"`).not.toMatch(/\bSaves\b/);
    }
  });
});
