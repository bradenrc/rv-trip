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
