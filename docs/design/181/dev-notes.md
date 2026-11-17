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
