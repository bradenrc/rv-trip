# Issue 3 — Nightfall & Ember: dev notes (v1)

The vetted wireframe (`docs/design/3/index.html` on `mc/wireframe/issue-3-v0`) applied to
production. Q6=A: tokens + all four sweeps + C1–C5 in one pass. No route, no component API,
no new destructive token, no light mode, no theme toggle. `ds-bundle/` untouched (absent from
this worktree; design-sync regenerates it after `packages/ui` lands).

**What v1 is.** This branch is cut from `origin/main` (`ef47227`), which does not contain the
v0 slice, so v1 carries the **whole** slice: the v0 implementation re-applied verbatim
(`git apply` of `6c892c9..25122c2`, clean, no conflicts) plus the three changes below that
answer the qa round. §1–§7 describe the slice; §8 is what changed since v0.

## 1 · Token files — moved in step

- `packages/ui/styles/entry.css:12` — safelist grows `ember,ember-bright,ember-deep,ember-soft`
  and `travel-soft`; `green-deep` removed.
- `packages/ui/styles/entry.css:23–70` — the §1 color block, radius unchanged, the Q4=A
  pure-black shadow scale.
- `apps/web/src/app/globals.css:129–178` — a **verbatim** mirror of that block. Re-verified in
  this tree: `diff` of every `--{color,radius,shadow}-rv-*` declaration between the two files is
  empty, and `nightfall-tokens.test.ts` fails if they ever diverge.
- `apps/web/src/app/globals.css:54–86` — the shadcn `:root` scale on the night ladder
  (`--background #101f2d`, `--foreground #eef5fa`, `--card #182b3d`, `--popover #21374d`,
  `--primary #f28c5e` / fg `#0a1520`, `--border #2e4459`, `--input #3d566c`, `--ring #f28c5e`,
  `--muted-foreground #8fa8bd`, plus the sidebar row). `--destructive` and the chart ramp keep
  their oklch values (V4 didn't respec them). Per the vet's V4 correction the primitives are
  treated as **live**, not dormant: `layout.tsx:4-5,34,38` mounts `TooltipProvider` and
  `Toaster`; `components/ui/sonner.tsx:33-35` reads `--popover`, `--popover-foreground`,
  `--border` and `tooltip.tsx:45,51` reads `--foreground`/`--background` — all four moved.
- `apps/web/src/app/globals.css:183,187` — `.trip-card` / `:hover` box-shadows → the C4 values.
- `globals.css:89–121` `.dark` block left untouched (V9).

## 2 · Sweep 1 — `text-rv-navy` → `text-rv-ink` · 28 className sites, plus 2 inline

- **Kept as `text-rv-navy`** (CTA ink on an ember or green fill, C3/V7) — re-grepped in this
  tree, exactly 7 survivors, every one on `bg-rv-ember` or `bg-rv-green*`:
  `Places.tsx:87` · `app/page.tsx:52` · `places/page.tsx:28` · `Nav.tsx:50` ·
  `StopDetailSheet.tsx:115,183` · `TripPlanner.tsx:193`.
- `packages/ui/src/category.ts:86` — `statusMeta("planned").color` → `var(--color-rv-ink)`.
- `packages/ui/src/Gantt.tsx:53` — *the vet's first HIGH*. The Ruler's week-start day numbers are
  set by an **inline style**, so the prescribed className grep could never reach them; revalued
  they would have painted `#0a1520` on `#101f2d` (~1.1:1). Now
  `t.weekStart || i === 0 ? "var(--color-rv-ink)" : "var(--color-rv-ink-faded)"`, which is what
  the wireframe's `.ruler div` / `.ruler div.ws` show. Guarded by a test that fails on **any**
  inline `color:` resolving to `var(--color-rv-navy)`.
- Deliberately **not** swept — navy is chrome (§5 sweep 1's own list): `Gantt.tsx:135` ·
  `trip-logic.ts:72` · `Places.tsx:205` and `TripPlanner.tsx:330` (`bg-rv-navy` active segment) ·
  `Nav.tsx:21` · `StopDetailSheet.tsx:79,86`.

## 3 · Sweep 2 — `rv-green-cta` split by role

- → **ember** (CTA · money · links · kickers), 16 sites: `Places.tsx:87` · `RouteItems.tsx:20` ·
  `DetailCards.tsx:47,126,137` · `FloatingStopCard.tsx:58` · `app/page.tsx:43,52` ·
  `places/page.tsx:15,28` · `RouteView.tsx:203` · `StopDetailSheet.tsx:183` ·
  `TripPlanner.tsx:148,193` · `StubPage.tsx:17` · `TripCard.tsx:138`.
- → **`rv-green`** (stay-internal): `Gantt.tsx:137,194` · `category.ts:34` · `category.ts:88` ·
  `StopDetailSheet.tsx:134` · `RouteView.tsx:57` · `TripCard.tsx:26`.
- Stars decouple from Eat's amber: `Stars.tsx:28–29` `rv-warning` → `rv-ember` (both `color` and
  `fill`) and the Gantt rating chip at **`Gantt.tsx:141`** (the design said `:142`; the class is
  on `:141` — the vet flagged the same drift).

## 4 · Sweep 3 (Q2=A) + Sweep 4 (Q3=A)

- `text-rv-surface` → `text-rv-ink`: `StopDetailSheet.tsx:86,92,100` · `TripPlanner.tsx:330`.
- `text-rv-surface` → `text-rv-navy` (background is ember): `StopDetailSheet.tsx:183` ·
  `TripPlanner.tsx:193`.
- `border-rv-surface` → `border-rv-border-hi`: `Nav.tsx:50` (V5, *not* `rv-ink`) — its
  `text-white` also goes to `text-rv-navy` (white on `#7cd897` is 1.4:1).
- `text-rv-navy-soft` → `text-rv-ink-muted`: `StopDetailSheet.tsx:107` (C2).
- `text-white` on an ember fill → `text-rv-navy`: `Places.tsx:87` · `app/page.tsx:52` ·
  `places/page.tsx:28`. The only `text-white` left is Places' active filter chip on
  `bg-rv-navy` (18:1) — untouched by design (§5 sweep 4), as is `TripPlanner.tsx:308`'s
  `bg-white` knob.

## 5 · Outside the sweeps

- `packages/ui/src/category.ts:50` — `TRAVEL.bg` → `var(--color-rv-travel-soft)` (V6); the
  now-stale "/ color-mix" in the file's doc comment at `:21` dropped with it.
- `apps/web/src/components/dashboard/TripCard.tsx:54–57` — the four `COVERS` pairs re-tuned to
  the ladder; **`:76`** dot-pattern opacity `0.16 → 0.08` (the design said `:77`). Ghost icons at
  `:81,:82` left as-is.
- `category.ts:53–57` `OTHER` — no edit, re-derives correctly.

## 6 · The vet's second HIGH — `rv-ink-subtle` painting text

§1 scopes `rv-ink-subtle` (`#5f7690`) to **non-text only**, but ten shipped sites painted real
glyphs with it (~3.1:1 on `rv-surface`). The call sites moved, not the role — §1's own table
already owns this case (`rv-ink-faded` `#8fa8bd` is "Meta · mono kickers"). Moved to
`text-rv-ink-faded` / `var(--color-rv-ink-faded)`: `Gantt.tsx:10` (shared `kicker`) ·
`Gantt.tsx:47` · `Places.tsx:77` · `category.ts:90` (`statusMeta "idea"`, rendered as the label
text at `StatusMarker.tsx:13`) · `app/page.tsx:12` · `RouteView.tsx:50,123,170,177` ·
`StubPage.tsx:26`.

Left on `rv-ink-subtle` — genuinely non-text (grips, dots, disabled/off icons, empty stars):
`Stars.tsx:28` · `FloatingStopCard.tsx:32` · `Places.tsx:70,138,174` · `DetailCards.tsx:137` ·
`RouteView.tsx:78,82` · `TripPlanner.tsx:287` · `Nav.tsx:37,54` · `StubPage.tsx:24`.

## 7 · Tests

`packages/core/src/theme/nightfall-tokens.test.ts` (16 cases, vitest — `packages/core` is the
only package with a `test` script). **This slice has no domain logic to exercise** — it is a
token revalue plus className edits — so the test guards the contract by asserting over the
source text instead of behaviour. It required `@types/node` in `packages/core/package.json` and
`"node"` in that package's `tsconfig.json` `types`; `pnpm-lock.yaml` updated accordingly.

It asserts: every `--color-rv-*` / `--shadow-rv-*` equals its §1 value in `entry.css`; the
`entry.css` ⇄ `globals.css` mirror is byte-equal for all three token families; `green-deep` is
gone from both stylesheets; the safelist carries the ember names and `travel-soft`; the four
must-not-miss shadcn `:root` tokens moved; and the sweep invariants — no stray `text-rv-navy`
off an ember/green fill, no inline `color:` on `var(--color-rv-navy)`, no `bg-rv-green-cta`, no
`text/border-rv-surface`, no `text-rv-navy-soft`, `text-white` only on the navy chip, ember
stars, no `color-mix` in `category.ts`, the C5 covers, and the C4 `.trip-card` shadows.

## 8 · What changed in v1 — the qa round, answered

**8a · CN 1 (accepted, fixed).** The `rv-ink-subtle` guard filtered on a per-file text-site list
plus `/font-mono|tracking-\[/` on the same line, so it could not see `category.ts:90`. Rewritten
at `packages/core/src/theme/nightfall-tokens.test.ts:193–207` as a **global allowlist of the two
shapes a non-text use takes** — `ICON_SIZED = /\bsize-[\d[]/` (:202, a lucide icon or dot sized
on the same line) and `ICON_STATE` (:203, the empty-star / hidden-note `color: x ? ember : …`
ternaries in `Stars.tsx:28` and `DetailCards.tsx:137`). No file list, so it now covers every
source file including `category.ts`.
*Mutation-proved:* all **10** moved sites reverted one at a time → `Tests 1 failed | 15 skipped`
each, `category.ts:90` included (the case qa proved blind); shipped tree green.

**8b · CL (accepted, fixed).** The sweep-4 assertion was pinned to the literal string
`packages/ui/src/Places.tsx:205`, so any edit above it reds the suite with a misleading failure.
Now content-based (`nightfall-tokens.test.ts:185–191`): a `text-white` is a failure unless its
own line also carries `bg-rv-navy`. *Proved both ways:* inserting two lines at the top of
`Places.tsx` keeps it green (it used to red), and moving `Places.tsx:55` to `text-white` reds it
with `expected [ 'packages/ui/src/Places.tsx:55' ] to deeply equal []`.

**8c · the walk's `Runtime Error: DATABASE_URL is not set` (fixed, outside the design).** Root
cause is env plumbing, not the restyle: `scripts/mc-walk-env.sh` copied the repo-root `.env` /
`.env.local` into the walk worktree's **root**, but it launches `next dev` with cwd
`apps/web`, and Next loads dotenv files from *that* directory — so the README's
`cp .env.example .env` value never reaches the walk, and `packages/db/src/index.ts:7` throws at
import. Two changes: `scripts/mc-walk-env.sh:71` also copies `apps/web/.env*` across, and
`:26–35` + `:77–85` resolve a `DATABASE_URL` (caller env → the worktree's `apps/web` dotenvs →
its root dotenvs → `.env.example`, whose value *is* the docker-compose Postgres this script
starts) and `export` it into the dev server's environment, dying with a clear message if none
resolves. **Not covered by vitest** — it is a bash script and `packages/core` is the only test
runner; verified instead with `bash -n` (syntax OK), `shellcheck scripts/mc-walk-env.sh`
(clean), and a harness that exercised `dotenv_db_url` against quoted / bare / `export` / missing
/ no-key dotenv files (all correct, no `set -e` trip). **Flag:** I did not stand a walk up from
this worktree, so the fix is verified at the unit level only.

**8d · CN 2 and CN 3 — NOT changed; qa's reference document was the superseded one.** Both cite
values that exist only in the **design-stage** `docs/design/3/index.html` (commit `6c9f077`),
not in the **wireframe** the vet reviewed and the human signed (`mc/wireframe/issue-3-v0`,
`79d0e0f`), which the brief names as the pixel target. Receipts:
- CN 2's four hexes are all `6c9f077:docs/design/3/index.html` — `:312` `#060d14` (navy-deep),
  `:330` `#3f7457 / #2c5540` (green-cta/-deep), `:338` `#b9b0d6` (travel-ink). The **wireframe's**
  §1 table and its "block to write" say: `rv-navy-deep #08182b` *unchanged*, `rv-green-cta
  #7cd897`, `rv-green-deep` **dropped** ("zero call sites"), `rv-travel-ink #a79ec8` with the role
  "Travel foreground (`category.ts:51`)" — i.e. the Travel color/ink collapse qa observed is what
  the vetted design specifies, and it matches how Eat and Do already alias. The shipped values
  are the wireframe's.
- CN 3's `.seg .on { background: var(--high); color: var(--ember) }` is `6c9f077`'s stylesheet
  (`:53–56`); the string `.seg` does not occur in the wireframe. The wireframe renders the same
  control as `.fchip.on { background: var(--n-navy); … }` (`79d0e0f:226`) and §5 sweep 1 lists
  `Places.tsx:205` and `TripPlanner.tsx:330` under "**Deliberately NOT swept** — navy is chrome",
  with V8 re-confirming `Places.tsx:205` (`bg-rv-navy text-white`, 18:1). Changing them would be
  redesign, so I held scope — and flagged it for the walk instead (§9.4).

**8e · CL (FloatingStopCard) — no change.** `FloatingStopCard.tsx:58`'s ember `CircleCheck`
inside the green `AllScheduledCard` is exactly what §5 sweep 2 prescribes. Kept, flagged (§9.3).

## 9 · Flagged for the walk

1. **Sonner's theme (vet FLAG, unchanged).** `components/ui/sonner.tsx:3,8,12` passes
   `theme={useTheme().theme ?? "system"}`; no `next-themes` provider is mounted, so it resolves
   to `"system"` and sonner picks its base from the OS while the app is unconditionally dark.
   Nothing calls `toast(` in `apps/web/src` today, so there is nothing to regress — but a
   one-word `theme="dark"` is the fix if the walk wants it. **Design decision, not a dev default.**
2. **The three hover affordances (vet FLAG).** `Gantt.tsx:130`, `Places.tsx:46` and
   `globals.css:185–188`'s `.trip-card:hover` are pointer-state renders; whether pure black at
   .44/.55 alpha reads as lift on `#101f2d` can only be confirmed live.
3. **The one ember mark in a green container** — `FloatingStopCard.tsx:58` (qa CL). Design-
   prescribed; worth an eye.
4. **The two `bg-rv-navy` active states** (qa CN 3, held per §8d): `TripPlanner.tsx:330`'s
   Route/Timeline tab inside its `bg-rv-surface` pill, and `Places.tsx:205`'s active filter chip
   beside `bg-rv-surface` chips. Navy `#0a1520` on surface `#182b3d` is ~1.3:1, so the selected
   state reads as an inset *well* rather than a lift (labels themselves are 16.7:1 / 18:1). The
   vetted design chose this deliberately; if it doesn't read at the walk, the design's own "high"
   token `rv-navy-soft #21374d` is the one-word change.
5. **Tooltip and the other 17 shadcn primitives.** Their `:root` scale is dark and correct on
   paper, but none is rendered anywhere yet, so none was seen.

## 10 · Defaulted

- `rv-green-deep` **dropped** from `entry.css`, its `globals.css` mirror and the safelist — the
  wireframe's own resolution for the one token that carried no survey answer, and its only former
  hex use (`TripCard.tsx:54`) is re-tuned by C5 anyway.

## 11 · Verification actually run (in this worktree)

- `pnpm install --offline` → `Done in 3.9s` (exit 0) — this round had a real env.
- `pnpm --filter @rv-trip/core test` → `Tests  25 passed (25)` / `Test Files  2 passed (2)`.
- `pnpm turbo run lint typecheck test --force` → `Tasks:    7 successful, 7 total` /
  `Cached:    0 cached, 7 total`. (`--force`: plain `turbo run` can replay cache entries
  produced in another checkout and execute nothing.)
- Mutation proofs for the two test fixes — 12 runs, listed in §8a/§8b.
- `packages/ui/dist/styles.css` emits all 12 `.{bg,text,border}-rv-ember*` utilities plus the
  three `rv-travel-soft` ones; `grep -c green-deep` → `0`.
- Token mirror: `diff` of every `--{color,radius,shadow}-rv-*` declaration between `entry.css`
  and `globals.css` → identical.
- Sweep 1 re-grep: `grep -rEn 'text-rv-navy([^-]|$)'` → 7 hits, each on `bg-rv-ember` or
  `bg-rv-green*`.
- `bash -n scripts/mc-walk-env.sh` → syntax OK; `shellcheck scripts/mc-walk-env.sh` → clean.
- **Not run:** no browser render, no `next build`, no DB, no walk standup. Everything in §9 is
  for the walk.
