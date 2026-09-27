#!/usr/bin/env bash
# release-mobile.sh — one command to cut a PRODUCTION TripCaddie release: an
# EAS build that auto-submits to the store in the same run. Adapted from
# btrip's scripts/release-mobile.sh; ships to TestFlight. Android has no
# submit config yet (no Play listing), so the default platform is ios.
#
#   make release-mobile            # interactive survey, iOS
#   make release-mobile-ios        # iOS only
#   make release-mobile-android    # Android only (build; no store submit yet)
#   scripts/release-mobile.sh --platform ios --yes --dry-run   # non-interactive
#
# WHAT'S AUTOMATIC (don't hand-set these):
#   • Build number (iOS buildNumber / Android versionCode) — eas.json has
#     cli.appVersionSource="remote" + build.production.autoIncrement=true, so
#     EAS bumps it server-side on every build. Nothing to touch here.
#   • Submit credentials — stored server-side (the Group Caddie team's App
#     Store Connect API key); `--auto-submit` reads submit.production from
#     eas.json (iOS ascAppId 6816554893).
#   • Archive size — .easignore at the repo root keeps the upload to source
#     (the monorepo's worktrees + web build output are 30 GB+ otherwise).
#
# WHAT YOU DO CONTROL:
#   • Marketing version (app.json "version") — the human-facing X.Y.Z. Bumping
#     it here edits app.json IN PLACE, which is an UNCOMMITTED change: commit it
#     via a PR so main matches what you released.
#
# The load-bearing preflight is the STALE-CHECKOUT guard: EAS builds your local
# working directory, so a checkout behind origin/main ships old code (this is
# the bug class that crashed the first TestFlight build). We fetch + refuse to
# proceed on a behind checkout without an explicit ff-only pull or override.
set -euo pipefail

# ── Locations ────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
APP_JSON="$MOBILE/app.json"
EAS_DASHBOARD="https://expo.dev/accounts/bradenrc/projects/tripcaddie/builds"

# ── Output helpers ───────────────────────────────────────────────────────────
BOLD=""; RESET=""; YELLOW=""
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RESET="$(printf '\033[0m')"; YELLOW="$(printf '\033[33m')"
fi
ok()   { echo "  ✓ $*"; }
warn() { echo "  ⚠ $*" >&2; }
info() { echo "  • $*"; }
die()  { echo "✗ $*" >&2; exit 1; }
loud() { echo "${BOLD}${YELLOW}$*${RESET}" >&2; }

# ── Defaults / flag state (empty = "ask interactively / fall back") ───────────
PLATFORM=""         # ios | android | both
DO_SUBMIT=""        # yes | no
DO_WAIT=""          # yes | no
DRY_RUN=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: scripts/release-mobile.sh [flags]

Build + auto-submit a PRODUCTION mobile release via EAS. Interactive by default;
every prompt has a sensible default and can be pre-answered by a flag (so this is
also CI-usable). When stdin is not a TTY, unset options fall back to defaults.

Flags:
  --platform ios|android|both   Which stores to release to           (default: ios)
  --no-submit                   Build only; do NOT submit to stores   (default: submit)
  --no-wait                     Don't block on the build; return once
                                queued (--auto-submit still submits
                                server-side after the build finishes)
  --dry-run                     Print the exact eas command(s) and exit 0
                                WITHOUT calling eas. Preflight is non-fatal here.
  --yes, -y                     Skip the final confirmation prompt
  -h, --help                    This help

Examples:
  make release-mobile                     # survey, iOS
  make release-mobile-ios                 # iOS only, survey
  scripts/release-mobile.sh --platform ios --yes --dry-run
EOF
}

# ── Parse flags ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --platform)
      shift; [ $# -gt 0 ] || die "--platform needs a value (ios|android|both)"
      PLATFORM="$1" ;;
    --platform=*) PLATFORM="${1#*=}" ;;
    --no-submit)  DO_SUBMIT="no" ;;
    --no-wait)    DO_WAIT="no" ;;
    --dry-run)    DRY_RUN=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) die "unknown flag: $1  (see --help)" ;;
  esac
  shift
done

if [ -n "$PLATFORM" ] && [ "$PLATFORM" != "ios" ] && [ "$PLATFORM" != "android" ] && [ "$PLATFORM" != "both" ]; then
  die "--platform must be ios|android|both (got: $PLATFORM)"
fi

# ── TTY-aware prompt: echo default when non-interactive ──────────────────────
INTERACTIVE=0
[ -t 0 ] && INTERACTIVE=1

# prompt_default "Question" "default" -> echoes the answer on stdout
prompt_default() {
  local q="$1" def="$2" ans
  if [ "$INTERACTIVE" -eq 1 ]; then
    read -r -p "$q [$def]: " ans || ans=""
    echo "${ans:-$def}"
  else
    echo "$def"
  fi
}

# prompt_yes_no "Question" "yes|no default" -> echoes yes|no
prompt_yes_no() {
  local q="$1" def="$2" ans
  if [ "$INTERACTIVE" -eq 1 ]; then
    read -r -p "$q [$def]: " ans || ans=""
    ans="${ans:-$def}"
    case "$ans" in
      y|Y|yes|YES|Yes) echo "yes" ;;
      n|N|no|NO|No)    echo "no" ;;
      *)               echo "$def" ;;
    esac
  else
    echo "$def"
  fi
}

# ── Resolve the eas invocation (global > repo-local > npx) ───────────────────
# Echoes a runnable prefix, e.g. "eas" or "pnpm --filter @rv-trip/mobile exec eas".
EAS_BIN=""
resolve_eas() {
  if command -v eas >/dev/null 2>&1; then
    EAS_BIN="eas"
  elif command -v pnpm >/dev/null 2>&1; then
    EAS_BIN="pnpm --filter @rv-trip/mobile exec eas"
  elif command -v npx >/dev/null 2>&1; then
    EAS_BIN="npx eas"
  else
    EAS_BIN=""
  fi
}

# ── Preflight ────────────────────────────────────────────────────────────────
# In --dry-run these checks are informational (never fatal) so the smoke-test
# can run from any branch / logged-out. Live runs treat the same issues as hard.
preflight() {
  local hard=1
  [ "$DRY_RUN" -eq 1 ] && hard=0
  echo "Preflight:"

  # eas CLI reachable
  resolve_eas
  if [ -z "$EAS_BIN" ]; then
    if [ "$hard" -eq 1 ]; then
      die "no eas CLI found. Install it: npm i -g eas-cli  (or run via pnpm/npx), then \`eas login\`."
    else
      warn "no eas CLI found (npm i -g eas-cli). --dry-run continues; a real run needs it."
      EAS_BIN="eas"  # so the printed command reads naturally
    fi
  else
    local ver; ver="$($EAS_BIN --version 2>/dev/null | head -1 || true)"
    ok "eas CLI: ${EAS_BIN} ${ver:+(v$ver)}"
  fi

  # logged in
  if [ "$EAS_BIN" = "eas" ] || command -v eas >/dev/null 2>&1; then
    local who; who="$($EAS_BIN whoami 2>/dev/null | head -1 || true)"
    if [ -n "$who" ]; then
      ok "eas whoami: $who"
    elif [ "$hard" -eq 1 ]; then
      die "not logged in to EAS. Run: eas login"
    else
      warn "eas whoami failed (run \`eas login\`). --dry-run continues."
    fi
  fi

  # git branch / freshness — the key stale-checkout guard
  local branch; branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ "$branch" = "main" ]; then
    ok "on branch main"
  else
    warn "not on main (on '$branch') — releases normally cut from main."
  fi

  if git -C "$ROOT" rev-parse --verify origin/main >/dev/null 2>&1; then
    info "git fetch origin main …"
    git -C "$ROOT" fetch --quiet origin main 2>/dev/null || warn "git fetch failed (offline?) — freshness unverified."
    local behind; behind="$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
    if [ "${behind:-0}" -gt 0 ]; then
      warn "HEAD is ${behind} commit(s) BEHIND origin/main — EAS builds THIS checkout, so you'd ship stale code."
      if [ "$hard" -eq 1 ]; then
        local choice
        choice="$(prompt_yes_no "  Pull origin/main (--ff-only) before building?" "yes")"
        if [ "$choice" = "yes" ]; then
          git -C "$ROOT" pull --ff-only origin main || die "ff-only pull failed — resolve manually, then re-run."
          ok "pulled origin/main (fast-forward)"
        else
          die "refusing to release a stale checkout. Pull origin/main (or re-run and choose yes)."
        fi
      fi
    else
      ok "up to date with origin/main"
    fi
  else
    warn "no origin/main ref — freshness unverified."
  fi

  # dirty tree — EAS builds the working dir, so uncommitted changes ship
  if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
    warn "working tree is DIRTY — EAS builds the working directory, so uncommitted changes will ship."
  else
    ok "clean working tree"
  fi
  echo
}

# ── Marketing version (read + optional in-place bump) ────────────────────────
read_version() {
  node -e 'process.stdout.write(require(process.argv[1]).expo.version)' "$APP_JSON" 2>/dev/null || echo "?"
}

# write_version <new> — parse/write app.json via node so formatting stays valid
write_version() {
  local newv="$1"
  node -e '
    const fs = require("fs");
    const p = process.argv[1], v = process.argv[2];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.expo.version = v;
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  ' "$APP_JSON" "$newv"
}

survey_version() {
  local cur; cur="$(read_version)"
  local entered
  entered="$(prompt_default "Marketing version" "$cur")"
  if [ -n "$entered" ] && [ "$entered" != "$cur" ]; then
    write_version "$entered"
    loud "⚠ app.json version $cur → $entered is an UNCOMMITTED change — commit it via a PR so main matches the released version."
    RESOLVED_VERSION="$entered"
  else
    RESOLVED_VERSION="$cur"
  fi
}

# ── Main flow ────────────────────────────────────────────────────────────────
echo "── mobile release ─────────────────────────────────────────────"
preflight

# Resolve each option: flag pre-answers; else survey (or default when non-TTY).
if [ -z "$PLATFORM" ]; then
  PLATFORM="$(prompt_default "Platforms (ios|android|both)" "ios")"
  case "$PLATFORM" in ios|android|both) ;; *) PLATFORM="ios" ;; esac
fi

survey_version

info "Build number: auto (eas.json appVersionSource=remote + autoIncrement)"

if [ -z "$DO_SUBMIT" ]; then
  DO_SUBMIT="$(prompt_yes_no "Submit to store after build?" "yes")"
fi
if [ -z "$DO_WAIT" ]; then
  DO_WAIT="$(prompt_yes_no "Wait for build to finish?" "yes")"
fi

# ── Build the eas command ────────────────────────────────────────────────────
case "$PLATFORM" in
  both)    EAS_PLATFORM="all" ;;
  ios)     EAS_PLATFORM="ios" ;;
  android) EAS_PLATFORM="android" ;;
esac

# shellcheck disable=SC2206  # EAS_BIN is an intentional multi-word prefix
CMD=(env EAS_BUILD_NO_EXPO_GO_WARNING=true $EAS_BIN build --platform "$EAS_PLATFORM" --profile production)
[ "$DO_SUBMIT" = "yes" ] && CMD+=(--auto-submit)
[ "$DO_WAIT" = "no" ]    && CMD+=(--no-wait)

# ── Confirm ──────────────────────────────────────────────────────────────────
echo "── summary ────────────────────────────────────────────────────"
echo "  platforms : $PLATFORM  (eas --platform $EAS_PLATFORM)"
echo "  version   : $RESOLVED_VERSION  (marketing; build number auto)"
echo "  profile   : production"
echo "  submit    : $DO_SUBMIT"
echo "  wait      : $DO_WAIT"
echo "  command   : ${CMD[*]}"
echo "───────────────────────────────────────────────────────────────"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "DRY RUN — would run (from $MOBILE):"
  echo "  ${CMD[*]}"
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  confirm="$(prompt_yes_no "Proceed with the release?" "no")"
  [ "$confirm" = "yes" ] || die "aborted."
fi

# ── Execute ──────────────────────────────────────────────────────────────────
echo "▶ running from $MOBILE: ${CMD[*]}"
( cd "$MOBILE" && "${CMD[@]}" )
echo
echo "✅ release kicked off. Track builds + submissions at:"
echo "   $EAS_DASHBOARD"
