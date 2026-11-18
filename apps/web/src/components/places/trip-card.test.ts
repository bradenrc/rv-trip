import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TripCard as TripCardModel } from "@rv-trip/core";
import { PlacesTripCard } from "./PlacesWorkspace";

/**
 * #186 i4 · #183 on the web: the trip card above the /places library
 * (docs/design/186 §4 · q5 A). Which trip, and every word on the card, is
 * core's `tripCard` + `tripCardLines` (planner/trip-card.test.ts). What is
 * pinned here is the page's server-side wiring, read as source, and the card's
 * markup, rendered to static HTML (this vitest has no DOM).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const page = readFileSync(join(SRC, "app/places/page.tsx"), "utf8");
const workspace = readFileSync(join(HERE, "PlacesWorkspace.tsx"), "utf8");

const render = (card: TripCardModel | null) => renderToStaticMarkup(createElement(PlacesTripCard, { card }));

const ended: TripCardModel = {
  kind: "ended",
  tripId: "trip_bham",
  title: "Bellingham",
  days: 2,
  toRate: 2,
  tab: "journal",
};

describe("/places page · the trip card is computed on the server", () => {
  it("reads the tz cookie, as the landing rule does", () => {
    expect(page).toContain("TZ_COOKIE");
    expect(page).toMatch(/jar\.get\(TZ_COOKIE\)/);
    expect(page).toContain("isoDateInZone(");
  });

  it("swaps the summary list for the trip trees", () => {
    expect(page).not.toContain("listTripsForOwner");
    expect(page).toContain("listTripsWithDestinationsForOwner(owner)");
  });

  it("calls tripCard only when today is known, and hands the card to the island", () => {
    expect(page).toMatch(/today \? tripCard\(trips, today\) : null/);
    expect(page).toMatch(/<PlacesWorkspace[\s\S]*?card=\{card\}/);
  });

  it("keeps the graduate sheet's list to complete trips (visitedOn unchanged)", () => {
    expect(page).toMatch(/\.filter\(\(t\) => t\.status === "complete"\)/);
  });
});

describe("PlacesWorkspace · the trip card", () => {
  it("renders tripCardLines, above the library", () => {
    expect(workspace).toContain("tripCardLines(");
    const at = workspace.indexOf("<PlacesTripCard");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(workspace.indexOf("<PlacesLibrary"));
  });

  it("links to the trip, with the card's surface", () => {
    const html = render(ended);
    expect(html).toContain('href="/trips/trip_bham"');
    for (const c of ["rounded-rv-card", "border-rv-border-hi", "bg-rv-surface", "shadow-rv-sm"]) {
      expect(html).toContain(c);
    }
  });

  it("puts the amber count line on rv-warning, and the cta on rv-green-ink", () => {
    const html = render(ended);
    expect(html).toContain("Bellingham");
    expect(html).toContain("back 2 days");
    expect(html).toMatch(/text-rv-warning[^"]*">2 stays still need a “How was it\?”/);
    expect(html).toMatch(/text-rv-green-ink[^"]*">Journal →/);
  });

  it("puts a non-amber line on rv-ink-muted", () => {
    const html = render({ ...ended, toRate: 0 });
    expect(html).toMatch(/text-rv-ink-muted[^"]*">Finish the journal/);
    expect(html).not.toContain("text-rv-warning");
  });

  it("draws no line for a trip starting soon, and the mono when", () => {
    const html = render({ kind: "starting", tripId: "t", title: "Pacific Northwest Loop", days: 7, tab: "agenda" });
    expect(html).toMatch(/font-mono[^"]*">in 7 days/);
    expect(html).toContain("Agenda →");
    expect(html).not.toContain("text-rv-warning");
  });

  it("renders nothing when there is no card", () => {
    expect(render(null)).toBe("");
  });
});
