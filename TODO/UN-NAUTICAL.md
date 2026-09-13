# Plain talk policy for firstmate (drop the nautical voice)

> Status: implemented; live model-behaviour sign-off remains. The three items under
> "Verify in a live session" are behaviour checks, not design choices; they
> cannot be answered by reading code, and they gate the sign-off rather than the
> build.

- [x] Write `firstmate/captain-tone-policy.md`, with the inner `TONE-RULE` markers (text is in this document)
- [x] Add `"tonePolicy"` to the `firstmate` block in `hablo.json`
- [x] `install.mjs` step 9: `captainBlock("TONE-POLICY", …)`, gated on `--nautical` / `--no-tone-policy`
- [x] `install.mjs` step 10: render the inner rule to `~/.hablo/tone.md`, or delete it under `--nautical`
- [x] Write `pi/extensions/hablo-tone.ts`; install it to `~/.pi/agent/extensions/`
- [x] Rewrite the `hablo-captain.ts` preamble: no "first mate", no "voyage", no "captain" for the user
- [x] `hablo-captain.ts`: append the tone rule after the AGENTS.md manual, and drop the anchor from the status line
- [x] Edit the five nautical or misaddressed lines in the two existing policy files (table below)
- [x] Edit the one line in `firstmate/crew-dispatch.json`
- [x] Add `--nautical` and `--no-tone-policy` to the usage header
- [x] Add `.hablo/tone.md` and `.pi/agent/extensions/hablo-tone.ts` to `backup.config`
- [x] Document the flag in `README.md`, next to the other policy flags
- [ ] Verify in a live session: the captain, a crewmate PR, and `--nautical`

## What this is

firstmate talks like a pirate. The agent calls the user captain, greets with
ahoy, and describes a unit of work as a voyage. This feature turns that off, so
the agent writes plain technical English.

The mechanism for the captain already exists. `install.mjs` step 9 writes marked
blocks into `~/firstmate/data/captain.md`, firstmate's canonical gitignored
preferences file, through the local `captainBlock(marker, text, label)` helper.
Two blocks live there today, `HABLO:BRANCH-POLICY` and `HABLO:OPENWIKI-POLICY`.
This adds a third.

The captain is the easy half. The rest of this document is about the crewmate,
and about the text in this repository that currently argues with the policy.

## Decisions

**No form of address.** The agent writes "you" and uses no title at all. Not
"captain", and not a neutral replacement like "lead" either. A title is the
problem, so removing the title is the fix. "I opened the PR against PROJ-123",
never "Aye captain, the PR is opened."

**On by default, `--nautical` opts back in.** A bare `./install.sh` writes the
block and the rule file. `--nautical` removes both the marked block and a rule file an
earlier run installed. `--no-tone-policy` is the same switch under the spelling
that matches `--no-branch-policy` and `--no-openwiki-policy`; keep both, and
document `--nautical` as the one people remember.

**The rule reaches a crewmate through a global extension, not through the
brief.** The branch and OpenWiki policies both end with "put these instructions
verbatim in each crewmate's task text", which works only when the captain copies
the line. For those two policies a miss is visible: the branch is wrong, the PR
targets the wrong base. A tone miss is invisible, and the result is a fleet where
the captain writes plainly and every crewmate PR still says ahoy.

`HOOKS.md` settles the placement that fixes this. `~/.pi/agent/extensions/*.ts`
is auto-discovered by every Pi session, including the crewmates firstmate
launches with `pi … -e <task-ext>`, which never run `bin/hablo`. A small
extension appends the rule to the system prompt of every fleet session, and the
captain keeps the readable block in `data/captain.md` as well.

**One source of text.** `firstmate/captain-tone-policy.md` holds the rule and the
propagation line. The installer renders the whole block into `data/captain.md`
and the inner rule alone into `~/.hablo/tone.md`, which the extension reads.
Nobody edits the same sentence twice.

**The rule file is the switch.** `~/.hablo/tone.md` exists when the policy is on
and is absent when it is not. The extension needs no configuration of its own,
and `--nautical` turns off both halves by removing one file.

**This extension fails open.** A missing or unreadable `~/.hablo/tone.md` makes
the extension inert, and a Pi session that fails to read it starts normally. That
is the opposite of the guard in `HOOKS.md`, deliberately: the guard denies when
it cannot decide because the cost of a wrong allow is a leaked credential. The
cost here is a nautical greeting.

**Fleet sessions only.** The extension is inert unless the session is part of the
fleet, which means one of `FM_TASK_ID`, `FM_ROOT`, `FM_ROOT_OVERRIDE`, or
`HABLO_PROJECT` is set. The nautical voice comes from firstmate's `AGENTS.md`, so
injecting a rule against it into an unrelated `pi` session on the same machine
spends tokens every turn for nothing.

**Technical names stay.** `firstmate`, `hablo`, `crewmate`, `crew-dispatch.json`,
`crew-harness`, `bin/fm-spawn.sh` and every other `fm-*.sh`, `data/captain.md`,
`FM_ROOT`, `FM_HOME`, `projects/<name>`. The agent must still say "crewmate" and
"captain.md" when it means those things, because renaming them in prose makes its
instructions wrong. The policy bans the voice, not the vocabulary of the tool.

"Captain" is the hard case, because it is both a title for the user and the name
of a session kind. **The rule: "the captain" stays where it names a session (a
captain session, as opposed to a crewmate) or a file (`data/captain.md`), and
becomes "the user" where it means the human.** The table below resolves every
existing occurrence, so the implementation involves no judgement calls.

## The policy text

`firstmate/captain-tone-policy.md`, markers included. The outer pair is what
`captainBlock` replaces in `data/captain.md`; the inner pair is what the
installer extracts into `~/.hablo/tone.md`.

```markdown
<!-- HABLO:TONE-POLICY:START -->
<!-- HABLO:TONE-RULE:START -->
## Tone (HABLO)

Write plain technical English. The nautical framing in this harness is naming,
not a register to write in.

- Do not address the user by a title. No "captain", no "skipper", no substitute
  title either. Say "you", or say nothing and state the fact.
- Do not use nautical figures of speech: no ahoy, aye, avast, all hands, set
  sail, batten down, smooth sailing, charting a course, rough seas, anchors
  aweigh, or a ship metaphor for the work.
- Call things what they are. A task is a task, not a voyage. A branch is a
  branch, not a heading. A failure is a failure, not running aground.
- Greet with nothing. Open with the status or the answer.
- Keep the harness's own names: firstmate, crewmate, `fm-spawn.sh`,
  `crew-dispatch.json`, `data/captain.md`, `projects/<name>`. Those are
  identifiers, and renaming them in prose makes the instructions wrong.
- No emoji unless the user uses one first.
<!-- HABLO:TONE-RULE:END -->

Put this instruction verbatim in each crewmate's task text:
  Write plain technical English in your PR description, your commits, and your
  report. No nautical figures of speech, no title for the user, no greeting.
<!-- HABLO:TONE-POLICY:END -->
```

The propagation line stays even though the extension covers the crewmate. It
costs one sentence, it reaches a crewmate on a harness that is not Pi, and it
tells the captain what the crewmate was told.

## The extension

`pi/extensions/hablo-tone.ts`, installed to `~/.pi/agent/extensions/hablo-tone.ts`.
It is about thirty lines and copies the mtime-cached read from
`hablo-captain.ts`.

```
inert when:  no fleet marker in the environment
             HABLO_TONE is "off" or "nautical"
             ~/.hablo/tone.md is missing or unreadable
otherwise:   before_agent_start -> systemPrompt + "\n\n" + tone.md
```

**It does not run in a captain session.** `hablo-captain.ts` appends firstmate's
`AGENTS.md` to the system prompt every turn, and `AGENTS.md` is the nautical
source. A rule appended before that manual is answered by the manual. So
`hablo-captain.ts` appends the tone rule itself, after the manual, and
`hablo-tone.ts` skips the session whenever `hablo-captain.ts` is active, which is
exactly the condition that extension already tests: `FM_ROOT` (or
`FM_ROOT_OVERRIDE`) and `HABLO_PROJECT` both set.

That split removes any dependence on extension load order, which Pi documents as
load order but does not promise to keep stable between a `-e` argument and an
auto-discovered file. A crewmate has no `AGENTS.md` injection from us, so order
does not matter there.

`HABLO_TONE=nautical` turns the rule off for one session without touching the
installed files, which is what makes the before-and-after check below a single
command.

## Text to change in this repository

Eight lines, listed so nobody has to decide what counts.

| File | Line | Now | Change to |
| --- | --- | --- | --- |
| `firstmate/captain-branch-policy.md` | 6 | "If the captain's request has none" | "If the request has none" |
| `firstmate/captain-branch-policy.md` | 7 | "stop and ask the captain" | "stop and ask the user" |
| `firstmate/captain-branch-policy.md` | 12 | "the captain opens the team's normal PR" | "open the team's normal PR" (the reader is that session) |
| `firstmate/captain-openwiki-policy.md` | 6 | "At the start of a voyage on a project" | "At the start of work on a project" |
| `firstmate/captain-openwiki-policy.md` | 6 | "ask the captain whether to run `/openwiki init`" | "ask the user whether to run `/openwiki init`" |
| `firstmate/captain-openwiki-policy.md` | 13 | "(or ask the captain to), so the next voyage starts" | "(or ask the user to), so the next session starts" |
| `firstmate/crew-dispatch.json` | 10 | "The captain explicitly asks for a specific tier" | "The user explicitly asks for a specific tier" |
| `pi/extensions/hablo-captain.ts` | 36 | "You are the first mate. … what this voyage is about unless the captain says otherwise." | "This session is firstmate's captain session for the project. … what this session is about unless the user says otherwise." |

Two occurrences stay: the heading `# firstmate captain, launched by hablo …` at
line 34 and the notify text at line 50 both name a session kind.

The status line at line 53 becomes `firstmate · <name>` without the anchor when
`~/.hablo/tone.md` exists, and keeps `⚓ firstmate · <name>` when it does not.
One switch, one decision, no exception to explain later.

**firstmate's own `AGENTS.md` is not ours.** It is a tracked file in an upstream
checkout, `hablo-captain.ts` injects it whole, and we must not edit it. A policy
block and a system-prompt rule are the only levers we have, and neither is a
guarantee. Say that in `README.md`.

## Installer wiring

`hablo.json`, in the `firstmate` block next to `captainPolicy` and
`openwikiPolicy`:

```json
"tonePolicy": "firstmate/captain-tone-policy.md"
```

Step 9, after the OpenWiki block (`install.mjs:398`):

```js
// Plain talk: firstmate's nautical voice is naming, not a register. --nautical keeps it.
const tone = !flag("nautical") && !flag("no-tone-policy");
if (tone) captainBlock("TONE-POLICY", fs.readFileSync(path.join(here, fm.tonePolicy), "utf8").trim() + "\n", "plain talk policy");
```

Step 10, next to the `hablo-captain.ts` install, because that is where
`habloHome` and `installFile` already exist:

- When the policy is on: extract the `HABLO:TONE-RULE` section from
  `fm.tonePolicy` and write it to `~/.hablo/tone.md`, then install
  `pi/extensions/hablo-tone.ts` to `~/.pi/agent/extensions/`.
- When it is off: delete `~/.hablo/tone.md` if this installer wrote it, and say
  so in the step output. Leave the extension in place; without the rule file it
  is inert, and deleting it would fight a re-run that turns the policy back on.

A step-9 skip must not leave a step-10 rule file behind, so read the same `tone`
value in both steps rather than testing the flags twice.

Implementation note: the disabled path also removes an existing marked
`HABLO:TONE-POLICY` block. Merely skipping `captainBlock` would leave the policy
active after a previous default install.

`backup.config` gains `.hablo/tone.md` and
`.pi/agent/extensions/hablo-tone.ts`. The usage header gains both flag spellings.

## Verify in a live session

Verified on 2026-09-13 with Pi 0.85.1's real RPC loader: passing an explicit
`-e` extension still loaded a probe from `~/.pi/agent/extensions/`. The captain
extension also appended the rendered tone rule after the firstmate manual, and
the crewmate extension appended it only for an `FM_TASK_ID` session. The three
language-output checks below remain for sign-off because they require model
turns and a real crewmate report.

Three checks, and none of them can be done by reading code. Run them before
ticking the last box.

1. **The captain.** `cd <project> && hablo`, then ask for a status report and
   dispatch one task. Read ten turns. Expect no greeting, no title, and no
   voyage. Then run the same session with `HABLO_TONE=nautical hablo` and compare;
   if the two read the same, the injection is not landing and the first place to
   look is whether `hablo-captain.ts` appended the rule after the manual.
2. **The crewmate.** Let the captain spawn one crewmate, then read the crewmate's
   PR description and its report. This is the check the old draft could not make,
   because the old design had no mechanism that reached the crewmate directly.
3. **`--nautical`.** Re-run the installer with the flag, confirm
   `data/captain.md` loses the block and keeps the other two, confirm
   `~/.hablo/tone.md` is gone, and confirm the anchor returns to the status line.

Record what the leakage actually looks like. The prediction is that the voice
becomes plain but not clean, because firstmate's `AGENTS.md` keeps arguing for
the other register on every turn. If the result is worse than that, the next
lever is the brief text firstmate builds, and that is a separate change.
