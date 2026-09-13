# The HABLO plugin: agents, commands, skills and workflows

> Status: design settled, one delivery detail unverified. Part of
> [CLAUDE-CODE.md](CLAUDE-CODE.md). The unverified detail is whether a plugin can
> carry workflow scripts; the fallback is written below.

- [ ] Create `claude/` in this repository as the plugin source tree
- [ ] Write `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`
- [ ] Split the six agent profiles into a shared body plus a per-harness front matter
- [ ] Render `claude/agents/*.md` from the shared bodies
- [ ] Write `claude/skills/openwiki/SKILL.md`
- [ ] Translate `pi/workflows/ticket.md` to a workflow script
- [ ] Translate `pi/workflows/review-round.md` to a workflow script
- [ ] Write `claude/commands/ticket.md` and `claude/commands/review-round.md`
- [ ] Confirm whether a plugin loads `workflows/`; if not, install the scripts to `~/.claude/workflows/`
- [ ] `install.mjs` step 7: copy the plugin to `~/.hablo/claude`, register the marketplace, enable the plugin
- [ ] `install.mjs` step 8: write the model notes into each agent's `model` field
- [ ] Add `.hablo/claude` to `backup.config` in `hablo.json`
- [ ] Test the whole tree with `claude --plugin-dir` before the installer touches settings
- [ ] `README.md`: what the plugin installs and how to remove it

## What this is

Pi gets its behavior from packages, agent profiles in `~/.pi/agent/agents`, and
workflows in `~/.pi/workflows`. Claude Code has one carrier for all of it. A
plugin bundles agents, slash commands, skills and hooks, installs as a unit,
versions as a unit, and uninstalls as a unit.

## Why a plugin, not loose files

Step 7 copies files into `~/.pi` today. The same approach for Claude Code means
writing into `~/.claude/agents`, `~/.claude/commands` and
`~/.claude/settings.json`, and on at least one target machine `~/.claude` is a
symlink into a dotfiles repository. Every copied file then becomes a change in
somebody's personal repository, and the uninstall receipt has to name each one.

A plugin needs two registrations and nothing else:

```jsonc
// ~/.claude/settings.json, merged by step 3
{
  "extraKnownMarketplaces": {
    "hablo": { "source": { "source": "directory", "path": "/Users/<you>/.hablo/claude" } }
  },
  "enabledPlugins": { "hablo@hablo": true }
}
```

The `directory` source is verified working on this machine. It needs no git
remote and no network. Uninstall removes two keys and one directory.

## Layout

The plugin source lives in `claude/` in this repository, next to `pi/`, and the
installer copies it to `~/.hablo/claude` the same way step 10 copies
`hablo-captain.ts` to `~/.hablo`.

```
claude/
  .claude-plugin/
    marketplace.json     name hablo, one plugin, pluginRoot "."
    plugin.json          name, version, description
  agents/                six profiles, rendered from the shared bodies
  commands/              ticket.md, review-round.md
  skills/
    openwiki/SKILL.md    the wiki-first read order
  hooks/
    hooks.json           the bedrouter start hook and the guard
  workflows/             ticket.js, review-round.js   (see the delivery note)
```

**Decision: the plugin is copied, not symlinked.** `bin/hablo` already takes
this position and the reason holds here: the installed copy must keep working if
this checkout moves or goes away.

## The six agents

`pi/agents/*.md` and a Claude Code subagent are both Markdown with YAML front
matter, and the prompt bodies are product-neutral. The front matters are not.

| Pi key | Claude Code equivalent |
| --- | --- |
| `name: software architect` | `name: software-architect`, because the file name is the invocation |
| `description` | `description`, unchanged, and it is what the dispatcher matches on |
| `thinking: high \| medium` | no equivalent key; becomes a `model` choice plus one line in the body |
| `tools: [read, grep, find, ls]` | `tools: Read, Grep, Glob` |
| `tools: [..., edit, write, bash]` | `tools: ..., Edit, Write, Bash` |

Tool mapping, in full: `read` is `Read`, `grep` is `Grep`, `find` and `ls` are
`Glob`, `edit` is `Edit`, `write` is `Write`, `bash` is `Bash`. The four
read-only reviewers keep their read-only tool sets, which is what makes "you
read; you never edit files" enforceable rather than advisory.

**Decision: one body, two front matters.** The bodies carry the review lenses,
the black-box test discipline and the context strategy, and they are the part
worth maintaining. Keeping two copies guarantees they drift. The source moves to
`agents/<name>.md` holding the body alone, with both front matters described in
`hablo.json`, and step 7 renders the Pi file and the plugin file from it.

**Decision: `thinking` maps to `model`, not to effort.** Claude Code sets effort
per session, not per subagent, so a profile cannot ask for it. `thinking: high`
becomes the strongest model in the ladder and `thinking: medium` the middle one.
Step 8 already computes which alias is the explore rung and which is the execute
rung, so it writes those values into the `model` fields instead of into
`workflows.json`.

## The two workflows

`ticket.md` and `review-round.md` are not prompts. They are directed graphs: a
parallel branch for the UI and performance reviews, a JSON schema per step, and
a fix-until-approved loop. A slash command cannot enforce any of that, because
the orchestration would be a suggestion to the model.

Workflow scripts can. They give a real `parallel()` for the review fan-out, a
real loop with a bound for the fix cycle, and schema validation at the tool
layer, which is the closest equivalent of the `json:` blocks the Pi workflows
use today.

The translation is mechanical:

| Pi workflow | Workflow script |
| --- | --- |
| `kind: sequence` | statements in order |
| `kind: parallel` with named branches | `parallel([...])` |
| `kind: agent` with `profile:` | `agent(prompt, {agentType: '<name>'})` |
| `json:` schema on a step | `{schema: <JSON Schema>}` |
| the review-and-fix loop | a `while` loop with an explicit round cap |
| `params:` | the `args` global |

**Delivery note, unverified.** No plugin on this machine carries a `workflows/`
directory, and the plugin manifest fields observed in the wild are `hooks` and
`skills` path overrides, with no workflow equivalent. If a plugin cannot carry
them, step 7 writes `~/.claude/workflows/*.js` directly, with the same
never-overwrite rule step 7 uses today, and the receipt names the two files.
Verify this before building the render path, because it decides whether the
uninstall has one artifact or three.

**The commands are the front door.** `commands/ticket.md` takes the ticket as
its argument and invokes the workflow. A workflow run is opt-in per invocation
by design, and a slash command is the opt-in. This also gives a graceful
degradation: if the workflow is unavailable, the command still describes the
pipeline and the agent runs it inline, less deterministically.

## OpenWiki

Every agent profile and every crewmate brief says to read `openwiki/` first.
Under Pi that instruction is backed by `pi-openwiki-adapter`, which exposes the
wiki's front matter, quickstart and indexes as navigation tools, with freshness
from OpenWiki's own run records. Claude Code has no such package.

**Decision: a skill, not an MCP server.** `skills/openwiki/SKILL.md` teaches the
read order over the built-in `Read`, `Grep` and `Glob` tools: start at the
quickstart page, follow cross-references, check the run record before trusting a
page, and verify any load-bearing signature against real code. It adds no
dependency, no runtime process, and nothing new to maintain in a third
repository.

State the cost plainly in the document: Claude Code reads the wiki less cheaply
than Pi does, because it walks files where Pi calls an index. The instruction is
the same; the token bill is higher. An MCP server that ports the adapter's tools
stays available as later work if the difference turns out to matter.

## What happens to the other Pi packages

| Package | Claude Code |
| --- | --- |
| `pi-bedrouter` | Replaced by the `env` block and the start hook. See [routing](CLAUDE-CODE-ROUTING.md) |
| `pi-openwiki-adapter` | Replaced by the skill above |
| `pi-web-access` | Built in: `WebSearch` and `WebFetch` |
| `pi-vision-handoff` | Built in: images are read directly |
| `pi-usage-meters` | Partly covered by `/cost`; no per-rung meter |
| `pi-openai-codex-usage` | No equivalent, and no reason for one |
| `pi-agents` | Replaced by the subagents and the workflows in this plugin |
| `pi-impeccable` | No equivalent. Decide whether the behavior belongs in the guard |

Print this table in the install log for the Claude Code side. A step that
installs eight packages for one agent and none for the other needs to say why.

## Open questions

- `pi-impeccable` is the one package with no answer. Read what it does before
  the plugin ships; if it is a correctness discipline rather than a tool, it
  belongs in the agent bodies or in [the guard](CLAUDE-CODE-GUARD.md).
- A plugin version number that never changes defeats the update path. Derive it
  from this repository's git describe output at install time, or hold it in
  `hablo.json` and bump it by hand.
- Do the six agents need a project-scope variant? Today they are user scope, so
  every repository on the machine sees them. That matches how `~/.pi/agent/agents`
  behaves, so start there.
