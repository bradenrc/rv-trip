# #111 · i1 — Capture: API, destination resolver, phone tabs, capture sheet, offline queue

Item 1 of 4 (plan.json `i1`, issues #100 · #101). Built against the signed wireframe
(`452aa81:docs/design/111/index.html`) and the vet findings on `mc/vet/issue-111-v0`.

## What changed

### Data: schema + migration (packages/db)
- `schema.ts:269` `destinations.region` (text null). `schema.ts:317` `saves.client_id` (text null),
  `schema.ts:320` `saves.suggested_place` (jsonb null, typed `SuggestedPlace`), `schema.ts:327`
  `UNIQUE saves_owner_client_uq (owner_id, client_id)`.
- `drizzle/0001_w1_capture.sql` + `meta/0001_snapshot.json`, generated with `drizzle-kit generate --name w1_capture`.
  A second `drizzle-kit generate` reports "No schema changes", so CI's drift check stays clean.
- `mutations.ts:1230` `createSave(owner, input, { resolveDestination })` now returns `{ saved, replayed }`:
  - idempotent on `clientId`: checked first (`saveByClientId`, `:1163`), then again through `ON CONFLICT DO NOTHING`
    on the new unique, so two concurrent replays can't both write;
  - an explicit body `anchor` wins over `saveAnchorOf()`. The derivation stays as the fallback for the web;
  - `capturedAt` is written to `created_at`;
  - the destination is resolved from the save's lat/lng using the **injected** resolver, then upserted by
    (owner, google_place_id) (`upsertDestination`, `:1195`). The upsert stores **name, region, lat and lng**, and a
    later hit refreshes them. If the resolver throws or there's no point, the save gets a null destination and is
    still written;
  - for an area save, `areaLabel` falls back in this order: the body's label, then the destination name ("Bend, OR"),
    then `region` (the W0 rule).
- `queries.ts:506` `listSavedPlacesForOwner` joins `destination`. `mapSavedPlaceRow` carries anchor, areaLabel,
  destination and suggestedPlace. `mapSaveDestination` is at `:599`.
- `testing/fixtures.ts`: `fx.savedPlace` accepts `clientId`, and there's a new `read.destinations(owner)`.

### Grammar (packages/core)
- `domain/types.ts:510` `saveAnchor`, `:519` `saveDestination` {id, name, region, googlePlaceId, **lat, lng**},
  `:533` `suggestedPlace`. The read shape gains anchor, areaLabel, destination and suggestedPlace, all defaulted
  (`:562`).
- `domain/types.ts:610/635/672`: the schema split. `savedPlaceFields` is the shared base. `savedPlaceCreate`
  extends it with `clientId`, `capturedAt` (ISO with offset), `anchor`, `areaLabel` and `capturedOffline`, all
  optional and none defaulted, so the web's bodies parse to exactly what they did before. A superRefine rejects a
  pin with no lat/lng and a place with no googlePlaceId. `savedPlacePatch` is built from `savedPlaceFields`, **not**
  from the create schema, so a PATCH strips every capture key.
- `domain/places.ts:286` `reservationTypeOfGoogle()`.
- `providers/index.ts:82` `ResolvedDestination` and `:91` `DESTINATION_MAX_MILES = 25`. `resolveDestination(lat, lng)`
  is on the `PlacesProvider` interface at `:123`. `StubPlacesProvider.resolveDestination` (`:182`) returns null, so
  with no key the destination is null. `PlaceSummary` gains optional `primaryType` and `primaryTypeDisplayName`.
- `providers/google-places.ts:73` adds `places.primaryType` and `places.primaryTypeDisplayName` to the search mask
  (details mask unchanged). `parseSearchResponse` (`:182`) maps both fields for search rows only.
  `resolveDestination` (`:142`) calls the Geocoding API reverse endpoint with `result_type=locality`: ZERO_RESULTS
  returns null, and any other non-OK status throws. `parseReverseGeocode` (`:222`) applies the 25 mi check against
  the locality's geometry and the one naming rule: US gives "Locality, ST" with the state long name as region;
  elsewhere it's "Locality, Country" with the country as region.
- `providers/places-search.ts:126` `destinationResolveQuerySchema` (`near` required).
- `capture/queue.ts` (new): `newClientId` (`cap_…`), `enqueue` (dedupes by clientId), `nextToFlush` (oldest
  `queuedAt`), `markSent`, `markFailed` (4xx drops; 5xx or network keeps the item, bumps `attempts` and stops the
  flush), `parseCaptureQueue` (a corrupt store reads as empty), `flushCaptureQueue`, and `CAPTURE_QUEUE_KEY =
  "rv.captureQueue.v1"`.
- `capture/sheet.ts` (new): the sheet's decisions and copy, pure: `captureRows` (row order online/offline and
  empty/typed), placeholders, note and pin row lines, `placeRowSubline`, `heardFromRecents`, the three body builders
  (`placeCaptureBody`, `noteCaptureBody`, `pinCaptureBody`), `PIN_KINDS`, and the saved/queued/synced/offline toast
  copy.
- api-client: `places.create` (`index.ts:207`), `places.search` (`:208`; a 429 reads as the degraded envelope),
  `places.remove` (`:218`), `destinations.resolve` (`:221`). Their Zod schemas are in `schemas.ts:45/62/72`.

### Web API (apps/web)
- `api/places/route.ts:18` POST resolves `placesProvider()` and injects `provider.resolveDestination` into
  `createSave`. It answers **201** for a new save and **200** for a replayed clientId. Only "trip not found" maps to
  404; any other error is rethrown.
- `api/destinations/resolve/route.ts` (new): `GET ?near=lat,lng` answers the destination or `null`. A Google failure
  is also a 200 null. A bad or missing `near` is a 400. It writes nothing.

### Phone (apps/mobile)
- Navigation (Q1 A). Root `app/_layout.tsx` `Shell` now registers `(tabs)`, `capture` (`presentation: "formSheet"`)
  and `rig`, and mounts `useCaptureRuntime()`. The Clerk gate is unchanged: `Shell` is still bare when keyless and
  still inside `<SignedIn>` when keyed.
- `app/(tabs)/_layout.tsx`: Tabs in the order Trips · + · Saves. The + tab's `tabPress` calls `preventDefault()` and
  then `router.push("/capture")`. Saves gets `tabBarBadge` set to the queue length. The toast overlay is drawn here,
  over every tab.
- `app/(tabs)/(trips)/_layout.tsx`: the nested Trips stack. `index`, `trips/[id]/index` and
  `trips/[id]/stops/[stopId]` were **git-mv'd** in unchanged apart from their relative import depth, so they keep the
  URLs `/` and `/trips/[id]`. `src/nav.ts` holds the shared `STACK_OPTIONS`.
- `app/(tabs)/add.tsx` is the + tab's null route (it can't be named `capture`, because that path belongs to the
  sheet). `app/(tabs)/saves.tsx` is the i1 placeholder: the header ("Heard about · Saves") plus the amber
  "Saved on this phone / N waiting for signal" line while the queue is non-empty.
- `app/capture.tsx`: the sheet. It has one field; rows come from `captureRows`; Google rows get a `CategoryTile` via
  `reservationTypeOfGoogle` and a "type · address" subline; the note row reads "in {town} area · where you are" via
  `destinations.resolve` when online. The offline strip is shown and the search row greyed out when offline. Place
  and note go to the confirm step (Want to go / Been there chips, Heard from recents plus "+ who", "Why? (optional)",
  "✓ Save"). Pin goes to the pin sub-screen (`PinMap`, "Drag the map to nudge the pin", Stay/Eat/Do/Other,
  "✓ Save pin"). Save closes the sheet, then queues the capture.
- `src/capture.ts` (new): the runtime. The queue is persisted to AsyncStorage under `rv.captureQueue.v1`. It watches
  NetInfo and flushes on the switch to online, on AppState `active`, and after every enqueue. Only one flush runs at
  a time. Sends go through `api.places.create`: an `ApiError` becomes its status, and anything else is treated as a
  network failure. Toasts: saved (green, Undo calls `DELETE /api/places/:id`), queued (amber), synced (green). The
  Heard-from recents come from `places.list`.
- `src/ui.tsx:178` `Chip` and `:214` `Toast`; `src/map.tsx:455` `PinMap`. The pin screen reuses the mapbox lazy-load
  seam. With no token or no native module it draws the design's blank grid with a crosshair and the coordinate chip.
- `package.json`: `@react-native-community/netinfo` 12.0.1 and `expo-location` ~57.0.16 (SDK-bundled versions).
  `app.json` registers the `expo-location` plugin.
- `README.md` "What's here" is updated for the new routes and the rebuild note.

## Vet findings in scope for i1, and how each was addressed
- **HIGH: destination coords unreachable.** `saveDestination` now carries `lat` and `lng`. The resolver returns
  `geometry.location`, the upsert stores it, and the read shape and api-client schema carry it. A route test asserts
  the stored `lat`/`lng`.
- **MED: layering.** The resolver is on the `PlacesProvider` interface and the Stub (which returns null). The route
  resolves the provider and injects `resolveDestination` into `createSave`, the same pattern as `locatePlaces`.
  packages/db holds no provider. (The offline text search belongs to i2 and isn't built here. `capturedOffline` is
  accepted and passed through; there's no column for it.)
- **MED: schema split.** `savedPlacePatch` is built from `savedPlaceFields`, so capture keys never reach PATCH or
  `updateSavedPlaceFields`' `.set()`. A test covers this. `upgradeToSuggested` and `suggestedPlace: null` are i2's.
- **FLAG: tabs + formSheet + Clerk gate.** Done as described above. `mobile-auth.test.ts` was updated to assert that
  the screens register only inside `Shell`, and that the Trips screens are in the nested stack.
- **FLAG: netinfo / expo-location are native.** Both are added. This **needs a dev-client rebuild**
  (`pnpm --filter @rv-trip/mobile ios`) before the sheet opens on a device. The real offline→online auto-flush has to
  be proven at walk.
- **FLAG: Geocoding API.** It's only proven against mocked answers (`google-places.test.ts`). **Operator step:
  enable the Geocoding API on the existing Maps key.** Until that's done, a keyed server gets `REQUEST_DENIED`,
  which `createSave` and the resolve route both turn into a null destination (saves still land).
- Not in i1: the createdAt ordering note (i2), trip radius / `locatedStops` (i3), the nearby-saves Add path (i3/i4),
  the PlacePicker/`savePlaceBody` path (i4), and the illustrative-count note (walk expectations, i2/i3).

## Decisions, defaults, and flags for the walk and qa
- **Invented copy** (no design string existed; please check at walk):
  - pin name placeholder: "Name this pin";
  - "+ who" input placeholder: "+ who";
  - the pin row's line when permission is denied: "location is off";
  - the pin row's line before a fix arrives: "finding you…";
  - the iOS when-in-use permission string in `app.json`.
- **Glyphs:** the kit ships no icon set, so the tabs use glyphs (Trips ▦, Saves ▤); the rows use ⌖ (pin),
  ≡ (note) and ⌕ (search); the toasts use ✓, ◷ and ⊘. Check these render-wise.
- **Tokens:** `RV` has no `green-cta` or `green-on-dark` entry; their dark values equal `rv-green`, so `C.green` is
  used. No token was added (`tokens.test` pins the set).
- **Toast placement:** the toast is an absolute overlay at `insets.top + 52`, over every tab, so a capture returns to
  wherever it was opened. It lasts 5 s. Check that it clears the headers.
- **`reservationTypeOfGoogle` extras:** beyond the design's list it also maps `*_restaurant`, coffee_shop and bakery
  to dining; hotel and motel to lodging; national_park and state_park to activity. The five acceptance mappings are
  unchanged.
- **Area-save point:** a note carries the phone's point with `anchor: "area"`, so the server resolves "Bend, OR" from
  it. An area save from the web with no coordinates resolves nothing.
- **4xx drop:** a dropped queue item shows no toast.
- **Replay short-circuits before the resolver**, so Google is asked once per capture. A test covers this.
- **`w0-reset.test.ts`** previously pinned "exactly one migration". Since the plan calls for a migration per item,
  it now asserts that the history starts at the single `0000_v2` baseline and that every `.sql` file is journaled.
- **Local dev DB not migrated.** The shared :5433 dev DB was left alone (the walk composes its own DB). Apply it with
  `pnpm db:migrate` when ready.
- **Claims for qa to check:** POST `/api/places` 201 then 200 with the same id and one row; an explicit area with
  lat/lng is stored as area; the destination row is reused across saves and region, lat and lng are stored; the
  `(tabs)` URLs `/` and `/trips/[id]` are unchanged; the + opens the sheet from the trip screen.

## Checks run
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. That covers core (`Tests 1074 passed`),
  web (`Tests 293 passed`, run against real Postgres on :5433 and not skipped), ui (`Tests 42 passed`), the mobile
  and db typechecks, and lint.
- `npx drizzle-kit generate` (packages/db) → `No schema changes, nothing to migrate`.

---

# #111 · i2 — Saves tab: destination shelves, region headers, and the offline-text upgrade

Item 2 of 4 (plan.json `i2`, #101). Built against the signed wireframe (`452aa81:docs/design/111/index.html`,
"The Saves tab" and "Contracts"). No schema change, so there's no migration: `saves.suggested_place`,
`destinations.region/lat/lng` all landed in i1.

## What changed

### Core (packages/core)
- `capture/shelves.ts` (new; exported from `index.ts`):
  - `savesShelves(saves, status)` (`:58`) returns `{ regions: [{ region, count, destinations: [{ destination, saves }] }], unanchored }`.
    Regions are ordered by count descending, with ties broken by region name. Destinations are alphabetical
    (`localeCompare`, base sensitivity) and grouped by destination **id**. Saves are newest first by `createdAt`,
    and a null `createdAt` sorts last. `destination: null` goes to `unanchored`, also newest first.
  - `shelfCounts` (`:85`) gives the segment counts.
  - `saveRowLine` (`:114`) builds the row's second line. `source` wins ("Heard from Jane & Rick"). Otherwise it
    uses the anchor: pin gives "pin · 43.0500, −124.3300" (the i1 `formatCoords`); area gives
    "note · Bandon area"; place gives "Restaurant · Bend, OR".
  - `suggestedPlaceFromSearch` (`:131`) takes the top hit, with the capture sheet's `placeRowSubline`.
  - `suggestionStrip` (`:145`) returns the copy "Did you mean {name}?", the subline, and "Dismiss".
- `domain/types.ts:571`: the read shape `savedPlace` gains `createdAt` (ISO, nullable, defaulted).
  `:676` `savedPlacePatch` gains `upgradeToSuggested: z.literal(true)` and `suggestedPlace: z.null()`, both
  optional and **PATCH-only** (`savedPlaceCreate` strips them; a test covers this). A client can clear a
  suggestion but can never write one (400).
- `domain/place-form.ts:214`: `applySavedPlacePatch` also echoes a dismiss (suggestion goes to null) and an
  upgrade (copies name, place ID and point; anchor becomes place; label and suggestion go to null). The
  destination is left for the refetch.
- api-client `places.patch(id, patch)` (`api-client/index.ts:224`) resolves to void on a 204. A 409 throws
  `ApiError`.
- `seeds/saves.ts` (new): `seedDestinations()` and `seedSaves()` as pure data (re-exported from `seeds/index.ts`),
  judged in `seeds/seeds.test.ts`.

### DB (packages/db)
- `mutations.ts:1170` `SaveDeps { resolveDestination?, searchPlaces? }`.
- `:1215` `suggestQuietly`: for **`capturedOffline` + anchor `area` + a point**, it runs a text search for the
  save's name near the capture point and stores the top hit in `saves.suggested_place`. With no searcher, no
  hits, or a thrown error, there's no suggestion, and the save is still written. It runs in parallel with the
  resolver (`:1296`).
- `:1347` `NO_SUGGESTION`, `:1358` `upgradeColumns`, `:1384` `updateSavedPlaceFields(owner, id, patch, actor, deps)`:
  - the two suggestion keys are split off before `.set()`;
  - `suggestedPlace: null` becomes the column write;
  - `upgradeToSuggested` reads the row's suggestion (owner-scoped) and copies name, `googlePlaceId`, lat and lng.
    It sets anchor `place` and `areaLabel` null, **re-resolves the destination from the suggestion's point**
    through the injected resolver (then upserts it), and clears `suggested_place`. With no suggestion it throws
    `NO_SUGGESTION`.
- `queries.ts:588`: `mapSavedPlaceRow` carries `createdAt`.
- `seed.ts`: saves and destinations are now written from `@rv-trip/core/seeds`. The seed deletes the household's
  destinations and re-inserts them, then inserts the saves with `destination_id`, `suggested_place` and
  `created_at`.
- `testing/fixtures.ts`: `fx.savedPlace` accepts `anchor`, `areaLabel`, `destinationId` and `suggestedPlace`.
  There's a new `fx.destination`.

### Web API (apps/web)
- `api/places/route.ts:31`: POST also injects `searchPlaces: provider.search`. The stub returns `[]`, so no
  suggestion is made when there's no key.
- `api/places/[id]/route.ts:47`: PATCH resolves `placesProvider()` and injects its `resolveDestination`. It still
  answers **204 with no body**. `NO_SUGGESTION` answers **409** (`:51`). Every other throw keeps the shipped
  "trip not found" 404.

### Phone (apps/mobile)
- `src/store.ts:82` `loadSaves`, `:98` `patchSave` (an optimistic `applySavedPlacePatch`, then the PATCH, then
  **always refetch**, because the 204 carries no destination), and `:109` `useSaves`.
- `app/(tabs)/saves.tsx` replaces the i1 placeholder:
  - the header;
  - the amber queue line (kept from i1);
  - the wireframe's `.seg` (a full-width two-half control on border-hi, the chosen half on navy-soft, mono
    counts);
  - region `.grp` headers;
  - `.dest` headings with a mono count;
  - `.rows` blocks (a 26 px `CategoryTile`, the name at 13/700, the mono line from `saveRowLine`, and `Stars` at
    10 in rv-accent on Been rows);
  - the rv-info `.suggest` strip after the rows block for each save with a suggestion (tapping the strip
    upgrades, the inner "Dismiss" dismisses);
  - Unanchored last, with the dashed `.outside` note, whose copy is verbatim.
  - The list reloads on focus, when the queue drains, and on pull-to-refresh.

## Vet findings in scope for i2, and how each was addressed
- **MED: schema split.** `upgradeToSuggested` and `suggestedPlace` are explicit PATCH-only keys on
  `savedPlacePatch`. `updateSavedPlaceFields` splits them off, so they never reach `.set()` raw. The capture keys
  are still stripped from PATCH (i1). "PATCH answers 204, refetch": `patchSave` always calls `loadSaves()`
  afterwards.
- **MED: createdAt ordering.** I took the first option: `createdAt` was added to `savedPlace` and to
  `mapSavedPlaceRow`, so `savesShelves` sorts on the real value and doesn't depend on the list query's order.
- **MED: layering.** The offline text search is injected (`SaveDeps.searchPlaces`) from the route, like the
  resolver. packages/db has no provider.
- **MED: illustrative numbers.** The unit fixture is exactly the wireframe's Want list (Oregon 8, Costa Rica 1,
  Unanchored 2 = 11). I also seeded the drawn Bandon and Bend saves that the plan's seed list left out, so the
  walk's Want count is 11 and the strip has a row to show (see below). The i3 frame counts are not walk
  expectations here.
- The HIGH finding on destination coordinates was i1's. The upgrade path uses those coordinates: it stores the
  new destination's lat and lng through the same upsert.

## Decisions, defaults, and flags for the walk and qa
- **Seed reshaped to the wireframe** (the walk sees Want **11** and Been **4**):
  - added: Fort Stevens, Nehalem Bay, Beverly Beach (Jane & Rick), Cape Lookout (Marcy), El Chandelier/San José
    (Marcy), "great BLM camp spot" (Bandon pin), "chandel" (Bandon area note **with the El Chandelier
    suggestion**), "taco truck Dana said" (Bend note), and the Alvord pin (unanchored);
  - kept: Kalaloch (unanchored), Sunny's (Bend), and the four been saves;
  - **removed** Crater Lake Rim Drive and Flying J (Ontario), which would have made the drawn 11 into 13;
  - Old Faithful anchors to "West Yellowstone, MT · Montana" (19 mi away). Fishing Bridge is unanchored.
  - Destinations use `seed_loc_*` place IDs, and the suggestion uses `seed_place_el_chandelier_coos_bay`
    (the seed has no key). **Upgrading "chandel" at walk copies that fake ID onto the row.** With no key the
    re-resolve returns null, so the save stays under Bandon, OR and moves to the place anchor. That's expected
    in a keyless walk.
- **Sunny's row reads "Heard from Forum tip"**, not the wireframe's "Restaurant · Bend, OR". The seed keeps its
  real source and pin anchor rather than inventing a Place ID. The "Restaurant · Bend, OR" form comes from
  `saveRowLine` for any place-anchored save with no source, and is unit-tested.
- **Upgrade with no destination back** (no key, a Google error, or nothing within 25 mi): the save **keeps its
  current destination**, because the suggestion was searched for near that point. This is a default; qa should
  check it's acceptable.
- **Upgrade keeps `type`.** `suggested_place` has no type (design shape {name, googlePlaceId, lat, lng, subline}),
  so an upgraded "chandel" keeps the Other tile.
- **Invented copy/marks:** "Place" is the kind word for `other` in the place line. The strip glyph is ✦ (the kit
  has no spark icon). There's no empty-shelf copy: an empty shelf shows only the segment. The Been row's
  second line is the Stars **instead of** the anchor line; I couldn't find a Been frame to confirm this against.
- **Tiles:** the kit's two-letter `CategoryTile` is used, so notes and pins show "··" rather than the
  wireframe's note or pin glyph.
- A strip is drawn **after its destination's rows block**, as the wireframe draws it (outside the bordered
  block), rather than inside the row.
- The 409 for an upgrade with nothing to take is new; the design doesn't specify it.
- **Claims for qa to check:**
  - an offline area note POSTed with lat/lng stores the top hit and answers it in the 201;
  - an online note or an offline pin triggers no search;
  - `{upgradeToSuggested:true}` gives anchor place, the Place ID and point, a re-resolved destination and a
    null suggestion;
  - `{suggestedPlace:null}` clears only the suggestion;
  - the seed's Want shelf reads Oregon 8 (Bandon, Bend, Nehalem, Newport, Tillamook, Warrenton), then
    Costa Rica 1, then Unanchored 2.
- **Render-required at walk:** the whole `saves.tsx` screen (fonts and spacing against the pixel target, the
  dashed border on iOS, nested Pressable Dismiss inside the strip), and reload-on-focus.

## Checks run (i2)
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. That covers core
  (`Tests 1106 passed`), web (`Tests 303 passed`, against real Postgres on :5433), ui (`Tests 42 passed`), and
  the mobile and db typechecks.
- Seed smoke test on a throwaway DB. I ran `createTestDatabase()` (`rvtrip_test_t1k`), then `tsx src/seed.ts`,
  which printed `Seeded 6 trips + 15 saves.`. A psql readback showed Oregon 8 / Costa Rica 1 / Unanchored 2 on
  Want, 4 Been, and one suggestion on "chandel". I dropped the DB afterwards.
- No `drizzle-kit generate` this item: no schema change.

---

# #111 · i3: Trip surfacing (nearby-saves API, per-trip dismissals and radius, phone banner and review sheet)

Item 3 of 4 (plan.json `i3`, #102). Built against the signed wireframe (`452aa81:docs/design/111/index.html`,
the "#102 · trip surfacing" and "Contracts" sections) and the vet findings.

## What changed

### Data: schema and migration (packages/db)
- `schema.ts:116`: `trips.surface_radius_mi` (smallint null), plus `:122`
  `CHECK trips_surface_radius_mi_ck IN (25, 50, 100, 200)`.
- `schema.ts:346`: `trip_dismissed_saves` with `trip_id` → trips CASCADE, `save_id` → saves CASCADE, and
  PRIMARY KEY (trip_id, save_id). It has no owner column because the trip is the ownership root.
- `drizzle/0002_w1_surfacing.sql` and `meta/0002_snapshot.json` were generated by
  `drizzle-kit generate --name w1_surfacing`. Running generate again reports "No schema changes".
- `queries.ts:327`: `mapTripRow` reads `surfaceRadiusMi` through core's literal union. Any value outside
  the union reads as null.
- `queries.ts:524`: `listDismissedSaveIds(owner, tripId)` is owner-scoped through a join on trips.
- `mutations.ts:367`: `updateTripFields`' explicit patch type gains `surfaceRadiusMi`.
- `mutations.ts:408`: `dismissSavesForTrip(owner, tripId, saveIds)` returns false when the trip isn't the
  caller's. It records only the caller's own saves and uses `ON CONFLICT DO NOTHING`, so it's idempotent.
- `testing/fixtures.ts`: new `read.dismissedSaveIds(tripId)`. `testing/truncate.ts` also truncates the new
  table.

### Grammar and logic (packages/core)
- `domain/types.ts:247`: `SURFACE_RADII` and `surfaceRadiusMi`, a literal union of 25|50|100|200.
- `domain/types.ts:292`: `trip.surfaceRadiusMi`, defaulting to null.
- `domain/types.ts:342`: `tripPatchInput` picks `surfaceRadiusMi`, so 75 is a 400.
- `domain/types.ts:735/762/772`: `nearbySave`, `nearbySavesResponse` {radiusMi, items, beyond} and
  `dismissSavesInput` {saveIds: uuid[1..500]}.
- `planner/shelf.ts:93/119`: `shelfMiles` (the ShelfIdea precision) and `locatedStops` are now exported.
  The private `Anchor` interface was renamed to `StopAnchor` so the export has a clear name.
- `planner/nearby-saves.ts:93` (new, exported from `planner/index.ts`):
  `nearbySaves(trip, saves, dismissedSaveIds, radiusMi)`.
  - The save point is the save's own lat/lng, falling back to its destination's lat/lng.
  - It finds the nearest located stop.
  - It drops dismissed ids and saves already on the trip as an idea. That check is `isAlreadySaved`
    against the places of **both** shelf ideas and stop-attached ideas.
  - Items are ordered nearest first by raw miles (ties by name). Distances print at `shelfMiles` precision.
  - `beyond` is the next ring's count, with the nearest distance at one decimal.
  - A null radius means `NEAR_RADIUS_MI`.
- The same file holds the copy helpers: `nearbyBanner`, `nearbyCountLabel`, `nearbyRowLine`,
  `nearbyBeyondLine`, `addAllLabel`, `ideasHeading`, `IDEAS_EMPTY_COPY`, and `nearbyIdeaBody` (the
  `POST /api/ideas` body, whose category comes from core's `categoryOf(type).cat`).
- api-client (`api-client/index.ts:226-231, 275`, `schemas.ts:48/52`): `trips.patch`, `trips.nearbySaves`,
  `trips.dismissSaves` and `ideas.create`, with the `nearbySavesSchema` and `ideaSchema` response schemas.
- Trip literals in 10 test files and in `seeds/index.ts` gain `surfaceRadiusMi: null` (the type now
  requires it).

### Web API (apps/web)
- `api/trips/[id]/nearby-saves/route.ts` (new): GET. It runs `getTripById`, `listSavedPlacesForOwner` and
  `listDismissedSaveIds`, then `nearbySaves(…, trip.surfaceRadiusMi)`. 404 when the trip is missing.
- `api/trips/[id]/dismissed-saves/route.ts` (new): POST `{saveIds}`. Zod `safeParse` returns 400 on a bad
  body. 204 on success, 404 for a foreign trip.
- `api/trips/[id]/route.ts` PATCH needed no change: `surfaceRadiusMi` arrives through `tripPatchInput` and
  passes through to `updateTripFields`.

### Phone (apps/mobile)
- `src/store.ts:133-184`: `loadNearby`/`useNearby` (a failed read is quiet and shows no banner).
  - `dismissNearby` hides the banner optimistically, POSTs, then refetches.
  - `setSurfaceRadius` updates the trip optimistically, PATCHes, then refetches nearby.
  - `addNearbyIdea` calls `ideas.create(nearbyIdeaBody(…))` and then `appendShelfIdea`.
- `src/nearby.tsx` (new):
  - `NearbyBanner` (`.suggest`: rv-info border and info-soft, ✦ glyph, 13/700 title, 11.5 sub, mono Dismiss).
  - `IdeasSection` (`.lbl` "Ideas · N" and the dashed `.outside` empty copy; otherwise `.rows` from core's
    `shelfIdeas`).
  - `NearbySheet`, a transparent `Modal`:
    - the `.dim` navy overlay at .55, and a `.sheet.full` from the safe-area top with a grab bar;
    - "Near this trip" with a mono count and the 25/50/100/200 `Chip`s;
    - rows with a 26 px tile, name, the mono line plus `Stars` for been saves, and Add or "✓ Idea";
    - the dashed beyond line with a bold lead, and the ghost "Add all N to ideas".
- `app/(tabs)/(trips)/trips/[id]/index.tsx:61,158-169,270`: the banner (only when items > 0) and
  `IdeasSection` sit at the top of the Route lens ScrollView, above the Rhythm card and stop rows. The
  sheet is mounted at screen level, closing it refetches nearby, and pull-to-refresh reloads both.

## Vet findings in scope for i3, and how each was addressed
- **MED: trip radius wiring.** `surfaceRadiusMi` is now in the `trip` grammar (`types.ts:292`), in
  `getTripById`'s mapping (`queries.ts:327`) and in `updateTripFields`' patch type (`mutations.ts:367`).
  It's a literal union, so 75 gets a 400 (route test) and the database CHECK refuses it too (route test
  through the raw client). `locatedStops` is exported from `shelf.ts` and reused rather than copied.
- **MED: Add path.** I took the second option: every nearby item carries the save's own `place` (in the Zod
  item shape, so a response without it throws in the client, which a test covers). `nearbyIdeaBody` builds
  the shipped `POST /api/ideas` body from the item alone, so the phone needs no join against
  `places.list`. i4's web can use either the item or its `savedPlaces` prop.
- **HIGH: destination coordinates (i1's fix, exercised here).** An area save with no coordinates is
  measured from `destination.lat/lng`. There's a unit test and a route test through a real
  `destinations` row.
- **MED: illustrative numbers.** The unit fixture and the route fixture are exactly the acceptance's (stops
  Astoria and Newport, plus the design table's 7 saves). Fort Stevens is at lng −123.958 and Cape Lookout at
  lat 45.3623 so that haversine gives the table's 6.2 (Fort Stevens a hair ahead of Beverly Beach's 6.2, as
  drawn) and 50.3. The **seed's** coordinates give Fort Stevens 6.4 and Cape Lookout 50.4, and I left them
  alone (they're i2's). None of the frame counts are walk expectations.

## Decisions, defaults, and flags for the walk and qa
- **No seeded "Oregon Coast, summer '27" trip.** The seed has 6 trips and none is Astoria + Newport only;
  the design says done-when #3 is walked by creating that trip on the web or seeding it. Opening the seeded
  **Pacific Northwest Loop** (which has Astoria, Newport and Bend) will surface a larger set, including the
  Bend saves near its Bend stop.
- **`beyond` is null when the next ring is empty,** as well as at 200 mi, so there's no "0 more" line.
- **"Already on the trip" counts stop-attached ideas as well as shelf ideas.** Otherwise an added save that
  was dragged onto a stop would resurface.
- **Invented copy:** the singular banner "1 of your saves **is** near this trip" and the "1 save" count.
  Only the plural was drawn.
- **"Add all" is hidden when nothing is left to add** (rather than "Add all 0"). It adds items one at a
  time so the shelf's sortOrder follows the list.
- **The sheet keeps added rows as "✓ Idea" across a radius change** (frame 4). The next GET excludes them,
  so the sheet merges the ones it added with each fresh answer, and the count includes them ("5 saves" in
  frame 4).
- **The banner is hidden when a trip has no located stops** (nothing can be measured). A failed
  nearby-saves read also shows no banner and no error.
- **Tokens:** `green-cta` maps to `C.green` for the Add button (the i1 precedent: `RV` has no green-cta).
  `rv-info-ink` is `C.info`, as in i2.
- **Render-required at walk:**
  - the Modal sheet (slide animation, the dim over the tab bar, safe-area top);
  - the banner's nested Dismiss Pressable;
  - the Ideas rows;
  - chip taps refetching while the sheet is open;
  - Add changing to ✓ Idea, with the idea appearing under "Ideas · N" after close.
- **Local dev DB not migrated.** The shared :5433 DB was left alone. Apply it with `pnpm db:migrate`.
- **Claims for qa to check:**
  - the dismissal persists across GETs and is per trip;
  - another owner's save ids are dropped, not recorded;
  - PATCH `{surfaceRadiusMi:100}` round-trips through the bundle, `null` resets to 50, and 75 is a 400
    with the row unchanged;
  - Add through `nearbyIdeaBody` creates a stay shelf idea with the save's place and stops that save
    surfacing.
- **TDD note:** the core function and the api-client were written test-first (the tests failed on the
  missing module and methods, then passed). The two route handlers were written just before their
  integration tests.

## Checks run (i3)
- `pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total`. That covers core
  (`Tests 1142 passed`), web (`Tests 314 passed`, including the 11 new nearby-saves route tests, against
  real Postgres on :5433 and not skipped), the mobile, db and web typechecks, and lint.
- `npx drizzle-kit generate` (packages/db, after generating 0002) → `No schema changes, nothing to migrate`.
