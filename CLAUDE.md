# temporal-typescript-tester

Demo repo for the `temporal-replay-guard` Claude Code plugin. Long-running Temporal workflows run while Claude edits workflow source; a `git push` hook blocks any change that would break replay for in-flight executions.

## Repo layout

```
src/                        Host repo — Temporal worker, client, and workflows
  workflows.ts              The workflow under edit during the demo
  activities.ts
  worker.ts / client.ts
histories/                  Cached workflow history JSON files (used by replay test)
temporal-replay-guard/      The plugin
  hooks/                    PreToolUse hook — intercepts git push, runs replay test
  agents/                   replay-fix-diagnostician subagent
  skills/temporal-replay/   Standing knowledge for editing workflow code
  commands/                 /replay-check slash command
  replay-test.ts            Replay test runner (245 lines, TypeScript)
  .claude-plugin/plugin.json
BUILD_YOUR_OWN_PLUGIN.md    One-page guide for engineers building their own plugin
```

## Key commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run start.watch` | Start Temporal worker (nodemon) |
| `npm run workflows -- 5` | Launch 5 demo workflows |
| `npm run test:replay` | Run replay test against `histories/` |
| `npm run histories:download` | Force-download fresh histories from Temporal server |
| `temporal server start-dev` | Start local Temporal dev server |

## Running the demo

Four shells required (in order):

1. `temporal server start-dev`
2. `npm run start.watch`
3. `npm run workflows -- 5`
4. `IS_DEMO=1 claude --plugin-dir ./temporal-replay-guard`

Then ask Claude to modify the workflow and commit + push. The hook will block the push if the change introduces a non-determinism violation.

## Plugin entry points

- **Hook** fires automatically on `git push` — no user action needed.
- **`/temporal-replay-guard:replay-check`** — manual replay run.
- **`replay-fix-diagnostician` subagent** — spawned automatically when replay fails; fetches live Temporal docs and proposes a fix.
- **`temporal-replay` skill** — auto-loads when editing files under `src/workflows/`.

## Environment variables (replay test)

| Variable | Default | Purpose |
|---|---|---|
| `REPLAY_HISTORIES_DIR` | `$PWD/histories` | Cached history JSON files |
| `REPLAY_WORKFLOWS_PATH` | `src/workflows` | Workflows entry point |
| `REPLAY_FORCE_DOWNLOAD` | unset | Set to `1` to re-download histories |
| `IS_DEMO=1` | unset | Hides email/org from Claude Code UI |
