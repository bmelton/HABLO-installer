# Ticket updates: agents report progress to Jira

> Status: implemented and tested; live `doctor` and end-to-end Jira demo remain. Every decision below is settled unless it sits under
> "Verify before you build". The bridge changed in this revision: agents write to
> Jira through a small Go CLI over the Jira REST API, not through MCP. The
> reasoning and the evidence are under "Why not MCP".
>
> This document is the agent-to-Jira direction. [JIRA-AGENT.md](JIRA-AGENT.md) is
> the Jira-to-agent direction. They now share a Go module, a credential file, and
> the `jira` block in `hablo.json`, so build the shared half once.

- [x] `jira/`: one Go module, `cmd/hablo-jira` and `cmd/hablo-jira-agent`, shared `internal/`
- [x] `internal/jira`: comment, transition, read one issue, search (shared with the daemon)
- [x] `internal/adf`: Atlassian Document Format to Markdown (shared with the daemon)
- [x] `internal/config`: load `~/.hablo/jira/config.json` and the env file, validate the project map
- [x] `hablo-jira comment`: stage marker, attribution from `FM_TASK_ID`, retry-once on 429
- [x] `hablo-jira transition`: logical name to workflow id, refuse any target in the Done category
- [x] `hablo-jira read` and `hablo-jira search`
- [x] `hablo-jira doctor`: auth, project map, and the real transitions available on a ticket
- [x] `--dry-run` on every mutating subcommand: print the request, send nothing
- [x] Exit-code contract (0/3/4) and `--quiet`, so a failed update never stops the build
- [x] Unit tests against an `httptest` Jira stub, plus the comment-marker dedupe case
- [x] Add the `jira` block to `hablo.json`, with `projects` shared by both binaries
- [x] `install.mjs`: build `hablo-jira`, render `~/.hablo/jira/config.json`, run `doctor`
- [x] `install.mjs`: the credential preflight, non-fatal, with the API-token link
- [x] Add `--skip-jira` / `--no-tracker` and the usage header line
- [x] Write `firstmate/captain-ticket-policy.md` from the cadence table, with literal commands
- [x] Wire `captainBlock("TICKET-POLICY", …)` into `install.mjs` step 9
- [x] Add the reporting duty to the six existing profiles in `pi/agents/` (no new agents)
- [x] Document it in `README.md`

## What this is

Agents must keep the ticket current without being asked. The standard is a good
junior developer: the ticket says what has been done, what is happening now, and
where the artifact is, so nobody has to go and ask.

Right now the pipeline reports to the terminal and to the PR. The ticket learns
nothing until a human writes it down.

Jira only. Linear was considered and dropped: Jira is free at the tier we need,
and one tracker means one code path, one policy text, and no abstraction layer
built for a second backend that may never arrive.

Dropping Linear also removes a problem this document used to carry. The branch
policy in `firstmate/captain-branch-policy.md` hardcodes `<JIRA-KEY>` in five
places and says "Jira" in two more. With one tracker that text is simply correct.
Leave it alone.

## The stages already exist

`pi/workflows/ticket.md` is a full pipeline and every stage has an agent profile
in `pi/agents/`. Nothing new needs inventing and no new agent file gets written.
The requirements-evaluation agent already exists: it is
`pi/agents/product-triage.md`, "evaluates incoming tickets for readiness, decides
if a ticket is actionable or needs more information". It returns
`{ ready, refined_ticket, questions, report }`, which is exactly the payload of
the first comment.

Each existing profile gains a reporting duty in its prompt. Six edits to files
already in the repo.

## The bridge

```
captain or crewmate
      │  bash
      ▼
hablo-jira comment --key PROJ-123 --stage spec --body @spec.md
      │
      ▼  net/http, Basic auth, JIRA_* read from ~/.hablo/jira/.env
  POST /rest/api/3/issue/PROJ-123/comment
```

**Decision: one Go module, two binaries.** `jira/` holds
`cmd/hablo-jira` (this document) and `cmd/hablo-jira-agent` (the daemon), over a
shared `internal/jira`, `internal/adf`, and `internal/config`. The daemon already
needs a Jira client, an ADF-to-Markdown walker, and a project map; building a
second, different path to the same API for the reporting half would be two
clients to keep correct and two sets of credentials to keep working.

**Decision: the binary reads the credential, the agent never holds it.** Nothing
exports `JIRA_API_TOKEN` into a Pi session. The CLI loads `~/.hablo/jira/.env`
itself, the same way the daemon does, so the token never enters an agent's
environment, its context, or a transcript. The guard in [HOOKS.md](HOOKS.md)
already denies a `read` of any `**/.env`, which covers this file without a new
rule.

**Decision: bodies come from a file or stdin, never from an argument.**
`--body @path` or `--body -`. A multi-paragraph comment on a command line is a
quoting hazard, it lands in shell history, and it collides with the guard's shell
rules. The agent writes the artifact it already has and points the CLI at it.

**Decision: attribution is read from the environment, not passed in.** In a
crewmate pane `FM_TASK_ID` is set, and the branch comes from `git -C <cwd>`. The
agent supplies the key, the stage, and the body; the CLI supplies who and where.
Fewer flags is fewer things for a model to get wrong.

**Decision: only the standard library.** Jira is a JSON REST API over HTTP.
`net/http`, `encoding/json`, `os/exec`, and `flag` cover it, the same rule
`JIRA-AGENT.md` sets for the daemon.

### Why not MCP

The previous revision specified `pi-mcp-adapter` with Atlassian's official remote
server. Three findings, all checked on 2026-09-13, moved the decision:

- The current endpoint is `https://mcp.atlassian.com/v2/mcp`; the v1 endpoints
  were deprecated after 30 June 2026, which has passed.
- Headless authentication needs an organisation admin to enable API token
  authentication for the Rovo MCP server. That is a dependency on somebody else's
  Atlassian admin before a crewmate can comment.
- The adapter stores OAuth credentials in the operating system credential store
  and fails closed when that store is unavailable, which on headless Linux means
  an unlocked keyring in every crewmate pane.

Any one of those is survivable. Together they put a browser flow, an admin
request, and a keyring between an agent and a one-line comment, for an API our
own daemon already has to speak. The official server stays the better answer for
a human's interactive session, and nothing here stops anyone from adding it to
their own `~/.config/mcp/mcp.json`.

`tasks-axi` was the other candidate, since step 11 already installs it. Version
0.2.5 ships the markdown backend only, and its README still lists github, jira,
and linear as planned. Recheck when it moves; it would replace this CLI with one
the agents already have.

## The commands

| Command | What it does |
| --- | --- |
| `hablo-jira comment --key <K> --stage <s> --body @<f>` | One comment, headed by the stage, attributed to the crewmate. |
| `hablo-jira transition --key <K> --to in-progress\|in-review` | Logical name to the project's workflow, never to a Done status. |
| `hablo-jira read --key <K>` | The issue as Markdown: summary, type, priority, status, description, acceptance criteria. |
| `hablo-jira search --jql '<jql>' [--limit N]` | Key, summary, and status per line. |
| `hablo-jira doctor [--key <K>]` | Auth check, the project map, and the transitions the real workflow offers for that ticket. |
| `hablo-jira version` | Version. |

`--dry-run` on `comment` and `transition` prints the request and sends nothing.
`--quiet` suppresses success output, so a stage that reports cleanly adds nothing
to the transcript.

### Exit codes

| Code | Meaning | What the agent does |
| --- | --- | --- |
| 0 | Done | Continue |
| 3 | Not configured (no credential, tracker off, project not mapped) | Continue silently; this is the normal state on an unconfigured machine |
| 4 | Jira refused or is unreachable | Note the failed update in the stage report and continue |

**The tracker never stops the build.** This is the opposite of the guard in
[HOOKS.md](HOOKS.md), and deliberately so: a guard that cannot decide must
refuse, and a reporter that cannot report must keep working. The installer takes
the same line already; AWS login and entitlement-probe failures were made
non-fatal in commit c0e0c9c.

### Idempotency

Every comment carries a trailing marker line, `hablo: stage=<s> run=<id>`. Before
posting, `comment` reads the issue's recent comments and skips a post whose
marker matches exactly. A crewmate that retries a stage, or a captain that reruns
a workflow, does not double-post. Comments are otherwise append-only: a single
running comment edited in place would read better and would destroy the history,
and the history is what tells you where the work went wrong.

## Cadence

| Stage | Agent | Comment says | Artifact |
| --- | --- | --- | --- |
| Triage | `product-triage` | Requirements read and judged actionable, or the specific questions blocking it | the refined ticket text |
| Spec | `software-architect` | The implementation approach and the files it will touch | `spec.files` |
| Tests | `test-author` | Test suite written from the requirements, and what is still uncovered | test file paths |
| Implementation | `implementer` | What was built, and anything flagged | commit SHAs, branch name |
| Review | `review-round` | Verdict and the actionable findings | PR URL |
| Done | pipeline | Outcome | merge commit, PR URL |

Rules for the comment body: state the fact, name the artifact, link it. Never
restate the ticket back at the reader. A failed stage comments too and says what
failed. A skipped stage says nothing.

**Decision: each crewmate comments for its own stage.** The comment names the
crewmate and the branch that produced the artifact, so the timeline shows who did
what. The captain aggregating would read more cleanly and would lose the record
whenever a crewmate dies without reporting back. Six comments per ticket is the
expected volume, and the volume is the audit trail.

## Transitions

Separate from comments, and they need write scope on the workflow.

- To the project's in-progress status when triage returns `ready: true`.
- To the project's in-review status when the PR is opened.
- Never to a status in the Done category. Agents do not close tickets.

**Decision: status names are per project, in the manifest.** "In Progress" is not
a universal name, and a hardcoded pair breaks on the first project with a custom
workflow. `hablo-jira doctor --key PROJ-123` prints the transitions the real
workflow offers for that ticket, so a human fills the map in once.

**The Done rule is enforced in the code, not only in the policy.** `transition`
reads the target's `statusCategory` from the transitions endpoint and refuses any
target in the Done category, whatever the map says. That is what makes a
collision with existing Jira automation survivable: if the project already moves
issues on PR events, the worst our transition can do is repeat a move somebody
else already made. The two-tier branch model makes the alternative genuinely
dangerous, because crewmate PRs merge `fm/<id>` into `<JIRA-KEY>` long before
`<JIRA-KEY>` reaches `develop`, and a rule that closes on merge would close a
ticket whose work is still unintegrated.

## Reads

Agents read the ticket through the same binary. A crewmate pulls the acceptance
criteria with `hablo-jira read --key PROJ-123` instead of relying on what the
captain pasted into the brief, which is the step that silently loses detail. The
`internal/adf` walker the daemon needs for its briefs is the same walker that
renders this output, so reads cost one subcommand.

## Configuration

One `jira` block in `hablo.json` replaces the `tracker` block this document used
to propose and the `jiraAgent` block in `JIRA-AGENT.md`. Both binaries read one
rendered file, `~/.hablo/jira/config.json`, and one credential file,
`~/.hablo/jira/.env`, mode 0600, populated by `task secrets` from Infisical.

```jsonc
{
  "jira": {
    "$comment": "Shared by hablo-jira (agents report progress) and hablo-jira-agent (the dispatch daemon). Credentials are never stored here: the binaries read envFile, which `task secrets` populates from Infisical.",
    "enabled": true,
    "home": "~/.hablo/jira",
    "envFile": "~/.hablo/jira/.env",
    "envVars": ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    "projects": {
      "PROJ": {
        "dir": "~/code/foo",
        "baseBranch": "develop",
        "mode": "direct-PR",
        "statuses": { "inProgress": "In Progress", "inReview": "In Review" }
      }
    },
    "reporting": {
      "enabled": true,
      "transitions": true,
      "stages": ["triage", "spec", "tests", "implementation", "review", "done"]
    },
    "agent": {
      "$comment": "The dispatch daemon; see JIRA-AGENT.md for every key here.",
      "enabled": true,
      "intervalSeconds": 20,
      "labels": { "ready": "agent-ready", "running": "agent-running", "done": "agent-done", "failed": "agent-failed" }
    }
  }
}
```

`projects` is the allowlist for both halves: the daemon's JQL names exactly these
keys, and `hablo-jira` returns exit 3 for a key outside the map rather than
commenting on a ticket in a project nobody mapped.

`reporting.enabled: false` turns off agent comments and leaves the daemon
running. `enabled: false` at the top turns off both, and `--no-tracker` on the
command line does the same for one run.

## Credential preflight

Two outcomes, run at install time.

**Configured.** `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` are all present in
the env file. Run `hablo-jira doctor`, print `jira: authorized as <email>`, and
continue.

**Not configured.** Print this and continue:

```
jira: not configured. Agents will skip ticket updates until credentials exist.

  Create an API token at
      https://id.atlassian.com/manage-profile/security/api-tokens
  then add to your .env (via `task secrets`):
      JIRA_URL=https://yourcompany.atlassian.net
      JIRA_EMAIL=you@example.com
      JIRA_API_TOKEN=<the token>
  and re-run the installer.
```

That API-token URL is correct and may be printed as-is. The installer never
writes a credential value into any file it renders.

## Installer wiring

The step that builds the daemon builds both binaries, because they are one
module. `hablo-jira` installs whenever `jira.enabled` is true, even when
`--skip-jira-agent` skips the daemon and its service unit: reporting is useful on
a machine that dispatches nothing.

The policy block follows the pattern `captain-branch-policy.md` and
`captain-openwiki-policy.md` already use: a source file in `firstmate/`, a key in
`hablo.json`, and one `captainBlock("TICKET-POLICY", …)` call in step 9.

`firstmate/captain-ticket-policy.md` carries the cadence table as literal command
lines, not as a description. A crewmate that has to invent the flags will invent
them differently every time. It also carries the propagation line the other two
policies use, so the duty reaches each crewmate's task text.

`backup.config` gains `.hablo/jira/config.json`. The env file is a secret and
belongs in `backup.essentials` beside `.bedrouter/.env`.

## Verify before you build

1. **The comment endpoint and the ADF body shape.**
   `POST /rest/api/3/issue/{key}/comment` takes an ADF document, not text. The
   daemon needs ADF in the other direction; this is the same structure written
   rather than read.
2. **The transitions endpoint.** `GET /rest/api/3/issue/{key}/transitions`, and
   that each entry carries `to.statusCategory.key` so the Done refusal can be
   enforced from the response rather than from a name.
3. **Rate limits.** Six comments per ticket across a fleet is real write traffic,
   and Atlassian publishes no number for it. Confirm that a 429 carries
   `Retry-After`, and implement one retry that honours it, then exit 4. Never
   block a build on a retry loop.
4. **Comment search for the marker.** Confirm the comment list endpoint supports
   enough ordering or paging to check recent comments cheaply, so the dedupe does
   not read a hundred comments on a busy ticket.
5. **`FM_TASK_ID` in a crewmate pane. Verified 2026-09-13 from the installed
   firstmate launch path.** `fm-spawn.sh` exports it for ship and scout panes on
   every backend. Secondmates deliberately do not receive it because they run in
   their own home; Jira reporting therefore attributes an unmarked caller as the
   captain rather than inventing an identity.
