---
description: Run the Temporal replay test manually against stored workflow histories. If it fails, the fix-replay-issue skill will be invoked automatically.
---

Run `npm run test:replay` from the repository root.

- If it passes, report which histories were exercised and confirm the workflow code is safe to push.
- If it fails, invoke the `fix-replay-issue` skill from this plugin to diagnose the failure against the live Temporal versioning and testing docs, and propose a backward-compatible fix.

If `histories/` is empty, the script will try to auto-download up to 5 running workflow histories from Temporal — see `histories/README.md` for how that works and how to configure it.
