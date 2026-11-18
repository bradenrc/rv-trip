import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { savedPlace, type SavedPlace } from "@rv-trip/core";
import { PlaceCard } from "@rv-trip/ui";
import { SavesGroups } from "./SavesGroups";

/**
 * #186 i2 · #182 on the web: Near you, the location chip and the four category
 * chips on /places (docs/design/186 §4 · q1 A · q3 A · q4 A · q11 A).
 *
 * The rule (`nearYou`, the copy, the chip's name) is unit tested in core's
 * shelves.test.ts. What is pinned here is the DS addition — PlaceCard's
 * `distance`, rendered to static markup (this vitest has no DOM) — and the
 * library's wiring, read as source. The permission state, the browser's fix
 * and the pixels are the walk's: render-required, see dev-notes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../..");
const library = readFileSync(join(HERE, "PlacesLibrary.tsx"), "utf8");
const page = readFileSync(join(SRC, "app/places/page.tsx"), "utf8");
const workspace = readFileSync(join(HERE, "PlacesWorkspace.tsx"), "utf8");

const save = (extra: Partial<SavedPlace> = {}): SavedPlace =>
  savedPlace.parse({
    id: "s1",
    ownerId: "dev-household",
    place: { name: "Bogus Basin", lat: 43.764, lng: -116.1029, googlePlaceId: null },
    type: "activity",
    rating: null,
    lastChange: null,
    again: null,
    region: "Boise, ID",
    createdAt: "2026-10-01T00:00:00Z",
    ...extra,
  });

const card = (p: SavedPlace, distance?: string) =>
  renderToStaticMarkup(createElement(PlaceCard, { savedPlace: p, distance }));

describe("PlaceCard · distance (the one DS addition)", () => {
  it("prints the distance after the region in the card's mono meta line", () => {
    const html = card(save(), "11 mi");
    expect(html).toMatch(/Boise, ID · 11 mi/);
  });

  it("still prints the distance when the save has no region (vet MED)", () => {
    const html = card(save({ region: null }), "24 mi");
    expect(html).toContain("24 mi");
    expect(html).toMatch(/font-mono[^"]*"[^>]*>(?:<svg[\s\S]*?<\/svg>)?24 mi</);
  });

  it("renders exactly as shipped without one", () => {
    expect(card(save())).not.toContain(" · ");
    // No region and no distance: no meta line (and so no green pin) at all.
    expect(card(save())).toContain("map-pin");
    expect(card(save({ region: null }))).not.toContain("map-pin");
  });
});

describe("SavesGroups · draws a precomputed rest", () => {
  it("renders the shelves it is handed instead of regrouping `places`", () => {
    const a = save({ id: "a", place: { name: "Kept", lat: null, lng: null, googlePlaceId: null } });
    const html = renderToStaticMarkup(
      createElement(SavesGroups, {
        places: [],
        status: "want",
        shelves: { regions: [], unanchored: [a] },
        renderCard: (p: SavedPlace) => createElement("i", { key: p.id }, p.place.name),
      }),
    );
    expect(html).toContain("<i>Kept</i>");
  });
});

describe("PlacesLibrary · Near you and the chips (source)", () => {
  it("calls core's nearYou", () => {
    expect(library).toMatch(/\bnearYou\(/);
  });

  it("draws All · Stay · Eat · Do — no Travel chip (q3 A)", () => {
    const chips = /const CAT_CHIPS[\s\S]*?\];/.exec(library)?.[0] ?? "";
    expect(chips).toContain('"Stay"');
    expect(chips).toContain('"Eat"');
    expect(chips).toContain('"Do"');
    expect(chips).not.toContain("Travel");
  });

  it("reads and writes the chosen chip under rv-places-cat, read after mount in try/catch", () => {
    expect(library).toContain('"rv-places-cat"');
    expect(library).toMatch(/localStorage\.getItem\(CAT_KEY\)/);
    expect(library).toMatch(/localStorage\.setItem\(CAT_KEY/);
    const effect = /useEffect\(\(\) => \{\s*try \{[\s\S]*?localStorage\.getItem\(CAT_KEY\)/.exec(library);
    expect(effect, "the stored chip is read in an effect, inside try").not.toBeNull();
  });

  it("still resets the chip to All on a shelf switch, and stores All", () => {
    const change = /const changeStatus = [\s\S]*?\n  \};/.exec(library)?.[0] ?? "";
    expect(change).toMatch(/pickCat\("All"\)/);
    expect(library).toMatch(/const pickCat = [\s\S]*?setCat\(c\)[\s\S]*?localStorage\.setItem\(CAT_KEY, c\)/);
  });

  it("passes `distance` to the near cards only", () => {
    const uses = [...library.matchAll(/cardFor\(([^)]*)\)/g)].map((m) => m[1]);
    const withDistance = uses.filter((u) => u.includes(","));
    expect(withDistance.length).toBe(1);
    expect(withDistance[0]).toMatch(/^n\.save, /);
    expect(library).toMatch(/near\.map\(\(n\) => cardFor\(n\.save, /);
    // The rest of the grid and the map lens's side list draw distance-less cards.
    expect(library).toMatch(/renderCard = \(p: SavedPlace\) => cardFor\(p\)/);
  });

  it("asks the browser only on a tap, and reads the fix on load only if already granted", () => {
    expect(library).toMatch(/onClick=\{[^}]*locate/);
    expect(library).toMatch(/navigator\.permissions[\s\S]{0,120}query\(\{ name: "geolocation" \}\)/);
    expect(library).toMatch(/state === "granted"/);
    expect(library).toContain("browserPosition");
  });

  it("prints miles in the account's units", () => {
    expect(library).toContain("convertMiles(");
    expect(library).toContain("distanceUnitLabel(");
    expect(page).toContain("getPrefsByOwner");
    expect(page).toContain("unitsFromPrefs(");
    expect(workspace).toMatch(/<PlacesLibrary[\s\S]*?units=\{units\}/);
  });
});
