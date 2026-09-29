**Absolutize relative `.mc/…` path tokens at feedback assembly**

Where: `src/mc/workers/agent_worker.py:638-642`. The `if feedback:` block joins each
feedback entry into the dispatch's system prompt verbatim, as
`"\n".join(f"- {f}" for f in feedback)`.

Problem (rv-trip #121): a walk reject that names `.mc/walk/<N>-walk-report.md` or
`.mc/walk/<N>-shots/` reaches the dev agent as a relative path. The agent runs in a
worktree under `$TMPDIR/mc-wt-…`, where `.mc/walk/` does not exist, and sandbox rules may
bar reads outside the worktree. So the evidence the reject points at can't be found.

Ask: when the feedback block is assembled, rewrite every relative path token that starts
with `.mc/` (a whitespace/backtick/quote-delimited token beginning `.mc/` or `./.mc/`) to
`<project root>/.mc/…`. `<project root>` is the dispatching project's directory, not the
worktree. Leave tokens that are already absolute alone.

Proof on the rv-trip side: a hand-typed reject naming `.mc/walk/<N>-walk-report.md` arrives
in the dev brief as `/Users/…/rv-trip/.mc/walk/<N>-walk-report.md`.

Why a backstop: rv-trip now renders rejects with `scripts/mc-walk-env.sh reject-note <N>`,
which already carries the FN/CN findings verbatim and prints only absolute paths (#132 i2).
The engine rewrite covers the hand-typed reject that skips the verb.
