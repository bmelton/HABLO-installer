# Jira agent: a labelled ticket dispatches a captain

> Status: buildable spec. Every decision below is settled unless it sits under
> "Verify before you build" or "Open questions". The Jira Cloud search endpoint
> and the `@file` argument behaviour are the two things written from memory; both
> must be checked against a real instance before the code depends on them.
>
> This document is the Jira-to-agent direction. `TODO/JIRA.md` is the
> agent-to-Jira direction (progress comments over MCP). They share a tracker and
> nothing else. Build either one first.

- [ ] Verify the Jira Cloud search endpoint, its request body, and its pagination
- [ ] Verify that `pi` expands `@path` in a positional message argument
- [ ] `jira-agent/`: `go.mod`, `Taskfile.yml`, `main.go`, `internal/*` skeleton
- [ ] `internal/config`: load `config.json`, load the env file, validate every path
- [ ] `internal/jira`: search, read one issue, add and remove labels, add a comment
- [ ] `internal/adf`: Atlassian Document Format to Markdown, with golden tests
- [ ] `internal/state`: the run directory, the lock file, per-key attempts and backoff
- [ ] `internal/dispatch`: preflight guards, brief rendering, the tmux launch
- [ ] `tick`: claim, dispatch, reap, in that order, one pass per invocation
- [ ] `report`: the subcommand the captain calls when the ticket is finished
- [ ] `status` and `doctor` subcommands
- [ ] `--dry-run`: print the claim writes and the tmux command, write nothing
- [ ] `jira-agent/brief.tmpl.md`: the captain's opening message
- [ ] Unit tests against an `httptest` Jira stub, plus ADF fixtures
- [ ] Add the `jiraAgent` block to `hablo.json`
- [ ] `install.mjs` step 12: build the binary, render `config.json`, install the template
- [ ] `install.mjs` step 12: write and load the launchd agent or the systemd user timer
- [ ] `install.mjs` preflight: report the Go toolchain, skip the step with a warning when absent
- [ ] Add `--skip-jira-agent`, `--jira-agent-interval`, `--no-jira-agent-service` and the usage header lines
- [ ] Add the daemon's paths to `backup.config` and to the uninstall receipt
- [ ] `README.md`: the label contract, the project map, and how to stop it

## What this is

Today a ticket becomes work when a human reads it, opens a terminal in the right
repository, and types `hablo`. The three steps in the middle are mechanical. A
small Go program can do them, so the human keeps only the two that need judgement:
deciding the ticket is ready, and reviewing the pull request.

The trigger is a Jira label. There is no agent user account: tickets are assigned
to the person whose API token the daemon holds, and the label says which of those
tickets the agent may take. Adding the label is the act of delegation, and it is
reversible until the daemon claims the ticket.

## The lifecycle

```
human assigns the ticket and adds  agent-ready
        |
        |  <= 20s
        v
tick: JQL match -> claim (agent-ready -> agent-running) -> render brief -> tmux new-session -d
        |
        v
captain in the tmux session:
   reads data/captain.md  (HABLO branch policy, HABLO OpenWiki policy)
   cuts origin/PROJ-123 from origin/develop
   fm-spawn crewmates -> fm/<id> -> gh pr create --base PROJ-123
   opens the ticket PR: PROJ-123 -> develop
   last action: hablo-jira-agent report --key PROJ-123 --outcome done --pr <url>
        |
        v
tick: reap -> reads report.json -> agent-running -> agent-done, comments the outcome
```

The daemon never merges anything and never closes a ticket. It moves labels,
starts a session, and records what happened.

## Decisions

**The daemon starts a `hablo` captain in a detached tmux session.** It does not
call `pi` and it does not call `fm-spawn.sh`. Everything the installer already
puts on the machine then applies without a second copy: the branch policy in
`data/captain.md`, the OpenWiki policy, `crew-dispatch.json` routing every
crewmate through bedrouter, the provider and model defaults stamped into
`bin/hablo`. The captain decides whether one crewmate is enough or whether the
work splits. The daemon's whole contract with the agent is one rendered brief in
and one `report` call out.

**The Jira project key selects the repository, through `hablo.json`.** An
unmapped key is a permanent failure with a comment that names the key. The map
lives in the manifest, so adding a repository is a reviewed edit and a re-run of
the installer, not a label anyone with Jira write access can type.

**The source lives in `jira-agent/` in this repository and the installer builds
it.** One commit changes the manifest, the installer step, and the daemon
together. No release pipeline, no download, no checksum. The cost is a Go
toolchain on the machine; preflight reports it and step 12 skips with a warning
when it is missing, the same way the AWS step already behaves.

**Labels are the claim.** `agent-ready` to `agent-running` is the daemon's first
write, before it renders anything, so the next poll no longer matches the query.
`agent-done` and `agent-failed` are terminal. A local lock file and a state file
back this up; the labels are what a human reads on the board.

**Only the standard library.** Jira is a JSON REST API over HTTP and tmux is a
process to exec. `net/http`, `encoding/json`, `os/exec`, `text/template`,
`log/slog`, and `flag` cover all of it. No Jira client library, no cron library,
no dotenv library: parsing `KEY=value` lines is twenty lines with a test.

## Configuration

A new top-level block in `hablo.json`. The installer renders it, with `~`
expanded and the interval and label overrides applied, to
`~/.hablo/jira-agent/config.json`, which is the only file the daemon reads.

```jsonc
{
  "jiraAgent": {
    "$comment": "Polls Jira for tickets assigned to the token owner and labelled 'agent-ready', then starts a hablo captain in a detached tmux session in the mapped repository. Credentials are never stored here: the daemon reads them from envFile, which `task secrets` populates from Infisical.",
    "enabled": true,
    "binName": "hablo-jira-agent",
    "home": "~/.hablo/jira-agent",
    "envFile": "~/.hablo/jira-agent/.env",
    "envVars": ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    "intervalSeconds": 20,
    "labels": {
      "ready": "agent-ready",
      "running": "agent-running",
      "done": "agent-done",
      "failed": "agent-failed"
    },
    "jqlExtra": "statusCategory != Done",
    "maxConcurrent": 1,
    "maxAttempts": 3,
    "runTimeoutMinutes": 240,
    "commentOnDispatch": true,
    "reporterAllowlist": [],
    "projects": {
      "PROJ": { "dir": "~/code/foo", "baseBranch": "develop", "mode": "direct-PR" },
      "OPS":  { "dir": "~/code/ops", "baseBranch": "main",    "mode": "direct-PR" }
    },
    "service": {
      "kind": "auto",
      "launchdLabel": "dev.hablo.jira-agent",
      "systemdUnit": "hablo-jira-agent"
    }
  }
}
```

`projects` doubles as the project allowlist: the generated JQL names exactly
these keys, so a ticket in any other project is never even returned.
`reporterAllowlist`, when it is not empty, restricts dispatch to tickets reported
by those account IDs. `mode` is firstmate's delivery contract and is passed to
the captain in the brief; `local-only` is refused because the branch policy
forbids it.

### Files the daemon owns

```
~/.hablo/jira-agent/
  config.json          rendered by the installer, never hand-edited
  .env                 mode 0600, from Infisical via `task secrets`
  brief.tmpl.md        installed from jira-agent/brief.tmpl.md
  run.lock             flock; a tick that cannot take it exits 0
  state.json           per-key attempts, backoff-until, last outcome
  log/agent.log        slog text output, rotated at 8 MB, three files kept
  runs/PROJ-123/
    brief.md           what the captain was told
    launch.sh          exactly what tmux ran
    console.log        tmux pipe-pane capture
    report.json        written by `hablo-jira-agent report`
```

The run directory is the audit trail. When a dispatch goes wrong, `brief.md` and
`console.log` say what the agent saw and did, without anyone reconstructing it.

## The Jira side

Base URL, account email, and API token come from `envFile`, which the daemon
loads itself; launchd and systemd user units do not read a login shell, so an
exported variable in a shell rc file is not visible here. Authentication is HTTP
Basic with the email as the user and the token as the password, over TLS. The
token value never enters `config.json`, the log, or any run directory.

The search runs once per tick:

```
project IN (PROJ, OPS)
  AND assignee = currentUser()
  AND labels = "agent-ready"
  AND statusCategory != Done
ORDER BY created ASC
```

Fields requested: `summary`, `description`, `issuetype`, `priority`, `labels`,
`components`, `parent`, `reporter`, `status`, `comment`. The daemon asks for the
fields it needs and no more, so one search is one round trip and the response
stays small.

`description` on Jira Cloud comes back as Atlassian Document Format, a JSON
document tree, not text. `internal/adf` walks it into Markdown and handles
`doc`, `paragraph`, `text` with `strong`/`em`/`code`/`link` marks, `hardBreak`,
`heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `blockquote`,
`rule`, `table`, `mediaSingle`, and `inlineCard`. An unknown node type is
flattened to the concatenation of its descendant text rather than dropped, and
the walker logs the unknown type once so gaps surface. Golden-file tests in
`testdata/adf/` pin the output. The escape hatch, if ADF turns out to carry
something the walker mangles, is the v2 read endpoint, which returns the
description as wiki markup; that is a change to one request path, so it stays
cheap.

Comments are included in the brief, oldest first, bounded at the last 20 or
50 KB, whichever is smaller, because clarifications usually live there rather
than in the description.

## The claim

Claiming is one label update:

```
PUT /rest/api/3/issue/PROJ-123
{ "update": { "labels": [ { "remove": "agent-ready" }, { "add": "agent-running" } ] } }
```

Jira offers no compare-and-swap, so this is not a distributed lock. Two
mitigations, in this order: `run.lock` makes concurrent ticks on one machine
impossible, and the design assumes one daemon per Jira account. After the write
the daemon re-reads the issue and confirms the label set is what it expects; a
mismatch aborts the dispatch and logs it. Running two machines against one
account is out of scope, and `doctor` says so.

State transitions:

| From | Event | To | Jira write |
| --- | --- | --- | --- |
| `agent-ready` | claimed | `agent-running` | label swap, plus a dispatch comment |
| `agent-running` | `report --outcome done` | `agent-done` | label swap, plus the outcome comment with the PR link |
| `agent-running` | `report --outcome failed` | `agent-failed` | label swap, plus the reason |
| `agent-running` | session gone, no report | `agent-failed` | label swap, plus "the session ended without a report" |
| `agent-running` | past `runTimeoutMinutes` | `agent-failed` | `tmux kill-session`, label swap, plus the elapsed time |

A human re-queues a ticket by removing the terminal label and adding
`agent-ready` again. The daemon treats that as a fresh dispatch and resets the
attempt count, so the brief must tell the captain to expect an existing
`<JIRA-KEY>` branch and to continue on it rather than to recreate it.

The daemon never transitions the Jira status. `TODO/JIRA.md` owns transitions,
and two writers on one field is how a ticket ends up in the wrong column.

### Failure classes

Transient and permanent failures are handled differently, and getting this
backwards either burns tickets on a flaky network or retries a typo forever.

**Transient**: a Jira 429 or 5xx, a DNS or TLS error, `gh` not authenticated,
`origin` unreachable, tmux missing. The ticket keeps `agent-ready`, nothing is
claimed, and the key gets an entry in `state.json` with an attempt count and a
backoff of 1, 2, 4, 8 minutes, capped at 15. After `maxAttempts` consecutive
transient failures the ticket becomes `agent-failed` with a comment naming the
last error, so a permanently broken environment does not poll forever in silence.

**Permanent**: an unmapped project key, a repository directory that does not
exist or is not a git checkout, a base branch missing on `origin`, `mode:
local-only`, an empty description. The ticket goes straight to `agent-failed`
with a comment that names the specific guard. No retry.

A 429 is honoured: the daemon reads `Retry-After` and sleeps the whole tick.

## Dispatch

Guards run in order, and all of them are permanent failures except the last two:

1. The project key is in `projects`.
2. The mapped directory exists, is a git work tree, and its root is the mapped path.
3. `mode` is not `local-only`.
4. The ticket has a non-empty summary and description after ADF conversion.
5. `origin/<baseBranch>` resolves after `git fetch origin` (transient: the network).
6. `tmux`, `pi`, `hablo`, `git`, and `gh` are on PATH, and `gh auth status` passes (transient).

Then the daemon renders `brief.md` from `brief.tmpl.md` with `text/template`,
writes `launch.sh`, and starts the session:

```sh
tmux new-session -d -s "hablo-PROJ-123" -c "$DIR" "sh $RUN/launch.sh"
tmux pipe-pane -o -t "hablo-PROJ-123" "cat >> $RUN/console.log"
```

`launch.sh` keeps the quoting out of Go:

```sh
#!/bin/sh
# written by hablo-jira-agent; one ticket, one session
export HABLO_JIRA_KEY="PROJ-123"
export HABLO_JIRA_RUN="/Users/you/.hablo/jira-agent/runs/PROJ-123"
export HABLO_PROJECT_MODE="direct-PR"
cd "/Users/you/code/foo" || exit 1
exec hablo -- "@$HABLO_JIRA_RUN/brief.md"
```

Passing the brief as an `@file` reference keeps a long description out of argv
and leaves the exact text on disk for the audit trail. This is the second thing
to verify against a real `pi`: the usage line reads
`pi [options] [--] [@files...] [messages...]`, so the behaviour is expected, but
it must be confirmed before the launcher depends on it.

Session naming is `hablo-<JIRA-KEY>`, which makes `tmux attach -t hablo-PROJ-123`
the obvious way for a human to look in, and makes liveness a single
`tmux has-session` call.

### The brief

`jira-agent/brief.tmpl.md` holds the opening message. It states the facts and
the two contracts, and it does not restate policy that already lives in
`data/captain.md`. Duplicated policy is policy that drifts.

```markdown
Work Jira ticket {{.Key}}.

**Summary:** {{.Summary}}
**Type:** {{.IssueType}} · **Priority:** {{.Priority}} · **Reporter:** {{.Reporter}}
**Repository:** {{.Dir}} · **Base branch:** {{.BaseBranch}}
**Delivery contract:** mode={{.Mode}}

## Description

{{.Description}}

{{if .Comments}}## Ticket comments (oldest first)
{{range .Comments}}
### {{.Author}}, {{.Created}}
{{.Body}}
{{end}}{{end}}

## How this run must finish

Your standing branch and wiki policies in `data/captain.md` apply. The
integration branch for this ticket is `{{.Key}}`, cut from `origin/{{.BaseBranch}}`.
It may already exist from an earlier run: check first, and continue on it rather
than recreating it.

When the work is delivered, or when you cannot deliver it, your last action is
one of these commands. Nothing else closes out this run, and an unreported run
is recorded as a failure:

    hablo-jira-agent report --key {{.Key}} --outcome done   --pr <pull request url> --summary "<one line>"
    hablo-jira-agent report --key {{.Key}} --outcome failed --summary "<what blocked you>"

Do not merge the pull request and do not change the ticket status. A human does
both.
```

The ticket text is untrusted input. See "Security" below.

## Completion

`report` is a subcommand of the same binary, so the captain needs no credentials
and does no network calls. It validates the key against a live run directory,
writes `report.json`, and exits. The next tick reaps it: label swap, outcome
comment, run directory kept.

```
hablo-jira-agent report --key PROJ-123 --outcome done|failed [--pr URL] [--summary TEXT]
```

Reaping also covers the two cases where no report arrives. If
`tmux has-session` is false and `report.json` is absent, the run ended without
reporting, which is a failure. If the session is alive and older than
`runTimeoutMinutes`, the daemon kills it and records a timeout. A machine
restart clears every session at once, and the first tick afterwards reaps them
all as unreported failures, which is the honest outcome: the work is not on a
branch anyone can see.

## The binary

```
jira-agent/
  go.mod                  module github.com/<you>/hablo-installer/jira-agent
  Taskfile.yml            build, test, lint, run, secrets, install
  main.go                 flag parsing and subcommand dispatch only
  brief.tmpl.md
  internal/config/        config.json, the env file, path validation
  internal/jira/          client, search, issue, labels, comments
  internal/adf/           ADF to Markdown
  internal/state/         run directories, flock, attempts and backoff
  internal/dispatch/      guards, brief rendering, tmux
  testdata/               Jira responses, ADF documents, golden Markdown
```

Subcommands:

| Command | Does |
| --- | --- |
| `tick` | One pass: claim, dispatch, reap. The default, and what the scheduler runs. |
| `watch` | The same pass on an internal ticker. For debugging, never installed as the service. |
| `report` | Called by the captain. Writes `report.json`. |
| `status` | Live runs, their age, the tmux session, and the last outcome per key. |
| `doctor` | Config, credentials, one authenticated `myself` call, tmux, the tool list, every mapped repository, and the service state. |

Global flags: `--config <path>`, `--dry-run`, `--verbose`. In `--dry-run` the
daemon does every read and prints every write it would make, including the
literal tmux command, and touches nothing.

Exit codes: 0 for a clean pass and for a lock it could not take, 1 for an
unexpected error, 2 for a configuration or credential error. The scheduler logs
the code; nothing supervises it.

Concurrency is `maxConcurrent`, counted as the number of run directories in the
`agent-running` state with a live session. At the limit the tick claims nothing
and logs that it is at capacity. Default 1: several captains in one repository
is a merge conflict generator, and the crew is where parallelism belongs.

## The scheduler

One-shot every 20 seconds, not a resident process. A tick that crashes costs one
poll, there is no supervision code to write, and a hung tick cannot wedge the
system because the next one exits on the lock. Both units are written by the
installer and are non-fatal on failure.

macOS, `~/Library/LaunchAgents/dev.hablo.jira-agent.plist`, with
`ProgramArguments` of the absolute binary path plus `tick`, `StartInterval 20`,
`RunAtLoad true`, and both output streams to `~/.hablo/jira-agent/log/launchd.log`.
Loaded with `launchctl bootout gui/$UID/dev.hablo.jira-agent` followed by
`launchctl bootstrap gui/$UID <plist>`, which is idempotent and works on a
re-run.

Linux, `~/.config/systemd/user/hablo-jira-agent.service` (Type=oneshot) and
`hablo-jira-agent.timer` (`OnBootSec=1min`, `OnUnitActiveSec=20s`,
`AccuracySec=1s`), enabled with `systemctl --user daemon-reload` and
`systemctl --user enable --now hablo-jira-agent.timer`. `loginctl enable-linger`
is not run by the installer; the step prints it as the way to keep the timer
alive with no session open.

`service.kind` of `auto` picks by platform. `none` installs the binary and skips
the unit, for a machine where the ticket flow is run by hand.

## Installer wiring

New step 12, after the tool dependencies. It behaves like the steps around it:
it prints what it did, it never overwrites a file that lacks the `HABLO` marker,
and it warns rather than exits.

1. Skip entirely on `--skip-jira-agent`, or when `jiraAgent.enabled` is false.
2. Find the Go toolchain. Missing, or older than 1.22, means a warning and a skip,
   with the install hint. Preflight also reports it, alongside `pi` and `aws`.
3. `go build -trimpath -o <binDir>/hablo-jira-agent ./jira-agent`, run from this
   checkout, with the module cache left alone.
4. Render `config.json` into `~/.hablo/jira-agent/`, with `~` expanded, the
   interval and label overrides applied, and every mapped repository checked for
   existence. A missing repository is a printed note, not a failure: the machine
   may not have cloned it yet.
5. Install `brief.tmpl.md` with the same `installFile` helper step 10 uses, so a
   hand-edited template survives.
6. Create `~/.hablo/jira-agent/{log,runs}`. Create `.env` at mode 0600 only when
   it is absent, containing the three variable names with empty values and a
   comment pointing at `task secrets`. Never write a value.
7. Write and load the launchd agent or the systemd user timer, unless
   `--no-jira-agent-service`.
8. Run `hablo-jira-agent doctor` and print its output. Unconfigured credentials
   are expected on a first run and print the instruction, not a warning.

New flags, and the usage header lines to match:
`--skip-jira-agent`, `--jira-agent-interval <seconds>`,
`--jira-agent-label <name>`, `--no-jira-agent-service`,
`--jira-agent-bin-dir <dir>` (defaults to `cli.binDir`).

`backup.config` gains `.hablo/jira-agent/config.json` and
`.hablo/jira-agent/brief.tmpl.md`. `backup.essentials` gains
`.hablo/jira-agent/.env`, which is the one file here that cannot be regenerated.
`runs/` and `log/` are archived by neither. The uninstall receipt in
`TODO/UNINSTALL-PI-AND-EVERYTHING.md` records the binary path, both unit paths,
and whether this installer created the home directory, because an uninstall must
unload the service before it removes the binary.

## Security

This is the part to read twice. The daemon converts Jira write access into code
execution on a developer workstation.

**Who can trigger it.** Anyone who can put the label on an issue assigned to the
token owner starts an agent that has the user's SSH keys, `gh` token, AWS
profile, and every repository on the machine. Four bounds, all enforced in the
daemon: the project allowlist in `projects`, `assignee = currentUser()`, the
optional `reporterAllowlist`, and the repository path coming from the manifest
rather than from anything in Jira. If the Jira instance can restrict who applies
a label by project role, do that too; the daemon cannot enforce it and must not
assume it.

**The ticket is untrusted input.** A description is attacker-controlled text
placed directly into a captain's prompt. Prompt injection cannot be filtered
away, so the blast radius is what gets managed: the delivery mode stays
`direct-PR` so a human reviews before anything merges, the daemon never merges
and never approves, `--yolo on` is never passed, and no secret ever enters the
brief. The `local-only` mode is refused for exactly this reason.

**Credentials.** A Jira API token carries the full permissions of its owner.
`.env` is mode 0600, is populated by `task secrets` from Infisical, and is never
written into `hablo.json`, `config.json`, a log line, or a run directory. The
HTTP client redacts the `Authorization` header in verbose logging. A scoped
token, or a dedicated Jira account with access to only the mapped projects, is
better than a personal token and should be the documented recommendation.

**Console capture.** `console.log` records everything the captain printed, which
can include file contents. The run directory inherits the home directory's 0700.

## Failure behaviour

The daemon fails soft against Jira and hard against its own configuration. Jira
being down means no dispatch this tick and a log line, never a crash loop and
never a burned ticket. A malformed `config.json` means exit 2 on every tick until
a human fixes it, which is loud in the launchd log and correct: a daemon that
guesses at its own configuration is worse than one that stops.

This matches the installer's line in commit c0e0c9c and the reporter in
`TODO/JIRA.md`, and it is the opposite of the guard in `TODO/HOOKS.md`. A guard
that cannot decide must refuse. A dispatcher that cannot reach the tracker must
wait.

## Testing

Every Jira interaction goes through an interface with one real implementation
and one stub, so the tick logic is testable with no network:

- `httptest` server plus recorded fixtures for search, issue read, label update,
  comment, and the 429 and 5xx paths.
- Golden files for ADF conversion, one per node type plus three real ticket
  descriptions.
- The state machine driven directly: claim, report, orphan, timeout, re-queue,
  transient backoff, `maxAttempts` exhaustion.
- The dispatcher against a fake launcher that records the command instead of
  running tmux. One integration test does run a real tmux session with `true` as
  the command, to prove the session name, `pipe-pane`, and `has-session` calls
  are right.
- A guard test per permanent failure, each asserting the comment text names the
  guard.

`task test` runs all of it. There is no live-Jira test in CI; `doctor` is the
live check and a human runs it.

## Relationship to TODO/JIRA.md

They can ship in either order and neither blocks the other.

- The daemon writes lifecycle labels and three comments per ticket: dispatched,
  finished, failed. `TODO/JIRA.md` gives the agents the narrative comments for
  each pipeline stage.
- Only `TODO/JIRA.md` transitions the ticket status. The daemon never does.
- The daemon authenticates with an API token over REST, in Go. The reporter
  authenticates over MCP, from inside Pi. They share the credential names and
  nothing else. Doing both means the token is used by two clients, which is fine,
  and means `TODO/JIRA.md`'s option B environment path is already satisfied on
  any machine where this daemon is installed.

## Verify before you build

- **The search endpoint.** Jira Cloud replaced `GET /rest/api/3/search` with
  `POST /rest/api/3/search/jql` and token pagination (`nextPageToken`) instead of
  `startAt`. Confirm the path, the request body, the pagination field, and
  whether `total` is still returned before writing the client.
- **`@file` in a positional argument.** Confirm that `pi -- "@/abs/path.md"`
  reads the file into the first message. If it does not, the launcher passes the
  brief as a quoted argument and the template gains a length bound.
- **`labels = "x"` in JQL.** Confirm the exact operator for a label match on the
  target instance, and that labels containing a hyphen need no escaping.
- **Rate limits.** One search every 20 seconds is about 4,300 requests a day.
  Confirm that is comfortably inside Jira Cloud's limits for a single user, and
  what `Retry-After` looks like when it is not.

## Open questions

- Does the captain reliably reach its last instruction and call `report`? The
  firstmate turn-end guard keeps a captain working, which is the behaviour that
  makes the unreported-run path more than a corner case. If reports turn out to
  be rare, the fallback is to derive the outcome from the pull request state
  through `gh`, which is more code and less honest about what the agent believed.
- Should a ticket that reaches `agent-failed` for a transient reason be
  re-queued automatically once the environment recovers? Current answer: no, a
  human re-adds the label, because an automatic retry after `maxAttempts` is a
  loop with extra steps.
- Is 20 seconds right? It is what was asked for and it is cheap. Sixty seconds
  would be invisible to a human waiting on a dispatch and would cut the request
  volume by two thirds.
- Should the daemon read `data/projects.md` from the firstmate checkout instead
  of carrying its own map? It already holds a project name to path registry that
  `bin/hablo` writes. The map here is keyed by Jira project rather than by
  directory name, and it carries the base branch and the mode, so it is not the
  same table; but a machine with both should not disagree with itself.
- One label per repository, for a monorepo split across several Jira projects,
  or several projects mapping to one directory? The current map allows the
  second and says nothing about the first.
