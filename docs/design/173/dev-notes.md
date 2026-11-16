# #173 · dev notes — item i1 of 5 (Core: activeTrip + isoDateInZone)

Scope: plan item **i1** only (#172 · Q4 A). Items i2–i5 are separate dispatches.

## What changed

- `packages/core/src/planner/journal.ts:319-338` — `activeTrip<T extends Pick<Trip, "id" | "startDate" | "endDate">>(trips, today): T | null`,
  placed after `todaysDestination`. This is the wireframe's code, copied as written: dates only (it never reads `status`/`statusAuto`), inclusive at both
  ends, an undated trip is skipped (`!startDate || !endDate`, a guard only, since the DB columns are NOT NULL), the later `startDate` wins, and an
  equal start keeps the first trip in input order (strict `>`).
- `packages/core/src/planner/journal.ts:349-366` — `isoDateInZone(now, timeZone): IsoDate | null`, placed after `localIsoDate`. It uses
  `Intl.DateTimeFormat("en-CA", { timeZone, year/month/day: "numeric"/"2-digit" })`. The `RangeError` from an invalid zone is caught and returns `null`.
- Exports: both functions reach `@rv-trip/core` with no index edit. `packages/core/src/index.ts:3` does `export * from "./planner/index"`, and
  `planner/index.ts:62` does `export * from "./journal"`.
- `apps/mobile/src/store.ts:118-120` — `inProgress` now calls `activeTrip([t], today) !== null` in place of its own inline date comparison. Its `Pick`
  gains `"id"` to fit activeTrip's constraint (every call site passes `b.trip`, a full `Trip`). The import is at `store.ts:26`. Behavior is unchanged
  for dated trips.

## Tests

`packages/core/src/planner/journal.test.ts:236-300` covers:
- **activeTrip**, using the wireframe's seeded table (Loop AUG 01–28 · Crater Lake AUG 21–23 · Bellingham NOV 11–15):
  - no trips returns null
  - one covering trip is returned
  - overlapping trips return the later start, in either input order
  - an equal start keeps the first in input order
  - an undated trip returns null
  - the first day and the last day both count
  - the day before and the day after (JUL 31, AUG 29, NOV 16) return null
  - a `status: "complete", statusAuto: false` trip covering today is still returned
- **isoDateInZone** at `2026-11-16T01:00Z`:
  - America/Boise gives `2026-11-15`
  - UTC gives `2026-11-16`
  - `"Not/AZone"` gives `null`

## For qa

- `isoDateInZone` depends on the runtime's ICU. Node in this worktree resolves America/Boise correctly. The wireframe's FLAG about Vercel's Node ICU is
  for the walk (i3), not this item.
- No UI, API, schema or migration changes in this item.
