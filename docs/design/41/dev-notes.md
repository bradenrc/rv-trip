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
