# Issue 19 — Slate + Sky, light/dark toggle · dev notes

The vetted wireframe (`mc/wireframe/issue-19-v0:docs/design/19/index.html`) implemented as
one pass (Q6 = A), with every vet finding addressed. Answers as signed:
Q1 A · Q2 B · Q3 A · Q4 A · Q5 A · Q6 A.

---

## The token contract — both halves, both files (Q2 = B, Q5 = A)

`packages/ui/styles/entry.css` and `apps/web/src/app/globals.css` now carry the palette
twice each, behind one indirection.

| what | entry.css | globals.css |
| --- | --- | --- |
| safelist — ember family retired, `accent{,-bright,-deep,-soft,-ink}` added | `:12` | — |
| `@theme` — fonts + radius, literal and un-halved | `:17` | `:112` |
| `@theme inline` — 30 colors + 4 shadows → `var(--rv-*)` | `:45` | `:75` |
| `:root` — the LIGHT half | `:83` | `:127` |
| `.dark` — the DARK half (the default) | `:130` | `:208` |

30 colors exactly, per §1's table: the 29 that shipped, renamed `rv-ember-*` → `rv-accent-*`,
plus the one sanctioned new name `rv-accent-ink`. Radius is literal and has no half.

`globals.css:127`/`:208` also hold the shadcn neutral scale, which was **inverted** before this
pass (`:root` carried the app's dark values, `.dark` carried shadcn's stock grey preset —
harmless only because nothing ever set the class). Both halves are re-derived role-for-role off
the rv-* table, with `--primary`/`--sidebar-primary` = `rv-accent-deep`, their `-foreground` =
`rv-accent-ink`, and `--ring`/`--sidebar-ring` = `rv-accent`. `--destructive` keeps the published
light/dark pair, which was already correct once the halves were un-inverted.

**One deviation worth naming:** `--muted` moved from `rv-surface` to `rv-navy-soft`
(slate-100 / slate-700). The old mapping would have made `bg-muted` white on a slate-50 page —
`bg-muted/50` is the card and dialog footer tone. slate-100/slate-700 is what the published slate
preset uses for muted/secondary/accent, and it is the value `--secondary` and `--accent` already
carried. Flagged for qa: this is the only shadcn role whose *token source* changed.

## Verified against the built stylesheet, not from memory

The design's load-bearing premise (`inline` flips per island but still emits `--color-rv-*`) is
true, but the emission rule is narrower than "only `reference` suppresses it" — Tailwind v4.3.3
**tree-shakes** theme variables it cannot see used. So I checked the compiled output rather than
the docs:

- `packages/ui/node_modules/.bin/tailwindcss -i apps/web/src/app/globals.css -o /tmp/tw/app.css`
- Utilities inline the raw var — `.bg-rv-surface { background-color: var(--rv-surface) }` — so
  every `rv-*` className **does** re-resolve inside a `.dark` island. ✓
- Every one of the 24 `var(--color-rv-*)` / `var(--shadow-rv-*)` references that actually exist
  in `apps/web/src` + `packages/ui/src` is emitted on `:root` in the new build. I diffed the
  emitted theme-variable set old vs new: the only differences are the ember→accent rename.
  Nothing regressed. ✓
- Pre-existing, **not** introduced here: `markerShadow()` (`palette.ts:200`) builds
  `var(--shadow-rv-${depth})` from a template literal, so `--shadow-rv-sm` / `-lg` are emitted by
  neither the old nor the new build. Same set before and after; out of scope to fix.

## §3 default dark, persisted, no flash

- `apps/web/src/app/layout.tsx:36` — `<html>` gains `dark` in its className.
- `apps/web/src/app/layout.tsx:35` — **`suppressHydrationWarning`**, per the vet's first HIGH.
  React 19 diffs `<html>`'s className during hydration and the inline script mutates it before
  then, so without this every light-theme user gets a recoverable mismatch. The wireframe's F3
  claimed A needed none; it does.
- `apps/web/src/app/layout.tsx:40-47` — the removal-only inline script, first child of `<body>`.
- `apps/web/src/lib/theme.ts` — **new**, 44 lines. `rv-theme` key, `THEMES`/`isTheme`,
  `DEFAULT_THEME = "dark"`, `useTheme()` over the existing `useStringPref`. No provider, no
  context, no new dependency.

## §4 the toggle · §5 the chrome islands

- `apps/web/src/app/globals.css:13` — `@custom-variant theme-dark (&:is(html.dark *));` beside
  the existing `dark` variant (F1: inside the `.dark` masthead, `dark:` is permanently true).
- `apps/web/src/components/nav/Nav.tsx:48-63` — the 32px button before the account pill. The
  glyph swaps in pure CSS off `<html>` (`theme-dark:block` / `theme-dark:hidden`); only the
  `title`/`aria-label` read React state. Compiled selector verified:
  `.theme-dark\:block:is(html.dark *)` at (0,2,1) beats `.hidden` at (0,1,0).
- The three islands, one word each: `Nav.tsx:21` (the `<nav>`),
  `StopDetailSheet.tsx:91` (the sticky header only — the body at `:88` is `bg-rv-surface-alt`
  and flips), `MapOverview.tsx:179` (the legend bar).

**A fourth island I added, and why.** `TripPlanner.tsx:385`'s active `ToggleTab` is
`bg-rv-navy text-rv-ink` — the only `bg-rv-navy*` call site that pairs a fixed dark ground with
*flipping* ink. In the light half that is slate-900 on slate-950: invisible. §5's reasoning
("the other `bg-rv-navy*` sites are element-level chips … dark marks on a light card") holds for
every other site because they are swatches with no text. I said it with the design's own
mechanism — `"dark bg-rv-navy text-rv-ink"` — rather than inventing a token. **Flagging this for
qa as the one call-site decision not enumerated in §8.**

## F2 · F7 · the map

- `apps/web/src/components/ui/sonner.tsx:3,8,12` — `useTheme` now comes from `@/lib/theme` and
  the Toaster follows the app theme instead of the OS. `next-themes` has **zero** importers left
  in the repo; per F3 the dependency itself stays (removing it is not in this slice).
- `apps/web/src/app/globals.css:283,287` — `.trip-card`'s two shadows read
  `var(--shadow-rv-md)` / `var(--shadow-rv-xl)` (F7). Both are emitted in the app build (checked).
- `apps/web/src/components/map/palette.ts:50` — `DEFAULT_STYLE_MODE` `"night"` → `"day"`.
  Night and Sat stay in the #12 style toggle.
- `palette.ts:97-124,176` — the **night column re-traced** to the new dark-half values, provenance
  comments renamed. Scrims recomputed from their documented alphas: `rgba(15, 23, 42, 0.84)`
  (rv-navy-deep @ 84%), `rgba(2, 6, 23, 0.88)` and sat's casing `rgba(2, 6, 23, 0.8)` (rv-navy).
  The **day column is untouched** — map-only literals tuned to `outdoors-v12`, per §8.
- `apps/web/src/components/map/nightfall.ts:30-59` — **not named in §8's scope table**, but it
  carries the same "every literal is its `rv-*` token's value" invariant for the night *basemap*
  restyle, with the token names in the rows. Re-traced (6 values) so the file's stated invariant
  stays true and the night basemap doesn't stay Nightfall-navy under Slate pins. Mechanical and
  derivable from the token names already in the file; **flagging as an extension beyond §8.**

## The renames

`rv-ember*` → `rv-accent*` across 17 `.ts`/`.tsx` files (suffixes preserved, so
`-bright`/`-deep`/`-soft` came along). `grep -rn rv-ember apps packages` → 0 hits outside two
historical comments in the two stylesheets.

The seven CTAs that were `bg-rv-ember … text-rv-navy` are **not** a mechanical rename (the vet's
second HIGH): they are `bg-rv-accent-deep … text-rv-accent-ink`, which is what §1's role table and
§6 render. `page.tsx:52` · `places/page.tsx:28` · `RigForm.tsx:229` · `TripPlanner.tsx:245` ·
`RouteView.tsx:272` · `Places.tsx:87` · **`StopDetailSheet.tsx:188`** — the vet named six; the
seventh matches the same predicate and got the same treatment.

## Tests — `packages/core/src/theme/`

Both files are part of the change; every assertion the vet named is addressed.

`nightfall-tokens.test.ts` (29 tests, was 14):

- `block(css, sel)` slicer, because the raw pairs now appear twice per file.
- `SLATE_SKY_LIGHT` / `SLATE_SKY_DARK` — 30 colors + 4 shadows each, asserted per file with
  `toEqual`, so a missing or extra token reds.
- The `@theme inline` map is asserted to be a pure `--color-rv-X: var(--rv-X)` indirection.
- **The drift guard is re-pointed at the RAW halves of BOTH files, `:root` and `.dark`** — the
  vet's sixth HIGH. Verified by mutation: changing `--rv-accent` in `entry.css` alone reds
  "verbatim mirror" (light half) and again for the dark half. It is not vacuous.
- Safelist: asserts the five accent names present **and** the four ember names absent.
- `SHADCN_MUST_NOT_MISS` → `SHADCN_LIGHT` + `SHADCN_DARK`, one fixture per half.
- Sweep 1's filter is now `bg-rv-(?:green|green-on-dark)`, plus a **new** both-directions
  assertion that `bg-rv-accent-deep` and `text-rv-accent-ink` only ever appear together.
- Stars: `var(--color-rv-accent)`; `ICON_STATE` re-keyed to the same.
- C4 rewritten: `.trip-card` reads the token scale, and carries no `rgba(0, 0, 0` at all.
- New `describe` for the mechanism: `dark` + `suppressHydrationWarning` + the removal-only script
  in `layout.tsx`; the `rv-theme` key and `DEFAULT_THEME` in `theme.ts`; the `theme-dark` variant
  and the two `theme-dark:` classNames; the three islands; sonner's import and zero `next-themes`
  importers.

`map-palette.test.ts` (13 tests):

- **`tokenValue()` re-pointed at the raw `.dark` block** of `entry.css` — the vet's fifth HIGH.
  Under Q2 = B the `@theme inline` map is the literal text `var(--rv-green)`, which no night
  literal can equal. Verified by mutation: changing `--rv-accent` in the dark half reds
  "night is the shipped rv-* tokens".
- `NIGHT_TOKENS` ember → accent; the two scrims and sat's casing re-tabled.
- New: `DEFAULT_STYLE_MODE` is `"day"`.
- C5 (`TripCard` cover gradients) left alone: those are raw hexes, not tokens, and §8 does not
  name them. They are drawn at `opacity: 0.08` — **flagged for the walk** as the one surface whose
  light-half appearance nobody has specified.

## Not done, deliberately

- `next-themes` stays in `apps/web/package.json` (F3 — removing it is not this slice).
- The test files keep their `nightfall-*` names (§8 flags this and defers it).
- `rv-green-cta` stays an alias of `rv-green` with zero call sites (§8's dev note).
- `.design-sync/conventions.md` still describes the ember roles; not in §8's scope table.
- Note for design-sync: the DS bundle's default is now the **light** half (`.dark` is opt-in), so
  previews will render light unless the driver's HTML wrapper sets `class="dark"`. Q5 = A wanted
  the light half available in the DS; whether previews should default to it is a driver question.

## For the walk (the vet's FLAG — none of this is certifiable statically)

1. The light half actually painting — it has never been rendered in the real app.
2. No dark→light flash for a user who chose light (the inline script beating first paint).
3. The three `class="dark"` islands staying dark in the light theme, in the built stylesheet.
4. `DEFAULT_STYLE_MODE = "day"` fetching the `outdoors-v12` basemap.
5. Zero hydration warnings in the console with `rv-theme=light` set (the `suppressHydrationWarning`
   fix).

**The one constraint to carry forward** (the vet's MED, now true in the built CSS): an inline
`style` reading `var(--color-rv-X)` resolves the **document** half, not an island's, because the
`@theme` map is substituted on `:root` and `.dark` never redeclares it. Round 1 claimed "all three
islands are className-only today, so nothing breaks" — **that was wrong**, and qa was right: the
legend island wrapped `TeardropKey`, whose inline style read the tokens. Fixed below. The rule
stands: no inline-styled child (a `StatusPill`, a `categoryMeta` tile, a `Gantt` bar) may be added
inside a `.dark` island without re-checking.

## Gate

`pnpm turbo run lint typecheck test` → **7 successful, 7 total**; `168 passed (168)`.

---

# Round 2 — the qa verdict

## Fixed

**FN · the `suppressHydrationWarning` guard was vacuous.**
`packages/core/src/theme/nightfall-tokens.test.ts:388-392` — the old
`expect(layout).toContain("suppressHydrationWarning")` also matched the word in the *comment* above
the tag, so deleting the attribute left the test green. The assertion is now anchored inside the
element: `toMatch(/<html[^>]*\bsuppressHydrationWarning\b/s)`. **Mutation-proved:** removing the
attribute from `layout.tsx:35` (the word still present once, in the comment) now reds
"§3: the server renders `dark`…" — `Tests 1 failed | 43 passed (44)`. The attribute itself was
already shipped and correct; only the guard changed.

**CN · the legend island's teardrop painted the light half.**
`apps/web/src/components/map/MapOverview.tsx:220-236` — `TeardropKey` took the className path:

- was `style={{ background: hollow ? "var(--color-rv-navy-deep)" : "var(--color-rv-green)",
  borderColor: hollow ? "var(--color-rv-green)" : "transparent" }}`
- now `className={\`size-[13px] flex-none border-2 ${hollow ? "border-rv-green bg-rv-navy-deep" :
  "border-transparent bg-rv-green"}\`}`, with only the teardrop **geometry** (`borderRadius`,
  `transform`) left inline — geometry has no half. A comment on the function states why.

**Verified in the compiled stylesheet**, not from memory
(`packages/ui/node_modules/.bin/tailwindcss -i apps/web/src/app/globals.css`): all four utilities
emit and read the *raw* var — `.bg-rv-green { background-color: var(--rv-green) }` (:1255),
`.bg-rv-navy-deep` (:1273), `.border-rv-green` (:1180), `.border-transparent` (:1192) — and
`--rv-green` is declared **twice**, `#059669` on `:root` (:2974) and `#34d399` inside `.dark`
(:3042). So inside the legend bar the teardrops now resolve `#34d399`, the same green as the
className swatches beside them. `var(--color-rv-green)` is still emitted once on `:root, :host`
only, exactly as qa measured — which is why the inline read was wrong.

Guarded by a new test, `nightfall-tokens.test.ts:429-446`: `TeardropKey`'s body contains no
`var(--color-rv-` and does carry the three rv-* classNames. **Mutation-proved red** against the
round-1 source before the fix.

**DD · `NIGHTFALL_PAINT` had no guard.** `packages/core/src/theme/map-palette.test.ts:36,214-228` —
the night *basemap* restyle stated the same invariant as the night overlay column (every literal is
its token's dark-half value, token name beside it) with nothing asserting it. The new test parses
the six `PaintRow` `token`/`color` pairs out of `apps/web/src/components/map/nightfall.ts` and
compares each against `tokenValue()`, the resolver already re-pointed at `entry.css`'s raw `.dark`
block. **Mutation-proved both directions:** editing a literal in `nightfall.ts` reds it, and editing
`--rv-border` in entry.css's dark half reds it (plus two neighbours, correctly).

## Not fixed — needs a design decision, not a dev guess

Both are qa's own framing, and both are **design-inherited**: the values match the signed §1 table
(wireframe `index.html:399-405`) exactly. Changing them is a palette revision, not an implementation
detail, so they are left as signed and escalated:

1. **Light-half CTA misses AA.** `bg-rv-accent-deep` `#0284c7` under `text-rv-accent-ink` `#ffffff`
   = **4.10:1**. All seven CTA sites are 13–14px bold/semibold, which is not WCAG large text
   (needs 18.66px bold), so 4.5:1 applies. The dark half is fine (7.28:1). qa notes sky-700
   `#0369a1` + white = 5.93:1 clears. Sites: `page.tsx:52` · `places/page.tsx:28` ·
   `RigForm.tsx:229` · `TripPlanner.tsx:245` · `RouteView.tsx:272` · `StopDetailSheet.tsx:188` ·
   `packages/ui/src/Places.tsx:87`.
2. **Light-half `--rv-ink-subtle`** `#94a3b8` on `--rv-surface` `#ffffff` = **2.56:1**, under the
   3:1 non-text minimum for the grip handles and filter icons carrying it
   (`FloatingStopCard.tsx:32`, `RouteView.tsx:92`, `Places.tsx:145/181`, `MapFrame.tsx:48`).
   Dark half 3.07:1. Batch with (1).

If the answer is "retune the two light-half values", it is a two-line change in the `:root` halves
of `packages/ui/styles/entry.css` and `apps/web/src/app/globals.css` plus the matching fixtures in
`nightfall-tokens.test.ts` — the drift guard and the `toEqual` tables will red until both files and
both fixtures agree, which is the point.

## Added to the walk list (qa's CL, previously unmentioned)

6. **`<html class="dark">` wakes the shadcn `dark:` variants for the first time.** Nothing ever set
   the class before this pass, so every dormant `dark:` inside `components/ui/*` now applies in the
   DEFAULT theme. Only `components/ui/input.tsx:11` renders today (via `RigForm`), which gains
   `dark:bg-input/30` over a previously transparent field. Expected and consistent with the theme —
   but confirm the field still reads as a field in both halves.

## Gate — round 2

`pnpm turbo run lint typecheck test` → **7 successful, 7 total**; `170 passed (170)` (was 168; the
two new guards). `pnpm install` was needed first — this worktree came without `node_modules`.
