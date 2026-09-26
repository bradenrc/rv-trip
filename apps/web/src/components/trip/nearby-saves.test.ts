import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NearbySave, NearbySaves } from "@rv-trip/core";
import { NearbySavesBanner, NearbySavesSheet, nearbyBannerCopy, sheetRows } from "./NearbySaves";

/**
 * #111 i4 · trip surfacing on the web (docs/design/111 "Web parity"): the
 * banner built from the shipped SuggestionBar classes, and the SheetShell
 * review sheet. The numbers are the i3 acceptance fixture's (Astoria + Newport,
 * 50 mi): South Beach 1.9, Fort Stevens 6.2, Beverly Beach 6.2, Nehalem Bay 34,
 * with Cape Lookout 50.3 the one just past.
 *
 * No DOM in this vitest (`environment: "node"`), so the components render to
 * static markup and the copy and state are read back from it.
 */
const item = (
  saveId: string,
  name: string,
  distanceMi: number,
  stop: string,
  extra: Partial<NearbySave> = {},
): NearbySave => ({
  saveId,
  name,
  type: "campground",
  status: "want",
  rating: null,
  source: "Jane & Rick",
  place: { name, lat: 45, lng: -124, googlePlaceId: null },
  nearestStop: { id: `stop_${stop}`, name: stop },
  distanceMi,
  ...extra,
});

const SOUTH_BEACH = item("s1", "South Beach State Park", 1.9, "Newport, OR", {
  status: "been",
  rating: 5,
  source: null,
});
const FORT_STEVENS = item("s2", "Fort Stevens State Park", 6.2, "Astoria, OR");
const BEVERLY = item("s3", "Beverly Beach State Park", 6.2, "Newport, OR");
const NEHALEM = item("s4", "Nehalem Bay State Park", 34, "Astoria, OR");

const AT_50: NearbySaves = {
  radiusMi: 50,
  items: [SOUTH_BEACH, FORT_STEVENS, BEVERLY, NEHALEM],
  beyond: { radiusMi: 100, count: 1, nearestMi: 50.3, nearestName: "Cape Lookout State Park" },
};

const noop = () => {};
const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("the web banner", () => {
  it("reads '{n} of your saves are near this trip' / 'within {r} mi of a stop'", () => {
    expect(nearbyBannerCopy(AT_50)).toEqual({
      title: "4 of your saves are near this trip",
      sub: "within 50 mi of a stop · review",
      dismiss: "Dismiss",
    });
    const html = renderToStaticMarkup(
      createElement(NearbySavesBanner, { nearby: AT_50, onOpen: noop, onDismiss: noop }),
    );
    expect(text(html)).toContain("4 of your saves are near this trip");
    expect(text(html)).toContain("within 50 mi of a stop · review");
    expect(text(html)).toContain("Dismiss");
  });

  it("follows the trip's radius", () => {
    expect(nearbyBannerCopy({ ...AT_50, radiusMi: 100 }).sub).toBe("within 100 mi of a stop · review");
  });

  it("is the shipped SuggestionBar: rv-info border and soft fill, Sparkles in info-ink, mono faded Dismiss", () => {
    const html = renderToStaticMarkup(
      createElement(NearbySavesBanner, { nearby: AT_50, onOpen: noop, onDismiss: noop }),
    );
    expect(html).toContain("border-rv-info bg-rv-info-soft");
    expect(html).toMatch(/lucide-sparkles[^"]*text-rv-info-ink|text-rv-info-ink[^"]*lucide-sparkles/);
    expect(html).toMatch(/font-mono text-\[11px\] text-rv-ink-faded[^>]*>Dismiss/);
  });

  it("draws nothing when no save is near", () => {
    const html = renderToStaticMarkup(
      createElement(NearbySavesBanner, {
        nearby: { radiusMi: 50, items: [], beyond: null },
        onOpen: noop,
        onDismiss: noop,
      }),
    );
    expect(html).toBe("");
  });
});

describe("the review sheet", () => {
  const sheet = (added: string[] = [], nearby: NearbySaves = AT_50) =>
    renderToStaticMarkup(
      createElement(NearbySavesSheet, {
        tripTitle: "Oregon Coast, summer '27",
        nearby,
        rows: sheetRows(nearby.items, []),
        added: new Set(added),
        onAdd: noop,
        onAddAll: noop,
        onRadius: noop,
        onClose: noop,
      }),
    );

  it("heads 'Near this trip' with the count, and presses the trip's chip", () => {
    const html = sheet();
    expect(text(html)).toContain("Near this trip");
    expect(text(html)).toContain("4 saves");
    expect(html).toMatch(/aria-pressed="true"[^>]*>50 mi</);
    for (const r of [25, 100, 200]) expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*>${r} mi<`));
  });

  it("lists the rows nearest first, each line distance · nearest stop · who", () => {
    const t = text(sheet());
    const order = ["South Beach", "Fort Stevens", "Beverly Beach", "Nehalem Bay"].map((n) => t.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(t).toContain("1.9 mi · Newport, OR · Been");
    expect(t).toContain("6.2 mi · Astoria, OR · Jane & Rick");
    expect(t).toContain("34 mi · Astoria, OR · Jane & Rick");
  });

  it("says what is just past the radius", () => {
    expect(text(sheet())).toContain(
      "1 more just past 50 mi, the nearest at 50.3 mi (Cape Lookout State Park). Tap 100 mi.",
    );
  });

  it("marks an added row '✓ Idea' and counts only what is left in Add all", () => {
    const html = sheet(["s1", "s2"]);
    expect((text(html).match(/✓ Idea/g) ?? []).length).toBe(2);
    expect((html.match(/>Add<\/button>/g) ?? []).length).toBe(2);
    expect(text(html)).toContain("Add all 2 to ideas");
  });
});

describe("sheetRows", () => {
  it("keeps a row added in this sheet after a refetch drops it (it is on the trip now)", () => {
    const rows = sheetRows([FORT_STEVENS, NEHALEM], [SOUTH_BEACH, BEVERLY]);
    expect(rows.map((r) => r.saveId)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("does not double a row the fresh answer still carries", () => {
    expect(sheetRows([SOUTH_BEACH, FORT_STEVENS], [SOUTH_BEACH]).map((r) => r.saveId)).toEqual([
      "s1",
      "s2",
    ]);
  });
});
