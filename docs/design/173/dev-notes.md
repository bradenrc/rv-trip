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

---

# #173 · dev notes — item i2 of 5 (Phone shell: Trips · Places · + · You)

Scope: plan item **i2** only (#171 · Q5 A · Q6 A). The Map tab is not added here (that is TL4, #186).

## What changed

- `apps/mobile/app/(tabs)/_layout.tsx:41-80`: the screen order is now `(trips)` · `saves` · `add` · `you`.
  - `saves` keeps its file name and route. Its title is now "Places" (`:50`), and it keeps the queue badge.
  - `add`'s title is now "Capture" (`:59`). The tabPress intercept to `/capture` and its accessibility label are unchanged.
  - `you` is new (`:75-79`). Its title is "You" and its glyph is ◉.
  - I updated the doc comment to match.
- `apps/mobile/app/(tabs)/you.tsx` (new file):
  - `YouTab` (`:20-29`) draws the in-screen nav block "You". It is the same styles as saves.tsx's `nav` and `title`, with no kicker (styles at `:209-219`).
  - Under the nav block it renders `RigBody` (`:33`), which is rig.tsx's old `RigScreen` body, unchanged: AccountCard, HomeBaseRow, then the rig card or the "No rig yet" branch.
  - The only other changes are the imports (`../src` became `../../src`, and `SafeAreaView` is added).
- `apps/mobile/app/rig.tsx`: now only `<Redirect href="/you" />`.
- `apps/mobile/app/_layout.tsx`: removed the root `<Stack.Screen name="rig">` (it was at `:39`) and updated the Shell comment.
- `apps/mobile/app/(tabs)/(trips)/index.tsx`: removed the Rig `headerRight` `<Stack.Screen>` (it was at `:36-44`) and dropped the now-unused `Link` and `Stack` imports.
- Copy changes:
  - `apps/mobile/app/(tabs)/saves.tsx:54`: the title is "Places".
  - `apps/mobile/src/itinerary.tsx:411`: "…pull one in from your Places."
  - `packages/core/src/capture/sheet.ts:292`: `OFFLINE_NOTICE.title` is "Offline. Saved places wait on this phone."
- Comments and docs only: `src/ui.tsx:194` and `src/store.ts:63` now say "Places tab". In `apps/mobile/README.md`, the tabs line, the saves/you entries and the Account-card paragraph now point at `(tabs)/you.tsx`.

## Tests

- `packages/core/src/mobile-capture.test.ts`:
  - `:44` checks the tab order Trips · Places · Capture · You by route position and by each screen's own title. It also checks that no "Saves" title is left and that there is no `map` tab.
  - `:60` checks that the + accessibility label is unchanged and that You uses the ◉ glyph.
  - `:69` checks that the badge sits inside the Places (`saves`) screen block and appears exactly once.
  - `:162` has the renames block: the saves.tsx title, the itinerary copy, and a sweep over every `.ts/.tsx` under `apps/mobile/{app,src}`. The sweep strips comments and then asserts there is no `\bSaves\b`. Identifiers such as `useSaves` and `NearbySaves` have no word boundary before "Saves", so they don't match.
- `packages/core/src/mobile-auth.test.ts`:
  - It now reads `app/(tabs)/you.tsx`.
  - `:241` covers the nav title "You" with no kicker, and the Account card (plus Home base) above "No rig yet" in the no-rig branch. The existing checks still run against you.tsx: Account above "Routing input", Sign out and the dev-user stub, the display name, the hook-order branch, and the untouched rig rows.
  - `:175`: the root layout no longer registers `rig`.
  - `:286`: `app/rig.tsx` is a `Redirect` to `/you`, and the Trips list has no `href="/rig"`.
  - The `@clerk/expo` import sweep now checks you.tsx in place of rig.tsx.
- `packages/core/src/capture/sheet.test.ts:145`: expects the new offline title.

## For qa / the walk

- **Render-required:**
  - the four-tab bar on a device,
  - You's SafeAreaView top inset and the nav block,
  - `/rig` redirecting into the You tab (a deep link to `/rig` should land on the tab),
  - the Trips header with no Rig link.
- `typedRoutes` is on (`app.json:59`). `/you` typechecked clean here, but a stale `.expo/types` on the walk machine regenerates on `expo start`.
- I did not run the new tests against the old code first, so I have no red-run evidence. They do assert strings ("Places", "Capture", `name="you"`, the Redirect) that did not exist before this change.
