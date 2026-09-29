# #130 · dogfood pass 1 — dev notes (i1, one pass: #131 #126 #127 #128 #129 #124)

Implements `docs/design/130/index.html` (mc/wireframe/issue-130-v0) and resolves every
vet finding in `vet-verdict.json` (mc/vet/issue-130-v0). Web + apps/mobile per child (Q3 A).

## What changed

### Data (#126 · Q4 A · Q5 A)
- `packages/db/src/schema.ts:122` — `trips.destination_id` (uuid null → destinations.id, on delete set null);
  `:521-524` — `user_prefs.home_base / _lat / _lng / _place_id`; `tripsRelations.destination`.
  Migration `packages/db/drizzle/0005_dogfood_destination_home_base.sql` (generated, additive).
- Core grammar (vet MED "2 of 3 places"): `types.ts:287` `tripDestination` / `tripDestinationInput`;
  `trip.destination` + `trip.homeBaseFromHousehold` (both `.optional()` so every older payload/fixture
  still types); `tripCreateInput` `.extend({ destination })` (the closed `.pick()` no longer drops it);
  `prefs.ts` `userPrefsPatch.homeBasePlace` (PUT /api/prefs no longer 400s), `UserPrefs.homeBasePlace`,
  and `resolveHomeBase` (`prefs.ts:141`: trip override → household → null).
- Create (`mutations.ts:384` `createTrip`): upserts the destinations row by owner + place id
  (`upsertTripDestination`, `:468`, keeps an existing row's name, fills a missing point), sets
  `destination_id`, writes ONE stop spanning start→end on Leg 1, reconciles hops, and births the
  `→ home` hop (vet HIGH ×2). The picked coordinates travel in the body (vet MED "coords").
- Coalesce reaches the reconcile (vet HIGH #126): `loadSegmentTrip` (`mutations.ts:171`) left-joins
  `user_prefs` so `reconcileSegments` sees the EFFECTIVE home base; `getTripById` (`queries.ts:396`)
  coalesces the same way, so the page, `GET /api/trips/:id` (the phone bundle) and the optimistic
  `withReconciledSegments` agree. `upsertPrefs` (`:1741`) writes the four columns and re-syncs every
  trip with no override, so setting a household home base later adds their home → first hop.
- Settings ▸ Home base: `SettingsForm.tsx` `HomeBaseField` → `PUT /api/prefs { homeBasePlace }`
  (`tripApi.saveHouseholdHomeBase`). Trip settings ▸ "Starts from" (TripPlanner `TripSettingsFields`):
  "household default" label, picking writes the trip override, "Use household default" clears it
  (optimistic fallback via the new `householdHome` prop from `trips/[id]/page.tsx`).
- Anchor order: `packages/core/src/domain/search-anchor.ts:47` `searchAnchor(trip, ctx)` + `searchAnchorChip`.
  All six former `nearOf(…, homeBasePlace)` sites replaced — TripPlanner (shelf draft, shelf locate,
  StopDetailSheet `placeNear` — the vet's fifth site), RouteView :280 and :529, StopDetailSheet :227
  (now the `stopNear` prop). Home base is never in the chain; nothing known → "Search near…?".
- /trips/new (web `app/trips/new/page.tsx`, phone `trips/new.tsx`): Where to? first, the household home
  base as a quiet chip whose "change" writes the trip override, When on the RangePicker. An untitled
  trip is named for its destination (`tripDraftInput`). A free-text (no place id) pick is not a
  destination.

### #127 · RangePicker
- `packages/ui/src/RangePicker.tsx`, exported from `packages/ui/src/index.ts`, preview
  `.design-sync/previews/RangePicker.tsx` (WholeTrip · OutsideTheTrip · NoTripSpan · Halfway).
  Arithmetic is pure core: `packages/core/src/domain/date-range.ts` (`rangePickState`, `widenedSpan`,
  `dayCellState`, `pickDay`, `monthGrid`, `stepNights`) — the phone twin is `apps/mobile/src/ui.tsx`
  `RangePicker` (vet MED path drift: `ui.tsx` is a single file, the twin lives in it).
- Replaces the native inputs in: web trip creation, Trip settings, the stop-dates dialog, the stay form;
  phone creation, the stop screen's Add stay, the new Add stay sheet.
- Q7 B: outside days stay pickable, go amber, and "Extend trip to …" hands `onExtendTrip` the widened
  span. In the stop-dates dialog, Extend moves the trip's dates in the same save
  (`saveStopDates(…, extend)` PATCHes the trip, then the stop). **Defaulted:** a stop dated outside the
  trip WITHOUT Extend keeps Save disabled — the server's `stop_dates_outside_trip` 409 stands (deriveDays
  would drop the days). For stays (no server window check) the guard never blocks.

### #131 · Itinerary · Ideas · Journal
- Web `TripPlanner.tsx`: `tab` (itinerary/ideas/journal) + `sub` (route/timeline) replace `lens`;
  derivation kept (complete → Journal; drive → Route, fly → Timeline). ToggleTab row = Itinerary ·
  Ideas (maybe count) · Journal; Itinerary's sub-lens is the DS `SegmentedControl` (mono). Add menu is
  tab-scoped (Itinerary: Flight · Stay · A stop · "Switch to Ideas →"; Ideas: three kinds + Add from
  Places; hidden on Journal).
- `IdeasLens.tsx` (new): LastTimeHere, NearbySavesBanner/Sheet, ShelfIdeaDraft, AddFromPlacesPanel,
  chips, "Pinned to <stop> · n" and "For the trip · n", each row with **Plan it**. The Timeline rail
  keeps only "Not yet scheduled" (`Timeline.tsx` shelf props now optional).
- Plan it (vet MED onPlanIdea signature): stay → RangePicker dialog → `planIdeaOnDates(ideaId, dates)`
  — the drop's create + attach + Undo with the dates handed in (`doPlanIdea`/`doAttachIdea` removed with
  the gantt drop; `plan-undo.test.ts` now slices `planIdeaOnDates`); do/eat → pick a stop →
  `planIdeaToStop` (attach + planned, one PATCH); pinned → status planned.
- Route rows list planned/done ideas only (`routeModel`, planner/index.ts) — web and phone.
- Phone `trips/[id]/index.tsx`: underline tabs Itinerary · Ideas · Journal with an in-masthead "+ Add"
  pill (tab-bar + stays capture); Itinerary sub-lens Route · Timeline · Map (Timeline = the rhythm block
  moved out of Route); Ideas = LastTimeHere + NearbyBanner + `IdeasTab` with Plan it
  (`apps/mobile/src/itinerary.tsx`). New api-client calls: `stops.create`, `ideas.patch({ stopId })`.

### #128 · Add stay
- `AddStaySheet.tsx` (new): `StayPlaceField` = lodging-typed anchored PlacePicker + the "near …" chip +
  the "Show all places, not just lodging" row (new `PlacePicker` props `type`, `onShowAll`); step 2 =
  RangePicker defaulting to the stop span + nights stepper + "✓ covers your whole stay at …"; "Just
  considering? Save it as an idea instead". Doors: Itinerary ▸ Add ▸ Stay and the Route stop card's
  "+ Add stay · dates from this stop" (RouteView, shown when the stop has no stay). The stop sheet's
  Stay form reuses `StayPlaceField` + RangePicker (Friends keeps its name input). Phone:
  `AddStaySheetPhone` + the stop card's "+ Add stay".
- `placesSearchQuerySchema.type` (`"lodging"`), `searchPlacesEnvelope` passes it, `PlacesProvider.search`
  takes it, Google sends `includedType` (`buildSearchBody`). `PLACE_SEARCH_TYPES` lives in
  places-search.ts (a value import from providers/index would be an ESM cycle).
- **Not carried:** the design's sample body posts `googlePlaceId` on the stay; `reservations` has no such
  column and the item's migration list adds none, so the stay stores its name only.

### #129 · round trip + reversible mode
- Contract (vet HIGH "no contract"): `POST /api/trips/:id/boundary-flights`
  (`app/api/trips/[id]/boundary-flights/route.ts`), Zod `boundaryFlightsInput` (types.ts:662 — both
  zones required; round trip requires `return`), client `tripApi.boundaryFlights` / api-client
  `trips.boundaryFlights`, mutation `createBoundaryFlights` (mutations.ts:1210) — owner-scoped, one
  transaction, both hops → fly, bookings inserted, hops re-timed, `SegmentDateMismatch` rolls it all back.
  Responses: 201 Trip · 400 · 404 · 409 `no_home_base` · 409 `segment_date_mismatch`.
- The → home hop (vet HIGH): born by `withReturnHop` (core `boundary-flights.ts`) at trip create and at
  the round-trip save; `reconcileSegments` is unchanged (it still never invents one, it re-points it).
- `PATCH /api/segments/:id` takes `bookings: keep | remove`; the 409 `segment_has_bookings` is gone.
  **Decided (vet MED 1):** no `bookings` key reads as `keep` (loses nothing). **(vet MED 2):** to Fly
  re-times the hop from its kept bookings (`updateSegmentMode` → `retimeQuietly`; client
  `setSegmentMode` does the same). **(vet MED 3):** the TripPlanner toast is replaced by
  `HopModePrompt.tsx` (Keep it, parked · Remove it · Stay on Fly); phone `switchHop` asks via Alert.
- Parked: `RouteHop.parked` (planner/index.ts) — a drive hop with bookings is drawn as a hop with the
  inline `HopModeSwitch` + "N flight booking(s) parked — comes back if you fly" on ANY trip mode
  (`HopCard.tsx` `ParkedHop`, phone `HopRow`).
- Add flight: `AddFlightSheet.tsx` (web, `PrefSwitch` Round trip default on, return mirrored + trip's
  last day), phone `RoundTripSheet` (hops.tsx). Core `mirrorReturnDraft`, `boundaryFlightsBody`.
- Added `BLI` (Bellingham, America/Los_Angeles) to the airport table so the replay's BOI → BLI resolves
  its zone without a manual pick.

### #124 · fly cells + hop booking edit
- `derive-days.ts:139`: boundary fly/ferry hops paint LAST, so they win their arrival/departure day over
  an untimed drive borrowing the same date. Note: the Costa Rica core seed already painted Jan 16 and 25
  as ✈ (existing derive-days test); the production blank cells came from trips with no → home hop and no
  effective home base — fixed by the create path + home-base coalesce above. Jan 24 stays ✈ too (the
  redeye leaves at 19:30 local on the 24th — Q4 B; the wireframe draws it as stay).
- Vet HIGH #124: `reservationPatchInput` now carries `startsAt/endsAt/startsTz/endsTz` with the create's
  zone-pairing refine; `updateReservationFields` routes a clock edit through `writeBookingClock`
  (mutations.ts:1313) — writes, re-times the hop, and refuses a stop-date clash (409
  `segment_date_mismatch`, `api/reservations/[id]/route.ts`).
- HopCard bookings get **Edit** (opens the same form prefilled via core `hopDraftFromBooking`; saves
  `hopBookingPatch`; Delete stays in the form).

## Tests (new/updated)
- `packages/core/src/domain/dogfood-130.test.ts` — anchor order (stop → destination → located stop →
  null, never home base), resolveHomeBase, RangePicker state/extend/grid/stepper, `type=lodging` schema +
  provider + `includedType`, round-trip body/mirror/`withReturnHop`, keep/remove/re-time, parked route
  hop, Costa Rica Jan 16/25 ✈ on `timelineModel`, boundary precedence, hop Edit draft/patch/re-time,
  Route shows planned/done only, `tripDraftInput` destination.
- `apps/web/src/test/dogfood-130.test.ts` (real Postgres, real handlers) — create writes destinations
  upsert + `destination_id` + one spanning stop (and reuses the row); household home base → both
  boundary hops + ✈ Oct 10/13; override wins over prefs; setting prefs later adds the hop; round trip =
  two boundary bookings in one request, creates the → home hop, 409 on a clash, 404 foreign;
  PATCH drive keep (no 409, reservation stays) / remove (deleted) / fly (booking back + re-timed);
  hop booking PATCH lands its `startsAt` and re-times; 400 without zone; 409 on a day clash.
- `apps/web/src/components/trip/trip-frame.test.ts` — source-level (no DOM in this vitest): the ToggleTab
  row is Itinerary · Ideas · Journal, Route · Timeline is the SegmentedControl sub-lens, Add is
  tab-scoped/hidden on Journal, the toast refusal is gone, no `nearOf(`/home-base `near` in the three files.
- Updated: `w2-hops.test.ts` (409 → keep), `prefs/route.test.ts` (`homeBasePlace: null` in the row),
  `plan-undo.test.ts` (slices `planIdeaOnDates`), core's phone source pins `mobile-map.test.ts` (the lens
  control is now `<Segmented value={sub}`) and `mobile-surfacing.test.ts` (banner + Ideas list live in the
  Ideas branch, before the Timeline's Rhythm card).

## Conventions / deviations to check at the walk
- Token sweeps (`nightfall-tokens.test.ts`) forbid the wireframe's green-filled CTA (`bg-rv-green-cta`)
  and navy ink off a green fill: the sheets' Save / Plan it CTAs use the repo's CTA pair
  (`bg-rv-accent-deep text-rv-accent-ink`), and the RangePicker's OUTSIDE edge is an amber ring on
  amber-soft (not navy on amber). Out-of-band days use `rv-ink-faded`.
- RangePicker adds month ‹ › navigation (not drawn; a trip can span months).
- FLAG (vet): lodging-first depends on Google honoring `includedType: "lodging"` — render-required with a
  real key; the stub returns nothing locally.
- The phone round-trip sheet shows a warning (no zone picker) for an airport not in the table; the hop
  card's own sheet still has the picker.
- Local DB: the migration was NOT pushed to the shared dev database (5433/rvtrip) — the web suite builds
  its own DB from the migrations. Run `pnpm db:migrate` (or `db:push`) before walking against it.

## Gate
`pnpm turbo run lint typecheck test` — `Tasks: 10 successful, 10 total` (core 1293 tests / 61 files,
web 393 / 48 files against a real Postgres test DB, ui 48 / 4). Not run: `next build`, the phone on a
simulator (render-required — the walk).
