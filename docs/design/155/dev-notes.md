# #155 · dev notes — Destinations, Chapters, Logistics

Implements the signed wireframe (`mc/wireframe/issue-155-v0:docs/design/155/index.html`) with the
survey answers Q1 A · Q2 A · Q3 B · Q4 A · Q5 B · Q6 A, in one pass, and addresses every vet finding.

## What changed

### Q5 B — the full rename (destinations → areas, then stops → destinations, then legs → chapters)
- I ran a scripted rename that splits identifiers into subwords, across `apps/`, `packages/` and
  `.design-sync/` (previews + md). It covers camel, Pascal, snake and UPPER case, plurals, and
  file and directory paths. `legend`, `legal`, `stopped`, `stopPropagation`, routing-sense
  "destination" (Google Routes, nav URLs, `next.config` redirect) and flight-sense "leg"
  (`AddFlightSheet`, `round-trip.tsx`, the mobile `styles.leg`) were shielded. Then I fixed the
  verb-sense stragglers by hand (for example "Stop changing the place for …" and "fuel stop").
- Paths moved: `api/destinations/resolve → api/areas/resolve`, `api/stops → api/destinations`,
  `api/legs → api/chapters` (including `[id]/reorder`), and `api/trips/[id]/legs/reorder →
  …/chapters/reorder`. Mobile: `trips/[id]/stops/[stopId] → trips/[id]/destinations/[destinationId]`.
  Web: `StopDetailSheet → DestinationDetailSheet` and `StopMiniMap → DestinationMiniMap`. DS:
  `StopBar → DestinationBar` and `FloatingStopCard → FloatingDestinationCard` (src, index.ts,
  `.design-sync/previews`). `ds-bundle/` was not touched.
- The shared phone client `packages/core/src/api-client/{index,schemas}.ts`,
  `apps/web/src/lib/area-label.ts` (`/api/areas/resolve`), map pin `kind: "destination"`, and
  `changeEntity` `"destination"` (so `/api/history` accepts it) all came with the rename. Vet MED:
  the rename map is complete.
- Capture queue (`packages/core/src/capture/queue.ts`, about lines 150–170): a phone may still hold
  items queued before the rename. Entity `"stop"` is read as `"destination"`, and an idea body's
  `stopId` is read as `destinationId`. This is tested in `queue.test.ts`.

### Migration — `packages/db/drizzle/0006_vocabulary_logistics.sql` (hand-written, vet MED bookkeeping)
- It uses ALTER … RENAME in the design's order, with every pkey, index, FK and unique renamed to
  match drizzle's names. It then runs `chapters.title DROP NOT NULL` and
  `UPDATE … title=NULL WHERE title ~ '^Leg [0-9]+$'`, then
  `ALTER TYPE change_entity RENAME VALUE 'stop' TO 'destination'`, and finally creates
  `transport_kind` and adds `reservations.transport_kind`.
- I added the `_journal.json` entry (idx 6) and `meta/0006_snapshot.json`. The snapshot is
  drizzle's own fresh snapshot of the new `schema.ts`, re-chained `prevId` → 0005. After that,
  `drizzle-kit generate` reports "No schema changes".
- Verified on a throwaway Postgres 18:
  - migrate 0000→0006 vs a fresh schema-only build: `pg_dump` is identical apart from PG18's named
    NOT NULL constraints and column order. I did not rename the NOT NULL constraints, because they
    don't exist on PG < 18.
  - 0005-era data: `Leg 1` and `Leg 12` became null, `Oregon Coast` and `Leg of lamb` were kept,
    and a change_log `'stop'` row became `'destination'`.
  - `pnpm db:migrate && pnpm db:seed` succeeds on an empty database.

### Q1 A — optional chapters
- Core `chapter.title` is now `string | null`. `chapterCreateInput` takes `title` null/omitted and
  defaults it to null; `chapterPatchInput` accepts null (`types.ts`).
- Schema `chapters.title` is nullable. `createTrip` seeds `title: null` (`mutations.ts:433`).
  `createChapter`/`updateChapterFields` accept null.
- Vet MED "Add chapter": `TripPlanner.addChapter` posts `title: null` and opens the inline rename on
  the new chapter. `nextChapterTitle` is removed.
- Planner: `chapterKickers` counts NAMED chapters only. `RouteChapter`/`TimelineChapter` have
  `kicker` and `name` as nullable, and `outboundSeam` is removed. `routeCountKicker` gives
  "3 destinations". `routeSummary.chapters` lists named chapters only
  (`packages/core/src/planner/index.ts` around 660–720, 1010).
- Web `RouteView`:
  - A named chapter gets the kicker and title. An unnamed one gets only the pill and ⋯ (right
    aligned), or the count kicker on the first chapter when no chapter is named.
  - The seam is gone.
  - The rail's "Chapters" block renders only when at least one chapter is named.
- `SwimLane` (`packages/ui/src/Gantt.tsx`) accepts a null kicker or name, and the Timeline renders
  the same rule.
- Phone `[id]/index.tsx` follows the same rules.

### Q3 B — hop chip + Logistics
- Core `logisticsModel(trip)` produces one group per fly/ferry segment in segment order, or null
  when there is none:
  - Flights and ferries sort by `startsAt`, with a layover only between them.
  - Shuttle, train and car sort after them on an outbound hop and before them on a hop going home.
  - A group with no flight gets a ghost row with the segment's own clock.
- `RouteHop.chip` follows the copy rule. `RouteHop.items` is now `[]`.
- Web: `HopCard.tsx` keeps the header and switch and adds the chip (smooth-scroll to
  `#hop-<segmentId>`). The new `apps/web/src/components/trip/Logistics.tsx` holds the groups. Each
  carries the `hop-<id>` anchor + `scroll-mt-6` and has these actions:
  - "Add flight" / "Add ferry" open the shipped `HopForm`.
  - "Add shuttle" opens the new `ShuttleForm`.
  - A row tap or ⋯ → Edit, and ⋯ → Delete with undo.
- Phone: `HopRow` shows the chip, and tapping it scrolls the Route `ScrollView` to the group (using
  measured `onLayout` y). `LogisticsSection` and `ShuttleSheet` are in `apps/mobile/src/hops.tsx`,
  and "+ Add destination" is now at the foot of the list.

### Q4 A — `transport_kind`
- Core has the `transportKind` enum, and `reservation.transportKind` is nullable with a default of
  null.
- Vet HIGH, fixed: `transportKind` is on BOTH `.pick()` lists (`reservationCreateInput` and
  `reservationPatchInput`). It is also in `ReservationFields`/`reservationValues`, in the update
  path, in `mapReservation` (queries), in the api-client row schema, in the Undo
  `reservationRestoreInput`, and in `seed.ts`.
- `transport-kind.ts` has `effectiveTransportKind` (null → the hop's mode) and `countsTowardClock`
  (flight/ferry only).
- Vet MED, fixed: `retimedSegment` ignores shuttle/train/car, and `segmentBookings` now selects
  `transport_kind`. A timed shuttle therefore never stretches the hop's clock or door to door, and
  never raises a date clash. A PATCH of `transportKind` takes the re-time path (`CLOCK_KEYS`).
  Planner door to door and layovers count clock kinds only (the vet's `bookings.length > 1` point).
- `categoryMeta(type, mode, transportKind)` maps shuttle to the Bus icon (`packages/ui/src/category.ts`).
- Flight and ferry forms now write `transportKind: "flight" | "ferry"`.

### Q2 A — area
- `trip.area` (formerly `trip.destination`) is unlabelled. The phone wizard drops the field label,
  and the phone trip settings label now reads "Where to?".
- `areaSubtitle(trip, name)` shows the trip area on destination cards (web and phone) when it is
  set and the name doesn't contain it.

### Copy
- The §2 table strings come from the rename, plus "add this flight on its hop" in `round-trip.tsx`.
- Delete-chapter dialog and toast for an unnamed chapter: "Delete this chapter?" / "that chapter".

### Seeds (`packages/core/src/seeds/index.ts`, `saves.ts`, `packages/db/src/seed.ts`)
- Costa Rica: chapter title null; area Guanacaste (new `seedAreas` row; `seed.ts` writes areas
  before trips and sets `trips.area_id`); two untimed shuttles on `seg_out` and `seg_home`.
- PNW and Greece keep their chapter names.

## Tests (TDD)
- New: `packages/core/src/domain/transport-kind.test.ts`, `packages/core/src/planner/logistics.test.ts`,
  `apps/web/src/test/vocabulary-155.test.ts` (real handlers + Postgres: null-title chapters,
  transportKind round trip, timed shuttle doesn't re-time or clash, PATCH, 400 on a bad kind), the
  `ui` category tests, the queue legacy test, and the chapter create/patch null tests.
- Updated: expectations that named `outboundSeam`, hop `items`, the pgEnum count (12→13), and seed
  and journal counts now that the shuttles exist. `travelFoldLabel` now reads effective kinds, so
  two flights plus two shuttles read "Travel · 4 bookings".
- Gate: `pnpm turbo run lint typecheck test`, with `DATABASE_URL` pointed at a throwaway
  postgres:18 container. Results are in the report.

## Defaults and flags for the walk / qa
- **Rollout skew (vet MED)**:
  1. `migrate-in-build` renames tables on live Neon while the previous Vercel deployment still
     queries `stops`/`legs`/`destinations`. Expect 500s on the old deployment until promotion,
     which is a window of minutes. Promote right after the build, or accept the window.
  2. Installed phone builds (no OTA) call `/api/stops`, `/api/legs/:id/reorder` and
     `/api/destinations/resolve`, and parse `trip.legs`. These 404 or fail to parse after deploy
     **until the phone is rebuilt** (EAS preview/production) from this commit. Only queued capture
     items are translated, by the queue shim.
- **FLAG (vet)**: the chip tap-to-scroll is runtime layout. I checked the web render at 1280px
  against the seeded Costa Rica trip: Route shows "1 DESTINATION", a chip on each hop, and
  Logistics showing AA 2451 / 2h 30m layover at LAX / AA 2208 / shuttle on the outbound group and
  shuttle then "no flight added 19:30 CST → 08:50 MST" on the home group. There were no console
  errors. The scroll itself and the phone were NOT walked.
- The seed's real times give a **2h 30m** layover (the wireframe drew 1h 30m), and PNW has no area,
  so its masthead reads "Road trip". Per the vet, the screen renders the data. The **Bend ·
  Portland · Hood River** trip is not seeded: create it in the walk (new trip, three destinations,
  no chapter names).
- Invented minimal copy, outside the design:
  - "Unnamed chapter" in the "Move to chapter" submenu.
  - "Delete this chapter?"
  - The shuttle form's "Name" label, "Add shuttle" / "Edit shuttle" / "Save shuttle", and the
    placeholder "Airport shuttle".
  - "no ferry added → Logistics" for a chip on an empty ferry hop.
  - Mixed-kind Travel fold "N bookings".
- Phone destination cards were not restyled to the wireframe's line-item list. Only the area
  subtitle was added, because the card body was out of scope.
- A parked hop's "N flight bookings parked" counts every booking, including shuttles, unchanged.
