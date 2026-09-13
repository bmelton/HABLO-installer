# Fail-closed tool-call guard for Pi (`hablo-guard`)

> Status: capture, not a finished spec. The rules below are the thinking so far.
> Flesh out the schema and the rule lists before anyone writes code.
>
> This document owns the rules and the Pi extension. The Claude Code engine for
> the same rules is [CLAUDE-CODE-GUARD.md](CLAUDE-CODE-GUARD.md). Both read one
> policy file, so a rule written here applies to both agents.

- [ ] Design the `guard` block schema in `hablo.json`
- [ ] Write `pi/extensions/hablo-guard.ts`
- [ ] Add the `guard` block to `hablo.json`
- [ ] Extend `install.mjs` step 10: render `~/.hablo/guard.json`, install the extension
- [ ] Add the `-e ~/.hablo/hablo-guard.ts` entry to `bin/hablo`
- [ ] Document the guard in `README.md`
- [ ] Add `.hablo/hablo-guard.ts` and `.hablo/guard.json` to `backup.config` in `hablo.json`
- [ ] Write the bypass and uninstall note

## What this is

An extension that HABLO installs and `hablo` loads. It sees every tool call the
model makes before the tool runs, and it denies the calls that leak a secret,
write to a file we declared off limits, or run a destructive shell command. After
an accepted edit it runs the deterministic tools (semgrep, the linter, the
formatter) on the file that changed and puts the findings back in front of the
model on the same turn.

"Hooks" here means Pi extension events, not Claude Code hooks. `hablo.json`
already records that the `*-axi` `setup hooks` step is skipped because it
installs Claude Code, Codex, and OpenCode session hooks that Pi does not read.
This feature is a different mechanism with a similar name. Keep the two apart in
every document and commit message.

Pi ships no sandbox and no permission dialog on purpose. `docs/security.md` says
the built-in tools read files, write files, and run shell commands with the
permissions of the user that started Pi, and `docs/usage.md` lists permission
popups among the things Pi leaves to extensions. The extension API is the
supported place to add this.

## Why fail closed

A `hablo` captain has a human in front of it. A firstmate crewmate does not: it
runs in a tmux pane, on a branch, with nobody reading the output. The guard must
behave the same in both, and when it cannot decide, it must refuse.

Two Pi behaviors make that cheap:

- A `tool_call` handler blocks the tool by returning
  `{ block: true, reason, terminate }`.
- An exception thrown inside a `tool_call` handler also blocks the tool. The
  extension docs call this fail-safe. So a missing policy file, a bad regex, or a
  crash in our own code denies the call instead of waving it through.

The whole design rests on that second property. Do not catch and swallow errors
in the `tool_call` path.

Prior art in the Pi package, to read before writing anything:
`examples/extensions/permission-gate.ts`, `examples/extensions/protected-paths.ts`,
`confirm-destructive.ts`, `dirty-repo-guard.ts`, `project-trust.ts`.

## Where it lives

| Thing | Path |
| --- | --- |
| Source in this repo | `pi/extensions/hablo-guard.ts` |
| Installed copy | `~/.hablo/hablo-guard.ts` |
| Loaded by | `bin/hablo`, as another `-e` argument |
| Policy | `~/.hablo/guard.json`, rendered by the installer from `hablo.json` |
| Per-repo override | `.hablo/guard.json` in the project, narrowing only |

This is the same path `hablo-captain.ts` already takes: the installer copies it
to `~/.hablo/` in step 10 (`install.mjs:423`) and `bin/hablo` adds it to the `-e`
list next to firstmate's own `.pi/extensions/fm-*.ts`.

**Decision: the guard loads only through `hablo`.** It does not go in
`~/.pi/agent/extensions/`, which would cover every Pi session on the machine.
The consequence is real and we accept it: a bare `pi` started in the same
repository runs with no guard at all. The guard protects `hablo` sessions and
firstmate crewmates, which is where unattended work happens.

**Decision: prompt when there is a TUI, deny when there is not.** A captain with
`ctx.hasUI` gets `ctx.ui.confirm` and can allow the call. A headless crewmate
gets an automatic deny. The deny returns `{ block: true, reason }` with the rule
name inside the reason, so the model reads why it failed and corrects itself
instead of retrying the same call. The consequence, stated plainly: the same
action can succeed for a captain and fail for a crewmate. A rule that must never
be overridden has to be marked non-interactive in the policy.

**Decision: the policy lives in `hablo.json`.** A new `"guard"` block, following
the manifest rule already at the top of that file: edit the manifest, not the
script. The installer renders it to `~/.hablo/guard.json`, and the extension
reads that file at `session_start`. A project may ship `.hablo/guard.json` to add
rules; it can never remove one.

## Rules

Grouped by the event they hang off. Each rule needs three things written down:
what it inspects, what it does, and what it cannot see.

### `tool_call`: secret exfiltration

Deny `read` and `edit` on the credential set: `.env` and `.env.*`,
`~/.aws/credentials`, `~/.pi/agent/auth.json`, `~/.bedrouter/.env`, `*.pem`,
`id_rsa` and other `id_*` key files, keychain paths.

Deny a `bash` command that moves one of those files off the machine: a pipe or
redirect into `curl`, `nc`, `scp`, `rsync`, or a pastebin host. Deny a `git push`
whose staged set contains a file matching a secret path pattern.

Scan the proposed content of a `write` or `edit` for token shapes before the
bytes land: `AKIA`, `sk-`, `ghp_`, `xoxb-`, `-----BEGIN * PRIVATE KEY-----`, and
a high-entropy string check for the rest. The house rule is that secrets come
from Infisical into `.env` and nothing else, so a literal secret inside a diff is
always a defect, never a false positive worth allowing.

Cannot see: a secret the model already read into its context in an earlier
session, anything a subprocess does after `bash` returns, and any path reached
through a symlink we did not resolve. Resolve paths before matching.

### `tool_call`: protected paths

Deny writes by reason class, and put the class in the deny message:

- **Generated**: `*.pb.go`, `*_gen.go`, `*.generated.*`, `package-lock.json`,
  OpenAPI and protobuf output, anything a codegen task owns.
- **Vendored**: `node_modules/`, `vendor/`, `dist/`, `build/`.
- **Foreign checkout**: any path outside the session's `HABLO_PROJECT`. The
  `hablo` wrapper already exports it, and `hablo-captain.ts` already reads it.
- **Agent state**: `~/.hablo`, `~/.pi/agent`, `~/.bedrouter`. The agent must not
  rewrite its own guard, its own credentials, or its own routing.

Cannot see: a write performed by a build command the model runs through `bash`.
Path rules apply to the file tools only; shell writes need the shell rules.

### `tool_call`: destructive shell

`rm -rf`, `git reset --hard`, `git clean -fdx`, `git push --force` at the base
branch (`develop`, per the captain branch policy), `sudo`, and a package manager
running as root. `permission-gate.ts` has the shape for this.

Cannot see: the same command hidden inside a script file, a shell alias, or a
`make` target. Treat the shell rules as a speed bump on the obvious cases, not as
a boundary.

### `tool_result`: post-edit checks

After a `write` or `edit` succeeds, run the deterministic tools on the file that
changed and only that file: semgrep, the repo's linter, the formatter, plus
`go vet` or `tsc` where the language applies. `tool_result` can modify the
result, so append the findings to what the model sees. The model then fixes the
problem on the same turn instead of discovering it at commit time.

Open choice, decide before implementation: start report-only, and later add a
hard-fail mode that reverts the edit and returns `isError: true` when a check
fails. Report-only first is the safer way to learn which checks are noisy.

## Policy shape

First sketch of the `guard` block. Names are provisional.

```jsonc
{
  "guard": {
    "mode": "enforce",            // enforce | warn | off
    "secrets": {
      "paths": [".env", ".env.*", "~/.aws/credentials", "*.pem", "id_*"],
      "patterns": ["AKIA[0-9A-Z]{16}", "ghp_[A-Za-z0-9]{36}", "-----BEGIN [A-Z ]*PRIVATE KEY-----"],
      "interactive": false        // false = never overridable, even with a TUI
    },
    "protectedPaths": [
      { "glob": "**/*.pb.go", "reason": "generated" },
      { "glob": "node_modules/**", "reason": "vendored" }
    ],
    "shell": {
      "deny": ["rm -rf", "sudo", "git reset --hard", "git push --force"],
      "interactive": true
    },
    "postEdit": {
      "checks": [
        { "command": "semgrep --error --quiet", "glob": "**/*.{go,ts,py}", "timeoutMs": 20000, "onFail": "warn" }
      ]
    }
  }
}
```

`interactive: false` is what makes a rule survive a captain who wants to say yes.

## Escape hatch and uninstall

A human overrides a rule by adding an allowlist entry to the policy and
restarting the session. Not by a keystroke in the moment: a decision that matters
enough to bypass the guard is worth writing down where the next session can read
it.

`HABLO_GUARD=off` starts a deliberately unguarded session. It must be loud:
`ctx.ui.setStatus` in red for the whole session, the same way `hablo-captain.ts`
already sets the firstmate status line. No silent bypass.

Removal is deleting `~/.hablo/hablo-guard.ts` and the `-e` line, which the full
teardown covers. See `UNINSTALL-PI-AND-EVERYTHING.md`.

## Open questions

- What does semgrep cost on every edit? If it adds seconds per file, the checks
  need a debounce or a per-turn batch instead of a per-edit run.
- A check binary is missing. Fail closed says deny, but denying every edit
  because an optional linter is absent is worse than the risk. Probe the check
  set once at `session_start` and drop the missing ones with a loud notice?
- How does the guard behave across compaction? The policy is read once at
  session start, so a mid-session policy edit does nothing. Acceptable, or watch
  the file?
- Should a crewmate denial escalate to the captain, or only land in the crewmate
  transcript? A crewmate that hits the same deny ten times is a signal somebody
  should see.
