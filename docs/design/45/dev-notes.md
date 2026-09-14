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
