---
description: Run the Temporal replay test manually against stored workflow histories. If it fails, delegate to the replay-fix-diagnostician subagent for diagnosis.
---

Run `npm run test:replay` from the repository root.

- If it passes, report which histories were exercised and confirm the workflow code is safe to push.
- If it fails, delegate to the `replay-fix-diagnostician` subagent with the full replay output. The subagent will fetch the live Temporal docs, classify the violation, and return a concrete fix proposal. Do not diagnose the failure inline yourself.

If `histories/` is empty, the script will try to auto-download up to 5 running workflow histories from Temporal — see the plugin README for how that works and how to configure it.
