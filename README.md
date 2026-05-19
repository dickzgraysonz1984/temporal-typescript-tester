# Hello World

This is the default project that is scaffolded out when you run `npx @temporalio/create@latest ./myfolder`.

The [Hello World Tutorial](https://learn.temporal.io/getting_started/typescript/hello_world_in_typescript/) walks through the code in this sample.

### Development environment (Nix + direnv)

This repo ships a `flake.nix` that provisions Node.js 22, the Temporal CLI, and Claude Code into a dev shell, plus an `.envrc` containing `use flake` so [direnv](https://direnv.net/) can load it automatically when you `cd` into the directory.

Prerequisites:

1. [Nix](https://nixos.org/download/) with [flakes enabled](https://nixos.wiki/wiki/Flakes#Enable_flakes_temporarily) (add `experimental-features = nix-command flakes` to `~/.config/nix/nix.conf`).
1. [direnv](https://direnv.net/docs/installation.html), with its [shell hook](https://direnv.net/docs/hook.html) installed in your `~/.bashrc` / `~/.zshrc`.
1. [nix-direnv](https://github.com/nix-community/nix-direnv) (recommended) so `use flake` is cached in `.direnv/` and shell entry is fast.

First-time setup:

```bash
direnv allow   # one-time approval of .envrc; pulls the flake and builds the dev shell
```

After that, `cd`-ing into the project drops you into the dev shell automatically; `.direnv/` caches the build (and is git-ignored).

If you'd rather not use direnv, run `nix develop` manually to enter the same shell.

### Running this sample

1. `temporal server start-dev` to start [Temporal Server](https://github.com/temporalio/cli/#installation).
1. `npm install` to install dependencies.
1. `npm run start.watch` to start the Worker.
1. In another shell, `npm run workflow` to run a single Workflow, or `npm run workflows -- <count>` to start multiple Workflows in parallel (e.g. `npm run workflows -- 5`). The `--` is required so npm forwards the count to the script.

The Workflow should return:

```bash
Hello, Temporal!
```
