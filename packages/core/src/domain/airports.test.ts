import { describe, it, expect } from "vitest";
import {
  AIRPORTS,
  instantToLocal,
  localToInstant,
  zoneForAirport,
  zoneNearPoint,
} from "./airports";

/** #104 · Q6 A — the zone comes from the airport code, from a bundled table. */
describe("zoneForAirport", () => {
  it("reads the zone off the code", () => {
    expect(zoneForAirport("LAX")).toBe("America/Los_Angeles");
    expect(zoneForAirport("lir ")).toBe("America/Costa_Rica");
  });

  it("is null for a code the table does not list — the amber chip, not an error", () => {
    expect(zoneForAirport("XYZ")).toBeNull();
    expect(zoneForAirport("")).toBeNull();
  });

  it("lists every airport the seeds fly", () => {
    for (const code of ["BOI", "LAX", "LIR", "DFW", "SEA", "ATH", "JMK", "JNX"]) {
      expect(AIRPORTS[code], code).toBeDefined();
    }
  });
});

describe("zoneNearPoint — a ferry port's zone", () => {
  it("Mykonos → JMK → Europe/Athens", () => {
    expect(zoneNearPoint(37.4467, 25.3289)).toBe("Europe/Athens");
  });

  it("is null in the middle of nowhere rather than a far-off guess", () => {
    expect(zoneNearPoint(-60, -140)).toBeNull();
  });
});

describe("localToInstant / instantToLocal — the ticket's wall clock", () => {
  it("BOI 06:05 on Jan 16 is 13:05Z", () => {
    expect(localToInstant("2027-01-16 06:05", "America/Boise")).toBe("2027-01-16T13:05:00.000Z");
  });

  it("round-trips", () => {
    expect(instantToLocal("2027-01-16T13:05:00.000Z", "America/Boise")).toEqual({
      date: "2027-01-16",
      hhmm: "06:05",
      abbr: "MST",
    });
  });

  it("follows daylight time, and names a zone Intl only numbers (vet MED: EEST, not GMT+3)", () => {
    expect(localToInstant("2027-05-16 10:30", "Europe/Athens")).toBe("2027-05-16T07:30:00.000Z");
    expect(instantToLocal("2027-05-16T07:30:00.000Z", "Europe/Athens").abbr).toBe("EEST");
    expect(instantToLocal("2027-01-16T07:30:00.000Z", "Europe/Athens").abbr).toBe("EET");
    expect(instantToLocal("2027-07-16T07:30:00.000Z", "America/Boise").abbr).toBe("MDT");
  });

  it("the Costa Rica seed's flights read as printed", () => {
    expect(instantToLocal("2027-01-16T15:10:00Z", "America/Los_Angeles")).toMatchObject({ hhmm: "07:10", abbr: "PST" });
    expect(instantToLocal("2027-01-16T23:45:00Z", "America/Costa_Rica")).toMatchObject({ hhmm: "17:45", abbr: "CST" });
  });

  it("is null for something that is not a wall clock, or a zone that is not one", () => {
    expect(localToInstant("Jan 16 6am", "America/Boise")).toBeNull();
    expect(localToInstant("2027-01-16 25:00", "America/Boise")).toBeNull();
    expect(localToInstant("2027-01-16 06:05", "Mars/Olympus")).toBeNull();
  });
});
