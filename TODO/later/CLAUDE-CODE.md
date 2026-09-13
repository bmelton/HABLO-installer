# Claude Code as a second coding agent

> Status: plan. The decisions below are settled. Each feature has its own
> document; this one holds the order of work and the boundaries between them.
> Nothing is implemented yet.

- [ ] [Agent selection](CLAUDE-CODE-AGENT-SELECTION.md): the install-time prompt, `--agent`, and the per-agent step table
- [ ] [Routing](CLAUDE-CODE-ROUTING.md): Claude Code reaches Bedrock through bedrouter
- [ ] [Plugin](CLAUDE-CODE-PLUGIN.md): agents, commands, skills and workflows as one installable unit
- [ ] [firstmate](CLAUDE-CODE-FIRSTMATE.md): the `claude` crew harness, the permission posture, and the `hablo` wrapper
- [ ] [Guard](CLAUDE-CODE-GUARD.md): the fail-closed tool-call guard on Claude Code hooks
- [ ] `README.md`: a section per agent, and an agent column on the step table
- [ ] End-to-end run on a clean machine with `--agent claude`, then with `--agent both`

## What this is

HABLO configures one coding agent today. This work adds a second, Claude Code,
and reproduces every modification the installer makes for Pi as closely as the
two products allow. A machine can hold one agent or both.

## The decisions

| Question | Decision | Document |
| --- | --- | --- |
| How does Claude Code reach the models? | Through bedrouter, over its Anthropic-shaped `/v1/messages` endpoint | [Routing](CLAUDE-CODE-ROUTING.md) |
| Can both agents live on one machine? | Yes. The prompt picks a default; `--agent both` installs both; `hablo --agent` picks per project | [Agent selection](CLAUDE-CODE-AGENT-SELECTION.md) |
| What replaces `pi/workflows/`? | Workflow scripts, with slash commands as the entry point | [Plugin](CLAUDE-CODE-PLUGIN.md) |
| How do the assets reach `~/.claude`? | One HABLO plugin, registered from a local directory marketplace | [Plugin](CLAUDE-CODE-PLUGIN.md) |
| What replaces `pi-openwiki-adapter`? | A skill that teaches the wiki-first read order over the built-in file tools | [Plugin](CLAUDE-CODE-PLUGIN.md) |
| What permission posture do Claude Code sessions get? | `auto` for crewmates, the normal prompts for a captain | [firstmate](CLAUDE-CODE-FIRSTMATE.md) |
| Does the fail-closed guard ship with this work? | Yes, on native Claude Code hooks | [Guard](CLAUDE-CODE-GUARD.md) |

## What the installer does per agent

Each step keeps its number. The two new columns say which agents run it.

| Step | Pi | Claude Code | Notes |
| --- | --- | --- | --- |
| 1 preflight | `pi` | `claude` | `aws`, `git` and `openwiki` are shared |
| 2 packages | `pi install npm:*` | none | The plugin carries what packages carry for Pi |
| 3 settings | `~/.pi/agent/settings.json` | `~/.claude/settings.json` | Merge-only in both cases |
| 4 bedrouter | `pi-bedrouter.json` | `env` block plus a start hook | Same `~/.bedrouter` for both |
| 5 aws | shared | shared | No change |
| 6 probe | shared | shared | No change |
| 7 agents | `~/.pi/agent/agents`, `~/.pi/workflows` | plugin `agents/`, `commands/`, `workflows` | One prompt body, two front matters |
| 8 fit notes | `workflows.json` | plugin agent `model` fields | Same source, different carrier |
| 9 firstmate | `crew-harness` = `pi` | `crew-harness` = `claude` | Plus `claude-permission-mode` |
| 10 cli | `pi -e` extensions | `claude --append-system-prompt` | One `hablo` wrapper, two branches |
| 11 tools | skips `setup hooks` | runs `setup hooks` | The `*-axi` hooks are Claude Code hooks |
| 12 guard | Pi extension (see [HOOKS.md](HOOKS.md)) | plugin `hooks/hooks.json` | New step |

## Order of work

1. **Agent selection first.** Every other document writes into a step that this
   one makes conditional. Land the flag, the prompt and the step table before
   any Claude Code asset exists.
2. **Routing second, and expect upstream work.** Two gaps in `bedrouter` block a
   usable session: no `/v1/messages/count_tokens` endpoint, and no prompt-cache
   handling. Both are named in the routing document. Until they close, Claude
   Code on bedrouter runs without context accounting and pays full price on
   every turn.
3. **Plugin third.** It is self-contained and testable with `--plugin-dir`
   before the installer writes a single file.
4. **firstmate fourth.** It depends on the plugin, because the captain and the
   crew both expect the agents and the skill to exist.
5. **Guard last.** It hangs off the plugin's `hooks/` directory, so the plugin
   has to exist first.

## Boundaries

**This work does not change `bedrouter`'s routing model.**
[MORE-PROVIDERS-AND-MODELS.md](MORE-PROVIDERS-AND-MODELS.md) rewrites families
into vendors and collapses the `auto` aliases. The two efforts touch the same
files. Land this one against today's family model, and let the provider work
migrate both agents together.

**This work does not replace `HOOKS.md`.** That document keeps the Pi extension
design. The guard document describes the Claude Code mechanism and states which
rules are shared. Two mechanisms, one rule set.

**This work does not port the Pi packages one for one.** Five of the eight have
no Claude Code equivalent worth building. The plugin document lists each package
and what happens to it.

## Open across all five documents

- `~/.claude` is a symlink into a dotfiles repository on at least one target
  machine, the same condition `install.mjs` already handles for
  `~/.pi/agent/settings.json`. Every write to `~/.claude/settings.json` has to
  follow the link and say so, as step 3 does today.
- The uninstall receipt in
  [UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) predates the
  second agent. Every artifact this work creates needs an agent tag in the
  receipt, or an uninstall cannot tell which agent owned it.
- The tone policy in [UN-NAUTICAL.md](UN-NAUTICAL.md) writes into
  `data/captain.md`, which firstmate reads for every harness. It needs no
  Claude Code variant, but it does need a test run under the new harness.
