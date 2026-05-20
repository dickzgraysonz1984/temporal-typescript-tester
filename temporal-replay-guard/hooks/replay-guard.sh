#!/usr/bin/env bash
# PreToolUse hook for temporal-replay-guard.
#
# Fires before every Bash tool call. The script inspects the command and
# only acts on `git push ...` invocations whose commits touch workflow
# code. On replay failure it blocks the push by exiting 2 with the replay
# output on stderr; that stderr is fed back to Claude as additional
# context, which triggers the replay-fix-diagnostician subagent via its
# description-based auto-invocation.
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

REPLAY_SCRIPT="${CLAUDE_PLUGIN_ROOT:-$repo_root/temporal-replay-guard}/replay-test.ts"
if [[ ! -f "$REPLAY_SCRIPT" ]]; then
  log "skip: $REPLAY_SCRIPT not found"
  echo "temporal-replay-guard: $REPLAY_SCRIPT not found; skipping." >&2
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

log "running: ts-node $REPLAY_SCRIPT (upstream=${upstream:-<none>})"
start_ts=$(date +%s)
if [[ -x "$repo_root/node_modules/.bin/ts-node" ]]; then
  output=$("$repo_root/node_modules/.bin/ts-node" "$REPLAY_SCRIPT" 2>&1)
else
  output=$(npx --no-install ts-node "$REPLAY_SCRIPT" 2>&1)
fi
status=$?
duration=$(( $(date +%s) - start_ts ))

if [[ $status -eq 0 ]]; then
  log "pass: replay test passed in ${duration}s"
  exit 0
fi
log "FAIL: replay test failed in ${duration}s (exit=$status) — blocking push"

# Failure: block the push. stderr on exit 2 is surfaced to Claude as
# additionalContext for the PreToolUse decision. We deliberately do NOT
# name a skill or subagent here — we just report the failure cleanly.
# The replay-fix-diagnostician subagent's description auto-matches on
# "NonDeterminismError" / "replay test failed" and Claude will delegate
# to it, keeping the heavy doc-fetch + classification work out of the
# main conversation.
{
  echo "Temporal replay test FAILED — push blocked."
  echo ""
  echo "The commits being pushed would cause a NonDeterminismError when"
  echo "in-flight workflow executions resume against this code."
  echo ""
  echo "------- replay test output -------"
  echo "$output"
  echo "----------------------------------"
  echo ""
  echo "Diagnose this replay test failure and propose a backward-compatible"
  echo "fix. Do not retry the push until the fix passes \`npm run test:replay\`."
} >&2

exit 2
