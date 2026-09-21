# Issue 86 — dev notes

Implements the vetted wireframe (`docs/design/86/index.html`, branch `mc/wireframe/issue-86-v0`):
a named `derive_code_sha` ladder, `sha` JSON-encoded like its three siblings, a provenance line
naming the rung, and a hermetic harness over real git fixtures. Two files, one new.

## What changed

### `scripts/mc-walk-env.sh`

| where | what |
| --- | --- |
| `:167-192` | the rationale block — why the belt's one key matters, why the ladder is a named function, why stdout is machine-readable, why every rung is `if/fi` (finding A), why no `jq` (finding D) |
| `:194-253` | **new** `derive_code_sha <worktree> <known\|""> <regfile\|"">` — the five-rung ladder; exactly one `<rule>\t<sha>` line on stdout, nothing on stderr, always `return 0` |
| `:198-201` | **seed** — non-empty `known` short-circuits → `branch\t<known>` |
| `:206` | HEAD is read from the *tree*, not `$WALK_HEAD` (`:130` sets `WALK_HEAD="$WALK_SHA"`, blank on the very path this exists for) |
| `:207-212` | **terminal** — HEAD unreadable → `none\t` (empty sha) — see decision 2 |
| `:222-230` | **rule 1 · carry** — prior entry whose `walked_head` is still HEAD; both keys read in one `python3 -c` that prints them tab-separated, with `2>/dev/null \|\| true` (the `:321` idiom) |
| `:239-246` | **rule 2 · unwrap** — committer is `mc-walk-env@localhost` **and** `HEAD^2` exists → `HEAD^1`. Provenance, not shape |
| `:248-252` | **rule 3 · head** — HEAD; the pre-derivation behaviour, unchanged |
| `:361-379` | caller 1 — the standup calls the ladder in the encode block (after `refresh_walk_tree`, before the heredoc: the one window where HEAD is final *and* the prior entry still exists), splits the pair, and prints the Q5 line. `none` is the only row that goes to stderr, with `⚠` |
| `:384-385` | `sha_json=null; if [ -n "$CODE_SHA" ]; then sha_json="$(json_str "$CODE_SHA")"; fi` — `sha` joins `walked_head` / `merged_main_sha` / `merge_note` |
| `:401` | the heredoc's only changed line: `"sha": "$WALK_SHA",` → `"sha": $sha_json,` |
| `:453-465` | **new** `__derive-sha` verb — un-advertised, exists for the harness. `regfile` and `known` are explicit positionals that default to **empty**, never to `$WALK_DIR/$issue.json` (finding C) |

Unchanged on purpose: `merge_note` (reviewer-facing, sha provenance is an operator fact), the
`die()` catch-all wording at `:467-469`, `down`, and the raw `"branch"` / `"worktree"` interpolations
at `:399-400` — Q3 = A scoped this slice to `sha`, and widening it silently would be the wrong call.

### `packages/core/src/mc-walk-env.test.ts` (new, 237 lines)

Eight tests over throwaway `git init` repos under the OS temp dir. Every case asserts the **rule**
as well as the sha. All six rows of the design's contract table are covered:

- `:159` seed — `known` wins, and the head it did *not* return is asserted different
- `:171` rule 1 — carries `entry.sha` when `walked_head == HEAD`; plus two negatives the design's
  table implies but does not enumerate (a moved tree does not carry; a missing *or corrupt* regfile
  is tolerated rather than fatal, which is what `|| true` is there for)
- `:203` rule 2 — the script's own merge unwraps to `HEAD^1`
- `:211` refusal — the *same merge shape* with a foreign committer falls to `head` (the
  `origin/feat/27-migrations` case)
- `:222` rule 3 — plain detached checkout
- `:232` terminal — a non-git dir answers `none` with an empty sha

`mergeTree()` (`:127`) asserts its own fixture is a real merge and was committed by the intended
identity before the ladder ever runs, so a broken fixture reds as a fixture, not as a rule.

## Decisions / deviations

1. **`__derive-sha` takes a third positional, `known`.** §⑤ of the wireframe shows the verb as
   `derive_code_sha "$wt" "" "${2:-}"` — hard-coding `known` to empty — while §⑦ requires a
   **seed** case asserting `branch\t<known>`. Both cannot be literal: with `known` pinned to `""`
   the seed rung is unreachable from a test. Resolved by keeping §⑤'s positions 1 and 2 exactly
   (`<worktree> [regfile]`) and appending an optional `[known-sha]` third. **qa: this is the one
   place the implementation extends the signed design.**
2. **Terminal rung emits `none\t`, not nothing** — vet finding 3 asked dev to pin one of the two
   readings; the contract table's `none \t` is the consistent one, and it is what the harness
   asserts at `:233`.
3. **Every fixture commit pins `-c user.email` / `-c user.name`** (vet finding 2), not just the
   merge. CI (`.github/workflows/ci.yml`) configures no git identity, so an ambient-identity fixture
   would pass here and red there. The fixtures also pin `init.defaultBranch`, `commit.gpgsign=false`
   and `core.hooksPath=/dev/null` for the same class of reason.
4. **Test placement, honestly stated** (vet finding 1): `packages/core` is where this repo's pure
   logic is tested and it has no `vitest.config`, so `src/*.test.ts` is auto-discovered with no
   config change. That is the reason — *not* "the only package with a runner", which is false:
   `apps/web` and `packages/ui` both declare `vitest run` too.
5. **btrip parity** (vet finding 4): the seed rung's source is the assignment
   `CODE_SHA="$WALK_CODE_SHA"` at `~/temp/btrip/scripts/mc-walk-env.sh:814`, not a test at
   `:1492`. Rules 1/2/3 port from `:823-826`, `:838-842`, `:844`.
6. **No new dependency, no config change.** `node:child_process` + `vitest ^2.1.8`, both present.

## Verification — what actually ran

- `bash -n scripts/mc-walk-env.sh` → clean.
- `shellcheck scripts/mc-walk-env.sh` (0.11.0) → clean, no output.
- **Red before green:** the pre-change script, run as `bash scripts/.orig-86.tmp.sh __derive-sha <dir>`
  (a `git show HEAD:` copy, deleted after) →
  `mc-walk-env: unknown command '__derive-sha' …`, exit 1. Every test in the new file fails against
  `HEAD`.
- `pnpm vitest run src/mc-walk-env.test.ts` in `packages/core` →
  `Test Files 1 passed (1) / Tests 8 passed (8)`.
- `pnpm turbo run lint typecheck test` (after `pnpm install --frozen-lockfile`; the worktree had no
  `node_modules`) → `Tasks: 10 successful, 10 total`, exit 0.
  `@rv-trip/core:test` = `Test Files 44 passed (44) / Tests 954 passed (954)`.
- **The heredoc actually emits parseable JSON** (vet FLAG). `bash -n` and `shellcheck` cannot
  certify the `"sha": $sha_json` line, so lines `382-409` were extracted verbatim into a scratch
  script with `json_str` and the `WALK_*` variables stubbed, and run twice:
  - a real sha + merged main → `python3 json.load` OK, `sha = '0b9d8124…'`, `merged_main = True`;
  - the terminal rung — empty `CODE_SHA`, empty `WALK_HEAD`, and a conflict note containing both a
    double quote and a backslash → `python3 json.load` OK, `sha = None`,
    `merge_note` round-tripped intact.
  The caller-side split was checked the same way against the live verb: `head\t<sha>` → `rule=head`,
  and `none\t` → `rule=none`, `sha=''` (so `sha_json` stays `null`).

## Flagged for the walk

- **A real `standup` was deliberately not run here.** It boots a `next dev`, runs `pnpm install` in a
  fresh worktree and touches the shared docker Postgres, and other issues' walk servers are live on
  this machine. The extracted-heredoc run above is stronger than static analysis but is not the real
  path. **The walk should confirm one live standup writes a `json.load`-parseable
  `.mc/walk/<issue>.json` and that the new `  · sha ← …` line prints exactly once.**
- On the standup path **rule 2 will fire on every successful merge** and rule 1 essentially never
  (`:121` re-points and `:147` merges every run), so the expected walk output is
  `· sha ← rule 2 · unwrap (merge by mc-walk-env, ^1 → …)`. Rules 1 and 3 are exercised by the
  tests, not by the standup — which is the whole argument for Q1 = B.
- `apps/web`'s route-handler suite reported `10 passed | 26 skipped` — it self-skips without a
  `DATABASE_URL`, which is pre-existing and unrelated to this slice (nothing here touches a route).
