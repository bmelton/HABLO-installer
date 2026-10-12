---
description: Run a ticket through triage → spec → tests → implement → review (HABLO pipeline)
argument-hint: <ticket text or Jira key>
---

Run the HABLO ticket pipeline for:

$ARGUMENTS

Use the HABLO subagents in order (spawn each with the Task / agent tool as available):

1. **product-triage** — is the ticket actionable? If not, return questions and stop.
2. **software-architect** — implementation spec (OpenWiki first).
3. **test-author** — black-box tests from requirements + spec.
4. **implementer** — implement the spec; do not weaken tests.
5. **ui-reviewer** and **perf-reviewer** in parallel when UI or scale is in scope; otherwise skip with a note.
6. Fix until reviewers approve or the round cap (3) is hit; summarize remaining issues.

Standing HABLO duties still apply: OpenWiki-first orientation, exact Jira keys, commit/PR → `hablo-jira` progress (hooks soft-fail). When `interrogate` is enabled for the captain, complete or explicitly skip the TDD interview before spawning implementers.

If workflow scripts are unavailable, run this sequence inline with the same gates.
