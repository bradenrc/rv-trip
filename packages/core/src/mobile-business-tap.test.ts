import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * #201 · the phone's half of "tap a business on the Google basemap to save it"
 * (docs/design/202 §1–§2). The Save-vs-Open rule is `businessCard`, executed
 * for real in domain/business-tap.test.ts. `apps/mobile` has no test runner and
 * react-native-maps is native, so — like mobile-map.test.ts — the wiring is
 * asserted against the source: `onPoiClick` on the Google path only, the card
 * in the Map tab's card slot, Save → /capture?googlePlaceId=…, and capture.tsx
 * opening at the confirm step. Whether a POI tap fires on a device is the
 * walk's (keys + a dev-client build).
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const map = flat(code(read("apps/mobile/src/map.tsx")));
const tab = flat(code(read("apps/mobile/app/(tabs)/map.tsx")));
const capture = flat(code(read("apps/mobile/app/capture.tsx")));

describe("src/map.tsx: onPoiClick on the Google path", () => {
  it("TripMap takes an optional onPoi and hands it to the Google canvas only", () => {
    expect(map).toContain("onPoi?: (poi: TappedPoi) => void;");
    expect(map).toContain("onPoi={onPoi}");
    expect((map.match(/onPoiClick=/g) ?? []).length).toBe(1);
  });

  it("maps the native event to the place id, name and point", () => {
    expect(map).toContain("const { placeId, name, coordinate } = e.nativeEvent;");
    expect(map).toContain("onPoi({ googlePlaceId: placeId, name, lat: coordinate.latitude, lng: coordinate.longitude });");
  });
});

describe("app/(tabs)/map.tsx: the business card in the card slot", () => {
  it("passes onPoi and draws the card only while Google draws", () => {
    expect(tab).toContain("onPoi={tapPoi}");
    expect(tab).toContain('resolveMapEngine(engine, googleAvailability()).engine === "google"');
    expect(tab).toMatch(/poi && onGoogle \? businessCard\(/);
  });

  it("one card at a time: a pin tap or a map tap closes it", () => {
    expect(tab).toMatch(/const select = \(id: string\) => \{ setPoi\(null\);/);
    expect(tab).toMatch(/onPressMap=\{\(\) => \{ setSelectedId\(null\); setPoi\(null\); \}\}/);
  });

  it("Save pushes /capture?googlePlaceId=…; Open → its Place screen", () => {
    expect(tab).toContain('router.push({ pathname: "/capture", params: { googlePlaceId: business.googlePlaceId } });');
    expect(tab).toContain('router.push({ pathname: "/place/[id]", params: { id: business.action.save.id, from: "Map" } });');
    expect(tab).toContain("BUSINESS_CARD_COPY.tag");
    expect(tab).toContain("BUSINESS_CARD_COPY.save");
    expect(tab).toContain("BUSINESS_CARD_COPY.open");
  });

  it("the Save fill is accent-deep in tokens, no raw hex added", () => {
    expect(tab).toContain("backgroundColor: C.accentDeep");
  });
});

describe("app/capture.tsx: googlePlaceId opens at the confirm step", () => {
  it("reads the param", () => {
    expect(capture).toContain("const { googlePlaceId } = useLocalSearchParams<{ googlePlaceId?: string }>();");
  });

  it("fetches the place and lands on confirm with it as the hit, only from find", () => {
    expect(capture).toContain("api.places .details(googlePlaceId)");
    expect(capture).toContain('cur.kind === "find" ? { kind: "confirm", target: { kind: "place", hit } } : cur');
  });
});
