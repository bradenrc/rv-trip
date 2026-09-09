# Issue 41 — dev notes

**Scope: epic item i1 only** (the server-quarantined Google Places provider). Items i2–i7 are
separate dispatches; nothing here touches a route, a component, `packages/db` or `packages/ui`.

## What changed

| file:line | what |
| --- | --- |
| `packages/core/src/providers/google-places.ts` (new, 154 lines) | `GooglePlacesProvider` (:71) implementing the already-declared `PlacesProvider` (`providers/index.ts:68-71`) against Google Places **(New)**: Text Search `POST /v1/places:searchText` (:26, :74) and Place Details `GET /v1/places/{id}` (:28, :91). `googleCredentialsFromEnv()` (:50) returns `null` when `GOOGLE_API_KEY` is absent or empty — the shape `hereCredentialsFromEnv` (`providers/here.ts:41-49`) set. Pure, separately exported mapping: `buildSearchBody` (:58), `parseSearchResponse` (:119), `parseDetailsResponse` (:127). |
| `packages/core/src/providers/google-places.test.ts` (new, 15 tests) | offline vitest, `fetch` stubbed with the same `stubFetch` idiom as `here.test.ts:268-285`. |
| `packages/core/package.json:11` | `"./providers/google-places": "./src/providers/google-places.ts"` — its own subpath, next to `./providers/here`. |
| `.env.example:13-17` | `GOOGLE_API_KEY` uncommented, with a comment saying empty/absent is the normal local case. |
| `packages/core/src/providers/index.ts` | **unchanged** — the quarantine. |

## Acceptance, checked

- **Never reachable from `index.ts`**: `grep -rn "google-places"` over `packages/core/src`, `apps/`,
  `packages/ui/src`, `packages/db/src` hits only the new module's own doc comment and its test's
  import. `index.ts`'s only "google" matches are the pre-existing `googlePlaceId` field (`:60`) and
  parameter (`:70`).
- **Subpath only**: `package.json` exposes it at `./providers/google-places`; `"."` and
  `"./providers"` are untouched, so `@rv-trip/core` and `@rv-trip/core/providers` still cannot pull
  it into a client bundle.
- **`googleCredentialsFromEnv({}) === null`** and the sparse-payload mapping (nulls for
  `location` / `rating` / `address`) are both pinned by tests.

## Key decisions

1. **An upstream failure throws; it is not swallowed.** `here.ts` degrades *inside* the provider
   because `estimateRoute` is a real answer. Places has no such fallback, and §4 state 4 makes
   "Google answered, and had nothing" a distinct, first-class state from §3's
   `reason: "upstream_error"`. If the provider swallowed the 500 into `[]`, i2's route could never
   tell those apart. So: non-OK → `throw`, network error → propagate, and i2's route catches and
   picks the envelope reason. **qa: please check this against i2's intent** — it is the one place I
   read past the literal words of i1's scope.
2. **`details` of an id Google has retired returns `null`, not a throw** (:99). That is the
   `PlacesProvider` signature's own `| null` branch, and it is an answer rather than an outage.
3. **Field mask is exactly PlaceSummary's five fields** (:34-36) — cheapest SKU, and nothing arrives
   that we have no column for.
4. **`near` is a `locationBias` circle, never a `locationRestriction`** (:58-69, radius 50 km at
   :43). A bias re-ranks; a restriction would hide a campground two states away. The radius is a
   defaulted number — the design pins neither it nor a result cap, so no `maxResultCount` is sent.
5. **A row missing `id` or `displayName.text` is dropped** (:131-137). `PlaceSummary`'s
   `googlePlaceId`/`name` are non-nullable; a half row is one nothing can be saved against. Half a
   coordinate (`latitude` with no `longitude`) becomes `location: null` (:148) — a coordless place is
   legal (`saved_places.lat` is nullable) and Locate exists to fix it; a fabricated pin is not.
6. **An empty/whitespace query never reaches the network** (:76). A blank box is not a billed
   question.

## Flagged for i2 / the walk — not fixed here

- **`sessionToken` is not implemented, and I believe it cannot be as drawn.** §3's search envelope
  carries `sessionToken` "echoed on details → one billed session", and the vet already flagged this
  (FLAG b). Session tokens are a Google **Autocomplete ↔ Details** pairing; `places:searchText` — the
  endpoint the §3 healthy payload actually describes, since it returns full name/location/rating/
  address rows rather than predictions — does not accept one and is billed per request. Rather than
  invent a token that buys nothing, `search()` takes `(query, near?)` exactly as `PlacesProvider`
  declares it. **i2/i3 need a decision**: either drop `sessionToken` from the envelope and the
  picker, or switch the search leg to Autocomplete (a different result shape, and a `PlacesProvider`
  signature change). I did not guess.
- **Not exercised against live Google.** `GOOGLE_API_KEY` is unset in this worktree, so every local
  path still resolves through `StubPlacesProvider` (`providers/index.ts:114-121`). The request shape,
  the field masks and the 404-vs-500 split are pinned offline only — the live round-trip is the
  walk's, exactly as `here.ts` was for #9.

## Checks run

- `pnpm install --frozen-lockfile` → exit 0 (the worktree had no `node_modules`).
- `pnpm vitest run src/providers/google-places.test.ts` in `packages/core`, before the module
  existed → `FAIL … Failed to load url ./google-places` (the red), after → `Tests 15 passed (15)`.
- `pnpm turbo run lint typecheck test` from the worktree root → `Tasks: 8 successful, 8 total`,
  with `@rv-trip/core:test: Tests 200 passed (200)`.

---

# Issue 41 — dev notes · epic item **i2**

**Scope: i2 only** — `GET /api/places/search` and `GET /api/places/details/[id]` on the one
envelope. Nothing here touches `packages/db`, `packages/ui`, a component, or `providers/index.ts`
beyond one `export *` line. i1 (the provider) is already on this branch and was not re-done.

## What changed

| file:line | what |
| --- | --- |
| `packages/core/src/providers/places-search.ts` (new, 212 lines) | The whole wire contract of §3, pure: `PlacesDegradedReason` (:22), the `PlacesEnvelope` (:35), `SEARCH_RATE_LIMIT`/`SEARCH_RATE_WINDOW_MS` (:44-45), the per-owner `OwnerTokenBucket` (:66, `take` :79), `placesSearchQuerySchema` (:115) + `googlePlaceIdSchema` (:122), `placesEnvelopeStatus` (:142), `searchPlacesEnvelope` (:168) and `detailsPlacesEnvelope` (:201). |
| `packages/core/src/providers/places-search.test.ts` (new, 22 tests) | vitest, offline, fake `PlacesProvider`s — the healthy, empty-but-not-degraded, `no_provider`, `upstream_error` and `rate_limited` envelopes for BOTH routes, plus the bucket's refill/per-owner/cap arithmetic and the query-string schema. |
| `packages/core/src/providers/index.ts:141` | `export * from "./places-search";` — it is pure and key-free (unlike `google-places.ts`), so the picker in i3 can import the envelope type from `@rv-trip/core`. |
| `apps/web/src/lib/places.ts` (new, 32 lines) | `placesProvider()` (:24) — the places twin of `lib/routing.ts:27-34`: real `GooglePlacesProvider` when `googleCredentialsFromEnv()` answers, `StubPlacesProvider` otherwise, memoised in module scope. Returns `{ provider, configured }`; `configured` is what lets the route say `no_provider` instead of "Google looked and found nothing". |
| `apps/web/src/app/api/places/search/route.ts` (new, 54 lines) | `const limiter = new OwnerTokenBucket()` in the route module's scope (:33) exactly as §3 specifies; `GET` (:35) reads `q`/`near`, `safeParse`s, `getOwner()`s, and returns `NextResponse.json(envelope, { status: placesEnvelopeStatus(envelope) })`. |
| `apps/web/src/app/api/places/details/[id]/route.ts` (new, 32 lines) | `GET(_req, ctx: { params: Promise<{ id: string }> })` (:19) — `ctx.params` is awaited (:20), the Next 16 pattern from `api/stops/[id]/route.ts:13-14`. No rate limit: a pick is not a keystroke. |

Nothing else in the repo changed. `packages/ui`, `packages/db`, `providers/google-places.ts` and
`api/places/route.ts` are untouched.

## Key decisions (and where they answer a vet finding)

1. **The route handlers are five-line adapters; every decision lives in `packages/core`.** The vet's
   HIGH finding is right — `apps/web` declares no `test` script and no runner, so "route tests" as
   the plan words them cannot execute. Rather than claim vacuous coverage or bolt a second runner
   onto `apps/web` (scope creep, and a decision above my pay grade), the whole decision tree moved
   into `places-search.ts`, where it is covered by 22 executing tests. **What is NOT covered by an
   executing test**: the ~10 lines of glue in each handler (reading `searchParams`, awaiting
   `ctx.params`, `NextResponse.json`) and `lib/places.ts`'s provider choice. I exercised all of it
   by hand against a running dev server instead — the transcript is under "Checks run".
2. **The cap is checked BEFORE the key** (`searchPlacesEnvelope` :170, ahead of the provider call).
   If `no_provider` short-circuited first, the 30/60 s behaviour would be unprovable in any
   environment without a Google key — the acceptance's "31st search" would come back `no_provider`
   forever. Throttle-first makes the cap real everywhere, and it is also the correct order: the
   bucket protects us from the caller, not the vendor from us.
3. **The throttled answer is HTTP 429 with the degraded body.** §3's own pre block is headed
   `429 · owner token bucket, 30 searches / 60 s`, and the body it draws is the same degraded
   envelope. So the *body* is uniform (the picker shows the free-text row, not a red toast — §4
   state 5) and the *status* is the honest HTTP word. Everything else, `no_provider` included, is
   200. `placesEnvelopeStatus` (:142) is the one place that decides this. **qa: this is the only
   non-200 in i2 — confirm you read §3's "429" the same way.**
4. **`details` answers on the envelope too, not as a bare `PlaceSummary`.** §3's details pre block
   draws the bare object, but i2's acceptance is explicit that *both* routes answer
   `{ results: [], degraded: true, reason: "no_provider" }` with no key — which is the envelope.
   Acceptance won; `results` is 0-or-1. **qa: flagging the drift rather than silently picking.**
5. **An id Google has retired → `{ results: [], degraded: false }`, not 404.** It is an answer, not
   an outage (i1's decision 2, spent here). The picker's degraded branch must not light up for it.
6. **`sessionToken` is declared on the envelope (:41) and never populated.** i1 flagged that a
   session token is a Google Autocomplete↔Details pairing and that `places:searchText` accepts none
   and bills per request; the vet's FLAG (b) says the same. It is still undecided (drop it, or move
   the search leg to Autocomplete — a different result shape and a `PlacesProvider` signature
   change), so the details route takes no `sessionToken` parameter and nothing fabricates one.
   **This is i3's blocker, not a bug here** — the field is optional in the type, so adding it later
   is not a breaking change.
7. **A malformed query string is a 400, not a degradation.** Missing/blank `q`, or a `near` that is
   not `lat,lng` in range, returns the shipped `NextResponse.json({ error: parsed.error.flatten() },
   { status: 400 })`. That is a client bug, and folding it into the degraded envelope would hide it.
   The picker debounces and never sends a blank `q`.
8. **`retryAfterMs` is a real countdown, not a constant.** The bucket refills steadily (limit/window
   tokens per ms), so the 31st search says ~2000 ms and a request one second later says ~1000 ms.
   §3's worked value (2400) is that same shape.

## Flagged for the walk / qa

- **The vet's FLAG (a) is wrong about this machine, and it matters.** `.env.example` has
  `GOOGLE_API_KEY` empty, but **`apps/web/.env.local` carries a real, working key** (Next loads
  `apps/web/.env.local`, not the repo-root `.env`). So the healthy path is *not* walk-blind here — I
  round-tripped it against live Google (below), which also retires i1's "not exercised against live
  Google" caveat for the search + details legs. The walk should re-run it rather than assume the
  stub.
- **Still render-required:** nothing about the picker UI is in this item. The 250 ms debounce,
  keyboard nav, and the degraded copy are i3's.
- **A malformed place id returns Google 400 → `upstream_error`, not `results: []`.** Verified live
  (`/api/places/details/ChIJnope`). Only a 404 maps to "retired" (i1, `google-places.ts:99`). That
  looks right — a syntactically invalid id is a bad request, not a missing place — but it is a
  behaviour neither the design nor the plan pins.
- **The bucket is in-process** (accepted by the design, MED-recorded by the vet). It also now clears
  itself past 1000 distinct owners (`places-search.ts:80`) so it cannot grow without bound.

## Checks run

All from the worktree root unless noted.

- `pnpm install --frozen-lockfile` → exit 0 (the worktree had no `node_modules`).
- **Red:** `pnpm vitest run src/providers/places-search.test.ts` in `packages/core`, before the
  module existed → `Error: Failed to load url ./places-search … Does the file exist?`
- **Green:** same command after → `Test Files 1 passed (1) · Tests 22 passed (22)`.
- `pnpm turbo run lint typecheck test` → `Tasks: 8 successful, 8 total`, with
  `@rv-trip/core:test: Tests 222 passed (222)`.
- **Acceptance clause 1, live, no key** (`GOOGLE_API_KEY= next dev` on :3987):
  - `GET /api/places/search?q=kalaloch&near=47.61,-124.38` →
    `{"results":[],"degraded":true,"reason":"no_provider"}` · `HTTP 200`
  - `GET /api/places/details/ChIJvT2R2rSjkFQRRJgVJZ2Xk1Q` →
    `{"results":[],"degraded":true,"reason":"no_provider"}` · `HTTP 200`
  - `GET /api/places/search` (no `q`) → `{"error":{…"q":["Required"]}}` · `HTTP 400`
- **Acceptance clause 2, live:** 30 searches, then the 31st →
  `{"results":[],"degraded":true,"reason":"rate_limited","retryAfterMs":1780}` · `HTTP 429`, and a
  second later `retryAfterMs":1773` — numeric, and counting down.
- **The healthy path, against LIVE Google** (dev server with the configured key):
  - `GET /api/places/search?q=kalaloch%20campground&near=47.61,-124.38` → `HTTP 200`
    `{"results":[{"googlePlaceId":"ChIJu4ykar7hjVQR3fJbnffgzlc","name":"Kalaloch Campground","location":{"lat":47.6130311,"lng":-124.3760789},"rating":4.7,"address":"Forks, WA 98331, USA"},…],"degraded":false}`
  - `GET /api/places/details/ChIJu4ykar7hjVQR3fJbnffgzlc` → `HTTP 200`, the same row, `degraded:false`.
  - Two billed Google requests total.
- **NOT run:** any route-level automated test — `apps/web` has no test runner (see decision 1). The
  live curls above are the evidence for the handler glue, and they are manual.

---

# Issue 41 — dev notes · epic item **i3**

**Scope: i3 only** — the `PlacePicker` component and its seven states (§4). Nothing here touches
`packages/ui`, `packages/db`, a route handler, or i1/i2's files. i1 (the provider) and i2 (the two
routes) are already on this branch and were not re-done. The picker is not mounted on any page yet —
that is i5's island.

## What changed

| file:line | what |
| --- | --- |
| `packages/core/src/providers/place-picker.ts` (new, 214 lines) | The picker's whole state machine, pure. `PickedPlace` (:24) exactly as §4 declares it; the copy constants `PICKER_DEBOUNCE_MS` (:34), `PICKER_PLACEHOLDER` (:36), `PICKER_DEGRADED_MESSAGE` (:39), `PICKER_ESCAPE_BLURB` (:42), `PICKED_COORDLESS_LABEL` (:44); `escapeRowLabel` (:47), `pickedFromSummary` (:51), `pickedFromFreeText` (:62), `pickedCoordLabel` (:87); `PickerRow` (:99) / `PickerView` (:110); `initialHighlight` (:146) and `moveHighlight` (:151); and `pickerView` (:183), which is states 1-7 in one function. The escape row is appended unconditionally at :203 — that single line is the design's "pinned to the bottom of every list state". |
| `packages/core/src/providers/place-picker.test.ts` (new, 38 tests) | vitest, offline. All seven states from inputs alone, the escape row asserted present as the LAST row in all three list states, and the escape emitting `lat`/`lng`/`googlePlaceId` all null. |
| `packages/core/src/providers/index.ts:142` | `export * from "./place-picker";` — pure and key-free like `places-search`, so the client can import it from `@rv-trip/core`. |
| `apps/web/src/lib/trip-api.ts:74` | `tripApi.searchPlaces(q, near?)` — the client seam the vet's MED said was missing. Deliberately NOT through `req` (`:9-18`), which throws on `!ok`: the throttled answer is a **429 whose body is the real degraded envelope**, and any other failure (offline, non-JSON) is folded into the same shape. The picker therefore has exactly one shape to render and never a thrown error to catch. |
| `apps/web/src/components/places/PlacePicker.tsx` (new, 307 lines) | `"use client"`. `export type { PickedPlace }` (:34) so callers can import the type from the component, as §4 draws it. The props are §4 verbatim (:39-51): `value` / `onChange` / `placeholder?` / `near?` — **no trip, leg or stop**. The debounce timer (:72-90), the keyboard handler (:173-187), states 6+7 (:120-166) and states 1-5 (:189-306). |

`git status` shows **no modification under `packages/ui/`** — five files, four of them new, none in the DS.

## Key decisions

1. **The state machine lives in `packages/core`, the JSX in `apps/web`.** The vet's HIGH is right:
   `apps/web` declares no `test` script and no runner, so i3's "component tests render idle, typing,
   results, no-match, degraded and both picked states" cannot execute where the plan puts them. I did
   not bolt a second runner + jsdom + testing-library onto `apps/web` (a lockfile-level infra
   decision, and i2 declined the same thing for the same reason). Instead every decision the picker
   makes moved into `place-picker.ts`, where 38 executing tests render all seven states **from props
   alone** — which is what the acceptance is actually asking for. **What is NOT covered by an
   executing test**: the JSX itself and the `setTimeout`. I drove those by hand in a real browser
   instead — the transcript is under "Checks run", and it covers all seven states including the live
   Google round-trip.
2. **No session token, and no `details` call on pick.** i1 and i2 both flagged that a Google session
   token is an Autocomplete↔Details pairing, that `places:searchText` accepts none and bills per
   request, and that this was "i3's blocker". Spending it: `PlaceSummary` already carries every
   field `PickedPlace` needs (`name`/`location`/`rating`/`address`/`googlePlaceId`), so a details
   round-trip on pick would buy **identical data for a second billed request**. The picker emits
   straight from the search row (`pickedFromSummary`, :51). `sessionToken` stays declared-and-unused
   on the envelope; nothing fabricates one. **This is a deliberate departure from i3's scope prose**
   ("one Google session token held across search → details") and is not in i3's acceptance. If the
   epic wants Autocomplete instead, that is a `PlacesProvider` signature change and a different
   result shape — flagging rather than guessing, per the brief.
3. **A degraded list auto-highlights nothing; Enter still works.** §4 draws state 4's escape row
   highlighted and state 5's not, so `initialHighlight` (:146) is `envelope.degraded ? -1 : 0` — we
   did not look, so the picker does not light a row as though it had offered an answer. To keep that
   from dead-ending, `Enter` with nothing highlighted falls through to the last row, which is always
   the escape row (`PlacePicker.tsx:184`). Verified live: in the degraded state, Enter committed
   `kalaloch` as a coordless pick.
4. **"0 results" is never shown for a degraded answer** (:209). Nobody counted anything; claiming a
   count would be a lie in the status line. Degraded shows the warning instead, and no status.
5. **A stale envelope is no envelope.** `answer` and `cursor` are both stamped with the query they
   belong to (`PlacePicker.tsx:57-62, 88-90`), so a keystroke drops straight back to state 2 without
   a second effect resetting state. This is also what keeps the component clear of
   `react-hooks/set-state-in-effect`, which the repo's lint enforces — nothing calls `setState`
   during a render or in an effect body.
6. **Google result rows get a neutral pin, not a tent.** §4 draws `⛺` on the result rows because the
   example is a campground, but the vet's HIGH is correct that **nothing on the wire carries a Google
   type** (`PlaceSummary` has no `types` field), so the picker cannot know a row's category. Result
   rows take a `MapPin` on the green tile (green = "this came from Google and has coordinates",
   matching states 6-7's green-vs-plain split) and the escape row keeps `✎`/`Pencil` on the muted
   tile. No category is claimed anywhere in the picker. §5's "category defaults from Google's type"
   is a **separate open problem for i5** and is not resolved here.
7. **The placeholder uses the faded ink, not the subtle ink** (`PlacePicker.tsx:219-223`). §4's mock
   colours it with the subtle token, but `packages/core/src/theme/nightfall-tokens.test.ts:193-207`
   (the #19 vet's HIGH) enforces that that token paints no text glyphs — every shipped use is an icon
   or a dot. The enforced accessibility rule wins over the mock; this is the one token substitution
   in the file. **qa: this is a deliberate one-token deviation from the wireframe.**
8. **The open list is absolutely positioned** (`:230`, a `relative` wrapper at `:190`). §4 stacks the
   field and the menu in document flow because it is a static state chart; inside a real sheet the
   menu has to overlay. It renders identically — full width, directly below the field, sharing the
   border seam (field `rounded-t-rv-md`, menu `border-t-0`).

## Flagged for i5 / the walk

- **Not mounted anywhere.** i5 owns the island that renders it on `/places`. Until then the walk has
  no route that shows the picker; I mounted it temporarily to verify (below) and reverted.
- **`near` is unused by any caller yet.** It is wired end-to-end (prop → `lat,lng` query param →
  `locationBias`) but no surface passes it until #21's home base.
- **The category gap (decision 6) and the Region-from-address gap** (the vet's MED: §5 seeds
  "Olympic NP, WA" from an address that reads "Forks, WA") are both i5's, not the picker's. The
  picker hands `address` through untouched, exactly as §4's contract says.
- **Google's live answer differs from §4's mock data** — for "kalaloch campground" Google now returns
  one result rated ★4.7 with address "Forks, WA 98331, USA", not the mock's two results at ★4.4/★4.1.
  Row copy and layout match; the numbers in the wireframe are illustrative.

## Checks run

- `pnpm install --frozen-lockfile` → `Done in 6.8s` (the worktree had no `node_modules`).
- **Red:** `pnpm vitest run src/providers/place-picker.test.ts` in `packages/core`, before the module
  existed → `Error: Failed to load url ./place-picker … Does the file exist?`
- **Green:** same command after → `Test Files 1 passed (1) · Tests 38 passed (38)`.
- `pnpm turbo run lint typecheck test --force` from the worktree root →
  `Tasks: 8 successful, 8 total`, with `@rv-trip/core:test: Tests 260 passed (260)` (222 before i3).
- `pnpm --filter @rv-trip/web build` with the picker temporarily mounted on `/places` → build
  succeeded, `/places ƒ` — it compiles into a real client bundle and pulls nothing server-only out of
  `@rv-trip/core`.
- **All seven states driven live in a browser** (`next start -p 3941` against the local DB and the
  configured Google key, picker temporarily mounted, mount reverted afterwards; the server was
  stopped by its recorded pid):
  - **1 idle** → `placeholder="Search a campground, diner, trailhead…"`, `aria-expanded=false`.
  - **2 typing** → the waiting status renders between keystrokes.
  - **3 results** (live Google) → status `1 result`; rows
    `Kalaloch Campground | Forks, WA 98331, USA | ★ 4.7` then
    `Use “kalaloch campground” as a plain name | No coordinates — add them later from the map`;
    first row `aria-selected=true`.
  - **4 no matches** (stubbed `{results:[],degraded:false}`) → status `0 results`, the escape row is
    the only row and is already `aria-selected=true`, no warning, menu `rounded-b-rv-md`.
  - **5 degraded** (stubbed `no_provider`) → no status, escape row only and `aria-selected=false`,
    banner `Place search is unavailable right now — you can still type a name and save.`, menu square
    at the bottom and the banner carrying `rounded-b-rv-md border-t-0`.
  - **6 picked from Google** → `Kalaloch Campground` / `47.6130, −124.3761 · ChIJu4yk…` on
    `border-rv-green bg-rv-green-soft`.
  - **7 picked via the escape** → `kalaloch` / `No coordinates — won’t appear on the map yet` on
    `border-rv-border-hi bg-rv-surface`.
  - **Keyboard** → `ArrowDown` moved `aria-selected` from the result row to the escape row; `Enter`
    committed it as a coordless `PickedPlace`; `Enter` in the degraded state (nothing highlighted)
    also committed the escape row.
- **NOT run:** any automated test that mounts the JSX — `apps/web` has no test runner (decision 1).
  The browser transcript above is the evidence for the render, and it is manual.

---

# Issue 41 — dev notes · epic item **i4**

**Give `saved_places` a write path in db and API.** `packages/db/src/mutations.ts` had seven exports
and none touched `savedPlaces`; the library was read-only. POST lands on the existing
`api/places/route.ts`, PATCH + DELETE on a new `api/places/[id]/route.ts`, all owner-scoped via
`getOwner()`.

## What changed

- **`packages/core/src/domain/types.ts:148-204`** — the write grammar, new:
  - `savedPlaceCreate` (`:163-176`) — the FLAT `POST /api/places` body from wireframe §3
    (`name`, `region`, `lat`, `lng`, `googlePlaceId`, `type`, `status`, `note`, `source`, `rating`,
    `tripId`). Only `name` is required; every other field carries the column's default.
  - `SavedPlaceCreate` (`:178`, post-parse — what the mutation takes) and `SavedPlaceCreateInput`
    (`:181`, pre-parse — what a client hands `tripApi.savePlace`).
  - `savedPlacePatch` (`:189-193`) — `savedPlaceCreate.partial()` plus a refine that rejects a body
    with no recognized key.
  - `normalizeSavedPlacePatch` (`:202-204`) — the graduation invariant, server-side.
- **`packages/db/src/queries.ts:145-172`** — `mapSavedPlaceRow(row, tripName)` extracted from the
  inline mapper `listSavedPlacesForOwner` used (`:130-131`, now one line), and exported so the write
  path returns rows in exactly the shape the library renders.
- **`packages/db/src/mutations.ts:165-229`** — the three mutations:
  - `ownedTripTitle` (`:181-189`) — guard + join in one: a `tripId` this owner does not own throws
    `"trip not found"`; an owned one hands back the title the created row displays.
  - `createSavedPlace` (`:191-201`) → the created `SavedPlace`.
  - `updateSavedPlaceFields` (`:208-220`) → `boolean`, from `.returning({ id })`.
  - `deleteSavedPlace` (`:223-229`) → `boolean`, same mechanism. Hard delete, per §3.
  - Import line `:3` gains `savedPlaces`; `:14` gains `mapSavedPlaceRow`.
- **`apps/web/src/app/api/places/route.ts:17-28`** — `POST`, `savedPlaceCreate.safeParse` → 400,
  201 with the created row, 404 on a foreign `tripId`. `GET` (`:7-9`) unchanged.
- **`apps/web/src/app/api/places/[id]/route.ts`** (new) — `PATCH` (`:23-46`) and `DELETE` (`:48-56`).
- **`apps/web/src/lib/trip-api.ts:69-85`** — `savePlace` / `updatePlace` / `deletePlace` on `tripApi`.
- **`packages/core/src/domain/types.test.ts`** (new, 14 tests) — the write grammar, TDD (written
  red first: `normalizeSavedPlacePatch is not a function`, 13 failed / 1 passed).

## Key decisions (and where they answer a vet finding)

1. **HIGH "data-shape claim fails" — resolved by naming the derived schemas.** The vet was right:
   `savedPlace` is the READ shape (nested `place`, required `id`/`ownerId`), so `safeParse` of the
   flat §3 body fails on the missing keys and drops every flat one. The routes validate against
   `savedPlaceCreate` / `savedPlacePatch` instead, and `types.test.ts:36-40` pins the regression
   directly — it asserts `savedPlace.safeParse(SAVE_BODY).success === false`.
2. **HIGH "no write path for Locate" — the lat/lng write for a saved place is `savedPlacePatch`.**
   `lat`/`lng` are ordinary patchable fields, so `updateSavedPlaceFields(owner, id, { lat, lng })`
   is i7's write for `kind: "place"` — no new mutation needed, verified live (see Checks).
   **Still open for i7:** the `kind: "stop"` half. `updateStopFields` (`mutations.ts:33-47`) takes
   only `{ rating, notes, arriveDate, departDate }`; widening it to `{ lat, lng }` is i7's call, not
   mine, and I did not touch it.
3. **Graduation clears `source` on the server, not just in the client's body.** The acceptance body
   is `{ status: "been", rating, tripId }` — no `source` key — and the row must still end with
   `source` null. §3's example sends `source: null` explicitly; relying on that would make the
   acceptance fail whenever a caller omits it. `normalizeSavedPlacePatch` forces it, and it is a
   pure function in core so it is unit-tested where a runner exists.
4. **`updateSavedPlaceFields` / `deleteSavedPlace` return `boolean`, not `void`.** This is what makes
   the acceptance "a PATCH or DELETE naming another owner's id … does not 200" true rather than
   aspirational: the WHERE is `id = ? AND owner_id = ?`, `.returning({ id })` reports whether it
   matched, and the route turns `false` into 404. The existing `updateStopFields` returns `void` and
   therefore 204s over a no-op write; I did not change it (out of scope), but qa may want to note it.
5. **A foreign `tripId` is refused too.** Graduating your place onto someone else's trip is a
   cross-tenant write the design does not mention. `ownedTripTitle` throws and the route 404s
   ("trip not found"), matching `createReservation`'s shipped idiom (`mutations.ts:49-69` →
   `api/reservations/route.ts:29-31`).
6. **A malformed `:id` is a 404, not a 500.** `uuid` columns reject a non-uuid at the driver, so the
   handler validates the param with `z.string().uuid()` first.
7. **Next 16 `ctx.params` is awaited** (the MED finding), matching `api/stops/[id]/route.ts:13-14`.
8. **Route collision:** `/api/places/[id]` sits beside the static `search/` and `details/` segments
   from i2. Next resolves static before dynamic, and ids are uuids, so there is no ambiguity.
9. **MED "no client seam named" — answered for i4's three endpoints.** `savePlace`/`updatePlace`/
   `deletePlace` go through `req` (unlike i2's `searchPlaces`, which deliberately bypasses it): the
   library is our own data, so a failure is a real error to surface, not a renderable degraded
   envelope. i5's island consumes these rather than calling `fetch` itself.
10. **No migration.** `saved_places` already has every column this writes (`schema.ts:150-171`);
    `lat`/`lng` are already nullable. The vet confirmed this independently.

## Where the tests live, honestly

The acceptance says "Mutation tests cover create, graduate and delete plus the cross-owner
rejection." The vet's HIGH finding about unwired runners is correct and I did not paper over it:

- **Committed + executing:** `packages/core/src/domain/types.test.ts` — 14 vitest tests over the
  write grammar and the graduation normalizer. This is the only package with a `test` script.
- **NOT committed:** a `packages/db` mutation test. `packages/db/package.json` declares no `test`
  script and no runner, and adding one that needs a live Postgres would make
  `pnpm turbo run lint typecheck test` — which CI and the ship gate re-run — fail without a database.
  Committing a test file into a package with no runner would be coverage that never executes, which
  is what the vet flagged. So the DB-level acceptance was verified by an **out-of-tree integration
  run against a throwaway database** instead (transcript under "Checks run"). That run is evidence,
  not a regression guard: **flagging for qa/the walk** that the create/graduate/delete/cross-owner
  behaviour has no standing automated test until `packages/db` gets a runner.

## Flagged for i5 / i7 / the walk

- **i5** owns the refresh path (the MED finding): nothing here calls `router.refresh()`. The routes
  answer 201 with the created row and 204 on patch/delete, so an island can update locally or refresh
  — i5 decides.
- **i7** still needs the `kind: "stop"` lat/lng write (decision 2). The `kind` carrier is derivable
  as `layer === "saved" ? "place" : "stop"` (`pins.ts:160,206`), per the MED finding.
- **Walk:** the undo toast on delete is i5's; DELETE here is a hard delete with no tombstone, so
  "undo" must be a re-POST of the row the island still holds, not a server-side restore.

## Checks run

- `pnpm install --frozen-lockfile` → `Done in 6.6s` (fresh worktree had no `node_modules`).
- **TDD red:** `pnpm vitest run src/domain/types.test.ts` (in `packages/core`, before the
  implementation) → `Tests  13 failed | 1 passed (14)`, `TypeError: normalizeSavedPlacePatch is not a
  function`.
- **TDD green:** same command after → `Test Files  1 passed (1) · Tests  14 passed (14)`.
- **The gate:** `pnpm turbo run lint typecheck test` →
  `Tasks: 8 successful, 8 total`, with `@rv-trip/core:test: Tests  274 passed (274)`.
- **DB integration, against a throwaway database — 24/24 PASS.** Created `rvtrip_i4_verify` on the
  local Postgres (`localhost:5433`), loaded the schema with `pg_dump --schema-only` from `rvtrip`
  (read-only on the operator's database — nothing was written to it), ran the three mutations
  through `tsx` with `DATABASE_URL` pointed at the throwaway, then
  `DROP DATABASE rvtrip_i4_verify` (verified gone). The script lived in the scratchpad and its
  temporary copy under `packages/db/` was deleted; `git status` shows no stray file. Asserted:
  - create → nested read shape, flat coords preserved, `ownerId` = caller, want shelf + source kept;
  - **graduate with `{ status, rating, tripId }` and NO `source` key** → `source` null, `status`
    "been", rating + tripId set, **the SAME row id**, **exactly one row** (no second insert), `note`
    untouched, `tripName` joined on read as "Pacific Northwest Loop";
  - locate backfill → a coordless row patched with `{ lat, lng }` reads back
    `46.1712 / −123.9012` with its name untouched;
  - **cross-owner PATCH → `false`** (route 404s) and the note is unchanged;
    **cross-owner DELETE → `false`** and the row count is unchanged;
  - graduating onto **another owner's trip** → throws `trip not found`;
  - owner DELETE → `true`, the row is gone, and a second DELETE of the same id → `false`.
- **NOT run:** any HTTP-level test of the three handlers — `apps/web` has no test runner (the same
  limitation i2/i3 recorded). The handler bodies are thin: parse → mutate → status.

---

# Issue 41 — dev notes · epic item **i5**

**Wire the Save-a-place sheet, the graduate sheet and the ⋯ menu.** `/places` is a `force-dynamic`
server component whose "Save a place" button had no handler, and the library had no write surface at
all. i4 gave `saved_places` its API; i5 gives it its UI: one client island beside `PlacesLibrary`
owning that button, both sheets from wireframe §5, and the ⋯ menu (Edit place / Been there… /
Delete) with an undo toast on delete.

## What changed

- **`packages/core/src/domain/place-form.ts`** (new, 246 lines) — both sheets *as data*, so their
  decisions land where the only test runner in the repo can execute them:
  - `SAVE_SHEET_TYPES` (`:28-34`) — one representative `ReservationType` per category in §5's order
    (Stay · Eat · Do · Travel · Other). The sheet maps each through `categoryMeta`; it names no icon,
    label or color of its own.
  - `SavePlaceForm` (`:39-50`) / `GraduateForm` (`:52-56`) — the two field sets.
  - `regionFromAddress` (`:73-83`) — the "from the address, editable" seed.
  - `pickPlace` (`:99-104`) — the picker's `onChange`: seeds Region only while the field is untouched.
  - `savePlaceFormFromSaved` (`:106-127`) — seeds the sheet from a row (the ⋯ menu's *Edit place*).
  - `savePlaceBody` (`:130-150`) — the flat `POST /api/places` body of §3; `null` until a place is
    chosen (the picker's free-text escape row counts, so a coordless save is legal).
  - `editPlacePatch` (`:153-166`) — the same sheet as a PATCH, naming only what it can edit; it never
    names `status`, `rating` or `tripId`.
  - `graduateFormFromSaved` (`:169-171`) / `graduatePatch` (`:178-186`) — `{ status: "been", rating,
    tripId, note, source: null }`, the §5 body verbatim.
  - `applySavedPlacePatch` (`:199-227`) — the island's local echo of a successful PATCH, including the
    server's own rule that graduation clears `source`.
  - `savedPlaceToCreate` (`:232-245`) — a row flattened back into a create body: the undo toast's
    re-save.
- **`packages/core/src/domain/place-form.test.ts`** (new, 23 tests) — written red first.
- **`packages/core/src/domain/index.ts:2`** — re-exports the module.
- **`apps/web/src/components/places/SheetShell.tsx`** (new) — the chrome both sheets share
  (`:17-92`), lifted from the shipped planner idiom (`StopDetailSheet.tsx:80-127`): scrim, right-hand
  panel, sticky navy header with kicker over title, body, footer carrying the mono hint + Cancel +
  primary. Plus `SheetField` (`:104-133`, composing the DS `FieldLabel` and §5's mono asides) and the
  single `SHEET_INPUT` skin (`:135-137`).
- **`apps/web/src/components/places/PlaceSheet.tsx`** (new) — "Save a place", and *Edit place* on the
  same five fields: Place (`:51-56`, `PlacePicker`), Category (`:58-83`, `categoryMeta`), Region
  (`:85-93`), Who told you (`:95-107`), Note (`:109-117`). Footer hint `saves to · want`, primary
  "Save to library".
- **`apps/web/src/components/places/GraduateSheet.tsx`** (new) — "Been there": the shipped
  interactive `<Stars value onSet>` (`:50-54`), "Visited on … · complete trips only" (`:56-70`), the
  carried-over Note (`:72-80`), and §5's one-record strip (`:82-93`). Primary "Move to Been there".
- **`apps/web/src/components/places/PlaceCardMenu.tsx`** (new) — the ⋯ dropdown on the shipped shadcn
  `dropdown-menu` (`:37-62`), anchored beside the card.
- **`apps/web/src/components/places/PlacesWorkspace.tsx`** (new) — the island: the "Save a place"
  button (`:150-158`), the write handlers (`submitSave` `:57-94`, `submitGraduate` `:96-121`, `remove`
  `:123-146`) and both sheets (`:172-193`).
- **`apps/web/src/components/places/PlacesLibrary.tsx:41-52, 88-98`** — one new optional prop,
  `cardMenu?: (place) => ReactNode`, and the card wrapper that anchors it.
- **`apps/web/src/app/places/page.tsx`** — the header copy stays on the server and is passed as
  `children`; the page also resolves the graduate sheet's trip list (`:14-19`).

## Acceptance, checked

- `git status` shows **no** modification under `packages/ui/` (`git status --porcelain packages/ui`
  → 0 lines). `packages/ui/src/Places.tsx` is untouched; the DS ships zero API change in this item.
- The sheets **compose** `PlacePicker`, `Stars`, `FieldLabel` and `categoryMeta`. There is no star
  glyph, no label style, no category icon and no category color defined anywhere under
  `components/places/` — `grep -n "Star\|lucide.*Tent" GraduateSheet.tsx PlaceSheet.tsx` finds only
  the DS imports.
- `PlaceCard`'s `onAddToTrip` **stays unpassed**, with the source comment naming #22 at
  `PlacesLibrary.tsx:88-92`.
- `pnpm turbo run lint typecheck test` → `Tasks: 8 successful, 8 total`.

## Key decisions (and where they answer a vet finding)

1. **MED "refresh path unnamed" — answered: the island owns the list, no `router.refresh()`.**
   `PlacesWorkspace` seeds `places` from the server render and applies each write locally: the row the
   POST returns is appended, a PATCH goes through `applySavedPlacePatch`, a DELETE splices. That is
   `TripPlanner`'s shipped shape, and it is why `applySavedPlacePatch` exists as a *tested* function
   rather than an inline spread — the echo cannot drift from what the wire does.
2. **MED "the ⋯ trigger's positioning is unpinned" — resolved as a corner anchor, and flagged.**
   §5 draws the trigger inside the card's footer row, but `PlaceCard` owns that row end to end
   (`Places.tsx:67`, a `justify-between` flex whose right-hand child is a *variable-width* action
   button — "Add to trip" vs "Plan a revisit"). With `packages/ui` frozen, an in-footer anchor would
   need either a DS slot or a guess at that button's width. The trigger therefore sits on the card's
   **bottom-right corner** (`-bottom-3 -right-3`, a 28 px pill) — level with the footer, 12 px into
   the grid's 16 px gutter, clear of every element the card draws. The card wrapper is
   `relative grid` so the card still stretches to the row height.
3. **HIGH "Google type has no carrier" — the copy is wrong; the sheet opens on Other.** Neither
   `PlaceSummary` nor `PickedPlace` carries `types`, and this epic does not widen that API, so §5's
   "Category defaults from Google's type" is unimplementable as written. `pickPlace` leaves the
   category alone and the user picks — asserted by a test that says so out loud
   (`place-form.test.ts`, "leaves the category alone — nothing on the wire carries Google's type").
4. **MED "Region 'from the address' is not derivable" — rule pinned, worked value unreachable.**
   `regionFromAddress` takes the last two comma-parts, dropping a trailing country and a trailing ZIP.
   From §3's own details payload (`156954 US-101, Forks, WA 98331`) that is **"Forks, WA"**, not the
   "Olympic NP, WA" §5 draws — exactly what the vet predicted. It is a seed, not a fact: the field is
   editable and the value is display-only, never geocoded.
5. **MED "the 'Visited on' dropdown has no data path" — resolved on the server.**
   `places/page.tsx` now also calls `listTripsForOwner`, filters to `status === "complete"` and maps
   to `{ id, title }` before it crosses into the island — a `<select>` has no use for days, miles or
   open-stop counts, and the narrow shape keeps the client payload honest. No new db query.
6. **Undo is a re-save, not a restore.** DELETE is a hard delete with no tombstone (i4's note), so the
   toast's Undo re-POSTs `savedPlaceToCreate(place)` from the row the island still holds: same
   content, new id. The card leaves the grid immediately and comes back only if the server refuses.
7. **The sheet idiom is the planner's, not shadcn's.** `components/ui/sheet.tsx` stays unused, per
   scope: a second sheet grammar on the same product is the drift this repo keeps out.
8. **Two small scope judgements, both narrowing.** "Been there…" is hidden on a row already on the
   "been" shelf (graduation is one-way), and the edit sheet hides "Who told you" for a `been` row
   (§5 clears it on graduation; offering it back would re-add queue metadata to an archive row).

## Flagged for the walk — cannot be certified statically

- The ⋯ trigger's corner anchor (decision 2) and the radix portal opening over a card that lifts on
  hover: geometry and pointer behaviour, not types.
- `PlacePicker`'s absolutely-positioned result list inside the sheet's `overflow-y-auto` panel — the
  panel scrolls rather than clipping in every case I can reason about, but that is a render claim.
- The sonner undo toast's action button, and the debounce/keyboard path through the picker inside a
  sheet (i3 flagged the same for the picker standalone).
- With no `GOOGLE_API_KEY` the picker is always in its degraded state, so the walk exercises the
  free-text escape row and a coordless save — which is the path that must work anyway.

## Checks run

- `pnpm install --prefer-offline` → `Done in 6.2s` (fresh worktree had no `node_modules`).
- **TDD red:** `pnpm test` in `packages/core` with `place-form.test.ts` written and no
  implementation → `FAIL src/domain/place-form.test.ts … Failed to load url ./place-form`,
  `Test Files  1 failed | 18 passed (19)`.
- **TDD green:** same command after `place-form.ts` → `Test Files 19 passed (19) · Tests 297 passed
  (297)` (23 new).
- **The gate:** `pnpm turbo run lint typecheck test` → `Tasks: 8 successful, 8 total`, with
  `@rv-trip/core:test: Tests  297 passed (297)` and `@rv-trip/web:lint` / `:typecheck` clean. The
  token contract (`nightfall-tokens.test.ts`) sweeps `apps/web/src`, so it covers the five new
  components: no raw hex, no `text-rv-navy` off an ember/green fill, no `rv-ink-subtle` on a text
  glyph.
- **Production build:** `pnpm --filter @rv-trip/web build` → succeeded; `/places` still listed as
  `ƒ (Dynamic)`. This exercises the server/client boundary the island introduces (`children` from a
  server component into a client one) that `tsc` alone does not.
- **NOT run — SKIPPED (no runner):** any component-level render test. `apps/web` declares no `test`
  script and no runner (the limitation i2/i3/i4 each recorded); every testable decision was pushed
  into `packages/core/src/domain/place-form.ts` instead, and what is left in the components is JSX
  and handler wiring. **NOT run:** the live app against a database — no Postgres was started in this
  dispatch and nothing was written to the operator's database. The walk owns that.

---

# Issue 41 — dev notes · epic item **i6**

**Ship "Been there?" suggestions with the resolved de-dup rule.** The rule of
`docs/design/41/index.html` §7 as one pure function, the candidate query beside
`listSavedPlacesForOwner`, and the bar + suggested cards on `/places`.

## What changed

- **`packages/core/src/domain/places.ts`** (new, 260 lines) — the whole of the logic:
  - `MatchCandidate` / `isAlreadySaved` (`places.ts:71`) — §7's four rules verbatim.
  - `normalizePlaceName` (`places.ts:41`) — lowercase · trim · collapse whitespace · strip `.` `,`
    `'` `&` (and `’`, so a curly apostrophe cannot split a name from itself).
  - `SAME_PLACE_METERS = 150` (`places.ts:30`), `SUGGESTION_MIN_RATING = 4` (`places.ts:33`).
  - `PlaceSuggestion` (`places.ts:101`) + `suggestionsFromTrips` (`places.ts:133`) — the Q4=B
    candidate set.
  - `SuggestionShelf` + `buildSuggestionShelf` (`places.ts:216`) — de-dup, dismissals, the bar copy,
    and `null` when there is nothing to show.
  - `suggestionToCreate` (`places.ts:246`) — "Add to Been" as a `POST /api/places` body.
  - `matchCandidateFromSaved` (`places.ts:82`).
- **`packages/core/src/domain/places.test.ts`** (new, 23 tests) — every rule, every acceptance case.
- **`packages/core/src/domain/index.ts:3`** — `export * from "./places"`.
- **`packages/db/src/queries.ts:152`** — `listSuggestionCandidatesForOwner(ownerId)`, beside
  `listSavedPlacesForOwner`: the same `TRIP_WITH` load, filtered to `status = 'complete'` and
  `ownerId`, mapped by `suggestionsFromTrips`. Imports at `queries.ts:2,13`.
- **`apps/web/src/components/places/Suggestions.tsx`** (new) — `SuggestionBar` (`:22`) and
  `SuggestedPlaceCard` (`:51`).
- **`apps/web/src/components/places/PlacesWorkspace.tsx`** — `suggestions` prop (`:59`), `dismissed`
  state (`:63`), the `shelf` memo (`:78`), `accept()` (`:85`), and the render at `:202` / `:211`.
- **`apps/web/src/components/places/PlacesLibrary.tsx`** — a `leading?: ReactNode` prop (`:52`),
  rendered first inside the grid (`:166`) and first in the map lens's side column (`:154`); the grid
  branch's condition became `list.length > 0 || leading` so a suggestion is not swallowed by
  `EmptyShelf` on an empty shelf.
- **`apps/web/src/app/places/page.tsx:19`** — the third parallel query (import at `:3`), passed at
  `:33`.

## Acceptance, checked

| Acceptance clause | Where |
| --- | --- |
| coordless South Beach reservation vs the saved South Beach row → **match** | `places.test.ts:90` |
| same name, real coords on both sides, 3 km apart → **no match** | `places.test.ts:83` |
| `Fishing Bridge, WY` vs `Fishing Bridge RV Park`, identical coords → **no match** | `places.test.ts:63` |
| id-equal pair → **match** | `places.test.ts:51` |
| the bar is absent from the render when the list is empty | `buildSuggestionShelf` returns `null` (`places.test.ts:294`); the JSX is `{shelf && <SuggestionBar …>}` and `leading={shelf?.suggestions.map(…)}`, so both the bar and every card disappear together |
| `pnpm turbo run lint typecheck test` | green — see **Checks run** |

## Key decisions (and where they answer a vet finding)

1. **The vet's HIGH on the totals is real, and the code follows Q4=B rather than the §7 prose.**
   `seed.ts:39,45` and `:50,56` do give the Pacific Northwest Loop's stops ratings — Astoria, OR ★5
   and Newport, OR ★4 — so §7's "SeedStop carries no rating field" is true only of the two trips
   built through the `addTrip` helper (`seed.ts:328`). Mark that trip `complete` and the rule yields
   **3** suggestions, not 1: Astoria OR (stop ★5), Astoria/Warrenton KOA (reservation ★5), Newport
   OR (stop ★4). South Beach State Park is correctly dropped by rule 3b. I implemented the *rule* as
   written and the *count* as it falls out; the shelf copy is a template, not the literal string, so
   it renders whatever the rule produces. Both wordings are design copy — the singular is §5 of the
   signed wireframe, the plural is the mock's shelf bar — and neither is invented
   (`places.ts:232`). **Against the seed exactly as it ships the shelf does not render at all**
   (Gap 3b): the Pacific NW Loop is `planning` (`seed.ts:21`) and the two complete trips rate
   nothing. To see it, mark that trip complete.
2. **The "Suggested" card is a new app-local component, per the vet's reuse HIGH.** `PlaceCard`
   (`packages/ui/src/Places.tsx:34`) renders exactly one action with a hard-coded label, has no badge
   slot, and takes a full `SavedPlace` a suggestion does not have. `SuggestedPlaceCard` composes the
   same DS parts — `CategoryTile`, `Stars` — and copies `PlaceCard`'s box so the two sit in one grid
   without a seam. `packages/ui` is untouched by this item.
3. **Every decision is in `packages/core`, where a runner exists** (the vet's runner HIGH). The db
   query is a `SELECT` plus `suggestionsFromTrips`; the island is `buildSuggestionShelf` plus JSX.
   That is why the ≥ 4 filter, the `complete` filter, the borrowed-pin rule, the ordering, the bar
   copy, the dismissal set and the POST body are all unit-tested, and the components hold nothing
   but markup and handlers.
4. **Rule 1 is a positive rule only.** Two *unequal* non-null `googlePlaceId`s fall through to the
   name rule rather than short-circuiting to "no match" — §7 says "equal → match. Nothing else is
   consulted", and then "*Otherwise* names must match". `places.test.ts:57` pins the null-id case.
5. **A reservation borrows its stop's NAME, never its pin** (rule 4). `suggestionsFromTrips` sets a
   reservation candidate's `lat`/`lng` to `null` and its `region` to the parent stop's `place.name`
   — which is how the frame's "📍 Astoria, OR" under "Astoria/Warrenton KOA" is produced from real
   data. `places.test.ts:104` asserts that pasting the borrowed pin in would have flipped the result,
   which is the whole reason the contract sits on the producer.
6. **A stop candidate is category `other`.** `stops` carry no type; a town is not a campground, and
   `categoryMeta("other")` is the five-category language's own answer for "no category".
   `places.ts:152`.
7. **The headline names the most recently *ended* contributing trip.** The design draws one trip's
   worth of suggestions and never says what two complete trips do. `buildSuggestionShelf` sorts by
   `tripEndDate` desc → rating desc → name, and reads the headline off the head of that order
   (`places.ts:231`, tested at `places.test.ts:327`).
8. **The refresh path, continued from i5:** the island owns the list, so accepting a suggestion
   POSTs, appends the created row to `places`, and the shelf recomputes — `isAlreadySaved` then
   matches the row that was just created, so the card leaves with no second bookkeeping. No
   `router.refresh()`.
9. **"Not now" / "Dismiss all" are session-local.** The design specifies no persistence and there is
   no column for it; dismissals live in island state and come back on reload. Flagged below.
10. **"Dismiss all" uses `rv-ink-faded`, not the frame's subtle ink.** The palette guard in
    `packages/core/src/theme/nightfall-tokens.test.ts:193` (a prior vet HIGH) scopes that token to
    non-text. This is the one place the pixels depart from the frame, by one shade, to keep a
    shipped contrast rule. Noted in a source comment at `Suggestions.tsx:36`.
11. **Suggestions render on both shelves and are never touched by the category filter.** They are
    not library rows: the segmented control's counts, the chips and their counts all describe
    `places` only. Hiding a suggestion behind the Want/Been switch or a chip would make an offer
    disappear for a reason the user never asked for.

## Flagged for the walk — cannot be certified statically

- **The shelf is invisible against the seed as it ships.** To walk it: mark Pacific Northwest Loop
  `complete` (a `trips.status` update; there is no UI for it in this epic) and reload `/places`. The
  bar should read *"Pacific Northwest Loop is complete. 3 places you rated ★4 or better aren't in
  your library yet."* with three suggested cards and **no** South Beach State Park card.
- Grid geometry: a suggested card is the first item of the same `auto-fill, minmax(340px, 1fr)` grid
  the library cards use, matching the frame's row. Whether it reads as one row at the app's real
  widths is a render claim.
- The accept round-trip (`POST /api/places` with `status: "been"`) needs a database; nothing was
  written to the operator's database in this dispatch.
- Dismissal is not persisted, so "Not now" survives navigation within the SPA but not a hard reload.

## Checks run

- `pnpm install --prefer-offline` → `Done in 6.2s` (fresh worktree had no `node_modules`).
- **TDD:** `packages/core/src/domain/places.test.ts` was written before `places.ts`. First run of
  `./node_modules/.bin/vitest run src/domain/places.test.ts` →
  `Test Files  1 failed (1) · Tests  1 failed | 22 passed (23)`, on
  *"names the most recently ended trip in the headline"* — `buildSuggestionShelf` was trusting the
  caller's ordering. That drove the fix (the comparator moved out as `bySuggestionOrder` and is now
  applied inside `buildSuggestionShelf` too). Re-run → `Test Files 1 passed (1) · Tests 23 passed`.
- **The gate:** `pnpm turbo run lint typecheck test` → `Tasks: 8 successful, 8 total`, with
  `@rv-trip/core:test: Tests  320 passed (320)` (23 new) and `@rv-trip/web:lint` / `:typecheck`
  clean. The palette contract (`nightfall-tokens.test.ts`) sweeps `apps/web/src` and so covers
  `Suggestions.tsx`: no raw hex, no invented `rv-*` name.
- **Production build:** `pnpm --filter @rv-trip/web build` → succeeded, `/places` still `ƒ
  (Dynamic)`. This is what exercises the new server→client prop (`PlaceSuggestion[]` across the
  boundary) that `tsc` alone does not.
- **NOT run — SKIPPED (no runner):** any component render test. `apps/web` still declares no `test`
  script and no runner; the "bar is absent when the list is empty" acceptance is executed as
  `buildSuggestionShelf(...) === null` in `packages/core`, and what remains in the component is the
  one-line `{shelf && …}` conditional. **NOT run:** the app against a database — no Postgres was
  started and nothing was written to the operator's database.
