# #181 · dev notes · i1 — the tab rule and the Agenda rename (#177)

This dispatch covers epic item **i1 only** (q9 B, first half). i2–i5 are separate dispatches.

## What changed

**Core**
- `packages/core/src/planner/trip-tab.ts` (new): `TripTab`, `TRIP_TABS = ["journal","agenda","ideas"]`, `TRIP_TAB_LABEL`, and `defaultTripTab(trip, today)`. It returns journal when `today` is set and `activeTrip([trip], today)` is non-null (only the dates decide). It returns journal when status is `complete`, and agenda otherwise.
- `packages/core/src/planner/index.ts:69-70`: re-exports `./trip-tab`.

**Web**
- `apps/web/src/app/trips/[id]/page.tsx:63-69, 86-87`: reads the `tz` cookie (`TZ_COOKIE`, the same way as `app/page.tsx`), computes `today = tz ? isoDateInZone(new Date(), tz) : null` and `now = new Date().toISOString()`, and passes both to `TripPlanner`.
- `apps/web/src/components/trip/TripPlanner.tsx`
  - New optional props `today?: IsoDate | null` (default null) and `now?: string`, at :238 and :282-291. `now` is accepted but not read yet: i3 (Today) consumes it.
  - :328: `useState<TripTab>(defaultTripTab(initialTrip, today))`. Every `"itinerary"` tab value is now `"agenda"`. The sub-lens default is unchanged.
  - :1670: the ToggleTab group maps `TRIP_TABS` with `TRIP_TAB_LABEL` in the order Journal (BookOpen) · Agenda (Route) · Ideas (Lightbulb + count). The pill styling is unchanged.
  - :1703: "Add to Agenda · the knowns". The `MenuHead` doc and the Add-menu comment are reworded to match.
- `apps/web/src/components/trip/IdeasLens.tsx:258`: "…it becomes a destination on the Agenda."

**Phone**
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/index.tsx`
  - The local `Tab` type is gone. The screen now uses `TripTab` from core.
  - :188: `picked ?? defaultTripTab(trip, localIsoDate())`.
  - :314: the underline row maps `TRIP_TABS`/`TRIP_TAB_LABEL`. It keeps `tabOn` green, the ideas count, and + Add hidden on Journal.
  - The Segmented sub-lens shows when `tab === "agenda"`.
- `apps/mobile/src/itinerary.tsx:163,180,182`: the `AddSheet` tab prop is now `"agenda" | "ideas"`, and the head reads "Add to Agenda · the knowns".

Comments and identifiers (for example the `src/itinerary` module name and a few `#131` comments) still say Itinerary, as the plan allows.

## Tests
- `packages/core/src/planner/trip-tab.test.ts` (new) covers the wireframe's #177 table:
  - Pacific NW Loop on Jul 20 → agenda; Aug 7 → journal; Aug 29 complete → journal.
  - Inclusive at both ends.
  - Bellingham pinned complete on Nov 14 → journal; Nov 3 → agenda.
  - With `today` null: the status rule alone.
  - The order and labels of `TRIP_TABS`.
- `packages/core/src/mobile-trip-tabs.test.ts` (new, source-reading, the mobile-landing precedent) checks that the phone screen:
  - calls `defaultTripTab(trip, localIsoDate())`;
  - maps `TRIP_TABS`/`TRIP_TAB_LABEL` with `tabOn` and the ideas count;
  - shows Segmented on agenda;
  - has no `"itinerary"` value and no "Itinerary" in comment-stripped source (index.tsx and itinerary.tsx).
- `apps/web/src/components/trip/trip-frame.test.ts`: the #131 guard is rewritten with the change (vet MED), not deleted. It now asserts:
  - the tab row maps `TRIP_TABS` with Journal/BookOpen → Agenda/Route → Ideas/Lightbulb + count;
  - `defaultTripTab(initialTrip, today)`;
  - no "Itinerary" in comment-stripped TripPlanner/IdeasLens;
  - "Add to Agenda · the knowns";
  - page.tsx reads the tz cookie and passes `today={today}` and `now={now}`.

## For the walk / qa
- The web's initial tab is computed from the server-passed `today`, so SSR and hydration agree. With no `tz` cookie (a first visit), the status rule alone applies. On the next load the cookie exists (PrefSync writes it) and an in-progress trip opens on Journal.
- Phone: Pacific NW Loop during Aug 1–28 should open on Journal, and a planning trip on Agenda ▸ Route.
- `mobile-map.test.ts:327-328` still has a comment that says "Itinerary · Ideas · Journal" (comment only, no assertion). I left it alone.

---

# #181 · dev notes · i2 — Google · Apple · Waze on every drive, and the RV route line (#180 · q1 A · q2 A)

This dispatch covers epic item **i2 only**. i1 is already on the branch, and i3–i5 are separate dispatches.

## What changed

**Core**
- `packages/core/src/providers/navigation.ts:128-141`: new `NavigateLinks` interface and `navigateLinks(to)`. It returns the three wireframe URLs (Google `dir/?api=1&destination=…&travelmode=driving`, Apple `?daddr=…&dirflg=d`, Waze `ul?ll=…&navigate=yes`). They are destination only and use the same 4-decimal `coord()`. `buildNavigationHandoff` is unchanged.
- `packages/core/src/planner/index.ts:469-475`: `RouteDrive` gains `navTo`, `fromDestinationId` and **`toDestinationId`**. `toDrive` sets all three at `:510-512` from `pair.to` and `pair.from/toDestinationId`.
  - **Decision (small addition to the plan):** `toDestinationId` is not in the plan. A `RouteDrive` had no way to name its arriving destination, and both clients need that name for "→ Newport, OR". The only other route to the name is matching `navTo` coordinates back to a destination.

**Web**
- `apps/web/src/components/trip/NavigateLinks.tsx` (new) has two exports:
  - `NavigateLinks`: "→ <to name>" in mono `rv-ink-faded`, then three `<a target="_blank" rel="noreferrer">` pills. The pills use `rounded-rv-pill bg-rv-navy-soft … text-[12px] font-bold text-rv-ink` with `min-h-8`.
  - `RvRouteLine`: returns null unless `rigOn`. When rig is on it draws a dashed `border-rv-border-hi` top rule, then the mono uppercase label "RV route · from <name before the first comma>". After the label come a Google pill on `drive.navUrl` (with a `text-rv-green` ✓ only when `navVerdict === "checked"`) and a HERE WeGo pill on `drive.navWegoUrl`. Last is the `navigationCaption(drive)` text, in `text-rv-green` when checked and `text-rv-warning` when plain.
  - The pills sit inline in the drive's top row, as in wireframe frame 5, and the RV line sits below the row.
- `apps/web/src/components/trip/RouteView.tsx`:
  - `:185` builds a destination id → name map from `allDestinations(trip)`, and `driveRow` passes `rigOn={trip.rigOn}` and `names`.
  - `Drive` (`:720`) renders `NavigateLinks` and `RvRouteLine` in both the clean and the restricted branch.
  - `DriveCaption`, `NAV_PILL` and `NavigateButton` are removed, along with the imports only they used (`Navigation`, `ChevronDown`, `DropdownMenu*`, `navigationOptions`/`navigationCaption`). `navigationOptions` stays in core, unused by the UI.

**Phone**
- `apps/mobile/src/navigate.tsx` (new) is the phone twin of the web component:
  - pills use `C.navySoft` / `C.ink`, 12 / 700, `minHeight: 32`, `R.pill`, and open through `Linking.openURL`;
  - the RV line appears under `{rigOn && …}`;
  - captions use `C.green` / `C.warning`.
  - The Google pill copy lives only here, as `mobile-map.test.ts` requires (no /google/i in the trip screen).
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/index.tsx`:
  - `driveRow` (`:215`) passes `rigOn={trip.rigOn}` and from/to names through the existing `destinationName` helper.
  - `Drive` (`:714`) drops the lone Navigate `Button` and the hard-coded amber caption, and renders `<NavigateLinks …/>` (`:742`) between the meta row and the notices.
  - The `⋯` / Segmented trailing now sits at the right end of the meta row.
  - The `Linking` import is removed.
- **Vet HIGH, as decided:** the phone bundle has no NavMap, so every phone drive is `plain`. That means no ✓ and the amber caption, the same as the shipped phone caption. The `checked` branch is kept but cannot render on the phone today. The bundle and the API are unchanged.

Fly and ferry hops render through `HopCard`/`HopRow`, never `Drive`, so they get no Navigate.

## Tests
- `packages/core/src/providers/navigation.test.ts:142`: `navigateLinks({ lat: 44.6046, lng: -124.0645 })` returns exactly the three wireframe URLs, with 4-decimal rounding and no `origin=`. The existing `buildNavigationHandoff` tests are untouched.
- `packages/core/src/planner/planner.test.ts:380`: a `routeModel` drive carries `navTo` equal to the arriving destination's coordinates, plus the right `fromDestinationId` and `toDestinationId`. This holds for an in-chapter drive and for the chapter-boundary `outboundDrive`.
- `apps/web/src/components/trip/navigate-control.test.ts` is rewritten with the change (vet MED) and no longer asserts the retired split control. It now asserts:
  - no `NavigateButton`, `NAV_PILL` or `DriveCaption` remains;
  - `NavigateLinks` and `RvRouteLine` render in both drive branches;
  - `navigateLinks(drive.navTo)` is the only URL source, with no literal URL in the component;
  - "RV route · from" appears only after the `if (!rigOn) return null` guard;
  - the ✓ is tied to `checked`, and the caption comes from `navigationCaption` in green or amber;
  - the pill uses the neutral classes with `min-h-8`, and there is no raw hex.
- `packages/core/src/mobile-navigate.test.ts` (new, source-reading) covers the same points for `apps/mobile/src/navigate.tsx`. It also asserts that the trip screen renders `<NavigateLinks …/>` with `trip.rigOn`, no longer contains `Linking.openURL(drive.navUrl)` or `>Navigate</Button>`, and no longer has the standalone amber string.
- `packages/core/src/mobile-map.test.ts`, two assertions rewritten with the change (vet MED):
  - `:273` now asserts `<NavigateLinks drive={drive}` and the absence of `Linking.openURL(drive.navUrl)`. The /google/i sweep still passes.
  - The Route-lens fragment list swaps the amber caption string for the `<NavigateLinks …/>` call.

## For the walk / qa
- **Render-required (vet FLAG):** the Apple Maps (`maps.apple.com/?daddr`) and Waze (`waze.com/ul`) links must hand off to the native apps on iOS and Android through `Linking.openURL`, and on the web through `target=_blank`.
- **RN dashed single-side border:** the phone RV line uses `borderTopWidth: 1` with `borderStyle: "dashed"`. iOS has historically drawn single-side dashed borders solid or not at all. Check the rule on the iOS simulator. A solid hairline would be an acceptable fallback, but it is the walk's call.
- **Web, rig on, with a cached check:** the Astoria → Newport drive should show "Google ✓" and the green "within N m" caption. Rig off (Bellingham) should show only the three pills: no RV line, no WeGo, no caption.
- **Phone, rig on:** expect the amber caption and no ✓ on every drive, as decided in the vet HIGH.
