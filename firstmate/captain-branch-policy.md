<!-- HABLO:BRANCH-POLICY:START -->
## Branch and PR policy (HABLO)

Development happens on feature branches named after the Jira ticket, cut from and merged back into `__BASE__`. Nothing targets the repository's default branch directly; promoting `__BASE__` to the default branch is a release step done by humans.

- Every task must name a Jira key (for example `PROJ-123`). If the captain's request has none, ask for it before dispatching; do not guess.
- The integration branch for a task is `<JIRA-KEY>` on `origin`, cut from `origin/__BASE__`. Before dispatching, make sure it exists: `git fetch origin && (git rev-parse --verify -q origin/<JIRA-KEY> || git push origin origin/__BASE__:refs/heads/<JIRA-KEY>)`. If `origin/__BASE__` itself does not exist, stop and ask the captain rather than falling back to the default branch.
- Put these instructions verbatim in each crewmate's task text:
  1. After `git checkout -b fm/<id>`, run `git fetch origin <JIRA-KEY> && git reset --hard origin/<JIRA-KEY>` so the work starts from the ticket branch, not the default branch.
  2. Commit as usual on `fm/<id>`. Commit messages and the PR title start with `<JIRA-KEY>:`.
  3. When opening the PR, target the ticket branch: `gh pr create --base <JIRA-KEY> --head fm/<id> ...`. Never open a PR against `__BASE__` or the default branch.
- When several crewmates work one ticket, they all target `<JIRA-KEY>`; when the ticket is done the captain opens the team's normal PR from `<JIRA-KEY>` into `__BASE__` (`gh pr create --base __BASE__ --head <JIRA-KEY> ...`), never into the default branch.
- `local-only` delivery mode merges into the local default branch and is therefore not allowed under this policy; use `direct-PR` or the no-mistakes pipeline.
<!-- HABLO:BRANCH-POLICY:END -->
