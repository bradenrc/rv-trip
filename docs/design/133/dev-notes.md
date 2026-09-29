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

## i2 · #85 · the wireframe emits `resolved-answers.json`; vet diffs it

No product source changes: two agent briefs and these notes. `.mc/config.yaml` is unchanged.

### What changed

- `.mc/agents/wireframe.md:3` — frontmatter description names the manifest as an output.
- `.mc/agents/wireframe.md:21-24` — contract: the output is now TWO files, `index.html` +
  `resolved-answers.json` (an epic adds `plan.json`).
- `.mc/agents/wireframe.md:93-94` — a vet survey-fidelity fail (`route: "wireframe"`)
  re-enters this gate, like a walk-reject or `reset_to_gate`.
- `.mc/agents/wireframe.md:113-115` — the report's answer set **and the manifest** must equal
  the feedback block, value for value.
- `.mc/agents/wireframe.md:122-152` — new section **"The resolved-answers manifest"**: the flat
  `{"q1": "C", …}` example (this epic's own answers), with these rules. Every `data-q` is a
  key, including `data-material="0"`. A non-null value is copied exactly from the feedback
  block and must be what `index.html` renders. A null value resolves to the ★ letter and needs
  the static "⚠ defaulted" note (never `null` in the manifest). Plain JSON, no comments, and
  `index.html` stays script-free. The manifest is never a way to record a substitution.
- `.mc/agents/wireframe.md:156-157` — the Epics section calls `plan.json` the THIRD output.
- `.mc/agents/wireframe.md:205-207` — hard rule: "TWO files: index.html + resolved-answers.json"
  (+ plan.json on an epic).
- `.mc/agents/vet.md:16-20` — contract: `route: "wireframe"` on every survey-fidelity fail,
  alongside the rare `route: "mock"`.
- `.mc/agents/vet.md:100-128` — the survey-fidelity check is rewritten with three HIGH conditions:
  **(a)** the manifest vs the feedback block (a non-null difference, or a missing question);
  **(b)** the manifest vs the rendered `index.html`, which keeps the "diff the ARTIFACT, not
  its self-description" rule and the ⚠-only-where-null rule; **(c)** a missing or unparseable
  manifest, with the finding naming the path. On (c), vet still diffs the rendered HTML
  directly. The section ends by saying that after mc-dev#170, the engine runs (a) at capture
  and vet keeps (b) and (c).
- `.mc/agents/vet.md:166-169` — a new `"route": "wireframe"` bullet in the route section.
- `.mc/agents/vet.md:187-200` — a `route: "wireframe"` verdict example (the #82 q6 replay).
  The closing rule is corrected: an omitted route, or one that is not a gate id, falls to
  `on_fail` (dev), so a fidelity fail must name `wireframe`. When a verdict also needs `mock`,
  `mock` wins.

### Vet HIGH on routing: addressed

The vet finding was right. An omitted `route` falls to `pipeline.gates[vet].on_fail: dev`. I
checked that the engine accepts `wireframe`: `mc-dev/src/mc/engine/graph.py:182-184` (the
reviewer-worker branch) takes `route` when it is in `{g.id for g in pipeline.gates}`, and
otherwise uses `resolve_transition(gate, False)`. `wireframe` is a gate id in
`.mc/config.yaml`. `mc-dev/src/mc/workers/dispatch.py:122-123` passes any non-blank string
`route` through. The old `vet.md:102` wording ("routed back to wireframe" with no route named)
is gone. Every fidelity HIGH now names `"route": "wireframe"`, and both the contract bullet and
the closing rule say so. This departs from the design's own text ("no `route` on these (back
to wireframe)") in the way the vet finding asked, to get the outcome the design wanted.

### Consumer contract for mc-dev#170 (for the devops seat; the dev gate files nothing)

rv-trip's side of mc-dev#170 is now in place. At wireframe capture, the engine can:

1. Read `docs/design/<issue>/resolved-answers.json` from the wireframe worktree. It is a flat
   JSON object of `question id → option letter`, with one key per survey question (the mock's
   `data-q`), non-material ones included. It never contains `null`.
2. Diff it against the survey verdict the engine already holds. Any non-null survey value
   that differs, or a missing key, refuses the capture. A missing or unparseable file also
   refuses it. Route the refusal back to `wireframe` with the diff as notes. Do not route it
   to vet or dev.
3. Leave the rendered-HTML half (vet check (b)) to vet. The engine does not parse
   `index.html`.

**Acceptance (the rv-trip proof):** a real rv-trip wireframe dispatch whose manifest
substitutes a non-null survey answer (for example, the #82 q6 shape: survey `A`, manifest `B`)
is **refused at capture** and re-enters `wireframe`, and never reaches vet. A faithful manifest
captures normally.

### Flags for the walk reviewer (i2)

- **#85 closes at this epic's ship, before mc-dev#170 lands.** Until the engine check lands,
  enforcement is vet's check only (Q5 B, interim).
- **Run-required at the first real vet fail.** I verified statically that `route: "wireframe"`
  is a legal transition. I did not verify at runtime that the wireframe agent receives vet's
  findings as its feedback block on re-entry. That needs a real fidelity fail.
- **No in-epic proof.** This epic's own wireframe predates the rule, so it wrote no manifest
  (the wireframe branch holds `index.html` + `plan.json` only). The first wireframe dispatched
  after ship is the first to emit one. The first vet after ship is the first to check (a)–(c).
  Any wireframe still in flight at ship that was produced under the old brief will fail (c) at
  vet and be redrawn. That is intended, but expect it once.
- **The manifest's keys depend on the mock's `data-q` ids.** The rule reads them from the
  mock. If a mock ever omits `data-q`, the key set is undefined. I did not change mock.md.

### Tests

There is no code to cover: the change is agent-brief prose. No test in the repo reads
`.mc/agents/*.md`. The repo gate was run to confirm nothing regressed:
`pnpm turbo run lint typecheck test` → `Tasks: 10 successful, 10 total` (web: 45 files,
365 tests passed).
