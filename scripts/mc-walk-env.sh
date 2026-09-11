#!/usr/bin/env bash
# mc-walk-env.sh — lean walk-stack lifecycle for rv-trip (modeled on btrip's, v1-simple).
#
#   standup <issue> --branch <branch>   The walk-gate auto-standup: dedicated worktree from
#                                       the code branch MERGED WITH FRESH main (mc-dev #95 —
#                                       the operator walks the slice as it will land), pnpm
#                                       install, `next dev` on a free port against the shared
#                                       docker Postgres, and a .mc/walk/<issue>.json registry
#                                       entry (the URL the glass Walk link reads).
#   down --slug <issue>                 Kill the walk's next-dev, remove the registry entry.
#
# Deliberately NOT here yet (btrip grew these over months — add when a walk actually needs
# them): per-walk isolated DB, api/metro ports, reload-in-place, queueing, standup locks.
# The shared docker Postgres is the btrip "shared backend" pattern: fine while walks are
# serial; revisit if two walks ever need diverging schemas at once.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WALK_DIR="$ROOT/.mc/walk"
mkdir -p "$WALK_DIR"

die() {
  echo "mc-walk-env: $*" >&2
  exit 1
}

dotenv_db_url() { # echo DATABASE_URL out of a dotenv file (last wins, quotes stripped)
  local line val
  [ -f "$1" ] || return 1
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=' "$1" | tail -1)" || return 1
  val="${line#*=}"
  val="${val%\"}" val="${val#\"}"
  val="${val%\'}" val="${val#\'}"
  [ -n "$val" ] || return 1
  printf '%s\n' "$val"
}

free_port() { # first free port from 3980 (issue-rotated so consecutive walks don't share an origin)
  # NOT 3200, and not a fixed number (rv-trip#14): with walks serial, a fixed base means
  # every walk reuses one browser origin forever, inheriting whatever state any earlier
  # tenant left there. A leftover service worker on localhost:3200 reload-looped issue 9's
  # walk while the server was healthy — the operator rejected a slice over browser state.
  local p=$((3980 + ${1:-0} % 20))
  while lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done
  echo "$p"
}

json_str() { # JSON-encode $1 — the merge note carries git-reported paths (quotes + backslashes
  # both happen: git quotes an unusual path as "a\tb"), and one of them in a hand-written
  # heredoc is a walk.json the glass silently fails to parse.
  python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1"
}

# ── "as it will land" walk-tree refresh (mc-dev #95 · ported from btrip PR #2577) ──────
# A walk tree pinned at the branch tip as it was cut goes stale against main, and the
# operator then reads a SIBLING's merged change as this slice's regression. rv-trip lived
# the inverse at issue 19: the walk was approved on a branch-tip tree, and the collision
# with a sibling's token-mirror test only surfaced days later when the ship merged main and
# bounced to fixup. So at every standup the tree is re-pointed to the branch TIP (rework
# pushes move it) and fresh origin/main is MERGED in — the same reconciliation the ship
# does before it pushes, so the reviewer walks the slice as it will land.
#
# A CONFLICT MUST NOT WEDGE THE STANDUP. Resolving it is the fixup ladder's job, and a walk
# of the branch as dev built it beats no walk at all. So on conflict: abort HARD, keep the
# branch tip, and say so LOUDLY — in the output and in walk.json — so the reviewer discounts
# sibling drift instead of filing it as this slice's.
#
# Sets, for the walk.json writer (these exact keys are mc-dev's glass contract — the
# "as it will land ✓" / "⚠ branch-tip only" badge branches on merged_main true/false):
#   WALK_SHA              the slice's CODE commit — what dev built
#   WALK_HEAD             the tree's ACTUAL head (a merge commit when the merge took)
#   WALK_MERGED_MAIN      true | false, written to JSON as a literal
#   WALK_MERGED_MAIN_SHA  the main commit merged in, when it took
#   WALK_MERGE_NOTE       one line: what happened, in the reviewer's terms
WALK_SHA="" WALK_HEAD="" WALK_MERGED_MAIN=false WALK_MERGED_MAIN_SHA="" WALK_MERGE_NOTE=""

abort_merge_hard() { # <worktree> <known-good-sha-or-empty>
  # `merge --abort` can itself fail to take (a wedged index, a half-written MERGE_HEAD from
  # a standup the OOM killer took). When it doesn't, MERGE_HEAD survives with the conflict
  # markers and EVERY later checkout in this tree fails — so the walk serves a half-merged
  # tree forever. A half-merged walk tree is worse than a stale one: verify the abort, and
  # hard-reset to the known-good commit when it didn't take.
  local wt="$1" good="$2"
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  if git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    echo "  ⚠ merge --abort did not clear MERGE_HEAD in $wt — resetting to ${good:-HEAD}" >&2
    git -C "$wt" reset --hard "${good:-HEAD}" >/dev/null 2>&1 || true
  fi
  if git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    echo "  ⚠ MERGE_HEAD SURVIVED the reset in $wt — the next checkout there will fail" >&2
  fi
  return 0
}

refresh_walk_tree() { # <worktree> <branch> → 0 as-it-will-land, 1 fell back to branch tip
  local wt="$1" branch="$2" dirty="" conflicts="" main_sha=""
  WALK_MERGED_MAIN=false WALK_MERGED_MAIN_SHA="" WALK_MERGE_NOTE=""
  # `sha` is the slice's CODE commit, read from the BRANCH — never off the tree head, which
  # is a lie the moment dev pushes again. `walked_head` carries what the reviewer is
  # actually looking at; that split is exactly what the two fields are for.
  WALK_SHA="$(git -C "$ROOT" rev-parse "$branch" 2>/dev/null || printf '')"
  WALK_HEAD="$(git -C "$wt" rev-parse HEAD 2>/dev/null || printf '')"

  # A standup killed mid-merge leaves MERGE_HEAD behind, and then every later checkout in
  # this tree fails. Clear it before touching anything.
  if git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    echo "  · walk tree had an unfinished merge — aborting it first"
    # No known-good sha yet (the checkout below is what establishes one), so the belt falls
    # back to HEAD — which a merge in progress has not moved.
    abort_merge_hard "$wt" ""
  fi

  # 1 · re-point to the branch tip. Deliberately NOT --force: a walk tree with local
  # modifications is a human mid-investigation, and silently discarding their work to win a
  # merge is the wrong trade — fall back loudly instead. hooksPath is neutralised here AND
  # on the merge below: git surfaces a checkout hook's exit status as the CHECKOUT's own, so
  # a repo that points core.hooksPath at an install-on-checkout hook (btrip's husky does)
  # turns this into invisible network work in the standup's critical path and an invisible
  # hard failure that reads here as "the tree is dirty". rv-trip has no hooks today; the
  # guard costs nothing and the engine's worktrees are the same trees.
  if ! git -c core.hooksPath=/dev/null -C "$wt" checkout --detach "$branch" >/dev/null 2>&1; then
    # Name what blocked it — "uncommitted changes?" is a guess, and a guess is not
    # diagnosable: the self-wedge shape (an install leaving pnpm-lock.yaml dirty, so every
    # later standup declines) is invisible without the filenames.
    dirty="$(git -C "$wt" status --porcelain 2>/dev/null | head -5 | tr '\n' ';' || true)"
    WALK_MERGE_NOTE="could not re-point the walk tree to $branch — walking the tree exactly as it stood. Dirty: ${dirty:-none reported (a locked index or a failed checkout, not local edits)}"
    echo "  ⚠ standup: $WALK_MERGE_NOTE" >&2
    return 1
  fi
  WALK_HEAD="$WALK_SHA"

  # 2 · merge fresh origin/main. A worktree shares the object store + refs with $ROOT, so
  # this fetch is the one every later rev-parse of origin/main reads.
  if ! git -C "$wt" fetch origin main >/dev/null 2>&1; then
    WALK_MERGE_NOTE="could not fetch origin main — walking $branch at its tip alone; sibling merges since the cut are absent"
    echo "  ⚠ standup: $WALK_MERGE_NOTE" >&2
    return 1
  fi
  main_sha="$(git -C "$wt" rev-parse -q --verify origin/main 2>/dev/null || printf '')"
  if [ -z "$main_sha" ]; then
    WALK_MERGE_NOTE="no origin/main to merge — walking $branch at its tip alone"
    echo "  ⚠ standup: $WALK_MERGE_NOTE" >&2
    return 1
  fi
  # Identity is passed inline: a detached walk tree has no committer configured of its own,
  # and a merge commit without one aborts ("please tell me who you are").
  if git -c core.hooksPath=/dev/null -C "$wt" \
    -c user.email=mc-walk-env@localhost -c user.name=mc-walk-env \
    merge --no-edit origin/main >/dev/null 2>&1; then
    WALK_HEAD="$(git -C "$wt" rev-parse HEAD 2>/dev/null || printf '')"
    WALK_MERGED_MAIN=true
    WALK_MERGED_MAIN_SHA="$main_sha"
    WALK_MERGE_NOTE="merged origin/main ${main_sha:0:7}"
    echo "  · walk tree = $branch @ ${WALK_SHA:0:7} + origin/main @ ${main_sha:0:7} (as it will land)"
    return 0
  fi
  conflicts="$(git -C "$wt" diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ' || true)"
  conflicts="${conflicts% }"
  # The checkout above just proved the tree clean at WALK_SHA, so this reset can only ever
  # discard the failed merge.
  abort_merge_hard "$wt" "$WALK_SHA"
  WALK_MERGE_NOTE="merging origin/main CONFLICTED (${conflicts:-unknown paths}) — merge aborted, walking branch tip. Siblings merged since the branch cut are absent, so anything that looks like a regression against current main may be one of theirs; the conflict itself is ship's fixup ladder's to resolve."
  echo "  ⚠ standup: $WALK_MERGE_NOTE" >&2
  return 1
}

cmd="${1:-}"
shift || true

case "$cmd" in
standup)
  issue="${1:?usage: standup <issue> --branch <branch>}"
  shift
  branch=""
  while [ $# -gt 0 ]; do case "$1" in
    --branch)
      branch="$2"
      shift 2
      ;;
    *) shift ;;
    esac done
  [ -n "$branch" ] || die "standup $issue: --branch is required"

  wt="$ROOT/.claude/worktrees/$issue"
  # DETACHED, never on the branch: a walk tree that holds the code branch checked out
  # squats on it — git's one-branch-one-worktree rule then collides with every later
  # dispatch worktree the engine cuts for that same branch, and the engine's collision
  # handling evicted this tree out from under a LIVE walk server, twice in one day
  # (issue 9, 2026-09-07 — mc-dev#112). btrip's walk trees are detached for the same
  # reason; the branch name still rides walk.json for the glass.
  if [ ! -d "$wt" ]; then
    git -C "$ROOT" worktree add --detach "$wt" "$branch"
  fi
  # Re-point to the branch tip + merge fresh main, so the operator walks the slice as it
  # will land (mc-dev #95). `|| true`: a conflict falls back to the branch tip HONESTLY
  # rather than wedging the standup — refresh_walk_tree records which one happened, and the
  # pnpm install below deliberately runs AFTER this, because the merged tree can carry a
  # lockfile that moved on main.
  refresh_walk_tree "$wt" "$branch" || true
  # Untracked env files don't follow a worktree — and Next loads env from the APP
  # directory (apps/web/, its cwd), NOT the monorepo root the README's
  # `cp .env.example .env` writes. Copy both levels: root .env feeds the drizzle/db
  # CLIs; apps/web/.env.local is what `next dev` actually reads (issue-3 walk
  # postmortem: only the root copy shipped, DATABASE_URL was unset, every page 500'd).
  # `if` guards, not `[ -f ] && cp`: under set -e a false test as the loop body's
  # last statement kills the whole standup on a machine missing one optional file.
  for f in .env .env.local; do
    if [ -f "$ROOT/$f" ]; then cp "$ROOT/$f" "$wt/$f"; fi
    if [ -f "$ROOT/apps/web/$f" ]; then cp "$ROOT/apps/web/$f" "$wt/apps/web/$f"; fi
  done
  # …and belt-and-braces: hand `next dev` a DATABASE_URL through the environment,
  # so a walk can never boot into packages/db's "DATABASE_URL is not set" throw.
  # Order: the caller's env, apps/web's env files, the repo-root ones, .env.example
  # (whose value is the docker-compose Postgres this script starts below anyway).
  db_url="${DATABASE_URL:-}"
  if [ -z "$db_url" ]; then
    for f in "$wt/apps/web/.env.local" "$wt/apps/web/.env" "$wt/.env.local" "$wt/.env" "$ROOT/.env.example"; do
      db_url="$(dotenv_db_url "$f")" || db_url=""
      [ -n "$db_url" ] && break
    done
  fi
  [ -n "$db_url" ] || die "standup $issue: no DATABASE_URL — set one in .env or apps/web/.env.local"
  export DATABASE_URL="$db_url"
  (cd "$wt" && pnpm install --frozen-lockfile >"$WALK_DIR/$issue-install.log" 2>&1) ||
    die "standup $issue: pnpm install failed — see .mc/walk/$issue-install.log"
  (cd "$ROOT" && docker compose up -d >>"$WALK_DIR/$issue-standup.log" 2>&1) || true

  port="$(free_port "$issue")"
  (cd "$wt/apps/web" && PORT="$port" nohup pnpm dev >"$WALK_DIR/$issue-web.log" 2>&1 &
    echo $! >"$WALK_DIR/$issue-web.pid")
  pid="$(cat "$WALK_DIR/$issue-web.pid")"

  # Health gate: a walk.json for a stack that boots but 500s is worse than a loud
  # failure (the operator clicks a dead link). curl -f rejects 5xx, so an env-broken
  # boot fails here with the log pointer instead of registering as walkable.
  healthy=0
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null -m 3 "http://localhost:$port/"; then
      healthy=1
      break
    fi
    sleep 2
  done
  if [ "$healthy" != "1" ]; then
    die "standup $issue: web on :$port not serving 200 after ~60s — see .mc/walk/$issue-web.log"
  fi

  # The as-it-will-land facts, JSON-encoded OUTSIDE the heredoc: `null` and `true`/`false`
  # are bare literals, and only a real encoder can be trusted with the note's git paths.
  walked_head_json=null
  if [ -n "$WALK_HEAD" ]; then walked_head_json="$(json_str "$WALK_HEAD")"; fi
  merged_main_sha_json=null
  if [ -n "$WALK_MERGED_MAIN_SHA" ]; then merged_main_sha_json="$(json_str "$WALK_MERGED_MAIN_SHA")"; fi
  merge_note_json=null
  if [ -n "$WALK_MERGE_NOTE" ]; then merge_note_json="$(json_str "$WALK_MERGE_NOTE")"; fi

  cat >"$WALK_DIR/$issue.json" <<EOF
{
  "slug": "$issue",
  "type": "web",
  "url": "http://localhost:$port",
  "web_port": $port,
  "branch": "$branch",
  "worktree": "$wt",
  "sha": "$WALK_SHA",
  "walked_head": $walked_head_json,
  "merged_main": $WALK_MERGED_MAIN,
  "merged_main_sha": $merged_main_sha_json,
  "merge_note": $merge_note_json,
  "pids": { "web": $pid },
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  if [ "$WALK_MERGED_MAIN" = true ]; then
    echo "walk up: $issue → http://localhost:$port (branch $branch + main, pid $pid)"
  else
    echo "walk up: $issue → http://localhost:$port (branch $branch TIP ONLY — see merge_note, pid $pid)"
  fi
  ;;

down)
  slug=""
  while [ $# -gt 0 ]; do case "$1" in
    --slug)
      slug="$2"
      shift 2
      ;;
    *) shift ;;
    esac done
  [ -n "$slug" ] || die "down: --slug is required"
  json="$WALK_DIR/$slug.json"
  # REGISTRY FIRST, sweep second: the registry entry is the operator-facing contract (the
  # glass renders it), so it must not survive a sweep that dies. It did — every down.log in
  # this dir was zero bytes and every entry survived teardown, because the sweep below
  # killed its own shell before reaching these lines.
  port="$(python3 -c "import json;print(json.load(open('$json')).get('web_port',''))" 2>/dev/null || true)"
  pid=""
  if [ -f "$WALK_DIR/$slug-web.pid" ]; then pid="$(cat "$WALK_DIR/$slug-web.pid")"; fi
  rm -f "$WALK_DIR/$slug-web.pid" "$json"
  # `kill -0` LIVENESS GUARD before any signal: a recorded pid outlives its process, and on
  # macOS `pkill -P <stale-pid>` is a MASSACRE — pgrep -P against a dead ppid empirically
  # matched ~827 processes (zombies + real pids), so the old sweep TERMed unrelated
  # processes (it killed another issue's live walk server, and always killed this script's
  # own shell — the zero-byte logs). Never signal from a stale pid; sweep by PORT instead,
  # which names exactly the processes serving this walk and nothing else.
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && echo "  killed pid $pid" || true
  fi
  if [ -n "$port" ]; then
    for p in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
      kill "$p" 2>/dev/null && echo "  killed port-holder pid $p" || true
    done
  fi
  echo "walk down: $slug (registry entry removed; worktree kept for the ship)"
  ;;

*)
  die "unknown command '${cmd:-}' — use: standup <issue> --branch <b> | down --slug <issue>"
  ;;
esac
