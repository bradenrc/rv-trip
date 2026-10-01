# #146 · dev notes: seed the finished trips' journals

Built to the wireframe on `mc/wireframe/issue-146-v0` (`docs/design/146/index.html`), with the survey answers Q1 A, Q2 B and Q3 A. Only seed data changes. There is no API, UI, schema or migration change.

## What changed

- `packages/core/src/seeds/index.ts:85-86`: `mkIdea`'s input type now accepts `rating` and `again`. The function body is unchanged, because its `...i` spread already applies them.
- `packages/core/src/seeds/index.ts:493-498`: `SecondaryStop` gets optional `rating`, `again`, `reservations` and `ideas`.
- `packages/core/src/seeds/index.ts:524-527`: `secondary()` passes those fields through to `mkStop`. When a field is missing it gets the same default as before (`null` or `[]`), so the desert trip and the other secondary trips are unchanged.
- `packages/core/src/seeds/index.ts:579-640`: the Oregon Coast Weekend Newport stop is now ★5 with Again, and it carries:
  - the South Beach State Park reservation (★5, Again)
  - Local Ocean Seafoods (eat, done, ★5, Again)
  - Oregon Coast Aquarium (do, done, ★3, Once)
  - Yaquina Head tide pools (do, still an idea, so it shows under "Didn't get to")

  The tally is 4 · 3 · 1 · 1.
- `packages/core/src/seeds/index.ts:660-697`: the Yellowstone Fishing Bridge stop carries the Fishing Bridge RV Park reservation (★4) and Old Faithful Loop (do, done, ★4). Their notes are copied word for word from the Been saves (`saves.ts:258`, `:272`). Neither item has an Again answer, and the stop has no rating of its own. The tally is 2 · 0 · 0 · 0. Jackson, WY is unchanged.
- `packages/core/src/seeds/seeds.test.ts:218-248`: a new block, `describe("the complete trips' journals (#146)")`, taken from the wireframe's test contract. For both trips it asserts the tally, the stop groups, the row order and the didn't-get-to list. The coast trip also asserts `travel` is `[]`. `tripJournal` and the two trip builders were added to the existing imports.

## Decisions

- `saves.ts` is untouched (Q1 A). The Been shelf stays at 4, and the `shelfCounts` test (`{ want: 11, been: 4 }`) passes unchanged. The PNW Newport "Last time here" card is unchanged, and `for-next-time.test.ts` passes.
- Every entry sets its `stopId` explicitly (`trip_*_leg0_stp0`). I checked `packages/db/src/seed.ts:165-205`: it maps `r.stopId` and `i.stopId` through its id map, so the rows attach to the right stop.
- The new reservation dates match their stop's dates, so the zero segment/date conflict invariant still holds.

## Checks run

- TDD red: `npx vitest run src/seeds/seeds.test.ts` failed 2 of 17 before the data change (the two new #146 tests).
- `packages/core` `npx vitest run`: `Test Files 61 passed (61) · Tests 1295 passed (1295)`.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total` (web: 48 files, 393 tests passed).

## For the walk (vet FLAG)

- **Re-seed the walk/dev DB first.** The new journal rows reach the database only when `seedTrips()` is written again. Run `pnpm db:seed` (which runs `pnpm --filter @rv-trip/db seed`, i.e. `tsx packages/db/src/seed.ts`) against the walk env's DB. Without it, both complete trips still show the old empty Journal ("Nothing logged on this trip yet…"). This is the walk-env DB-behind trap from rv-trip#65.
- What the walk should see:
  - **Oregon Coast Weekend → Journal:** Newport, OR ★5 · again, with rows in this order: Local Ocean Seafoods, South Beach State Park, Oregon Coast Aquarium (once was enough). "Didn't get to · 1: Yaquina Head tide pools". Tally 4 · 3 · 1 · 1.
  - **Yellowstone & Tetons → Journal:** Fishing Bridge, WY with no ★ and no badge in its header, and rows Fishing Bridge RV Park then Old Faithful Loop, both ★4. No folds. Tally 2 · 0 · 0 · 0.
  - **Costa Rica's Journal:** still shows the empty state.
- For qa to check: the Been shelf count and the PNW Newport "Last time here" card (2 rows, no Once group) should look the same as before this change.
