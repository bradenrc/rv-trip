import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { ARC_CASING_WIDTH, DEFAULT_STYLE_MODE, MAP_PALETTE, isStyleMode } from "./theme/map-palette";

/**
 * The phone's map contract (issue #44, item 4).
 *
 * The pure half of this item executes for real in `planner/map-pins.test.ts`
 * (`tripArcs` / `tripStopPins` / `arcFeatureCollection` / `mapBounds`). What is
 * left is a native renderer: `@rnmapbox/maps` is a native module behind an Expo
 * config plugin, `apps/mobile` has no test runner, and nothing in `src/map.tsx`
 * can be mounted here. So — exactly as `mobile-dev-loop.test.ts` (item 1) and
 * `mobile-auth.test.ts` (item 2) do, and for the same reason — the contract is
 * asserted against the source text, and the numbers are checked against the
 * REAL exported values they are supposed to mirror.
 *
 * What this guards, criterion for criterion against the item's acceptance:
 *
 *   1. The two dependencies and the `app.json` plugin registration — with no
 *      download token written into the repo.
 *   2. One shape source, three line layers, at the widths, the dash, the
 *      `line-cap` and the THREE-term casing case the web paints
 *      (`MapView.tsx:198-235`). The third term is the one the vet caught the
 *      wireframe dropping: without it a dashed estimate loses its casing in Sat.
 *   3. `"rv-map-style"` is the key, and every read of it is narrowed by
 *      `isStyleMode`.
 *   4. `mapAvailable()` is a lazy `require` inside a `try`, the "Map
 *      unavailable" copy is verbatim from `packages/ui/src/MapFrame.tsx`, and no
 *      screen offers a Google Maps fallback in its place.
 *   5. The Route lens is untouched and the Map lens renders OUTSIDE its
 *      ScrollView; the stop screen's mini-map has no arcs, no labels, no pill.
 *   6. `Segmented`'s metrics really are `@rv-trip/ui` `SegmentedControl`'s —
 *      asserted against the DS file, so a DS change reds here.
 *
 * What it cannot assert: that any of it renders. The native module, the config
 * plugin, the prebuild, the data-driven expressions, `lineDasharray`, and the
 * map's pan gesture against the Route lens's ScrollView are all
 * render-required — the simulator's job, not this file's.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

const pkg = JSON.parse(read("apps/mobile/package.json")) as {
  dependencies: Record<string, string>;
};
const appJson = read("apps/mobile/app.json");
const appConfig = JSON.parse(appJson) as {
  expo: { plugins: unknown[]; newArchEnabled?: boolean };
};
const map = read("apps/mobile/src/map.tsx");
const ui = read("apps/mobile/src/ui.tsx");
const tripScreen = read("apps/mobile/app/trips/[id]/index.tsx");
const stopScreen = read("apps/mobile/app/trips/[id]/stops/[stopId].tsx");
const readme = read("apps/mobile/README.md");
// The two files the phone mirrors, read so a change there reds here.
const dsMapFrame = read("packages/ui/src/MapFrame.tsx");
const dsPlaces = read("packages/ui/src/Places.tsx");
const webMapView = read("apps/web/src/components/map/MapView.tsx");
const webPins = read("apps/web/src/components/map/pins.ts");
const webMapMount = read("apps/web/src/components/map/MapMount.tsx");

/** Source with `//` and `/* … *\/` comments stripped — a claim about code must
 * not be satisfied by a comment that merely mentions the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const mapCode = code(map);
const uiCode = code(ui);
const tripCode = code(tripScreen);
const stopCode = code(stopScreen);

/** Collapse whitespace so a JSX attribute that hard-wraps still matches. */
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the native map's dependencies and plugin", () => {
  it("declares @rnmapbox/maps and AsyncStorage", () => {
    expect(pkg.dependencies["@rnmapbox/maps"]).toBeTruthy();
    expect(pkg.dependencies["@react-native-async-storage/async-storage"]).toBeTruthy();
  });

  it("registers the Expo config plugin", () => {
    expect(appConfig.expo.plugins).toContain("@rnmapbox/maps");
  });

  it("requires the New Architecture, which @rnmapbox/maps 10.3+ refuses to build without", () => {
    expect(appConfig.expo.newArchEnabled).toBe(true);
  });

  it("writes no download token into app.json — the plugin would copy it into the Podfile", () => {
    expect(appJson).not.toContain("RNMapboxMapsDownloadToken");
    expect(appJson).not.toMatch(/sk\.|pk\./);
  });

  it("keeps the display token in the environment, read in exactly one place", () => {
    expect(mapCode).toContain("process.env.EXPO_PUBLIC_MAPBOX_TOKEN");
    // One reader, so there is one answer to "is there a token".
    expect(mapCode.match(/EXPO_PUBLIC_MAPBOX_TOKEN/g)).toHaveLength(1);
    for (const src of [tripScreen, stopScreen, ui]) {
      expect(src).not.toContain("EXPO_PUBLIC_MAPBOX_TOKEN");
    }
    expect(readme).toContain("EXPO_PUBLIC_MAPBOX_TOKEN");
    // No real token anywhere in the repo's phone half.
    expect(map).not.toMatch(/pk\.ey[A-Za-z0-9_-]/);
  });
});

describe("one shape source, three line layers, at the web's grammar", () => {
  it("is ONE source — a drive rendered twice is unrepresentable", () => {
    expect(mapCode.match(/<ShapeSource/g)).toHaveLength(1);
    expect(mapCode).toContain('const SOURCE_ID = "rv-drive-arcs"');
    // The same source id the web uses, so the two are recognisably one grammar.
    expect(webMapView).toContain('id="rv-drive-arcs"');
    expect(mapCode.match(/<LineLayer/g)).toHaveLength(3);
  });

  it("paints by the ONE predicate, verbatim from MapView.tsx:50", () => {
    expect(flat(mapCode)).toContain('const ROUTED = ["==", ["get", "source"], "here"] as const');
    expect(flat(webMapView)).toContain(
      'const ROUTED: ExpressionSpecification = ["==", ["get", "source"], "here"]',
    );
  });

  it("the casing is ARC_CASING_WIDTH wide and keeps the THIRD case term", () => {
    expect(ARC_CASING_WIDTH).toBe(4);
    expect(flat(mapCode)).toContain("lineWidth: ARC_CASING_WIDTH");
    // The term the wireframe dropped. `arcCasing` is non-null for SAT only, so
    // dropping it costs a dashed estimate its casing over satellite imagery.
    expect(flat(mapCode)).toContain(
      'lineOpacity: ["case", ROUTED, 1, palette.arcCasing ? 1 : 0]',
    );
    expect(flat(webMapView)).toContain(
      '"line-opacity": ["case", ROUTED, 1, palette.arcCasing ? 1 : 0]',
    );
    expect(MAP_PALETTE.sat.arcCasing).not.toBeNull();
    expect(MAP_PALETTE.night.arcCasing).toBeNull();
    expect(MAP_PALETTE.day.arcCasing).toBeNull();
  });

  it("the corridor is 2.6 at ROUTED and palette.arcWidth otherwise", () => {
    expect(mapCode).toContain("const CORRIDOR_WIDTH = 2.6");
    expect(webMapView).toContain("const CORRIDOR_WIDTH = 2.6");
    expect(flat(mapCode)).toContain(
      'lineWidth: ["case", ROUTED, CORRIDOR_WIDTH, palette.arcWidth]',
    );
    expect(flat(mapCode)).toContain('lineOpacity: ["case", ROUTED, 1, 0]');
    // The estimate's own width is the palette's, unchanged by this item.
    expect(MAP_PALETTE.night.arcWidth).toBe(1.6);
    expect(MAP_PALETTE.day.arcWidth).toBe(1.8);
  });

  it("the dash layer is [2.2, 1.8], filtered to estimates only", () => {
    expect(mapCode).toContain("const ESTIMATE_DASH = [2.2, 1.8]");
    expect(webMapView).toContain('"line-dasharray": [2.2, 1.8]');
    expect(flat(mapCode)).toContain(
      'const ESTIMATE_ONLY = ["==", ["get", "source"], "estimate"] as const',
    );
    expect(flat(mapCode)).toContain("filter={ESTIMATE_ONLY}");
    expect(flat(mapCode)).toContain("lineDasharray: ESTIMATE_DASH");
  });

  it("all three layers set line-cap round, as the web does", () => {
    expect(mapCode.match(/lineCap: "round"/g)).toHaveLength(3);
    expect(webMapView.match(/"line-cap": "round"/g)).toHaveLength(3);
  });

  it("fits the camera at the web's padding, max zoom and duration", () => {
    expect(mapCode).toContain("const FIT_PADDING = 56");
    expect(mapCode).toContain("const FIT_MAX_ZOOM = 11");
    expect(mapCode).toContain("const FIT_DURATION = 600");
    expect(flat(webMapView)).toContain("{ padding: 56, maxZoom: 11, duration: 600 }");
  });

  it("takes its geometry and its camera from core, never from a second derivation", () => {
    expect(mapCode).toContain("arcFeatureCollection(arcs)");
    expect(mapCode).toContain("mapBounds(arcs, pins)");
    // No hand-rolled tuple flip in the renderer: that is exactly the mistake
    // `mapBounds`/`arcVertices` exist to make impossible.
    expect(mapCode).not.toMatch(/flatMap\([^)]*a\.path/);
  });

  it("words a drive's label the same two ways pins.ts does", () => {
    expect(flat(mapCode)).toContain(
      '[`${arc.miles} mi`, arc.primaryRoad].filter(Boolean).join(" · ")',
    );
    expect(flat(mapCode)).toContain("`~${arc.miles} mi · est.`");
    expect(flat(webPins)).toContain(
      '[`${arc.miles} mi`, arc.primaryRoad].filter(Boolean).join(" · ")',
    );
    expect(flat(webPins)).toContain("`~${arc.miles} mi · est.`");
  });
});

describe("the basemap and the style preference", () => {
  it("is the phone's own vendor seam: Day and Sat match the web, Night is stock", () => {
    expect(mapCode).toContain('night: "mapbox://styles/mapbox/dark-v11"');
    expect(mapCode).toContain('day: "mapbox://styles/mapbox/outdoors-v12"');
    expect(mapCode).toContain('sat: "mapbox://styles/mapbox/satellite-streets-v12"');
    for (const url of ["dark-v11", "outdoors-v12", "satellite-streets-v12"]) {
      expect(webMapView).toContain(url);
    }
    // Stock, because `applyNightfall` is mapbox-gl-specific. Said in the README
    // rather than left for a reader to discover.
    expect(mapCode).not.toContain("applyNightfall");
    expect(readme).toMatch(/Night is the stock `dark-v11` basemap/);
    expect(readme).toContain("nightfall.ts");
  });

  it("persists under the same key the web writes", () => {
    expect(mapCode).toContain('export const STYLE_PREF_KEY = "rv-map-style"');
    expect(webMapMount).toContain('export const STYLE_PREF_KEY = "rv-map-style"');
  });

  it("narrows EVERY read with core's isStyleMode", () => {
    expect(isStyleMode("day")).toBe(true);
    expect(isStyleMode("terrain")).toBe(false);
    const reads = mapCode.match(/getItem\(/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(flat(mapCode)).toContain("raw !== null && isStyleMode(raw) ? raw : DEFAULT_STYLE_MODE");
    expect(DEFAULT_STYLE_MODE).toBe("day");
  });

  it("the mode is null until the store answers, and the loading frame covers it", () => {
    expect(flat(mapCode)).toContain("useState<StyleMode | null>(null)");
    expect(flat(tripScreen)).toContain('mode === null ? ( <View style={styles.mapFrameBox}> <MapFrame state="loading" />');
    expect(flat(stopScreen)).toContain('mode === null ? ( <MapFrame state="loading"');
  });
});

describe("mapAvailable() degrades, and nothing routes to Google Maps instead", () => {
  it("is a lazy require inside a try, resolved once", () => {
    expect(flat(mapCode)).toContain('const mod = require("@rnmapbox/maps") as MapboxModule');
    // The require must sit inside a try, or an absent native module throws at
    // import time and takes the whole screen with it.
    const guard = mapCode.slice(mapCode.indexOf("function loadMapbox"));
    const tryAt = guard.indexOf("try {");
    const requireAt = guard.indexOf('require("@rnmapbox/maps")');
    expect(tryAt).toBeGreaterThan(-1);
    expect(requireAt).toBeGreaterThan(tryAt);
    // No static VALUE import of the module — a `import type` is erased at
    // compile time and cannot pull the native module into the bundle.
    expect(mapCode).not.toMatch(/^import (?!type )[^;]*from "@rnmapbox\/maps"/m);
    expect(map).toMatch(/^import type .*from "@rnmapbox\/maps";$/m);
  });

  it("is false with no token, without even requiring the module", () => {
    expect(flat(mapCode)).toContain(
      "export function mapAvailable(): boolean { if (MAPBOX_TOKEN.length === 0) return false; return loadMapbox() !== null; }",
    );
  });

  it("renders the unavailable frame instead of throwing", () => {
    expect(flat(mapCode)).toContain('if (!mapbox) return <MapFrame state="unavailable" height={height} />');
  });

  it("offers no Google Maps fallback on any map surface", () => {
    // Code, not prose: the docstrings explain the rule and so name Google.
    for (const src of [mapCode, stopCode, tripCode]) {
      expect(src).not.toMatch(/google/i);
    }
    // The phone's ONE hand-off to Google is a drive's Navigate button, which
    // predates this item and is turn-by-turn, not a map fallback: it goes
    // through core's `drive.navUrl` and no map surface can reach it.
    expect(tripCode).toContain("Linking.openURL(drive.navUrl)");
  });
});

describe("the three frames reproduce packages/ui's copy", () => {
  it("the unavailable frame is verbatim", () => {
    expect(map).toContain("Map unavailable");
    expect(flat(map)).toContain(
      "The map token isn’t configured for this environment. Everything else on this page still works.",
    );
    // The DS's own words, with its `&rsquo;` resolved — if the DS rewords it,
    // this reds.
    expect(flat(dsMapFrame)).toContain(
      "The map token isn&rsquo;t configured for this environment. Everything else on this page still works.",
    );
  });

  it("the empty frame is verbatim, count and all", () => {
    expect(map).toContain("Nothing to map yet");
    expect(flat(map)).toContain('"None of these places has coordinates."');
    expect(flat(map)).toContain("`None of these ${count} places has coordinates.`");
    expect(map).toContain("They’re all still in the list.");
    expect(flat(dsMapFrame)).toContain('"None of these places has coordinates."');
    expect(flat(dsMapFrame)).toContain("`None of these ${count} places has coordinates.`");
  });

  it("the loading frame is verbatim, and it has a real trigger on the phone", () => {
    expect(map).toContain("Map view");
    expect(map).toContain("Loading tiles…");
    expect(dsMapFrame).toContain("Loading tiles&hellip;");
    // Not a lazy chunk (a native map has none) — the AsyncStorage read. Both
    // map surfaces ask for it by name.
    expect(mapCode).toContain(
      'export type MapFrameState = "loading" | "unavailable" | "empty"',
    );
    expect(tripCode).toContain('<MapFrame state="loading"');
    expect(stopCode).toContain('<MapFrame state="loading"');
  });

  it("uses glyphs, because this kit ships no icon set", () => {
    expect(mapCode).not.toContain("lucide");
    expect(uiCode).not.toContain("lucide");
    // The DS frame this mirrors is built from three of them.
    expect(dsMapFrame).toContain('from "lucide-react"');
  });
});

describe("the trip screen's Route ⇄ Map lens", () => {
  it("derives both halves of the map from core, from the bundle it already holds", () => {
    expect(flat(tripScreen)).toContain("tripArcs(bundle.trip, bundle.routes, bundle.rigHash)");
    expect(flat(tripScreen)).toContain("tripStopPins(bundle.trip)");
  });

  it("puts the lens control in the masthead, above both lenses", () => {
    const seg = tripScreen.indexOf("<Segmented value={lens}");
    const scroll = tripScreen.indexOf("contentContainerStyle={styles.content}");
    const trip = tripScreen.indexOf("<TripMap");
    expect(seg).toBeGreaterThan(-1);
    expect(seg).toBeLessThan(trip);
    expect(seg).toBeLessThan(scroll);
  });

  it("renders the Map lens OUTSIDE the ScrollView — a pan gesture cannot share a scroll", () => {
    expect(tripScreen.indexOf("<TripMap")).toBeLessThan(
      tripScreen.indexOf("contentContainerStyle={styles.content}"),
    );
    // The map branch is a flex:1 View, and the two lenses are alternatives of
    // one ternary rather than siblings.
    expect(flat(tripScreen)).toContain("mapLens: { flex: 1 }");
    expect(flat(tripScreen)).toContain('{lens === "map" ? (');
    expect(tripScreen.match(/contentContainerStyle={styles\.content}/g)).toHaveLength(1);
  });

  it("keeps every element of today's Route lens, in today's order", () => {
    for (const fragment of [
      "<Kicker>Rhythm</Kicker>",
      "<Legend color={C.green} label=\"Stay\" />",
      "<Kicker>On the road</Kicker>",
      "behind the wheel",
      "Navigation may not follow the RV-safe route — check notices.",
      "{timeline!.openLabel}",
    ]) {
      expect(tripScreen).toContain(fragment);
    }
    // The notice still prints whole — the web's `splitNoticeMessage` polish is a
    // pre-existing gap this item deliberately does not grow into.
    expect(flat(tripScreen)).toContain("⚠ {n.message}");
    expect(tripScreen).not.toContain("splitNoticeMessage");
  });

  it("shortens the masthead's date line on the map, where no scroll carries the rest", () => {
    expect(flat(tripScreen)).toContain("{summary!.stops} stops · {arcs.length}{\" \"} drive");
  });

  it("passes the map the style handler, so the over-canvas pill renders", () => {
    expect(flat(tripScreen)).toContain(
      "<TripMap pins={pins} arcs={arcs} mode={mode} onModeChange={setMode} showLabels />",
    );
  });
});

describe("the stop screen's mini-map", () => {
  it("is mounted with no arcs, no labels and no style pill", () => {
    expect(flat(stopScreen)).toContain(
      "<TripMap pins={miniPins} mode={mode} showLabels={false} height={MINI_MAP_HEIGHT} />",
    );
    // Structural, not a boolean: no handler ⇒ nothing to change ⇒ no pill.
    expect(stopCode).not.toContain("onModeChange");
    expect(stopCode).not.toMatch(/<TripMap[^>]*arcs=/);
  });

  it("diverges from the web's mini-map on labels, on purpose and explicitly", () => {
    // The web's StopMiniMap passes no `showLabels`, and MapView defaults it to
    // true, so the web DOES label its one pin. The phone's prop is required so
    // neither call site can inherit a default.
    expect(webMapView).toContain("showLabels = true");
    expect(mapCode).toContain("showLabels: boolean;");
    expect(mapCode).not.toMatch(/showLabels\s*=\s*(true|false)/);
  });

  it("keeps the web's 150pt frame height", () => {
    expect(stopScreen).toContain("const MINI_MAP_HEIGHT = 150");
    expect(read("apps/web/src/components/map/StopMiniMap.tsx")).toContain(
      'STOP_MINI_MAP_HEIGHT = "150px"',
    );
  });

  it("prints the ordinal from core's scheduledOrder, not from anything local", () => {
    expect(stopScreen).toContain("scheduledOrder(bundle.trip)");
    expect(flat(stopScreen)).toContain(
      "`${legName} · stop ${ordinal} of ${order!.total}` : legName",
    );
    // A floating stop has no place in the sequence, so it keeps the bare leg
    // name rather than printing "stop null of 3".
    expect(flat(stopScreen)).toContain("ordinal !== null && legName ?");
  });
});

describe("Segmented mirrors @rv-trip/ui's SegmentedControl, not some other control", () => {
  it("the DS still has the metrics this claims to mirror", () => {
    expect(dsPlaces).toContain("px-2.5 py-[5px] font-mono text-[11px]");
    expect(dsPlaces).toContain("px-3.5 py-1.5 text-[13px]");
    expect(dsPlaces).toContain(
      "inline-flex gap-0.5 rounded-rv-pill border border-rv-border bg-rv-surface-alt p-[3px]",
    );
    expect(dsPlaces).toContain("bg-rv-surface text-rv-ink shadow-rv-sm");
  });

  it("resolves them to RN points: 14/6 at 13, mono 10/5 at 11, container padding 3", () => {
    expect(flat(uiCode)).toContain(
      "segment: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.pill }",
    );
    expect(flat(uiCode)).toContain("segmentMono: { paddingHorizontal: 10, paddingVertical: 5 }");
    expect(flat(uiCode)).toContain('segmentText: { fontSize: 13, fontWeight: "700" }');
    expect(flat(uiCode)).toContain("segmentTextMono: { fontFamily: F.mono, fontSize: 11 }");
    expect(flat(uiCode)).toContain("borderColor: C.border, backgroundColor: C.surfaceAlt, borderRadius: R.pill, padding: 3,");
  });

  it("is label-only — the web's variant takes a LucideIcon and this kit has none", () => {
    expect(flat(uiCode)).toContain("export interface SegmentedOption<T extends string> { value: T; label: string; }");
    expect(dsPlaces).toContain("Icon: LucideIcon");
  });
});
