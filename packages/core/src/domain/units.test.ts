import { describe, it, expect } from "vitest";
import {
  UNITS,
  DEFAULT_UNITS,
  isUnits,
  convertMiles,
  distanceUnitLabel,
  type Units,
} from "./units";

/**
 * The display units (issue #45, item 5 · issue #38).
 *
 * Two functions rather than one formatted string, because the Route rail draws
 * the number at 34px and the unit at 15px in two separately-styled spans. Both
 * vocabularies are covered for both functions — that is item 5's acceptance.
 */

describe("the vocabulary", () => {
  it("is exactly imperial and metric, imperial first and default", () => {
    expect(UNITS).toEqual(["imperial", "metric"]);
    expect(DEFAULT_UNITS).toBe("imperial");
  });

  it("narrows an untrusted string — a stale value from a future release", () => {
    expect(isUnits("imperial")).toBe(true);
    expect(isUnits("metric")).toBe(true);
    expect(isUnits("nautical")).toBe(false);
    expect(isUnits("")).toBe(false);
    expect(isUnits("Imperial")).toBe(false);
  });
});

describe("distanceUnitLabel", () => {
  it("words each vocabulary", () => {
    expect(distanceUnitLabel("imperial")).toBe("mi");
    expect(distanceUnitLabel("metric")).toBe("km");
  });

  it("covers every value in UNITS — no vocabulary can be added unlabelled", () => {
    for (const u of UNITS) expect(["mi", "km"]).toContain(distanceUnitLabel(u));
  });
});

describe("convertMiles", () => {
  it("is the identity in imperial — core keeps computing miles", () => {
    expect(convertMiles(0, "imperial")).toBe(0);
    expect(convertMiles(1, "imperial")).toBe(1);
    expect(convertMiles(136, "imperial")).toBe(136);
    expect(convertMiles(1284, "imperial")).toBe(1284);
  });

  it("converts to whole kilometres in metric", () => {
    // The three numbers the design's own blast-radius table draws.
    expect(convertMiles(1284, "metric")).toBe(2066);
    expect(convertMiles(412, "metric")).toBe(663);
    expect(convertMiles(136, "metric")).toBe(219);
  });

  it("keeps zero at zero in both vocabularies — an empty trip says '—', not '0 km'", () => {
    for (const u of UNITS) expect(convertMiles(0, u)).toBe(0);
  });

  it("rounds rather than truncates", () => {
    // 1 mi = 1.609344 km → 2 km, not 1.
    expect(convertMiles(1, "metric")).toBe(2);
    // 3 mi = 4.828 km → 5 km.
    expect(convertMiles(3, "metric")).toBe(5);
  });

  it("returns an integer for every vocabulary — the rail prints it verbatim", () => {
    for (const u of UNITS) {
      for (const miles of [0, 1, 7, 99, 412, 1284]) {
        expect(Number.isInteger(convertMiles(miles, u))).toBe(true);
      }
    }
  });

  it("is monotonic — a longer drive never reads shorter", () => {
    const u: Units = "metric";
    let prev = -1;
    for (const miles of [0, 5, 50, 500, 5000]) {
      const km = convertMiles(miles, u);
      expect(km).toBeGreaterThan(prev);
      prev = km;
    }
  });
});
