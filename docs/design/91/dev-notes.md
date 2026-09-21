# Issue #91 — dev notes

One field, end to end: `googleMapsUri` from Google's details field mask through to a fifth
item — `· map` — on the research pad's quiet G-line. Implemented exactly as the vetted
wireframe's nine touchpoints specify (Q1–Q5 all **A**, none defaulted, nothing re-asked).

## What changed

### The provider (packages/core)

| # | `file:line` | change |
|---|---|---|
| 1 | `packages/core/src/providers/google-places.ts:52` | `"googleMapsUri"` appended to `DETAILS_FIELDS`. Details mask only — `PLACE_FIELDS` (search's cheap five) is untouched, so `SEARCH_FIELD_MASK` is byte-identical. |
| 2 | `packages/core/src/providers/google-places.ts:140` | `googleMapsUri?: string;` on the `GooglePlace` wire shape, under the existing "Details only" comment. |
| 3 | `packages/core/src/providers/google-places.ts:171` | `googleMapsUri: place?.googleMapsUri ?? null,` in `toPlaceDetails` — same `?? null` shape as `websiteUri` beside it. The mapper still WRAPS `toPlaceSummary`; the fork is intact. |
| 4 | `packages/core/src/providers/index.ts:85` | `googleMapsUri: string | null;` on `PlaceDetails`. Required-and-nullable, per the design — which is what turned every fixture below into a typecheck failure rather than a silent drop. |
| 5 | `packages/core/src/domain/types.ts:476` | `googleMapsUri: z.string().nullable().default(null)` on `placeEnrichment` (the cache READ grammar). |

### The column (packages/db)

| # | `file:line` | change |
|---|---|---|
| 6 | `packages/db/src/schema.ts:316` | `googleMapsUri: text("google_maps_uri")` — nullable, no default, beside `national_phone_number`. |
| 6 | `packages/db/drizzle/0009_old_ender_wiggin.sql` | **Generated** via `pnpm db:generate`, never hand-written. Whole body: `ALTER TABLE "places" ADD COLUMN "google_maps_uri" text;`. Plus `meta/0009_snapshot.json` + the `_journal.json` entry. |
| 7 | `packages/db/src/places-cache.ts:37, :54` | read: `row.googleMapsUri` into the `placeEnrichment.safeParse`, then `e.googleMapsUri` into the returned `PlaceDetails`. Both halves — the read still goes through the grammar, not off the row. |
| 8 | `packages/db/src/places-cache.ts:70, :84` | write: `details.googleMapsUri` in the insert `.values()`, and ``googleMapsUri: sql`excluded.google_maps_uri` `` in the upsert `set`. |

### The render (apps/web)

| # | `file:line` | change |
|---|---|---|
| 9 | `apps/web/src/components/places/GoogleLine.tsx:99-110` | the conditional `· map` link, appended after the `nationalPhoneNumber` block. Copied verbatim from the design's §5 snippet: `target="_blank" rel="noreferrer" className="text-rv-accent no-underline"`, label `map` lowercase. |

No prop, no mount, no page and no layout rule changed — it rides the `PlaceDetails` envelope
`GoogleLine` already fetches. The container was already `flex-wrap`, so a narrow card wraps
with no style change. `drill.ts` and `drill.test.ts` are untouched (Q2 → A).

### Docstrings corrected in the same pass (vet finding 3)

`googleMapsUri` is a **fourth** field and is **not** an Enterprise-SKU field, so three
docstrings that said "the three fields" / gave the SKU as the reason were false the moment the
field landed. Corrected without changing the SKU rationale for the other three:

- `packages/core/src/providers/index.ts:68-78` — "four fields"; says explicitly that
  `googleMapsUri` lives on `PlaceDetails` because search has nothing to do with it, **not**
  because of billing.
- `packages/core/src/providers/google-places.ts:36-47` — same correction on the mask fork.
- `apps/web/src/app/api/places/details/[id]/route.ts:15-17` — the enumeration now names the
  canonical map page.
- `apps/web/src/components/places/GoogleLine.tsx:17` — state ①'s example is now
  `` `G ★ 4.6 · 812 · website · call · map` ``.
- `packages/db/src/places-cache.ts:11-13` — the "same facts for everybody" list.

### Vet finding 1 — deliberately NOT acted on

§4's prose claims the new link opens in a new tab "like both of its neighbours". The `call`
link has neither `target` nor `rel` (it is a bare `tel:` anchor). The vet is right that the
prose is wrong and the §5 snippet is right. **I followed the snippet and left the `tel:` link
exactly as it was** — no harmonising.

## Tests (TDD — red first, then green)

Written and confirmed failing (5 failures: `DETAILS_FIELD_MASK` missing the member, two
`toEqual` mismatches, and the grammar cases) **before** any source change.

- `packages/core/src/providers/google-places.test.ts` — `googleMapsUri` added to the two
  `toEqual` expectations and to the details payload; the mask-membership loop now asserts it
  is in `DETAILS_FIELD_MASK` and **not** in `SEARCH_FIELD_MASK`; the "cheap five" literal
  assertion on `SEARCH_FIELD_MASK` is unchanged and still passes — that is the proof search
  did not widen.
- `packages/core/src/domain/types.test.ts` — **new** `describe("placeEnrichment …")` covering
  touchpoint 5's load-bearing claim: a pre-#91 row with the key **absent** still parses and
  defaults to `null` (a cache hit without the link, not a hard miss), and an explicit `null`
  reads the same way.
- `packages/core/src/providers/places-search.test.ts:42` — `KALALOCH_DETAILS` fixture.
- `apps/web/src/app/api/places/details/[id]/route.test.ts` — the `KOA` fixture, the wire-shape
  `toEqual` body, the `bare` all-nulls fixture, and a new assertion in the upsert test that a
  **second** `put` with a different `googleMapsUri` refreshes the column.

**Claim for qa to check:** that last upsert assertion is the one with real teeth, and I
mutation-tested it rather than assuming. With
``googleMapsUri: sql`excluded.google_maps_uri` `` removed from the `set`, the run is
`Tests 1 failed | 4 passed` on exactly that test; restored, `5 passed`. So the "a column left
out of the `set` is pinned forever" failure mode is genuinely covered, not just commented.

## Gate — what actually ran

`pnpm turbo run lint typecheck test`, run from the worktree root, **with a database reachable**
so nothing skipped:

```
@rv-trip/ui:test:    Test Files  3 passed (3)      Tests   42 passed (42)
@rv-trip/core:test:  Test Files 43 passed (43)     Tests  948 passed (948)
@rv-trip/web:test:   Test Files 36 passed (36)     Tests  268 passed (268)
 Tasks:    10 successful, 10 total
```

`pnpm install` was needed first (fresh worktree, no `node_modules`).

**On the database.** The worktree's `.env` points at `localhost:5433`, which was not running,
and a first gate run passed with all 26 `describeDb` files **skipped** — including every test
of touchpoints 6/7/8. A skipped suite proves nothing, so rather than report that as green I
ran a disposable Postgres **I own** (`rv-trip-db-issue91`, container-local tmpfs, port
`55491`) and re-ran the gate against it. Deliberately **not** `pnpm db:up`: compose pins
`container_name: rv-trip-db` with a `./pgdata` bind mount, so bringing it up from a worktree
would seize the shared container name and point it at a directory that disappears with the
worktree. My container was removed afterwards (`docker rm -f rv-trip-db-issue91`); nothing
else on the machine was started, stopped or killed. Port 5433 and the shared `rv-trip-db`
name were left exactly as found.

The `relation "routes" does not exist` / `column "nav" does not exist` lines in the web run's
stdout are pre-existing, expected output from `routing.test.ts`'s deliberate
cache-read-failure path; those tests pass.

## Not covered by a test, and why — read this before the walk

**The render itself has no unit test.** `apps/web`'s vitest is `environment: "node"` with
`include: ["src/**/*.test.ts"]` — no jsdom, no testing-library, and no `.test.tsx` is even
collected. There is no component-render harness in `apps/web` to extend, and adding one is
scope creep on a thin slice. So the `· map` anchor's existence, label, href and
`target`/`rel` are **unverified by me** and are the walk's job — which is what the design
already says (Q5 → A: "Nothing in this list is a unit test's job"). What *is* covered is
everything feeding it: the mask, the mapper, the type, the grammar, the column, the cache read
and the cache write.

### Flags for the walk

1. **`pnpm db:migrate` is required before the walk** (vet finding 2, which the design never
   names). The new column does not exist in the dev/walk database until it runs, and
   `dbPlacesCache().put()`'s throw is **swallowed** at
   `packages/core/src/providers/places-search.ts:257-263` — so acceptance step 4 would still
   pass (the link renders straight off the provider answer) while steps 5 and 6 fail, looking
   exactly like a code bug when it is an unmigrated database. The test suite is unaffected:
   `global-setup.ts` runs `drizzle migrate()` on a fresh throwaway database, which is why 0009
   applied cleanly above.
2. **`GOOGLE_API_KEY` must be set before the process boots** — `placesProvider()` memoizes at
   module scope (`apps/web/src/lib/places.ts:22`). Exporting it into a running dev server does
   nothing.
3. **The field-mask risk is the one to watch on the first live call** (vet FLAG). A mask member
   Google rejects is a non-404 `!res.ok` → `throw` → `degraded("upstream_error")`, which
   collapses state ① to state ④ — the G-line renders *nothing at all*, not just a missing
   `map` link. So a blank line on the first live call means "the mask was rejected", not "no
   data". I could not prove `googleMapsUri` is an accepted Place Details (New) mask member
   from inside the repo; nothing here has ever made a live call.
4. **Delete any pre-existing `places` row for the walk's place first.** `PLACE_CACHE_TTL_MS` is
   a read filter with no sweeper, so a row cached before the column existed short-circuits the
   provider and keeps answering without the link for up to 30 days. (Expected to be moot —
   `places` is empty in every environment.)

## Scope

Exactly the nine touchpoints plus the generated migration. Nothing else: no photos, no
reviews, no hours, no `drill.ts` change, no rename of the five shipped `places` columns, no
`sessionToken` (still flagged undecided at `route.ts:22-25`). `StubPlacesProvider.details()`
still returns `null` and was **not** given a value for the new field, so state ④ keeps
rendering nothing.
