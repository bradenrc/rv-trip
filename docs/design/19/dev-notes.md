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
`@theme` map is substituted on `:root`. All three islands are className-only today, so nothing
breaks — but no inline-styled child (a `StatusPill`, a `categoryMeta` tile, a `Gantt` bar) may be
added inside one without re-checking.

## Gate

`pnpm turbo run lint typecheck test` → **7 successful, 7 total**; `168 passed (168)`.
