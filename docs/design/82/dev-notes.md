# #82 · Drill into the internet — dev notes

Implements the vetted wireframe (`mc/wireframe/issue-82-v1:docs/design/82/index.html`)
against the survey's six answers — **Q1 B · Q2 B · Q3 A · Q4 B · Q5 A · Q6 A**. Q6 → A is
built as answered: **one pass**, the doors *and* the G-line, the `places` cache and its
migration all ship here. There is no slice 2.

---

## What landed, file by file

### The design system — the doors

- **`packages/ui/src/drill.ts`** (new) — `drillDoors({name, locality, type})`, pure and
  table-driven. Eleven templates, the google + social groups fixed, the third resolved
  through `categoryMeta(type).cat`: Stay → Dyrt · Campendium · YouTube(+" tour"), Eat →
  Yelp · Tripadvisor, Do → AllTrails · Tripadvisor · YouTube, **Travel/Other → none** (six
  doors, not nine). `DRILL_MARKS` (`drill.ts:55`) is the ten-mark table and `drillMarkId`
  (`:69`) the twelve-doors-to-ten-marks map — the Google trio share one mark and are told
  apart by the badge.
- **`packages/ui/src/DrillRow.tsx`** (new) — the row. A door is a 30px `<a>` whose chip
  carries `rv-light-island` (`DrillRow.tsx:104`) and a 16px `<img>`; the ✦/▦ badge
  (`:117`) sits *outside* the island, so it flips with the app. Stateless, like every other
  kit component — no hooks, no `"use client"`, no fetch.
- **`packages/ui/src/drill.test.ts`** (new, 17 tests) — every URL asserted is the **literal
  string the wireframe renders** beside its template, not a re-derivation.
- **`packages/ui/package.json:14`** — `"test": "vitest run"` + vitest in devDependencies.
  `packages/ui` had no runner at all; `turbo.json` already declares the `test` task, so no
  pipeline edit was needed.

### The design system — the pad

- **`packages/ui/src/ResearchPad.tsx`** (new) — the ONE capture surface all three mounts
  share: note first (focused on open), then the rating row ("my rating", no longer gated on
  `isDone`), then `drill`, then `gline` last. One component so three mounts cannot drift
  into three dialects.
- **`packages/ui/src/notes.ts` + `notes.test.ts`** (new, 9 tests) — `noteLinks()` /
  `linkLabel()`, the pasted-URL chips the wireframe draws in the pad (`http(s)` only,
  first-seen order, de-duplicated; `reddit.com/r/GoRVing`).
- **`packages/ui/src/DetailCards.tsx`** — `IdeaCard` gains `expanded` (`:143`), `drill`
  (`:151`) and `gline` (`:154`) slots, shaped exactly like `picker`. The ✎ button
  (`:195-204`) is the expand and keeps its icon and position. The header's `<Stars>` is
  suppressed while expanded (`:182`) because the pad carries them — one star row on a card,
  never two. `ShelfIdeaCard` gains the same pad plus shelf-side `onRating`/`onNote`/
  `onCommitNote` (`:354-356`), and its root is now `draggable={!expanded}` (`:369`) with the
  grip dimmed while open (`:377-380`).
- **`packages/ui/src/Places.tsx`** — `PlaceCard` gains `expanded` / `onToggleExpand` /
  `onPatch` / `drill` / `gline`. Expanded, `p.note` and `<Stars>` become live on **both**
  shelves and the footer's left slot goes empty (`:148-149`) — see "vet findings" below.

### The light island

- **`packages/ui/styles/entry.css:186`** and **`apps/web/src/app/globals.css:297`** —
  `.rv-light-island`, inserted **after the `.dark` block closes** (entry.css `.dark` ends at
  :166, globals.css at :277), not inside it. Both copies are byte-identical.
- **`.design-sync/conventions.md:29-32`** — the role documented under "Colors".

### Enrichment (core)

- **`packages/core/src/providers/index.ts:67-81`** — `PlaceDetails extends PlaceSummary`;
  `PlacesProvider.details` now returns it (`:86`). `StubPlacesProvider.details` still
  returns **`null` outright** (`:141-143`) — only the type moved.
- **`packages/core/src/providers/google-places.ts:36-47`** — `DETAILS_FIELDS` forks from
  `PLACE_FIELDS`; search keeps its cheap five. `toPlaceDetails` (`:155-166`) **wraps**
  `toPlaceSummary` rather than replacing it, and `GooglePlace` gains the three optional
  fields (`:129-131`).
- **`packages/core/src/providers/places-search.ts`** — `PlacesEnvelope<T extends PlaceSummary
  = PlaceSummary>` (`:35`), so every existing reference compiles untouched;
  `detailsPlacesEnvelope` returns `PlacesEnvelope<PlaceDetails>` (`:228-230`) and gained the
  cache seam: `PLACE_CACHE_TTL_MS` (`:193`), `PlacesCacheStore` (`:203`), and a fresh-hit /
  miss / write-through path where **both** cache sides swallow a throw (`:234-264`).
- **`packages/core/src/domain/types.ts:397-415`** — `placeEnrichment`, the read grammar,
  beside `savedPlace`. Google's 0–5 float, explicitly not the domain `rating`.

### The cache (db)

- **`packages/db/src/schema.ts:303-317`** — the `places` table, modelled on `routes`: text
  PK, `fetched_at` + `places_fetched_at_idx`, not owner-scoped, no FK.
- **`packages/db/drizzle/0006_silly_vindicator.sql`** — generated with `pnpm db:generate`,
  never hand-written.
- **`packages/db/src/places-cache.ts`** (new) — `dbPlacesCache()`, the `LocateStore` /
  `dbLocateStore` idiom. Reads through `placeEnrichment.safeParse` (a drifted row is a miss,
  not a malformed answer) and upserts on the key with `fetched_at = now()` from the
  **database** clock.
- **`packages/db/src/testing/truncate.ts:34`** — `places` added to the reset, so a cached
  row cannot leak between tests.

### The app

- **`apps/web/src/lib/trip-api.ts:200`** — `tripApi.placeDetails`, modelled on
  `searchPlaces`, deliberately not through `req`: every outcome is renderable, nothing
  throws.
- **`apps/web/src/components/places/GoogleLine.tsx`** (new, `"use client"`) — the `gline`
  slot's filler. One state keyed by the id it answers for, so "checking…" is derived and
  nothing is `setState`d synchronously in the effect. States ③ and ④ render **nothing**.
- **`apps/web/src/app/api/places/details/[id]/route.ts:38`** — `cache: dbPlacesCache()`.
  The handler is otherwise unchanged; the payload is wider.
- **Mount 1** `StopDetailSheet.tsx:507-520` — `expanded={ideaNoteOpen.has(it.id)}` (the
  sheet's existing Set, renamed in meaning, not new state), `drill` with
  `locality={stop.place.name}`, `gline` with the idea's `googlePlaceId`.
- **Mount 2** `Timeline.tsx:109` owns `expandedIdeaId` (the rail's own state, exactly as
  `dragged` is); `:248-270` wires expand + pad + the three new handlers.
  `TripPlanner.tsx:608/624/629` — **`setShelfIdeaRating` / `setShelfIdeaNote` /
  `commitShelfIdeaNote`**, new and shelf-side, on `setShelfIdeaFields`.
- **Mount 3** `PlacesLibrary.tsx:76` owns `expandedId`; `:118-128` wires the card.
  `PlacesWorkspace.tsx:175` — `patchPlace`, through the same `tripApi.updatePlace` +
  `applySavedPlacePatch` pair the sheet uses.
- **`scripts/fetch-drill-marks.mjs`** (new) + `pnpm marks:drill` — build-time fetch of the
  ten favicons into **`apps/web/public/drill/`**, output committed. Ran it: **10/10 written**,
  all `PNG 32×32`.

---

## The vet's findings, one by one

| Finding | How it is addressed |
| --- | --- |
| **HIGH · survey fidelity (Q6 → A)** | Resolved upstream: the v1 wireframe answers Q6 → A and this build ships one pass — doors, G-line, `PlaceDetails`, the `places` table and its migration all here. |
| **HIGH · forking the mask is not enough** | The type, the mask **and** the mapper fork: `PlaceDetails` (index.ts:77), `DETAILS_FIELDS` (google-places.ts:42), `toPlaceDetails` (:155). Test: "the masks FORK" + "carries the three G-line fields through instead of dropping them". |
| **HIGH · the envelope's real shape** | `GoogleLine` reads `googlePlaceId`/`name`/`rating`/`userRatingCount`/`websiteUri`/`nationalPhoneNumber` — our names. Pinned by `api/places/details/[id]/route.test.ts`, which asserts the whole JSON body. |
| **HIGH · `.half-light` does not exist** | Named `.rv-light-island`, landed in **both** token files and documented in `.design-sync/conventions.md`. |
| **HIGH · mount 2's handlers are stop-scoped** | Two NEW shelf-side handlers on `setShelfIdeaFields` (`TripPlanner.tsx:608`, `:624`, `:629`), threaded as `onRateIdea`/`onNoteIdea`/`onCommitIdeaNote`. The stop sheet's three are untouched. |
| **MED · the `places` table in one place only** | Three: `schema.ts:303`, `placeEnrichment` in `types.ts:405`, generated migration `0006_silly_vindicator.sql`. |
| **MED · `drillDoors` has no test home** | `packages/ui` now has a `test` script and 26 passing tests (`drill.test.ts`, `notes.test.ts`). |
| **MED · rendered in the wrong half** | No code consequence — the island is defined for both halves and the dark half is unchanged. Flagged for the walk below. |
| **MED · the shelf's pill/Locate fork** | Untouched (`DetailCards.tsx:397-428`). The pad adds no pill and no Locate: its rating row is stars only. |
| **MED · the saved-place write seam** | `onPatch` threaded `PlacesWorkspace.tsx:232` → `PlacesLibrary.tsx:122` → `PlaceCard`. |
| **MED · `Places.tsx:65` vs `:68`** | Doc nit; the live field is the one this code edits. |
| **MED · wrong CSS insertion point (`:130`)** | Inserted after the `.dark` block **closes** — entry.css after :166, globals.css after :277. Verified: both `.rv-light-island` rules are top-level, not nested. |
| **MED · mount 3's composition seam unnamed** | `drill` and `gline` are explicit `ReactNode` props on `PlaceCard`, filled by `PlacesLibrary`. Same for mount 1's locality: `IdeaCard` still receives no locality — the **app** fills `drill` with `locality={stop.place.name}`, which is the only place that fact exists. |
| **MED · the expand gesture named for mount 1 only** | Named for all three: mount 1 the ✎ button + the sheet's `ideaNoteOpen`; mount 2 `ShelfIdeaCard.onClick` (`:340-346`, its doc comment rewritten — a handle that expands, still not a link) + `Timeline`'s own `expandedIdeaId`; mount 3 the card's **name** becomes the expand + `PlacesLibrary`'s `expandedId`. |
| **MED · two ratings / two notes on a "been" card** | Resolved the only consistent way: while the pad is open the footer's **left slot renders empty** (`Places.tsx:148-149`) and its meta (source line or trip name) moves beside the stars via the pad's `meta` slot. The footer's *action* is untouched, which is what "unchanged footer" was protecting. |
| **MED · state ④ built wrong** | `StubPlacesProvider.details()` still returns `null`; only the type changed. Test: "never caches what the stub did not look up — state ④ stays empty". |
| **MED · `schema.ts:196` vs `:199`** | Doc nit, corrected in the new table's comment. |

---

## Decisions I made where the design was silent

1. **The AI-Mode verb for Travel/Other.** §5 names verbs for Stay/Eat/Do only. Travel and
   Other fall back to **"visiting"** (`drill.ts:88`), the same default `ideaCategoryType`
   already takes. Those two categories render no third group anyway.
2. **The mark fallback is the `<img>`'s `alt`.** The kit is strictly stateless (no component
   in `packages/ui` uses a hook or `"use client"`), so an `onError` handler would have been
   the first. `alt={MONOGRAM[door.id]}` gives the wireframe's monogram stand-in with no
   state at all — **render-required at the walk** (below).
3. **The pad's save line reads "saved" / "nothing saved yet", not "saved · just now".**
   Nothing tracks a save time — `ideas` and `saved_places` have no `updated_at` — and
   "just now" would be a claim we cannot make.
4. **`IdeaCard` keeps `noteVisible` AND gains `expanded`.** The mount still passes
   `noteVisible = open || has-a-note`, so an idea that merely *has* a note renders exactly
   what it renders today (the note box, nothing else); only the ✎ press opens the pad. If
   the two had been collapsed into one, every idea with a note would have sprouted nine
   doors and the stop sheet's density claim would be false.
5. **The island does not re-declare the three chrome tokens** (`--rv-navy`,
   `--rv-navy-deep`, `--rv-green-on-dark`). They carry the same byte in both halves, so
   repeating them says nothing — and `pwa.test.ts` asserts the manifest's navy is exactly
   **two** `--rv-navy` declarations. Every token that actually differs between the halves IS
   re-declared.
6. **`PlaceCard`'s note is uncontrolled.** Nothing above it holds a draft (unlike the trip
   tree, which is the idea mounts' draft), and a commit-on-blur field does not need one.
   `ResearchPad` supports both: `onNoteChange` present → controlled.
7. **The cache stores only what the G-line renders** — no coordinates, no formatted address
   (the design's table has no columns for them). So a **cache hit answers `location: null`
   and `address: null`** while a live call carries both. Nothing consumes those on this
   route (the picker uses `/api/places/search`), and it keeps `places` from becoming a
   second, staler copy of a place we already own. **A claim worth qa's eye.**
8. **`patchPlace` is optimistic and not rolled back** on failure — there is no dialog left
   open to report into, and silently reverting what someone just typed is worse than the
   toast. Same toast every other library write uses.

## Deliberately NOT built (named so it is not mistaken for an oversight)

- **Anything the issue's guards exclude** — in-app review text, photo galleries, hours,
  busyness, LLM summarisation, any social API or OAuth. These are links, nothing more.
- **Booking doors.** §5: booking belongs to the reservation flow (`onPromote` / "Book"),
  not the research pad.
- **A fourth mount.** `ReservationLineItem` can inherit `DrillRow` later; the design says
  "already free", not "do it now".

## For the walk — render-required, not certified here

1. **Typing in an expanded shelf row.** `draggable={!expanded}` (`DetailCards.tsx:451`) is a
   caret/selection/pointer claim static analysis cannot settle. Type in the note of an
   expanded shelf row, then **collapse it and drag the row onto a stop bar** — the drag must
   come back.
2. **The eleven door templates.** Every target is a third-party URL pattern that can change
   without notice. Open each once.
3. **The marks.** Ten PNGs are committed. Confirm they render at 16px on the white chip, and
   confirm a deliberately missing file (rename one) still shows a monogram + 30px chip and
   still navigates.
4. **The island in the dark half.** `layout.tsx:56` ships `dark`; the whole point of
   `.rv-light-island` is that a foreign favicon lands on **white** there. That is a render
   fact.
5. **`autoFocus` on the pad's note** — the caret should land in the note the moment a row
   opens, without the stop sheet jumping its scroll.
6. **State ② → ①.** With no `GOOGLE_API_KEY` (the normal local/walk case) the G-line must
   render **nothing at all** — no "checking…" that never resolves. It resolves on the
   degraded envelope, but only a browser proves the transition.

## The gate

`pnpm turbo run lint typecheck test` — **10/10 tasks green** (core 939 tests, web 160 —
five of them new for the details route — and ui 26, a package that had no runner before
this issue). `pnpm turbo run build` is green too.
