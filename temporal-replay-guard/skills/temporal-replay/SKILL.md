---
name: temporal-replay
description: Standing knowledge for working with Temporal TypeScript workflows in a project that uses replay testing. Loads when editing files under `src/workflows/`, importing from `@temporalio/workflow`, modifying activity signatures, writing or running replay tests, or discussing in-flight workflow safety. Tells Claude how to write changes that won't break replay, and when to delegate to the `replay-fix-diagnostician` subagent.
---

# Temporal Replay Safety

This project uses replay testing to guarantee that workflow code changes
are safe for in-flight executions. Every `git push` runs the bundled
replay test against cached histories under `histories/`; a failure
blocks the push.

Your job is to keep replay green. That means two things:

1. **While editing workflow code** — write changes that don't break
   replay in the first place.
2. **When replay fails** — do not diagnose it inline. Delegate to the
   `replay-fix-diagnostician` subagent.

## Rule 1: Workflow code must be deterministic

Inside any function under `src/workflows/`:

- **Never** call `Date.now()`, `new Date()` without an argument,
  `Math.random()`, `crypto.randomUUID()`, `setTimeout`, `setInterval`,
  `fetch`, or any `fs.*`.
- **Use workflow APIs instead:** `workflow.now()`, `workflow.random()`,
  `workflow.sleep()`, `workflow.sideEffect()`.
- **Never iterate** over `Set` or `Map` without first sorting the keys.
- **Never import activity code directly.** Use
  `proxyActivities<typeof activities>()`.
- **All side effects belong in activities**, and activities must be
  idempotent.

## Rule 2: Changes that alter the command graph need a patch

Adding, removing, or reordering any of these in a workflow alters its
command sequence and will break replay for in-flight executions:

- Activity calls (`proxyActivities` invocations)
- Timers (`workflow.sleep`)
- Child workflows (`startChild`, `executeChild`)
- Signal / query / update handlers
- `condition()` calls

If the change is unavoidable, gate it with `workflow.patched()`:

```ts
if (workflow.patched('<semantic-change-id>')) {
  // new behavior
} else {
  // old behavior — kept for in-flight workflows
}
```

Patch ID rules: lowercase, hyphenated, semantically meaningful, never
reused. `switch-to-greet-v2`, not `patch-1`.

## Rule 3: When replay fails, delegate

If you encounter any of:

- A `NonDeterminismError` during `npm run test:replay`
- A blocked `git push` from the temporal-replay-guard hook
- "Command type mismatch" / "Nondeterministic workflow" /
  "history event is not expected" from a Temporal worker

**Do not** diagnose it inline. The full diagnostic procedure involves
fetching two large Temporal docs, reading history-event indices, and
classifying against five violation patterns — that work belongs in a
subagent so it doesn't crowd the main conversation.

Delegate to the `replay-fix-diagnostician` subagent. It will return a
structured diagnosis and a concrete diff. You then discuss the diff
with the user, apply it, and re-run `npm run test:replay` to verify.

## Rule 4: Histories are sacred

Files under `histories/` represent real running workflow executions.
**Never** suggest deleting them as a "fix." If a history is failing
replay, the workflow code is wrong, not the history.

## Verifying changes locally

Before pushing, run:

```bash
npm run test:replay
```

Must pass against **every** history file. A single failure means at
least one in-flight execution would crash.

## When the change is too big for a patch

If the change is structural (whole new state machine, totally different
activity set), `patched()` becomes unwieldy. Surface **Worker
Versioning** to the user as an option — but do not design that rollout
yourself. Let the subagent fetch the latest versioning doc and let the
user decide.
