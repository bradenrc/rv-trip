# #162 · MCP server core — dev notes

Built against the resolved wireframe (`mc/wireframe/issue-162-v0:docs/design/162/index.html`,
answers q1 B · q2 A · q3 A · q4 C · q5 B · q6 A · q7 B · q8 A · q9 A) and the vet findings.
One pass (Q9 A): tools, attribution, stay clock and the Settings card.

## What changed

### core (`packages/core`)
- `domain/types.ts:66` — `changeField` gains `created` (Q2 A).
- `domain/types.ts:117` — **vet HIGH (cross-client)**: `lastChangeField` is now
  `.nullable().default(null).catch(null)`: a `lastChange` whose `field` this build doesn't know
  parses to **null (no byline)** instead of failing the whole trip payload. The old
  "speaks only the three fields" test became "reads an unknown field as no byline"
  (`types.test.ts`), plus a `created` round-trip.
- `planner/stay-clock.ts` (new) — `stayClockLine()`: "in after 4:00 PM · out by 11:00 AM",
  12-hour in the row's own `startsTz`/`endsTz`, half-line when only one instant, null with none.
  Built from `formatToParts` so ICU's U+202F never leaks.
- `planner/index.ts:303,639` — **vet MED (data path)**: `RouteReservation` widened with
  `clock` (stays only) and `lastChange`, so RouteView has something to draw.
- `planner/context-digest.ts` (new) — `contextDigest(trip, nearby, nextTime)` + its zod
  `contextDigestResponse` (Q1 B). Route in chapter→sortOrder, `MM-DD` pairs / `floating`,
  `stay` = first lodging/campground name, counts, `rating` only when set; hops with `"home"`
  ends + `timed`; `gaps.open` from `deriveDays` runs (`MM-DD..MM-DD`, a single day is
  `08-01..08-01`), `gaps.noStay` scheduled-only; flattened nearby (1-decimal `mi`, `source`
  only when present); `lastTime` keyed by destination id with "★n". Tests on the PNW seed
  (`context-digest.test.ts`).

### ui (`packages/ui`)
- `src/change-byline.ts` — `VERBS.created = "added"`, `changeFieldLabel("created") = "added"`;
  `changeValueLabel` already prints the value whole for it. Tests added.

### db (`packages/db`)
- `schema.ts:639` + migration `drizzle/0008_change_field_created.sql`
  (`ALTER TYPE change_field ADD VALUE 'created'`; generated with `pnpm db:generate`, renamed
  from drizzle's random name, `_journal.json` tag updated to match).
- `mutations.ts:378 writeLogRows` — the ONE `insert(changeLog)` (the change-log test pins
  that), now shared by `logChanges` and the new `logCreated` (`:393`).
- **Q2 A creates**, each writing its `created` row in the insert's transaction:
  `createDestination(owner, input, actor)` `:805` · `createReservation(owner, input, actor)`
  `:1135` (destination path now wrapped in a transaction — vet MED; segment path
  `insertSegmentReservation` `:1259` takes the caller's tx) · `insertIdea` `:1735`
  (via `deps.actor`) · `createSave` `:2190` (via new `SaveDeps.actor`; insert+log in one tx).
  `writeThroughBeen` passes its actor to the Been save it creates.
- **Q4 C replays**, lookup inside the same transaction as the insert, nothing written on a hit:
  `createTripOnce` `:462` (owner + trimmed/ci title + startDate), `createDestinationOnce`
  `:827`, `createReservationOnce` `:1149` (same parent + trimmed/ci name; parent proved first).
  `sameName` `:417` is the `lower(btrim(col)) = …` compare.
- `ensureReturnHop(owner, tripId)` `:1478` (Q6 A) — the owner-scoped wrapper over
  `withReturnHop`; throws `NoHomeBase` with no effective home base (**vet MED**), returns
  `{segmentId, born}`.
- `queries.ts:831 getJournalThing` — one owner-scoped idea/destination/reservation with its
  byline joined (what `journal_entry` returns).
- `api-keys.ts:101 findApiKeyById` — for the revoke route's ownership proof.

### web (`apps/web`)
- `lib/mcp-server.ts` — seven new tools through `defineTool`: `get_context`, `create_trip`,
  `add_destination`, `add_segment`, `add_reservation`, `add_save`, `journal_entry`
  (`add_idea`, `get_trip`, `list_trips` unchanged in behaviour; `add_idea` now writes its
  `created` row via the mutation).
- REST twins pass `getActor()`: `api/destinations/route.ts`, `api/reservations/route.ts`,
  `api/places/route.ts` (ideas already did).
- `components/trip/RouteView.tsx:517-531` — under each `ReservationLineItem`: the mono clock
  line (`-mt-1 pl-10 font-mono text-[11.5px] text-rv-ink-faded`) and the reservation
  `ChangeBylinePopover` (`pointer-events-auto pl-10`, `entity="reservation"`). Not inside the
  DS component.
- Settings (Q8 A): `components/settings/api-keys-view.ts` (pure: copy, row strings,
  frames, snippet — tested) + `ApiKeysCard.tsx` ("use client"), mounted in
  `SettingsForm.tsx:141` right after `<HouseholdCard/>`, no second kicker. Data from
  `app/settings/page.tsx:38,70` (`listApiKeys(getOwner())`, minters named via
  `describePeople`, formatted server-side; only finished strings cross).
  Routes: `POST /api/household/keys` (`{ key, id, name, prefix }` — **no `keyHash`**, vet MED;
  403 if the actor isn't a member) and `DELETE /api/household/keys/[id]` (404 unless the
  row's household is `getOwner()`, then `revokeApiKey`; already-revoked → 204).
- `docs/mcp.md` — tool table extended, "added by" / Settings mint now documented.

## Decisions pinned (the vet's open seams)
- **Destination name + replay key (vet HIGH 2).** The stored `place.name` is the name **as
  typed** ("Seattle, WA" — what the wireframe's card and hop titles show). The Places top hit
  contributes only lat/lng/googlePlaceId and is echoed as `resolved: {name, googlePlaceId}`.
  Replay key: same trip AND (stored name equal, trimmed/ci, OR same googlePlaceId when the new
  place has one). A re-paste of "Seattle, WA" therefore replays (test:
  "replays a destination on its typed name…").
- **Where the eat ideas land (vet HIGH 1).** `add_idea` writes status `idea`, and the Itinerary
  shows knowns only (#131), so the three research picks land on the **Ideas tab under Blaine**,
  not the Itinerary. The acceptance test asserts them on `destination.ideas` with status `idea`.
  **Walk: check the three eat ideas on the Ideas tab**, not the Itinerary frame the wireframe drew.
- **Cross-client (vet HIGH 3).** Tolerant `lastChange` (above) + `created` in core's enum. The
  phone bundles workspace core, so any build from this commit on reads `created`; **an installed
  phone build older than this commit still has the strict enum and will fail to parse a trip that
  has a `created` row — rebuild the phone dev client with this merge.** No mobile code changed.
- `add_destination` requires both dates or neither (half a range is refused, not stored).
- Place lookup falls back to the typed name with `resolved: null` when keyless, on no hit,
  **and when `search` throws** (vet MED).
- `add_reservation` re-parses its args with `reservationCreateInput` so the superRefine runs
  (vet MED); `SegmentDateMismatch` becomes a readable `isError` naming both dates.
- `journal_entry`: `status` on a destination/reservation target → `isError` "status applies to
  ideas only…" (vet MED); an empty patch → `isError`; foreign/missing ids → "<kind> not found".
- `add_save`: an `area` anchor requires `areaLabel` (otherwise the save would have no label).
- `create_trip` passes `homeBase: null` (household default coalesces) and composes
  `{ tripId, chapterId, homeBase, replayed }` through `getTripById` (vet MED).
- `connect()` / `household()` / `text()` / `json()` / `call()` moved to `apps/web/src/test/mcp.ts`
  (vet MED); `mcp-endpoint.test.ts` imports them.
- Created-row side effect: a PATCH naming a journal field whose write-through CREATES a Been save
  now logs that save's `created` row. `change-log.test.ts` "writes nothing for a no-op save" was
  narrowed to the destination's own log for that reason (commented in the test).

## Defaulted / flagged for the walk
- **ApiKeysCard spacing**: the wireframe draws each frame standalone; I put the card
  `mt-[18px]` under HouseholdCard (GroupKicker's top margin). Check it reads as one group.
- **Copy button** toggles to the shipped `COPIED_CTA` ("Copied") for 2 s, as HouseholdCard's does.
- The opened reservation popover's header is the shipped `ChangeHistoryList` title
  ("Change history · Hyatt…"), composed unchanged; the wireframe abbreviates it to "History · …".
- **DEVIATION — Mint CTA colour.** The wireframe (and vet MED "accepted as built") put Mint on
  `bg-rv-green-cta text-rv-navy`. That cannot ship: `packages/core/src/theme/nightfall-tokens.test.ts`
  ("Slate + Sky — sweep 2: no rv-green-cta call site is left carrying CTA duty", and sweep 1's
  `text-rv-navy` rule) fails the gate on it. Mint therefore uses the shipped accent CTA
  `bg-rv-accent-deep text-rv-accent-ink`, the same as Invite above it — which also removes the
  two-CTA-colours drift the vet flagged. `.design-sync/conventions.md` (CTAs = green) is what is
  stale here; worth its own issue. Design should confirm.
- **Render-required (vet FLAG)**: keyless walk env → stub Places → both destinations land
  coordless with the warning chip and `resolved: null`; resolve-and-pin and a routed
  Seattle→Blaine drive need `GOOGLE_API_KEY`. The `claude mcp add` connect is unprovable here.
  Keyless, `/api/mcp` needs no bearer, but a pasted bearer is still verified — so "revoke the key
  and the next call fails" is walkable keyless with the bearer in the `claude mcp add` line.
- The hop home on the Bellingham paste needs an effective home base (household default) —
  without one `add_segment {to:"home"}` is an `isError` by design.
- Create responses (REST and MCP) map their row with no joined byline, so a byline on a freshly
  added row appears on the next read/refresh, not in the optimistic splice.

## Claims for qa to check
- `pnpm turbo run lint typecheck test` result is in the report below.
- The Bellingham acceptance runs end-to-end in `apps/web/src/test/mcp-grammar-162.test.ts`
  (create → 2 destinations → drive → hop home born → 3 bookings → 3 ideas; 8 `created` rows by the
  key's minter; a second full run changes no row count and writes no log row).
- Not covered by a rendered test (no DOM env in this repo): `ApiKeysCard.tsx` markup and the
  RouteView clock/byline mount — their logic is in `api-keys-view.ts` / `stayClockLine` /
  `routeModel`, which are tested; the JSX itself needs the walk.

## Gate (ran)
`pnpm turbo run lint typecheck test` → exit 0, "Tasks: 10 successful, 10 total". core 1399 passed ·
ui 55 passed · web 464 passed (real Postgres via the local docker DB). The first run failed core's
nightfall-tokens sweep on the green Mint CTA — fixed as noted under DEVIATION above.
