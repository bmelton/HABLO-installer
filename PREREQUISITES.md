# Prerequisites

Complete this list before you run `./install.sh`. Each item names the step or feature that needs it. Items marked
*optional* turn on one feature and the installer runs without them.

Run `node install.mjs check` to see which items this machine is missing. The installer prints the same checklist
first on every run. A missing *required* item (Node.js 20, the Pi CLI, or AWS CLI v2 when the AWS step runs) stops
the install before it writes anything. A missing *recommended* item turns off a feature and appears again in the
warnings at the end.

## Platform

- [ ] macOS or Linux. Steps 13 and 14 install a launchd agent on macOS or a systemd user timer on Linux.
- [ ] macOS, if you want Jira captains confined to `jira.root`. The sandbox uses `sandbox-exec`, which only macOS has.
- [ ] Network access to github.com, registry.npmjs.org, and kunchenguid.github.io.
- [ ] `~/.local/bin` on your `PATH`. The `hablo`, `hablo-jira`, `hablo-jira-agent`, and `hablo-dream` commands go there.
- [ ] An npm global prefix that you can write to without `sudo` (nvm, or `npm config set prefix ~/.npm-global`).

## Command-line tools

- [ ] Node.js 20 or later. The installer itself needs it.
- [ ] Node.js 22 or later, *optional*, for OpenWiki.
- [ ] npm, bun, or pnpm. `--install-pi` and the step 11 `*-axi` tools use it.
- [ ] The Pi CLI (`@earendil-works/pi-coding-agent`) 0.85.0 or later, or run the installer with `--install-pi`.
- [ ] AWS CLI version 2. Version 1 has no `aws configure sso`, no `sso-session` profiles, and no
      `aws bedrock get-use-case-for-model-access`.
- [ ] git.
- [ ] gh (GitHub CLI), signed in with `gh auth login`. firstmate, the Jira agent preflight, Dream, and team stats use it.
- [ ] tmux. firstmate runs its crew in tmux, and the Jira agent starts each captain in a tmux session.
- [ ] jq. firstmate uses it to validate `config/crew-dispatch.json`.
- [ ] Go 1.22 or later. Steps 13 and 14 build the Jira and Dream binaries from source. Without Go, both steps are
      skipped.
- [ ] curl. Step 11 uses it to install `treehouse` and `no-mistakes`.
- [ ] go-task, *optional*, to run the `Taskfile.yml` tasks.
- [ ] The Infisical CLI, *optional*, for `task secrets`.

## AWS and Bedrock

The README section "Before you run it" has the full procedure.

- [ ] An AWS CLI profile, `bedrouter` by default, made with `aws configure sso`.
- [ ] A valid SSO session: `aws sso login --profile bedrouter`. The token expires after about 8 to 12 hours.
- [ ] A role that has `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`.
- [ ] *Recommended*: the read-only Bedrock actions `ListFoundationModels`, `GetFoundationModel`,
      `ListInferenceProfiles`, `GetInferenceProfile`, and `GetFoundationModelAvailability`. The probe uses them to
      explain a denial.
- [ ] Model access in the Bedrock region, `us-east-1` for the default stack.
- [ ] Anthropic's one-time use-case form, submitted from the Bedrock model catalog.
- [ ] On a personal account, one call to a Claude model in the console playground as an admin. That call makes the
      Marketplace subscription that a restricted role cannot make.

## Jira

- [ ] A Jira Cloud site URL, the account email, and an API token from id.atlassian.com.
- [ ] Those three values as `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `~/.config/secrets/JIRA` (the
      `envSource`). Otherwise the installer writes an empty stub at `~/.hablo/jira/.env` for you to fill in.
- [ ] Each Jira project key mapped in `hablo.json` under `jira.projects`. The key is the issue prefix, for
      example `HAB`, not the project name.
- [ ] Each mapped repository cloned at its `dir`, with an `origin` remote and its `baseBranch` on that remote.
- [ ] The workflow statuses named in `statuses` (`In Progress` and `In Review` by default) present in the Jira
      project.
- [ ] The token's account able to edit labels, add comments, and move issues. The agent claims a ticket by
      changing its labels.

## Team stats (optional)

- [ ] The `bedrouter-stats` repository created on GitHub and named in `bedrouter.publish.repo` in `hablo.json`.
- [ ] A credential on each machine: `gh auth login`, or `BEDROUTER_PUBLISH_TOKEN` in `~/.bedrouter/.env`. The
      token comes from Infisical.

## Other optional features

- [ ] A ChatGPT seat and `codex login`, for the `codex` rung. It ships disabled.
- [ ] `herdr`, if you pass `--backend herdr` to firstmate. The default backend is tmux.
- [ ] Claude Code session history, if you want Dream to read it (`dream.sources.claudeCode`).
