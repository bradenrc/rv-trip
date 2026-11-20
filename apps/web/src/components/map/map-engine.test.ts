import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
const mapMount = flat(code(readFileSync(join(HERE, "MapMount.tsx"), "utf8")));

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

  it('reports Google as "not-built" until the web renderer lands (#199)', () => {
    expect(WEB_GOOGLE_AVAILABILITY).toEqual({ ok: false, reason: "not-built" });
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
