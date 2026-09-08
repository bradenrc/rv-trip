#!/usr/bin/env bash
# mc-walk-env.sh — lean walk-stack lifecycle for rv-trip (modeled on btrip's, v1-simple).
#
#   standup <issue> --branch <branch>   The walk-gate auto-standup: dedicated worktree from
#                                       the code branch, pnpm install, `next dev` on a free
#                                       port against the shared docker Postgres, and a
#                                       .mc/walk/<issue>.json registry entry (the URL the
#                                       glass Walk link reads).
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
  else
    git -C "$wt" checkout --detach "$branch"
  fi
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

  cat >"$WALK_DIR/$issue.json" <<EOF
{
  "slug": "$issue",
  "type": "web",
  "url": "http://localhost:$port",
  "web_port": $port,
  "branch": "$branch",
  "worktree": "$wt",
  "pids": { "web": $pid },
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  echo "walk up: $issue → http://localhost:$port (branch $branch, pid $pid)"
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
