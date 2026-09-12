# Demo-morning checklist

Fifteen minutes, in order. Everything after step 3 is verification.

0. **Fresh machine?** Follow "Backup, uninstall, reinstall" in the README once; the rest of this list assumes Pi and the packages are installed.
1. **Credentials.** `aws sso login --profile <p>`. Then `aws sts get-caller-identity --profile <p>` shows an `AWSReservedSSO_…` ARN.
2. **Install / refresh.** `./install.sh --profile <p>` (safe to re-run). If Pi packages were installed earlier: `pi update --extensions` first so `pi-bedrouter` and `pi-openwiki-adapter` are current.
3. **Probe.** Step 6 of the installer, or inside Pi: `/bedrouter probe`. Every rung must say `ok`. If the corporate account lacks a model, the installer already swapped or dropped it; read the ladder it printed so you know what "opus" means today.
4. **Start Pi in the demo repo.** `pi --provider bedrouter --model auto`. Expect the notification "model set to bedrouter/auto" and `bedrouter: ready` in the footer. Keep the server's terminal visible if you started it by hand with `npm run start:debug`; otherwise the footer is the live view.
5. **Warm the story.** In a scratch session: one `implement …` (execute, cheap rung), one `why does … compare …` (explore, up a rung), one absurd output request (`print 1..3000`) to show an escalation, then `/new`. `/bedrouter report -- --since <time>` prints the savings table for exactly that window.
6. **OpenWiki.** In the demo repo: `/openwiki doctor`. It must show the last run, drift since, and no evidence blockers. If it flags a symlinked file, replace the symlink with a real file before the run (see pi-openwiki README).
7. **firstmate.** `cd ~/firstmate && pi --provider bedrouter --model auto-oss`, say `ahoy!`; `/bearings` shows the crew. Crewmates are routed by `config/crew-dispatch.json` (check once: `/bedrouter status` in a crewmate's tmux window shows `using auto-oss`). Give every task a Jira key; the captain policy makes crewmates branch from and PR into `<JIRA-KEY>`, never main.
8. **Kill switch.** `/bedrouter stop` and `/bedrouter start` both work from inside Pi; `BEDROUTER_DEBUG=1` in `~/.bedrouter/.env` if you want the per-request trace in `server.log`.

Things that have bitten before: two copies of a package listed in `settings.json` (path + npm) fail with tool-name conflicts — keep one; a poisoned conversation after a hallucinated tool name needs `/new` (fixed in bedrouter 0.1.0+, but old sessions stay poisoned); `pi install` run *through Pi's bash tool* hands npm's output to the model, which will improvise — run installs in a plain terminal.
