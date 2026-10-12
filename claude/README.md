# HABLO Claude Code plugin

Installable unit for Claude Code: bedrouter SessionStart, OpenWiki skill, six agent profiles (rendered from `pi/agents/`), `/ticket` and `/review-round` commands, and soft-fail Jira progress hooks after `git commit` / `gh pr create`.

## Layout

```
claude/
  .claude-plugin/     marketplace.json + plugin.json
  agents/             rendered subagents (source of truth: ../pi/agents/)
  commands/           ticket.md, review-round.md
  skills/openwiki/    wiki-first read order over Read/Grep/Glob
  hooks/              hooks.json, start-bedrouter.mjs, progress.mjs
  render-agents.mjs   Pi → Claude front-matter render (install + tests)
```

Workflow JS is deferred: slash commands describe the pipeline and degrade to inline agent orchestration when scripts are unavailable.

## Install

`install.mjs` step 7 (when `--agent claude` or `both`, and not `--skip-agents`):

1. Copies this tree to `~/.hablo/claude` (stamps bedrouter port/home/bin into `start-bedrouter.mjs`).
2. Renders agents from `pi/agents/` with explore/execute model aliases from `bedrouter.json`.
3. Registers `extraKnownMarketplaces.hablo` (directory source) and `enabledPlugins["hablo@hablo"]=true` in `~/.claude/settings.json`.

Step 10b copies the pinned `technical-design-doc` skill into the plugin **only when** `interrogate.enabled` (or `--interrogate`).

Step 4b only merges `ANTHROPIC_*` env → bedrouter. SessionStart lives in the plugin `hooks.json` (Phase 2 settings hooks are stripped on upgrade).

## Manual smoke

```bash
claude --plugin-dir "$PWD/claude"
```

## Remove

Remove `enabledPlugins["hablo@hablo"]` and `extraKnownMarketplaces.hablo` from `~/.claude/settings.json`, then `rm -rf ~/.hablo/claude`. Env keys from step 4b are separate (see root README).
