# #186 dev notes — i1 · Core: nearYou, the Places category filter and a shared savePoint

Scope: epic item **i1 of 9 only** (#182 core seam · q1 A · q2 A · q3 A). No UI, no schema, no route changes.

## What changed

- `packages/core/src/planner/nearby-saves.ts:49` — the private `pointOf` is lifted and exported as
  `savePoint(s: SavedPlace): LatLng | null` (own place lat/lng, else the area's lat/lng, else null).
  Body unchanged; `nearbySaves` now calls it (`:117`). Behaviour unchanged — the existing
  `nearby-saves.test.ts` passes untouched.
- `packages/core/src/capture/shelves.ts:91-142` — new, beside `savesShelves` (untouched):
  - `type PlacesCategory = "All" | "Stay" | "Eat" | "Do"` and `PLACES_CATEGORIES` (frame order).
  - `nearYou(saves, status, here, cat): { near: { save; mi }[]; rest: SavesShelves; total }`
    (named `NearYou` / `NearYouSave` interfaces, structurally identical to the design's signature).
    Filters by status, then by `categoryOf(save.type).cat === cat` ("All" keeps everything, so Travel
    and Other appear under All only). `here` null ⇒ `near: []`, `rest = savesShelves(filtered, status)`.
    Otherwise near = filtered saves whose `savePoint` is ≤ `NEAR_RADIUS_MI` (50) by
    `haversineMeters / METERS_PER_MILE`, nearest first (name as tie-break); `rest = savesShelves(filtered
    minus near)`. A save with no point is never near. `total` = filtered count. `mi` is raw.
  - Exported through the package index already (`packages/core/src/index.ts:9` re-exports
    `capture/shelves`; `planner/index.ts:60` re-exports `nearby-saves`, so `savePoint` is public too).
- `packages/core/src/capture/shelves.test.ts:216+` — `describe("nearYou — the wireframe's Boise library (#182)")`:
  the wireframe's library (Want 10 = Stay 2/Eat 3/Do 5; Been 7 = Stay 2/Eat 3/Do 2), with coordinates
  chosen so each distance from (43.615, −116.202) lands on the §1 table: Table Rock 2.1, Bogus Basin 11.4,
  The Springs 23.5 (no own coords — measured from its Idaho City area), Barbacoa 1.5, Mountain Home KOA 42.1,
  Ponderosa 90.9 (rest ▸ Idaho ▸ McCall), the taco truck (no point) in `rest.unanchored`; cat "Stay" filters
  both near and rest; chip totals; Travel/Other under All only; `here` null deep-equals `savesShelves`.

## Decisions / flags

- Coordinates in the fixture are realistic but tuned to hit the §1 figures to one decimal; they are test
  data, not product data.
- Vet HIGH (#185 i7 "one rule for every map surface") is not in i1's scope; exporting `savePoint` here is
  what lets i5/i7 pick the area-fallback rule without a copy. Left for those items.
- No render surface changed — nothing for the walk in this item.

## Checks run

- TDD red: `npx vitest run src/capture/shelves.test.ts` (packages/core) before the implementation → `Tests  8 failed | 15 passed (23)`.
- Green: same command after → `Tests  23 passed (23)`.
- Gate: `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`; core `Tests 1518 passed (1518)`,
  web `Tests 543 passed (543)` (the JSON error lines in the web log are the MCP suite's expected-failure call logs).
