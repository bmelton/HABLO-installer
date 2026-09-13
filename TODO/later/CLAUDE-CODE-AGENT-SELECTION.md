# Choose the coding agent at install time

> Status: design settled, not implemented. Part of
> [CLAUDE-CODE.md](CLAUDE-CODE.md). Land this before any other Claude Code work,
> because every other document writes into a step this one makes conditional.

- [ ] Add `defaults.agent` to `hablo.json`
- [ ] Move the Pi-only manifest keys under an `agents.pi` block, add `agents.claude`
- [ ] Add the `--agent pi|claude|both` flag and the usage header line
- [ ] Write the detection helper (`pi` and `claude` on PATH, with versions)
- [ ] Write the interactive prompt, TTY-gated, pre-selecting the resolved default
- [ ] Make steps 1, 2, 3, 4, 7, 8, 9, 10, 11 agent-conditional
- [ ] Refuse `--ladder oss` together with `--agent claude`, and say why
- [ ] Record the chosen agent in the uninstall receipt
- [ ] Tag every created artifact in the receipt with the agent that owns it
- [ ] Update the `Done` footer to print the right next-step commands per agent
- [ ] `README.md`: the flag, the prompt, and the per-agent step table

## What this is

`install.mjs` assumes Pi. This feature makes the agent an axis: a flag, a
prompt, and a manifest default, resolved once at the top of the run and read by
every step after it.

## The prompt

The installer asks once, before step 1:

```
Which coding agent would you like to use?
  1) Pi Coding Agent (already installed)
  2) Claude Code (already installed)
  3) Both
```

The `(already installed)` suffix appears per line, only when the binary resolves
on PATH. Detection is the existing `which()` helper against `pi` and `claude`,
and the version string comes from `--version` on each, the same way step 1
already reports `pi` and `aws`.

## Resolution order

One rule, applied in order, so a script never blocks and a human is never
surprised:

1. `--agent pi|claude|both` on the command line wins.
2. Otherwise, if stdin is a TTY, ask. The resolved default is pre-selected, so
   pressing Return keeps today's behavior.
3. Otherwise, use `defaults.agent` from `hablo.json`.

**Decision: `defaults.agent` is `pi`.** A bare `./install.sh` in a script keeps
doing exactly what it does today. The prompt is what changes for a human, and
the prompt's default answer is the same value.

**Decision: the prompt is not skippable by a separate flag.** `--agent` already
skips it. A second `--no-prompt` spelling would be one more thing to document
and one more path to test.

## Manifest shape

`hablo.json` holds Pi's package list, settings, and `enabledModels` at the top
level today. Those are agent-specific and the Claude Code equivalents are not
the same keys, so they move:

```jsonc
{
  "defaults": { "agent": "pi", "profile": "bedrouter", "ladder": "oss" },
  "agents": {
    "pi":     { "cliPackage": "@earendil-works/pi-coding-agent", "packages": [...], "enabledModels": [...], "settings": {...} },
    "claude": { "cliPackage": "@anthropic-ai/claude-code", "marketplace": "~/.hablo/claude", "plugin": "hablo", "settings": {...} }
  },
  "bedrouter": { ... },
  "firstmate": { ... },
  "cli": { ... },
  "backup": { ... }
}
```

`bedrouter`, `firstmate`, `cli` and `backup` stay where they are. They describe
shared machinery, and both agents use it.

**Decision: move the keys rather than add a parallel block.** An `agents.pi`
block that duplicates a top-level `pi` block would let the two disagree. The
move is a breaking manifest change, so the installer reads the old shape once,
warns, and tells the reader to update the file.

## What each step does with the value

The table in [CLAUDE-CODE.md](CLAUDE-CODE.md) is the summary. The rules that
are not obvious from it:

**Step 1 preflight.** Each selected agent gets its own presence check and its
own install path. `--install-pi` keeps its name and gains `--install-claude`,
with the same manager detection. Claude Code also ships a native installer, so
the failure message names both routes.

**Step 2 packages.** Claude Code runs no part of this step. Say so in the log
rather than printing nothing, because a silent step reads as a bug.

**Steps 5 and 6, aws and probe.** Shared, and run once even with
`--agent both`. Both agents read the same `~/.bedrouter/bedrouter.json`.

**Step 11 tools.** The `*-axi setup hooks` step is skipped today because it
installs Claude Code session hooks that Pi does not read. With Claude Code
selected, it runs. With `--agent both`, it runs, and the note explains that the
hooks serve the Claude Code side only.

## The ladder conflict

bedrouter serves `auto` for the `oss` ladder over `/v1/chat/completions`, which
Claude Code does not speak. `defaults.ladder` is `oss` today, so a bare
`./install.sh --agent claude` would configure a model the agent cannot call.

**Decision: silence when the ladder is a default, refusal when it is a choice.**

- `--agent claude` with no `--ladder` uses the `claude` ladder for the Claude
  Code side and prints one line saying so.
- `--agent claude --ladder oss` fails before step 1 with a message that names
  the endpoint mismatch.
- `--agent both --ladder oss` configures Pi on `oss` and Claude Code on
  `claude`, and prints both.

The reason for the split: a manifest default is the installer's opinion, and
changing an opinion needs a log line. An explicit flag is the operator's
instruction, and quietly doing something else with it is worse than stopping.

## Receipt

[UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) writes a
receipt of what the installer created. With two agents, every entry needs an
`agent` field, and the receipt needs the resolved agent for the run.

Without the tag, an uninstall on a `--agent both` machine cannot answer the only
question that matters: did HABLO create this, and for which agent? The scope
flags in that document gain an agent filter as a result.

## Open questions

- `--agent both` on a machine where the two disagree about the ladder produces
  two `autoSelect` values from one `bedrouter.json`. The probe rewrites that one
  file. Confirm that dropping an `openai` rung never disturbs an `anthropic`
  class, and the reverse.
- Should re-running the installer with a different `--agent` value remove the
  previous agent's artifacts? The safe answer is no, and the receipt makes an
  explicit `uninstall --agent pi` possible. Decide before the receipt lands.
- The prompt lists three options. Does a fourth, "neither, shared machinery
  only", have a real user? It would install bedrouter, firstmate and the tools
  with no agent configuration at all.
