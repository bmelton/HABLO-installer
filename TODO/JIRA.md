# Ticket updates: agents report progress to Jira

> Status: capture, not a finished spec. The cadence table and the decisions are
> settled. The Atlassian MCP endpoint URL is the one thing below that is written
> from memory and must be verified before the installer prints it to anyone.

- [ ] Verify the Atlassian remote MCP endpoint URL, its OAuth scopes, and its real tool names
- [ ] Add `npm:pi-mcp-adapter` to `pi.packages` in `hablo.json`
- [ ] Add a `tracker` block to `hablo.json` (`on`/`off`, server definition, `directTools` list)
- [ ] New installer step: render the server into `~/.pi/agent/mcp.json`
- [ ] New installer step: the credential preflight (below), non-fatal, with the link and instructions
- [ ] Write `firstmate/captain-ticket-policy.md` from the cadence table
- [ ] Wire `captainBlock("TICKET-POLICY", ...)` into `install.mjs` step 9
- [ ] Add `--tracker` / `--no-tracker` and the usage header line
- [ ] Add the reporting duty to the existing agent profiles in `pi/agents/` (do not add new agents)
- [ ] Document it in `README.md`

## What this is

Agents must keep the ticket current without being asked. The standard to hold
them to is a good junior developer: the ticket says what has been done, what is
happening now, and where the artifact is, so nobody has to go and ask.

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
The requirements-evaluation agent asked about already exists: it is
`pi/agents/product-triage.md`, "evaluates incoming tickets for readiness, decides
if a ticket is actionable or needs more information". It returns
`{ ready, refined_ticket, questions, report }`, which is exactly the payload of
the first comment.

Each existing profile gains a reporting duty in its prompt. Six edits to files
already in the repo.

## Decisions

**The bridge is `pi-mcp-adapter` plus Atlassian's official remote MCP server.**
Pi has no built-in MCP (`docs/usage.md` says so outright), so the adapter is the
missing piece. The official server is the reason this is acceptable: a search of
npm turns up a dozen community Jira MCP servers, all one-person packages, and
handing any of them a token that carries full Jira permissions is a supply-chain
exposure we do not need to take. Atlassian runs the official one.

Two properties of the adapter shape the rest:

1. It does not expose MCP tools individually. It exposes one proxy tool, about
   200 tokens, and the agent discovers what it needs: `mcp({ search: "comment" })`
   then `mcp({ tool: "...", args: {...} })`. Servers connect lazily, on first
   use. Its `directTools` setting promotes chosen tools to first-class names, so
   the policy text can name them directly.
2. It handles remote HTTP servers and OAuth natively: `url` (StreamableHTTP with
   SSE fallback), `auth: "oauth"`, and `oauth.grantType` of either
   `authorization_code` (browser, the default) or `client_credentials` for
   non-interactive machine auth. **OAuth credentials go to the operating system
   credential store, keyed by server name and bound to the server URL.** They are
   never written into a config file, which satisfies the house rule about secrets
   without any work on our part.

**One comment per pipeline stage, plus status transitions.** Six comments on a
normal ticket, each carrying its artifact. The timeline is the point: a single
running comment edited in place would read better at a glance but would destroy
the history, and the history is what tells you where the work went wrong.

**The installer never blocks on the tracker.** See failure behavior below.

## Credential preflight

You asked the installer to check the environment and, when nothing is there, to
point at where to create credentials. With the official remote MCP the usual
answer is not an API key in the environment, so the check has three outcomes
rather than two. Run them in this order and stop at the first that succeeds.

**1. Already authorized.** The adapter exposes `pi-mcp-adapter/oauth` for exactly
this: `getMcpOAuthTokensForUrl(name, url)` plus a status helper, reading the OS
credential store through the adapter's refresh logic. If a valid credential is
there, print `jira: authorized` and move on.

**2. Environment variables present.** Recognize `JIRA_URL`, `JIRA_EMAIL`, and
`JIRA_API_TOKEN`. If all three are set, configure the server with
`bearerTokenEnv` (or a `headers` entry, depending on what the endpoint accepts)
rather than OAuth. Per the house rule these come from `.env`, populated from
Infisical, and `hablo.json` references them by name only. No value ever lands in
a file this installer writes.

**3. Nothing configured.** Print this and continue:

```
jira: not configured. The agents will skip ticket updates until you authorize.

  Option A, OAuth (recommended): start pi and run
      /mcp
  then authorize the "jira" server in the browser window it opens. The token
  goes to your OS keychain, not to a file. Do this once per machine.

  Option B, API token: create one at
      https://id.atlassian.com/manage-profile/security/api-tokens
  then add to your .env (via `task secrets`):
      JIRA_URL=https://yourcompany.atlassian.net
      JIRA_EMAIL=you@example.com
      JIRA_API_TOKEN=<the token>
  and re-run the installer.
```

The API token URL above is correct. The MCP endpoint URL is not yet verified;
that is the first checklist item and the installer must not print an unverified
link.

### Headless crewmates

This is the part to watch. Browser OAuth is fine for the human running the
installer and impossible for a crewmate in a tmux pane. Three things make it
work anyway, and all three need confirming against a real run:

- The browser flow happens once, at install time, in front of a human.
- Credentials live in the OS credential store and the adapter refreshes them, so
  later sessions never see a browser.
- If the refresh token expires in a way that demands interaction, a crewmate must
  fail the update and keep building, never hang waiting on a prompt.

`oauth.grantType: "client_credentials"` is the escape hatch if that story does
not hold: non-interactive machine auth, at the cost of registering an OAuth
client with Atlassian.

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

Status transitions are separate from comments and need write scope on the
workflow:

- To *In Progress* when triage returns `ready: true`.
- To *In Review* when the PR is opened.
- To *Done* only when a human merges. Agents never close a ticket.

That last one is deliberate. A comment is cheap to undo; closing a ticket
somebody else is tracking is not.

Watch for collision with Jira automation rules. If the project already moves
issues on PR events, the agent transition and the automation will both fire. The
two-tier branch model makes this worse: crewmate PRs merge `fm/<id>` into
`<JIRA-KEY>` long before `<JIRA-KEY>` reaches `develop`, so a rule that closes on
merge would close the ticket while the work is still unintegrated.

## Failure behavior

The tracker is never allowed to stop the build. If the MCP server is down, the
credential expired, or the tracker is off, the agent notes the failed update in
its report and continues. The installer already takes this line: AWS login and
entitlement probe failures were made non-fatal in commit c0e0c9c because later
steps do not depend on them.

This is the opposite of the guard in `HOOKS.md`, which fails closed. A guard that
cannot decide must refuse; a reporter that cannot report must keep working.

## Installer wiring

`hablo.json`, a new top-level block:

```jsonc
{
  "tracker": {
    "$comment": "Jira ticket updates. --no-tracker skips the whole step. Credentials are never stored here: OAuth goes to the OS credential store, API tokens come from .env via Infisical and are referenced by name.",
    "enabled": true,
    "configFile": "~/.pi/agent/mcp.json",
    "server": {
      "name": "jira",
      "url": "__VERIFY_ATLASSIAN_MCP_URL__",
      "auth": "oauth",
      "lifecycle": "lazy"
    },
    "envVars": ["JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    "directTools": ["comment", "transition", "read", "search"]
  }
}
```

`~/.pi/agent/mcp.json` is the write target. It is the Pi-owned global override in
the adapter's precedence list, and HABLO already owns files under `.pi/agent/`
(several are listed in `backup.config`). Do not write the user's
`~/.config/mcp/mcp.json`: that file is shared with their other tools.

The policy block follows the pattern `captain-branch-policy.md` and
`captain-openwiki-policy.md` already use: a source file in `firstmate/`, a key in
`hablo.json`, and one `captainBlock("TICKET-POLICY", ...)` call in step 9.

## Open questions

- Six comments per ticket across a fleet of crewmates is real write traffic.
  Does Atlassian rate-limit this in a way that matters?
- Who owns the comment when several crewmates work one ticket? Each commenting
  separately is honest but noisy; the captain aggregating is cleaner but loses
  which crewmate did what.
- `tasks-axi` is already installed by step 11 and is exactly this shape, a task
  and backlog CLI for agents, but its README lists its jira backend as planned
  and ships only markdown today. If it lands, it replaces the MCP path with a CLI
  the agents already have. Worth one check before building.
- Should agents read the ticket through the same bridge, so a crewmate can pull
  acceptance criteria itself instead of getting them pasted into the brief?
