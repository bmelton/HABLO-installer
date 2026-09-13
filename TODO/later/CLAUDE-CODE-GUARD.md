# The fail-closed tool-call guard on Claude Code hooks

> Status: design settled, one behavior to verify first. Part of
> [CLAUDE-CODE.md](CLAUDE-CODE.md). This is the Claude Code mechanism for the
> rules [HOOKS.md](HOOKS.md) defines. One rule set, two engines. Read that
> document first; this one does not repeat the rules.

- [ ] Verify what Claude Code does when a `PreToolUse` hook crashes or times out
- [ ] Design the `guard` block schema in `hablo.json` (shared with [HOOKS.md](HOOKS.md))
- [ ] Write `claude/hooks/hablo-guard.mjs`, zero dependencies, Node only
- [ ] Write `claude/hooks/hooks.json` with the `PreToolUse` and `PostToolUse` matchers
- [ ] Write the session-kind probe into the plugin's `SessionStart` hook
- [ ] `install.mjs` step 12: render `~/.hablo/guard.json` from the manifest
- [ ] Implement the four rule groups against Claude Code tool names
- [ ] Implement `HABLO_GUARD=off` and make it loud
- [ ] Add `.hablo/guard.json` to `backup.config` in `hablo.json`
- [ ] Test every rule against a real session, captain and crewmate
- [ ] `README.md`: document the guard once, for both agents

## Why this belongs in the Claude Code work

`HOOKS.md` exists because Pi ships no sandbox and no permission dialog, so a
guard has to be built out of extension events. Claude Code ships the mechanism
natively. `PreToolUse` sees every tool call before the tool runs and can deny
it; `PostToolUse` sees the result and can put text back in front of the model.
That is exactly the shape the Pi document designs from scratch.

Building the Claude Code side now is cheaper than building it later, because the
plugin already carries a `hooks/` directory for the bedrouter start hook, and
the policy file the Pi extension will read is the same file.

## The one behavior that decides the design

Pi's extension API fails safe: an exception thrown inside a `tool_call` handler
blocks the tool. The entire Pi design rests on that property, and `HOOKS.md`
says so.

**Claude Code does not make the same promise.** A `PreToolUse` hook denies a
call by returning an explicit decision, and a hook that crashes, times out, or
writes malformed output is a hook error, not a denial. The default direction is
open, which is the opposite of what this guard needs.

The consequence for the implementation is concrete:

- The guard script wraps its whole body in a handler that converts any error
  into an explicit deny. Nothing propagates.
- A missing or unparseable `~/.hablo/guard.json` is a deny with a reason naming
  the file, never a crash and never a pass.
- The script has no dependencies and does no network calls, so the set of things
  that can make it slow is small. A timeout is a hook error, and a hook error is
  a pass.

Verify the exact behavior before writing the rules. If a timeout genuinely
cannot be turned into a denial, that is a limit of the mechanism and the
document must say so rather than imply a guarantee it does not have.

## Where it lives

| Thing | Path |
| --- | --- |
| Source in this repository | `claude/hooks/hablo-guard.mjs` |
| Hook registration | `claude/hooks/hooks.json`, carried by the plugin |
| Installed copy | inside the plugin at `~/.hablo/claude` |
| Policy | `~/.hablo/guard.json`, rendered by the installer from `hablo.json` |
| Per-repository override | `.hablo/guard.json` in the project, narrowing only |

The policy path and the narrowing rule are taken unchanged from `HOOKS.md`. One
policy file serves both agents, so a rule written once applies to a Pi crewmate
and a Claude Code crewmate alike.

## Ask or deny

`HOOKS.md` decides: prompt when there is a user interface, deny when there is
not. Claude Code's `PreToolUse` output carries a permission decision, so `ask`
and `deny` are both available and the rule maps directly.

Deciding which one applies needs a session-kind signal. The plugin's
`SessionStart` hook writes a small per-session record keyed by the session
identifier, marking whether the session is interactive. The `PreToolUse` hook
reads that record. A session with no record is treated as non-interactive, which
is the failing-closed direction.

A rule marked non-interactive in the policy denies in both kinds of session.
That is what stops a captain from waving through a secret exfiltration.

## Scope, and where it differs from the Pi guard

`HOOKS.md` decides the Pi guard loads only through `hablo`, so a bare `pi`
session in the same repository runs unguarded. That decision follows from the
mechanism: a Pi extension is loaded per launch.

A user-scope plugin has no such switch. Once the plugin is enabled, its hooks
run for every Claude Code session on the machine, including sessions with no
connection to HABLO.

**Decision: accept the wider scope for the rules that are never legitimate, and
narrow the one rule that is context-dependent.**

- Secret exfiltration, destructive shell commands and writes to agent state
  apply everywhere. None of them is ever a correct action in any repository, so
  a denial in an unrelated session is a correct denial.
- The foreign-checkout rule, which denies writes outside the session's project,
  applies only when `HABLO_PROJECT` is set. Outside a HABLO session there is no
  project boundary to enforce and the rule would deny ordinary work.

State this in `README.md` where a reader will find it before the first
surprising denial, not after.

## Tool name mapping

`HOOKS.md` writes its rules against Pi's tool names. The `PreToolUse` matcher
uses Claude Code's names, and the argument shapes differ.

| Rule target | Pi tool | Claude Code matcher | Field inspected |
| --- | --- | --- | --- |
| Reading a credential file | `read` | `Read` | `file_path` |
| Writing a protected path | `edit`, `write` | `Edit`, `Write` | `file_path` |
| Secret shapes in new content | `edit`, `write` | `Edit`, `Write` | `new_string`, `content` |
| Destructive shell | `bash` | `Bash` | `command` |
| Post-edit checks | `tool_result` | `PostToolUse` on `Edit`, `Write` | `file_path` |

Two Claude Code tools have no Pi equivalent and need a decision: `NotebookEdit`
writes files and belongs with `Edit`, and the task-dispatch tool spawns a
subagent whose own tool calls are guarded separately, so it needs no rule of its
own. Resolve paths before matching, as `HOOKS.md` requires, because a symlink
defeats a glob.

## Post-edit checks

`PostToolUse` can add text to what the model sees, which is what `HOOKS.md`
wants from Pi's `tool_result`. The open choice in that document stands here
unchanged: start report-only, and add a hard-fail mode later. Report-only first
is how you learn which checks are noisy without blocking real work.

The cost question from that document applies here too. Measure what the checks
add per edit before turning them on by default.

## Escape hatch

`HABLO_GUARD=off` starts a deliberately unguarded session, and it has to be
loud. Pi's version sets a red status line. Claude Code's status line belongs to
the operator, so the plugin's `SessionStart` hook prints the warning into the
session context instead, where the transcript records it.

Overriding a single rule is still an edit to the policy file and a restart, not
a keystroke in the moment. A decision worth bypassing the guard for is worth
writing where the next session can read it.

## Open questions

- The same four questions `HOOKS.md` ends with apply here: the cost of the
  checks, a missing check binary, a policy edited mid-session, and whether a
  crewmate denial should escalate to the captain. Answer them once, for both
  engines.
- Does a subagent inherit the parent session's record, so its tool calls resolve
  to the right ask-or-deny branch? If not, every subagent is non-interactive,
  which fails closed and is acceptable but should be deliberate.
- The per-launch `--settings` JSON that firstmate passes to every `claude`
  worker is another settings source. Confirm it cannot disable plugin hooks.
