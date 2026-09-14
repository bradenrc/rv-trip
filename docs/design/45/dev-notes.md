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
