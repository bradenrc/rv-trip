import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #201 · tap a business on the Google basemap to save it (docs/design/202 §1–§2).
 *
 * The Save-vs-Open rule is core's `businessCard` / `businessTapAction`, unit
 * tested in packages/core (domain/business-tap.test.ts). The web vitest has no
 * DOM and the Maps JS cannot run keyless in CI, so this file pins the wiring
 * from source: the click → place id seam, the card slot, the library reaching
 * every map surface, and Save → rv:capture → CaptureSheet at the pick.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const src = (rel: string) => flat(code(read(rel)));

const google = src("GoogleMapView.tsx");
const mapMount = src("MapMount.tsx");
const mapView = src("MapView.tsx");
const overview = src("MapOverview.tsx");
const library = src("../places/PlacesLibrary.tsx");
const journal = src("../trip/JournalMap.tsx");
const lens = src("../trip/JournalLens.tsx");
const mini = src("DestinationMiniMap.tsx");
const nav = src("../nav/Nav.tsx");
const sheet = src("../places/CaptureSheet.tsx");

describe("GoogleMapView: a basemap business tap", () => {
  it("listens for map clicks only when a surface asks for business taps", () => {
    expect(google).toContain('m.addListener("click"');
    expect(google).toContain("onBusinessRef.current");
  });

  it("reads e.placeId and suppresses Google's own info window with e.stop()", () => {
    expect(google).toMatch(/"placeId" in e && e\.placeId/);
    expect(google).toContain("e.stop();");
  });

  it("a click off every business clears the card (null)", () => {
    expect(google).toMatch(/onBusinessRef\.current\?\.\(null\)|business\(null\)/);
  });
});

describe("MapMount: the business card in the pin-card slot", () => {
  it("takes the saved library as an optional prop", () => {
    expect(mapMount).toContain("saves?: readonly SavedPlace[];");
  });

  it("only the Google engine with a library raises business taps", () => {
    expect(mapMount).toMatch(/onBusiness=\{saves \? tapBusiness : undefined\}/);
    expect(mapMount).toMatch(/resolved\.engine === "google" && card &&/);
    expect(mapView).not.toContain("onBusiness");
  });

  it("names the tapped place through /api/places/details and core's businessCard", () => {
    expect(mapMount).toContain("tripApi.placeDetails(googlePlaceId)");
    expect(mapMount).toContain("businessCard(");
  });

  it("one card at a time: a pin tap or an engine switch closes the business card", () => {
    expect(mapMount).toMatch(/const selectPin = \(id: string\) => \{ setBusiness\(null\); onSelect\?\.\(id\); \}/);
    expect(mapMount).toMatch(/const chooseEngine = \(e: MapEngine\) => \{ setBusiness\(null\); setEngine\(e\); \}/);
  });

  it("Save dispatches rv:capture with the Google place id; Open → goes to the Place view", () => {
    expect(mapMount).toContain('new CustomEvent("rv:capture", { detail: { googlePlaceId: card.googlePlaceId } })');
    expect(mapMount).toContain("href={`/places/${card.action.save.id}`}");
    expect(mapMount).toContain("BUSINESS_CARD_COPY.tag");
  });

  it("the card is the wireframe's .mcard in rv-* tokens only", () => {
    expect(mapMount).toContain("bg-rv-accent-deep px-[13px] py-[7px] text-[12.5px] font-bold text-rv-accent-ink");
    expect(mapMount).toContain("shadow-rv-xl");
    expect(read("MapMount.tsx")).not.toMatch(/#[0-9a-f]{6}\b/i);
  });
});

describe("the library reaches every map surface that takes business taps", () => {
  it("/map, both Places maps and the Journal map pass saves", () => {
    expect(overview).toMatch(/<MapMount[^>]*saves=\{places\}/);
    expect((library.match(/<MapMount[^>]*saves=\{places\}/g) ?? []).length).toBe(2);
    expect(journal).toMatch(/<MapMount[^>]*saves=\{saves\}/);
  });

  it("the trip page's library already reaches JournalMap (through JournalLens)", () => {
    expect(lens).toMatch(/<JournalMap[^>]*saves=\{saves\}/);
  });

  it("the destination mini-map takes no business taps", () => {
    expect(mini).not.toContain("saves=");
  });
});

describe("Save → capture on the web", () => {
  it("Nav forwards rv:capture's googlePlaceId to CaptureSheet", () => {
    expect(nav).toContain('window.addEventListener("rv:capture", onCapture);');
    expect(nav).toContain("googlePlaceIdOf(e)");
    expect(nav).toContain("<CaptureSheet googlePlaceId={pickedId} onClose={close} />");
  });

  it("CaptureSheet takes an optional pre-picked id and seeds the pick from details", () => {
    expect(sheet).toContain("googlePlaceId?: string | null;");
    expect(sheet).toContain("tripApi.placeDetails(googlePlaceId)");
    expect(sheet).toContain("pickPlace(f, pickedFromSummary(hit))");
  });
});
