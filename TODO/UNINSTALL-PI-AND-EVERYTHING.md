# Uninstall: remove everything HABLO added, and nothing else

> Status: capture, not a finished spec. The receipt is the load-bearing idea and
> the rest follows from it. Nothing here is implemented yet.

- [ ] `install.mjs`: write a receipt to `~/.hablo/receipt.json` on every run
- [ ] Record prior values for every merged key, so a revert can restore absence
- [ ] Record which global packages and scripts this installer actually installed
- [ ] `install.mjs`: add the `uninstall` subcommand, plan-only unless `--yes`
- [ ] Implement the four scope flags plus `--all`
- [ ] Stop a running bedrouter before touching `~/.bedrouter`
- [ ] Revert `settings.json` keys through a dotfiles symlink, never unlink it
- [ ] Cut the `HABLO:*` blocks from `data/captain.md`, keep the rest of the file
- [ ] Back up automatically before removing anything, unless `--no-backup`
- [ ] Print a leftovers report: what stayed, and why
- [ ] Handle a missing or partial receipt (older install, or a hand-edited file)
- [ ] `README.md`: replace the scattered undo snippets with one pointer
- [ ] Cover the runtime artifacts `bin/hablo` writes into the firstmate checkout

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
      "actions": [
        { "kind": "file.create", "path": "~/.local/bin/hablo" },
        { "kind": "file.create", "path": "~/.bedrouter/bedrouter.json" },
        { "kind": "json.set", "path": "~/.pi/agent/settings.json",
          "key": "theme", "value": "dark", "prior": null },
        { "kind": "json.append", "path": "~/.pi/agent/settings.json",
          "key": "enabledModels", "added": ["bedrouter/auto", "bedrouter/haiku"] },
        { "kind": "pi.package", "name": "npm:pi-bedrouter" },
        { "kind": "npm.global", "name": "gh-axi", "wasPresent": false },
        { "kind": "npm.global", "name": "treehouse", "wasPresent": true },
        { "kind": "git.clone", "path": "~/firstmate",
          "repo": "https://github.com/kunchenguid/firstmate" },
        { "kind": "block.insert", "path": "~/firstmate/data/captain.md",
          "marker": "HABLO:BRANCH-POLICY", "fileCreated": false }
      ]
    }
  ]
}
```

`prior: null` is the whole point of the shape. It says the key was absent, so
the revert deletes it rather than writing a guessed default. `wasPresent: true`
says the installer found `treehouse` already there and installed nothing, so
uninstall leaves it alone. Step 11 already computes exactly that fact and then
throws it away.

## The command

```
node install.mjs uninstall [--yes] [--with-state] [--with-globals]
                           [--with-firstmate] [--remove-pi] [--all]
                           [--no-backup] [--receipt <path>]
```

Without `--yes` it prints the plan and exits zero, having written nothing. This
inverts the convention the install path uses, where `--dry-run` opts in to
safety. A destructive command earns the inversion.

| Flag | Removes |
|---|---|
| *(default)* | Only files this installer created, and only the keys it added: `~/.local/bin/hablo`, `~/.hablo/hablo-captain.ts`, `~/.pi/agent/pi-bedrouter.json`, the agent profiles and workflows it copied, its `workflows.json` model notes, its `settings.json` keys and `enabledModels` entries, and the firstmate config files and `captain.md` blocks |
| `--with-state` | Also `~/.bedrouter` (config, `.env`, logs) and the rest of `~/.hablo` |
| `--with-globals` | Also the global packages it installed and that were absent before: `gh-axi`, `chrome-devtools-axi`, `lavish-axi`, `tasks-axi`, `quota-axi`, `treehouse`, `no-mistakes` |
| `--with-firstmate` | Also the `~/firstmate` clone, after checking `git status` is clean and `data/` holds no unpushed work |
| `--remove-pi` | Also the Pi packages under `~/.pi/agent/npm`, and the Pi CLI itself when `--install-pi` put it there |
| `--all` | All of the above |

## What it never touches

- `~/.aws`: profiles and the SSO token cache. Step 5 runs the AWS CLI's own
  wizard, so any profile it created belongs to the AWS CLI, not to HABLO.
- `~/.dotfiles` and every file a `~/.pi` symlink points into.
- `~/.pi/agent/auth.json` and `trust.json`: OAuth logins and trust decisions
  that predate HABLO and cannot be regenerated.
- Sessions, caches and logs under `~/.pi`, unless `--remove-pi` is given.
- Project repositories, their `openwiki/` directories, and `.pi/openwiki.json`.
- Any file whose content no longer matches what the receipt recorded. Report it
  and keep it: a changed file is one someone edited by hand.

## The dotfiles symlink trap

`~/.pi/agent/settings.json` is often a stow symlink into `~/.dotfiles/pi`. The
installer already detects this and writes through the link, which is correct.
Uninstall must do the same and must never call `unlink` on the path: removing
the link would leave the dotfiles copy orphaned, and removing the target would
delete configuration HABLO never owned. Revert the keys, leave the file.

The same care applies to the dangling-symlink cleanup in step 1. That step
deletes links that already pointed nowhere, so there is nothing to restore, but
the receipt should record it so the uninstall report can say what went missing
before HABLO arrived.

## Ordering

1. Back up first, reusing the existing `backup` subcommand, unless `--no-backup`.
2. Stop a running bedrouter. It holds port 20129 and writes into `~/.bedrouter`,
   so removing that directory under a live server leaves a half-state.
3. Revert JSON merges before deleting the files that explain them.
4. Remove HABLO's own files.
5. Remove globals, then the clone, then Pi itself. Each step is independent, so
   a failure in one does not block the next.
6. Print the leftovers report.

## The leftovers report

The last thing the command prints is what it did not remove and why, one line
each: the file changed since install, the global was already present, the
firstmate clone has uncommitted work, the key now holds a value the receipt does
not recognise. This is the part that makes the command trustworthy. Silence
about a skipped item reads as success.

## Runtime artifacts

`bin/hablo` writes into the firstmate checkout every time it runs: a registry
line in `data/projects.md` and a `projects/<name>` symlink for the directory it
was started in. The installer never sees those, so the receipt cannot hold them.
Uninstall should offer to prune the symlinks whose targets no longer exist and
to report the registry lines, without editing `data/projects.md` unasked.

## What changes in this repository

- `install.mjs` grows a receipt writer used by every step that writes anything,
  and the `uninstall` subcommand that consumes it.
- `hablo.json` gains a `receipt` block for the path and the retention policy.
- `README.md` keeps one short section that points at `uninstall`, and drops the
  per-section shell snippets, which then have one source of truth.

## Open questions

- Does the receipt record every run forever, or collapse to current state? A
  full history explains a machine's past; current state is simpler to replay.
  Recommendation: append runs, and have uninstall fold them newest-first.
- When the receipt is missing, should `uninstall` fall back to matching against
  `hablo.json` with everything as plan-only, or refuse and print the manual
  runbook? Refusing is safer and less useful.
- Should `--with-firstmate` ever delete a clone with uncommitted work, given an
  explicit second confirmation?
- Is `~/.no-mistakes` ours to remove when the no-mistakes install script created
  it? Verify what that script writes before deciding.
