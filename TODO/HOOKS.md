# Fail-closed tool-call guard (`hablo-guard`)

> Status: buildable spec. Every decision below is settled unless it sits under
> "Verify before you build". The Pi behaviours marked there are taken from
> `docs/extensions.md` in the installed package; confirm each one against a real
> session before the code depends on it.
>
> This document owns the rule engine, the policy file, and the Pi front end. Two
> sibling documents build on it and do not repeat it:
> [DEPENDENCY-TRUST.md](DEPENDENCY-TRUST.md) adds the `deps.*` rule class, and
> [later/CLAUDE-CODE-GUARD.md](later/CLAUDE-CODE-GUARD.md) adds the Claude Code
> front end. One engine, one policy, three front ends over time.

- [ ] Verify the seven behaviours in "Verify before you build"
- [ ] `guard/`: `go.mod`, `Taskfile.yml`, `main.go`, `internal/*` skeleton
- [ ] `internal/policy`: load, merge, validate; a bad policy is an error, never a pass
- [ ] `internal/glob`: `**` segment matcher, stdlib only, with a table test
- [ ] `internal/resolve`: symlink and `..` resolution for a path that may not exist yet
- [ ] `internal/rules`: the four rule groups, each returning a rule id and a remedy
- [ ] `internal/audit`: the JSONL log, with secret redaction
- [ ] `decide`: one JSON request on stdin, one verdict on stdout
- [ ] `probe`, `check`, `record`, `report`, `doctor`, `version` subcommands
- [ ] Golden tests: one fixture per rule, allow and deny, captain and crewmate
- [ ] Write `pi/extensions/hablo-guard.ts`, the shim, with no rule logic in it
- [ ] Add the `guard` block to `hablo.json`
- [ ] `install.mjs` step 12: build the binary, render `~/.hablo/guard.json`, install the extension
- [ ] `install.mjs`: gate the whole step on a Go toolchain, and remove a stale shim when it is absent
- [ ] Add `--skip-guard`, `--guard-mode`, `--rebuild-guard` and the usage header lines
- [ ] Add the guard paths to `backup.config`, the log to `backup.history`
- [ ] Measure the per-call cost of `decide` and the per-edit cost of `check`
- [ ] `README.md`: what the guard denies, how to allow something, how to turn it off
- [ ] Record the guard artifacts in the uninstall receipt ([UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md))

## What this is

A guard that sees every tool call an agent makes before the tool runs, and denies
the calls that leak a secret, write to a file we declared off limits, or run a
destructive shell command. After an accepted edit it runs the deterministic tools
(semgrep, the linter, the formatter) on the file that changed and puts the
findings in front of the model on the same turn.

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

## The shape

The rules live in a Go binary. The Pi extension is a shim that marshals an event,
runs the binary, and honours the verdict.

```
pi tool_call ──▶ hablo-guard.ts ──stdin json──▶ hablo-guard (Go)
                      │                              │  reads ~/.hablo/guard.json
                      │                              │       + <project>/.hablo/guard.json
                      │◀────── {"verdict":"deny", ───┘       writes ~/.hablo/guard-log.jsonl
                      │         "rule":"secrets.paths", …}
                      ▼
           {block:true, reason:"guard: secrets.paths …"}

binary missing, non-zero exit, unparsable output, or timeout  ->  throw  ->  Pi blocks the tool
```

**Decision: the engine is a Go binary, not TypeScript.** A rule set is a pure
function from a tool call to a verdict, and that function is worth testing
without a running agent. The binary is the same engine for the Claude Code front
end, so a rule written once cannot drift between two implementations. The cost is
a Go toolchain at install time and one process exec per tool call; both are
priced below.

**Decision: only the standard library.** Path matching, JSON, `os/exec`, and
HTTP cover the whole engine. `**` globbing is the one gap, because
`filepath.Match` has no `**`; `internal/glob` implements a segment matcher in
about forty lines with a table test. `github.com/bmatcuk/doublestar` would
replace that file and needs approval before anyone reaches for it.

## Why fail closed

A `hablo` captain has a human in front of it. A firstmate crewmate does not: it
runs in a tmux pane, on a branch, with nobody reading the output. The guard must
behave the same in both, and when it cannot decide, it must refuse.

Pi makes that cheap in two ways:

- A `tool_call` handler blocks the tool by returning
  `{ block: true, reason, terminate }`.
- An exception thrown inside a `tool_call` handler also blocks the tool.
  `docs/extensions.md` calls this fail-safe. A missing policy file, a missing
  binary, or a crash in our own code therefore denies the call instead of waving
  it through.

The whole design rests on that second property. **Do not catch and swallow errors
in the `tool_call` path.** The shim has exactly one `try` block, and its `catch`
re-throws after writing an audit line.

Prior art in the Pi package, to read before writing the shim:
`examples/extensions/permission-gate.ts`, `examples/extensions/protected-paths.ts`,
`confirm-destructive.ts`, `dirty-repo-guard.ts`, `project-trust.ts`,
`timed-confirm.ts`, `tool-override.ts`.

### The brick state, stated plainly

If the binary is absent, every tool call in every Pi session fails. That is fail
closed taken to its end, and it is deliberate. Two things keep it rare:

- `install.mjs` installs the binary and the shim together, or neither. When the
  Go toolchain is missing, the step installs nothing and removes a shim a previous
  run left behind.
- `session_start` runs `hablo-guard version`. When it fails, the shim sets a red
  status line and notifies with the repair command, so the reason is on screen
  before the first denial.

## Where it lives

| Thing | Path |
| --- | --- |
| Engine source | `guard/` in this repository |
| Installed engine | `~/.local/bin/hablo-guard` (`cli.binDir`) |
| Shim source | `pi/extensions/hablo-guard.ts` |
| Installed shim | `~/.pi/agent/extensions/hablo-guard.ts` |
| Policy | `~/.hablo/guard.json`, rendered by the installer from `hablo.json` |
| Per-project rules | `.hablo/guard.json` in the project, adding rules only |
| Audit log | `~/.hablo/guard-log.jsonl` |
| Check probe cache | `~/.hablo/guard-cache/` |

**Decision: the shim installs globally, into `~/.pi/agent/extensions/`.** The
earlier plan loaded it through `bin/hablo` with `-e`, and that plan does not
reach the sessions the guard exists for. firstmate launches a crewmate as
`pi [--tui-mode regular] --model … -e <state/<task-id>.pi-ext.ts> "<brief>"`
(`fm-spawn.sh:1558`), which never goes through `bin/hablo`. Global auto-discovery
is the only placement that covers a captain, a crewmate, and a bare `pi` without
editing an upstream checkout. `/reload` works there too.

`bin/hablo` therefore gets no new `-e` argument. Adding one would load the shim
twice in a captain session.

The consequence is wider than the old plan: the guard now runs in every Pi
session on the machine, including sessions with no connection to HABLO. Handle it
the way the Claude Code document already settles it:

- Secret rules, destructive-shell rules, and agent-state rules apply everywhere.
  None of them is ever a correct action in any repository, so a denial in an
  unrelated session is a correct denial.
- The foreign-checkout rule applies only when `HABLO_PROJECT` is set. Outside a
  HABLO session there is no project boundary to enforce, and the rule would deny
  ordinary work.

Say this in `README.md` where a reader finds it before the first surprising
denial, not after.

## Attended or unattended

**Decision: a session is attended when it has a UI and no `FM_TASK_ID`.**

`ctx.hasUI` alone does not answer the question. A crewmate pane is a real TUI, so
`ctx.hasUI` is `true` there, and "prompt when there is a UI" would put a dialog in
front of a pane nobody reads while firstmate's screen scraper watches a stalled
agent. firstmate exports `FM_TASK_ID` into the pane before the launch command
(`fm-spawn.sh:4137`), which is the marker that separates the two.

```
attended = ctx.hasUI && !process.env.FM_TASK_ID && process.env.HABLO_GUARD !== "off"
kind     = FM_TASK_ID ? "crewmate" : HABLO_PROJECT ? "captain" : "solo"
```

The shim sends `kind` and `attended` in the request. The engine decides `ask` or
`deny`; the shim never makes that choice, so the Claude Code front end inherits
the same answer.

On `ask` the shim calls `ctx.ui.confirm` with an `AbortSignal` armed at
`guard.ask.timeoutSeconds` (default 120). A timeout is a deny. That backstop
matters because a crewmate launched through some path that does not export
`FM_TASK_ID` would otherwise be misclassified as attended and would hang.

A rule with `"interactive": false` denies in both kinds of session. That is what
stops a captain from waving through a secret exfiltration.

The consequence, stated plainly: the same action can succeed for a captain and
fail for a crewmate. A rule that must never be overridden has to carry
`"interactive": false` in the policy.

## The engine contract

One request in, one verdict out. Both are a single line of JSON. The shim writes
the request to stdin and reads stdout; exit status 0 means the verdict is valid.

### Request

```jsonc
{
  "v": 1,
  "event": "tool_call",              // tool_call | tool_result
  "agent": "pi",                     // pi | claude-code
  "tool": "bash",
  "input": { "command": "…" },       // the tool input, verbatim
  "session": {
    "id": "01J…",
    "kind": "crewmate",              // captain | crewmate | solo
    "attended": false,
    "project": "/Users/me/code/foo", // HABLO_PROJECT, or ""
    "cwd": "/Users/me/code/foo",
    "taskId": "t-4821"               // FM_TASK_ID, or ""
  }
}
```

### Verdict

```jsonc
{
  "v": 1,
  "verdict": "deny",                 // allow | deny | ask
  "rule": "secrets.content",
  "reason": "guard: secrets.content: the new content of src/auth.go contains an AWS access key id (AKIA…, 20 chars). Secrets load from .env, which Infisical populates.",
  "remedy": "Remove the literal value and read it from the environment. To allow this path permanently, add {\"rule\":\"secrets.content\",\"glob\":\"src/auth.go\",\"note\":\"…\"} to guard.allow in hablo.json and re-run the installer.",
  "terminate": false,
  "findings": []                     // tool_result only
}
```

`reason` goes to the model verbatim, prefixed with `guard:` and the rule id, so a
crewmate reads why it failed and corrects itself instead of retrying the same
call. `remedy` names the exact policy edit; a denial that does not say how to
allow the action is a denial nobody can act on.

### Exit status

| Status | Meaning | Shim behaviour |
| --- | --- | --- |
| 0 | The verdict on stdout is valid | Honour it |
| 2 | Policy is missing, unparsable, or invalid | Throw, naming the policy file |
| 3 | Internal error | Throw, naming the audit log |
| other, or no output, or a timeout at `engine.timeoutMs` | Unknown | Throw |

Every throw blocks the tool. The shim never converts a failure into an allow.

### Subcommands

| Command | Purpose |
| --- | --- |
| `decide` | The contract above. Reads stdin, writes one verdict. |
| `check --file <path>` | Run the post-edit checks for one file, write findings as JSON. |
| `probe` | Report which configured check binaries exist, as JSON. Called once at `session_start`. |
| `record` | Append one audit line. Used by the shim to record how a human answered an `ask`. |
| `report [--since 1h] [--task <id>]` | Summarise the audit log: rule, count, last reason. |
| `doctor` | Validate the policy, print the effective merged rule set and every `allow` entry with its note. |
| `version` | Print the version. The `session_start` liveness probe. |

`doctor` is what a human runs when a denial looks wrong. It must print the
project policy contribution separately from the user policy, because a rule a
repository added is the surprising case.

## Rules

Each rule has an id, and the id is what appears in the deny reason and what an
`allow` entry keys on. Each rule states what it inspects and what it cannot see.

### `secrets.*`

`secrets.read` denies `read` on the credential set: `.env` and `.env.*`,
`~/.aws/credentials`, `~/.pi/agent/auth.json`, `~/.bedrouter/.env`, `*.pem`,
`id_rsa` and other `id_*` key files, and keychain paths.

`secrets.write` denies `write` and `edit` on the same set.

`secrets.content` scans the proposed content of a `write` or `edit` before the
bytes land. **Decision: explicit token patterns only in v1.** `AKIA[0-9A-Z]{16}`,
`sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`, `xox[baprs]-[A-Za-z0-9-]{10,}`,
`-----BEGIN [A-Z ]*PRIVATE KEY-----`, and whatever the policy adds. No entropy
heuristic: a hash, a UUID, a lockfile integrity string, and a minified asset all
look random, and a guard that fights those gets turned off. Entropy scanning is
future work, and it arrives as `"warn"` before it ever denies.

The house rule is that secrets come from Infisical into `.env` and nothing else,
so a literal secret inside a diff is always a defect, never a false positive
worth allowing. `secrets.content` carries `"interactive": false`.

A write larger than `secrets.maxScanBytes` (default 8 MiB) is denied with a reason
that says the content was too large to scan. Fail closed, and honest about why.

`secrets.exfil` denies a `bash` command that moves one of those files off the
machine: a pipe or redirect into `curl`, `nc`, `scp`, `rsync`, or a pastebin host.

`secrets.push` denies a `git push` whose staged set contains a file matching a
secret path pattern. The engine runs `git diff --cached --name-only` in
`session.cwd` to see the staged set.

Cannot see: a secret the model already read into its context in an earlier
session, anything a subprocess does after `bash` returns, a secret read through a
shell heredoc that the pattern list misses, and any path reached through a
symlink we did not resolve. `internal/resolve` resolves every path before
matching, including the parent directory of a file that does not exist yet.

### `paths.*`

Denies writes by reason class, and puts the class in the deny message:

- `paths.generated`: `**/*.pb.go`, `**/*_gen.go`, `**/*.generated.*`,
  `package-lock.json`, OpenAPI and protobuf output, anything a codegen task owns.
- `paths.vendored`: `node_modules/**`, `vendor/**`, `dist/**`, `build/**`.
- `paths.foreign`: any path outside `session.project`. Skipped entirely when
  `session.project` is empty, which is the solo-session case above.
- `paths.agentState`: `~/.hablo/**`, `~/.pi/agent/**`, `~/.bedrouter/**`. The
  agent must not rewrite its own guard, its own credentials, or its own routing.
  `"interactive": false`: this is the rule that keeps the guard from being edited
  by the thing it guards.

Cannot see: a write performed by a build command the model runs through `bash`.
Path rules apply to the file tools only; shell writes need the shell rules.

### `shell.destructive`

`rm -rf`, `git reset --hard`, `git clean -fdx`, `git push --force` against the
base branch (`develop`, per the captain branch policy), `sudo`, and a package
manager running as root. `permission-gate.ts` has the shape.

Cannot see: the same command inside a script file, a shell alias, or a `make`
target. Treat the shell rules as a speed bump on the obvious cases, not as a
boundary. Say that in `README.md` so nobody mistakes the guard for a sandbox.

### `deps.*`

Untrusted dependency additions, by registry age and popularity signals. The rule
class, the registry clients, and the cache are specified in
[DEPENDENCY-TRUST.md](DEPENDENCY-TRUST.md). It shares this engine, this policy
file, and this audit log, and it ships independently.

### Unknown tools

A tool name with no rule passes, and the engine writes one audit line at
`notice` level the first time it sees that name in a session. Denying every
unknown tool would break MCP servers and every Pi package the manifest installs.

The exception is `guard.exfilTools`, a list of tool names whose input carries
content off the machine (the fetch and post tools that `pi-web-access` and
similar packages register). Those get the `secrets.content` scan on their input.
The list is in the policy because the tool names come from packages, not from us.

### `tool_result`: post-edit checks

After a `write` or an `edit` succeeds, run the deterministic tools on the file
that changed and only that file: semgrep, the repository's linter, the formatter,
plus `go vet` or `tsc` where the language applies. `tool_result` can modify the
result, so the shim appends the findings to what the model sees. The model then
fixes the problem on the same turn instead of discovering it at commit time.

**Decision: report-only in v1.** Findings never block and never revert. The
policy schema carries `onFail`, and v1 implements `"warn"` only, so turning on a
hard failure later is a data change with one new branch in the engine, not a new
shape.

**Decision: probe once at `session_start`, drop what is missing.** The shim runs
`hablo-guard probe`, and a check whose binary is absent is dropped for the whole
session with one `ctx.ui.notify` and one audit line. Denying every edit because an
optional linter is absent is worse than the risk it covers. The probe result is
cached in `~/.hablo/guard-cache/probe.json` with the `PATH` hash as the key.

Cost control, because semgrep is not fast:

- One run per changed file per turn. The shim keys on the file path and the hash
  of the new content, so a file edited twice with the same result is checked once.
- Per-check `timeoutMs`, and a per-turn budget `postEdit.turnBudgetMs`
  (default 5000). A check that exceeds the budget is skipped with a note in the
  appended findings, so the model knows the check did not run.
- Findings are appended as one text block, headed
  `guard: post-edit findings for <path>`, so they are unmistakable in the
  transcript.

Measure this before the default set grows. The checklist has a line for it.

## Policy

A new `guard` block in `hablo.json`, following the manifest rule at the top of
that file: edit the manifest, not the script. The installer renders it to
`~/.hablo/guard.json` with `~` expanded, and the engine reads that file on every
call.

**Decision: the engine re-reads the policy when its mtime changes.** The earlier
plan read it once at `session_start`, which made a mid-session policy edit do
nothing. The engine already runs per call, so an `os.Stat` and an mtime compare
costs nothing and removes a surprise. An unreadable or invalid policy is exit 2,
which denies.

```jsonc
{
  "guard": {
    "$comment": "The fail-closed tool-call guard. The installer renders this to ~/.hablo/guard.json; hablo-guard reads that file. Rule ids appear in every deny message and are what an allow entry keys on.",
    "mode": "enforce",              // enforce | warn | off. warn allows and logs. off logs only.
    "engine": {
      "binName": "hablo-guard",
      "timeoutMs": 3000,            // per decide call; a timeout denies
      "auditLog": "~/.hablo/guard-log.jsonl",
      "cacheDir": "~/.hablo/guard-cache"
    },
    "ask": { "timeoutSeconds": 120 },
    "exfilTools": ["web_fetch", "web_search"],
    "secrets": {
      "interactive": false,
      "maxScanBytes": 8388608,
      "paths": [
        ".env", ".env.*", "**/.env", "**/.env.*",
        "~/.aws/credentials", "~/.pi/agent/auth.json", "~/.bedrouter/.env",
        "**/*.pem", "**/id_rsa", "**/id_ed25519", "**/id_*.key"
      ],
      "patterns": [
        "AKIA[0-9A-Z]{16}",
        "ghp_[A-Za-z0-9]{36}",
        "xox[baprs]-[A-Za-z0-9-]{10,}",
        "sk-[A-Za-z0-9]{20,}",
        "-----BEGIN [A-Z ]*PRIVATE KEY-----"
      ],
      "exfilCommands": ["curl", "nc", "ncat", "scp", "rsync", "wget"],
      "exfilHosts": ["pastebin.com", "gist.github.com", "transfer.sh", "0x0.st"]
    },
    "protectedPaths": [
      { "rule": "paths.generated",  "glob": "**/*.pb.go",         "interactive": true },
      { "rule": "paths.generated",  "glob": "**/*_gen.go",        "interactive": true },
      { "rule": "paths.generated",  "glob": "**/*.generated.*",   "interactive": true },
      { "rule": "paths.generated",  "glob": "**/package-lock.json", "interactive": true },
      { "rule": "paths.vendored",   "glob": "**/node_modules/**", "interactive": true },
      { "rule": "paths.vendored",   "glob": "**/vendor/**",       "interactive": true },
      { "rule": "paths.foreign",    "outsideProject": true,       "interactive": true },
      { "rule": "paths.agentState", "glob": "~/.hablo/**",        "interactive": false },
      { "rule": "paths.agentState", "glob": "~/.pi/agent/**",     "interactive": false },
      { "rule": "paths.agentState", "glob": "~/.bedrouter/**",    "interactive": false }
    ],
    "shell": {
      "interactive": true,
      "deny": [
        "\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\\s+--force)",
        "\\bgit\\s+reset\\s+--hard\\b",
        "\\bgit\\s+clean\\s+-[a-zA-Z]*f[a-zA-Z]*d\\b",
        "\\bsudo\\b",
        "\\bnpm\\s+.*--unsafe-perm\\b"
      ],
      "denyForceePushTo": ["develop", "main", "master"]
    },
    "postEdit": {
      "turnBudgetMs": 5000,
      "checks": [
        { "id": "semgrep", "command": "semgrep --error --quiet --no-rewrite-rule-ids", "glob": "**/*.{go,ts,tsx,py}", "timeoutMs": 20000, "onFail": "warn" },
        { "id": "gofmt",   "command": "gofmt -l",  "glob": "**/*.go", "timeoutMs": 5000, "onFail": "warn" },
        { "id": "govet",   "command": "go vet",    "glob": "**/*.go", "timeoutMs": 20000, "onFail": "warn" }
      ]
    },
    "allow": [
      { "rule": "paths.generated", "glob": "internal/api/openapi.gen.go", "project": "~/code/foo", "note": "the generator is broken upstream; regenerate by hand until #412 lands", "added": "2026-09-13" }
    ]
  }
}
```

### Precedence, and what a project may do

1. `~/.hablo/guard.json` is the base. Only it may carry `allow` entries.
2. `<project>/.hablo/guard.json` may add entries to `secrets`, `protectedPaths`,
   `shell`, `postEdit`, and `exfilTools`. Anything else in it is an error, and an
   error is exit 2, which denies.
3. A project file may never carry `allow`, may never set `mode`, and may never
   remove a rule. A repository cannot allowlist itself, which is the point.

An `allow` entry needs `rule`, a target (`glob` or `command`), and a non-empty
`note`. The engine rejects a note-free entry with exit 2. A bypass that does not
say why is a bypass nobody can review later.

`"interactive": false` is what makes a rule survive a captain who wants to say
yes.

## The audit log

`~/.hablo/guard-log.jsonl`, one JSON object per line, appended with `O_APPEND` so
concurrent crewmates do not interleave a partial line.

```jsonc
{"ts":"2026-09-13T14:02:11Z","kind":"crewmate","task":"t-4821","project":"/Users/me/code/foo",
 "tool":"write","rule":"secrets.content","verdict":"deny","target":"src/auth.go",
 "match":"AKIA…(20)","reason":"…"}
```

Written for every `deny` and `ask`, for the human answer to an `ask`, for a
dropped post-edit check, and for the first sighting of an unknown tool. An
`allow` with no rule hit is not logged; that is the common case and the log would
drown.

**A matched secret value never enters the log.** `match` carries the pattern's
first four characters and the match length, and nothing else. The same rule
applies to the deny reason the model reads.

**Decision: no live escalation to the captain in v1.** A crewmate denial lands in
the log, and `hablo-guard report --since 1h` is what surfaces a crewmate that hit
the same rule ten times. Wiring a denial into the captain's session means writing
into another agent's transcript, and that is a separate mechanism with its own
failure modes. The log answers the question; build the push when the pull proves
insufficient.

## Escape hatch and uninstall

A human overrides a rule by adding an `allow` entry with a note and re-running the
installer. Not by a keystroke in the moment: a decision that matters enough to
bypass the guard is worth writing where the next session can read it.

`HABLO_GUARD=off` starts a deliberately unguarded session. It must be loud. The
shim sets a red `ctx.ui.setStatus` for the whole session, the same way
`hablo-captain.ts` sets the firstmate status line, and writes one audit line
naming the session. The engine is not consulted at all in that mode, so an off
session costs nothing.

`guard.mode` is the machine-wide equivalent: `warn` evaluates every rule, logs,
annotates the tool result, and allows. Use it for the first week on a new machine
to find out what the rules would have denied.

Removal is the binary, the shim, the policy, the log, and the cache, all listed in
the table above. `install.mjs uninstall` covers them through the receipt; see
[UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md).

## Installation

A new step in `install.mjs`. [JIRA-AGENT.md](JIRA-AGENT.md) also claims step 12;
whichever lands second takes 13 and renumbers the header comment.

1. Preflight reports the Go toolchain the same way it reports the AWS profile.
2. When `go` is absent, or `--skip-guard` is passed: install nothing, warn, and
   **remove `~/.pi/agent/extensions/hablo-guard.ts` if a previous run installed
   it**. A shim without an engine blocks every tool call in every session. The
   installer never leaves that pair half-built.
3. `go build -trimpath -o <binDir>/hablo-guard ./guard`.
4. Render the `guard` block to `~/.hablo/guard.json`, mode 0644, with `~`
   expanded and `--guard-mode` applied.
5. Install `pi/extensions/hablo-guard.ts` to `~/.pi/agent/extensions/`, using the
   existing `installFile` helper, which already refuses to overwrite a file this
   installer did not write.
6. Run `hablo-guard doctor` and print its summary line, so a broken policy fails
   at install time rather than at the first tool call.

New flags: `--skip-guard`, `--guard-mode <enforce|warn|off>`, `--rebuild-guard`
(force a rebuild when the source is unchanged). Add all three to the usage header.

`backup.config` gains `.hablo/guard.json` and `.pi/agent/extensions/hablo-guard.ts`.
`backup.history` gains `.hablo/guard-log.jsonl`.

## Verify before you build

Seven behaviours this design rests on. Six come from `docs/extensions.md` in the
installed package, and one comes from reading `fm-spawn.sh`. Check each against a
real session first, and correct this document where reality differs.

1. **An explicit `-e` does not disable auto-discovery.** The whole global-shim
   decision fails if a crewmate's `-e <task-ext>` replaces
   `~/.pi/agent/extensions/` instead of adding to it. Start a session with both
   and confirm the shim runs. This is the first thing to test, because a
   different answer sends the design back to the `pi` wrapper option.
2. **A thrown exception in `tool_call` blocks the tool.** `docs/extensions.md`
   says "tool_call errors block the tool (fail-safe)". Confirm it, including an
   exception thrown from an `await`ed child process.
3. **The input field names for the built-in tools.** `protected-paths.ts` reads
   `event.input.path` for `write` and `edit`, and `permission-gate.ts` reads
   `event.input.command` for `bash`. Confirm the field that carries new content on
   an `edit`, and run `pi.getActiveTools()` to get the real tool list before
   writing the tool-name switch.
4. **`ctx.ui.confirm` accepts `{ signal }`.** The `ask` timeout depends on it.
   See `examples/extensions/timed-confirm.ts`.
5. **`tool_result` appends survive to the model.** Confirm that a returned
   `content` patch reaches the transcript and is not dropped in parallel tool mode.
6. **`FM_TASK_ID` is exported in every crewmate path.** `fm-spawn.sh:4137` sets it
   for a task spawn. Confirm it for a scout and for a secondmate, because a
   crewmate without it is classified as attended and gets a 120-second dialog
   instead of an immediate deny.
7. **The cost of one `decide` exec.** Measure it on a cold and a warm page cache.
   If a process exec per tool call turns out to be visible in a session, the
   answer is a long-lived engine over a unix socket, and that is a change to the
   shim only. Do not build the socket until the number says so.
