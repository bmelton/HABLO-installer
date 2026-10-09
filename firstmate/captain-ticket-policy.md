<!-- HABLO:TICKET-POLICY:START -->
## Jira

Jira is private. Never use `web_search`, a browser, or any open-web fetch for ticket content. Credentials are loaded by the `hablo-jira` CLI from its env file; do not read `.env` yourself.

### Lookup

For any issue key, summary, description, comments, status, or search:

- `hablo-jira read --key <JIRA-KEY>`
- `hablo-jira search --jql '<jql>'`
- `hablo-jira doctor [--key <JIRA-KEY>]` when auth or transitions look wrong

Include this lookup rule in every relevant crewmate brief.

### Reporting

Keep the Jira ticket current throughout a ticket workflow. Include this duty verbatim in every relevant crewmate brief; each crewmate reports its own stage and a reporting failure never stops delivery.

- Triage: `hablo-jira comment --key <JIRA-KEY> --stage triage --body @<refined-ticket-file> --quiet`
- Ready for work: `hablo-jira transition --key <JIRA-KEY> --to in-progress --quiet`
- Spec: `hablo-jira comment --key <JIRA-KEY> --stage spec --body @<spec-file> --quiet`
- Tests: `hablo-jira comment --key <JIRA-KEY> --stage tests --body @<test-report-file> --quiet`
- Implementation: `hablo-jira comment --key <JIRA-KEY> --stage implementation --body @<implementation-report-file> --quiet`
- Review: `hablo-jira comment --key <JIRA-KEY> --stage review --body @<review-report-file> --quiet`
- PR opened: `hablo-jira transition --key <JIRA-KEY> --to in-review --quiet`
- Pipeline outcome: `hablo-jira comment --key <JIRA-KEY> --stage done --body @<outcome-file> --quiet`

Bodies state the result, name the artifact, and link it. Do not restate the ticket. Skipped stages make no comment. Never transition a ticket to Done; a human closes it.
<!-- HABLO:TICKET-POLICY:END -->
