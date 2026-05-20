# temporal-replay-guard

Claude Code plugin that blocks `git push` in TypeScript Temporal projects
when the commits being pushed would cause non-determinism errors for
in-flight workflow executions, and delegates the fix to a dedicated
diagnostician subagent that fetches the latest Temporal versioning and
testing docs.

## Architecture

The plugin uses three Claude Code primitives, each doing the job it's
best at:

| Primitive | File | Role |
|---|---|---|
| **Hook** | `hooks/replay-guard.sh` | The *when*. Fires on `git push`, runs the replay test, blocks on failure with the output on stderr. |
| **Subagent** | `agents/replay-fix-diagnostician.md` | The *isolated worker*. Fetches live Temporal docs, classifies the violation, returns a structured diagnosis + suggested diff. Heavy work happens in its own context. |
| **Skill** | `skills/temporal-replay/SKILL.md` | The *standing knowledge*. Auto-loads while editing workflow code. Teaches Claude the determinism rules and when to delegate to the subagent. |
| **Slash command** | `commands/replay-check.md` | Manual entry point. Runs `npm run test:replay` and delegates to the subagent on failure. |

### Why this split?

The earlier version put the entire diagnostic procedure — doc fetches,
classification, diff drafting — inside the skill. That worked but
pulled two large Temporal markdown files plus source-file analysis into
the main conversation every time replay failed. Moving that work to a
subagent keeps the main conversation focused on *applying* the fix, not
researching it.

### How it works end-to-end

1. You write workflow code. The `temporal-replay` **skill** is loaded
   because you're editing under `src/workflows/`. Claude knows the
   determinism rules.
2. You `git push`. The `replay-guard.sh` **hook** intercepts, diffs
   pushed commits against upstream, and runs the replay test if
   workflow files changed.
3. If replay fails, the hook exits 2 with the failure output on
   stderr. The push is blocked.
4. That stderr is fed back to Claude as additional context. The
   `replay-fix-diagnostician` **subagent**'s description matches on
   "NonDeterminismError" / "replay test FAILED" and Claude delegates
   to it.
5. The subagent fetches live docs, reads the workflow source,
   classifies the violation, and returns a structured report with a
   concrete diff.
6. You and the main Claude discuss and apply the fix, then re-run
   `npm run test:replay` and push again.

## Host requirements

The plugin runs the host repo's workflows against its own Temporal SDK
install — there is no way to fully decouple it. The host must have:

- `ts-node` available (devDependency, or globally resolvable via `npx`).
- `@temporalio/{worker,client,common,proto,envconfig}` resolvable from
  the repo root.
- A workflows entry point. Defaults to `<repo>/src/workflows`; override
  with `REPLAY_WORKFLOWS_PATH`.
- A `histories/` directory at the repo root for cached history JSON
  files. Override with `REPLAY_HISTORIES_DIR`. If the directory is
  empty (or `REPLAY_FORCE_DOWNLOAD=1`), the script downloads up to
  `REPLAY_HISTORIES_COUNT` histories from Temporal using the connection
  settings from `@temporalio/envconfig`.

The auto-hook needs no host `package.json` script — it invokes
`ts-node $CLAUDE_PLUGIN_ROOT/replay-test.ts` directly.

## Manual invocation

The bundled `/replay-check` slash command and the
`replay-fix-diagnostician` subagent both expect a `test:replay` script
in the host's `package.json`. Add:

```json
"scripts": {
  "test:replay": "ts-node ~/.claude/plugins/<vendor>/temporal-replay-guard/replay-test.ts"
}
```

Adjust the path to match where Claude Code installed the plugin.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `REPLAY_HISTORIES_DIR` | `$PWD/histories` | Directory of cached history JSON files. |
| `REPLAY_WORKFLOWS_PATH` | `src/workflows` | Workflows entry point (resolved against the repo root, extension auto-detected). |
| `REPLAY_HISTORIES_COUNT` | `5` | Histories to fetch when the cache is empty or being refreshed. |
| `REPLAY_RUNNING_QUERY` | `ExecutionStatus='Running'` | List filter for the primary download pass. |
| `REPLAY_COMPLETED_QUERY` | `ExecutionStatus='Completed'` | Fallback list filter when fewer than `COUNT` running workflows are found. |
| `REPLAY_FORCE_DOWNLOAD` | unset | Set to `1` to ignore the cache and re-download. |
