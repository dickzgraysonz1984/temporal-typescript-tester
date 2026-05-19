#!/usr/bin/env bash
# PreToolUse hook for temporal-replay-guard.
#
# Fires before every Bash tool call. The script inspects the command and
# only acts on `git push ...` invocations whose commits touch workflow
# code. On replay failure it blocks the push by exiting 2 with guidance
# on stderr.
#
# Output contract:
#   exit 0           -> allow tool call
#   exit 2 + stderr  -> block, stderr is fed back to Claude as context
#   exit other       -> non-blocking error (tool call still proceeds)

set -uo pipefail

LOG_FILE=""
log() {
  [[ -n "$LOG_FILE" ]] || return 0
  printf '%s [pid=%s] %s\n' "$(date -Iseconds)" "$$" "$*" >> "$LOG_FILE"
}

input=$(cat || true)

# Need jq to parse the PreToolUse payload. Without it, fail open
# (better to allow the push than to block on a missing dep).
if ! command -v jq >/dev/null 2>&1; then
  echo "temporal-replay-guard: jq not found; skipping replay check." >&2
  exit 0
fi

command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Only act on `git push ...`. Word-boundary match so we don't fire on
# things like `git push-options` or `cat git_push.log`.
if ! [[ "$command" =~ (^|[[:space:];\&|])git[[:space:]]+push([[:space:]]|$) ]]; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [[ -z "$repo_root" ]]; then
  exit 0
fi
cd "$repo_root"

mkdir -p "$repo_root/.claude" 2>/dev/null && LOG_FILE="$repo_root/.claude/replay-guard.log"
log "fired: command=$(printf '%s' "$command" | head -c 200)"

# The replay test script handles the empty-histories case by auto-
# downloading from Temporal, so we don't pre-check histories/ here.
if [[ ! -f scripts/replay-test.ts ]]; then
  log "skip: scripts/replay-test.ts not found"
  echo "temporal-replay-guard: scripts/replay-test.ts not found; skipping." >&2
  exit 0
fi

# Determine the baseline to diff against. Prefer the configured upstream;
# fall back to common remote defaults for branches without one yet.
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
if [[ -z "$upstream" ]]; then
  for ref in origin/HEAD origin/main origin/master; do
    if git rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then
      upstream="$ref"
      break
    fi
  done
fi

# Skip the replay if the commits being pushed don't touch workflow code.
# If we can't establish a baseline at all, run the check anyway — safer
# to test than to silently skip.
if [[ -n "$upstream" ]]; then
  changed=$(git diff --name-only "$upstream"..HEAD 2>/dev/null || true)
  if [[ -n "$changed" ]] && ! printf '%s\n' "$changed" \
      | grep -qE '(^|/)src/workflows(\.ts$|/)'; then
    log "skip: no workflow changes vs $upstream"
    exit 0
  fi
fi

log "running: npm run test:replay (upstream=${upstream:-<none>})"
start_ts=$(date +%s)
output=$(npm run --silent test:replay 2>&1)
status=$?
duration=$(( $(date +%s) - start_ts ))

if [[ $status -eq 0 ]]; then
  log "pass: replay test passed in ${duration}s"
  exit 0
fi
log "FAIL: replay test failed in ${duration}s (exit=$status) — blocking push"

# Failure: block the push. stderr on exit 2 is surfaced to Claude as
# additionalContext for the PreToolUse decision.
{
  echo "Temporal replay test FAILED. The commits being pushed would cause"
  echo "non-determinism errors when in-flight workflow executions resume"
  echo "against this code."
  echo ""
  echo "------- replay test output -------"
  echo "$output"
  echo "----------------------------------"
  echo ""
  echo "Do not retry the push. Instead, invoke the fix-replay-issue skill"
  echo "from the temporal-replay-guard plugin. The skill will:"
  echo "  1. Diagnose which class of non-determinism the failure represents"
  echo "  2. WebFetch the current testing.md and versioning.md from the"
  echo "     temporalio/skill-temporal-developer repo for fix guidance"
  echo "  3. Propose a backward-compatible fix (usually workflow.patched())"
  echo ""
  echo "After the fix is committed, re-run \`npm run test:replay\` locally"
  echo "and then push again."
} >&2

exit 2
