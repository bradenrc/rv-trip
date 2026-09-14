# Issue #45 · item 1 — Nav: five destinations, a phone tab bar, one page shell

Epic item **i1 of 5** only (`docs/design/45/plan.json`, read from
`mc/wireframe/issue-45-v0`). Items 2–5 are separate dispatches; nothing outside
i1's scope was touched.

## What changed

### One `LINKS` array, rendered twice — `apps/web/src/components/nav/Nav.tsx`

- `Nav.tsx:5-14` — the lucide import gains `Settings` (the import wrapped, so
  prettier/eslint stay happy at 100 cols).
- `Nav.tsx:24` — the fifth destination:
  `{ href: "/settings", label: "Settings", Icon: Settings, match: (p) => p.startsWith("/settings") }`.
  `/settings` was an orphan route (nothing in the app linked to it); this one
  line gives it both the desktop masthead entry and the phone tab.
- `Nav.tsx:31-32` — the component now returns a fragment wrapping two `<nav>`s.
- `Nav.tsx:33` — masthead keeps `dark sticky top-0 z-20 h-[62px] … bg-rv-surface`
  and takes `px-4 md:px-7`.
- `Nav.tsx:43` — the desktop link row goes behind `hidden items-center gap-1 md:flex`.
  Nothing else about the row changed; the active pill (`bg-rv-navy-soft`) is
  still the desktop treatment.
- `Nav.tsx:88-110` — the new phone bar:
  `dark fixed inset-x-0 bottom-0 z-20 flex border-t border-rv-border bg-rv-surface pb-[env(safe-area-inset-bottom)] md:hidden`,
  mapping the SAME `LINKS`. Each tab is
  `flex h-[56px] flex-1 flex-col items-center justify-center gap-[3px] text-[10px] font-semibold`,
  icon `size-[19px]`; active = `text-rv-ink` label + `text-rv-green` icon,
  inactive = `text-rv-ink-faded` + `text-rv-ink-subtle` — the exact pairing the
  masthead link already used. **No** `bg-rv-navy-soft` pill on the active tab,
  per the design's Q1 note.

### The one page gutter — new `apps/web/src/components/nav/PageShell.tsx`

`PageShell.tsx:21` is the single gutter:
`mx-auto w-full max-w-[1120px] px-4 pt-6 pb-[calc(88px_+_env(safe-area-inset-bottom))] md:px-7 md:pt-9 md:pb-[72px]`.
It renders the `<main>` landmark, so the six call sites keep theirs and none
grew a second one.

Six verbatim copies replaced (import + `<PageShell>`):

| file | import | element |
|---|---|---|
| `apps/web/src/app/page.tsx` | :6 | :40 |
| `apps/web/src/app/places/page.tsx` | :7 | :33 |
| `apps/web/src/app/map/page.tsx` | :6 | :30 |
| `apps/web/src/app/trips/new/page.tsx` | :8 | :43 |
| `apps/web/src/components/rig/RigForm.tsx` | :18 | :118 |
| `apps/web/src/components/nav/StubPage.tsx` | :2 (relative `./PageShell`) | :17 |

### Test — new `packages/core/src/web-shell.test.ts` (19 tests)

TDD: written first, run red (`ENOENT … PageShell.tsx`), then green.

i1 has no executable logic — it is JSX and Tailwind class strings, and
`apps/web`'s vitest has no DOM environment. So the contract is asserted against
the **source text** of the real files, exactly as `packages/core/src/mobile-map.test.ts`
and `mobile-dev-loop.test.ts` already do for the phone's un-mountable native
renderer (same `REPO`/`read`/`code`/`flat` helpers, same rationale). It covers,
criterion for criterion, every clause of i1's acceptance — including a recursive
walk of `apps/web/src` proving the old literal `max-w-[1120px] px-7 pb-[72px] pt-9`
survives in zero files.

## Decisions and findings addressed

- **Vet MED · `calc(88px+env(…))`.** Taken: the gutter is spelled
  `pb-[calc(88px_+_env(safe-area-inset-bottom))]`, and the test asserts the
  no-underscore form never appears in code. **Correction for the record:** I
  compiled both candidates through the repo's OWN `tailwindcss` v4 (`compile()`
  from `tailwindcss`, `apps/web/node_modules`) and *both* emit
  `padding-bottom: calc(88px + env(safe-area-inset-bottom))` — v4 normalizes the
  operator, so the vet's "silently dropped" is true of Tailwind 3, not of this
  tree. The underscore form is kept anyway: it is the documented escape and is
  correct under either major.
- **Vet MED · `StubPage` becomes dead code.** Out of i1's hands. Today it still
  has two live consumers (`app/settings/page.tsx`, `app/settings/people/page.tsx`),
  so i1 did what the item says — moved it onto `PageShell`. **i5 must decide its
  fate**: it deletes one consumer and converts the other, which leaves
  `StubPage.tsx` with zero call sites. Flagging it, not pre-empting it.
- **`aria-current="page"`** added on the active tab (only). Not in the
  wireframe's class list, but the bar has no other machine-readable active
  state once the pill is deliberately gone. It is an attribute, not a style —
  zero pixel impact. Call it out if you'd rather it went.
- **The #19 theme toggle is untouched.** `git diff -w` on `Nav.tsx` shows no
  hunk over the button at all — the only delta is the 2-space re-indent forced
  by the new fragment. Still the CSS-driven glyph (`theme-dark:` off `<html>`),
  never React state; `<Account/>` likewise. Both sit in the masthead's right
  cluster, which carries no `hidden` and no `md:` variant, so both render at
  every width. The test asserts all of this.
- **No scope creep.** The i2 grids/gantt, the i3 manifest + `viewportFit`, the
  i4 prefs table and the i5 Settings page are untouched. In particular
  `viewportFit: "cover"` (i3) is what makes the bar's
  `env(safe-area-inset-bottom)` resolve to a real inset — until i3 lands the
  inset is 0 and the bar simply sits flush. That is expected, not a regression.

## For qa / the walk

Claims worth checking:

1. `LINKS` is declared once and `LINKS.map(` appears exactly twice (asserted).
2. The masthead row is `hidden … md:flex` and the bar `md:hidden` — one
   breakpoint, no overlap, so exactly one of the two renders at any width.
3. The old gutter literal is gone from every `.ts`/`.tsx` under `apps/web/src`
   (asserted by directory walk, and by `grep -rn` — both clean).

Render-required, static analysis cannot certify (walk's job):

- That the fixed bar actually clears the page's last row on a 390px viewport —
  i.e. that 56px + 32px of `PageShell` padding is enough in practice.
- That `env(safe-area-inset-bottom)` resolves to a non-zero inset on a notched
  device. It will not until i3 ships `viewportFit: "cover"`.
- That five 10px labels fit across 390px without wrapping ("Settings" is the
  longest at 8 chars; ~78px per tab).

## Checks run

| command | result |
|---|---|
| `pnpm --filter @rv-trip/core exec vitest run src/web-shell.test.ts` (pre-impl) | RED — `Error: ENOENT … PageShell.tsx` |
| `pnpm --filter @rv-trip/core exec vitest run src/web-shell.test.ts` | `Test Files 1 passed (1) · Tests 19 passed (19)` |
| `pnpm --filter @rv-trip/core test` | `Test Files 35 passed (35) · Tests 678 passed (678)` |
| `pnpm turbo run lint typecheck test` | `Tasks: 9 successful, 9 total` |
| `grep -rn 'max-w-\[1120px\] px-7 pb-\[72px\] pt-9' apps/web/src` | no matches |
| tailwind v4 `compile()` probe of both calc spellings | both emit `padding-bottom: calc(88px + env(safe-area-inset-bottom))` |

`pnpm install --frozen-lockfile` was needed first — the fresh worktree had no
`node_modules`.

---

# Issue #45 · item 2 — The 390px sweep: grids, the Places lens, the trip header, a frozen gantt gutter

Epic item **i2 of 5** only (`docs/design/45/plan.json`, read from
`mc/wireframe/issue-45-v0`; the wireframe's §"Spec · Q2 · the breakpoint rule"
table and §"Spec · Q3 · the gantt" are the pixel target). i1 is already on this
branch and was not touched; items 3–5 are separate dispatches.

One idiom throughout: **bare class = phone, `md:` = desktop.**

## What changed

### The four inline grids (an inline style takes no Tailwind variant)

| file:line | now |
|---|---|
| `apps/web/src/app/page.tsx:79` | `grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]` |
| `apps/web/src/app/page.tsx:94` | `grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]` |
| `apps/web/src/components/places/PlacesLibrary.tsx:150` | `grid grid-cols-1 items-stretch gap-4 md:grid-cols-[1fr_360px]` |
| `apps/web/src/components/places/PlacesLibrary.tsx:166` | `grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))]` |
| `apps/web/src/components/map/MapOverview.tsx:191` | `grid grid-cols-1 items-stretch md:grid-cols-[1fr_360px]` — both the inline style **and** `max-[980px]:grid-cols-1` gone |

`grep -rn 'gridTemplateColumns' apps/web/src` → nothing. `grep -rn 'max-\[' apps/web/src` → nothing.
(`packages/ui/src/Gantt.tsx` still uses a `gridTemplateColumns` style object: its
column count is **data-derived** (`cols(n)`), which is exactly what a style prop
is for and what the item's acceptance scopes to the three app files.)

### `ViewSwitch` gains one optional prop — `packages/ui/src/Places.tsx`

- `:160` `fill = false`, `:169` `fill?: boolean` (documented in place).
- `:174` root — `fill ? "flex w-full md:inline-flex md:w-auto" : "inline-flex"`.
  Without `fill` the emitted class string is byte-identical to what shipped.
- `:188` each button gains `flex-1 gap-1.5 md:flex-none` under `fill`. The
  shipped `h-[30px] w-[34px]` stays on the button unconditionally: `flex-1`
  (basis 0) overrides the width below `md`, and `md:flex-none` hands it back —
  so at `md` and up the pill is the 34px icon-only control it has always been.
- `:192-197` the label renders beside the icon in an `md:hidden` span,
  `text-[13px] font-bold`, `text-rv-ink` active / `text-rv-ink-faded` inactive
  (the wireframe's `.viewswitch span` / `.viewswitch span.on`).
- Call site: `apps/web/src/components/places/PlacesLibrary.tsx:121` passes `fill`.
  It is the only `ViewSwitch` call site in the repo, so no other surface moves.

### The trip header — `apps/web/src/components/trip/TripPlanner.tsx`

- `:700` `mx-auto max-w-[1240px] px-4 py-6 md:px-6 md:py-8`.
- `:708` h1 **and** `:713` the `InlineText` className both carry
  `text-[28px] … md:text-[44px]` — the same clamp on both, or the inline editor
  jumps a size the moment it takes focus.
- `:748` the lens/costs/Add-stop cluster → `flex w-full flex-wrap items-center gap-3 md:w-auto`.
- `:749` the lens pill → `inline-flex flex-1 … md:flex-none`.
- `:770` Add stop → `ml-auto … md:ml-0`.

### The route rail — `apps/web/src/components/trip/RouteView.tsx:551`

`w-full md:w-[260px] md:flex-none`. It wrapped at 390 either way (the parent at
`:107` is `flex flex-wrap`); full-bleed stops the ragged 260 in a 358 column.

### The frozen leg gutter — `packages/ui/src/Gantt.tsx:17-19`

```
const gutter =
  "sticky left-0 z-10 flex w-[92px] flex-none flex-col justify-center self-stretch " +
  "border-r border-rv-border-soft bg-rv-surface pr-2 md:w-[120px]";
```

Still **one** constant, still consumed by all four row types — `RhythmStrip`
(`:30`), `Ruler` (`:49`), `SwimLane` (`:92`), `OpenLane` (`:213`) — inside the
`overflow-x-auto` scroller `Timeline.tsx:44` already has. Nothing else about the
gantt moved: `minWidth = Math.max(820, days * 30)`, `ROW_HEIGHT = 78`, the 30px/day
scale, `StopBar compact`, the `OpenSpan` drop targets and `GanttLegend` are untouched.

`apps/web/src/components/trip/Timeline.tsx:84-88` — the phone-only hint under the
scroller, above the legend: `← swipe the calendar · the leg column stays put →`,
`font-mono text-[10px] text-rv-ink-faded md:hidden` (plus `mt-2`, the wireframe's
8px of `.swipe-hint` top padding).

## Decisions, and the vet finding this item had to resolve

- **Vet HIGH · the sticky gutter did not actually occlude.** Correct, and both
  halves are fixed — in the gutter constant and in the four row wrappers, which
  is the only place they could be fixed:
  1. **The 16px `gap-4`.** A flex `gap` is transparent and cannot be painted, so
     a 16px strip of bars scrolled visibly between the sticky gutter and the
     lane. Removed from all four rows (`Gantt.tsx:29, 48, 91, 212`) — which is
     also what the wireframe draws: its `.gantt .scroller` is a bare
     `display:flex` with `.gutter{width:92px; padding-right:8px}` and **no** gap.
     The design's `pr-2` is that 8px.
     **Deviation to call out:** with the gap gone and `pr-2` kept as specified,
     the desktop lane now starts at 120px instead of 136px — a 16px shift. The
     alternative (inventing `md:w-[136px] md:pr-4` to hold desktop byte-still)
     would contradict both the design's literal constant and the wireframe. I
     took the design. **qa should confirm that trade is the intended one.**
  2. **The unpainted band.** The rows align `items-center` / `items-end`, which
     sized the gutter to its ~30px label box and left navy/green bars showing
     above and below it in a 78px lane. The constant now carries `self-stretch`
     (full row height, so the whole column is opaque) plus `flex flex-col
     justify-center` (the label stays optically centred, exactly where
     `items-center` had it). `self-stretch` on the child, not `items-stretch` on
     the row, so the lane's own alignment is untouched.
- **The remaining vet findings are not i2's.** The Units blast radius / `route-format.ts`,
  the `pins.ts` source-text tests, `SegmentedControl`'s required `Icon`,
  `theme_color`, `PageShell`'s `calc()`, `CostSwitch`'s label, prefs
  hydration/refresh, `rigs`' primary key and `StubPage`'s fate all belong to
  i3/i4/i5. Nothing here touches them.
- **Tailwind probe (not just belief):** every new arbitrary candidate was
  compiled through the repo's own `tailwindcss` v4 `compile()` (see Checks) —
  `md:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]` and friends emit real
  `grid-template-columns`. `apps/web/src/app/globals.css:6` already
  `@source`s `packages/ui/src`, so the DS's new `md:` variants compile in the app.

## Claims worth checking (qa)

1. `Gantt.tsx` has exactly **one** `const gutter =` and exactly **four**
   `{gutter}` consumers — asserted.
2. `ViewSwitch` without `fill` emits the pre-change class string; only the
   `fill` branch adds anything — asserted by the literal ternaries.
3. Both `text-[28px]` and both `md:text-[44px]` are present in TripPlanner and
   no bare (non-`md:`) `text-[44px]` survives — asserted by regex.
4. No `gridTemplateColumns` in the three app files and no `max-[` anywhere under
   `apps/web/src` — the latter by a recursive directory walk, not a spot check.

## Render-required — static analysis cannot certify these (the walk's job)

- That the sticky gutter genuinely occludes a `StopBar` mid-scroll at 390px,
  including the `z-10` vs the bars' `relative` stacking, and that the per-row
  `border-r` segments read as one column despite each row being its own flex
  container (an inherent property of the shipped four-component structure, which
  the design keeps).
- That the swipe hint is visible below `md` and gone at `md`.
- That the 16px desktop lane shift above looks right at 1240px.
- Pointer/overflow behaviour of the horizontal scroll on a real touch device.

## Checks run

| command | result |
|---|---|
| `pnpm install --frozen-lockfile` | needed first — the fresh worktree had no `node_modules` (exit 0) |
| `pnpm --filter @rv-trip/core exec vitest run src/responsive-sweep.test.ts` (pre-impl) | RED — `Tests 22 failed \| 3 passed (25)` |
| `pnpm --filter @rv-trip/core exec vitest run src/responsive-sweep.test.ts` | `Test Files 1 passed (1) · Tests 25 passed (25)` |
| `pnpm --filter @rv-trip/core test` | `Test Files 36 passed (36) · Tests 703 passed (703)` (678 + the 25 new) |
| `pnpm turbo run lint typecheck test` | `Tasks: 9 successful, 9 total` |
| `grep -rn 'gridTemplateColumns' apps/web/src` | no matches |
| `grep -rn 'max-\[' apps/web/src` | no matches |
| tailwind v4 `compile()` probe of every new arbitrary candidate | all emit CSS, e.g. `grid-template-columns: repeat(auto-fill,minmax(320px,1fr))` |

New test file: `packages/core/src/responsive-sweep.test.ts` (25 tests). Like
`web-shell.test.ts` (i1) and `mobile-map.test.ts`, i2 is JSX + Tailwind class
strings with no executable logic and no DOM in `packages/core`, so the contract
is asserted against the **source text** of the real files. **That is the honest
limit of this coverage: it proves the classes are written, not that they paint.**
