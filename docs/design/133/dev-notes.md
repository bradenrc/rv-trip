# #133 · Gate integrity — dev notes

Epic, one branch, items in order (Q6 A). This file covers **i1 (#118)**; i2 (#85) appends
its own section in a later dispatch.

## i1 · #118 · qa gets a runnable tree and a required `executed` block

No product source changes: agent briefs, the persona, and these notes only. `.mc/config.yaml`
is **unchanged** (the per-agent key waits for the engine, see the ask below).

### What changed

- `.mc/agents/qa.md:3` — frontmatter description: verdict is `{passed, executed, findings}`;
  "no git" narrowed to "no git commit or push", because the recipe is a sanctioned git write.
- `.mc/agents/qa.md:41-75` — new **"Get a runnable tree first"** section, placed before "The
  method". The recipe commands:
  1. `git worktree add --detach .turbo/qa-<issue> <dev-branch>`. The branch is the one named
     in the brief's PRIOR ARTIFACT section, never hard-coded.
  2. `cp -p .env …` and `cp -p apps/web/.env.local …` into the nested tree. This addresses the
     vet HIGH: without them the apps/web DB suite skips.
  3. `pnpm install --offline --frozen-lockfile` in that tree.
  4. Mutate, run the test, restore, all in that tree.
  5. `git worktree remove --force .turbo/qa-<issue>` before the verdict, even after a stop.

  Rules in the same section: stop on any denial and do not improvise; the
  `lockfile added packages not in store` denial text for a slice that adds a dependency; a
  suite that printed `API integration tests SKIPPED — no Postgres on …` counts as
  `tests_run: false` and adds nothing to `mutations_run`.
- `.mc/agents/qa.md:130` — "Keep it proportionate": "reconstructed environment" becomes "any
  environment beyond the recipe's tree", so the two sections do not contradict each other.
- `.mc/agents/qa.md:143-190` — "Your output": both verdict examples now carry
  `executed: {tests_run, mutations_run, mutations_red}`, plus a second example for a run that
  could not execute. New rules: `executed` is required; report counts that actually ran (a
  mutation counts only when applied, its test ran, and the tree was restored); a DB-skipped
  suite does not count; could-not-execute means zero counts, `passed` follows the FN count, and
  a `DD · could not execute: <exact denial>` finding. It is never an FN routed to dev.
- `docs/personas/qa_claude.md:194-244` — §5 gets the same shape, both examples, and the same
  rules (including the skip rule and the not-in-store text), pointing at qa.md's recipe. The
  design noted that the verdict shape is written in two places, so both copies were updated
  together to keep them from drifting.

### The mc-dev ask (for the devops seat to file; the dev gate files nothing)

**Title:** Engine-prepared reviewer trees + capture-time refusal of an empty qa pass
(for rv-trip#118)

Today every qa dispatch starts in a tracked-files-only worktree at base. It has no
`node_modules` and no dev code. qa has improvised a different extraction on each run (#110
through #113), and on #112 it was denied `git apply` and returned `passed: true` having run
nothing. rv-trip now has a sanctioned in-agent recipe (`.mc/agents/qa.md`, "Get a runnable
tree first") and a required `executed` block in the verdict. The engine should own both halves.

1. **Per-agent `agents.<name>.setup_cmd`.** Today `setup_cmd` is project-level only and runs
   only in the ship worktree (`.mc/config.yaml:14`). Add an optional per-agent key that runs
   in that agent's dispatch worktree.
2. **Reviewer tree at the dev branch head, set up before dispatch.** For a `reviewer: true` +
   `prior_artifact: true` agent, check out the dispatch worktree at the prior (dev) branch
   head instead of base. Provision `worktree_env` into it as today, then run the agent's
   `setup_cmd` there, unsandboxed like ship, before the agent starts. **A setup failure is an
   infra failure:** the dispatch fails as infra, the agent never starts, and nothing is routed
   to dev or walk.
3. **Capture-time refusal.** When capturing qa's verdict, `passed: true` with
   `executed.mutations_run == 0`, or a verdict with no `executed` block, fails the dispatch as
   **infra**. It is not routed to walk and not routed to dev. The glass shows "qa could not
   execute".

**Acceptance (the rv-trip proof, verified in rv-trip):**
- rv-trip's `.mc/config.yaml` gains, and `mc up` accepts:
  ```yaml
  qa:
    md: .mc/agents/qa.md
    reviewer: true
    prior_artifact: true
    setup_cmd: 'pnpm install --offline --frozen-lockfile'  # Q3 A · qa only
  ```
- A real rv-trip qa run (a slice touching `packages/core/**` or `packages/db/**`) prepares its
  tree **without the recipe**: it finds `node_modules` and the dev code already in place, and
  its verdict reports `executed.mutations_run > 0`.
- A qa verdict with `passed: true, executed.mutations_run: 0` is refused at capture as infra.

Once this lands, the qa.md recipe shrinks to "your tree is ready" (a follow-up rv-trip change).

### Flags for the walk reviewer (vet findings in scope for i1)

- **#118 and #85 close at this epic's ship, before the engine checks land.** The Q1 C option
  text said "#118 closes once the engine change is verified here". The ship gate closes every
  child named in `plan.json`, so both children close on this epic's ship. The "verified here"
  part moved into the mc-dev ask's acceptance above (and, for #85, into mc-dev#170 via i2).
  Until the engine check lands, an empty qa pass is **visible** (zero counts plus the DD
  finding) but **not blocked**. That is Q2 B as picked.
- **No in-epic proof.** qa's `require_paths` (`.mc/config.yaml` `agents.qa`) is
  `packages/core/**` and `packages/db/**` only. This epic touches `.mc/agents/*.md`,
  `docs/personas`, and `docs/design`, so **qa does not run on either item**. The new recipe
  and the `executed` block are not exercised inside this epic. The design's §7 claim "118
  first, so qa has teeth when 85's items go through qa" does not hold. The first real exercise
  is the next core/db slice after ship.
- **Run-required at the first qa dispatch.** #112's `git apply` was permission-denied for
  qa. Whether `git worktree add`, `cp`, and `pnpm install` inside the reviewer tree are allowed
  under qa's tools and permissions cannot be proven statically. The stop-on-denial rule and the
  DD finding cover a denial, but the recipe's success is unverified until a real qa run.
- **Offline install and new dependencies.** A dev slice that adds a dependency not in the local
  pnpm store always lands as could-not-execute. qa.md names the text
  (`lockfile added packages not in store`) so it is not read as a permission denial.
- **Engine tolerance of the new key (for qa to check).** I assumed the engine's verdict capture
  ignores an unknown top-level `executed` key. The engine source is not in this repo, so I
  could not verify it. If capture is strict, the first qa verdict with `executed` will show it.
- **Out of scope for i1:** the vet HIGH on routing (`vet.md:161` omitted route →
  `on_fail: dev`, and `vet.md:102`) is the `vet.md` rewrite in **i2**. It is not addressed here.

### Tests

There is no code to cover: the change is agent-brief and persona prose, and no test in the
repo reads `.mc/agents/*.md` or the persona. The repo gate was run to confirm nothing
regressed (see the report).
