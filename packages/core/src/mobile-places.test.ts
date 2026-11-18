import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i2 · #182 on the phone — the Places tab's location chip, the All · Stay
 * · Eat · Do chips and Near you (docs/design/186 §2 · q1 A · q3 A · q4 A ·
 * q11 A), read as source.
 *
 * `apps/mobile` has no test runner, so the pattern is mobile-capture.test.ts's:
 * the rule (`nearYou`, `nearYouName`, the dashed lines) is unit tested in
 * capture/shelves.test.ts; what is pinned HERE is that the screen routes
 * through it, and that location is never asked for on its own. Whether the
 * permission state, the last-known fix and the chip read right on a device is
 * the walk's — render-required in docs/design/186/dev-notes.md.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const saves = read("app/(tabs)/saves.tsx");
const ui = read("src/ui.tsx");

/** Every line that asks the OS for location permission. */
function askers(src: string): string[] {
  return src.split("\n").filter((l) => l.includes("requestForegroundPermissionsAsync"));
}

describe("phone Places · Near you", () => {
  it("calls core's nearYou for the shelf", () => {
    expect(saves).toMatch(/\bnearYou\(/);
    expect(saves).toMatch(/\bnearYouName\(/);
  });

  it("draws a Near you heading with 'within 50 mi', then Everywhere else", () => {
    expect(saves).toContain(">Near you<");
    expect(saves).toContain("{nearYouWithin(null)}");
    expect(saves).toContain(">Everywhere else<");
    expect(saves).toContain("nearYouNothing(");
  });

  it("prints miles on the near rows", () => {
    expect(saves).toMatch(/Math\.round\(n\.mi\)\} mi/);
  });
});

describe("phone Places · the category chips", () => {
  it("has a native FilterChip mirroring the DS one (navy active, category-coloured glyph, mono count)", () => {
    expect(ui).toMatch(/export function FilterChip\(/);
    const chip = /export function FilterChip\([\s\S]*?\n}\n/.exec(ui)?.[0] ?? "";
    expect(chip).toContain("C.navy");
    expect(chip).toContain("C.ink");
    expect(chip).toContain("C.surface");
    expect(chip).toContain("C.border");
    expect(chip).toContain("C.inkMuted");
    expect(chip).toContain("styles.fchipCount");
    expect(ui).toMatch(/fchipCount: \{ fontFamily: F\.mono/);
    expect(chip).toContain("categoryOf(");
  });

  it("renders a FilterChip for each of All · Stay · Eat · Do", () => {
    expect(saves).toMatch(/<FilterChip/);
    expect(saves).toMatch(/PLACES_CATEGORIES\.map/);
  });

  it("reads and writes the chosen chip under rv-places-cat", () => {
    expect(saves).toContain('"rv-places-cat"');
    expect(saves).toMatch(/AsyncStorage\.getItem\(CAT_KEY\)/);
    expect(saves).toMatch(/AsyncStorage\.setItem\(CAT_KEY, c\)/);
    expect(saves).toMatch(/isPlacesCategory\(/);
  });

  it("resets the chip to All (and stores All) on a shelf change", () => {
    const change = /const changeShelf = [\s\S]*?\n  \};/.exec(saves)?.[0] ?? "";
    expect(change).toContain("setStatus(s)");
    expect(change).toContain('pickCat("All")');
  });

  it("shows the dashed per-chip empty line", () => {
    expect(saves).toContain("placesCategoryEmpty(");
  });
});

describe("phone Places · the location chip never prompts on its own", () => {
  it("reads the permission on focus and the last-known fix only when granted", () => {
    expect(saves).toContain("getForegroundPermissionsAsync");
    expect(saves).toContain("getLastKnownPositionAsync");
    expect(saves).toMatch(/status !== "granted"/);
  });

  it("calls requestForegroundPermissionsAsync only from the chip's onPress handler", () => {
    const lines = askers(saves);
    expect(lines).toHaveLength(1);
    // The one asker lives in `ask`, and `ask` is wired to the chip's onPress and nowhere else.
    const ask = /const ask = useCallback\(async \(\) => \{[\s\S]*?\n  \}, /.exec(saves)?.[0] ?? "";
    expect(ask).toContain("requestForegroundPermissionsAsync");
    // `ask` leaves the hook only as `onAsk`, and `onAsk` is only ever handed to the chip's onPress.
    expect(saves).toContain("const { here, ask: onAsk } = useHere();");
    expect(saves).toMatch(/onPress=\{here \? undefined : onAsk\}/);
    expect(saves).not.toMatch(/onAsk\(\)|ask\(\)/);
  });

  it("names the chip 'Near <name>' or 'Set location'", () => {
    expect(saves).toContain("Set location");
    expect(saves).toMatch(/`Near \$\{name\}`/);
    expect(saves).toContain('"Near you"');
  });
});

/**
 * #186 i4 · #183 on the phone — the trip card above the shelf switch, fed by
 * the full trips list (`useTripTrees`, GET /api/trips?tree=1). Which trip and
 * every word is core's `tripCard` + `tripCardLines` (planner/trip-card.test.ts);
 * pinned here is that the screen routes through them and links to the trip.
 */
describe("phone Places · the trip card (#183)", () => {
  const store = read("src/store.ts");

  it("loads the trip trees through the api client and caches them in the store", () => {
    expect(store).toContain("api.trips.trees()");
    expect(store).toMatch(/export function useTripTrees\(\)/);
  });

  it("calls tripCard with today's local date, and renders tripCardLines", () => {
    expect(saves).toContain("useTripTrees()");
    expect(saves).toMatch(/tripCard\(trees \?\? \[\], localIsoDate\(\)\)/);
    expect(saves).toContain("tripCardLines(");
  });

  it("reloads the trees on focus, beside the saves", () => {
    const focus = /useFocusEffect\(\s*useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\),\s*\);/.exec(saves)?.[0] ?? "";
    expect(focus).toContain("reloadTrees()");
  });

  it("sits above the shelf switch and pushes /trips/<id>", () => {
    expect(saves.indexOf("<TripCardRow")).toBeGreaterThan(-1);
    expect(saves.indexOf("<TripCardRow")).toBeLessThan(saves.indexOf("<ShelfSwitch value"));
    expect(saves).toMatch(/router\.push\(`\/trips\/\$\{card\.tripId\}`\)/);
  });

  it("draws the amber line on C.warning, else C.inkMuted, and the cta on C.greenInk", () => {
    expect(saves).toMatch(/color: amber \? C\.warning : C\.inkMuted/);
    expect(saves).toMatch(/cardGo: \{[^}]*color: C\.greenInk/);
    expect(saves).toMatch(/card: \{[^}]*backgroundColor: C\.surface[^}]*borderColor: C\.borderHi[^}]*borderRadius: R\.card/);
  });
});
