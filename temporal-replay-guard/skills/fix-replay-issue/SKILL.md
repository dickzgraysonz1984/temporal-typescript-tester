---
name: fix-replay-issue
description: Diagnose a TypeScript Temporal replay-test failure and apply a backward-compatible fix (typically workflow.patched), grounded in the latest Temporal versioning and testing docs fetched live from temporalio/skill-temporal-developer.
---

# Fix Temporal Replay Issue

A replay test failure means the workflow code about to be pushed would produce a `NonDeterminismError` when an in-flight workflow execution resumes against it. Your job is to keep those existing executions safe **and** let the new code run for fresh workflows — almost always with `workflow.patched()`.

Never tell the user to delete histories as a fix. A history in `histories/` represents a real running workflow; deleting it hides the problem rather than solving it.

## Step 1 — Read the failure

You should already have the replay-test output in conversation (the PreToolUse hook fed it back). If not, run:

```bash
npm run test:replay
```

From the output, extract:
- **Which history failed** (file name → workflow ID).
- **The error message.** Useful sub-strings: `NonDeterminismError`, "Command type mismatch", "Nondeterministic workflow", "history event ... is not expected".
- **Roughly where in history** the divergence happened, if reported.

## Step 2 — Pull the live fix guidance

Always fetch these fresh — they change as the Temporal SDK evolves. Do not rely on memory.

- WebFetch `https://raw.githubusercontent.com/temporalio/skill-temporal-developer/main/references/typescript/testing.md` — focus on the **Replay testing** section: what the replayer checks, how to construct multi-history runs, and what to do when only some histories fail.
- WebFetch `https://raw.githubusercontent.com/temporalio/skill-temporal-developer/main/references/typescript/versioning.md` — focus on **`patched()` / `deprecatePatch()`** semantics, when each is safe, and the Worker Versioning option if the change is too large for a patch.

Cite which doc section the user should look at for context, with anchor links.

If either fetch fails, fall back to the canonical docs:
- https://docs.temporal.io/develop/typescript/best-practices/testing-suite#replay
- https://docs.temporal.io/develop/typescript/versioning

## Step 3 — Classify the violation

Match the error to one of these classes (refine using what the docs say):

1. **Command-graph change** — added, removed, or reordered an activity call, timer, child workflow, signal handler, or `condition()`. This is the most common case. → **Fix with `patched()`**.
2. **Branch on `workflowInfo()` / static values that changed** — e.g. namespace, task queue, search attributes affecting control flow. → `patched()` or extract the decision into an activity.
3. **Non-deterministic primitive crept in** — `Date.now()`, `Math.random()`, `Set`/`Map` iteration order, unguarded `await` on non-workflow promises. → Replace with workflow APIs (`workflow.now()`, `workflow.random()`, deterministic structures). No `patched()` needed if the command sequence is unchanged.
4. **Side effect outside an activity** — direct I/O, fetch, fs access in workflow code. → Move into a `proxyActivities` call. May still need `patched()` if it adds a command.
5. **Renamed activity / signal / query** — same logic, different name on the wire. → Either keep the old export name as an alias, or use `patched()` to route old replays to the old name.

## Step 4 — Propose the actual diff

Show the user the concrete code change. Default template for case 1:

```ts
import * as workflow from '@temporalio/workflow';

export async function example(name: string): Promise<string> {
  if (workflow.patched('<short-change-id>')) {
    // New behavior — only runs for fresh workflows or those that have
    // already passed this point in their history.
    return await greetV2(name);
  }
  // Old behavior — kept for in-flight workflows started before the patch.
  return await greet(name);
}
```

Rules for the patch ID:
- Lowercase, hyphenated, semantically meaningful (`switch-to-greet-v2`, not `patch-1`).
- Never reused. Once a patch ID has shipped, it is part of every replayed history forever.

Only suggest `deprecatePatch('<id>')` after the user confirms no live workflows are still on the pre-patch path. The versioning doc has the exact condition; cite it rather than restating from memory.

## Step 5 — Verify

After the user applies the fix:

```bash
npm run test:replay
```

Must pass against **every** history in `histories/`, not just the one that originally failed. If a different history starts failing, the patch is incomplete — there's another in-flight code path that also needs to be preserved.

Once it passes, commit the fix and re-run the push — the hook will no longer block it.

## When the fix is bigger than a patch

If the change is structural (whole new state machine, totally different activity set), `patched()` becomes unwieldy. Point the user at the **Worker Versioning** section of the versioning doc you fetched and discuss whether a versioned task queue is the better tool. Don't try to design that yourself — surface the option and let them decide.
