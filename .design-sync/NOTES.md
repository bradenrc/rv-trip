# design-sync notes — @rv-trip/ui

## Setup facts (why the build is shaped this way)
- **`publishConfig.types` is load-bearing.** The package's `exports["."]` points at `src/index.ts` (Next transpiles source in the app), so the converter had NO `.d.ts` entry and discovered 0 components. Fix: `publishConfig.types: "./dist/index.d.ts"` in `packages/ui/package.json` — the converter's `findTypesRoot`/`projectFor` prefer it. Don't remove it.
- **Build = tsup + Tailwind CLI.** `buildCmd` (`pnpm --filter @rv-trip/ui build`) runs tsup (JS `dist/index.js` + `dist/index.d.ts`) then `tailwindcss -i styles/entry.css -o dist/styles.css`. `dist/` is gitignored; the driver rebuilds it.
- **This is a Tailwind-utility DS.** Components carry Tailwind utility classes; the app's own Tailwind build supplies them at runtime. For the sync, `packages/ui/styles/entry.css` (`@import "tailwindcss"` + `@source ../src` + the `rv-*` `@theme` tokens) compiles to `dist/styles.css` → `cfg.cssEntry`. **The `rv-*` token values are duplicated** between `entry.css` and `apps/web/src/app/globals.css` — if tokens change in the app, mirror them into `entry.css`.
- **Fonts:** Geist ships via the `geist` npm devDep (variable woff2) through `styles/fonts.css` → `cfg.extraFonts`. The app itself loads Geist via next/font; this @font-face copy is only so previews/designs render in the brand font.

## Known render warns (triaged benign — re-syncs check against this list)
- `[RENDER_THIN] Stars`: Stars renders star **icons** (SVG), no text, so the text-based thinness heuristic trips. Confirmed on the screenshot — it paints 4 star rows correctly. Benign.

## Known `check_design_system` warnings (Claude Design server-side; benign)
- The uploaded `_ds_bundle.css` (our compiled `dist/styles.css`) contains **Tailwind v4 framework internals** — `--tw-*` (26: translate/shadow/ring/gradient/border-style/…) and `--default-*` (8: font-family/transition-*). The server check classifies them as unknown design tokens. **They are NOT brand tokens** and **cannot be removed** — utilities reference them at runtime (e.g. `StopBar` uses `hover:-translate-y-px` → `--tw-translate-y`, `hover:shadow-rv-lg` → `--tw-shadow`). Non-blocking: the 20 components import and render fine.
- **Root fix is upstream in the design-sync tooling** — its token classifier (`lib/emit.mjs`) should skip `--tw-*`/`--default-*` (or emit `/* @kind other */` for them). That's skill-owned code the skill says not to fork.
- Repo-side option (unverified — the server check must honor `@kind` for it to help): a post-`tailwindcss` build step annotating each `--tw-*`/`--default-*` declaration in `dist/styles.css` with `/* @kind other */`, then re-sync. Not applied yet — deferred pending confirmation the check reads the annotation. See Downloads `DESIGN_SYNC_NOTES.md`.

## Re-sync mechanics learned (2026-07-21, planner-refinements sync)
- When saving the remote anchor to `.design-sync/.cache/remote-sync.json`, write the **complete** `_ds_sync.json` content from `DesignSync(get_file)` **verbatim** — including the full `sourceHashes` block. A partial anchor (e.g. hand-transcribed without `sourceHashes`) makes the driver log `no remote anchor — full scope` and re-verify all 20 (still correct via carried-forward local grades in `.cache/review/`, just not incremental).
- The Claude Design project also holds **non-sync files** the design agent/user added — `design_handoff_*/`, `explorations/`, `templates/`, `uploads/`, `_ds/broadsheet-*/`, `DESIGN_SYNC_NOTES.md`, `POST_SYNC_VERIFICATION.md`. These are OUTSIDE the sync's scope (`components/`, `_preview/`, `_vendor/`, `fonts/`, `styles.css`, `_ds_bundle.*`, `README.md`, `_ds_sync.json`) — the reconciliation deletes never touch them. Leave them unless the user asks to clean the project.

## Re-sync risks (watch-list for the next run)
- **Token drift**: `rv-*` values live in two places (see above). A design that looks off-brand after a re-sync usually means `entry.css` fell behind `globals.css`.
- **Preview data is inlined** in `.design-sync/previews/*.tsx` (realistic Pacific-NW-Loop trip content). It's static — it won't rot, but if a component's props change, its preview may need updating.
- **Grid organisms** (`StopBar`, `OpenSpan`) position via `grid-column` and are previewed inside their parent (`SwimLane`/`OpenLane`); a component-API change to those parents can break the child previews.
- **`geist` devDep** must stay installed for the font woff2 to resolve at build time.
