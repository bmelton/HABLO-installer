---
description: Run a HABLO review round (UI + perf) and fix until approved
argument-hint: <what changed / PR summary>
---

Review and fix round for:

$ARGUMENTS

1. Spawn **ui-reviewer** and **perf-reviewer** (read-only) against the current changes.
2. Collect findings; have **implementer** fix only what the reviewers require.
3. Re-review until approved or 3 rounds elapse; report leftovers.

Use OpenWiki for orientation. Do not modify tests to silence failures.
