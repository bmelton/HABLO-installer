# Build order for the HABLO backlog

> Status: the plan, not a feature. It sequences the nine specs in `TODO/` and
> owns the decisions that span them: installer step numbers, `hablo.json` block
> names, Go module layout, and which document answers a shared verification
> question first. It holds no design of its own; each feature lives in its own
> document and this file links to it.
>
> `TODO/later/` is out of scope here. See "What would pull `later/` forward".

- [ ] **Wave 0** [UN-NAUTICAL.md](UN-NAUTICAL.md) (12 of 13 complete; live language-output sign-off remains)
- [x] **Wave 0** [UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) phase A: the receipt only (6 of 17 items)
- [ ] **Wave 1** [BEDROUTER-WITH-NON-BEDROCK-PROVIDERS.md](BEDROUTER-WITH-NON-BEDROCK-PROVIDERS.md) (19 of 20 complete; `pi-bedrouter` 0.5.0 publication pending)
- [ ] **Wave 1** [MORE-PROVIDERS-AND-MODELS.md](MORE-PROVIDERS-AND-MODELS.md) (29 of 29 implementation items complete; 0.6.0 commits and tarballs ready; live-week validation and publication pending)

- [ ] **Wave 2** [HOOKS.md](HOOKS.md) (19 items, installer step 12)
- [ ] **Wave 2** [DEPENDENCY-TRUST.md](DEPENDENCY-TRUST.md) (14 items)
- [ ] **Wave 3** [JIRA.md](JIRA.md) (19 of 19 implementation items complete; live Jira demo pending)
- [ ] **Wave 3** [JIRA-AGENT.md](JIRA-AGENT.md) (21 of 21 implementation items complete; live Jira demo pending)
- [x] **Wave 4** [DREAM.md](DREAM.md) (20 of 20 complete, installer step 14)
- [x] **Wave 5** [UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) phase B: the command (17 of 17 complete)

Registry check on 2026-09-13: npm still has `pi-bedrouter@0.4.1` and
`bedrouter@0.4.2`; `npm whoami` returns E401 on this machine. Publication
therefore waits for `npm login`, then proceeds in order:
`pi-bedrouter@0.5.0`, `bedrouter@0.6.0`, `pi-bedrouter@0.6.0`.

172 checklist items. The item count is the only size signal here; it is not an
estimate of time.

## The shape of it

```
wave 0   UN-NAUTICAL ───────────────┐ proves ~/.pi/agent/extensions reaches crewmates
         UNINSTALL phase A ─────┐   │ record() exists before five subsystems write files
                                │   │
wave 1   NON-BEDROCK ──┐        │   │ pi.minVersions gate, crew-dispatch __MODEL__ removed
         MORE-PROVIDERS┘        │   │ one stack, auto-oss -> auto
                                │   │
wave 2   HOOKS ────────┐        │   │ Go module + install-gating convention
         DEPENDENCY-TRUST       │   │ guard-log.jsonl starts accumulating
                                │   │
wave 3   JIRA ─────────┐        │   │ jira/ module, internal/jira + internal/adf
         JIRA-AGENT ───┘        │   │ first service unit
                                │   │
wave 4   DREAM ─────────────────┘   │ reads the guard log and the sessions
                                    │
wave 5   UNINSTALL phase B ─────────┘ inventory is complete, so scopes are final
```

Waves 1 and 2 touch disjoint files in disjoint repositories, so **that pair can
swap wholesale** if the cost work matters more this month than the safety work.
Nothing else in the order is free to move; the reasons are under each wave.

## Wave 0: make the later waves cheaper

**[UN-NAUTICAL.md](UN-NAUTICAL.md) first, and not because it is the smallest.**
It installs a Pi extension into `~/.pi/agent/extensions/`, which is the placement
[HOOKS.md](HOOKS.md) depends on and lists as the first thing to verify: if an
explicit `-e` on the crewmate launch line disables auto-discovery, the guard's
whole delivery mechanism fails and the design goes back to a `pi` wrapper.
Answering that question with a tone rule costs a line of prose when it is wrong.
Answering it with a security control costs a rebuild.

**[UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) phase A** is
the receipt writer and the `record()` helper, wrapped around the existing
`writeText` / `writeJson` paths. Not the `uninstall` subcommand. Every subsystem
after this point writes files, installs binaries, and merges JSON keys, and each
one records its own provenance as it lands. Retrofitting five subsystems later is
the same work done worse, from memory.

Phase A is done when a normal install produces a `~/.hablo/receipt.json` whose
actions account for every file the run wrote, and a second run appends rather
than replaces.

Completed 2026-09-13. A fixture install covers a default run followed by
`--nautical`, verifies hashes and merged-key provenance, and confirms the second
run appends. Wave 5 now folds older runs into a lossless baseline before
enforcing receipt retention, preserving their original values.

## Wave 1: bedrouter, in this order

**[BEDROUTER-WITH-NON-BEDROCK-PROVIDERS.md](BEDROUTER-WITH-NON-BEDROCK-PROVIDERS.md)
before [MORE-PROVIDERS-AND-MODELS.md](MORE-PROVIDERS-AND-MODELS.md)**, for three
concrete reasons:

1. It **deletes** the `__MODEL__` substitution from `firstmate/crew-dispatch.json`
   and from step 9. The other document **renames** that same site from
   `auto-oss` to `auto`. Renaming a line that is about to be deleted is wasted
   work, and the rename table in `MORE-PROVIDERS-AND-MODELS.md` loses one row
   once this lands. Do them the other way round and the conflict is a merge.
2. It adds `pi.minVersions` and an installer preflight that reports the
   `pi-bedrouter` version. `MORE-PROVIDERS-AND-MODELS.md` changes the config
   shape `pi-bedrouter` reads, so it needs exactly that gate to refuse to run
   against an old extension. Building the gate first means the breaking change
   arrives with a guard rail already in place.
3. It is the smaller change against the same files, so the larger structural
   rewrite rebases onto a settled shape rather than the reverse.

Release boundary: `pi-bedrouter` **0.5.0** carries the provider-neutrality work,
**0.6.0** carries the stack. Two releases, because a single one would mix a
behaviour fix with a config-format break and leave no version to pin against.

One cross-document item lives here: `BEDROUTER-WITH-NON-BEDROCK-PROVIDERS.md`
asks for provider neutrality to be recorded in `HOOKS.md` as a design constraint.
The guard is provider-neutral by construction, because it inspects tool calls and
never the model, so this is one sentence in that document, not a change to it.

## Wave 2: the guard

**[HOOKS.md](HOOKS.md)** is the first Go binary in this repository, so it also
establishes the conventions the next three waves copy: a module directory, a
`Taskfile.yml`, an installer step gated on the Go toolchain, and the rule that
the installer installs a subsystem completely or not at all.

It goes before Jira and Dream rather than after because both of those add
autonomous machinery. A daemon that starts captains on a label, and a scheduled
job that opens pull requests, are exactly the unattended paths the guard exists
to cover. Shipping them first means running them unguarded for however long the
guard takes.

**[DEPENDENCY-TRUST.md](DEPENDENCY-TRUST.md)** extends the same engine with the
`deps.*` rule class and needs the policy loader, the audit log, and the cache
layout that `HOOKS.md` builds. It can slip a wave without blocking anything; the
guard is useful without it.

Wave 2 also starts `~/.hablo/guard-log.jsonl`, which is the highest-quality
input Wave 4 reads. Every week the guard runs before Dream ships is a week of
evidence Dream gets for free.

## Wave 3: Jira

**[JIRA.md](JIRA.md) before [JIRA-AGENT.md](JIRA-AGENT.md).** Both binaries live
in one `jira/` module over a shared `internal/jira`, `internal/adf`, and
`internal/config`, and both documents say either can ship first. The reporting
CLI is the better first half: it exercises the client, the ADF conversion, and
the credential path against a real instance, with no service to install and no
tmux dispatch to debug. When the daemon follows, the shared half is already
proven and it adds only its own subcommands, its state machine, and its unit.

The reverse order works and costs more: debugging an ADF round trip inside a
daemon that is also claiming labels and spawning captains is two unknowns at
once.

## Wave 4: Dream

**[DREAM.md](DREAM.md)** reads the guard log (wave 2), the Pi sessions the whole
suite produces, and the current rules, which by this point include the tone
policy, the guard policy, and the Jira policy. Run earlier, it reads a thinner
corpus and proposes rules against a system that is still changing under it.

It also wants `bedrouter/auto` to be the model name, which wave 1 settles.

## Wave 5: uninstall, phase B

The `uninstall` subcommand, the six scopes, the service phase, and the leftovers
report. Last, because its artifact inventory is a table of everything the other
eight documents install, and a scope list written before the subsystems exist is
a scope list that will be wrong. By here the inventory is closed: five binaries,
two Pi extensions, two service units, and the `~/.hablo` tree.

The receipt from phase A has been recording all of it since wave 0, which is what
makes phase B a read of existing data rather than an archaeology project.

## Allocations this plan owns

Three documents each claimed `install.mjs` step 12. The allocation:

| Step | Subsystem | Document |
|---|---|---|
| 9, 10 | tone policy block and rule file, alongside the existing captain policies | [UN-NAUTICAL.md](UN-NAUTICAL.md) |
| 12 | guard: build `hablo-guard`, render `guard.json`, install the shim | [HOOKS.md](HOOKS.md) |
| 13 | jira: build both binaries, render `config.json`, install the template and the unit | [JIRA.md](JIRA.md), [JIRA-AGENT.md](JIRA-AGENT.md) |
| 14 | dream: build `hablo-dream`, render its config, install the timer | [DREAM.md](DREAM.md) |
| none | the receipt is cross-cutting; `record()` is called by every step | [UNINSTALL-PI-AND-EVERYTHING.md](UNINSTALL-PI-AND-EVERYTHING.md) |

`hablo.json` top-level blocks, one per subsystem, no nesting beyond it:
`guard` (with `guard.deps`), `jira` (with `jira.agent` and `jira.reporting`),
`dream`, `receipt`, `bedrouter.stack`, `firstmate.tonePolicy`, `pi.minVersions`.

Binaries in `~/.local/bin`: `hablo`, `hablo-guard`, `hablo-jira`,
`hablo-jira-agent`, `hablo-dream`. Go modules in this repository: `guard/`,
`jira/` (two commands), `dream/`.

Pi extensions in `~/.pi/agent/extensions/`: `hablo-guard.ts`, `hablo-tone.ts`.
`hablo-captain.ts` stays in `~/.hablo` and keeps loading through `bin/hablo`,
because it is per-project and must not apply to every session on the machine.

## Verification items that are shared

Answer each once, in the wave named, and record the answer in both documents.

| Question | Answered in | Also needed by |
|---|---|---|
| Does an explicit `-e` disable auto-discovery of `~/.pi/agent/extensions`? **No; verified with Pi 0.85.1 on 2026-09-13.** | Wave 0, UN-NAUTICAL | HOOKS (verify 1) |
| Is `FM_TASK_ID` exported in every crewmate, scout, and secondmate pane? | Wave 2, HOOKS (verify 6) | JIRA (verify 5), attribution |
| Does an exception in a `tool_call` handler block the tool? | Wave 2, HOOKS (verify 2) | DEPENDENCY-TRUST |
| What does the Go toolchain gate do when `go` is absent? | Wave 2, HOOKS | JIRA, DREAM |
| Does `pi -p` behave in a launchd context, with no TTY? | Wave 4, DREAM (verify 2) | any future scheduled session |

## Working in parallel

Safe to run concurrently, because they share no file:

- Wave 1 and Wave 2. Different repositories entirely.
- Within wave 1, the `bedrouter` and `pi-bedrouter` halves, up to the installer
  step that renders the new config, which needs both.
- Wave 4's Go extractor and the tail of wave 3, once `internal/redact` knows
  where `guard.json` is.

Not safe:

- The two Jira binaries, while `internal/jira` is still moving.
- Anything in wave 1 against `bin/hablo` at the same time as UN-NAUTICAL's status
  line change in `hablo-captain.ts`. Small file, two authors, no upside.

## What would pull `later/` forward

`later/CLAUDE-CODE-GUARD.md` becomes cheap the moment wave 2 ships: the rules,
the policy file, and the engine already exist, and the Claude Code side is a
`.mjs` shim that marshals an event and honours a verdict. If Claude Code ever
becomes a harness in this fleet, that document is the first one to pick up, not
the last. The rest of `later/` depends on decisions outside this backlog.
