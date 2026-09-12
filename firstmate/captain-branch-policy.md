<!-- HABLO:BRANCH-POLICY:START -->
## Branch and PR policy (HABLO)

Development happens on feature branches named after the Jira ticket; nothing targets the default branch directly.

- Every task must name a Jira key (for example `PROJ-123`). If the captain's request has none, ask for it before dispatching; do not guess.
- The integration branch for a task is `<JIRA-KEY>` on `origin`. Before dispatching, make sure it exists: `git fetch origin && (git rev-parse --verify -q origin/<JIRA-KEY> || git push origin origin/HEAD:refs/heads/<JIRA-KEY>)`.
- Put these instructions verbatim in each crewmate's task text:
  1. After `git checkout -b fm/<id>`, run `git fetch origin <JIRA-KEY> && git reset --hard origin/<JIRA-KEY>` so the work starts from the ticket branch, not the default branch.
  2. Commit as usual on `fm/<id>`. Commit messages and the PR title start with `<JIRA-KEY>:`.
  3. When opening the PR, target the ticket branch: `gh pr create --base <JIRA-KEY> --head fm/<id> ...`. Never open a PR against the default branch.
- When several crewmates work one ticket, they all target `<JIRA-KEY>`; the captain merges `<JIRA-KEY>` to the default branch through the team's normal PR when the ticket is done.
- `local-only` delivery mode merges into local `main` and is therefore not allowed under this policy; use `direct-PR` or the no-mistakes pipeline.
<!-- HABLO:BRANCH-POLICY:END -->
