# temporal-replay-guard

Claude Code plugin that blocks `git push` in TypeScript Temporal projects
when the commits being pushed would cause non-determinism errors for
in-flight workflow executions, and invokes a skill that fetches the latest
Temporal versioning and testing docs to guide a backward-compatible fix.

## How it works

A `PreToolUse` hook intercepts `git push` invocations, diffs the pushed
commits against upstream, and — if any touch workflow code — runs the
bundled replay test against histories under `histories/`. A failure blocks
the push (`exit 2`) and feeds the replay output back to Claude as
additional context, which then invokes the `fix-replay-issue` skill to
propose a fix (typically `workflow.patched()`).

## Host requirements

The plugin runs the host repo's workflows against its own Temporal SDK
install — there is no way to fully decouple it. The host must have:

- `ts-node` available (devDependency, or globally resolvable via `npx`).
- `@temporalio/{worker,client,common,proto,envconfig}` resolvable from the
  repo root.
- A workflows entry point. Defaults to `<repo>/src/workflows`; override
  with `REPLAY_WORKFLOWS_PATH`.
- A `histories/` directory at the repo root for cached history JSON files.
  Override with `REPLAY_HISTORIES_DIR`. If the directory is empty (or
  `REPLAY_FORCE_DOWNLOAD=1`), the script downloads up to
  `REPLAY_HISTORIES_COUNT` histories from Temporal using the connection
  settings from `@temporalio/envconfig`.

The auto-hook needs no host `package.json` script — it invokes
`ts-node $CLAUDE_PLUGIN_ROOT/replay-test.ts` directly.

## Manual invocation

The bundled `/replay-check` slash command and the `fix-replay-issue` skill
both expect a `test:replay` script in the host's `package.json`. Add:

```json
"scripts": {
  "test:replay": "ts-node ~/.claude/plugins/<vendor>/temporal-replay-guard/replay-test.ts"
}
```

Adjust the path to match where Claude Code installed the plugin. (For
in-tree development against this repo, the path is
`temporal-replay-guard/replay-test.ts`.)

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `REPLAY_HISTORIES_DIR` | `$PWD/histories` | Directory of cached history JSON files. |
| `REPLAY_WORKFLOWS_PATH` | `src/workflows` | Workflows entry point (resolved against the repo root, extension auto-detected). |
| `REPLAY_HISTORIES_COUNT` | `5` | Histories to fetch when the cache is empty or being refreshed. |
| `REPLAY_RUNNING_QUERY` | `ExecutionStatus='Running'` | List filter for the primary download pass. |
| `REPLAY_COMPLETED_QUERY` | `ExecutionStatus='Completed'` | Fallback list filter when fewer than `COUNT` running workflows are found. |
| `REPLAY_FORCE_DOWNLOAD` | unset | Set to `1` to ignore the cache and re-download. |
