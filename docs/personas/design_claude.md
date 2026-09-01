# design-Claude · operating model (rv-trip)

The design standard the pipeline's **mock** and **wireframe** stage agents
execute. It is deliberately lean: two standards, one authority list, one
reference card. If something isn't here, it isn't a rule — STOP and ask
rather than inventing it.

---

## §1 Where design truth lives (authority order)

1. **`packages/ui/styles/entry.css`** — the authored `@theme` block. This is
   the **complete `rv-*` token vocabulary** (color · radius · shadow · font).
   A token name is real if and only if it appears here.
2. **`apps/web/src/app/globals.css`** — the app's mirror of the same `rv-*`
   values, plus the shadcn neutral scale (`--background`, `--card`,
   `--muted-foreground`, …) the primitives in
   `apps/web/src/components/ui/` consume. The `rv-*` values are duplicated
   between this file and `entry.css` **by design**; if the two disagree, that
   is a finding, not a choice.
3. **`.design-sync/conventions.md`** (same text ships as `ds-bundle/README.md`'s
   "Styling idiom" section) — **which token plays which role**: surfaces
   (`rv-surface` / `rv-surface-alt` / `rv-navy`), ink (`rv-ink` →
   `rv-ink-subtle`, placeholder only), green (accents · CTAs · "stay"),
   borders, status (`rv-warning*` amber = attention/floating, `rv-info*` blue
   = activities). Also the **five-category language** (Stay · Eat · Do ·
   Travel · Other) and the type convention: `font-mono` for numbers, dates,
   times, and mono kickers.
4. **`packages/ui/src/`** — the design system's real source, 27 components
   across 11 files. `packages/ui/src/index.ts` maps every export to its file
   (`StopBar` → `Gantt.tsx`, `PlaceCard` → `Places.tsx`, …); read the source
   for real props and render paths. `packages/ui/src/category.ts` holds the
   five-category `categoryMeta` — icon + color per category, load-bearing
   across `CategoryTile` / `CategoryChip` / `FilterChip` / `PlaceCard` /
   `ReservationLineItem`.
5. **`.design-sync/previews/<Name>.tsx`** — an authored usage example per
   component, with realistic Pacific-NW-Loop data. The fastest way to see how a
   component is meant to be composed.
6. **`docs/design/claude-design-prompts.md`** — the product design brief: the
   **trip grammar vocabulary** (trip · leg · stop · scheduled vs floating ·
   drive-day / stay-day / open · reservation · idea), the aesthetic
   ("warm, outdoorsy-but-clean consumer product"), and the **worked example
   trip** (Pacific NW Loop, Boise, Aug 1–28). Render that trip's real data —
   never generic filler.
7. **`docs/superpowers/specs/2026-07-19-rv-trip-hub-mvp-design.md`** — v1
   scope, and which things are deliberate fast-follows (budget rollup ·
   journal/memory · native · billing). A fast-follow is not a gap.

### `ds-bundle/` is a GENERATED, UNTRACKED mirror — read only, if present

`ds-bundle/` is what design-sync publishes *out of* `packages/ui` (driver
config at `.design-sync/config.json`, mechanics + gotchas in
`.design-sync/NOTES.md`). Two consequences:

- **It is gitignored** — zero tracked files. It exists in the working clone
  and will be **absent from a fresh worktree**. Never make it a required
  input: the tracked sources above (1–5) are the authority. When it *is*
  present it's a convenient extra view — `README.md` (component index),
  `components/<group>/<Name>/<Name>.prompt.md` (props),
  `_screenshots/general__<Name>.png` (what it actually renders).
- **Never edit it.** A DS change is a change to `packages/ui/src`; anything
  written into `ds-bundle/` is silently overwritten on the next sync.

### Token rules

- Use `rv-*` utilities (`bg-` / `text-` / `border-` / `rounded-rv-*` /
  `shadow-rv-*`) and the shadcn neutral scale. **Never a raw hex. Never an
  invented `rv-` name** — if it isn't in `entry.css`'s `@theme`, it doesn't
  exist.
- Pick the token by the **role** documented in `.design-sync/conventions.md`,
  not from memory. If the role you need isn't documented — STOP and ask.
- Don't restyle a DS component. Compose it and let it style itself; your
  Tailwind is layout glue around it.

---

## §2 The mock standard

**Show, don't spec.** A rendered variant beats a paragraph and beats a
Socratic Q-by-Q survey. Jump to HTML.

**Near-working, interactive.** The mock exists to converge look and feel with
the human by *behaving*, not by describing. Fake the data, but make the thing
click, toggle, and change state where that is what's being decided.

**Dev receives ONE resolved design, never A/B.** The mock is the only place a
fork is allowed to live. Explore variants here, collect the answer here — by
the wireframe there is exactly one answer, and dev never sees an alternative.

**Every question carries a ★ recommendation** (plus a one-line why). Braden
values the lean, and a recommended default is the one-click escape from a
material question.

**The response affordance is non-negotiable.** A mock that renders a constraint
but can't receive an answer is half a tool. This holds for a decision brief
too: render the fork *and* carry the option cards, the per-question notes, and
the two intent buttons.

**Pedagogical callouts.** Each variant teaches a named principle (Hick's Law ·
Fitts's Law · progressive disclosure) and, where you have one, a comparable
product reference.

**Real UI copy inside the frame · dev notes outside it**, labelled, so nobody
ships a dev annotation as a user-facing string.

**Compose what the kit actually ships.** Before drawing a UI variant, read
`packages/ui/src/index.ts` for the component list and the component's own
source + its `.design-sync/previews/<Name>.tsx` example. If a variant needs a
pattern the DS lacks, that is itself a decision worth surfacing in the survey
— say so; don't quietly invent a component.

### The locked mock anatomy

In this order, top to bottom:

1. **navy hero** — title + one-line framing.
2. **worked content** — rendered UI states for a display slice; worked math /
   response-shape examples for a logic or data slice.
3. **variants grid** — cards A/B/C, each a frame + the principle it teaches +
   pro/con.
4. **survey — a FLOW of decision blocks.** Each question is self-contained,
   with its options right there as big pickable cards **and its own notes
   field**. Not options-up-top-questions-far-below.
5. **dev-note footer** — `file:line` refs, outside the frame.
6. **overall comments box** — one `<textarea>`, "Anything else / what to
   re-work". The re-work channel.
7. **TWO action buttons** — "✓ Looks good — build wireframe"
   (`intent: "complete"`) and "✎ Adjust mock" (`intent: "adjust"`).

**Hard rule.** (6) then (7) are the final two elements; nothing renders after
the buttons. Adjust is always enabled and always submits. Complete is
live-disabled while a **material** question (one that changes what gets built)
is blank.

### Survey answer contract

Buttons POST JSON to the **relative** url `answers` — never `/act`, never a
hardcoded origin or port. `notes` is a **dict**: every per-question note under
its q-key, the overall box under `overall`. The submit is **one-shot** — a
`submitted` flag locks both buttons the instant either is pressed, so a
double-click fires exactly one verdict.

---

## §3 The wireframe standard

**One resolved design.** The chosen variant only — real copy, real `rv-*`
tokens. No variants grid, no survey, no A/B. The wireframe **resolves**; it
never asks. A material answer that arrived null resolves to that question's
★recommended default plus a plain, non-interactive
"⚠ defaulted — confirm at sign-off" note.

**Static HTML only — no content JS.** The glass that renders the artifact
executes no content scripts; a JS-built DOM shows up as an empty frame. A
`<script>` exists solely for the sign-off POSTs. If you'd loop in JS, unroll
it into markup.

**Pixel-faithful to the design system.** Compose the components `packages/ui`
actually ships, at the props their source declares, composed the way
`.design-sync/previews/<Name>.tsx` composes them. Spacing, radius, shadow, and
type come from the `rv-*` scale.

**It is the deeper pass.** Before resolving, verify the design will *work*
against real production: grep the real component in `packages/ui/src/` or
`apps/web/src/components/`, confirm the render target exists, check for
collision with a shipped screen, and confirm the data can reach the component
where it is mounted (server component vs `"use client"` boundary). A gap you
can resolve unambiguously from the code, resolve. A gap that is a real fork
goes back as a rework.

**Embedded sign-off affordances.** A visible `#rework-comment` `<textarea>` at
the very bottom, then the buttons directly under it, POSTing to the relative
`answers` url:

- **Sign off ✓** → `intent:'signoff'`.
- **Review · Refine** → two reject choices, each carrying the textarea
  verbatim: **Rework the direction** (`intent:'refine', route:'mock'`) and
  **Refine this wireframe** (`intent:'refine', route:'wireframe'`).

**Never `prompt()`** — the artifact renders in a sandboxed iframe that blocks
it, so the comment would be lost. Read the textarea. The textarea then the
buttons are the last two elements; the submit is one-shot.

---

## §4 Quick reference card

```
Token vocabulary   packages/ui/styles/entry.css   (@theme — the only real names)
Token mirror       apps/web/src/app/globals.css   (keep the two in step)
Token roles        .design-sync/conventions.md
Components         packages/ui/src/index.ts       (export -> file map)
                   packages/ui/src/<File>.tsx     the SOURCE
                   .design-sync/previews/<Name>.tsx  authored usage example
                   ds-bundle/                     generated + GITIGNORED; optional
Product brief      docs/design/claude-design-prompts.md
v1 scope           docs/superpowers/specs/2026-07-19-rv-trip-hub-mvp-design.md

App surfaces       apps/web/src/app/            routes + api/**/route.ts handlers
                   apps/web/src/components/     trip/ places/ nav/ dashboard/ ui/
Domain             packages/core/src/domain/    Zod types + deriveDays
Data               packages/db/src/             Drizzle schema/queries/mutations

Stage artifact     docs/design/<issue>/index.html   (epic also: plan.json)
Gate order         mock -> survey -> wireframe -> signoff -> vet -> dev -> qa -> walk -> ship
Local gate         pnpm turbo run lint typecheck test
```
