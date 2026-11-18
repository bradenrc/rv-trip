import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #186 i9 · #160 renders · q10 A (docs/design/186 §6) — on the phone, ＋ opens
 * the capture sheet on Been there when the Places tab is showing Been there,
 * and Been there asks how it was and which trip.
 *
 * `apps/mobile` has no test runner, so this reads the wiring as source (the
 * mobile-capture.test.ts pattern). The rules — placeCaptureBody /
 * noteCaptureBody carrying the memory, tripsNearPlace, tripNearInputs — are
 * unit tested in capture/sheet.test.ts and domain/place-form.test.ts. That the
 * tab really publishes while focused and keeps it under the formSheet is the
 * walk's (a dev-client render).
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, "apps/mobile", p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const runtime = flat(code(read("src/capture.ts")));
const saves = flat(code(read("app/(tabs)/saves.tsx")));
const sheet = flat(code(read("app/capture.tsx")));

describe("src/capture.ts — the published shelf", () => {
  it("is a small module value with a setter and a reader", () => {
    expect(runtime).toContain("let placesShelf: SavedPlaceStatus | null = null;");
    expect(runtime).toContain("export function publishPlacesShelf(shelf: SavedPlaceStatus | null): void { placesShelf = shelf; }");
    expect(runtime).toContain("export function publishedPlacesShelf(): SavedPlaceStatus | null { return placesShelf; }");
  });
});

describe("saves.tsx — publishes its shelf while focused", () => {
  it("publishes on focus and on every shelf switch, and clears on blur", () => {
    expect(saves).toMatch(
      /useFocusEffect\( useCallback\(\(\) => \{ publishPlacesShelf\(status\); return \(\) => \{ if \(!stillShowing\(navigation\)\) publishPlacesShelf\(null\); \}; \}, \[status, navigation\]\), \);/,
    );
  });

  it("keeps it only while Places is still the selected tab (the capture sheet covers it, a tab switch leaves it)", () => {
    expect(saves).toContain('return s ? s.routes[s.index]?.name === "saves" : false;');
  });
});

describe("capture.tsx — Been there outside a trip", () => {
  it("reads the published shelf once for its outside-a-trip initial status", () => {
    expect(sheet).toContain('const [outside] = useState<SavedPlaceStatus>(() => (publishedPlacesShelf() === "been" ? "been" : "want"));');
    expect(sheet).toContain('useState<SavedPlaceStatus | "did">(target ? "did" : outside)');
  });

  it("on been: How was it (Stars 28), Which trip? chips when any trip is near, then the note", () => {
    const at = sheet.indexOf('{status === "been" && (');
    expect(at).toBeGreaterThan(-1);
    const been = sheet.slice(at, sheet.indexOf('{status === "want" && ('));
    expect(been).toContain('<Text style={styles.lbl}>How was it</Text> <Stars value={rating} size={28} onSet={setRating} />');
    expect(been).toContain("{nearTrips.length > 0 && (");
    expect(been).toContain("<Text style={styles.lbl}>Which trip?</Text>");
    expect(been).toContain("<Chip key={t.id} on={chosenTrip === t.id} onPress={() => setTripId(t.id)}> {t.title} </Chip>");
    expect(been).toContain("<Chip on={chosenTrip === null} onPress={() => setTripId(null)}> None </Chip>");
    expect(sheet).toContain('placeholder={didIt || status === "been" ? "For next time…" : "Why? (optional)"}');
  });

  it("lists near trips with tripsNearPlace over the phone's trip trees", () => {
    expect(sheet).toContain("const { trees } = useTripTrees();");
    expect(sheet).toContain('status === "been" ? tripsNearPlace(tripNearInputs(trees ?? []), memoryAt) : []');
  });

  it("hands placeCaptureBody / noteCaptureBody the rating and the trip", () => {
    expect(sheet).toContain("const c = { status, source: chosenSource, note, rating, tripId: chosenTrip };");
    expect(sheet).toContain("placeCaptureBody(subject.hit, c)");
    expect(sheet).toContain("noteCaptureBody(subject.text, fix, online ? areaName : null, online, c)");
  });
});
