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

---

# #181 · dev notes · i3 — Core: upNext and journalToday (#178 · q3 B · q4 B)

This dispatch covers epic item **i3 only**. It is core only: no client renders these yet (i4/i5 wire them). i1 and i2 are already on the branch.

## What changed

- `packages/core/src/planner/up-next.ts` (new) exports `UpNextKind`, `UpNextItem` and `upNext(trip, now, today)`, with the exact shapes the plan gives.
  - `stayItems` (`:87`): each Stay-category reservation (`categoryOf(type).cat === "Stay"`, so campground and lodging) on a scheduled destination gives a check-in and a check-out. Each is timed from `startsAt`/`endsAt` in its own zone when set, and untimed on `checkIn`/`checkOut` otherwise.
  - Other destination reservations become a "booking" only when they have a `startsAt`. Its `when` is "<day> · <clock>" with no zone.
  - `hopItem` (`:112`) handles a segment. It is timed by `departAt`/`departTz`, else by its first reservation with a `startsAt`. Untimed, it takes the first date from `segmentDates`. A hop with no date is skipped (for example, into a floating destination).
  - `upNextItems` (`:138`) orders the items. It sorts by date first, then a slot: untimed check-out, then timed items by instant, then untimed check-in. Untimed hops are then spliced in right after their date's last check-out, or the last untimed hop already placed on that date. A date with neither gets the hop at the start of the date.
  - `upNext` (`:189`): an item has passed when it is timed with instant ≤ now, or its date is before today. `next` is the item after the last passed one. `then` is the following item, but only when it is a hop on `next`'s date.
- `packages/core/src/planner/stay-clock.ts:28`: `wallClock12` is now exported (doc comment notes why).
- `packages/core/src/planner/index.ts:72`: `export * from "./up-next"`.
- `packages/core/src/planner/journal.ts`:
  - `:413`: new `JournalEarlierGroup` and `JournalToday` types.
  - `:430`: `unratedOf`, the `toRate` rule (`isRateableReservation` true, and `rating` and `again` both null).
  - `:451`: `journalToday(trip, today)`, as specified. It imports `weekdayMonthDay` from `./dates` for "Fri Aug 7".

## Decisions and defaults (qa, please check)

- **Vet MED addressed:** Earlier includes a past scheduled destination when `tripJournal` has a group for it **or** its `toRate` is non-empty. Such a destination's `entries` is `[]`, and its own `rating`/`again` are still passed through.
- **Earlier is ordered by `destinationsInDateOrder` reversed**, so the latest arrival comes first. On a changeover day, today's destination is the one being arrived at (the `captureTarget` rule). The one being left appears in Earlier because its arriveDate is earlier.
- **Around the trip in Earlier** only appears when today has a destination. When it has none, the shelf entries are Today's `entries`, so they are not shown twice.
- **Defaults the plan didn't spell out:**
  - An untimed stay with a null `checkIn`/`checkOut` falls back to the destination's `arriveDate`/`departDate`.
  - A drive or untimed hop going home is titled "Drive to <trip.homeBase>", or "Drive to home" when there is no home base. It has `navTo` null because home has no coordinates on the trip's segments.
  - A fly or ferry hop with no reservation is titled "Fly to"/"Ferry to" + the arriving destination's name, or the home base.
- **`sameDay`** means `date === today`. The plan names the field but not its rule, and this is the reading that makes "TODAY" and `sameDay` agree.
- **Zone abbreviation:** `Intl.DateTimeFormat("en-US", { timeZoneName: "short" })`. America/Los_Angeles gives "PST"/"PDT". Zones without a common US abbreviation print as "GMT+N", which is ICU's behavior.
- **`date`** comes from `isoDateInZone(instant, tz ?? "UTC")`, with a UTC slice fallback for an invalid zone.

## Tests

- `packages/core/src/planner/up-next.test.ts` (new, 8 tests) covers all six rows of the wireframe's #178 table on the two fixtures from the plan. The Loop fixture is `pnwTrip()` with KOA out at 11:00 AM and South Beach in at 4:00 PM / out at 11:00 AM in LA. The Bellingham fixture is built by hand, with the Blaine Airbnb out at 11:00 AM and a SEA → BOI booking at 6:10 PM on the home segment. Extra cases:
  - the untimed seed (check-out opens the day, and the drive follows);
  - "Fly to Boise, ID" with no booking;
  - a timed tour as a "booking".
  - Drive kinds are asserted as `expect(x?.kind).toBe("drive")`, not inside an object literal. `src/w0-reset.test.ts` regex-bans the literal pairing repo-wide as a DayKind guard, and it caught my first draft.
- `packages/core/src/planner/journal.test.ts`, new `journalToday` describe (5 tests):
  - Aug 7: heading "Today · Fri Aug 7 · Newport, OR", earlier [Astoria].
  - Aug 10: heading "Today · Mon Aug 10 · Around the trip", earlier [Newport, Astoria].
  - An unrated KOA is in Astoria's `toRate`; a rated one is not.
  - The vet-MED case: Astoria with no rating and only an unrated KOA is absent from `tripJournal` but present in Earlier with `toRate` [KOA].
  - Around the trip closes Earlier only when today has a destination.
- Honesty note: I wrote the implementation before the tests in this item, so they were not watched failing first.

## For the walk

Nothing renders yet. This item is pure core, and nothing in either client calls `upNext` or `journalToday` until i4/i5.

---

# #181 · dev notes · i4 — the mid-trip Journal on both clients (#178 · q3 B · q4 B · q5 A · q8 A)

This dispatch covers epic item **i4 only**. i1–i3 are already on the branch. i5 (the Journal map, #179) is a separate dispatch, so "Whole trip and map →" opens the shipped whole-trip Journal, which has no map yet.

## What changed

**Core (small additions the clients need)**
- `packages/core/src/planner/index.ts:697`: new `routeDrives(chapters)` returns a `Map<segmentId, RouteDrive>`. It reads each row's `drive` plus each chapter's `outboundDrive` (the vet MED fix, since `routeModel` returns chapters and has no `.drives`). Drives with a null `segmentId` are left out. Only driven pairs are in it, so a fly or ferry segment is never a key.
- `packages/core/src/planner/up-next.ts:223`: new `upNextThenLine(then)`. It returns "Then · Drive to Newport, OR", or "Then · Fly SEA → BOI · 6:10 PM PST" when the hop is timed. `then` is always on `next`'s date, so the day half of `when` is dropped. This matches wireframe frames 3a and 3c.
- `packages/core/src/planner/journal.ts:96`: `reservationEntry` is now exported. A `toRate` row uses it to open the shipped sheet.

**Phone**
- `apps/mobile/src/journal.tsx:204` `JournalView` gains `today`, `now`, `drives` (a `ReadonlyMap`) and `onLog`. It sets `midTrip = activeTrip([trip], today) !== null` and keeps a visit-local `whole` flag.
  - `:249` `JournalTodayView` renders:
    - the "Up next" kicker and card, only when `upNext` is non-null. The card has the bold title and the `when` in mono uppercase `C.inkMuted`. It shows `NavigateLinks` when `next.navTo` is set and the drive is in `drives`. Below that come the mono "Then ·" line and the `NavigateLinks` for a drive `then`.
    - the Today kicker (`C.ink`, 700) with `journalToday`'s heading, then EntryRows plus `toRate` rows. With neither, it shows "Nothing logged here yet."
    - the green "＋ Log something" (`C.green` fill, `C.navy` text), which calls `onLog`.
    - the Earlier groups.
    - "Whole trip and map →" (`C.greenInk`, underlined), which sets `whole`.
  - `:338` `WholeTripJournal` is the shipped Journal, unchanged. Mid-trip it gets a "‹ Today" link at the top.
  - `:436` `EntryRows` takes optional `toRate` rows. Each has a "How was it?" pill (border `C.borderHi`, text `C.greenInk`) that calls `onOpen(reservationEntry(r))`. That is the trip screen's existing `setJournalEntry`, which opens the shipped `HowWasItSheet` and its queued PATCH.
  - New styles start at `:672`.
- `apps/mobile/app/(tabs)/(trips)/trips/[id]/index.tsx`:
  - `:155` `drives = routeDrives(chapters)`;
  - `:158` `useFocusEffect` refreshes `now`;
  - `:372` passes `today={localIsoDate()} now drives`;
  - `:383` `onLog={() => router.push("/capture")}`.

**Web**
- `apps/web/src/components/trip/JournalLens.tsx:37` gains `today: IsoDate | null`, `now: string` and `drives`.
  - The clock starts at the server's `now`, so the first paint matches. `setInterval` re-reads `new Date()` every 60 s after mount (`:59`).
  - `midTrip` requires `today !== null`.
  - `:84` `JournalTodayLens` is the same form in the left column (`md:grid-cols-[minmax(300px,420px)_1fr]`), and i5 fills the right column with the map. The card's drives get `NavigateLinks` and `RvRouteLine`. Log something is `bg-rv-green … text-rv-navy` on one line and dispatches `rv:capture` (`:147`).
  - It never reads `toRate` and draws no pill, so the web stays read-only.
  - Earlier keeps a group only if it has entries or its own ★/Again. Without that filter, a group that exists only for `toRate` would show an empty header.
  - `:183` `WholeTripLens` is the shipped lens, with "‹ Today" when mid-trip.
- `apps/web/src/components/nav/Nav.tsx:58-64`: a `useEffect` adds and removes a `window` `"rv:capture"` listener that calls `setCapturing(true)`, which opens the shipped `CaptureSheet`.
- `apps/web/src/components/trip/TripPlanner.tsx`:
  - `now` is now destructured;
  - `:458` `drives = routeDrives(route)`;
  - `:1768` passes `today`, `now ?? new Date().toISOString()` and `drives`. `page.tsx` always passes `now`, so the fallback exists only for other callers.

## Decisions and deviations (qa, please check)
- **`kind === "drive"` is banned repo-wide** by `w0-reset.test.ts` (the DayKind guard). The plan said "NavigateLinks when then is a drive". I implemented that by looking `then.segmentId` up in `drives`, which holds only driven segments. A fly or ferry `then` finds nothing and gets no Navigate. A drive whose RouteDrive is missing (for example an optimistic pair with no segment yet) also gets no Navigate, rather than three pills built some other way.
- **Today shows `toRate` rows on the phone**, as the plan says. Wireframe frame 3a (Aug 5) draws Today as "Nothing logged here yet." even though South Beach is unrated. With the plan's rule, Aug 5 Today shows South Beach with a "How was it?" pill. That gap between the plan and the frame is for the walk to judge.
- **Acceptance wording:** the acceptance says journal.tsx "pushes /capture" and "opens HowWasItSheet". As the plan's own `onLog` prop implies, the push lives in the trip screen's `onLog`, and the sheet stays mounted once in the trip screen. The source tests pin both halves: journal.tsx calls `onLog` and `onOpen(reservationEntry(r))`, and index.tsx pushes "/capture" and shows `HowWasItSheet` for `journalEntry`.
- **Web type scale:** the shipped web Journal draws about 1.1× the phone (14 px rows against 12.5). The new web elements follow that scale: 15 px titles and CTA, 10.5 px kickers, 11 px when, 13 px links. The phone uses the wireframe's pixel values directly.
- **Phone shadow:** the Up next card's shadow-rv-sm is `shadowOpacity/Radius/Offset` plus `elevation: 1`, with no `shadowColor`. iOS defaults the colour to black, and leaving it out keeps raw hex out of the file.
- **Web `today`** is the server's tz-cookie date and is not re-derived on the 60 s tick. Only `now` moves. A page left open past midnight keeps yesterday's Today until it reloads.

## Tests
- `packages/core/src/planner/planner.test.ts`: `routeDrives` keys the in-chapter drive and the boundary drive by segment, one entry per drawn drive.
- `packages/core/src/planner/up-next.test.ts`: `upNextThenLine` covers the untimed drive (Aug 5) and the timed flight (Nov 15).
- `packages/core/src/mobile-journal-today.test.ts` (new, source-reading, 10 tests) checks:
  - the `activeTrip` gate and the `whole` flag;
  - the `upNext`, `journalToday` and `upNextThenLine` calls;
  - Navigate on next and then;
  - Up next only when non-null;
  - Log something in `C.green` with `C.navy` text, wired to `onLog`, and the trip screen's push to "/capture";
  - the "How was it?" pill (`C.borderHi` / `C.greenInk`) calling `onOpen(reservationEntry(r))`, plus the trip screen's `HowWasItSheet` wiring;
  - "Whole trip and map →" and "‹ Today";
  - the empty copy;
  - the trip screen passing `today`, the focus-refreshed `now`, `drives` and `onLog`.
- `apps/web/src/components/trip/journal-today.test.ts` (new, 8 tests) checks:
  - JournalLens's gate, its `upNext`/`journalToday` calls, and the 60 s clock with its `clearInterval`;
  - Log something's `bg-rv-green … text-rv-navy` and its `rv:capture` dispatch;
  - no `toRate` and no "How was it?";
  - Navigate on the card;
  - the swap both ways;
  - TripPlanner's props;
  - Nav adding and removing the `rv:capture` listener and still rendering `CaptureSheet` on `capturing`.
- Honesty note: the two source-reading suites were written first and watched failing (10/10 and 7/8 red), then the code was written. The two core helpers' tests were written alongside them. `routeDrives` was implemented before its test.

## For the walk
- **Phone, Pacific NW Loop, Aug 5 09:00.** Up next reads "Check out of Astoria/Warrenton KOA · TODAY · OUT BY 11:00 AM", then "THEN · DRIVE TO NEWPORT, OR" with Google · Apple · Waze. Rig is on, so the RV route line shows the amber caption and no ✓ (the i2 vet HIGH). Earlier shows Astoria, and the KOA row has a "How was it?" pill that opens the sheet.
- **Log something.** On the phone it opens `/capture`. On the web it opens Nav's CaptureSheet, and the logged row should appear under Today: through `rv:captured` on the web, and through the store on the phone.
- **Swap.** "Whole trip and map →" swaps in place, and "‹ Today" swaps back. Switching tabs resets it, because the swap lasts for the visit only.
- **No Mapbox map yet.** The map is i5.

---

# #181 · dev notes · i5: the Journal map (#179 · q5 A · q6 A · q7 A)

This dispatch covers epic item **i5 only**. i1–i4 are already on the branch. With it, "Whole trip and map →" now opens a whole-trip Journal that has its map.

## What changed

**Core**
- `packages/core/src/planner/journal-map.ts` (new): `JournalMapPoint` (`:30`) and `journalMap(trip, today)` (`:50`). It returns `{ points, join, unmapped }` and makes no fetch or routing call.
  - **Destination points:** `tripDestinationPins`, filtered to the destinations `tripJournal` lists.
    - Mid-trip (`activeTrip` covers `today`), only destinations with `arriveDate ≤ today` are kept. Today's destination (`todaysDestination`) is kept even if nothing has been logged there yet.
    - `ordinal` is `scheduledOrder`'s.
    - `been = today === null || departDate < today`.
  - **Entry points:** the listed **idea** entries (each listed destination's ideas plus Around the trip) whose `idea.place` has coordinates, with `category = categoryOf(saveTypeOfIdeaCategory(idea.category)).cat`. Reservation entries get no pin.
  - **`join`:** scheduled destination points in ordinal order (which is arrival order), as `[lng, lat]`.
  - **`unmapped`:** the shown destinations plus the shown idea entries that have no coordinates.
- `packages/core/src/planner/index.ts:74`: `export * from "./journal-map"`.

**Web**
- `apps/web/src/components/map/pins.ts:126`: `IdeaPin.category?: CategoryLabel`.
- `apps/web/src/components/map/MapMount.tsx:57`: `join?` is passed through to MapView.
- `apps/web/src/components/map/MapView.tsx`:
  - `:73` adds the `join?` prop.
  - `:278` draws it as a `<Source id="rv-journal-join">` with one dashed line layer: `palette.arcLine` / `arcWidth` / `arcOpacity`, dash `[2.2, 1.8]`, no casing, no label, and only when `join.length > 1`.
  - `:532` `IdeaRing` takes `category`. When it is present the 11px disc is filled with `palette.category[category]` on a `hollowGround` ring, as in wireframe frame 5. When it is absent the shipped Do ring is unchanged.
- `apps/web/src/components/trip/JournalMap.tsx` (new):
  - maps `journalMap` points onto `DestinationPin` (layer `"been"` when been, else the trip's layer) and `IdeaPin` (with `category`);
  - renders the shipped `MapMount` with `join`, `unmappedCount`, `selectedId`/`onSelect` and `showLabels={false}`, under a mono kicker;
  - is `order-first … md:order-none`, so it sits above the list below md, at `h-[200px]`. From md it is `md:min-h-[440px] md:flex-1`.
- `apps/web/src/components/trip/JournalLens.tsx`:
  - `:74`: one `grid grid-cols-1 gap-4 md:grid-cols-[minmax(300px,420px)_1fr]` now wraps **both** forms. The list is in the left column and `<JournalMap>` (`:96`) is in the right. The map is omitted when `journalIsEmpty(tripJournal(trip))`.
  - The kicker reads "The trip so far" mid-trip and "Everything logged on this trip" otherwise, as in the wireframe.
  - The Today form's own inner grid and the whole-trip form's old `md:grid-cols-[320px_1fr]` are removed. The whole-trip left column is now trip card, tally, groups and folds, as in frame 5.
  - **Selection:** `:68` `selectedId` state.
    - A destination heading is a `GroupHead` button (`:349`) that selects its disc. This covers Today's heading when today has a destination, Earlier headings and whole-trip headings.
    - An idea row selects its pin (`JournalRows`, `:369`).
    - A selected pin lights its row or heading with `SELECTED` (`:115`), the wireframe's `.row.sel`: `bg-rv-navy-soft shadow-[inset_3px_0_0_var(--color-rv-ink)]`.
    - Reservation rows have no pin, so they are not selectable.

**Phone**
- `apps/mobile/src/map.tsx`:
  - `TripMapPin = TripDestinationPin & { been? }` (`:337`) and `TripMapEntry` (`:341`).
  - `TripMapProps` gains `join?`, `entries?`, `selectedId?` and `onSelect?` (`:376`).
  - Drawing:
    - The join is a second `ShapeSource id={JOIN_ID}` (`"rv-journal-join"`, `:461`) with one `joinDash` LineLayer (`:267`). It uses the estimate's paint, with no casing.
    - Entries are 11pt category discs: `palette.category[cat]` on a `hollowGround` ring, 15pt with `selStroke` when selected.
    - Discs and entries are wrapped in `Pressable` when `onSelect` is given.
    - `DestinationDisc` (`:606`) now draws `been` hollow and selected with `selStroke`/`selFill`/`selInk`, matching the web.
  - The camera fits to entries too.
  - The map is empty only when there are neither pins nor entries (`:425`).
- `apps/mobile/src/journal.tsx`:
  - `JOURNAL_MAP_PREF_KEY = "rv-journal-map"` (`:345`).
  - `useJournalMapChoice` (`:362`) follows the `useStyleMode` pattern. It is null until AsyncStorage answers. Anything except `"list"` means Map, so Map is the default (q7 A). Each change is written back.
  - `JournalMapBlock` (`:391`):
    - It is a 196pt `TripMap` with no labels and no style pill, following the stored style preference.
    - A mono `Segmented` "Map · List only" sits absolutely at left 8 / top 8 over the map.
    - With List only, the Segmented renders alone above the list.
    - While the pref or the style is unread, it shows `MapFrame state="loading"`. TripMap's own frames cover "unavailable" and "empty".
  - `WholeTripJournal` gets `today` and renders the block at `:469` under "‹ Today" and above the trip card, only when the journal is not empty.
  - Selection:
    - Destination headings are now `Pressable`s that select the disc.
    - An entry row selects and then opens the shipped sheet, as before.
    - Both light with `sel` (`:853`): `C.navySoft` with a 3pt `C.ink` left border, the RN reading of `.row.sel`.

## Decisions and defaults (qa, please check)
- **Reading of "limited to … (and, mid-trip, today's and earlier)":** mid-trip, the drawn set is the journal-listed destinations that have arrived by today, plus today's destination. The acceptance requires Bend to be absent on Aug 7 even when Bend has logged entries, which rules out reading it as a union. Today's destination is added so that the wireframe's filled "you are here" disc exists even before anything is logged there.
- **`category` is `RvCategory`**, core's own copy of ui's `CategoryLabel`, which has the same five strings. Core cannot import `@rv-trip/ui`. A destination point is `"Other"`.
- **The shipped map guards were rewritten with the change, not deleted** (`packages/core/src/mobile-map.test.ts`):
  - The "ONE ShapeSource" guard now asserts exactly one `<ShapeSource id={SOURCE_ID}`, so drives still live in one source. It allows exactly one more source, `JOIN_ID`, which is never a drive.
  - The LineLayer count is now 3 for drives plus 1 overall for the join.
  - The `line-cap: round` count goes from 3 to 4 on both clients.
- **Web selection affordance for headings** reuses `.row.sel` (navy-soft plus ink bar). The wireframe's `.sect.sel` only switches the text to ink, and shipped headings are already ink, so that would be invisible.
- **Web map height from md:** I followed the wireframe literally (`min-height: 440px; flex: 1` in a stretched grid cell). On a long Journal the map grows as tall as the list. I added no sticky behaviour, which would be a design call.
- **Phone row tap:** a row both selects its pin and opens the shipped "How was it?" sheet, as it did before. Pin-to-row selection lights the row but does not scroll to it.
- **Phone empty frame** has no count. The plan gives TripMap no `unmappedCount` prop. The web's frame shows `journalMap`'s `unmapped`.
- No Bellingham `journalMap` case. The design's "Done when" names it, but this item's acceptance lists only the Loop.

## Tests
- `packages/core/src/planner/journal-map.test.ts` (new, 7 tests). Written first and watched red (module missing). The Loop fixture has Fort George (Eat, pinned), the aquarium (Do, pinned, done ★4) and the Deschutes float (done, no place). It covers:
  - Aug 29: points 1·2·3, all been, joined Astoria → Newport → Bend. Entry points are only fortgeorge/Eat and aquarium/Do (not the unlogged Cape Kiwanda). `unmapped` = 1.
  - Aug 7: Bend absent, Newport `been=false`, a two-point join, `unmapped` = 0.
  - `today` null: everything is been.
  - A coordless Bend: counted in unmapped (2) and dropped from the join.
  - An empty journal gives `{ points: [], join: [], unmapped: 0 }`.
  - A source check that `journal-map.ts` has no routeTrip, fetch or providers/routing import.
- `apps/web/src/components/trip/journal-map.test.ts` (new, 9 tests, source-reading) checks:
  - JournalMap reads `journalMap(trip, today)` with no request, does the pin mapping (been layer and category), and passes the MapMount props;
  - JournalLens has one `md:grid-cols` split wrapping both forms, the map after the form switch, the map omitted when empty, the stacking classes, and the selection state and style;
  - MapMount and MapView pass `join` through and draw the dashed layer at the arc paint;
  - `IdeaPin.category?` and `palette.category[category]`.
  - These were written before the code but not run red first.
- `packages/core/src/mobile-journal-map.test.ts` (new, 8 tests, source-reading). Written first and watched red (7/8). It checks:
  - TripMap's new props, the join ShapeSource and `joinDash` paint, category entry discs, and the empty rule;
  - journal.tsx reads and writes `"rv-journal-map"` with a `"map"` default, the "Map · List only" mono Segmented, the `TripMap` call at 196 with `showLabels={false}` and selection, the loading frame, the `journalIsEmpty` gate, and no fetch or routeTrip.
- `packages/core/src/mobile-map.test.ts`: two guards rewritten, as described above.

## For the walk
- **Render-required (vet FLAG):**
  - The phone map is 196pt inside the trip ScrollView. Check pan versus scroll.
  - Check that the Map · List only pill persists across relaunch under `rv-journal-map`.
  - On the web, check the md split and, below md, the 200px stack above the list.
  - Check the dashed join on both clients, and selection both ways.
- **Phone:** Pacific NW Loop after Aug 28 should open on Journal with the map. Mid-trip, "Whole trip and map →" shows the map with today's disc filled and earlier discs hollow. List only should be remembered.
- **Web:** both forms put the map on the right. Clicking an idea row or a destination heading rings its pin, and clicking a pin lights its row or heading.
