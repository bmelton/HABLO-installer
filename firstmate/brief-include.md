<!-- HABLO:BRIEF-INCLUDE:START -->
## Jira reporting (HABLO)

This block is standing home policy appended to every ship and scout brief. Follow it whenever this task names a Jira key (Captain's intent, `Base branch:`, or the task text).

Jira is private. Never use `web_search`, a browser, or any open-web fetch for ticket content. Use `hablo-jira` only; do not read its `.env`.

The Jira key is exact — the same string as `Base branch:` (for example `ORIGINOPS-4433`). Never invent or rename the project prefix. OpenWiki is a wiki tool, not a Jira project; never write `OPENWIKI-…` as a ticket key.

Keep the ticket current for stages you actually perform. A reporting failure never stops delivery.

- Triage: `hablo-jira comment --key <JIRA-KEY> --stage triage --body @<refined-ticket-file> --quiet`
- Ready for work: `hablo-jira transition --key <JIRA-KEY> --to in-progress --quiet`
- Spec: `hablo-jira comment --key <JIRA-KEY> --stage spec --body @<spec-file> --quiet`
- Tests: `hablo-jira comment --key <JIRA-KEY> --stage tests --body @<test-report-file> --quiet`
- Implementation: `hablo-jira comment --key <JIRA-KEY> --stage implementation --body @<implementation-report-file> --quiet`
- Review: `hablo-jira comment --key <JIRA-KEY> --stage review --body @<review-report-file> --quiet`
- PR opened: `hablo-jira transition --key <JIRA-KEY> --to in-review --quiet`
- Pipeline outcome: `hablo-jira comment --key <JIRA-KEY> --stage done --body @<outcome-file> --quiet`

Bodies state the result, name the artifact, and link it. Do not restate the ticket. Skipped stages make no comment. Never transition a ticket to Done; a human closes it.

For lookup: `hablo-jira read --key <JIRA-KEY>`, `hablo-jira search --jql '<jql>'`, `hablo-jira doctor [--key <JIRA-KEY>]`.
<!-- HABLO:BRIEF-INCLUDE:END -->
