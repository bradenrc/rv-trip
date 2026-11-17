import { describe, expect, it } from "vitest";
import type { Trip } from "../domain/types";
import { TRIP_TABS, TRIP_TAB_LABEL, defaultTripTab } from "./trip-tab";

/** #177 · #181 i1 — the wireframe's §1 table, row for row. */

type TabTrip = Pick<Trip, "id" | "startDate" | "endDate" | "status">;
const loop = (status: Trip["status"]): TabTrip => ({
  id: "pnw-loop",
  startDate: "2026-08-01",
  endDate: "2026-08-28",
  status,
});
const bellingham = (status: Trip["status"]): TabTrip => ({
  id: "bellingham",
  startDate: "2026-11-11",
  endDate: "2026-11-15",
  status,
});

describe("defaultTripTab (#177 · the tab a trip opens on)", () => {
  it("Pacific NW Loop on Jul 20, planning → Agenda", () => {
    expect(defaultTripTab(loop("upcoming"), "2026-07-20")).toBe("agenda");
  });

  it("Pacific NW Loop on Aug 7, its dates cover today → Journal", () => {
    expect(defaultTripTab(loop("upcoming"), "2026-08-07")).toBe("journal");
    expect(defaultTripTab(loop("planning"), "2026-08-07")).toBe("journal");
  });

  it("covers today inclusive at both ends", () => {
    expect(defaultTripTab(loop("upcoming"), "2026-08-01")).toBe("journal");
    expect(defaultTripTab(loop("upcoming"), "2026-08-28")).toBe("journal");
    expect(defaultTripTab(loop("upcoming"), "2026-07-31")).toBe("agenda");
  });

  it("Pacific NW Loop on Aug 29, complete → Journal", () => {
    expect(defaultTripTab(loop("complete"), "2026-08-29")).toBe("journal");
  });

  it("Bellingham pinned complete on Nov 14 → Journal (the dates decide)", () => {
    expect(defaultTripTab(bellingham("complete"), "2026-11-14")).toBe("journal");
  });

  it("Bellingham on Nov 3, planning → Agenda", () => {
    expect(defaultTripTab(bellingham("upcoming"), "2026-11-03")).toBe("agenda");
  });

  it("with today null (no tz cookie yet), the status rule alone", () => {
    expect(defaultTripTab(loop("complete"), null)).toBe("journal");
    expect(defaultTripTab(bellingham("complete"), null)).toBe("journal");
    expect(defaultTripTab(loop("upcoming"), null)).toBe("agenda");
    expect(defaultTripTab(loop("planning"), null)).toBe("agenda");
  });
});

describe("TRIP_TABS · TRIP_TAB_LABEL", () => {
  it("is Journal · Agenda · Ideas, in that order", () => {
    expect(TRIP_TABS).toEqual(["journal", "agenda", "ideas"]);
    expect(TRIP_TABS.map((t) => TRIP_TAB_LABEL[t])).toEqual(["Journal", "Agenda", "Ideas"]);
  });
});
