import { describe, it, expect } from "vitest";
import {
  PREF_REMOTE,
  PREF_LOCAL_KEYS,
  isRemotePrefKey,
  toRemotePatch,
  toLocalEntries,
  userPrefsPatch,
  resolveMapEngine,
  isMapEngine,
  DEFAULT_MAP_ENGINE,
  MAP_ENGINES,
  MAP_ENGINE_FALLBACK_COPY,
  mapEngineFallbackLine,
  webGoogleAvailability,
  GOOGLE_WEB_BASEMAP,
  type GoogleAvailability,
  type UserPrefs,
} from "./prefs";

/**
 * The preference round-trip (issue #45, item 4).
 *
 * `user_prefs` is one nullable row per account and `localStorage` sits in front
 * of it. Two translations are therefore load-bearing and neither is obvious:
 *
 *   LOCAL → REMOTE  every value in localStorage is a STRING (`useBooleanPref`
 *                   writes "1"/"0"), while `track_costs` is a real `boolean`
 *                   column. A raw key→column map with no coercion would PUT the
 *                   string "1" at a boolean and be rejected.
 *   REMOTE → LOCAL  the same coercion inverted, plus: a `null` column means
 *                   "never chosen" and must NOT overwrite the local value with
 *                   the string "null".
 *
 * Both live here, in the vendor-free core, so they are executed by the test
 * runner rather than asserted as source text.
 */

const FULL_ROW: UserPrefs = {
  ownerId: "dev-user",
  theme: "light",
  units: "metric",
  mapStyle: "sat",
  trackCosts: true,
  updatedAt: "2026-09-13T00:00:00.000Z",
};

describe("PREF_REMOTE — the key map", () => {
  it("maps each of the five localStorage keys to its column", () => {
    expect(PREF_REMOTE).toEqual({
      "rv-theme": "theme",
      "rv-units": "units",
      "rv-map-style": "mapStyle",
      "rv-track-costs": "trackCosts",
      "rv-map-engine": "mapEngine",
    });
  });

  it("PREF_LOCAL_KEYS is exactly the map's keys", () => {
    expect([...PREF_LOCAL_KEYS].sort()).toEqual(Object.keys(PREF_REMOTE).sort());
  });

  it("every column is distinct — no two keys write the same field", () => {
    const columns = Object.values(PREF_REMOTE);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("recognises mapped keys and rejects unmapped ones", () => {
    for (const key of PREF_LOCAL_KEYS) expect(isRemotePrefKey(key)).toBe(true);
    expect(isRemotePrefKey("rv-something-else")).toBe(false);
    expect(isRemotePrefKey("theme")).toBe(false);
    expect(isRemotePrefKey("")).toBe(false);
  });
});

describe("toRemotePatch — localStorage string → column value", () => {
  it("passes string preferences through untouched", () => {
    expect(toRemotePatch("rv-theme", "light")).toEqual({ theme: "light" });
    expect(toRemotePatch("rv-units", "metric")).toEqual({ units: "metric" });
    expect(toRemotePatch("rv-map-style", "sat")).toEqual({ mapStyle: "sat" });
  });

  it("#198 · mirrors the map engine to its own column", () => {
    expect(toRemotePatch("rv-map-engine", "google")).toEqual({ mapEngine: "google" });
    expect(toRemotePatch("rv-map-engine", "mapbox")).toEqual({ mapEngine: "mapbox" });
  });

  it('coerces the "1"/"0" boolean pref to a real boolean', () => {
    expect(toRemotePatch("rv-track-costs", "1")).toEqual({ trackCosts: true });
    expect(toRemotePatch("rv-track-costs", "0")).toEqual({ trackCosts: false });
    // Anything that is not the stored "1" is off — the same rule
    // `useBooleanPref` reads with (`getItem(key) === "1"`).
    expect(toRemotePatch("rv-track-costs", "")).toEqual({ trackCosts: false });
    expect(toRemotePatch("rv-track-costs", "true")).toEqual({ trackCosts: false });
  });

  it("emits exactly one field — a PUT never disturbs the other three", () => {
    for (const key of PREF_LOCAL_KEYS) {
      expect(Object.keys(toRemotePatch(key, "1"))).toHaveLength(1);
    }
  });

  it("emits a patch the API schema accepts", () => {
    for (const key of PREF_LOCAL_KEYS) {
      expect(userPrefsPatch.safeParse(toRemotePatch(key, "1")).success).toBe(true);
    }
  });
});

describe("toLocalEntries — a row → the localStorage writes it implies", () => {
  it("writes all four when all four are set", () => {
    expect(toLocalEntries(FULL_ROW)).toEqual([
      ["rv-theme", "light"],
      ["rv-units", "metric"],
      ["rv-map-style", "sat"],
      ["rv-track-costs", "1"],
    ]);
  });

  it('renders the boolean column back as "1"/"0"', () => {
    expect(toLocalEntries({ ...FULL_ROW, trackCosts: false })).toContainEqual([
      "rv-track-costs",
      "0",
    ]);
  });

  it("skips null columns — null means never chosen, not 'clear it'", () => {
    const row: UserPrefs = {
      ...FULL_ROW,
      theme: null,
      units: null,
      mapStyle: null,
      trackCosts: null,
    };
    expect(toLocalEntries(row)).toEqual([]);
  });

  it("skips only the null ones", () => {
    const row: UserPrefs = { ...FULL_ROW, units: null, trackCosts: null };
    expect(toLocalEntries(row)).toEqual([
      ["rv-theme", "light"],
      ["rv-map-style", "sat"],
    ]);
  });

  it("never yields a non-string value — localStorage stores strings only", () => {
    for (const [, value] of toLocalEntries(FULL_ROW)) expect(typeof value).toBe("string");
  });

  it("tolerates a missing row (nothing saved yet)", () => {
    expect(toLocalEntries(null)).toEqual([]);
  });
});

describe("the round trip", () => {
  it("local → remote → local is the identity for every key", () => {
    const cases: Array<[string, string]> = [
      ["rv-theme", "dark"],
      ["rv-units", "imperial"],
      ["rv-map-style", "night"],
      ["rv-track-costs", "1"],
      ["rv-track-costs", "0"],
      ["rv-map-engine", "google"],
    ];
    for (const [key, stored] of cases) {
      const row = { ...FULL_ROW, ...toRemotePatch(key as never, stored) } as UserPrefs;
      const back = new Map(toLocalEntries(row));
      expect(back.get(key as never), `${key}=${stored}`).toBe(stored);
    }
  });
});

describe("userPrefsPatch — the PUT body", () => {
  it("accepts an empty body", () => {
    expect(userPrefsPatch.safeParse({}).success).toBe(true);
  });

  it("accepts any subset of the four fields", () => {
    expect(userPrefsPatch.safeParse({ theme: "light" }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ trackCosts: false }).success).toBe(true);
    expect(
      userPrefsPatch.safeParse({ theme: "dark", units: "metric", mapStyle: "day" }).success,
    ).toBe(true);
  });

  it("accepts an explicit null — clearing a preference back to 'never chosen'", () => {
    expect(userPrefsPatch.safeParse({ theme: null }).success).toBe(true);
  });

  it("#198 · accepts mapEngine (a string or null) and rejects a non-string", () => {
    expect(userPrefsPatch.safeParse({ mapEngine: "google" }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ mapEngine: "mapbox" }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ mapEngine: null }).success).toBe(true);
    expect(userPrefsPatch.safeParse({ mapEngine: 1 }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(userPrefsPatch.safeParse({ ownerId: "someone-else" }).success).toBe(false);
    expect(userPrefsPatch.safeParse({ theme: "dark", nope: 1 }).success).toBe(false);
    expect(userPrefsPatch.safeParse({ updatedAt: "2020-01-01" }).success).toBe(false);
  });

  it("rejects a wrongly-typed field", () => {
    expect(userPrefsPatch.safeParse({ trackCosts: "1" }).success).toBe(false);
    expect(userPrefsPatch.safeParse({ theme: 1 }).success).toBe(false);
  });
});

describe("#198 · toLocalEntries carries the map engine", () => {
  it("writes rv-map-engine when the row has one, and skips it when null or absent", () => {
    expect(toLocalEntries({ ...FULL_ROW, mapEngine: "google" })).toContainEqual([
      "rv-map-engine",
      "google",
    ]);
    const keys = (row: UserPrefs) => toLocalEntries(row).map(([k]) => k);
    expect(keys({ ...FULL_ROW, mapEngine: null })).not.toContain("rv-map-engine");
    expect(keys(FULL_ROW)).not.toContain("rv-map-engine");
  });
});

/**
 * #198 · resolveMapEngine — one case per row of the wireframe's resolution
 * table (docs/design/202 §3): what the account says vs what gets drawn.
 */
describe("#198 · resolveMapEngine — the resolution table", () => {
  const AVAILABLE: GoogleAvailability = { ok: true };
  const NO_KEY: GoogleAvailability = { ok: false, reason: "no-key" };
  const NO_MODULE: GoogleAvailability = { ok: false, reason: "no-module" };
  const NOT_BUILT: GoogleAvailability = { ok: false, reason: "not-built" };
  const ANY = [AVAILABLE, NO_KEY, NO_MODULE, NOT_BUILT];

  it("null (never chosen) → mapbox, no fallback line, whatever Google's state", () => {
    for (const g of ANY) expect(resolveMapEngine(null, g)).toEqual({ engine: "mapbox", fallback: null });
    expect(resolveMapEngine(undefined, AVAILABLE)).toEqual({ engine: "mapbox", fallback: null });
  });

  it('"mapbox" → mapbox, no fallback line, whatever Google\'s state', () => {
    for (const g of ANY) expect(resolveMapEngine("mapbox", g)).toEqual({ engine: "mapbox", fallback: null });
  });

  it('"google" + available → google', () => {
    expect(resolveMapEngine("google", AVAILABLE)).toEqual({ engine: "google", fallback: null });
  });

  it('"google" + web without key or Map ID → mapbox, fallback "no-key"', () => {
    expect(resolveMapEngine("google", NO_KEY)).toEqual({ engine: "mapbox", fallback: "no-key" });
  });

  it('"google" + phone without the native module → mapbox, fallback "no-module"', () => {
    expect(resolveMapEngine("google", NO_MODULE)).toEqual({ engine: "mapbox", fallback: "no-module" });
  });

  it('"google" + not built yet → mapbox, fallback "not-built"', () => {
    expect(resolveMapEngine("google", NOT_BUILT)).toEqual({ engine: "mapbox", fallback: "not-built" });
  });

  it("an unknown stored value (a future release's engine) degrades to the default", () => {
    expect(resolveMapEngine("apple", AVAILABLE)).toEqual({ engine: DEFAULT_MAP_ENGINE, fallback: null });
  });

  it("the default is Mapbox, and the pill order is Mapbox · Google", () => {
    expect(DEFAULT_MAP_ENGINE).toBe("mapbox");
    expect(MAP_ENGINES.map((e) => e.label)).toEqual(["Mapbox", "Google"]);
    expect(MAP_ENGINES.every((e) => isMapEngine(e.value))).toBe(true);
    expect(isMapEngine("apple")).toBe(false);
  });

  it("each fallback reason carries the wireframe's amber copy verbatim", () => {
    expect(MAP_ENGINE_FALLBACK_COPY).toEqual({
      "no-key": { title: "Google isn’t set up here", body: "Showing Mapbox. Your choice is kept." },
      "no-module": {
        title: "This version of the app has no Google map",
        body: "Showing Mapbox until you update.",
      },
      "not-built": { title: "Google map is coming", body: "Showing Mapbox for now. Your choice is kept." },
    });
  });

  it("the settings-row line joins title and body behind the ⚠", () => {
    expect(mapEngineFallbackLine("no-module")).toBe(
      "⚠ This version of the app has no Google map. Showing Mapbox until you update.",
    );
  });
});

describe("#199 · webGoogleAvailability — key AND Map ID, else no-key (q4 A)", () => {
  it("is ok only when both the Maps JS key and the Map ID are set", () => {
    expect(webGoogleAvailability("AIza-key", "map-id-1")).toEqual({ ok: true });
  });

  it('either one missing (undefined, empty or blank) is "no-key"', () => {
    const noKey = { ok: false, reason: "no-key" };
    expect(webGoogleAvailability(undefined, "map-id-1")).toEqual(noKey);
    expect(webGoogleAvailability("AIza-key", undefined)).toEqual(noKey);
    expect(webGoogleAvailability(undefined, undefined)).toEqual(noKey);
    expect(webGoogleAvailability("", "map-id-1")).toEqual(noKey);
    expect(webGoogleAvailability("AIza-key", "   ")).toEqual(noKey);
  });

  it("feeds resolveMapEngine: a keyless web build keeps the choice and draws Mapbox", () => {
    expect(resolveMapEngine("google", webGoogleAvailability("AIza-key", "map-id-1"))).toEqual({
      engine: "google",
      fallback: null,
    });
    expect(resolveMapEngine("google", webGoogleAvailability("AIza-key", ""))).toEqual({
      engine: "mapbox",
      fallback: "no-key",
    });
  });
});

describe("#199 · GOOGLE_WEB_BASEMAP — style mode → Google map type", () => {
  it("day → roadmap, night → roadmap on the Map ID's DARK scheme, sat → hybrid", () => {
    expect(GOOGLE_WEB_BASEMAP).toEqual({
      day: { mapTypeId: "roadmap", colorScheme: "LIGHT" },
      night: { mapTypeId: "roadmap", colorScheme: "DARK" },
      sat: { mapTypeId: "hybrid", colorScheme: "LIGHT" },
    });
  });
});
