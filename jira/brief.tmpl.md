Work Jira ticket {{.Key}}.

**Summary:** {{.Summary}}
**Type:** {{.IssueType}} · **Priority:** {{.Priority}} · **Reporter:** {{.Reporter}}
**Repository:** {{.Dir}} · **Base branch:** {{.BaseBranch}}
**Delivery contract:** mode={{.Mode}}

**Authoritative Jira key:** `{{.Key}}` — use this exact string for `--base-branch`, the crewmate brief's `## Captain's intent` leading `KEY:` line, commit subjects, PR titles, and `hablo-jira` calls. Do not rename the project prefix (OpenWiki is a wiki tool, not a Jira project).

## Description

{{.Description}}

{{if .Comments}}## Ticket comments (oldest first)
{{range .Comments}}
### {{.Author}}, {{.Created}}
{{.Body}}
{{end}}{{end}}

## How this run must finish

Your standing branch, wiki, and ticket policies in `data/captain.md` apply. Continue an existing `{{.Key}}` branch when present.

Keep `{{.Key}}` current as you work: HABLO posts a progress comment after each successful commit and comments + moves the ticket to In Review when a PR is opened. Prefer that automatic path; if it missed, run `hablo-jira progress` / `hablo-jira pr-opened` yourself. Stage comments remain for artifact handoffs. Never transition the ticket to Done.

When the voyage ends (PR open or blocked), record the outcome for dispatch:

    hablo-jira-agent report --key {{.Key}} --outcome done --pr <pull-request-url> --summary "<one line>"
    hablo-jira-agent report --key {{.Key}} --outcome failed --summary "<what blocked you>"

Do not merge the pull request and do not close the ticket. A human does both.
