# #132 · dev notes

## i1 · Walk merge survives ambient git config and reports refusals honestly (#114, Q1 · B)

### What changed

- `scripts/mc-walk-env.sh:266-278` (`refresh_walk_tree`): the origin/main merge now passes
  `--no-edit --no-gpg-sign --ff --no-verify-signatures`. The identity `GIT_AUTHOR_*` /
  `GIT_COMMITTER_*` env vars and `core.hooksPath=/dev/null` are unchanged. stdout is still
  discarded. stderr is captured into `merge_err` (`2>&1 >/dev/null` inside `$(…)`), and the
  exit code is kept in `merge_rc` (`|| merge_rc=$?`, which is safe under `set -e`).
- `scripts/mc-walk-env.sh:287-304` (failure path): `abort_merge_hard` still runs first, on
  both paths.
  - If there are unmerged paths, the CONFLICTED note is kept word for word. The only change
    is that the `:-unknown paths` fallback is gone, because that case now takes the REFUSED
    branch.
  - If there are no unmerged paths, the note is `merging origin/main REFUSED by git (rc <n>:
    <git's line>) — not a conflict; walking branch tip. Fix the walking machine's git
    config.` `<git's line>` is the first stderr line starting with `fatal:` or `error:`. If
    there is none, it is the last non-empty stderr line. An awk one-pass picks it.
- `scripts/mc-walk-env.sh:658-667` (`__refresh-tree`): stdout gets a fifth tab-separated
  field, `merge_note`. The first four fields keep their positions. The note has any tab or
  newline changed to a space so the output stays exactly one line. The notes the script
  builds today never contain either, so this is only a guard.
- `packages/core/src/mc-walk-env.test.ts`:
  - `walkFixture` gains `conflictOn` (:270-300), and there is a new `commitContent` helper
    (:303-309).
  - `refreshTree` now also returns `mergeNote` (:311-329). The four existing
    destructurings are unchanged.
  - Four new producer tests (:400-446):
    - `merge.ff=only` and `merge.verifySignatures=true` through `GIT_CONFIG_GLOBAL` (the
      `committerInConfig` idiom). Both give `mergedMain === "true"`, a note matching
      `^merged origin/main <sha7>$`, `HEAD^1` = tip, and `HEAD^2` = merged_main_sha (a real
      2-parent merge). The ladder still unwraps.
    - Untracked `sibling-after-cut` in the walk tree gives `"false"`. The note starts with
      `merging origin/main REFUSED by git (rc `, contains `not a conflict` and git's
      `untracked working tree files would be overwritten` line, and does not contain
      `CONFLICTED`. There is no MERGE_HEAD afterward and HEAD is at the tip.
    - A content conflict on `shared.txt` gives a note with `CONFLICTED (` and `shared.txt`,
      and without `REFUSED`. There is no MERGE_HEAD afterward.

### TDD

The four new tests were written first. Against the unmodified script, all four failed: the
two ambient-config fixtures got `mergedMain` "false", and the other two got an empty note
because the fifth field did not exist yet. After the change, all 18 tests pass. The 14
tests that already existed are unchanged and still pass.

### Checks run

- `npx vitest run src/mc-walk-env.test.ts` (packages/core), before the change:
  `Tests  4 failed | 14 passed (18)`. After the change: `Tests  18 passed (18)`.
- `shellcheck -S warning scripts/mc-walk-env.sh`: clean (rc 0). `bash -n`: syntax-ok.
- `pnpm turbo run lint typecheck test`: `Tasks: 10 successful, 10 total`. In apps/web:
  `Tests  365 passed (365)`.

### For qa to check

- The `standup` path's `.mc/walk/<N>.json` `merge_note` reads `WALK_MERGE_NOTE`, so it
  picks up the REFUSED wording with no other change. The `merged_main` / `merge_note`
  consumers at `:534-570` were not touched.
- The ship-shaped stamp is unchanged: the ambient-identity tests (`committerInEnv` /
  `committerInConfig`) still pass.
- Scope: i1 only. i2 (reject-note), i3 (preflight) and i4 (#79 checklist) are later
  dispatches. The vet findings about i2 and i3 do not apply to this item.

## i2 · Self-contained walk reject: report convention + reject-note verb (#121, Q2 · A)

### What changed

- `scripts/mc-walk-env.sh:11-14`: the header usage block gains
  `reject-note <issue> [report]`, next to `standup` and `down`.
- `scripts/mc-walk-env.sh:16-22`: new `THE WALK REPORT (#121)` paragraph documents the
  convention. The report keeps a `## Findings` section. Each finding is one bullet starting
  `- **FN ·` or `- **CN ·` (other tags such as CL and DD are not sent back). Continuation lines
  are indented. Shots go in `.mc/walk/<issue>-shots/`, beside the report. A reject is pasted
  from `reject-note <issue>` and never typed by hand.
- `scripts/mc-walk-env.sh:645-671`: the new `reject-note)` verb.
  - The report defaults to `$WALK_DIR/<issue>-walk-report.md`. The explicit second argument
    exists so tests stay hermetic (the `__derive-sha` rule). A missing report dies with
    `reject-note <N>: no walk report at <path>`.
  - The report path is made absolute (`cd dirname && pwd`), so a relative argument still
    prints a path starting with `/` (vet MED · hermeticity).
  - One `awk` pass (`LC_ALL=C`, so `·` matches byte for byte) reads only the `## Findings`
    section, which ends at the next `## ` heading. A `- **FN ·` or `- **CN ·` bullet starts
    a kept finding. Indented non-empty lines continue it. Any other line ends it: another
    bullet, a blank line, or a `###` subheading.
  - Output: `Walk <N> · reject · full findings below`, then the bullets verbatim, then
    `full report: <abs>`. After that comes `shots:       <abs>/`, only when the directory
    exists. The label is padded to line up with `full report:`, as in the wireframe.
  - **Shots come from `dirname(report)/<N>-shots`, not `$ROOT/.mc/walk/`** (vet MED fix). By
    default this is the same place, and it means a fixture can never print this repo's real
    `113-shots/`.
  - When there is no FN or CN bullet, it exits 1 through `die` with
    `no FN/CN findings in <report> — nothing self-contained to send`.
- `scripts/mc-walk-env.sh:726`: the unknown-command `die()` now ends
  `| reject-note <issue> [report]`.
- `packages/core/src/mc-walk-env.test.ts:1-2`: the imports add `spawnSync`, `mkdirSync` and
  `readFileSync`.
- `packages/core/src/mc-walk-env.test.ts:446-554`: a new `reject-note` describe with 4 tests.
  Every fixture is in a temp dir, and each fixture report also puts FN and CN bullets under
  `## Verdict` and `## Not walked`, to prove the command reads only the Findings section.
  - One multi-line FN, a CL, and one CN, with a `132-shots/` dir. stdout must equal the
    exact expected text: both findings with their continuation lines, CL left out, and both
    path lines absolute.
  - A relative report argument, run with cwd set to the fixture: `full report: /…`, and no
    `shots:` line because the dir is missing.
  - A CL-only report: non-zero exit, empty stdout, and stderr naming the report with the
    exact wording.
  - Unknown verb: stderr names `reject-note <issue> [report]`. The header text (before
    `set -euo pipefail`) contains the verb, `## Findings`, `- **FN ·` and `<issue>-shots/`.

### TDD

I wrote the 4 tests first. Against the i1 script they fail: `Tests  4 failed | 18 passed
(22)`. I checked this again after implementing, by stashing only the script change. With the
change: `Tests  22 passed (22)`.

### Checks run

- `npx vitest run src/mc-walk-env.test.ts` (packages/core): `Tests  22 passed (22)`.
- `shellcheck -S warning scripts/mc-walk-env.sh`: rc 0. `bash -n`: syntax-ok.
- A manual run over the real report,
  `bash scripts/mc-walk-env.sh reject-note 113 /Users/braden/temp/rv-trip/.mc/walk/113-walk-report.md`,
  printed the FN (10 lines) and the CN (6 lines) verbatim. It left out the 3 CL and 3 DD
  bullets, then printed `full report: /Users/braden/temp/rv-trip/.mc/walk/113-walk-report.md`
  and `shots:       /Users/braden/temp/rv-trip/.mc/walk/113-shots/`. That is the wireframe's
  sample, line for line.
- `pnpm turbo run lint typecheck test`: `Tasks:    10 successful, 10 total`. core has
  `Tests  1253 passed (1253)` and web has `Tests  365 passed (365)`.
- Note: `packages/core/src/mc-walk-env.test.ts` was not prettier-clean before this change,
  and the repo has no prettier config. I did not reformat the file. The new block follows the
  file's existing ~120-column style.

### The mc-dev backstop ask — for the devops seat to file (operator-owned; the dev gate does not file it)

Execution is operator-owned: the dev contract bars `gh`. Here is a ready-to-run payload. The
body file `docs/design/132/mc-dev-ask.md` holds the same text quoted below:

```
gh issue create --repo bradenrc/mc-dev \
  --title "Absolutize relative .mc/… paths in a dispatch's feedback block" \
  --body-file docs/design/132/mc-dev-ask.md
```

> **Absolutize relative `.mc/…` path tokens at feedback assembly**
>
> Where: `src/mc/workers/agent_worker.py:638-642`. The `if feedback:` block joins each
> feedback entry into the dispatch's system prompt verbatim, as
> `"\n".join(f"- {f}" for f in feedback)`.
>
> Problem (rv-trip #121): a walk reject that names `.mc/walk/<N>-walk-report.md` or
> `.mc/walk/<N>-shots/` reaches the dev agent as a relative path. The agent runs in a
> worktree under `$TMPDIR/mc-wt-…`, where `.mc/walk/` does not exist, and sandbox rules may
> bar reads outside the worktree. So the evidence the reject points at can't be found.
>
> Ask: when the feedback block is assembled, rewrite every relative path token that starts
> with `.mc/` (a whitespace/backtick/quote-delimited token beginning `.mc/` or `./.mc/`) to
> `<project root>/.mc/…`. `<project root>` is the dispatching project's directory, not the
> worktree. Leave tokens that are already absolute alone.
>
> Proof on the rv-trip side: a hand-typed reject naming `.mc/walk/<N>-walk-report.md` arrives
> in the dev brief as `/Users/…/rv-trip/.mc/walk/<N>-walk-report.md`.
>
> Why a backstop: rv-trip now renders rejects with `scripts/mc-walk-env.sh reject-note <N>`,
> which already carries the FN/CN findings verbatim and prints only absolute paths (#132 i2).
> The engine rewrite covers the hand-typed reject that skips the verb.

### For qa to check

- Scope: i2 only. i1 is untouched (it has already landed on this branch). i3 (preflight) and
  i4 (#79) are later dispatches.
- `reject-note` writes nothing and starts nothing. Like every verb, it only pays the
  load-time `mkdir -p "$WALK_DIR"` (a no-op).
- A known limit, deliberate: a blank line inside a finding ends that finding. The convention
  (documented in the header) is that continuation lines are indented directly under the
  bullet, which is the shape `113-walk-report.md` already uses.
