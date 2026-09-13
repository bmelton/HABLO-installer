# firstmate on the Claude Code harness

> Status: design settled. Part of [CLAUDE-CODE.md](CLAUDE-CODE.md). This is the
> smallest of the five documents, because firstmate already speaks `claude`
> natively and speaks it in more detail than it speaks Pi.

- [ ] `install.mjs` step 9: write `config/crew-harness` = `claude` for the Claude Code side
- [ ] Add `firstmate/crew-dispatch-claude.json` and point `hablo.json` at it
- [ ] Verify Claude Code accepts `--model auto` against a custom base URL; fall back to omitting the key
- [ ] `install.mjs` step 9: write `config/claude-permission-mode` = `auto`
- [ ] Preflight `bin/fm-claude-trust.sh` presence and report it, because it can refuse a spawn
- [ ] `bin/hablo`: add the Claude Code launch branch
- [ ] Write `~/.hablo/hablo-captain-prompt.sh`, the shell equivalent of `hablo-captain.ts`
- [ ] `install.mjs` step 11: run `*-axi setup hooks` when Claude Code is selected
- [ ] Add `.hablo/hablo-captain-prompt.sh` to `backup.config` in `hablo.json`
- [ ] Run a real voyage: captain, one crewmate, one scout, and check the turn-end signal
- [ ] `README.md`: the firstmate section gains a harness column

## What firstmate already does

`bin/fm-spawn.sh` lists `claude` first among its harness adapters, and it gives
Claude Code handling that Pi does not get:

- **Turn-end supervision is native.** Each task worktree receives a
  `.claude/settings.local.json` with `Stop` hook entries, written by firstmate
  before launch. The `-e` extension list in `bin/hablo` exists because Pi has no
  such mechanism. For Claude Code the list is empty, and that is correct, not a
  gap.
- **Workspace trust is pre-registered.** `claude` is the one harness whose
  pre-launch setup can refuse a spawn. Before any per-task state exists,
  `bin/fm-claude-trust.sh` registers the worktree in the launching user's Claude
  trust store, because the interactive trust dialog gates a folder Claude Code
  has never seen and firstmate cannot answer it. A failed registration stops the
  spawn instead of parking a worker on a dialog.
- **Attribution is already off.** Every `claude` launch carries an
  attribution-off policy in its per-launch `--settings` JSON, so a spawned worker
  writes no co-author trailer, no session link and no generated-with line into a
  commit or a pull request body.

The installer's job is to select the harness, set the posture, and stay out of
the way.

## Crew harness and dispatch

`config/crew-harness` becomes `claude`. `config/crew-dispatch.json` gets a
Claude Code twin, `firstmate/crew-dispatch-claude.json` in this repository,
carrying the same two rules and the same reasoning: every crewmate and every
scout runs on the router's `auto` model, so tiering is bedrouter's decision per
request rather than the dispatcher's.

**Decision: the dispatch still names the model.** The Pi dispatch sets it
explicitly so routing never depends on a default that might change.
`ANTHROPIC_MODEL` in user settings would cover the Claude Code case, and it
remains the backstop, but an explicit value in the dispatch keeps the two agents
documented the same way and keeps the reason visible where a reader looks for it.

Verify one thing first: Claude Code validates `--model` against known aliases,
and `auto` is not one of them. Against a custom base URL an unknown name should
pass through to the server. If it does not, drop the `model` key from the
dispatch and rely on `ANTHROPIC_MODEL`, and record why in the file's comment.

**Decision: one dispatch file per agent, not one file with a harness
placeholder.** `install.mjs` already refuses to overwrite a dispatch file it did
not write. With `--agent both`, one of the two agents has to lose that file.
Separate sources make the conflict visible at install time instead of at spawn
time.

## Permission posture

`config/claude-permission-mode` takes exactly one token: `bypass`, which is
firstmate's default and means `--dangerously-skip-permissions`, or `auto`, which
means `--permission-mode auto`. Any other value refuses the spawn before a
worktree exists.

**Decision: write `auto`.** A crewmate runs in a tmux pane, on a branch, with
nobody reading the output. That is the exact condition
[HOOKS.md](HOOKS.md) names as the reason the guard must fail closed, and it is
the wrong place for a permission bypass. `auto` keeps the classifier between an
unattended agent and the machine.

**Decision: the captain keeps the normal prompts.** `hablo` passes no
`--permission-mode` flag. A human is sitting in front of a captain session and
can answer. Adding `auto` there would remove the ability to wave through an
operation the classifier declines, which is friction with no safety gain when
somebody is watching.

The consequence is stated plainly: the same action can succeed for a captain and
stop for a crewmate. That matches the guard's design and it is intentional.

## The `hablo` wrapper

The wrapper gains a branch on the resolved agent. The Pi branch is unchanged.

The Claude Code branch does the same work by different means. Everything before
the launch is shared: the repository root check, the registry line in
`data/projects.md`, the `projects/<name>` symlink, `FM_ROOT_OVERRIDE`, `FM_HOME`
and the `PATH` addition. Only the last line differs.

`hablo-captain.ts` appends firstmate's `AGENTS.md` to the system prompt every
turn, with relative `bin/fm-*.sh` invocations rewritten to absolute paths. The
Claude Code equivalent is `~/.hablo/hablo-captain-prompt.sh`, which prints the
same preamble and the same rewritten manual to standard output, and the wrapper
launches with `--append-system-prompt "$(~/.hablo/hablo-captain-prompt.sh)"`.

Two differences from the Pi path, both acceptable:

- The prompt is built once at launch, not per turn. The extension re-reads
  `AGENTS.md` when its modification time changes. A session that outlives an
  edit to `AGENTS.md` keeps the old text. Sessions are short next to that file's
  edit rate.
- There is no status line. The extension sets one through Pi's UI API. Claude
  Code's status line is a user setting, and the operator here already has one.
  HABLO does not overwrite it.

## Step 11 changes meaning

Step 11 installs firstmate's tool dependencies and deliberately skips the
`*-axi setup hooks` step, because it installs Claude Code, Codex and OpenCode
session hooks that Pi does not read and that write outside `~/.pi`.

With Claude Code selected, that reasoning inverts and the step runs. The note in
`install.mjs` and the matching sentence in `README.md` both need rewriting, and
the receipt has to record the hooks as HABLO-created so an uninstall can reverse
them.

## Open questions

- `bin/fm-claude-trust.sh` writes into the launching user's own Claude trust
  store. Confirm what it writes and whether the uninstall should reverse it. A
  trust entry for a worktree that no longer exists is harmless but untidy.
- firstmate's per-launch `--settings` JSON and the user-scope `env` block from
  [routing](CLAUDE-CODE-ROUTING.md) both reach a crewmate. Confirm the merge
  order puts the base URL where it belongs, and that a crewmate really does
  route through bedrouter rather than through the operator's own account.
- The secondmate path refuses several harnesses. Confirm `claude` is allowed for
  `--secondmate` before promising the feature in `README.md`.
