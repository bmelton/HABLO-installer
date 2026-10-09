# `hablo update`: move a machine to the newest HABLO release

- [x] Pin every manifest Pi package to an exact version in `hablo.json`
- [x] Step 2 installs the pinned version when the installed one differs, and fails if it still differs
- [x] Remove `pi.minVersions` and its checks, because the pins replace them
- [x] `--no-firstmate-pull`: step 9 keeps the firstmate checkout as it is
- [x] `node install.mjs update [--check]`
- [x] `hablo update` hands off to the installer checkout stamped into the wrapper
- [x] `task release -- <version>` tags a release
- [x] Test: a fixture repository with two tags: the `--check` plan, a refused dirty checkout, and "up to date"
- [ ] Run a real `hablo update` between two published tags. The test does not run the install itself.
- [x] README: the release flow and `hablo update`

## Decisions

These were made on 2026-10-09.

- Versioning is release-pinned. A HABLO release is a git tag `vX.Y.Z` on the installer repository. The tag fixes the
  installer code and, through `hablo.json`, the exact version of every Pi package. Every machine on a tag runs the
  same set, and a bad release is undone by moving back to the previous tag.
- `hablo update` covers the installer checkout and what it produces: the wrapper, the extensions, the policies, the
  Jira and Dream binaries, the rendered configs, and the Pi packages, which include bedrouter. It does not update
  the Pi CLI, the firstmate checkout, or the firstmate tools. The installer still does those on a full run, or with
  its own flags.
- `hablo update` applies the change directly. `--check` prints the plan and changes nothing.
- A live Pi process or a `hablo-*` tmux session stops the update. An update replaces files that a running process
  already loaded.

## Flow

1. Refuse when a Pi process or a `hablo-*` tmux session is running. Name each one.
2. Refuse when the checkout has uncommitted changes, or when `HEAD` has commits that no remote branch contains. A
   checkout of a tag would hide that work.
3. `git fetch --tags`. Find the highest `vX.Y.Z` tag.
4. When `HEAD` is already at that tag, print "up to date" and stop.
5. Print the current and the new release, and each Pi package pin that changes.
6. With `--check`, stop here.
7. Stop the Jira agent service. The installer run starts it again after the rebuild.
8. Check out the tag, detached.
9. Run the new `install.mjs` in a new process, with the arguments of the last full run from `~/.hablo/receipt.json`,
   plus `--no-firstmate-pull`.

10. When that install fails, check out the previous commit and run its installer again, so the machine does not stay
    between two releases.

Step 9 runs the code of the new release, so a release can change how it installs itself.

## Pins

The first pins are the versions in use on the development machine on 2026-10-09, plus pi-bedrouter 0.7.0. The
newest npm versions differ for pi-agents and pi-web-access, and nobody has run them together with the rest.

## Not covered

- A machine whose checkout is a development branch. `hablo update` refuses to move a checkout off unpushed work.
  Run `node install.mjs` from that checkout instead.
- Packages that you add to `settings.json` yourself. They have no pin, and `--update-packages` still updates them.
