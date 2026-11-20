import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { webGoogleAvailability } from "@rv-trip/core";
import { ENGINE_PREF_KEY, WEB_GOOGLE_AVAILABILITY, engineSegments } from "./MapMount";

/**
 * #198 · the web map-engine pill (docs/design/202 §1 and §3). `resolveMapEngine`
 * itself is unit-tested in packages/core (domain/prefs.test.ts), one case per
 * row of the resolution table. This file covers the web seam: what the pill
 * offers and how it is mounted. It has no DOM, so the stacking order is read
 * from source. How it looks over a canvas is for the walk to check.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const mapMountRaw = readFileSync(join(HERE, "MapMount.tsx"), "utf8");
const mapMount = flat(code(mapMountRaw));
const google = flat(code(readFileSync(join(HERE, "GoogleMapView.tsx"), "utf8")));
const mapView = flat(code(readFileSync(join(HERE, "MapView.tsx"), "utf8")));

describe("engineSegments: the engine pill's options", () => {
  it("offers Mapbox · Google, in that order, with no glyphs", () => {
    expect(engineSegments(null)).toEqual([
      { value: "mapbox", label: "Mapbox", struck: false },
      { value: "google", label: "Google", struck: false },
    ]);
  });

  it("strikes Google (only Google) when it is chosen but can't be drawn", () => {
    for (const reason of ["no-key", "no-module", "not-built"] as const) {
      const [mapbox, google] = engineSegments(reason);
      expect(mapbox!.struck).toBe(false);
      expect(google!.struck).toBe(true);
    }
  });
});

describe("MapMount: the engine seam on the web (#198)", () => {
  it("keeps the preference under rv-map-engine, the key PREF_REMOTE mirrors", () => {
    expect(ENGINE_PREF_KEY).toBe("rv-map-engine");
  });

  it("#199 · derives availability from the key AND the Map ID, read literally for Next to inline", () => {
    expect(mapMount).toContain(
      "webGoogleAvailability( process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY, process.env.NEXT_PUBLIC_GOOGLE_MAP_ID, )",
    );
    // The test env sets neither, so this run is the walk/CI case.
    expect(WEB_GOOGLE_AVAILABILITY).toEqual(
      webGoogleAvailability(
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY,
        process.env.NEXT_PUBLIC_GOOGLE_MAP_ID,
      ),
    );
  });

  it("resolves the choice through core's resolveMapEngine and never writes it back on its own", () => {
    expect(mapMount).toContain(
      "useStringPref(ENGINE_PREF_KEY, isMapEngine, DEFAULT_MAP_ENGINE)",
    );
    expect(mapMount).toContain("resolveMapEngine(engine, WEB_GOOGLE_AVAILABILITY)");
    // The only writer is the pill's own onChange, so a tap is the only write.
    expect((mapMount.match(/setEngine/g) ?? []).length).toBe(2);
    expect(mapMount).toContain("onChange={setEngine}");
  });

  it("stacks the engine pill under the style pill, with the amber note under both", () => {
    const style = mapMount.indexOf("options={STYLE_SEGMENTS}");
    const engine = mapMount.indexOf("options={engineSegments(resolved.fallback)}");
    const note = mapMount.indexOf("<EngineFallbackNote reason={resolved.fallback} />");
    expect(style).toBeGreaterThan(-1);
    expect(engine).toBeGreaterThan(style);
    expect(note).toBeGreaterThan(engine);
    expect(mapMount).toContain("flex flex-col items-end gap-1.5");
    expect(mapMount).toContain("{resolved.fallback && <EngineFallbackNote");
  });

  it("draws the note in the warning roles only (no raw colour)", () => {
    expect(mapMount).toContain("border-rv-warning bg-rv-warning-soft");
    expect(mapMount).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe("MapMount: the Google engine behind the seam (#199)", () => {
  it("imports no Google code at module scope — only the lazy dynamic() import", () => {
    const imports = mapMountRaw.match(/^import [\s\S]*?;$/gm) ?? [];
    for (const line of imports) {
      expect(line).not.toMatch(/GoogleMapView|google\.maps|@googlemaps|maps\.googleapis/);
    }
    expect(mapMount).toContain(
      'dynamic( () => import("./GoogleMapView").then((m) => m.GoogleMapView), { ssr: false, loading: () => <MapFrame state="loading" /> }, )',
    );
    expect(mapMount).not.toMatch(/google\.maps|maps\.googleapis/);
  });

  it("draws GoogleMapView only when resolveMapEngine says google, with no Mapbox token prop", () => {
    expect(mapMount).toContain('resolved.engine === "google" ? ( <LazyGoogleMapView');
    const g = mapMount.slice(mapMount.indexOf("<LazyGoogleMapView"), mapMount.indexOf("/>", mapMount.indexOf("<LazyGoogleMapView")));
    expect(g).not.toContain("token=");
    expect(g).toContain("mode={mode}");
  });

  it("does not need a Mapbox token to draw Google", () => {
    expect(mapMount).toContain('const drawable = resolved.engine === "google" || Boolean(token);');
    expect(mapMount).toContain("{!drawable ? ( <MapFrame state=\"unavailable\" />");
  });

  it("holds the loading frame until the engine has resolved too", () => {
    expect(mapMount).toContain("mode === null || engine === null ?");
  });
});

describe("GoogleMapView: the same marks, on Google's basemap (#199)", () => {
  it("takes MapViewProps minus the Mapbox token", () => {
    expect(google).toContain('export type GoogleMapViewProps = Omit<MapViewProps, "token">;');
    expect(google).toContain('import type { MapViewProps } from "./MapView";');
    // A type-only import: nothing from MapView (mapbox-gl) is loaded at runtime.
    expect(google).not.toMatch(/import \{[^}]*\} from "\.\/MapView"/);
    expect(google).not.toMatch(/react-map-gl|mapbox-gl/);
  });

  it("picks the basemap from core's GOOGLE_WEB_BASEMAP and the Map ID", () => {
    expect(google).toContain("const basemap = GOOGLE_WEB_BASEMAP[mode];");
    expect(google).toContain("mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID");
    expect(google).toContain("colorScheme: basemap.colorScheme");
    expect(google).toContain("mapTypeId: basemap.mapTypeId");
    expect(google).toContain("map?.setMapTypeId(basemap.mapTypeId)");
  });

  it("draws the shared HTML marks as AdvancedMarkerElement content, in MAP_PALETTE[mode]", () => {
    expect(google).toContain("const palette = MAP_PALETTE[mode];");
    expect(google).toContain("new libs.marker.AdvancedMarkerElement({ map, content: el })");
    expect(google).toContain("<PinMark pin={pin} at={at} selected={selected} palette={palette} showLabels={showLabels} />");
    expect(google).toContain("<ArcLabel label={a.label} palette={palette} />");
    // MapView renders the very same components.
    expect(mapView).toContain("<PinMark pin={pin} at={at} selected={selected} palette={palette} showLabels={showLabels} />");
    expect(mapView).toContain("<ArcLabel label={a.label} palette={palette} />");
  });

  it("draws HERE corridors solid and estimates dashed, at MapView's widths", () => {
    expect(google).toContain('const routed = arc.source === "here";');
    expect(google).toContain("strokeWeight: CORRIDOR_WIDTH");
    expect(google).toContain("const CORRIDOR_WIDTH = 2.6;");
    expect(mapView).toContain("const CORRIDOR_WIDTH = 2.6;");
    expect(google).toContain("const DASH_ON = 2.2;");
    expect(google).toContain("const DASH_OFF = 1.8;");
    expect(mapView).toContain('"line-dasharray": [2.2, 1.8]');
    expect(google).toContain(": dashed(libs, map, path, palette)");
  });

  it("never hides Google's attribution or logo", () => {
    expect(google).not.toMatch(/gm-style-cc|attribution|logo/i);
  });
});
