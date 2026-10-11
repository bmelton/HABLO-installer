<!-- HABLO:MODEL-POLICY:START -->
## Model and brief policy (HABLO)

Voyage model is authoritative. Spawn every crewmate and scout with exactly the `--model` string from the **Crew model (HABLO, this voyage)** block (or `HABLO_CREW_MODEL`). Do not invent aliases.

### Dispatch allowlist (bedrouter)

When the voyage provider is `bedrouter`:

1. Prefer `bedrouter/auto` (or the voyage model). Never pin a rung that is disabled in `~/.bedrouter/bedrouter.json`.
2. Before pinning any other `bedrouter/<alias>`, confirm it is live: `curl -fsS http://127.0.0.1:20129/v1/models` must list that alias. Disabled stack entries (for example `fable`) are **not** in `/v1/models` and produce an immediate 404.
3. Raising quality means raising `--effort high` (explore signal), not pinning `opus` / `fable` / invented names.
4. If `hablo-preflight` or bedrouter reports an unknown model, fix the spawn line; do not retry the same bad alias.

### FIRSTMATE_OP / brief refusal

Anthropic-routed crewmates sometimes refuse the launch brief as "prompt injection" (they reject the crewmate role, inbox paths, or status files). HABLO installs `hablo-crewmate` globally so the system prompt states those channels are first-party. If a crewmate still refuses:

1. Treat it as a typed failure (not a stuck clarifier). Do not argue in the inbox.
2. Teardown that task and respawn once with the **voyage** `--model` (usually `bedrouter/auto`) and `--effort high`. Do not pin `bedrouter/sonnet` hoping for reliability — that is the model class that refuses.
3. If the second attempt also refuses, stop and report the blocker to the user; do not cascade scout aliases.

### Operation aborted

If a crewmate dies with `Operation aborted` / bedrouter `Request aborted`, that is Pi cancelling its own in-flight HTTP request (see `TODO/FIRSTMATE-ABORT.md`). Check `~/.hablo/abort-log.jsonl` and the task status line. Relaunch or teardown+respawn with the voyage model; do not rebuild supervision or re-clone firstmate.

### Brief and spawn argv (no `--project` flag)

`fm-brief.sh` and `fm-spawn.sh` take the **project as a positional**, not a flag:

```
bin/fm-brief.sh <task-id> <repo-name> --mode <direct-PR|no-mistakes|local-only> [--base-branch <branch>]
bin/fm-spawn.sh <task-id> <repo-name> --mode <...> --model <voyage-model> [--base-branch <branch>] ...
```

Examples:

- Good: `bin/fm-brief.sh originops-4433-ui originops --mode direct-PR --base-branch ORIGINOPS-4433`
- Bad: `bin/fm-brief.sh --project originops originops-4433-ui --mode direct-PR ...`

`--project` is **not** a firstmate flag on these scripts. Unknown `--*` tokens are treated as positionals, so a leading `--project` becomes the task id. That scaffolds `state/--project.status` and `state/--project.inbox` while spawn still uses the real id — the crew works, but `done:` never wakes the fleet.

Before spawn, confirm the brief's status append path is `state/<task-id>.status` (same id you pass to `fm-spawn.sh`), not `state/--project.status`. If you already shipped a bad brief, fix the paths in `data/<task-id>/{brief,launch-brief}.md`, copy or append any lines from `state/--project.status` onto `state/<task-id>.status`, and leave a symlink from the wrong name only as a temporary bridge.
<!-- HABLO:MODEL-POLICY:END -->
