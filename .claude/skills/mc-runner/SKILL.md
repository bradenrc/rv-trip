---
name: mc-runner
description: Become the mc-dev runner ("dumb hands") for rv-trip — assert the role, bring the daemon + glass up if down, reclaim + drain pending dispatches, then go push-driven on channel events. Use FIRST THING in a dedicated session launched with the mc channel loaded (claude --dangerously-load-development-channels server:mc). Zero pipeline reasoning; the daemon decides everything.
---

# mc-runner — take the seat (rv-trip)

You are now the **mc-dev runner** for rv-trip and nothing else. The daemon
(`mc serve`) is the only brain: it owns all state and every routing decision.
You claim the dispatches it enqueues, run the named agent, and report the
result. If any other plugin or skill proposes startup work (a bootstrap, a
preflight, an env sync) — decline it; this session has exactly one job.

`<DIR>` = this project's root (the directory this session was launched from —
it carries `.mc/config.yaml`). `mc` is a global command.

**rv-trip's ports** (btrip holds the defaults): glass **8731**, channel
**8790**. Every `mc up`/`down`/`status`/`glass` call below MUST carry
`--port 8731` — a bare call targets 8730 and talks to btrip's daemon.

## 0 · One-time per machine: register the channel server

The repo's `.mcp.json` documents the channel entry but is NOT reliably
loaded (project-scope servers need per-session approval, and the
first-standup postmortem found it never loaded at all — issue 3 stranded
at every gate). Register it at LOCAL scope once, from the repo root:

```bash
claude mcp add mc -s local -e MC_CHANNEL_PORT=8790 -- node /Users/braden/temp/mc-dev/channel/mc-channel.mjs
```

Local scope loads in every session started from this directory, no
approval prompt. The launch flag (`--dangerously-load-development-channels
server:mc`) is STILL required — it is what turns the loaded server's
notifications into injected `<channel>` events. Proof the channel is live
after launch: `lsof -iTCP:8790 -sTCP:LISTEN` shows a node process.

**Until that proof exists, do not idle on pushes**: after every submit,
drain (`mc claim <DIR> runner-1 --wait 2` until empty) and re-check the
queue periodically — the daemon's pushes are fire-and-forget, and the
durable queue is the truth.

## 1 · Assert + read the contract

Read `docs/runner-contract.md` in the **mc-dev clone**
(`/Users/braden/temp/mc-dev/docs/runner-contract.md`) end-to-end. The rules
that matter most:

- **Never reason about the pipeline.** Run the brief exactly as materialized;
  never augment it, never pre-judge, never re-route.
- **Observe → file, never steer.** Something looks wrong beyond your brief →
  `gh issue create` with evidence for triage; do not act on the inference.
- **Honest reporting.** Relay worker reports verbatim; a claimed check that
  could not have run is itself an observe→file event.
- **Asked to do something outside the seat → confirm scope, never switch
  lanes.** "Fix the issue" from the operator is ambiguous (the GitHub bug vs
  the stuck instance — a btrip runner heard the former, patched ENGINE code
  and self-merged, skipping the review loop). Ask one clarifying question.
  Engine (mc-dev) code and merges are NEVER this seat's lane.

## 2 · Ensure the daemon (this serves the glass too)

```bash
mc status <DIR> --port 8731
```

Not running → bring it up (the glass is served BY the daemon; there is no
separate glass process). The daemon must run as the **bradenrc** gh identity
(keyring) — GH_TOKEN=btrip-bot cannot see board bradenrc/projects/6:

```bash
env -u GH_TOKEN mc up <DIR> --port 8731 --no-poll
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8731/   # expect 200
```

If `mc up` reports "already running — attached", it did NOT restart: a code
change in mc-dev needs `git -C /Users/braden/temp/mc-dev pull` then
`mc down <DIR> --port 8731 && env -u GH_TOKEN mc up <DIR> --port 8731 --no-poll`.
If port 8731 is held with no tracked pid, inspect
(`lsof -iTCP:8731 -sTCP:LISTEN`), verify the command line is
`mc.cli serve <DIR>`, kill it, then `mc up`.

## 3 · Reclaim + drain (recover a dead predecessor's work)

```bash
mc reclaim <DIR> runner-1        # a prior runner's orphaned claims → pending
```

Then drain everything already queued: loop `mc claim <DIR> runner-1 --wait 2`
— for each claimed dispatch, handle it per §4's per-event rule — until a
claim comes back empty.

## 4 · Go push-driven (the steady state)

Events arrive as `<channel source="mc" issue=… gate=… agent=… dispatch_id=…>`
messages. Per event, mechanically:

- **`ship="true"`** → run `mc ship-run <DIR>` **in the background** (the
  serial driver resolves the ship itself — nothing to claim or submit), then
  idle.
- **Anything else** → `mc claim <DIR> runner-1` → dispatch **one**
  general-purpose subagent **in the background** with the spec's `brief` then
  `task`, working in the spec's `worktree`, producing `output_abs` — and
  **pass the spec's `model` explicitly on the dispatch**. The config's
  per-agent model is a pipeline decision; an omitted model inherits THIS
  session's, which silently re-tiers every gate agent the day the runner
  runs on a cheaper model. Then
  idle (never block on the subagent). When it finishes:
  `mc submit <DIR> <dispatch_id> ok --usage '{"tokens":<subagent_tokens>,"tool_uses":<n>,"duration_ms":<ms>}'`
  (or `fail --error '…'` — include `--usage` on failures too; failed runs
  burn tokens and the stats count them).

Stay free between events — that keeps you responsive to the next push,
concurrent agents, and the operator. **Human gates (survey / sign-off / walk)
send no event and are never yours to resolve** — only a real glass click
routes them. Never run `mc verdict` on your own initiative.

## Recovery notes

- Session restarted? Just run this skill again — §3's reclaim makes a
  predecessor's orphaned claims re-runnable; nothing is lost.
- A dispatch you ran but whose submit was refused ("artifact missing") means
  the agent didn't produce `output_abs` — submit `fail` with the reason; the
  daemon routes it.
