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

---

# Issue #45 · item 3 — PWA: manifest, viewport, icons; no service worker

Epic item **i3 of 5** only (`docs/design/45/plan.json` + the wireframe's
§"Spec · Q7 + Q8" block, `index.html:915-970`, both read from
`mc/wireframe/issue-45-v0`). i1 and i2 are already on this branch and were not
touched; i4 (prefs) and i5 (Settings/units) are separate dispatches.

Nothing in this item is a redesign: it is four new files, one new export, and
zero changes to any rendered component.

## What changed

### `apps/web/src/app/manifest.ts` (new, 36 lines)

Next's typed `MetadataRoute.Manifest`, verbatim from the wireframe's source block:
`name` "RV Trip Hub" (`:23`), `short_name` "RV Trip" (`:24`), `start_url` "/"
(`:25`), `display` "standalone" (`:26`), `background_color` (`:27`) and
`theme_color` (`:28`) both `#020617`, `icons` (`:31`, `:33`) listing
`/icon.svg` (`sizes "any"`, `image/svg+xml`, `purpose "any"`) and
`/icon-maskable.svg` (`purpose "maskable"`).

The hex is written with its provenance in a comment on both lines, because a
manifest is JSON and cannot carry a token. **Provenance correction:** the
wireframe cites `packages/ui/styles/entry.css:84`. The real declarations are
**`:85` (light) and `:131` (dark)** — `--rv-navy: #020617` in both, which is the
premise the static `theme_color` rests on. The comment cites the true lines and
the test parses the value out of `entry.css` rather than repeating it.

### `apps/web/src/app/layout.tsx:1`, `:25-40`

`:1` — the type import becomes `import type { Metadata, Viewport } from "next"`.
`:35-40` — the new export beside the existing `metadata`:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617", // --rv-navy, verbatim
};
```

Nothing else in `layout.tsx` moved — in particular the removal-only no-FOUC
script is byte-identical (`git diff` shows two hunks, the import line and the
inserted export).

### The mark — three files, one geometry

- **`apps/web/src/app/icon.svg`** (new) — `viewBox="0 0 32 32"`, so it *is*
  `Nav.tsx:24-27`'s tile at its own numbers: `:7` a `rx="6"` (`--radius-rv-md`,
  `entry.css:25`) `#020617` square; `:9` lucide's Compass at
  `translate(6.5 6.5) scale(0.79166667)` — i.e. 19/24 scale centred in 32, which
  is `size-[19px]` inside `size-8` — in `#34d399` (`--rv-green-on-dark`) with
  `fill`, `stroke` and `stroke-width="1.5"` exactly as `Nav.tsx:26` passes them.
  Next serves it at `/icon.svg` and wires the favicon (verified below).
- **`apps/web/public/icon-maskable.svg`** (new) — same mark, `:5` the navy bleeds
  to every edge (no `rx`: Android's adaptive mask supplies the shape), `:7` the
  Compass at `scale(0.63333333)` = exactly 0.8 × the icon's scale, the 80% safe
  zone.
- **`apps/web/src/app/apple-icon.tsx`** (new) — `:17` `size = { width: 180,
  height: 180 }`, `:18` `contentType = "image/png"`, `:25` `new ImageResponse(…)`
  from `next/og` (`:1`). `:22` derives the glyph size from the same 19/32
  proportion rather than hard-coding 107. iOS Add-to-Home-Screen reads
  `apple-touch-icon`, not the manifest, and will not take an SVG — so this is the
  one raster, and generating it keeps a binary out of git.

The lucide path `d` is inlined identically in all three files and is asserted
equal to the `d` in the installed `lucide-react` (`dist/esm/icons/compass.mjs`),
so a lucide bump that changes the Compass cannot silently fork the app icon.

### Test — new `packages/core/src/pwa.test.ts` (21 tests, 239 lines)

Unlike i1/i2 this item is mostly **data**, so most of it is *executed*, not
grepped: the test dynamically imports the real `apps/web/src/app/manifest.ts`
and asserts the returned object field-for-field, with `background_color` /
`theme_color` compared against the navy **parsed out of `entry.css`** (asserting
against a repeated literal would only prove the test agrees with itself). It
also resolves every manifest icon `src` against the filesystem, walks
`apps/web` to prove `app/manifest.ts` is the only manifest and that nothing
registers a background cache, parses `apps/web/package.json` for PWA deps, and
checks the maskable scale is 0.8× the icon's.

TDD honesty: the SVGs and `apple-icon.tsx` were written **before** the test,
because I had to prove `ImageResponse` renders at all (probe below) before
committing to a shape. The test was then written against the acceptance, and
its teeth were verified by **mutation** rather than by claiming a red run I did
not do: flipping `theme_color` to `#0f172a`, `viewportFit` to `"auto"`, and the
maskable scale to the un-inset value produced `Tests 4 failed | 17 passed`, and
the mutations were reverted (see Checks). The first honest red was real, too —
the run below caught my own doc comments in `manifest.ts` using the words
"service worker" and `rel="manifest"`, which the no-SW guard rejects; the prose
was reworded, not the guard.

## Findings the walk / qa should decide on

**1 · HIGH — the mark renders as a featureless green disc, and so does the
masthead.** `Nav.tsx:26` passes `fill="currentColor"` to lucide's `<Compass/>`.
lucide's `Icon.mjs` spreads `...rest` *after* `defaultAttributes`, so that
`fill` overrides lucide's `fill: "none"` on the **root `<svg>`** — the circle
child inherits it and fills solid, and the needle path is filled in the *same*
green, so it disappears into the disc. I rendered it: the generated 180×180
apple-icon is a plain `#34d399` circle on `#020617`, no compass visible.

I shipped it that way **deliberately**, because the design says the icon is
"exactly what `Nav.tsx:25-27` draws", and the alternative — adding `fill="none"`
to the circle — would make the app icon *differ* from the shipped masthead mark
it exists to mirror, which is an unvetted redesign of the brand mark, not an i3
change. It is a one-line fix in three files (`fill="none"` on each `<circle>`)
**plus** `Nav.tsx` if the intended mark is the outlined compass the wireframe
draws as `◎`. **This needs a human call; I did not make it.**

**2 · MED — the vet's Q7 objection is real, and i3 ships the design anyway.**
The vet is correct that the masthead paints `bg-rv-surface`, which inside the
`dark` island is `#1e293b` (`entry.css:135`), **not** `#020617`. So "the OS
status bar is continuous with the masthead" is not literally true of the colour
pinned here — the status bar will be one step darker than the bar beneath it.
The item's acceptance freezes `#020617` byte-for-byte, so that is what shipped.
If continuity is the goal the value should be `--rv-surface`'s dark half
(`#1e293b`); that is a two-line change (manifest + viewport) and a test constant.
**Flagged, not decided.**

**3 · LOW — `/apple-icon` has no file extension.** The build routes it at
`/apple-icon` (see the route table in Checks) and the emitted link is
`href="/apple-icon?832f5f2d432a6f99"`. `proxy.ts:31`'s matcher excludes static
paths *by extension*, so unlike `/icon.svg`, `/icon-maskable.svg` and
`/manifest.webmanifest` (all excluded, the last explicitly by `webmanifest`),
**middleware runs on `/apple-icon`**. With Clerk configured, a *signed-out*
fetch of it would get the sign-in redirect. In practice Add-to-Home-Screen
happens in a signed-in Safari tab that sends the session cookie, so this is not
expected to bite — but it is a real asymmetry and the fix (adding `apple-icon`
to the matcher's exclusion) touches the #26 auth boundary, which is out of i3's
scope. **Flagged, not changed.**

**4 · Note — `app/favicon.ico` still exists and still wins in some browsers.**
The design says `icon.svg` "wires the favicon"; it does, but Next emits *both*
links (verified below). Removing the shipped `.ico` was not in the item, so it
stayed.

## Render-required — the walk's job, not assertable here

- iOS Add-to-Home-Screen actually picking up the generated `apple-touch-icon`,
  and the install prompt/splash using `background_color`.
- Android's adaptive mask leaving the 80% inset mark uncut.
- `viewportFit: "cover"` resolving `env(safe-area-inset-bottom)` to a **non-zero**
  inset on a notched device — which is what i1's tab bar and `PageShell` gutter
  were written against. The `<meta>` is confirmed emitted; the inset is not.
- Whether the disc-vs-compass call above looks right at 32px in a tab strip.

## Checks run

| command | result |
|---|---|
| `pnpm install --frozen-lockfile` | fresh worktree had no `node_modules` — `Done in 9.2s` |
| `node` probe of `next/og` `ImageResponse` (both an `<img>` data-URI SVG and an inline `<svg>`) | `bytes 2631 png? true dims 180 180` — identical output; inline `<svg>` shipped |
| `pnpm --filter @rv-trip/core exec vitest run src/pwa.test.ts` (first run) | RED — `Tests 2 failed \| 19 passed (21)`: my own comments tripped the no-SW / no-`rel="manifest"` guards |
| `pnpm --filter @rv-trip/core exec vitest run src/pwa.test.ts` | `Test Files 1 passed (1) · Tests 21 passed (21)` (verbose: all 21 ran, none skipped) |
| mutation check (`theme_color`→`#0f172a`, `viewportFit`→`"auto"`, maskable scale→icon scale), then reverted | `Tests 4 failed \| 17 passed (21)`; `git diff --stat` after revert showed only `layout.tsx` |
| `pnpm --filter @rv-trip/core test` | `Test Files 37 passed (37) · Tests 724 passed (724)` (703 + the 21 new) |
| `pnpm turbo run lint typecheck test` | `Tasks: 9 successful, 9 total` |
| `pnpm exec next build` (apps/web) | build succeeded; route table lists `○ /apple-icon`, `○ /icon.svg`, `○ /manifest.webmanifest` |
| `next start` + `curl /settings` head | `<link rel="manifest" href="/manifest.webmanifest"/>`, `<link rel="icon" href="/icon.svg?…" sizes="any" type="image/svg+xml"/>`, `<link rel="apple-touch-icon" href="/apple-icon?…" type="image/png" sizes="180x180"/>`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>`, `<meta name="theme-color" content="#020617"/>` |
| `curl` each asset | `manifest 200 application/manifest+json` · `icon.svg 200 image/svg+xml` · `apple-icon 200 image/png 2631b` (`png dims 180 180`) · `maskable 200 image/svg+xml` |
| `grep -ri serviceworker apps/web/src` | no matches (exit 1) |
| `git status --short` | only the four new files + `layout.tsx`; `apps/web/.next` is ignored (`apps/web/.gitignore:17`) |
| `git diff apps/web/package.json` | empty — no PWA/service-worker dependency added |

---

# Issue #45 · item 4 — Preferences that follow the account: `user_prefs` + `/api/prefs`

Epic item **i4 of 5** only (`docs/design/45/plan.json` + the wireframe's
§"Spec · Q6 · where preferences live", `index.html:760-815`, both read from
`mc/wireframe/issue-45-v0`). i1–i3 are already on this branch and none of them
was touched; i5 (the Settings page + units) is a separate dispatch.

Nothing renders differently after this item. It is a table, a migration, a
route, a write-through and one invisible client component — the second front
door (i5) is what will actually show it.

## What changed

### The 9th table — `packages/db/src/schema.ts:271-277`

`userPrefs = pgTable("user_prefs", { ownerId: text("owner_id").primaryKey(),
theme, units, mapStyle, trackCosts, updatedAt })`, verbatim from the design's
source block. Every preference column is a bare, nullable `text`/`boolean`;
`updated_at` is `defaultNow().notNull()`. No `pgEnum` (asserted: the count stays
at the base sha's six), no index — `owner_id` IS the primary key, so Postgres
already has the only btree this table will ever be read by.

**Factual correction taken from the vet, and written into the doc comment:**
`rigs` is *not* owner-keyed — `schema.ts:195-196` is `id: uuid(...).primaryKey()`
with `ownerId: text(...).notNull().unique()`. The *behaviour* is the same
singleton-per-account, and `upsertPrefs` does copy `upsertRig`'s
`onConflictDoUpdate`, but the comment says "rigs is a surrogate-keyed table with
`.unique()` on owner_id; here there is nothing else to key by" rather than
repeating the plan's wrong claim.

### The migration — `packages/db/drizzle/0003_user_prefs.sql`

Generated by `pnpm --filter @rv-trip/db generate` (output below), then renamed
from drizzle-kit's `0003_keen_blackheart` to `0003_user_prefs` with the journal
tag updated to match — the convention the three existing migrations already
follow (`0000_baseline`, `0001_route_cache`, `0002_route_nav`). One `CREATE
TABLE`, `"owner_id" text PRIMARY KEY NOT NULL`, four nullable columns, nothing
else. `packages/db/drizzle/meta/0003_snapshot.json` and the `_journal.json`
entry (`idx: 3`) came with it. `apps/web/vercel.json`'s
`pnpm --filter @rv-trip/db migrate && next build` is what applies it on deploy;
the API test harness applies it too (its `globalSetup` runs `drizzle migrate()`
against a fresh run database), which is how the integration tests below could
run at all.

### `packages/db` — the two functions

- `queries.ts:449` `getPrefsByOwner(ownerId): Promise<UserPrefs | null>` —
  `db.query.userPrefs.findFirst`, scoped by `eq(userPrefs.ownerId, ownerId)`;
  `null` for an account that has never chosen anything, the same "null is a real
  state" shape as `getRigByOwner`.
- `queries.ts:456` `mapPrefsRow` — the only mapping needed: `updated_at` leaves
  as an **ISO string**, not a `Date`, so the JSON contract does not depend on
  what a serializer guesses.
- `mutations.ts:583` `upsertPrefs(owner, patch)` — `upsertRig`'s shape, with
  `target: userPrefs.ownerId` (`:592`). **`:586` is the load-bearing line:**
  `values` is built only from keys where `patch[key] !== undefined`. Without it,
  a one-field PUT would write `null` over the other three — a theme toggle
  silently wiping a units choice another device made a moment earlier. That
  exact mutation is what the DB test below catches.

### `apps/web/src/app/api/prefs/route.ts` (new, 32 lines)

`api/rig/route.ts`'s handler shape, line for line (the test asserts the two are
the same shape after normalising the schema name): `GET` at `:21` returns
`getPrefsByOwner(await getOwner())`; `PUT` at `:25` `safeParse`s the body
(`:26`) and returns `NextResponse.json({ error: parsed.error.flatten() }, {
status: 400 })` on failure (`:28`). Both verbs scoped by `getOwner()` and by
nothing else — `.strict()` is what stops a body naming `ownerId` from reaching
past it.

### The translation lives in core — `packages/core/src/domain/prefs.ts` (new)

**This is the one deliberate deviation from the item's letter, and it is the
vet's own MED finding driving it.** The plan puts a `REMOTE` map in
`lib/pref.ts`; the vet correctly points out that a bare key→column map is not
enough, because `pref.ts:30,35` stores booleans as the strings `"1"`/`"0"` while
`user_prefs.track_costs` is a real `boolean` column, and the round-trip value
mapping was never pinned. A map plus its coercion is *logic* — so it went where
this repo's logic is unit-tested:

- `:38` `PREF_REMOTE` — `rv-theme→theme`, `rv-units→units`,
  `rv-map-style→mapStyle`, `rv-track-costs→trackCosts`.
- `:57` `isRemotePrefKey` — local-only keys are a no-op, not a PUT.
- `:65` `userPrefsPatch` — the zod grammar for the PUT body: four optional,
  nullable fields, `.strict()`. Absent = "not touching it"; explicit `null` =
  "back to never-chosen".
- `:91` `toRemotePatch(key, stored)` — LOCAL→REMOTE. `"1" → true` for
  `trackCosts` (the same rule `useBooleanPref` *reads* with, not JS
  truthiness); everything else passes through. Returns **one** field, never four.
- `:105` `toLocalEntries(row)` — REMOTE→LOCAL, inverted, and the null rule:
  a null column writes **nothing**, never the string `"null"`.

`lib/pref.ts:48` re-exports it as `REMOTE` so the seam still reads from the file
the design names. **Deliberately not validated in core:** the value vocabularies.
`theme`/`units`/`map_style` are `text` columns, not enums, and every reader
already narrows an untrusted string with a fallback (`isTheme`, `isStyleMode`,
`useStringPref`'s `isValid`). Re-stating those lists in core would fork them from
the modules that own them — and `rv-units` has no vocabulary yet (that is i5).

### `apps/web/src/lib/pref.ts` — the write-through

- `:55` `pushRemote(key, stored)` — returns immediately for an unmapped key,
  otherwise `void fetch("/api/prefs", { method: "PUT", body:
  JSON.stringify(toRemotePatch(key, stored)), keepalive: true })` with a
  swallowed rejection. Fire-and-forget: a dead network costs the sync, never the
  toggle.
- `:82` `hydrate(row)` — writes each non-null column into `localStorage` and
  `notify()`s **once**, and only if something actually differed (an unchanged
  row costs zero re-renders). Wrapped in try/catch: private mode is not an error
  the user sees.
- `:108` and `:159` — `pushRemote` is called **after** `localStorage.setItem`
  and **after** `notify()`, in both setters. Exactly two call sites, asserted.

**No call site changed.** Both hook signatures are byte-identical, which the
test asserts as source text, and `git diff` over `TripPlanner.tsx`,
`MapMount.tsx` and `lib/theme.ts` is empty.

### `apps/web/src/components/nav/PrefSync.tsx` (new) + `layout.tsx:7, :74`

`"use client"`, renders `null`. One `useEffect`: GET `/api/prefs` (`:34`),
`hydrate(await res.json())` (`:36`), then re-assert `<html class="dark">`
(`:40`) — the theme is the one preference painted as a class rather than read
through a hook, so it is the one thing hydration has to do by hand, and it is
narrowed by the app's own `isTheme` rather than by a string compare. A `!res.ok`
(a 401 from `proxy.ts` when Clerk is on and the session is gone) is a silent
return. It never PUTs.

Mounted once, inside `MaybeClerk`. **`layout.tsx`'s inline no-FOUC script is
byte-identical to the base sha** — verified by diffing the extracted block
against `71046ce`, output below — and the test also asserts `<script>` still
precedes `<PrefSync>` in `<body>`. localStorage stays the pre-paint answer; the
theme is never a fetch's conclusion.

### Test-harness changes (`packages/db/src/testing/`)

A new table has to join the reset or it leaks between tests:
- `truncate.ts:33` — `user_prefs` added to the single `TRUNCATE`.
- `fixtures.ts:43` `UserPrefsRow`, `:360` `insertPrefs` (exposed as `fx.prefs`,
  `:382`), `:493` `read.prefsRow`, `:497` `read.countPrefs` — the same shapes
  `fx.rig` / `read.rigRow` / `read.countRigs` already have.

## Tests

**Correction to the brief:** `packages/core` is *not* the only package with a
`test` script — `apps/web` has a full **API integration suite against a real
Postgres** (`apps/web/vitest.config.mts`, issue #30), and it ran here. So i4 is
the first item in this epic whose acceptance is proved by executed code rather
than by source text.

1. **`apps/web/src/app/api/prefs/route.test.ts` (new, 11 tests) — a real
   database.** GET answers `null` and creates no row; the first PUT inserts and
   returns the nulls *intact*; a PARTIAL PUT leaves the three fields it did not
   name alone; `trackCosts` round-trips as a real boolean (`false`, not null);
   an explicit `null` puts a preference back to never-chosen; `updated_at` is
   touched on the conflict branch (asserted against `PINNED_NOW`, the same way
   `api/rig/route.test.ts` does it); an unknown field, a body naming `ownerId`,
   and `trackCosts: "1"` each 400 **and write nothing**; and the partition test
   seeds `OTHER_OWNER`'s row and proves GET does not see it, PUT does not touch
   it, and it comes back byte-identical.
2. **`packages/core/src/domain/prefs.test.ts` (new, 20 tests)** — the key map,
   both coercion directions, the null rule, the local→remote→local identity, and
   the `userPrefsPatch` accept/reject matrix. All executed.
3. **`packages/core/src/prefs-account.test.ts` (new, 37 tests)** — the wiring,
   plus **`hydrate()` executed for real**: `apps/web/src/lib/pref.ts` is imported
   by absolute `file://` URL (a variable specifier, so `tsc` never drags a
   "use client" DOM module into core's `lib: ["ES2022"]`) and called against a
   stub `localStorage` — writes, the `"1"`/`"0"` rendering, the null skip, the
   overwrite, the no-row case, and storage that throws. The rest — the migration
   SQL and its journal entry, the table, the two db functions, the route, the
   `pushRemote` ordering, the PrefSync effect, the no-FOUC byte-identity — is
   source-text, exactly as `web-shell.test.ts` / `pwa.test.ts` do for `apps/web`.

TDD: `domain/prefs.test.ts` was written first and run **red** (`Failed to load
url ./prefs`) before `domain/prefs.ts` existed. The other two came after their
subjects, so their teeth were proved by **mutation** instead of by a claimed red
run — three mutations (the boolean coercion, `.strict()`, the `!== undefined`
guard, the GET's `getOwner()`) produced `Tests 9 failed | 48 passed`, and the
`!== undefined` mutation alone failed the DB test "PUTs a PARTIAL". All reverted;
`git diff` after revert was clean.

## Flagged, not decided

1. **MED (vet) · nothing refreshes an already-rendered SERVER tree.** Still
   true, and still out of i4: `hydrate` notifies `useSyncExternalStore`
   subscribers, so every consumer that reads through `useBooleanPref` /
   `useStringPref` (the map style, the cost toggle) re-renders itself. **i5's
   `units` is different** — the design resolves it on the server and passes it as
   a prop into four `force-dynamic` trees, and neither `hydrate` nor a
   localStorage write can reach a prop. i5 needs an explicit answer:
   `router.refresh()` after the PUT settles, or "stale until navigation". i4
   deliberately does not invent one.
2. **The first-paint cost the design accepts.** On a device that has never
   stored a theme, first paint is the default and the account's answer lands one
   frame later. That is the stated price of no-FOUC.
3. **`keepalive: true` on the write-through.** Not in the design. One word, and
   it is what stops a preference PUT being cancelled when the toggle is the last
   thing you touch before navigating away. Say so if you'd rather it went.
4. **`fx.prefs` / `read.prefsRow` / `truncateAll`** are harness changes, not
   product changes — but they ARE changes to shared test infrastructure. Worth a
   qa glance that adding `user_prefs` to the single `TRUNCATE` is all the reset
   needs (it has no FKs, so there is nothing to cascade).

## Render-required — the walk's job, not assertable here

- That `<PrefSync/>` actually fires after paint in a browser and that a theme
  saved on one device lands on another without a visible flash. Every layer of
  it is unit- or integration-tested; the *sequence in a real browser* is not.
- That the 401 path (Clerk on, session gone) is the silent no-op it is written
  as, rather than a console error.
- That `pnpm --filter @rv-trip/db migrate` applies `0003_user_prefs.sql` on a
  Neon preview branch. It applies cleanly to the harness's fresh local database
  (that is how the 11 integration tests ran), which is evidence, not proof.

## Checks run

| command | result |
|---|---|
| `pnpm install --frozen-lockfile` | fresh worktree had no `node_modules` — `Done in 9.2s` |
| `pnpm --filter @rv-trip/core exec vitest run src/domain/prefs.test.ts` (pre-impl) | RED — `Error: Failed to load url ./prefs … Does the file exist?` |
| `pnpm --filter @rv-trip/db generate` | `9 tables … user_prefs 6 columns 0 indexes 0 fks` · `[✓] Your SQL migration file ➜ drizzle/0003_keen_blackheart.sql` (renamed to `0003_user_prefs.sql`, journal tag updated) |
| `pnpm --filter @rv-trip/core exec vitest run src/domain/prefs.test.ts` | `Test Files 1 passed (1) · Tests 20 passed (20)` |
| `pnpm --filter @rv-trip/core exec vitest run src/prefs-account.test.ts` | `Test Files 1 passed (1) · Tests 37 passed (37)` |
| `pnpm --filter @rv-trip/web exec vitest run src/app/api/prefs/route.test.ts` | `Test Files 1 passed (1) · Tests 11 passed (11)` — a real Postgres; not skipped |
| mutation check (boolean coercion, `.strict()`, the `!== undefined` guard, GET's `getOwner()`), then reverted | `Tests 9 failed \| 48 passed (57)` in core; `Tests 1 failed \| 10 passed (11)` in web (`PUTs a PARTIAL`) |
| `pnpm turbo run lint typecheck test` | `Tasks: 9 successful, 9 total` — core `Tests 781 passed (781)`, web `Tests 81 passed (81)` |
| `pnpm exec next build` (apps/web) | build succeeded; route table lists `ƒ /api/prefs` |
| no-FOUC byte check — extracted `<script>` block vs `git show 71046ce:…/layout.tsx` | `NO-FOUC SCRIPT BYTE-IDENTICAL to 71046ce` (diff empty) |
| `git diff 5450ab7 -- TripPlanner.tsx MapMount.tsx lib/theme.ts` | empty — no `useBooleanPref`/`useStringPref` call site changed |

---

# Issue #45 · item 5 — The Settings page, units honored, People & groups retired

Epic item **i5 of 5** only (`docs/design/45/plan.json`, read from
`mc/wireframe/issue-45-v0`). Items 1–4 had already landed on this branch and
were not redone.

## What changed

### The vocabulary and the two conversions — new `packages/core/src/domain/units.ts`

- `units.ts:18-30` — `UNITS` (`imperial` | `metric`), `DEFAULT_UNITS`, `isUnits`.
  Core owns the vocabulary so `apps/web/src/lib/units.ts` cannot fork it.
- `units.ts:38` — `convertMiles(miles, units)`: identity in imperial, whole
  kilometres in metric.
- `units.ts:43` — `distanceUnitLabel(units)`: `"mi"` | `"km"`.
  Two functions, not one string, so `RouteView`'s 34px number and 15px unit stay
  two separately-styled spans.
- `packages/core/src/domain/index.ts:12` — exported.

### One arc label for both map renderers — `packages/core/src/planner/map-arcs.ts:87`

The design's i5 scope says `components/map/pins.ts:255-256` takes its label from
`distanceUnitLabel()`/`convertMiles()`. That is **exactly** what the vet's third
HIGH said could not be done as scoped: those two lines are asserted as literal
SOURCE TEXT by `packages/core/src/mobile-map.test.ts:185-199`, and the same two
format strings are a deliberate second copy in `apps/mobile/src/map.tsx`.

Resolved by consolidating rather than forking: `arcLabel(arc, units)` now lives
in core beside `TripArc`.

- `map-arcs.ts:87-92` — the one implementation.
- `apps/web/src/components/map/pins.ts:262` — `label: arcLabel(arc, units)`.
- `apps/mobile/src/map.tsx:11,282-288,410` — the local `arcLabel` is deleted and the
  import comes from core. The phone passes no units, so it takes the default and
  its rendered wording is **byte-identical to today**.
- `packages/core/src/mobile-map.test.ts:185` — the assertion changes from
  "both files contain this string" to "both files CALL `arcLabel`, and neither
  re-declares it", plus the string itself is now *executed* in
  `map-arcs.test.ts` for both vocabularies. Strictly stronger than what it
  replaced.

This is the one place I went outside i5's literal file list. It was that or ship
a fork of the label the test exists to prevent.

### The drive rows — `packages/core/src/providers/route-format.ts:38`

The vet's second HIGH: `driveLabel()` baked `"mi"`, so in metric the rail would
have read `663 km` with `3h 12m · 136 mi` in every row under it.

`driveLabel(result, units = DEFAULT_UNITS)` now converts at the same edge, and
`units` is threaded (optional, defaulted, **no type changed**) through
`planner/index.ts:311` `toDrive` → `:421` `resolveDrives` → `:445` `routeModel`.
`driveMiles`, `TripArc.miles` and `RouteSummary.driveMiles` are still miles —
this stayed a display conversion, as the design says.

### The four display sites

| site | file:line | change |
|---|---|---|
| dashboard card | `TripCard.tsx:19,145` | `{convertMiles(trip.miles, units)} {distanceUnitLabel(units)}` |
| Route rail hero | `RouteView.tsx:25,567,571` | number and unit converted in their own spans |
| map arc labels | `pins.ts:262` | `arcLabel(arc, units)` |
| rig form | `RigForm.tsx:87,293-352` | metric types **m** and **kg**; imperial unchanged |

`units` is resolved on the SERVER in all four roots and passed as a plain prop:
`app/page.tsx:38-39`, `app/trips/[id]/page.tsx:29`, `app/map/page.tsx:27`,
`app/rig/page.tsx:17`. New `apps/web/src/lib/units.ts` holds the key
(`rv-units`), re-exports the vocabulary, and narrows the row
(`unitsFromPrefs`). It is deliberately **not** `"use client"` and imports no
hook, so server components can import it.

`RigForm` metric mode: `Dim` grows an `m` field (`RigForm.tsx:42-46`), `toDim`
/`dimMeters` branch on units, and `poundsValue` becomes
`weightKilograms`/`weightField` (`:75-90`). Metric converts nothing — it shows
the stored metres verbatim (`String(meters)`, not `toFixed`) so 3.5052 m does
not drift on the next save — and the vendor boundary (whole cm/kg, always UP) is
untouched in both modes.

### The Settings page

- `apps/web/src/app/settings/page.tsx` — rewritten. Server component,
  `force-dynamic`, `getPrefsByOwner(await getOwner())`, renders
  `<SettingsForm prefs={prefs} />` inside `PageShell`. No `StubPage` import.
- New `apps/web/src/components/settings/SettingsForm.tsx` — `"use client"`.
  Three `GroupKicker`s (Appearance · Maps &amp; planning · Account), four rows,
  the design's helper copy verbatim. Theme / Units / Default map style are the
  DS `SegmentedControl`; Track costs is the lifted switch.
  - Tokens only, no raw hex (asserted). Row metrics are the wireframe's:
    `.group-k` → `font-mono text-[10px] tracking-[0.12em] text-rv-accent`,
    `.srow` → `border-b border-rv-border-soft py-[13px] last:border-b-0`,
    `.lbl` → `text-[14px] font-bold`, `.hlp` → `text-[12px] text-rv-ink-faded`,
    `.ctl` → `mt-[9px]`.
  - Map-style options come from `MapMount`'s own `STYLE_SEGMENTS`
    (`MapMount.tsx:46`, newly `export`ed) — not a second copy of the list.
- New `apps/web/src/components/ui/pref-switch.tsx` — `CostSwitch` lifted at its
  shipped metrics (38×22, 18px knob at `left: 18 / 2`, `bg-rv-green` on,
  `bg-rv-border-hi` off). `TripPlanner.tsx:98,766` imports it and keeps **no**
  private copy (`function CostSwitch` is gone).
- `packages/ui/src/Places.tsx:113` — `SegmentOption.Icon` is now **optional**
  and `:148` renders it conditionally, which is what makes the label-only Units
  segments composable at all (the vet's fourth HIGH). Additive: every shipped
  call site still passes an icon and no existing pill changes.
- `apps/web/src/app/settings/people/page.tsx` deleted;
  `apps/web/next.config.ts:18-20` adds `redirects()` sending
  `/settings/people → /settings`, permanent.

### Tests

- **TDD, executed code:** `packages/core/src/domain/units.test.ts` (10 tests) —
  written first, run RED (`Failed to load url ./units`), then green. Both
  vocabularies for both functions, plus the three numbers from the design's own
  blast-radius table (1284 mi → 2066 km, 412 → 663, 136 → 219).
- `packages/core/src/planner/map-arcs.test.ts` — `arcLabel` in both vocabularies
  (RED first: `arcLabel is not a function`).
- `packages/core/src/providers/route-format.test.ts` — `driveLabel` in both
  vocabularies (RED first: `expected '3h 12m · 136 mi' to be '3h 12m · 219 km'`).
- **Source-text, the repo's shipped convention for `apps/web`:** new
  `packages/core/src/settings-page.test.ts` (30 tests), same `REPO`/`read`/
  `code`/`flat` helpers as `web-shell.test.ts` and `prefs-account.test.ts`. It
  covers i5's acceptance clause by clause, including a directory walk proving no
  hard-coded `mi` label survives anywhere under `apps/web/src` (the regex was
  sanity-checked against the four pre-change forms — all four match, the two
  post-change forms do not). These 30 were written after the wiring, not before:
  `apps/web` has no DOM environment, so there was nothing to run red.

## Decisions, and the vet findings addressed

- **HIGH · Units blast radius incomplete (`driveLabel`).** Taken. See above —
  `driveLabel` is units-aware and `units` threads through `routeModel`. No
  planner type changed; every new parameter is optional and defaulted.
- **HIGH · i5's gate unachievable (`pins.ts` asserted as source text).** Taken,
  by moving the label into core and making the cross-renderer assertion an
  assertion about the CALL. `apps/mobile/src/map.tsx` is touched — one import,
  one deleted function — and its rendered output is unchanged. Flagged as the
  one out-of-scope file.
- **HIGH · `SegmentedControl` cannot compose a label-only segment.** Taken:
  `Icon?` is optional. The wireframe names no glyph for imperial/metric and I
  did not invent one.
- **MED · `CostSwitch` hard-codes its own text.** Taken: `PrefSwitch` gains an
  optional `label`. With it the planner's control is byte-for-byte the shipped
  one; without it the Settings row gets a bare switch and supplies `ariaLabel`.
- **MED · nothing said how the four trees pick up a units change.** Decided:
  the Units control calls `router.refresh()` (`SettingsForm.tsx:68-72`), which
  invalidates the router cache so the server-rendered trees re-render with the
  new prop. The other three preferences are client-read and need no refresh.
- **MED · `rigs` is not ownerId-as-primary-key.** Noted; i4 had already shipped
  and nothing in i5 depends on the claim.
- **MED · the REMOTE round-trip.** Already correct as landed by i4
  (`toRemotePatch` coerces `"1"/"0"` → boolean); i5 changed nothing there.
- **`StubPage` is now dead code — deliberately LEFT IN PLACE.** `grep` confirms
  zero call sites after this item (its only two consumers were the page I
  rewrote and the page I deleted). I did not delete it: it is not in i5's file
  list, and removing it would mean editing i1's landed acceptance test
  (`web-shell.test.ts:71` reads it as one of the six gutter sites). **Recommend
  a one-line follow-up** that deletes `components/nav/StubPage.tsx` and drops it
  from `GUTTER_SITES`. Flagging, not pre-empting — same call i1 made.
- **The Account row is `<Account/>` alone**, inside the "Account" card. The
  wireframe draws "dev-user" + "Local dev — no Clerk keys" + an avatar on that
  row, which is precisely what `<Account/>`'s `DevAccount` renders (the second
  line lives in its `title` tooltip). The design's own caption says the row *is*
  `<Account/>`, so I rendered that rather than inventing a second label.
- **Page head is the app's shipped pattern** — 12px mono kicker "Account" +
  `text-[40px]` h1 "Settings", identical to `map/page.tsx` and to the `StubPage`
  it replaces. The wireframe's 28px `h4` is its generic phone-mock heading
  style (`index.html:119`, applied to every phone screen including ones whose
  real pages ship at 40px), not a spec for this page.
- **No scope creep otherwise.** i1's Nav/PageShell, i2's grids and gantt gutter,
  i3's manifest/viewport/icons and i4's `user_prefs`/`/api/prefs` are untouched.

## For qa / the walk

Claims worth checking:

1. `apps/mobile`'s rendered arc wording is unchanged — `arcLabel` with no
   `units` argument returns exactly the two strings the deleted local function
   returned (executed in `map-arcs.test.ts`, "defaults to imperial").
2. `TripPlanner` defines no switch of its own: `grep -n "CostSwitch"` over
   `apps/web/src` returns nothing.
3. No hard-coded `mi` under `apps/web/src` (directory walk in
   `settings-page.test.ts`, plus `grep`).
4. Every new core parameter is optional and defaulted, so no existing caller
   changed behaviour: `routeSummary` was NOT given units (it returns numbers;
   `RouteView` converts its hero).

Render-required, static analysis cannot certify (the walk's job):

- The Settings page at 390px: three cards, four rows, the fifth tab active, and
  the last card clearing the fixed tab bar.
- That `/settings/people` actually answers a 308 to `/settings`. A
  `next.config.ts` redirect is config, not code a unit test can execute.
- That flipping Units to Metric and navigating to `/`, `/trips/<id>`, `/map` and
  `/rig` shows km / m / kg on all four — i.e. that `router.refresh()` really
  does invalidate those cached server trees.
- The rig form in metric: that typing `3.5052` round-trips through save and
  reload without drifting, and that the vendor hint reads `sent as 351 cm`.
- `<Account/>` inside a card rather than the masthead: the Clerk `UserButton`
  menu opens upward/downward correctly on a phone.

## Checks run

| command | result |
|---|---|
| `pnpm install --prefer-offline` | fresh worktree had no `node_modules` — `Done in 9.2s` |
| `pnpm --filter @rv-trip/core exec vitest run src/domain/units.test.ts` (pre-impl) | RED — `Failed to load url ./units … Does the file exist?` |
| `pnpm --filter @rv-trip/core exec vitest run src/domain/units.test.ts` | `Test Files 1 passed (1) · Tests 10 passed (10)` |
| `… vitest run src/planner/map-arcs.test.ts src/providers/route-format.test.ts` (pre-impl) | RED — `Tests 6 failed | 19 passed (25)`; `arcLabel is not a function`, `expected '3h 12m · 136 mi' to be '3h 12m · 219 km'` |
| `… vitest run src/planner/map-arcs.test.ts src/providers/route-format.test.ts` | `Test Files 2 passed (2) · Tests 25 passed (25)` |
| `pnpm --filter @rv-trip/core exec vitest run src/mobile-map.test.ts` | `Test Files 1 passed (1) · Tests 39 passed (39)` |
| `pnpm --filter @rv-trip/core exec vitest run src/settings-page.test.ts` | `Test Files 1 passed (1) · Tests 30 passed (30)` |
| `pnpm --filter @rv-trip/mobile typecheck` | `tsc --noEmit` — clean, no output |
| `pnpm turbo run lint typecheck test` | `Tasks: 9 successful, 9 total` — core `Tests 829 passed (829)`, web `Tests 81 passed (81)` |
| regex sanity check of the "no hard-coded mi" walk (node one-liner) | matched all 4 pre-change forms, neither post-change form |

**Not run (no env):** `pnpm exec next build` was NOT run for this item — SKIPPED
(not attempted); the redirect and the new page are exercised only by the gate
above. The DB round-trip for a units write is the walk's.
