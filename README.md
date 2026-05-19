# Temporal - Claude Code Demo

This repo demonstrates how a developer can use Claude Code in their daily development with Temporal. It walks through the `temporal-replay-guard` plugin: long-running Workflows are kept alive while Claude Code edits the workflow source, and a git hook blocks pushes whose edits would break replay against the in-flight histories.

## Prerequisites

In order to run this demo you will need the following:
1. [Node.js 22](https://nodejs.org/en/download) (via your package manager, [nvm](https://github.com/nvm-sh/nvm), or the official installer).
1. [Temporal CLI](https://docs.temporal.io/cli#install) (`brew install temporal`, the install script, or a release binary).
1. [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/setup) (`npm install -g @anthropic-ai/claude-code` once Node.js is installed).

### Optionally: Nix + direnv (The real 10x Eng)

This repo ships a `flake.nix` that provisions all three into a dev shell, plus an `.envrc` containing `use flake` so [direnv](https://direnv.net/) can load it automatically when you `cd` into the directory.

You will need the following:
1. [Nix](https://nixos.org/download/) with [flakes enabled](https://nixos.wiki/wiki/Flakes#Enable_flakes_temporarily) (add `experimental-features = nix-command flakes` to `~/.config/nix/nix.conf`). NixOS users already have Nix installed.
1. [direnv](https://direnv.net/docs/installation.html), with its [shell hook](https://direnv.net/docs/hook.html) installed in your `~/.bashrc` / `~/.zshrc`.
1. [nix-direnv](https://github.com/nix-community/nix-direnv) (recommended) so `use flake` is cached in `.direnv/` and shell entry is fast.

First-time setup:

```bash
direnv allow   # one-time approval of .envrc; pulls the flake and builds the dev shell — installs Node.js 22, Temporal CLI, and Claude Code
```

After that, `cd`-ing into the project drops you into the dev shell automatically; `.direnv/` caches the build (and is git-ignored).

If you'd rather not use direnv, run `nix develop` manually to enter the same shell.

Verify with `node --version`, `temporal --version`, and `claude --version` before moving on.

## Running the demo

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/dickzgraysonz1984/temporal-typescript-tester.git
   cd temporal-typescript-tester
   npm install
   ```

1. In one shell, start the local Temporal dev server:

   ```bash
   temporal server start-dev
   ```

1. In a second shell, start a Temporal Worker:

   ```bash
   npm run start.watch
   ```

1. In a third shell, launch 5 long-running Workflows wired up for the Claude demo:

   ```bash
   npm run workflows -- 5
   ```

1. In a fourth shell, start Claude Code with the replay-guard plugin loaded:

   ```bash
   IS_DEMO=1 claude --plugin-dir ./temporal-replay-guard
   ```

   > **Why `IS_DEMO=1`?** It tells Claude Code to hide your email address and organization name from the UI. That's a nice trick for live demos, screenshares, and recorded sessions — you can show off the tool without redacting frames in post or accidentally leaking which org you work for.

1. Confirm the plugin loaded before running the demo prompts:

   - Run `/plugins` and check the **Installed** tab — you should see `temporal-replay-guard`.
   - Run `/temporal-replay-guard:replay-check` to manually replay the cached histories and verify the test harness works end-to-end.

1. At the Claude Code prompt, ask it to modify the Workflow:

   > update the example workflow in src/workflows.ts. add `await sleep('10 sec')` before the first `greet()`

1. Once the edit is applied, send the follow-up prompt:

   > commit and push

   The `PreToolUse` hook installed by `temporal-replay-guard` intercepts the `git push`, runs the replay test against the in-flight histories from the workflows shell, and blocks the push if the change would cause non-determinism errors. The bundled `fix-replay-issue` skill is then invoked automatically to propose a backward-compatible fix (typically `workflow.patched()`).

## How to reset the demo

Here is the original workflow code you can copy and paste in:

```ts
import { proxyActivities, sleep, patched } from '@temporalio/workflow';
// Only import the activity types
import type * as activities from './activities';

const { greet } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

/** A workflow that simply calls an activity */
export async function example(name: string): Promise<string> {
  await greet(name);
  await sleep('2 min');
  return await greet(name);
}
```

Another handy tip: don't commit the changes. When Claude Code reaches the patched-fix commit step and asks for approval — something like:

```sh
git add src/workflows.ts && git commit -m "$(cat <<'EOF'
Guard new leading sleep with workflow.patched()

The previous commit added await sleep('10 sec') before the first greet(),
which broke replay for in-flight workflows (Timer command where history
expected ActivityTaskScheduled). Gate the sleep behind
patched('add-leading-10s-sleep') so existing executions take the old path
and only fresh workflows get the leading delay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> Commit patched fix
>
> Do you want to proceed?

…you can exit out instead of approving. That way the changes never land on GitHub and you keep a clean demo repo.
