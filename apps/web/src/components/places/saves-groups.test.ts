import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { savedPlace, type SaveDestination, type SavedPlace } from "@rv-trip/core";
import { SavesGroups } from "./SavesGroups";

/**
 * #111 i4 · the web library, grouped (docs/design/111 "Web parity", Q4 B): the
 * grid sits under the SAME region and destination headers the phone's Saves
 * tab draws, both computed by core's `savesShelves`.
 *
 * apps/web's vitest is `environment: "node"` with no DOM, so the component is
 * rendered to static markup — enough to read back which headers it drew, in
 * what order, and which cards sit under each. The pixels stay at the walk.
 */
const dest = (name: string, region: string | null): SaveDestination => ({
  id: `d_${name}`,
  name,
  region,
  googlePlaceId: `g_${name}`,
  lat: null,
  lng: null,
});
const BANDON = dest("Bandon, OR", "Oregon");
const BEND = dest("Bend, OR", "Oregon");
const SAN_JOSE = dest("San José, Costa Rica", "Costa Rica");

let n = 0;
function save(
  name: string,
  destination: SaveDestination | null,
  createdAt: string,
  extra: Partial<SavedPlace> = {},
): SavedPlace {
  n += 1;
  return savedPlace.parse({
    id: `s${n}`,
    ownerId: "dev-household",
    place: { name, lat: null, lng: null, googlePlaceId: null },
    type: "other",
    rating: null,
    lastChange: null,
    destination,
    createdAt,
    ...extra,
  });
}

// The web frame's two destinations, plus Costa Rica and one unanchored row.
const PLACES: SavedPlace[] = [
  save("El Chandelier", SAN_JOSE, "2026-09-20T00:00:00Z", { type: "dining" }),
  save("Sunny's Smokehouse", BEND, "2026-05-01T00:00:00Z", { type: "dining" }),
  save("great BLM camp spot", BANDON, "2026-09-25T17:10:04Z", { type: "campground" }),
  save("Kalaloch Campground", null, "2026-06-01T00:00:00Z", { type: "campground" }),
  save("taco truck Dana said", BEND, "2026-08-01T00:00:00Z"),
  save("chandel", BANDON, "2026-09-25T17:12:00Z"),
  save("South Beach State Park", BANDON, "2025-05-26T00:00:00Z", { status: "been", rating: 5 }),
];

const render = (places: SavedPlace[], status: "want" | "been" = "want") =>
  renderToStaticMarkup(
    createElement(SavesGroups, {
      places,
      status,
      renderCard: (p: SavedPlace) => createElement("i", { key: p.id }, p.place.name),
    }),
  );

/** Every header and card, in document order, as `[kind, text]`. */
function outline(html: string): string[] {
  const out: string[] = [];
  const re = /data-shelf="(region|destination|unanchored)"[^>]*>(.*?)<\/|<i>(.*?)<\/i>/g;
  for (const m of html.matchAll(re)) {
    out.push(m[3] !== undefined ? `card ${m[3]}` : `${m[1]} ${m[2]}`);
  }
  return out;
}

describe("SavesGroups — the library under savesShelves headers", () => {
  it("draws region headers, then destination headers with counts, then their cards", () => {
    const html = render(PLACES);
    expect(outline(html)).toEqual([
      "region Oregon",
      "destination Bandon, OR",
      "card chandel",
      "card great BLM camp spot",
      "destination Bend, OR",
      "card taco truck Dana said",
      "card Sunny&#x27;s Smokehouse",
      "region Costa Rica",
      "destination San José, Costa Rica",
      "card El Chandelier",
      "unanchored Unanchored",
      "card Kalaloch Campground",
    ]);
  });

  it("puts each destination's save count beside its name, in mono", () => {
    const html = render(PLACES);
    expect(html).toMatch(/Bandon, OR<\/b><span class="font-mono[^"]*">2<\/span>/);
    expect(html).toMatch(/San José, Costa Rica<\/b><span class="font-mono[^"]*">1<\/span>/);
  });

  it("says what Unanchored means, in the phone's words", () => {
    expect(render(PLACES)).toContain(
      "Unanchored saves have no town within 25 mi. They still <b",
    );
    expect(render(PLACES)).toContain("surface on trips by distance</b>.");
  });

  it("draws only the shelf it was asked for", () => {
    expect(outline(render(PLACES, "been"))).toEqual([
      "region Oregon",
      "destination Bandon, OR",
      "card South Beach State Park",
    ]);
  });

  it("draws no Unanchored group when every save has a destination", () => {
    const html = render(PLACES.filter((p) => p.destination !== null));
    expect(html).not.toContain("Unanchored");
  });
});
