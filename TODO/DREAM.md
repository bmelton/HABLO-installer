# DREAM: turn yesterday's corrections into tomorrow's rules

> Status: implemented 2026-09-13, including the optional Phase 2 GitHub review
> source. The verification findings are recorded below.
>
> This is the fleet-wide, scheduled job. The `/dream` skill on this machine is a
> different thing with the same verb: interactive, one project, Claude Code
> memory only. The boundary is in "Two dreams, one verb" below. This job never
> writes a memory file.

- [x] `dream/`: Go module, `cmd/hablo-dream`, `internal/*` skeleton
- [x] `internal/pisession`: walk `~/.pi/agent/sessions/**/*.jsonl`, follow the id/parentId branch, skip compacted spans
- [x] `internal/ccsession`: walk `~/.claude/projects/<slug>/*.jsonl` and read `memory/*.md`
- [x] `internal/signal`: the five extractors below, each emitting evidence with a stable key
- [x] `internal/redact`: apply `secrets.patterns` from `~/.hablo/guard.json`, with a built-in fallback list
- [x] `internal/cluster`: exact keys for structured signals, normalized token-set keys for text
- [x] `internal/state`: dismissals, already-proposed fingerprints, last run
- [x] `digest`: deterministic, no model, writes `digest-<date>.json`
- [x] `run`: digest, render the brief, `pi -p`, capture stdout, validate, render the report
- [x] The proposal JSON schema, and a validator that rejects a proposal with no citation
- [x] `report`, `show <n>`, `dismiss <n> --reason`, `doctor`, `version`
- [x] `apply <n[,n…]>`: branch, edit, commit, `gh pr create`, one PR per target repository
- [x] Refuse to apply a proposal whose target is not a tracked file in a git repository
- [x] Golden tests: fixture transcripts in, fixed digest out, byte for byte
- [x] Add the `dream` block to `hablo.json`
- [x] `install.mjs`: build the binary, render `~/.hablo/dream/config.json`, install the launchd or systemd timer
- [x] Add `--skip-dream`, `--dream-at`, `--no-dream-service` and the usage header lines
- [x] Add the dream paths to `backup.config` and to the uninstall receipt
- [x] `README.md`: what it reads, what it proposes, how to accept one
- [x] Phase 2: `internal/github`, review comments and change requests as a sixth signal

Completed 2026-09-13. Pi 0.85.1 was verified headlessly with
`--no-session --no-tools`: print mode returned only the answer on stdout,
required no TTY, and exited 1 for a bedrouter model failure. The v3 reader was
checked against real session and compaction records, the redactor was exercised
against a real month-long digest plus fallback-secret fixtures, and the fixed
transcript fixture covers the compaction cutoff and byte-for-byte digest output.

## What this is

The fleet makes the same mistakes repeatedly. A crewmate edits a generated file,
a captain writes a PR description in the wrong format, an agent reaches for a
library the house rules forbid. Each time, somebody corrects it in the moment,
the correction scrolls away, and the next session starts from the same place.

The corrections are already recorded. They sit in transcripts, in the guard's
audit log, and in the memory files the `/dream` skill maintains. Nothing reads
them back.

This is a job that runs once or twice a day, reads what happened, and proposes
rules that would have prevented the repeats. It proposes; a human accepts. An
accepted proposal becomes a pull request.

## Two dreams, one verb

| | `/dream` (skill, already on this machine) | `hablo-dream` (this document) |
|---|---|---|
| Trigger | The user types `/dream` | launchd or systemd, once or twice a day |
| Corpus | One project's Claude Code transcripts | Every Pi session in the fleet, the guard log, both harnesses' transcripts, the repo's own rules |
| Output | Memory files under `~/.claude/projects/<slug>/memory/` | Numbered proposals, then a pull request |
| Writes memory | Yes, that is its whole job | **Never** |

`hablo-dream` reads the memory files, because a fact already written down is a
proposal not worth making twice, and because a `feedback` memory is a correction
somebody already distilled. It treats that directory as read-only input. The two
tools can run on the same day without fighting.

## What it reads

Five sources in v1, in descending order of signal quality.

**1. The guard audit log**, `~/.hablo/guard-log.jsonl`. Every line is a mistake
the machine already caught, with a rule id, a target, and a session kind
attached. No parsing heuristics and no model needed: seven denials of
`paths.generated` on the same glob is a cluster by exact key. This is the
cheapest and sharpest source, and it exists only once the guard from
[HOOKS.md](HOOKS.md) ships. The dream works without it and is much better with
it.

**2. Post-edit check failures**, from the same log. A check that fails on the
same file pattern repeatedly is either a real recurring defect or a noisy check,
and the report says which by counting how often the next edit fixed it.

**3. Pi session transcripts**, `~/.pi/agent/sessions/--<path>--/*.jsonl`. The
format is one JSON object per line with `type` of `session`, `message`,
`compaction`, and the rest, forming a tree through `id` and `parentId`, with the
project directory in the `cwd` field of the session header. The extractor follows
the active branch only, and skips spans a `compaction` entry replaced, because
re-reading compacted history would count one correction twice.

**4. Claude Code transcripts and memory**, `~/.claude/projects/<slug>/*.jsonl`
and `memory/*.md`. Same correction extraction, plus the memory index as a list of
things already known.

**5. The rules as they stand now**: `hablo.json`, the `firstmate/captain-*.md`
policy sources, the project's `CLAUDE.md` and `AGENTS.md`, its `Taskfile.yml`,
and the planning documents under `TODO/`, `features/`, and `bugs/`. Without this,
the job proposes rules that already exist, which is the fastest way to make
somebody stop reading its output.

### The correction signals

Deterministic extraction. Each signal emits evidence with a stable key, and the
key is what dismissals and repeat suppression work on.

| Signal | How it is found | Key |
|---|---|---|
| Guard denial | A `verdict: "deny"` line | `guard:<rule>:<target-glob>` |
| Check failure | A dropped or failing post-edit check | `check:<id>:<ext>` |
| Human correction | A user turn matching the correction openers, paired with the assistant turn before it | normalized token set of the user turn |
| Failure loop | The same command failing three or more times in one session | `loop:<command-head>` |
| Rule collision | An agent action that a current rule already forbids in prose | `rule:<file>:<line>` |

The correction openers are a list in the config, not in the code: "no", "don't",
"stop", "actually", "I said", "that is wrong", "revert", "undo", "why did you",
"never". They are a starting set to tune, and `doctor` prints how many turns each
one matched last week so the list can be edited from evidence.

**The extractor does not cluster free text.** It computes a normalized token-set
key so repeats collapse and dismissals stick, and hands the evidence to the
session. Grouping "you keep editing generated files" out of nine differently
worded complaints is judgment, and judgment is the part the model is for.
Pretending a token hash is a semantic cluster would produce confident nonsense in
the digest, before any model has seen it.

## How it runs

```
hablo-dream run
  │
  ├─ digest    jsonl walk, no model. redact. cluster structured signals.
  │            -> ~/.hablo/dream/digest-2026-09-13.json
  │
  ├─ brief     render the digest plus the current rules into one prompt
  │
  ├─ pi -p     one print-mode session on bedrouter/auto, stdout captured
  │            the session reads the brief and answers with JSON. It writes nothing.
  │
  ├─ validate  parse, check every proposal cites at least one evidence id
  │            -> ~/.hablo/dream/proposals-2026-09-13.json
  │
  └─ render    -> ~/.hablo/dream/report-2026-09-13.md  (and report.md, the latest)
```

**Decision: the agent session writes nothing to disk.** It runs in print mode and
its stdout is the deliverable. Two reasons, and the second is not optional: an
agent that writes its own output file can write anything else too, and the guard
in [HOOKS.md](HOOKS.md) denies writes to `~/.hablo/**` under `paths.agentState`
with `interactive: false`, so a session that tried would be blocked by our own
rules. Capturing stdout removes the conflict instead of carving an exception into
the guard, which is the rule that protects the guard from the agent.

**Decision: the session answers in JSON, and the binary renders the Markdown.**
The report a human reads and the proposals `apply` executes are then the same
data, so a proposal cannot say one thing and do another. A reply that does not
parse, or a proposal with no citation, fails validation and the run exits
non-zero with the raw reply kept for inspection. No partial report.

**Decision: secrets are redacted before the model sees anything.**
`internal/redact` reads `secrets.patterns` from `~/.hablo/guard.json` and applies
them to every quote in the digest, falling back to a built-in list when the guard
is not installed. Transcripts are the one corpus on this machine that is
guaranteed to contain whatever an agent was once shown.

## The proposal

```jsonc
{
  "version": 1,
  "proposals": [
    {
      "id": 3,
      "title": "Deny edits to generated protobuf output in payments-api",
      "problem": "Crewmates edited src/gen/*.pb.go seven times in three days; each edit was reverted or corrected by the captain.",
      "target": { "repo": "~/code/payments-api", "file": "CLAUDE.md", "kind": "instruction" },
      "change": { "kind": "append-section", "heading": "Generated code", "body": "…" },
      "evidence": ["guard:paths.generated:src/gen/**", "pi:01J8…:2026-09-12T14:02:11Z"],
      "confidence": "high",
      "alreadyCovered": null
    }
  ]
}
```

`kind` is one of a closed set, so `apply` never has to interpret prose:
`append-section`, `replace-section`, `json-merge` (for `hablo.json`), `add-task`
(for a `Taskfile.yml`), and `manual` for anything the binary cannot perform.

`alreadyCovered` is filled when the session finds an existing rule that says the
same thing. Those proposals still appear in the report, marked, because a rule
that exists and is ignored is a different and more interesting problem than a
rule that is missing.

## Accepting a proposal

```
hablo-dream report              # the numbered list, newest run
hablo-dream show 3              # the full proposal, its diff, and its evidence
hablo-dream apply 3             # branch, edit, commit, open a PR
hablo-dream dismiss 3 --reason "we want that file editable"
```

**Decision: nothing is applied in place. Accepting produces a pull request.**
`apply` creates `dream/<date>` in the target repository, makes the edits, commits
with the evidence in the body, and runs `gh pr create`. Several accepted
proposals that target one repository go into one branch and one PR. The
proposals and the report are data; the repository is where a change gets
reviewed.

**A proposal whose target is not a tracked file in a git repository cannot be
applied.** That rule has a specific consequence worth stating, because it looks
like a gap: firstmate's `data/captain.md` is gitignored, so no proposal ever
edits it. The policy blocks in that file come from `firstmate/captain-*.md` in
this repository, so a fleet-behaviour proposal targets the source here and lands
on the next installer run. The generated file is never the target; the thing that
generates it is.

Targets, in the order the job should prefer them:

| Target | Example | Why it is preferred |
|---|---|---|
| `hablo.json` guard rules | a new `protectedPaths` entry | The guard enforces it. A model cannot forget it. |
| `Taskfile.yml` or CI | a check that fails on the mistake | Deterministic, and it protects humans too |
| `firstmate/captain-*.md` | a line in the branch or tone policy | Fleet-wide, every captain and crewmate |
| project `CLAUDE.md` / `AGENTS.md` | a repository-specific instruction | Local knowledge, reviewed by that repository's owners |

Prefer a rule a machine enforces over a sentence an agent reads. The report says
which kind each proposal is, so the difference is visible while accepting.

**Dismissals stick.** A dismissed key is not proposed again, and `state.json`
keeps the reason. Without that, a daily job proposes the same rejected idea every
day until somebody turns it off. `doctor` lists dismissals so a decision can be
revisited on purpose.

## Configuration

```jsonc
{
  "dream": {
    "$comment": "Reads yesterday's sessions, the guard log, and the current rules; proposes rules that would have prevented the repeats. Proposes only: `hablo-dream apply <n>` opens a pull request. It never writes a memory file and never edits a policy in place.",
    "enabled": true,
    "home": "~/.hablo/dream",
    "since": "24h",
    "sources": {
      "piSessions": true,
      "guardLog": true,
      "claudeCode": true,
      "rules": true
    },
    "projects": ["~/code/payments-api", "~/projects/ai/HABLO-installer"],
    "correctionOpeners": ["no", "don't", "stop", "actually", "I said", "that is wrong", "revert", "undo", "why did you", "never"],
    "limits": {
      "maxClusters": 40,
      "maxEvidencePerCluster": 5,
      "maxQuoteChars": 300,
      "sessionTimeoutMinutes": 20
    },
    "model": "bedrouter/auto",
    "service": {
      "kind": "auto",
      "at": "03:00",
      "launchdLabel": "dev.hablo.dream",
      "systemdUnit": "hablo-dream"
    }
  }
}
```

`projects` bounds which working directories are read, so a session about
something unrelated never reaches the digest. The limits bound what one run
costs: the session sees at most 40 clusters with 5 quotes each, which is a small
prompt regardless of how noisy the day was. A day that overflows the cap says so
in the report rather than silently dropping the tail.

## Phase 2: GitHub review comments

A review comment on a pull request is a correction with a reviewer's name on it,
already written for another human to read, and already attached to a diff. It is
the highest-quality source on this list and it is the only one that needs
network, authentication, and a rate-limit budget, so it is phase 2 rather than
v1.

The shape: for each project, `gh api` the pull requests the fleet opened in the
window, collect review comments and change requests, and emit each as evidence
keyed by `gh:<repo>:<pr>:<comment>`. A comment on a line an agent wrote is a
correction; a comment on a line a human wrote is not, so the extractor needs the
commit author, not just the diff. Reuse the `gh` CLI that firstmate already
requires rather than adding an HTTP client and a second credential.

## Verify before you build

1. **The Pi session tree walk.** Confirm that following `parentId` from the last
   entry yields the active branch, and confirm what a `compaction` entry does to
   the span it replaces, so one correction is not counted twice. Session version
   3 is what is on disk today; check that the reader rejects an unknown version
   loudly instead of guessing.
2. **`pi -p` in a launchd context.** Print mode must not need a TTY, must exit
   non-zero on a model error, and must put nothing but the answer on stdout.
   Check what a `bedrouter` failure prints, because it would otherwise land in
   the middle of the JSON.
3. **The guard in a print-mode session.** `hasUI` is false there, so every guard
   rule denies rather than prompts. Confirm the dream session needs no tool the
   guard blocks; it should only read, and reading `~/.hablo/guard-log.jsonl` must
   not trip `secrets.read` or `paths.agentState`.
4. **Quote redaction against a real transcript**, before the first scheduled run.
   The failure mode is a secret in a report that then goes into a PR body.
5. **How often the correction openers fire.** Run `digest` over the last month by
   hand. If "no" matches half the user turns, the list is wrong and tuning it is
   cheaper than any other change to this design.

Verified 2026-09-13: the one-month bounded run completed against the local Pi v3
corpus. No correction opener fired in the configured HABLO-installer project,
and no built-in credential form survived in the resulting digest. The Dream Pi
session receives only the already-redacted brief and starts with no tools, no
context files, and no saved session, so the print-mode guard has nothing to
prompt for or deny.
