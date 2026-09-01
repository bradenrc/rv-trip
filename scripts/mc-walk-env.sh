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

free_port() { # first free port from 3200
  local p=3200
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
  if [ ! -d "$wt" ]; then
    git -C "$ROOT" worktree add "$wt" "$branch"
  else
    git -C "$wt" checkout "$branch"
  fi
  # Untracked env files don't follow a worktree — copy the root ones next dev reads.
  for f in .env .env.local; do
    [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$wt/$f"
  done
  (cd "$wt" && pnpm install --frozen-lockfile >"$WALK_DIR/$issue-install.log" 2>&1) ||
    die "standup $issue: pnpm install failed — see .mc/walk/$issue-install.log"
  (cd "$ROOT" && docker compose up -d >>"$WALK_DIR/$issue-standup.log" 2>&1) || true

  port="$(free_port)"
  (cd "$wt/apps/web" && PORT="$port" nohup pnpm dev >"$WALK_DIR/$issue-web.log" 2>&1 &
    echo $! >"$WALK_DIR/$issue-web.pid")
  pid="$(cat "$WALK_DIR/$issue-web.pid")"

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
  if [ -f "$WALK_DIR/$slug-web.pid" ]; then
    pid="$(cat "$WALK_DIR/$slug-web.pid")"
    kill "$pid" 2>/dev/null && echo "  killed pid $pid" || true
    # next dev spawns children; sweep the process group best-effort.
    pkill -P "$pid" 2>/dev/null || true
    rm -f "$WALK_DIR/$slug-web.pid"
  fi
  rm -f "$json"
  echo "walk down: $slug (registry entry removed; worktree kept for the ship)"
  ;;

*)
  die "unknown command '${cmd:-}' — use: standup <issue> --branch <b> | down --slug <issue>"
  ;;
esac
