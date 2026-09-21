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

# ── `sha` derivation (#86 · ported from btrip's cmd_up, ~/temp/btrip/scripts/mc-walk-env.sh:806-845) ──
# mc-dev's walk-staleness belt judges a hand-stood env on exactly ONE key: `sha` in
# .mc/walk/<issue>.json, "what dev built". When `rev-parse "$branch"` above misses (a
# renamed/deleted branch, a remote-only name) WALK_SHA is empty, this script writes
# "sha": "" — and the belt's entry_code_sha falls back to `walked_head`, which on a tree a
# standup built is the as-it-will-land MERGE commit, not the code commit. The env then reads
# STALE, the glass says "don't walk this", and the next walk-gate entry respins the
# operator's stack out from under them. So derive it instead, and when even that can't
# answer write a literal null (the belt's honest "unknown") rather than a lie.
#
# The derivation is a NAMED function rather than inline standup steps so the decision is
# testable without the procedure (#86 Q1 = B) — packages/core/src/mc-walk-env.test.ts drives
# it through the `__derive-sha` verb below.
#
# stdout is exactly one machine-readable line, `<rule>\t<sha>`, NOT a human log line: the
# caller reads it through a command substitution, and a subshell cannot hand a variable
# back, so the provenance line (#86 Q5 = A) is the CALLER's to render. `sha` is empty only
# on the `none` row.
#
# Every rung is an `if … then … fi` and the function ends with an explicit printf +
# `return 0`. btrip ends rule 3 with `[ -z "$X" ] && X=…` and gets away with it because more
# statements follow in its function; HERE the derivation IS the function, so a false test as
# the last statement would return 1 and `x="$(derive_code_sha …)"` under `set -euo pipefail`
# (:16) would kill the whole standup. Same lesson as :205-207.
#
# No `jq` — there is none in this repo; rule 1 reads the prior entry with python3, the same
# idiom as json_str (:51) and `down`'s port reader (:321).
derive_code_sha() { # <worktree> <known-sha|""> <regfile|""> → one line on stdout: <rule>\t<sha>
  local wt="$1" known="${2:-}" rf="${3:-}"
  local head="" prior="" prior_head="" prior_sha="" parent=""

  # seed · the standup's own `rev-parse <branch>` is still the best answer when it worked.
  if [ -n "$known" ]; then
    printf '%s\t%s\n' branch "$known"
    return 0
  fi

  # Read HEAD from the TREE, never $WALK_HEAD: :130 sets WALK_HEAD="$WALK_SHA", so on the
  # empty-WALK_SHA path that variable is blank while the tree's real HEAD is not. Doing its
  # own rev-parse is also what makes `__derive-sha` standalone.
  head="$(git -C "$wt" rev-parse HEAD 2>/dev/null || printf '')"
  if [ -z "$head" ]; then
    # terminal · no tree, no commits. Say so; the caller writes `null` and the belt answers
    # "unknown" (no badge), which fires a cheap standup instead of respinning a good env.
    printf '%s\t%s\n' none ""
    return 0
  fi

  # rule 1 · carry. A prior entry whose walked_head is still this tree's HEAD describes the
  # same build, so the standup's own record is still true — carry it rather than re-guess.
  # `regfile` is an explicit positional with NO default: a default of "$WALK_DIR/$issue.json"
  # would let a test run from a temp fixture read this repo's live walk state. Absent ⇒ rule
  # 1 has no source and simply does not fire. The carry cannot launder a freeze either —
  # mc-dev's freeze POPS walked_head when it re-points a tree, and walked_head is the match
  # key.
  if [ -n "$rf" ] && [ -e "$rf" ]; then
    prior="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("%s\t%s" % (d.get("walked_head") or "", d.get("sha") or ""))' "$rf" 2>/dev/null || true)"
    prior_head="${prior%%$'\t'*}"
    prior_sha="${prior#*$'\t'}"
    if [ -n "$prior_sha" ] && [ "$prior_head" = "$head" ]; then
      printf '%s\t%s\n' carry "$prior_sha"
      return 0
    fi
  fi

  # rule 2 · unwrap — gated on merge PROVENANCE, never merge shape. refresh_walk_tree builds
  # as-it-will-land by `checkout --detach <branch>` (:121) then merging origin/main INTO it
  # under its own identity (:147-149), so a merge head IT made has the code tip as HEAD^1. A
  # merge anyone ELSE made proves nothing about parent order: the ship gate merges main INTO
  # the branch, so a branch tip can itself be a merge whose ^1 is the PRE-merge commit
  # (origin/feat/27-migrations is exactly that shape in this clone). Unwrapping that would
  # read STALE against the fold and respin the very env this derivation protects.
  if [ "$(git -C "$wt" log -1 --format=%ce HEAD 2>/dev/null || printf '')" = "mc-walk-env@localhost" ] &&
    git -C "$wt" rev-parse -q --verify HEAD^2 >/dev/null 2>&1; then
    parent="$(git -C "$wt" rev-parse HEAD^1 2>/dev/null || printf '')"
    if [ -n "$parent" ]; then
      printf '%s\t%s\n' unwrap "$parent"
      return 0
    fi
  fi

  # rule 3 · the tree head IS the code commit. The pre-derivation behaviour, deliberately
  # unchanged — every unrecognised shape (and refresh's fast-forward case, where the merge at
  # :147 moves nothing) lands here and is never worse than today.
  printf '%s\t%s\n' head "$head"
  return 0
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

  # Migrations BEFORE the server (#65): a walk DB behind on migrations answers 500 on
  # every page, so the standup dies at the health gate looking like a web bug. Wait for
  # Postgres, then apply this worktree's migrations to the shared walk DB.
  for _ in $(seq 1 15); do
    docker exec rv-trip-db pg_isready -U rvtrip -d rvtrip >/dev/null 2>&1 && break
    sleep 2
  done
  (cd "$wt" && pnpm --filter @rv-trip/db migrate >>"$WALK_DIR/$issue-standup.log" 2>&1) ||
    die "standup $issue: db migrate failed — see .mc/walk/$issue-standup.log"

  # Reap OUR OWN stale server before choosing a port (#65): a dead-but-listening dev
  # server from a failed standup both holds its port and, on Next 16, blocks ANY second
  # dev server for the same dir ("Another next dev server is already running"), so a
  # port retry can never succeed. Scoped to this issue's pid file — never machine-wide.
  if [ -f "$WALK_DIR/$issue-web.pid" ]; then
    kill "$(cat "$WALK_DIR/$issue-web.pid")" >/dev/null 2>&1 || true
    rm -f "$WALK_DIR/$issue-web.pid"
    sleep 1
  fi

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
    # Down the dead server before dying (#65) — otherwise it keeps holding the port AND
    # Next 16's same-dir lock, and every retry fails on "Another next dev server is
    # already running" instead of the real cause.
    kill "$pid" >/dev/null 2>&1 || true
    rm -f "$WALK_DIR/$issue-web.pid"
    die "standup $issue: web on :$port not serving 200 after ~60s — see .mc/walk/$issue-web.log"
  fi

  # Derive `sha` (#86). HERE and nowhere else: the tree's HEAD is only final once
  # refresh_walk_tree's merge has taken or been aborted, and the heredoc below overwrites the
  # very prior entry rule 1 reads. This encode block is the one window that satisfies both.
  derived="$(derive_code_sha "$wt" "$WALK_SHA" "$WALK_DIR/$issue.json")"
  sha_rule="${derived%%$'\t'*}"
  CODE_SHA="${derived#*$'\t'}"
  # Which rung answered — a stale badge raises exactly that question and today nothing
  # records it. The standup's own "  · …" idiom (:154); the `none` row is the only one that
  # warns, matching how refresh_walk_tree separates progress from warnings (:127, :136, :163).
  # merge_note stays untouched: that is the REVIEWER-facing "is this as it will land" string
  # the glass renders, and sha provenance is an operator/debug fact.
  case "$sha_rule" in
  branch) echo "  · sha ← branch (rev-parse $branch → ${CODE_SHA:0:7})" ;;
  carry) echo "  · sha ← rule 1 · carry (prior entry, walked_head unchanged → ${CODE_SHA:0:7})" ;;
  unwrap) echo "  · sha ← rule 2 · unwrap (merge by mc-walk-env, ^1 → ${CODE_SHA:0:7})" ;;
  head) echo "  · sha ← rule 3 · head (no record, no script-merge → ${CODE_SHA:0:7})" ;;
  *) echo "  ⚠ sha ← none (tree head unreadable — writing null; the belt will fire a standup)" >&2 ;;
  esac

  # The as-it-will-land facts, JSON-encoded OUTSIDE the heredoc: `null` and `true`/`false`
  # are bare literals, and only a real encoder can be trusted with the note's git paths.
  # `sha` joins its three already-encoded siblings here (#86 Q3 = A): written raw it could
  # only ever be a STRING, and "" is the value the belt misreads as absent.
  sha_json=null
  if [ -n "$CODE_SHA" ]; then sha_json="$(json_str "$CODE_SHA")"; fi
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
  "sha": $sha_json,
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

__derive-sha)
  # Un-advertised (#86): the harness's handle on the ladder, so all six rows of the contract
  # can be driven over throwaway git fixtures without running a standup. It exists for
  # packages/core/src/mc-walk-env.test.ts and is deliberately absent from the die() wording
  # below.
  #
  # `regfile` and `known` are explicit and default to EMPTY — never to
  # "$WALK_DIR/$issue.json". mkdir -p "$WALK_DIR" (:20) runs for every verb including this
  # one, which is a benign no-op; a defaulted regfile would not be — it would let a fixture
  # in a temp dir read this repo's live walk state and make rule 1 fire on real state.
  dwt="${1:?usage: __derive-sha <worktree> [regfile] [known-sha]}"
  derive_code_sha "$dwt" "${3:-}" "${2:-}"
  ;;

*)
  die "unknown command '${cmd:-}' — use: standup <issue> --branch <b> | down --slug <issue>"
  ;;
esac
