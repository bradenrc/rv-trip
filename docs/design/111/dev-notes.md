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
