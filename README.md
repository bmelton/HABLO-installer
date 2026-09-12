# HABLO installer

One command that takes a machine with Node and Pi on it to the HABLO setup: Pi packages, the bedrouter model router in front of AWS Bedrock, OpenWiki navigation tools, the agent profiles and workflows, and the pi-agents model notes that make the planner default to the router.

```sh
git clone <this repo> && cd HABLO-installer
./install.sh --install-pi --profile <aws-sso-profile>            # e.g. --profile <username>
```

Idempotent: run it again any time; it only changes what differs and never overwrites your agent profiles unless told to. `--dry-run` prints the plan without writing anything.

## What it does

| Step | Action | Where |
| --- | --- | --- |
| 0 | With `--restore <tgz>`: puts personal state back from a `backup` archive; never overwrites a file that exists (`--force-restore` to override) | `~/.pi`, `~/.bedrouter` |
| 1 | Checks node, pi, aws, git; with `--install-pi`, installs `@earendil-works/pi-coding-agent` globally when `pi` is missing (skipped when present); notes whether `openwiki` is installed (optional, Node 22+) | global npm/bun/pnpm prefix |
| 2 | `pi install` for every package in `hablo.json`, **and every `npm:`/`git:` package already listed in your `settings.json`**, that is not present on disk — so packages you added yourself come back after a reinstall too | `~/.pi/agent/settings.json` → `packages`, code under `~/.pi/agent/npm/` |
| 3 | Adds the `bedrouter/*` models to `enabledModels` **if an allowlist already exists** (creating one would hide every other provider), a few UX settings only where unset; `--default-model` also makes `bedrouter/auto` the default | `~/.pi/agent/settings.json` |
| 4 | Writes pi-bedrouter settings (server home, auto-select model, stop-on-exit policy), a `.env` with `AWS_PROFILE`, and a `bedrouter.json` ladder copied from the installed package's example with routing set for the demo (`honorClientModel: false`, classifier on) | `~/.pi/agent/pi-bedrouter.json`, `~/.bedrouter/` |
| 5 | If the AWS profile is missing, runs `aws configure sso --profile <p>` (interactive); if credentials are expired, runs `aws sso login` | `~/.aws/config`, SSO token cache |
| 6 | **Entitlement probe**: one 1-token request per rung. Rungs this account cannot invoke are swapped for fallbacks from the manifest (opus-5 → opus-4.8 → 4.7; sonnet-5 → sonnet-4.6) and re-probed; rungs with no working fallback are dropped and the routing classes repaired | `~/.bedrouter/bedrouter.json` |
| 7 | Installs the six agent profiles and two workflows (`--force-agents` to overwrite existing ones) | `~/.pi/agent/agents/`, `~/.pi/workflows/` |
| 8 | Merges pi-agents model notes so the planner defaults to `bedrouter/auto` and pins premium rungs only for planning/review | `~/.pi/agent/workflows.json` |
| 9 | Clones (or fast-forwards) [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate); crew harness `pi`; `config/crew-dispatch.json` routing every crewmate through bedrouter; the branch-per-Jira-ticket policy in `data/captain.md`; optional `config/backend`; checks for git, gh (authenticated), tmux, jq | `~/firstmate` (`--firstmate-dir`) |

| 10 | Installs the `hablo` command and its Pi extension, so a firstmate captain can be started from any project directory (see [hablo](#hablo-firstmate-from-any-project-directory)) | `~/.local/bin/hablo` (`--bin-dir`), `~/.hablo/` |
| 11 | Installs the tools firstmate's bootstrap otherwise reports as `MISSING`: `gh-axi`, `chrome-devtools-axi`, `lavish-axi`, `tasks-axi`, `quota-axi` (`npm install -g`), and `treehouse`, `no-mistakes` (their own install scripts, into `~/.local/bin`, no sudo). Only what is absent; `--update-tools` reinstalls everything | npm's global prefix, `~/.local/bin`, `~/.no-mistakes/` |

Then: `pi --provider bedrouter --model auto` (or `auto-oss` with `--ladder oss`). For firstmate: `cd <your project> && hablo` (or `cd ~/firstmate && pi`) — firstmate's `AGENTS.md` takes over the session, and it spawns crewmates as `pi --model bedrouter/auto` processes in tmux, routed explicitly by the dispatch file the installer writes. pi-bedrouter starts the server on first use, shows what served each request in the footer, and `/bedrouter status|probe|report`, `/openwiki doctor` work from inside Pi.

## Options

| Flag | Meaning |
| --- | --- |
| `--profile <name>` | AWS profile for bedrouter (`AWS_PROFILE` in `~/.bedrouter/.env`). Any SSO profile works; the name is whatever `aws configure sso` produced |
| `--ladder claude \| oss` | Which family `auto` should point at (`claude` default). Both ladders are installed; this picks the auto-selected model and the model notes' default |
| `--install-pi` | Install the Pi CLI globally if `pi` is not on PATH; a no-op when it is. `--pi-manager npm\|bun\|pnpm` picks the tool (default: npm if present, else bun, else pnpm). If the manager's global bin dir is not on PATH, the installer still finds `pi` there for the rest of the run and prints the `export PATH=…` line to add to your shell rc |
| `--restore <tgz>` | Step 0: restore a `backup` archive (see below) |
| `--force-restore` | Let the restore overwrite files that already exist |
| `--default-model` | Make `bedrouter/auto` Pi's default model, not just the auto-selected one |
| `--home <dir>` | bedrouter working dir (default `~/.bedrouter`): `.env`, `bedrouter.json`, decision log, server log |
| `--skip-aws` `--skip-probe` `--skip-agents` `--skip-firstmate` | Skip a step |
| `--firstmate-dir <dir>` | Where to clone firstmate (default `~/firstmate`) |
| `--backend tmux \| herdr` | Write firstmate's `config/backend` (default: leave auto-detection, which is tmux) |
| `--no-branch-policy` | Don't write the Jira-branch policy into firstmate's `data/captain.md` |
| `--base-branch <name>` | Integration branch for the Jira-branch policy (default `develop` from the manifest) |
| `--skip-cli` `--bin-dir <dir>` `--cli-model <m>` | Skip the `hablo` command, install it somewhere other than `~/.local/bin`, or change the model it defaults to (default: the ladder's auto alias) |
| `--skip-tools` `--update-tools` | Skip firstmate's tool dependencies, or reinstall them even when present |
| `--force-agents` | Overwrite existing agent profiles / workflows with the bundled ones |
| `--dry-run` | Print, don't write |

## Backup, uninstall, reinstall

`node install.mjs backup` writes `~/hablo-backup-<timestamp>.tgz` containing the state that cannot be regenerated and does not live in dotfiles: `~/.pi/agent/auth.json` (OAuth logins), `trust.json`, and `~/.bedrouter/.env` + `bedrouter.json` if present. It also archives the config the installer or dotfiles would regenerate anyway (`settings.json`, `models.json`, `pi-bedrouter.json`, `workflows.json`, `agents/`, `~/.pi/workflows/`), following symlinks so the archive holds real content. Sessions, model caches and logs are **not** included unless you pass `--with-history`. `--restore <tgz>` puts entries back only where the destination is missing, so it is safe to run on a machine that already has some of it.

What is *not* in `~/.pi` and therefore unaffected by any of this: `~/.aws` (SSO profiles and token cache), `~/.dotfiles`, project repositories and their `openwiki/` directories, and the firstmate clone.

To uninstall Pi completely and rebuild it with this installer:

```sh
# 1. back up (auth + trust + config; add --with-history if you want sessions)
cd ~/projects/ai/HABLO-installer && node install.mjs backup

# 2. remove Pi and its state
which pi                                   # tells you how it was installed
npm uninstall -g @earendil-works/pi-coding-agent   # or: bun remove -g @earendil-works/pi-coding-agent
mv ~/.pi ~/.pi.old-$(date +%F)             # move, don't delete, until you're happy

# 3. reinstall Pi — by hand, or let step 5 do it via --install-pi
npm install -g @earendil-works/pi-coding-agent

# 4. on a dotfiles-managed machine, put the config symlinks back FIRST so the installer writes through them
cd ~/.dotfiles && stow -R pi

# 5. rebuild everything, restoring auth and trust
cd ~/projects/ai/HABLO-installer && ./install.sh --install-pi --profile <aws-profile> --restore ~/hablo-backup-<timestamp>.tgz

# 6. verify, then clean up
pi --list-models | grep -c bedrouter       # 7
./install.sh --profile <aws-profile> --dry-run   # every line should read "already installed / present / up to date"
rm -rf ~/.pi.old-*                         # when satisfied
```

Step 4 matters on machines where `~/.pi/agent/settings.json` and friends are stow symlinks into `~/.dotfiles/pi`: with the links in place, the installer edits the dotfiles copy (it says so: "settings.json is a symlink … dotfiles-managed"), and `--restore` leaves those files alone because they already exist. Skip step 4 on a machine without dotfiles; the installer then creates plain files.

## Before you run it: an AWS profile that can call Bedrock

The installer needs the name of an AWS CLI profile (`--profile <name>`); bedrouter uses it through the standard SDK credential chain, and the profile has to belong to a principal allowed to call Bedrock (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`; the read-only `bedrock:ListFoundationModels` / `GetFoundationModel` / `ListInferenceProfiles` / `GetInferenceProfile` / `GetFoundationModelAvailability` let the probe explain denials). Create it once per machine, before the installer, so step 5 finds it. Install the AWS CLI first if needed (`brew install awscli`).

**Corporate account (AWS IAM Identity Center / SSO).** Run the CLI's wizard and answer with your organisation's values:

```sh
aws configure sso --profile bedrouter
#   SSO session name:  anything, e.g. corp
#   SSO start URL:     your organisation's access portal URL (https://<something>.awsapps.com/start)
#   SSO region:        the region the portal lives in
#   → browser opens; sign in and approve the device
#   Account / role:    pick the account and the role that has Bedrock access
#   CLI default region: the Bedrock region you will use (us-east-1 for the default ladder)
#   CLI default output: json
```

The profile name is yours to choose; `bedrouter` keeps every command in this README valid. If your organisation already generated a profile for you (`aws configure list-profiles`), use that name with `--profile` instead — the name is arbitrary, only the `sso_role_name` behind it matters. Then:

```sh
aws sso login --profile bedrouter
aws sts get-caller-identity --profile bedrouter    # an arn:aws:sts::<account>:assumed-role/AWSReservedSSO_<role>_<hash>/<you> line
```

The SSO token expires (typically 8–12 hours); `aws sso login --profile bedrouter` again is the fix, and bedrouter's own startup check says so when it happens.

**Personal account.** Enable IAM Identity Center on the account, add a user, create a permission set with the Bedrock actions above, assign both to the account, submit Anthropic's one-time use-case form from the Bedrock model catalog, and make one call to a Claude model in the console playground as an admin (that performs the Marketplace subscription a restricted role cannot). The bedrouter README walks through it. The `~/.aws/config` entry then looks like:

```ini
[sso-session personal]
sso_start_url = https://d-xxxxxxxxxx.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile bedrouter]
sso_session = personal
sso_account_id = 123456789012
sso_role_name = BedrockInvoke
region = us-east-1
```

**If you skip this.** With `--profile` naming a profile that does not exist, step 5 runs `aws configure sso --profile <name>` for you (interactive, same questions as above); without `--profile` at all, the AWS and probe steps are skipped and `~/.bedrouter/.env` is written with a commented-out `AWS_PROFILE` for you to fill in. Static keys (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) or a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) in `~/.bedrouter/.env` work too; the installer never stores credentials itself.

## Prerequisites

Node 20+ (22+ if you also want OpenWiki), Pi (installed for you with `--install-pi`, or `npm install -g @earendil-works/pi-coding-agent`), the AWS CLI with a Bedrock-capable profile (previous section), git.

## Files

- `install.mjs` / `install.sh` — the installer (zero dependencies)
- `hablo.json` — the manifest: packages, model allowlist, settings, ladder presets, entitlement fallbacks. Edit this, not the script
- `bedrouter.example.json` — fallback ladder if the installed bedrouter package has none (it always does; kept for `--dry-run` before install)
- `pi/agents/*.md`, `pi/workflows/*.md` — snapshots of the HABLO agent profiles and workflows. The source of truth is the dotfiles repo; refresh the snapshots from there before a release
- `CHECKLIST.md` — the demo-morning runbook

## firstmate

firstmate is not a Pi package; it is an "agent distro": a git checkout whose `AGENTS.md` turns whatever harness you launch inside it (Pi here) into an orchestrator that spawns and supervises a crew in tmux (or herdr). The installer clones it, keeps it fast-forwarded, and writes three local, gitignored files inside it. It needs `gh auth login` done once, `tmux` (or herdr with `--backend herdr`), and `jq` (firstmate validates the dispatch file with it).

### Launching, with every crewmate routed

```sh
cd ~/firstmate
pi --provider bedrouter --model auto-oss        # or `auto` for the Claude ladder
> ahoy!
```

The first mate itself runs on bedrouter because you launched it that way. The crew is covered by `config/crew-dispatch.json`, which the installer writes so that every rule and the default resolve to `{ "harness": "pi", "model": "bedrouter/auto-oss" }` (whichever ladder you chose). firstmate passes those as concrete `--harness pi --model bedrouter/auto-oss` flags to `fm-spawn.sh`, so crewmates are routed explicitly, independent of Pi's default model. Tiering is therefore bedrouter's job per request, not the dispatcher's; the rules say so in their `why`, and the one escape hatch ("use the strongest model") raises Pi's thinking level, which bedrouter reads as an explore signal, rather than pinning a model. Verify once with `/bedrouter status` inside a crewmate's tmux window: it should say `using auto-oss`. `--default-model` additionally makes `bedrouter/auto-*` Pi's default, which covers any `pi` started outside firstmate.

If a `config/crew-dispatch.json` already exists that this installer did not write, it is left alone and the installer says so.

### Feature branches named after the Jira ticket

Out of the box firstmate cuts each crewmate's worktree at the default branch, has it work on `fm/<id>`, and in `direct-PR` mode the crewmate opens the PR itself with `gh`, whose default base is the repository's default branch. There is no base-branch setting to flip: none of firstmate's scripts pass `--base`, and `fm-spawn.sh` re-resolves `origin/HEAD` from the remote before every spawn, so the only script-free ways to change where work lands are the forge's default branch (`gh repo edit --default-branch develop`) or the captain's standing instructions, which is what the installer uses. What firstmate does have is `data/captain.md`, its canonical, always-loaded file of captain preferences, which the orchestrator reads before every dispatch. The installer writes a marked block into it (`firstmate/captain-branch-policy.md`, idempotent, never touching anything else in the file) that establishes the policy:

- the integration branch is `develop` (`firstmate.baseBranch` in the manifest, `--base-branch` to override): ticket branches are cut from `origin/develop` and merged back into it, and the default branch is never targeted;
- every task must name a Jira key; firstmate asks for it rather than guessing;
- the integration branch is `origin/<JIRA-KEY>`, created from the default branch if missing;
- each crewmate is instructed to `git fetch origin <JIRA-KEY> && git reset --hard origin/<JIRA-KEY>` right after creating `fm/<id>`, to prefix commits and the PR title with the key, and to open the PR with `--base <JIRA-KEY>`;
- several crewmates on one ticket all target the ticket branch; the ticket branch reaches the default branch through the team's normal PR;
- `local-only` delivery (merge into local `main`) is disallowed under the policy.

This works through firstmate's own instruction path rather than a script patch, so `git pull` keeps working. Its limits are honest ones: it relies on the orchestrator following the preference (firstmate is built around exactly that, but a human still reviews the PR base before merging), and `fm-fleet-sync` keeps refreshing the *default* branch in project clones, which is fine because worktrees reset to the ticket branch explicitly. Edit the policy file in this repo to change the wording; re-running the installer replaces the block.

## hablo: firstmate from any project directory

firstmate wants to be launched inside its own checkout, because the harness discovers `AGENTS.md` and the tracked `.pi/extensions/*.ts` from the working directory. Its scripts do not care: every `bin/fm-*.sh` resolves its own location, and `state/`, `data/`, `config/` and `projects/` hang off `FM_HOME`, which the remote and secondmate paths already relocate with `FM_HOME` + `FM_ROOT_OVERRIDE`. `fm-spawn.sh` also accepts a project as an absolute path, not only `projects/<name>`. So the installer adds a wrapper that supplies the harness-side pieces without forking firstmate:

```sh
cd ~/code/myproject
hablo            # = pi --provider bedrouter --model auto (or auto-oss with --ladder oss / --cli-model auto-oss)
hablo --model bedrouter/opus     # your own --provider/--model win; HABLO_PROVIDER / HABLO_MODEL work too
```

`hablo` (`bin/hablo` here, copied to `~/.local/bin/hablo` with the firstmate directory stamped in) exports `FM_ROOT_OVERRIDE` and `FM_HOME` pointing at the firstmate checkout, prepends `<firstmate>/bin` to `PATH`, registers the project once in `data/projects.md` (mode `direct-PR`, or `HABLO_PROJECT_MODE`), symlinks `projects/<name>` to the directory so scripts that expect that spelling keep working, and starts Pi in the project with firstmate's four Pi extensions plus `~/.hablo/hablo-captain.ts` passed as `-e`. That extension appends firstmate's `AGENTS.md` to the system prompt on every turn, with the 58 relative `bin/fm-*.sh` invocations rewritten to absolute paths, and tells the captain which project the session is about. Run from inside the firstmate checkout, `hablo` is just `pi`. It needs bash 3.2+ (macOS's), `git`, and `pi` on `PATH`; it works the same on macOS, Linux and WSL and never needs root, which is why it lives in `~/.local/bin` rather than `/usr/local/bin` (the installer prints the `PATH` line if that directory is not on it).

Step 11 installs the tools firstmate's session start otherwise lists as missing (`treehouse`, `no-mistakes`, `gh-axi`, `chrome-devtools-axi`, `lavish-axi`, `tasks-axi`, `quota-axi`), using exactly the commands firstmate's own `bin/fm-bootstrap.sh` prints for them. The two shell-script installs fetch the latest release from GitHub; they land in `~/.local/bin` (treehouse chooses it because it exists and is on PATH; no-mistakes is told to with `NO_MISTAKES_LINK_DIR`), so nothing asks for sudo. The `*-axi setup hooks` step those READMEs mention is skipped on purpose: it installs session hooks for Claude Code, Codex and OpenCode, which Pi does not read, and it writes outside `~/.pi`. Undo: `npm uninstall -g gh-axi chrome-devtools-axi lavish-axi tasks-axi quota-axi; rm -rf ~/.local/bin/treehouse ~/.local/bin/no-mistakes ~/.no-mistakes`.

Undo for hablo: `rm ~/.local/bin/hablo ~/.hablo/hablo-captain.ts`. The registry lines it added to `data/projects.md` and the `projects/<name>` symlinks are runtime artifacts; prune them by hand when a project is retired.

### What the installer changes in firstmate, and how to undo it

Nothing tracked by firstmate's git repository is ever modified; `git status` inside the clone stays clean, which is what keeps `git pull --ff-only` working. The installer writes only these local, gitignored files, all of which firstmate itself designates as per-installation configuration:

| File | Written when | Effect of deleting it |
| --- | --- | --- |
| `config/crew-harness` | always (`pi`) | firstmate detects the crew harness itself |
| `config/crew-dispatch.json` | always, unless a file not written by this installer is already there | dispatch falls back to `config/crew-harness`; crewmates use Pi's default model |
| `config/backend` | only with `--backend` | firstmate auto-detects the backend (tmux) |
| `data/captain.md` | unless `--no-branch-policy`; created if absent, otherwise the marked block is appended and the rest of the file is left byte-for-byte | remove the `<!-- HABLO:BRANCH-POLICY:START -->` … `END -->` block (or the file, if the installer created it) to drop the policy |

Full undo:

```sh
cd ~/firstmate
rm -f config/crew-harness config/crew-dispatch.json config/backend
# then delete data/captain.md if the installer created it, or cut the HABLO block out of it
git status        # still clean: nothing tracked was touched
```

## What it deliberately does not do

It does not manage `~/.aws/config` beyond running the AWS CLI's own wizard, does not store credentials anywhere, does not install OpenWiki (Node 22 and a provider choice are yours), and does not touch projects: OpenWiki wikis and `.pi/openwiki.json` are per repository.
