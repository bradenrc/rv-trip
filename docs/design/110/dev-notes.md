# #110 · W0 reset — dev notes (item i1, one pass)

Implements `docs/design/110/index.html` (wireframe v0, on `mc/wireframe/issue-110-v0`) plus the vet findings and survey answers (q1–q9 as signed; q8: no data migration, pre-production).

## What changed

### packages/db
- `src/schema.ts` — v2 per §5:
  - New enums `travel_mode`, `lodging_kind`, `save_anchor`. `saved_place_status` is now `save_status`, and `change_entity` has `save` in place of `savedPlace`.
  - `trips` gains `default_mode`, `lodging_default` and `rig_on`.
  - `travelSegments` (:200). `reservations` now has a nullable `stop_id`, plus `segment_id`, `starts_at`/`ends_at` and `starts_tz`/`ends_tz`, and the CHECK `reservations_one_parent` (:250).
  - `destinations` (:259), with UNIQUE `(owner_id, google_place_id)`.
  - `saves` (:284), which was `saved_places`; it adds `anchor`, `area_label` and `destination_id`. Relations are updated to match.
- `drizzle/`: 0000–0009 and their snapshots are deleted. `drizzle-kit generate --name v2` produced one `0000_v2.sql`, and the journal has one entry.
- New `src/reset.ts`, with a `reset` script (root: `db:reset`):
  - It prints `host/db` without credentials, then refuses with exit 1 unless `--yes` is passed.
  - With `--yes` it drops the `drizzle` and `public` schemas and recreates `public`.
- `src/baseline.ts` is deleted, and so are the `baseline` and `db:baseline` scripts.
- `src/queries.ts`:
  - `TRIP_WITH` loads `segments` with their reservations (:75). `stop.reservations` holds only stop-attached rows through the `stop_id` relation.
  - `mapTripRow` carries `defaultMode`, `lodgingDefault`, `rigOn` and `segments`. `mapSegment` (:346) and `mapReservation` turn timestamptz into ISO strings.
  - The dashboard keys and `milesEstimated` use `drivePairs` (:401, :441).
  - `entityIsOwned` handles `save`, and handles a reservation whose parent is a segment.
- `src/mutations.ts`:
  - Adds `loadSegmentTrip`, `writeSegments` and `syncSegments` (:185), and `class SegmentDateMismatch` (:102).
  - These writers persist the `reconcileSegments` diff in the same transaction: `createStop`, `deleteStop` (:690, re-points before the cascade), `reorderLegStops`, `reorderTripLegs`, `deleteLeg` (:482), `updateStopFields` (:562, see the vet HIGH below) and `updateTripFields` (:373, when `homeBase` is in the patch).
  - `createSavedPlace` is renamed `createSave` (:1145) and uses `saveAnchorOf`: place if there is a Google place id, pin if there are lat/lng, otherwise area with `area_label = region`.
- `src/seed.ts` now writes the core seed trips (below) generically: local id → uuid, then segments, then stop- and segment-attached reservations. The 8 library rows go into `saves` with `anchor: "pin"`.
- `saved_places` → `saves` renamed in `locate.ts`, `reown.ts`, `places-cache.ts`, `testing/fixtures.ts` and `testing/truncate.ts`. Truncate now also clears `travel_segments` and `destinations`.
- Fixtures gained `fx.segment` and `read.segments`.

### packages/core
- `domain/types.ts`:
  - New `travelMode`, `lodgingKind` and `segment`.
  - `reservation` has a nullable `stopId`, plus `segmentId` and `startsAt`/`endsAt`/`startsTz`/`endsTz`.
  - `trip` gains `defaultMode`, `lodgingDefault`, `rigOn` and `segments`.
  - `changeEntity` uses `save`.
- New `domain/segments.ts`: `reconcileSegments` (:52), `diffSegments`, `withReconciledSegments`, `localDate`, `segmentDateConflicts` (:165) and `newSegmentDateConflicts`.
- `domain/derive-days.ts` v2 (§4): `DayKind = "stay" | "travel" | "empty"` (:31). Travel cells carry `mode`, `segmentId`, `fromStopId` and `toStopId`. The signature is now `deriveDays(range, stops, segments)`.
- `domain/route-order.ts`:
  - `RouteStop`, and `orderedStops` is now generic.
  - `OrderedPair.mode` (:98) reads the pair's segment. A pair with no segment row falls back to `trip.defaultMode`, which is exactly the mode reconcile would give it.
  - New `drivePairs` (:110).
- `planner/index.ts`:
  - `KIND_COLOR` is keyed `travel` (:117). Rhythm cells carry `mode`, with the title `<date> — <Drive|Fly|Ferry> → <stop|home>`.
  - `TimelineBar.arriveMode` (:200). The drive rows use `drivePairs` (:469).
  - Every structural pure helper runs `withReconciledSegments`: `appendStop`, `removeStop`, `removeLeg`, `moveLeg`, `moveStopToLeg`, `setStopDates`, `scheduleFloating` and `reorderFloating`. So TripPlanner's optimistic trips reconcile.
- `theme/tokens.ts` — `dayKindColor` uses `case "travel"`, and its values are unchanged.
- **New `src/seeds/index.ts`** (export `@rv-trip/core/seeds`): PNW (kept as seeded), the 3 secondary trips, Costa Rica and Greece as pure `Trip` data. Segments are built through `reconcileSegments` and then patched with modes and times. The one exception is `seg_home`, which is appended by hand because reconcile never invents a → home row.
- `api-client/schemas.ts` and `domain/leaf-form.ts` are adjusted for the nullable `stopId` and the new reservation fields.

### packages/ui — `src/Gantt.tsx`
- `RhythmStrip` (:45): optional `cells[i].mode`. On fly/ferry the cell is `dark flex items-center justify-center text-rv-ink-muted` with a centred `size-3` lucide Plane or Ship.
- `StopBar` (:160): optional `arriveMode`.
  - `undefined` keeps today's navy edge.
  - `null` draws no edge.
  - fly/ferry keep the edge and add a `size-2.5` glyph before the range, in the range's `text-rv-green`.
- `GanttLegend` (:299): Drive day · Fly day · Ferry day · Stay day · Open — needs a plan · Navy edge = arrival. The fly/ferry swatches are a navy `dark` island holding the glyph.
- Required props are unchanged. No new token and no raw hex.
- `.design-sync/previews/RhythmStrip.tsx` gains `FlyAndFerry`, and `StopBar.tsx` gains `ArrivedBy`.

### apps/web
- `api/stops/[id]/route.ts` returns 409 `{ error: "segment_date_mismatch", segmentId, expected, actual }` and writes nothing.
- `lib/routing.ts:234` (`routeTrip`) and `TripPlanner.tsx:1121` (the missing-route check) use `drivePairs`. Map arcs keep `orderedPairs`.
- TripPlanner's settings save reconciles when the home base changes (:931). The reservation edit/delete/restore paths take the parent from the open stop now that `stopId` is nullable.
- `Timeline.tsx:143` passes `arriveMode`.
- `/places`: the API calls `createSave`, and `PlacesLibrary` uses `entity="save"`. The UI and copy are unchanged.

### apps/mobile — `app/trips/[id]/index.tsx`
- `kind === "travel"` (:164). Fly/ferry cells centre a 9px ✈/⛴ in `C.inkMuted`.
- The legend reads Stay · Drive · Fly · Ferry · Open; the row now wraps.

## Vet findings — how each was addressed
- **HIGH (writers leave stale segments):**
  - `updateStopFields` reconciles whenever the patch has `legId`, `sortOrder`, `arriveDate` or `departDate`. It runs the Q3 check on the reconciled would-be trip, and a "Move to leg" into another trip syncs that trip too.
  - `updateTripFields` reconciles when `homeBase` is in the patch.
  - The client side is covered by core's structural helpers plus the settings save.
  - `drivePairs` additionally falls back to `defaultMode` for a pair with no row yet.
  - Tested in `apps/web/src/test/segments.test.ts`: re-date, Move to leg, clearing the home base, create, delete, and leg reorder/delete.
- **MED (segment_date_mismatch unfinished):**
  - (a) Client: no new UI or copy. `tripApi.updateStop` rejects on any non-2xx, so `persist()` rolls the change back and shows the gesture's existing error toast (for example "Couldn't save those dates — X is back where it was."). The 409 JSON carries the details for a future surface; W2 (#112) owns segment editing.
  - (b) A floating endpoint is **exempt**, not a conflict, so Unschedule next to a flight works. Tested in core (`segments.test.ts`) and web (`segments.test.ts`, "exempts a floating endpoint").
  - Only conflicts the write *introduces* are refused (`newSegmentDateConflicts`). An older conflict, such as one left by a leg reorder re-pointing a timed → home row, does not lock unrelated edits.
- **MED (seed test has no runner):** the seed shapes are pure data in `@rv-trip/core/seeds`. `seed.ts` writes them, and `packages/core/src/seeds/seeds.test.ts` asserts zero conflicts, that they are already dense, the defaults, and the gantt bars.
- **MED (bigger rename/delete surface):**
  - Every `savedPlaces`/`saved_places` reference and every `"savedPlace"` literal is renamed. That covers locate, reown, places-cache, the fixtures, `PlacesLibrary`, history, change-log and the join test.
  - `truncate.ts` now includes `travel_segments` and `destinations`.
  - The root `db:baseline` script is replaced by `db:reset`.
  - Old migration-file tests are repointed to `0000_v2`: `households-schema.test.ts`, `change-log.test.ts` and `prefs-account.test.ts`. The 0007 owner-backfill assertion was removed, because that data migration no longer exists (Q8 A).
- **FLAGs** — see "for the walk" below.

## Decisions / defaults
- Timed segment span: every local date from `localDate(departAt, departTz)` to `localDate(arriveAt, arriveTz)`. A null tz reads as UTC.
- An untimed segment takes the date of the endpoint that gives it one: `to.arriveDate`, or `from.departDate` when it goes home. So an untimed hop *from* a floating stop into a scheduled stop still lands on the arrival, which keeps v1 behaviour.
- `timestamptz` columns use drizzle's Date mode, so the wire carries `…T13:05:00.000Z`.
- Greek hotel names and the Conchal/Greek coordinates are illustrative seed data; the wireframe gave only "one hotel per stop".
- Client-side optimistic hops get random ids, and the next server read replaces them.
- There is no DOM render test for the Gantt changes: `packages/ui`'s vitest has no React renderer. The visuals are for the walk.

## For the walk / qa to check
- **The walk DB must be rebuilt from v2.** Any DB that still has the 0000–0009 journal fails on `0000_v2`. Rebuild with `pnpm db:reset --yes && pnpm db:migrate && pnpm db:seed` (then `db:reown`), and rebuild the walk template.
- **Operator steps at merge (§8)** are operator-owned and not run by me:
  1. `pnpm --filter @rv-trip/db reset --yes` against Neon main.
  2. Delete the stale Neon preview branches.
  3. Redeploy the preview.
  4. Merge, then `pnpm --filter @rv-trip/db seed` and `reown`.
- Render-check the 12px glyph in RhythmStrip cells on the 28-day PNW trip at phone width (no glyph there — all drive), on Greece and Costa Rica, and native's 9px glyph in 16px cells. Also check the `dark`-island contrast in light mode.
- Costa Rica: Conchal's bar spans Jan 16–23 and reads "Jan 16–24" with a Plane. Jan 24–25 show fly with the tooltip "Fly → home".
- Greece: the first Athens bar has no navy edge. The route lens shows no drive connector or Navigate between Greek stops. Map arcs still draw.

## Checks run
- `DATABASE_URL=postgres://rvtrip:rvtrip@localhost:5433/rvtrip pnpm turbo run lint typecheck test --force` → `Tasks: 10 successful, 10 total` (core 1000+ tests, web 280+ integration tests against a fresh migrated DB, ui, mobile typecheck).
- Scratch DB `rvtrip_w0dev110` (my own, dropped afterwards):
  - `drizzle-kit migrate` succeeded, then `tsx src/seed.ts` printed "Seeded 6 trips + 8 saves." It wrote 16 segments; reservations were 10 total, 8 on stops and 2 on segments; saves were 8 × `pin`.
  - The CHECK and UNIQUE constraints rejected bad rows.
  - `reset.ts` without `--yes` exited 1, and with `--yes` exited 0. After that, 0 tables remained, and a re-migrate succeeded.
