# HABLO installer

One command that takes a machine with Node and Pi on it to the HABLO setup: Pi packages, the bedrouter model router in front of AWS Bedrock, OpenWiki navigation tools, the agent profiles and workflows, and the pi-agents model notes that make the planner default to the router.

```sh
git clone <this repo> && cd HABLO-installer
./install.sh --profile <aws-sso-profile>            # e.g. --profile <username>
```

Idempotent: run it again any time; it only changes what differs and never overwrites your agent profiles unless told to. `--dry-run` prints the plan without writing anything.

## What it does

| Step | Action | Where |
| --- | --- | --- |
| 1 | Checks node, pi, aws, git; notes whether `openwiki` is installed (optional, Node 22+) | |
| 2 | `pi install` for every package in `hablo.json` not already listed | `~/.pi/agent/settings.json` → `packages`, code under `~/.pi/agent/npm/` |
| 3 | Adds the `bedrouter/*` models to `enabledModels` (the allowlist hides everything else), a few UX settings if unset; `--default-model` also makes `bedrouter/auto` the default | `~/.pi/agent/settings.json` |
| 4 | Writes pi-bedrouter settings (server home, auto-select model, stop-on-exit policy), a `.env` with `AWS_PROFILE`, and a `bedrouter.json` ladder copied from the installed package's example with routing set for the demo (`honorClientModel: false`, classifier on) | `~/.pi/agent/pi-bedrouter.json`, `~/.bedrouter/` |
| 5 | If the AWS profile is missing, runs `aws configure sso --profile <p>` (interactive); if credentials are expired, runs `aws sso login` | `~/.aws/config`, SSO token cache |
| 6 | **Entitlement probe**: one 1-token request per rung. Rungs this account cannot invoke are swapped for fallbacks from the manifest (opus-5 → opus-4.8 → 4.7; sonnet-5 → sonnet-4.6) and re-probed; rungs with no working fallback are dropped and the routing classes repaired | `~/.bedrouter/bedrouter.json` |
| 7 | Installs the six agent profiles and two workflows (`--force-agents` to overwrite existing ones) | `~/.pi/agent/agents/`, `~/.pi/workflows/` |
| 8 | Merges pi-agents model notes so the planner defaults to `bedrouter/auto` and pins premium rungs only for planning/review | `~/.pi/agent/workflows.json` |
| 9 | Clones (or fast-forwards) [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) and sets its crew harness to `pi`; checks for git, gh (authenticated) and tmux | `~/firstmate` (`--firstmate-dir`), `config/crew-harness` |

Then: `pi --provider bedrouter --model auto` (or `auto-oss` with `--ladder oss`). For firstmate: `cd ~/firstmate && pi` — its `AGENTS.md` takes over the session, and it spawns crewmates as plain `pi` processes in tmux. Those crewmates use Pi's **default** model, so pass `--default-model` to the installer if you want every crewmate routed through bedrouter (the footer, log and report then cover the whole crew). pi-bedrouter starts the server on first use, shows what served each request in the footer, and `/bedrouter status|probe|report`, `/openwiki doctor` work from inside Pi.

## Options

| Flag | Meaning |
| --- | --- |
| `--profile <name>` | AWS profile for bedrouter (`AWS_PROFILE` in `~/.bedrouter/.env`). Any SSO profile works; the name is whatever `aws configure sso` produced |
| `--ladder claude \| oss` | Which family `auto` should point at (`claude` default). Both ladders are installed; this picks the auto-selected model and the model notes' default |
| `--optional` | Also install the optional packages (web access, vision handoff, impeccable, codex usage) |
| `--default-model` | Make `bedrouter/auto` Pi's default model, not just the auto-selected one |
| `--home <dir>` | bedrouter working dir (default `~/.bedrouter`): `.env`, `bedrouter.json`, decision log, server log |
| `--skip-aws` `--skip-probe` `--skip-agents` `--skip-firstmate` | Skip a step |
| `--firstmate-dir <dir>` | Where to clone firstmate (default `~/firstmate`) |
| `--force-agents` | Overwrite existing agent profiles / workflows with the bundled ones |
| `--dry-run` | Print, don't write |

## Prerequisites

Node 20+ (22+ if you also want OpenWiki), Pi (`npm install -g @earendil-works/pi-coding-agent`), the AWS CLI for SSO login, git. An AWS principal allowed to call Bedrock (`bedrock:InvokeModel*`; the read-only `bedrock:List*`/`Get*` help the probe explain itself). On a personal account the bedrouter README describes the IAM Identity Center setup; on a corporate account `aws configure sso` against the corporate start URL is all it takes.

## Files

- `install.mjs` / `install.sh` — the installer (zero dependencies)
- `hablo.json` — the manifest: packages, model allowlist, settings, ladder presets, entitlement fallbacks. Edit this, not the script
- `bedrouter.example.json` — fallback ladder if the installed bedrouter package has none (it always does; kept for `--dry-run` before install)
- `pi/agents/*.md`, `pi/workflows/*.md` — snapshots of the HABLO agent profiles and workflows. The source of truth is the dotfiles repo; refresh the snapshots from there before a release
- `CHECKLIST.md` — the demo-morning runbook

## firstmate

firstmate is not a Pi package; it is an "agent distro": a git checkout whose `AGENTS.md` turns whatever harness you launch inside it (Pi here) into an orchestrator that spawns and supervises a crew. The installer only clones it, keeps it fast-forwarded, and writes `config/crew-harness = pi` so crewmates are Pi sessions rather than whatever harness was detected. It needs `gh auth login` done once (firstmate's GitHub flows) and `tmux` (its reference crew runtime; herdr and others are alternatives configured inside firstmate, not here).

## What it deliberately does not do

It does not manage `~/.aws/config` beyond running the AWS CLI's own wizard, does not store credentials anywhere, does not install OpenWiki (Node 22 and a provider choice are yours), and does not touch projects: OpenWiki wikis and `.pi/openwiki.json` are per repository.
