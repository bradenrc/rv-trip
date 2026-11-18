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

---

# i2 · Near you, the location chip and the category chips on both Places screens

Scope: epic item **i2 of 9 only** (#182 renders · q1 A · q3 A · q4 A · q11 A). No schema, no route, no trip card (i4), no map panel (i7).

## What changed

- **Core copy helpers** in `packages/core/src/capture/shelves.ts:142-174`, so both clients say the same thing: `isPlacesCategory` (narrows the stored `rv-places-cat`; a stale "Travel" is ignored), `nearYouName(near, resolved)` (the area of the nearest near save, else the resolved locality, else null, in which case the chip reads "Near you"), `placesCategoryEmpty` ("No eat places on Want to go yet."), `nearYouWithin` ("within 50 mi[ of Boise]") and `nearYouNothing` ("Nothing on this shelf within 50 mi of Boise."). Tests are in `shelves.test.ts` (the last 4 `it`s of the Boise describe).
- **DS** `packages/ui/src/Places.tsx:56-62,117-120`: `PlaceCard` gains optional `distance?: string`. The mono meta line now renders when **region or distance** is present (vet MED) and prints `region · distance`. With no `distance` the card is unchanged. `.design-sync/previews/PlaceCard.tsx` gains a `NearYou` story.
- **Phone** `apps/mobile/src/ui.tsx:240`: a new `FilterChip` mirrors the DS one. Active is `C.navy` with `C.ink`; idle is `C.surface`/`C.border`/`C.inkMuted`; the category glyph is in `categoryOf(type).color` and the count is mono, at the wireframe's `.fchip` metrics.
- **Phone** `apps/mobile/app/(tabs)/saves.tsx`:
  - `CAT_KEY "rv-places-cat"` :28. Read from AsyncStorage on mount; `pickCat` writes it.
  - `changeShelf` :76 resets the chip to All and writes All.
  - `LocationChip` :185 sits right of the title (`titleRow`). It shows "Near <name>" with a `C.green` ⌖, or a dashed `C.borderHi` "Set location". Only the unfixed chip has an `onPress`.
  - `CategoryChips` :203 is the All · Stay · Eat · Do row under ShelfSwitch. Counts are `nearYou(..., null, c).total` and the row is hidden when the library is empty.
  - `Shelf` :234 renders `nearYou`. With a fix it shows the "Near you" heading plus "within 50 mi", then the rows with mono `<n> mi` (or the dashed nothing-near line), then "Everywhere else" and the shipped groups (`Groups` :275) of `rest`. With no fix it shows exactly today's list. An empty filtered shelf shows the dashed per-chip line.
  - `useHere` :342 calls `getForegroundPermissionsAsync` on focus, then `getLastKnownPositionAsync` only if granted. `requestForegroundPermissionsAsync` is called only in `ask`, which only the chip's onPress receives.
  - `useResolvedName` :382 calls `api.areas.resolve`, and only when no near save names an area.
- **Web** `apps/web/src/components/places/PlacesLibrary.tsx`:
  - `CAT_KEY` :52. `CAT_CHIPS` :58 is Stay/Eat/Do (Travel dropped).
  - `pickCat` :131 writes localStorage in try/catch, and the stored value is read in a mount effect in try/catch.
  - `locate` :140 calls `browserPosition` on the chip's tap. `navigator.permissions.query({name:"geolocation"})` :147 reads the fix on mount only when the state is "granted".
  - `split = nearYou(...)` :174. `changeStatus` :212 resets via `pickCat("All")`.
  - `cardFor(p, distance?)` :222. Only `split.near.map((n) => cardFor(n.save, miles(n.mi)))` passes a distance.
  - The location chip :262-280 sits in the SegmentedControl row.
  - The "Near you · within 50 mi of <name>" block comes before `SavesGroups`, which now draws `split.rest`. The dashed per-chip empty box is at :368, and EmptyShelf is unchanged for an empty shelf.
  - Distances use `convertMiles` + `distanceUnitLabel` with a `units` prop.
- **Web plumbing:**
  - `SavesGroups.tsx:24-32` takes an optional `shelves`. Without it, behaviour is unchanged.
  - `PlacesWorkspace` passes `units` through.
  - `app/places/page.tsx:2,10,25-27,41` reads `getPrefsByOwner` → `unitsFromPrefs`, as map/page.tsx does. `listTripsForOwner` is left alone; the swap is i4's.
- **Tests:**
  - New `packages/core/src/mobile-places.test.ts` reads saves.tsx and ui.tsx as source, per the acceptance criteria.
  - New `apps/web/src/components/places/near-you.test.ts`: PlaceCard `distance` checked through renderToStaticMarkup (with region, without region, absent); SavesGroups `shelves`; and source reads of PlacesLibrary, page and workspace.
  - Updated `mobile-capture.test.ts:126`: the old `savesShelves(saves, status)` assertion now expects `nearYou(saves, status, here, cat)`, because the shelf is grouped through nearYou and its `rest` is savesShelves.

## Decisions / defaults (flag for the walk)

- **Phone glyphs.** The mobile kit has no icon set, so the chip's pin is `⌖` (already used in capture.tsx and map.tsx) and the FilterChip category glyph is a coloured `●`. The wireframe draws SVG icons.
- **Tap fallback.** On the tap path only, if `getLastKnownPositionAsync` returns null (a fresh simulator), `getCurrentPositionAsync` is tried. The tap is consent, and without this the chip would do nothing after a grant. The focus path never does this.
- **Chip name.** It reads the active shelf's **All** near list, so it doesn't change when a category chip is picked.
- **"Everywhere else"** is drawn only when something remains in `rest`, so no heading is left with nothing under it.
- **Web distance units.** Distances follow the account's units (`11 mi` / `18 km`). The radius copy is always "50 mi" (from core `nearYouWithin`), and that keeps settings-page.test's "no hard-coded mi in apps/web" sweep green. The phone prints `mi` (DEFAULT_UNITS, per design §8).
- **Lint exception.** One `eslint-disable-next-line react-hooks/set-state-in-effect` at the mount-time localStorage read in PlacesLibrary. The design requires an after-mount read (hydration-safe), and it is a single set.
- **Out of scope.** Below md the map lens's side list stays a flat card list with no Near you split; the md+ panel is i7.

## Render-required (walk)

- **Phone:** with no permission, open the tab: no prompt, the chip reads "Set location". Tap it: the OS prompt appears, and on grant the chip reads "Near <area>". On a fresh simulator this depends on the getCurrent fallback above.
- **Web:** check the `navigator.permissions` auto-read after a grant, and the browser prompt on the "Set location" tap.
- **Both:** the stored chip should survive a reload or relaunch, and a shelf switch should reset it to All.

## Checks run

- TDD red (core): `npx vitest run src/capture/shelves.test.ts` with the new tests and no implementation → `Tests 4 failed | 23 passed (27)`. Green afterwards → `27 passed`.
- The web and mobile source tests were written before the code but were **not** run red first. They were run after implementing: `npx vitest run src/mobile-places.test.ts src/mobile-capture.test.ts` → `40 passed`; `npx vitest run src/components/places/near-you.test.ts` → `11 passed`.
- Gate: `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`; core `Tests 1533 passed`, web `Tests 554 passed`, ui `Tests 55 passed`. The first run failed on the web lint rule and on the hard-coded "mi" sweep; both are fixed as described above.

---

# i3 · Core: tripCard and its lines

Scope: epic item **i3 of 9 only** (#183 core seam · q5 A). Core only. No UI, no schema, no route changes. The renders are i4.

## What changed

- **New** `packages/core/src/planner/trip-card.ts`:
  - `TripCard` :19 is the three-kind union, exactly as the wireframe names it.
  - `TRIP_CARD_WINDOW_DAYS = 7` :25.
  - `staysToRate` :28 counts `unratedOf` rows across all of the trip's destinations, keeping `categoryOf(r.type).cat === "Stay"` only.
  - `closest` :36 picks the trip 1–7 days away with the fewest days. A tie keeps input order, and an undated trip is skipped.
  - `tripCard(trips, today)` :47 checks now → starting → ended.
    - now uses `activeTrip`, with `day = daysUntil(today, start) + 1` and `of = daysUntil(end, start) + 1`.
    - starting uses `daysUntil(startDate, today)`.
    - ended uses `daysUntil(today, endDate)` and is kept even when `toRate` is 0.
    - `tab` comes from `defaultTripTab(trip, today)`.
  - `tripCardLines(card)` :82 returns the "in N day(s)", "day D of N" and "back N day(s)" wording.
    - On ended only: when toRate > 0 the line is "<n> stay still needs / stays still need a “How was it?”" with amber true. Otherwise it is "Finish the journal" with amber false.
    - `cta = TRIP_TAB_LABEL[tab] + " →"`.
- `packages/core/src/planner/journal.ts:433`: `unratedOf` is now exported, with no body change. The Stay-only filter lives in trip-card.ts, so the Journal's "How was it?" count is unchanged.
- `packages/core/src/planner/index.ts:76` re-exports `./trip-card`.
- **New** `packages/core/src/planner/trip-card.test.ts` has 14 tests:
  - Every row of the §1 #183 table: Jul 24 null; Jul 25 starting 7, Agenda →; Aug 7 now 7 of 28, Journal →; Sep 4 ended 7, "1 stay still needs…"; Sep 5 null; Nov 10 Bellingham in 1 day beats McCall (back 2 days); Nov 17 ended 2, toRate 2, amber; Nov 17 both rated → "Finish the journal", amber false; Sep 20 null.
  - Also: an unrated Eat reservation not counted, now beating starting and ended, closest-wins on both sides, singular "back 1 day", and no trips.

## Decisions / flags

- **Ended trips are `complete` in the fixture.** `defaultTripTab` opens Journal on an ended trip only when `status === "complete"`. The table's ended CTAs are "Journal →", which holds when status is derived: `deriveTripStatus` reads an ended auto trip as complete. An ended trip with a **pinned** non-complete status (like the PNW seed, `statusAuto:false, "planning"`) would show "Agenda →". That is correct per the spec ("tab = defaultTripTab"), but i4 must pass trips whose `status` is already derived (server rows are), or the CTA will differ from the table.
- **Name collision note for i4.** The web already has a React component `apps/web/src/components/dashboard/TripCard.tsx`. Core's `TripCard` is a type, so nothing clashes today, but any file that imports both should alias one of them.
- `tripCard` takes `readonly Trip[]`, which `Trip[]` satisfies.
- No render surface changed, so there is nothing for the walk in this item.

## Checks run

- TDD red: `npx vitest run src/planner/trip-card.test.ts` (packages/core) before the module existed → `Test Files 1 failed (1)` (import unresolved).
- Green: same command after → `Tests 14 passed (14)`.
- Gate: `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`; core `Tests 1547 passed (1547)`, web `Tests 554 passed (554)`, ui `Tests 55 passed (55)`. A first gate run hung in the web vitest worker (0 CPU for over 20 min, no output). I killed only that run's own PIDs, re-ran, and it went green.

---

# i4 · The trip card on both Places screens, and full trips for the phone

Scope: epic item **i4 of 9 only** (#183 renders · q5 A). No schema or migration. No Map tab: that is a later item, so "reloaded on Map focus" has nowhere to land yet. `tripsNear` (#160) is i8/i9.

## What changed

- **Route** `apps/web/src/app/api/trips/route.ts:11-17`. `GET(req)` checks `?tree=1` and, when set, returns `listTripsWithDestinationsForOwner(owner)` (`Trip[]`, status already derived). Without it, the route returns the `TripSummary[]` as before. It stays owner-scoped through `getOwner()`.
- **api-client** `packages/core/src/api-client/index.ts:149,275`. Adds `trips.trees(): Promise<Trip[]>`, which calls GET `/api/trips?tree=1` and parses the result with `tripSchema.array()`.
- **Phone store** `apps/mobile/src/store.ts`:
  - `State.trees` at :64.
  - `loadTripTrees` at :292. On failure it keeps the last list, so offline the card draws from what was already loaded.
  - `useTripTrees()` at :303 loads once when the cache is empty and returns `{ trees, error, reload }`.
- **Phone Places** `apps/mobile/app/(tabs)/saves.tsx`:
  - :73-74 computes `card = tripCard(trees ?? [], localIsoDate())`.
  - The focus effect at :110 also runs `reloadTrees()`.
  - `{card && <TripCardRow …/>}` at :153 sits after the queue toast and above `ShelfSwitch`.
  - `TripCardRow` at :168 is a `Pressable` that calls `router.push(`/trips/${card.tripId}`)`. It shows a bold title, then ` · ` and the mono `when`. The line under it is `C.warning` when amber, otherwise `C.inkMuted`. The cta is `C.greenInk`.
  - The styles at :512 follow the wireframe's `.tcard` values: `C.surface`, `C.borderHi`, `R.card`, padding 9/11, gap 10, and the shadow-rv-sm values copied from ui.tsx's `segmentOn`.
- **Web page** `apps/web/src/app/places/page.tsx`:
  - :7,23 swaps `listTripsForOwner` for `listTripsWithDestinationsForOwner`. `visitedOn` is unchanged: complete trips only, `{id,title}`.
  - :10,38-40 reads `TZ_COOKIE` the way `app/page.tsx` does, then computes `isoDateInZone` → `card = today ? tripCard(trips, today) : null`.
  - :54 passes `card` to the island. Only the card crosses into it; the tree does not.
- **Web island** `apps/web/src/components/places/PlacesWorkspace.tsx`:
  - New `card` prop at :58.
  - `<PlacesTripCard card={card} />` at :273 sits right under the header row, above the SuggestionBar and PlacesLibrary. That matches the wireframe, where `.tcard` follows `.wtop` directly.
  - `PlacesTripCard` at :337 is exported. It is a `next/link` to `/trips/<id>` with `rounded-rv-card border border-rv-border-hi bg-rv-surface shadow-rv-sm` and `max-w-[520px]`, plus the wireframe's padding and type sizes. The title is `text-rv-ink`, followed by the mono `when` in `text-rv-ink-muted`. The line is `text-rv-warning` when amber, otherwise `text-rv-ink-muted`. The cta is `text-rv-green-ink`. With a null card it renders nothing and takes no space.
  - Core's `TripCard` type is imported as `TripCardModel`, so it can't be confused with the dashboard's `TripCard` component (i3's flag).
- **Tests**:
  - `apps/web/src/app/api/trips/route.test.ts`:
    - A new `describeDb("GET /api/trips?tree=1 …")` checks that `?tree=1` parses as `tripSchema[]` with chapters → destinations and derived `complete`, and that a plain GET still parses as summaries (where `chapters` is a number).
    - The two existing `GET()` calls now pass `list()`, a GET `Request`.
  - `packages/core/src/api-client/api-client.test.ts:46`: `trees()` hits `/api/trips?tree=1`, and a summary row in its place throws `ZodError`.
  - New `apps/web/src/components/places/trip-card.test.ts`:
    - Source reads of page.tsx: it reads TZ_COOKIE, has no `listTripsForOwner`, calls `today ? tripCard(trips, today) : null`, and passes `card={card}`.
    - Source reads of the workspace: `tripCardLines(` is present and `<PlacesTripCard` comes before `<PlacesLibrary`.
    - `PlacesTripCard` rendered with renderToStaticMarkup: the href, the surface classes, the amber line on `text-rv-warning`, the non-amber line on `text-rv-ink-muted`, the starting kind with no line, and null rendering `""`.
  - `packages/core/src/mobile-places.test.ts:111+`: a describe that reads the store and saves.tsx as source. It checks `api.trips.trees()`, `useTripTrees`, `tripCard(trees ?? [], localIsoDate())`, `tripCardLines(`, `reloadTrees()` in the focus effect, the card placed before `<ShelfSwitch value`, the `/trips/${card.tripId}` push, the `C.warning`/`C.inkMuted`/`C.greenInk` roles and the card surface style.

## Decisions / flags (for qa and the walk)

- **Where the phone card sits.** It goes after the amber queue toast and before ShelfSwitch. The wireframe shows no toast, and the toast is the shipped "always on top" line.
- **Web `GET(req)` is now required.** Existing callers in tests were updated. Other test files import only `POST` from this route.
- **Status on the card's CTA.** Both server paths hand `tripCard` rows with derived status (`mapTripRow(r, todayIso())`). That covers i3's flag that a pinned non-complete trip reads "Agenda →". For the PNW seed (pinned "planning") an ended card will say "Agenda →". That is per the spec.
- **Server "today" vs the trees' derived status.** The card's today comes from the tz cookie. Status is derived from the server's `todayIso()` (UTC), so a trip that ended "yesterday" near midnight could differ by one day on the CTA. This is the landing rule's existing precedent, and I made no change for it.
- **Render-required (walk):**
  - Web: with the tz cookie set and a trip within the 7-day window, the card shows above the shelf and clicking it opens the trip. On the first load with no cookie there is no card.
  - Phone: the card shows above the switch, tapping it pushes the trip, and it refreshes on refocus after a trip edit.

## Checks run

- **TDD red:**
  - `npx vitest run src/api-client/api-client.test.ts` (core) → `Tests 1 failed | 31 passed (32)`. Green after: `32 passed`.
  - `npx vitest run src/components/places/trip-card.test.ts` (web) → 9 failed before page/workspace changes. Green after: `Tests 10 passed (10)`.
  - `npx vitest run src/mobile-places.test.ts` (core) → `Tests 4 failed | 12 passed (16)`. The store assertion already passed because the store was written first. Green after: `16 passed`.
- **Route test:** written before the handler change but **not run red first**. After the change: `npx vitest run src/app/api/trips/route.test.ts` → `Tests 9 passed (9)`. The first run failed on my own test using `d.placeName`; I fixed it to `d.place.name`.
- **Gate:** `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`; core `Tests 1553 passed`, web `Tests 566 passed`, ui `Tests 55 passed`. This includes `@rv-trip/mobile:typecheck` and `@rv-trip/web:lint`.

---

# i5 · Core: the library map and its filter

Scope: epic item **i5 of 9 only** (#184 core seam · q6 A · q7 A · q8 A). No UI, no schema, no route. Nothing renders it yet; i6 (phone Map tab, web /map filters) and i7 (web Places map panel) consume it.

## What changed

- **New** `packages/core/src/planner/library-map.ts`:
  - `LibraryFilter` :20 — `all | been | want | trip(tripId)`.
  - `destinationBeen(trip, destination, today)` :27 — `trip.status === "complete"`, or `today !== null && departDate !== null && departDate < today`. Departing today is not been yet. Takes `Pick<Trip,"status">` / `Pick<Destination,"departDate">`, per the wireframe's signature.
  - `libraryFilterKeeps(f, { been, tripId })` :38 — all → true, been → been, want → !been, trip → tripId === f.tripId.
  - `libraryMap(trips, saves, today, f)` :79 — destinations come from `tripDestinationPins` (map-pins.ts:68), so `ordinal` = the trip's `scheduledOrder` and coordless destinations are dropped. Each carries `tripId` = its trip's id and `been` = `destinationBeen`. Saves are pinned at `savePoint` (i1). `been` = `status === "been"`, `tripId` = `SavedPlace.tripId`, `category` = `categoryOf(type).cat`. Both lists go through `libraryFilterKeeps`. `unmapped` counts the saves the filter keeps that have no point.
  - `libraryTrips(trips)` :142 — trips with at least one mapped destination, newest `startDate` first, as `{ id, title, dates: "08/01 – 08/28", destinations: <mapped count> }`. The date line follows the wireframe's phone chooser sheet ("11/11 – 11/15 · 1 destination"). The " · N destinations" suffix is left to the renderer.
- `packages/core/src/planner/index.ts:77-78` re-exports it, so it is available as `@rv-trip/core/planner` and from the root.
- **New** `packages/core/src/planner/library-map.test.ts` (15 tests) covers the §1 #184 table:
  - On Nov 17 every Loop and Bellingham destination is been.
  - On Aug 7 Astoria (departs Aug 5) is been and Newport (departs Aug 9) is not. Edge rows check null today, null departDate, and departing today.
  - Been keeps the KOA save and drops Deschutes. Want does the reverse.
  - trip(Loop) keeps the Loop's three destinations and its three visited saves (KOA, Fort George, Aquarium). Aslan, a Bellingham save, is dropped.
  - The taco truck (no point) is only ever counted in `unmapped`.
  - `libraryTrips` lists Bellingham before the Loop and leaves out an unmapped trip.
  - A source-reading test checks that library-map.ts has no `routeTrip`, `fetch(`, `providers/`, `routing` or `api-client`.
  - The fixture is `pnwTrip()` without Crater Lake. That gives the wireframe's "3 destinations", and Crater is floating and undated anyway.

## Decisions (vet findings resolved here)

- **Vet HIGH (one point rule for every map surface):** I chose the **area fallback**. `libraryMap` pins a save at `savePoint`, the same point Near you measures from. So an area-only save such as The Springs or the Deschutes fixture is a pin, not unmapped. To keep web /map and the Places panel consistent with this, i6/i7 need to make `buildMapModel`'s place pins (apps/web/src/components/map/pins.ts:377-380) use `savePoint` as well, or read `libraryMap`. That is outside i5's scope. Flagged for those items.
- **Vet MED (type home):** `category` is core's `RvCategory` (theme/tokens.ts:68), not ui's `CategoryLabel`. Core cannot import ui. This matches the phone's `TripMapEntry.category`.
- **Vet MED (web PlacePin has no tripId):** `libraryMap`'s save pins carry `tripId`. The web `PlacePin` change belongs to i6.
- Under **Want to go**, a complete trip shows no destinations, because all of its stops are been. This follows directly from q7 A.

## Checks run

- TDD red: `npx vitest run src/planner/library-map.test.ts` (packages/core) before the module existed → `Test Files 1 failed (1)` (import failure, no tests collected).
- Green: same command after → `Tests 15 passed (15)`.
- Gate: `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`; core `Tests 1568 passed (1568)`, web `Tests 566 passed (566)`, ui `Tests 55 passed (55)`. The stack-trace lines in the web log come from expected-failure suites, and the web suite passed.
- No render surface changed, so there is nothing to walk for this item.

---

# i6 · The phone Map tab, and the four filters on web /map

Scope: epic item **i6 of 9 only** (#184 renders · q6 A · q7 A · q8 A · q11 A). No schema, no route handler, no DS change.

Provenance: when this dispatch started, the worktree already held **uncommitted** i6 work from an earlier attempt that did not finish: the web side, `_layout.tsx`, `src/map.tsx`, and both source-reading test files. There was no `app/(tabs)/map.tsx`. I reviewed that work and kept it. I then wrote the missing phone screen, added one fallback rule on both clients, updated a stale guard test, and ran the gate.

## What changed

### Phone
- `apps/mobile/app/(tabs)/_layout.tsx:145-151`: `<Tabs.Screen name="map">` titled "Map" with the `◎` Text glyph, between `add` (Capture) and `you`.
- **New** `apps/mobile/app/(tabs)/map.tsx`:
  - `MapTab` :40 is a full-bleed `TripMap` fed by `libraryMap(trees ?? [], saves ?? [], today, filter)` :69 (`useTripTrees()`, `useSaves()`, `localIsoDate()`). Destinations become `TripMapPin` with `been`. Saves become `TripMapEntry` with `category` and `been`. It draws **no arcs**, and the file imports no routing module.
  - `MapFrame state="loading"` shows until the trees, the saves and the style preference have all loaded. "Unavailable" and "empty" are `TripMap`'s own shipped frames.
  - Four chips over the canvas (`MapChip` :198, the design's `.mchip`): All · Been there · Want to go · One trip. Active is `C.navy` with `C.ink` text and a transparent border. Idle is `C.surfaceAlt` / `C.borderHi` / `C.inkMuted`.
  - One trip opens a `<Modal>` bottom sheet :165, "Show one trip". It lists `libraryTrips` as the title plus a mono line `{t.dates} · {destinationsLabel(t.destinations)}`. Once a trip is picked, the chip reads `title + " ▾"`.
  - Tapping a pin selects it. Tapping the same pin again, or the map (`onPressMap`), clears it. Changing the filter also clears it.
  - A save's card shows `CategoryTile` (26), the name, "Been there"/"Want to go" + `tripName`, and `Stars` (10) when rated. It has no arrow.
  - A destination's card shows the name and `destLine` :19 ("<trip> · stop <n>" + " · been"), and "Trip →". Tapping the card pushes `/trips/<tripId>`.
  - With nothing selected, the design's `.mhint` "N pins · tap one" sits bottom-left.
- `apps/mobile/src/map.tsx`:
  - `TripMapEntry.been?: boolean` :348. Its render :499: been draws a ring in the category colour on `palette.hollowGround`. Otherwise it draws the shipped filled disc.
  - New optional `onPressMap` :388 / :444 so the tab can clear its card.

### Web /map
- `apps/web/src/components/map/pins.ts`:
  - `DestinationPin.been` comes from core's `destinationBeen` :350.
  - `PlacePin.tripId` :452 (vet MED).
  - Place pins are placed at core's `savePoint` :425. This resolves the **vet HIGH** with one point rule for every map surface: area-only saves are pins on /map, on the phone, and in Near you.
  - `DriveArc.tripId` and `UnmappedRow.been/tripId`.
  - New `filterFacts` :465, `filterCounts` :473 and `arcKept` :488. Arcs show under All, Want to go and One trip (that trip's only), never under Been there.
  - `LAYER_ORDER` and `layerCounts` are removed. `MapLayer`/`LAYER_LABEL` stay for the rail's meta and the arc paint.
- `apps/web/src/components/map/MapOverview.tsx`:
  - The layer chips are replaced by four single-select `FilterChip`s, defaulting to All. Each chip's count is the number of pins it keeps.
  - One trip is a `FilterChip` inside the shipped `components/ui/dropdown-menu` :188 listing `libraryTrips` :100. After a pick it reads `title + " ▾"`.
  - Pins and unmapped rows go through `libraryFilterKeeps`. The category row and the legend are unchanged.
  - The empty-rail copy is now "Nothing on the map under this filter." The old copy ("Every layer is switched off.") described the removed toggles.
- `apps/web/src/components/map/MapView.tsx:424`: `DestinationDisc` reads `pin.been`. `PlaceDrop` is unchanged: filled = want.
- `apps/web/src/app/map/page.tsx:35,75` reads the `tz` cookie (`isoDateInZone`) and passes `today`. With no cookie, only a complete trip's stops are been.
- `DestinationMiniMap.tsx` and `trip/JournalMap.tsx` set the now-required `been` on the `DestinationPin`s they build. Behaviour is unchanged.

### Tests
- **New** `packages/core/src/mobile-library-map.test.ts` (10, source-reading, comments stripped):
  - The tab order is `(trips) · saves · add · map · you`, with the Map title and glyph.
  - map.tsx calls `libraryMap(...)`/`libraryTrips(`, renders `<TripMap`/`<MapFrame`, has no `arcs=`/`tripArcs`, and contains no `routing|routeTrip|api.routes|fetch(`.
  - The chip colour roles, the sheet and the card copy.
  - `TripMapEntry.been` and its ring on hollowGround.
- **New** `apps/web/src/components/map/map-filters.test.ts` (9, source-reading):
  - No `LAYER_ORDER`, `libraryFilterKeeps(`/`arcKept(`/`filterCounts(`, and the dropdown-menu import.
  - The category row and the legend are kept.
  - `DestinationDisc` reads `pin.been`. `PlaceDrop` is still filled for want.
  - page.tsx reads `TZ_COOKIE`.
- `apps/web/src/components/map/pins.test.ts`: new "the four filters (#186 i6)" describe (7 tests). It covers:
  - a trip in progress (Aug 7: Astoria been, the rest not), complete versus no today;
  - tripId and the savePoint area fallback, with a save that has no point going to unmapped;
  - arc tripId, `filterFacts` per pin kind, `filterCounts`, and `arcKept`.
  - Two old `layerCounts` assertions were rewritten as plain counts.
- `packages/core/src/mobile-capture.test.ts:41-58`: the #173 guard `not.toContain('name="map"')` ("Map is TL4's (#186)") was a placeholder for this item. It now asserts Trips · Places · Capture · **Map** · You and the Map title.

## Decisions / flags (for qa and the walk)

- **Vet HIGH resolved by the area-fallback rule.** `buildMapModel` place pins use `savePoint`, as `libraryMap` does, so web /map and the phone show the same pin count for the same library. i7's panel inherits this rule automatically if it calls `buildMapModel`.
- **Stale One trip falls back to All** on both clients. This applies when the picked trip leaves `libraryTrips` (deleted, or its last mapped destination removed). Without the fallback, no chip would read active and nothing would be kept.
- **Floating destination card.** It reads "<trip> · floating" because there is no stop number. The design only shows a scheduled stop, so I picked this wording, following the web rail's "floating" grammar.
- **No style pill on the Map tab.** The wireframe shows none, and it would collide with the chip row. The tab follows the stored Night/Day/Sat preference.
- **Phone chips show no counts.** The wireframe's `.mchip` has none, unlike web's FilterChip, which shows counts as the task specifies.
- **Render-required at walk (dev-client build only; Expo Go shows MapFrame "unavailable"):**
  - The ring versus filled rendering of entries.
  - Hollow destination discs.
  - Pin tap, plus re-tap or map tap to clear. This assumes Mapbox's `MapView.onPress` does not also fire on a `MarkerView` press. If it does, a pin tap would select and then clear at once, so check this first.
  - The One trip sheet and the "Trip →" push.
- **Render-required at walk (web):**
  - The dropdown opening from the One trip chip (a span trigger wrapping FilterChip's button).
  - Arc visibility per filter.
  - With the tz cookie set, a trip in progress draws past stops hollow.

## Checks run

- **TDD red:** I did not run red myself. The two new source-reading test files came from the earlier unfinished attempt, and `app/(tabs)/map.tsx` did not exist then, so `mobile-library-map.test.ts` could not have passed. My first gate run showed the stale guard red: `× capture · the tabs … draws Trips · Places · Capture · You` (`expected … not to contain 'name="map"'`).
- **Targeted green:**
  - `npx vitest run src/mobile-library-map.test.ts src/mobile-journal-map.test.ts src/mobile-map.test.ts src/mobile-landing.test.ts` (core) → `Tests 62 passed (62)`.
  - `npx vitest run src/components/map` (web) → `Tests 36 passed (36)`.
- **Gate:** `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`.
  - Core: `Tests 1578 passed (1578)`. This includes the nightfall-tokens sweep.
  - Web: `Tests 582 passed (582)`. The stack-trace lines in the log come from expected-failure suites.
  - UI: `Tests 55 passed (55)`.
  - It also covers `@rv-trip/mobile:typecheck` and `@rv-trip/web:lint`.
- **No device or browser render was run.** Everything under "Render-required" is the walk's.

---

# i7 · The web Places map panel beside the grid

Scope: epic item **i7 of 9 only** (#185 renders · web only, no core seam · q9 A). No core, DS, schema or route changes.

## What changed

All in `apps/web/src/components/places/PlacesLibrary.tsx`:

- **Selection state** :113-124. `selectedId` (`useState<string | null>`) and `gridRef` on the md+ grid column. `selectPin(id)` sets the selection and runs `gridRef.current.querySelector('[data-save-id=…]').scrollIntoView({ block: "nearest" })`. The lookup is scoped to the split's grid column because the below-md lens renders its own copies of the cards, so DOM ids would collide.
- **Card wrapper** `cardFor` :236-246. It carries `data-save-id`, and `onMouseEnter` / `onClick` select the card. The wrapper is always `rounded-rv-card`, and the selected one adds `ring-2 ring-rv-green shadow-rv-lg`. Near you cards and grouped cards share this, so every card the grid lists can be selected.
- **Grid body** :276-330. The old grid / empty-state ternary moved unchanged into a `const body` so it can sit in the split's left column.
- **ViewSwitch** :361-372 is wrapped in `<div className="md:hidden">`.
- **Shipped lens** :397-414 is now `{view === "map" && (<div className="md:hidden">…)}`. Below md it is unchanged: the map, the flat card list and the "hidden by the filter" line.
- **md+ split** :416-446. `grid grid-cols-1 items-start gap-4 md:grid-cols-[1fr_360px]`, and `hidden md:grid` while `view === "map"`. This resolves the vet MED: a user who picks Map below md and then widens the window sees only the panel's map, and below md on Map only the lens shows. Left column: `body`. Right column: `<aside className="hidden … md:sticky md:top-0 md:flex">` holding
  - the mono kicker "On the map · {lens.pins.length} of {list.length} listed" (10px, uppercase, tracking 0.1em, `text-rv-ink-faded`, per the wireframe's `.wpanel .k`);
  - `MapMount` with `pins={lens.pins}`, `unmappedCount`, `selectedId`, `onSelect={selectPin}`, `height="520px"`;
  - the "N has/have no coordinates" overlay (mono 9.5px, bottom-right, per `.nomap`), shown only when there are pins and some are unmapped. With zero pins, MapMount's own empty frame shows the count.
- The panel reuses the existing `lens = buildMapModel([], list)` (:216), so it draws exactly `list`, the shelf- and chip-filtered array the grid renders. The vet HIGH on pin counts was already resolved in i6: `buildMapModel` pins saves at `savePoint`, so the wireframe's "9 of 10" case, with The Springs pinned at its area, holds.

Tests: new `apps/web/src/components/places/map-panel.test.ts` (7 source-reading tests). They check:
- the ViewSwitch is inside `md:hidden`;
- the lens is its own `view === "map"` branch inside `md:hidden`, and the split is `hidden md:grid` on Map;
- `MapMount` sits in an `<aside>` (`hidden … md:flex`, `md:sticky`, 520px) after the `md:grid-cols-[1fr_360px]` split marker;
- `buildMapModel([], list)` feeds `lens.pins` and the unmapped count;
- `selectedId` and `onSelect={selectPin}` are passed, along with `scrollIntoView({ block: "nearest" })`;
- the card's hover/click handlers, the ring classes and `data-save-id`;
- the kicker copy.

## Decisions / flags

- **The panel also shows beside the empty states** (EmptyShelf, the per-chip dashed box). There it is MapMount's "empty" frame and "0 of 0 listed". The design doesn't cover this case, and this was the simplest faithful reading of "the panel draws exactly `list`".
- **Two MapMounts stay in the DOM while Map is picked.** One is CSS-hidden at each breakpoint, so only one *shows*. The hidden one still mounts its lazy MapView in a `display:none` box. Mounting only one would need a JS media query, and the vet asked for the CSS route.
- **Clicking inside a card also selects it**, including its expand, rating and menu controls. This is harmless and matches "clicking a card selects it".
- `CSS.escape` runs only in the pin handler (browser-only), never during SSR.

## Render-required (walk)

At md+, check:
- the sticky panel stays in view while the grid scrolls;
- hovering a card rings both the card and its pin;
- clicking a pin rings its card and scrolls it into view (`nearest`);
- the "N has no coordinates" overlay sits over the canvas, clear of the style pill.

Resize from below md with Map picked: only one map should show at each width.

## Checks run

- TDD red: `npx vitest run src/components/places/map-panel.test.ts` (apps/web) before the implementation → `Tests 7 failed (7)`.
- Green: `npx vitest run src/components/places/` → `Test Files 6 passed (6)`, `Tests 65 passed (65)`.
- Gate: `pnpm turbo run lint typecheck test` was run twice. Both times every task finished green. It printed `@rv-trip/web:lint` and all typechecks (mobile included) clean, plus core `Tests 1578 passed (1578)`, web `Test Files 64 passed (64)` / `Tests 589 passed (589)`, and ui `Tests 55 passed (55)`.
- **However, the web vitest process never exited after its results.** It hung in the suite's global teardown. In `pg_stat_activity` on the shared local Postgres (:5433), a `DROP DATABASE IF EXISTS "rvtrip_test_1bt8" WITH (FORCE)` had been active for over 8 minutes, and a second one was queued behind it on a Lock wait.
- I killed only my own worktree's vitest PIDs (checked by cwd), so turbo recorded `Tasks: 9 successful, 10 total · Failed: @rv-trip/web#test`. That failure was the kill, not a failing test.
- A third, web-only run then stalled in global setup behind the same DROP, and I stopped it. I did not touch any Postgres backend, because the database is shared with other worktrees. The i3 notes record the same hang.
- **qa / engine:** re-run the gate once the local Postgres is not stuck on that DROP.
- No browser render was run. Everything under "Render-required" is the walk's.
