# The fail-closed tool-call guard on Claude Code hooks

> Status: design settled, one behavior to verify first. Part of
> [CLAUDE-CODE.md](CLAUDE-CODE.md). This is the Claude Code front end for the
> rules and the engine [../HOOKS.md](../HOOKS.md) defines. One rule set, one
> engine, two front ends. Read that document first; this one does not repeat the
> rules, the policy schema, or the engine contract.

- [ ] Verify what Claude Code does when a `PreToolUse` hook crashes or times out
- [ ] Write `claude/hooks/hablo-guard.mjs`: marshal the event, run `hablo-guard decide`, honour the verdict
- [ ] Write `claude/hooks/hooks.json` with the `PreToolUse` and `PostToolUse` matchers
- [ ] Write the session-kind probe into the plugin's `SessionStart` hook
- [ ] Map Claude Code tool names and argument shapes onto the engine request
- [ ] Implement `HABLO_GUARD=off` and make it loud
- [ ] Add `.hablo/guard.json` to `backup.config` in `hablo.json`
- [ ] Test every rule against a real session, captain and crewmate
- [ ] `README.md`: document the guard once, for both agents

## Why this belongs in the Claude Code work

`../HOOKS.md` exists because Pi ships no sandbox and no permission dialog, so a
guard has to be built out of extension events. Claude Code ships the mechanism
natively. `PreToolUse` sees every tool call before the tool runs and can deny
it; `PostToolUse` sees the result and can put text back in front of the model.
That is exactly the shape the Pi document designs from scratch.

Building the Claude Code side now is cheaper than building it later, because the
plugin already carries a `hooks/` directory for the bedrouter start hook, and
because the rules are no longer in the front end at all.

## The hook is a shim

`../HOOKS.md` settles the architecture: the rules live in a Go binary,
`hablo-guard`, which reads one JSON request on stdin and writes one verdict on
stdout. The Pi extension is a shim over it, and this hook is the second shim.

The `.mjs` file therefore contains no rule logic, no globs, and no patterns. It
marshals the `PreToolUse` payload into the engine request that document
specifies, runs `hablo-guard decide`, and converts the verdict into a Claude Code
permission decision. A rule written once cannot drift between the two agents,
because there is only one implementation of it.

`install.mjs` builds the binary and renders the policy for the Pi side already.
This document adds the hook and the registration, nothing else.

## The one behavior that decides the design

Pi's extension API fails safe: an exception thrown inside a `tool_call` handler
blocks the tool. The entire Pi design rests on that property, and `../HOOKS.md`
says so.

**Claude Code does not make the same promise.** A `PreToolUse` hook denies a
call by returning an explicit decision, and a hook that crashes, times out, or
writes malformed output is a hook error, not a denial. The default direction is
open, which is the opposite of what this guard needs.

The consequence for the implementation is concrete:

- The guard script wraps its whole body in a handler that converts any error
  into an explicit deny. Nothing propagates.
- A missing engine, a non-zero exit, unparsable output, or a missing
  `~/.hablo/guard.json` is a deny with a reason naming the cause, never a crash
  and never a pass. The engine signals those with exit 2 and exit 3.
- The script does no work of its own beyond one exec, so the set of things that
  can make it slow is small. A timeout is a hook error, and a hook error is a
  pass. The engine's own timeout has to be shorter than the hook's, so the engine
  denies before Claude Code gives up and allows.

Verify the exact behavior before writing the rules. If a timeout genuinely
cannot be turned into a denial, that is a limit of the mechanism and the
document must say so rather than imply a guarantee it does not have.

## Where it lives

| Thing | Path |
| --- | --- |
| Source in this repository | `claude/hooks/hablo-guard.mjs` |
| Hook registration | `claude/hooks/hooks.json`, carried by the plugin |
| Installed copy | inside the plugin at `~/.hablo/claude` |
| Engine | `~/.local/bin/hablo-guard`, built by the installer for the Pi side |
| Policy | `~/.hablo/guard.json`, rendered by the installer from `hablo.json` |
| Per-project rules | `.hablo/guard.json` in the project, adding rules only |
| Audit log | `~/.hablo/guard-log.jsonl`, shared with the Pi front end |

The policy path and the additive-only rule are taken unchanged from
`../HOOKS.md`. One policy file and one log serve both agents, so a rule written
once applies to a Pi crewmate and a Claude Code crewmate alike, and
`hablo-guard report` covers both.

## Ask or deny

The engine returns `ask` or `deny`, and it decides which. Claude Code's
`PreToolUse` output carries a permission decision, so both map directly and the
hook makes no judgement of its own.

The engine needs the session kind to decide. On the Pi side, an attended session
has a UI and no `FM_TASK_ID`. Claude Code has no equivalent signal inside the
hook process, so the plugin's `SessionStart` hook writes a small per-session
record keyed by the session identifier, marking whether the session is
interactive, and `PreToolUse` reads it into the `session` field of the engine
request. A session with no record is `attended: false`, which is the
failing-closed direction.

A rule with `"interactive": false` in the policy denies in both kinds of session.
That is what stops a captain from waving through a secret exfiltration or an
unknown dependency.

## Scope

Once the plugin is enabled, its hooks run for every Claude Code session on the
machine, including sessions with no connection to HABLO. The Pi shim has the same
reach, for its own reason: it installs into `~/.pi/agent/extensions/` so that
firstmate crewmates, which never run `bin/hablo`, are covered.

Both front ends therefore need the same narrowing, and `../HOOKS.md` states it
once for the engine:

- Secret exfiltration, destructive shell commands and writes to agent state
  apply everywhere. None of them is ever a correct action in any repository, so
  a denial in an unrelated session is a correct denial.
- The foreign-checkout rule, which denies writes outside the session's project,
  applies only when `HABLO_PROJECT` is set. Outside a HABLO session there is no
  project boundary to enforce and the rule would deny ordinary work.

State this in `README.md` where a reader will find it before the first
surprising denial, not after.

## Tool name mapping

The engine reads a tool name and an input object. The Pi shim sends Pi's names,
so this hook translates Claude Code's names and argument shapes into the same
request rather than teaching the engine two vocabularies.

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
own. The engine resolves paths before matching, so the hook sends them as they
arrive and does not normalise anything itself.

## Post-edit checks

`PostToolUse` can add text to what the model sees, which is what `../HOOKS.md`
wants from Pi's `tool_result`. That document settles the behaviour: report-only
in v1, and a check whose binary is absent is dropped for the session after one
`hablo-guard probe`. The hook runs `hablo-guard check --file <path>` and appends
the findings.

The cost question applies here too. Measure what the checks add per edit before
turning them on by default.

## Escape hatch

`HABLO_GUARD=off` starts a deliberately unguarded session, and it has to be
loud. Pi's version sets a red status line. Claude Code's status line belongs to
the operator, so the plugin's `SessionStart` hook prints the warning into the
session context instead, where the transcript records it.

Overriding a single rule is still an edit to the policy file and a restart, not
a keystroke in the moment. A decision worth bypassing the guard for is worth
writing where the next session can read it.

## Open questions

- The four questions this document used to share with `../HOOKS.md` are settled
  there and apply unchanged: report-only checks, a missing check binary dropped
  after one probe, a policy re-read on every call, and a crewmate denial that
  lands in the shared log rather than in the captain's session. What remains here
  is the measurement, on Claude Code's own tool mix.
- Does a subagent inherit the parent session's record, so its tool calls resolve
  to the right ask-or-deny branch? If not, every subagent is non-interactive,
  which fails closed and is acceptable but should be deliberate.
- The per-launch `--settings` JSON that firstmate passes to every `claude`
  worker is another settings source. Confirm it cannot disable plugin hooks.
