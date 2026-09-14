import { describe, it, expect } from "vitest";
import {
  PREF_REMOTE,
  PREF_LOCAL_KEYS,
  isRemotePrefKey,
  toRemotePatch,
  toLocalEntries,
  userPrefsPatch,
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
  it("maps each of the four localStorage keys to its column", () => {
    expect(PREF_REMOTE).toEqual({
      "rv-theme": "theme",
      "rv-units": "units",
      "rv-map-style": "mapStyle",
      "rv-track-costs": "trackCosts",
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
