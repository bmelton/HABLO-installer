# Uninstall: remove everything HABLO added, and nothing else

> Status: phase A implemented; the uninstall command in phase B remains. The receipt is the
> load-bearing idea and the rest follows from it. The artifact inventory has to
> be re-read whenever a new subsystem ships, and the four documents that add one
> are named in "Artifacts by subsystem".

- [x] `install.mjs`: a `record()` helper every writing step calls, and the receipt writer
- [x] Record the prior value for every merged key, so a revert can restore absence
- [x] Record which global packages and scripts this installer actually installed
- [x] Record a content hash per file written, so a hand-edited file can be detected later
- [ ] `install.mjs`: the `uninstall` subcommand, plan-only unless `--yes`
- [ ] The six scope flags plus `--all`
- [ ] `--infer`: plan from `hablo.json` when the receipt is missing, refuse to run without `--yes --infer`
- [ ] Phase 0: stop the services and daemons this installer started, before touching any file
- [ ] Revert `settings.json` keys through a dotfiles symlink, never unlink it
- [ ] Fold multiple runs newest-first so the oldest `prior` wins
- [ ] Cut the `HABLO:*` blocks from `data/captain.md`, keep the rest of the file
- [ ] Refuse to remove `~/firstmate` when it is dirty or unpushed; name the paths
- [ ] Back up automatically before removing anything, unless `--no-backup`
- [ ] The leftovers report: what stayed, and why
- [ ] Cover the runtime artifacts `bin/hablo` writes into the firstmate checkout
- [x] `hablo.json`: the `receipt` block (path, retention)
- [ ] `README.md`: replace the scattered undo snippets with one pointer

## What this is

Undo instructions exist today, but they are scattered across four places in
`README.md` and every one of them is a shell snippet a human retypes. They drift
whenever a step changes, they cannot revert a merge, and they say nothing about
which of the global tools were already on the machine before HABLO ran.

The goal is one command that reverses an install, and a guarantee about what it
will not touch.

## The principle: never delete what we did not create

An uninstaller that reads the current `hablo.json` and deletes whatever it names
is wrong in both directions. It misses what an older run installed and the
manifest has since dropped, and it removes things the manifest names that were
already on the machine.

Provenance must be recorded at install time, not inferred at uninstall time.
Two weak forms of this already exist: `bin/hablo` and `crew-dispatch.json` are
recognised by the string `HABLO-installer` inside them, and `data/captain.md`
carries `<!-- HABLO:BRANCH-POLICY:START -->` markers. Both work because the file
is ours. Neither helps with a key merged into someone else's JSON, or with
`npm install -g gh-axi` when `gh-axi` was already there.

## The receipt

Every run appends to `~/.hablo/receipt.json`: what it did, to what, and what was
there before. `uninstall` replays it in reverse. The file is data, not a log, so
a partial or interrupted run still describes exactly what landed.

```json
{
  "version": 1,
  "runs": [
    {
      "at": "2026-09-13T14:02:11Z",
      "installer": "HABLO-installer@56ec8a2",
      "argv": ["--profile", "bedrouter"],
      "actions": [
        { "kind": "file.create", "path": "~/.local/bin/hablo", "sha256": "9f2c…" },
        { "kind": "file.create", "path": "~/.bedrouter/bedrouter.json", "sha256": "1a77…" },
        { "kind": "json.set", "path": "~/.pi/agent/settings.json",
          "key": "theme", "value": "dark", "prior": null },
        { "kind": "json.append", "path": "~/.pi/agent/settings.json",
          "key": "enabledModels", "added": ["bedrouter/auto"] },
        { "kind": "pi.package", "name": "npm:pi-bedrouter" },
        { "kind": "npm.global", "name": "gh-axi", "wasPresent": false },
        { "kind": "npm.global", "name": "treehouse", "wasPresent": true },
        { "kind": "git.clone", "path": "~/firstmate",
          "repo": "https://github.com/kunchenguid/firstmate" },
        { "kind": "block.insert", "path": "~/firstmate/data/captain.md",
          "marker": "HABLO:BRANCH-POLICY", "fileCreated": false },
        { "kind": "service.install", "path": "~/Library/LaunchAgents/dev.hablo.jira-agent.plist",
          "label": "dev.hablo.jira-agent", "loaded": true }
      ]
    }
  ]
}
```

`prior: null` is the whole point of the shape. It says the key was absent, so the
revert deletes it rather than writing a guessed default. `wasPresent: true` says
the installer found `treehouse` already there and installed nothing, so uninstall
leaves it alone. Step 11 already computes exactly that fact and then throws it
away.

`sha256` is what makes "changed since install" detectable. A file whose hash no
longer matches is one somebody edited by hand, and it is reported and kept.

Phase A writes the receipt atomically after every recorded action and uses mode
0600. Restore runs are deliberately excluded: restored files belong to the
backup, while actions after restore belong to the new install.

**Decision: every run is appended, and uninstall folds them newest-first.** A
key set by three runs reverts to what existed before the first, because the
oldest recorded `prior` is the true one. Collapsing the receipt to current state
would overwrite that value on the second run and leave the revert writing a
guess. The cost is a growing file. `receipt.retainRuns` is present in the
manifest with a default of 50, but phase A does not enforce it: discarding the
oldest run would discard the true `prior`. Phase B must compact those actions
into a lossless baseline before it enables pruning.

## Artifacts by subsystem

The inventory moved from one installer to six subsystems while this document sat
in capture. Every one of these has to be recorded and reverted, and this list is
what a new feature document must extend.

| Subsystem | Artifacts | Document |
|---|---|---|
| Core | `~/.local/bin/hablo`, `~/.hablo/hablo-captain.ts`, `~/.bedrouter/*`, `~/.pi/agent/pi-bedrouter.json`, merged `settings.json` keys, agent profiles, workflows and model notes | this repository |
| Guard | `~/.local/bin/hablo-guard`, `~/.pi/agent/extensions/hablo-guard.ts`, `~/.hablo/guard.json`, `~/.hablo/guard-log.jsonl`, `~/.hablo/guard-cache/` | [HOOKS.md](HOOKS.md) |
| Tone | `~/.pi/agent/extensions/hablo-tone.ts`, `~/.hablo/tone.md`, a `captain.md` block | [UN-NAUTICAL.md](UN-NAUTICAL.md) |
| Jira | `~/.local/bin/hablo-jira`, `~/.local/bin/hablo-jira-agent`, `~/.hablo/jira/*`, a launchd or systemd unit | [JIRA.md](JIRA.md), [JIRA-AGENT.md](JIRA-AGENT.md) |
| Dream | `~/.local/bin/hablo-dream`, `~/.hablo/dream/*`, a launchd or systemd timer | [DREAM.md](DREAM.md) |
| firstmate | the `~/firstmate` clone, `config/*`, `crew-dispatch.json`, `captain.md` blocks, the global tools from step 11 | this repository |

Two of those carry credentials (`~/.hablo/jira/.env`, `~/.bedrouter/.env`) and
two carry history worth keeping (`guard-log.jsonl`, `~/.hablo/dream/`). All four
are inside `--with-state`, never in the default scope.

## The command

```
node install.mjs uninstall [--yes] [--with-state] [--with-globals]
                           [--with-firstmate] [--with-services] [--remove-pi]
                           [--all] [--no-backup] [--infer] [--receipt <path>]
```

Without `--yes` it prints the plan and exits zero, having written nothing. This
inverts the convention the install path uses, where `--dry-run` opts in to
safety. A destructive command earns the inversion.

| Flag | Removes |
|---|---|
| *(default)* | Only files this installer created and keys it added: the binaries and extensions in the table above, `~/.hablo/hablo-captain.ts`, `~/.pi/agent/pi-bedrouter.json`, the agent profiles and workflows it copied, its `workflows.json` model notes, its `settings.json` keys and `enabledModels` entries, and the firstmate config files and `captain.md` blocks |
| `--with-services` | Also the launchd plists and systemd units it wrote, unloaded first. Implied by every other scope that removes a binary a service runs |
| `--with-state` | Also `~/.bedrouter` (config, `.env`, logs) and the rest of `~/.hablo`, including the guard log, the dream reports, and the Jira credentials |
| `--with-globals` | Also the global packages it installed and that were absent before: `gh-axi`, `chrome-devtools-axi`, `lavish-axi`, `tasks-axi`, `quota-axi`, `treehouse`, `no-mistakes` |
| `--with-firstmate` | Also the `~/firstmate` clone, when `git status` is clean and nothing is unpushed |
| `--remove-pi` | Also the Pi packages under `~/.pi/agent/npm`, and the Pi CLI itself when `--install-pi` put it there |
| `--all` | All of the above |

### When the receipt is missing

An older install, or a hand-edited file. **Decision: infer a plan, and refuse to
execute it without `--yes --infer` together.** The plan is built by matching the
current `hablo.json` against what is on disk, and every line of it is marked as
inferred. Even with both flags it skips anything whose provenance cannot be
established: every global package (we cannot know whether it predates HABLO), and
any file that lacks the `HABLO-installer` marker.

Refusing outright would be safer and would leave the person with the retyped
shell snippets this feature exists to replace. Inferring under a plain `--yes`
would delete a tool that was on the machine first. Two flags and a reduced scope
is the honest middle.

## What it never touches

- `~/.aws`: profiles and the SSO token cache. Step 5 runs the AWS CLI's own
  wizard, so any profile it created belongs to the AWS CLI, not to HABLO.
- `~/.dotfiles` and every file a `~/.pi` symlink points into.
- `~/.pi/agent/auth.json` and `trust.json`: OAuth logins and trust decisions that
  predate HABLO and cannot be regenerated.
- Sessions, caches and logs under `~/.pi`, unless `--remove-pi` is given.
- Project repositories, their `openwiki/` directories, and `.pi/openwiki.json`.
- `~/.local/bin` itself. That directory holds a dozen unrelated tools on a real
  machine; only the named files are removed, never the directory.
- Any file whose content no longer matches the hash the receipt recorded. Report
  it and keep it: a changed file is one somebody edited by hand.

## Services and daemons

**Decision: stop what we started, report what we did not.** The installer writes
launchd plists and systemd user units for the Jira daemon and the dream timer,
and it knows how to find a running bedrouter (the port in `hablo.json` plus its
pid file). Those are unloaded and stopped in phase 0, before any file is removed,
because deleting a binary and its config out from under a running process leaves
a half-state that the next install has to clean up.

A daemon this installer never started is reported and left alone. `no-mistakes`
is the live example: `~/.no-mistakes` on this machine holds `daemon.pid`,
`daemon.lock`, `logs/`, `repos/`, and `servers/`, and the daemon is running. Even
when `--with-globals` removes the `no-mistakes` package because the receipt says
we installed it, the uninstaller prints the pid and the tool's own stop command
rather than signalling a process whose work it does not know. The directory is
that tool's state, not ours, and it is reported in the leftovers, never removed.

The same logic applies to `~/.hablo/dream` and the guard log under `--with-state`:
those are ours, and they still go through the backup first.

## The dotfiles symlink trap

`~/.pi/agent/settings.json` is often a stow symlink into `~/.dotfiles/pi`. The
installer already detects this and writes through the link, which is correct.
Uninstall must do the same and must never call `unlink` on the path: removing the
link would leave the dotfiles copy orphaned, and removing the target would delete
configuration HABLO never owned. Revert the keys, leave the file.

The same care applies to the dangling-symlink cleanup in step 1. That step
deletes links that already pointed nowhere, so there is nothing to restore, but
the receipt should record it so the uninstall report can say what went missing
before HABLO arrived.

## The firstmate clone

`--with-firstmate` removes `~/firstmate` only when `git status --porcelain` is
empty and every branch is pushed. **Decision: a dirty clone is refused, not
prompted.** The command prints the uncommitted and unpushed paths, skips the
clone, and completes every other scope. That directory is the one artifact here
that can hold something irreplaceable, and a confirmation answered at the end of
a long uninstall is not a safeguard.

`data/` is the specific worry: firstmate keeps `captain.md`, `projects.md`, and
run state there, and those are gitignored, so a clean `git status` says nothing
about them. Check `data/` for files newer than the clone's last commit and report
them the same way.

## Ordering

1. Back up first, reusing the existing `backup` subcommand, unless `--no-backup`.
2. Stop services and daemons: the launchd and systemd units this installer wrote,
   then a running bedrouter. Report any third-party daemon in scope.
3. Revert JSON merges before deleting the files that explain them.
4. Remove HABLO's own files.
5. Remove globals, then the clone, then Pi itself. Each step is independent, so a
   failure in one does not block the next.
6. Print the leftovers report.

## The leftovers report

The last thing the command prints is what it did not remove and why, one line
each: the file changed since install, the global that was already present, the
firstmate clone with uncommitted work, the third-party daemon still running, the
key that now holds a value the receipt does not recognise. This is the part that
makes the command trustworthy. Silence about a skipped item reads as success.

## Runtime artifacts

`bin/hablo` writes into the firstmate checkout every time it runs: a registry
line in `data/projects.md` and a `projects/<name>` symlink for the directory it
was started in. The installer never sees those, so the receipt cannot hold them.
Uninstall prunes the symlinks whose targets no longer exist, reports the registry
lines, and does not edit `data/projects.md` unasked.

The same class of artifact now exists elsewhere: `~/.hablo/guard-log.jsonl` grows
per session, `~/.hablo/dream/` grows per run, and `~/.hablo/jira/runs/` grows per
ticket. None of them is in the receipt, all of them are inside `--with-state`,
and the backup covers them first.

## What changes in this repository

- `install.mjs` grows a `record()` helper that every writing step calls, and the
  `uninstall` subcommand that consumes it. The helper wraps the existing
  `writeText` / `writeJson` / `did` paths so a step cannot write without
  recording.
- `hablo.json` gains a `receipt` block for the path and `retainRuns`.
- `README.md` keeps one short section pointing at `uninstall` and drops the
  per-section shell snippets, which then have one source of truth.

## Verify before you build

1. **`launchctl bootout` against a unit that is not loaded**, and the systemd
   equivalent, so phase 0 is idempotent and a second uninstall does not fail.
2. **Reverting a key through a stow symlink**, including the case where the
   dotfiles repository is read-only or the symlink target has moved.
3. **That `git status --porcelain` plus the ahead/behind count is enough** to
   call a clone safe to delete, on a clone with a detached HEAD and on one with a
   branch that has no upstream.
4. **The hash check on a file the installer rewrites every run.** `bin/hablo` is
   re-stamped whenever the model or firstmate path changes, so the receipt's hash
   must come from the last run that wrote it, not the first.
