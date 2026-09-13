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

Your standing branch, wiki, and ticket policies in `data/captain.md` apply. Continue an existing `{{.Key}}` branch when present.

    hablo-jira-agent report --key {{.Key}} --outcome done --pr <pull-request-url> --summary "<one line>"
    hablo-jira-agent report --key {{.Key}} --outcome failed --summary "<what blocked you>"

Do not merge the pull request and do not close the ticket. A human does both.
