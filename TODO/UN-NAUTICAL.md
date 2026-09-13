# Plain talk policy for firstmate (drop the nautical voice)

> Status: capture, not a finished spec. The draft policy text below is the part
> that matters; the installer wiring is a copy of what two other policies
> already do.

- [ ] Write `firstmate/captain-tone-policy.md` (draft is in this document)
- [ ] Add `"tonePolicy"` to the `firstmate` block in `hablo.json`
- [ ] Wire `captainBlock("TONE-POLICY", ...)` into `install.mjs` step 9
- [ ] Add the `--nautical` flag (and the `--no-tone-policy` spelling) plus the usage header line
- [ ] Document it in `README.md`
- [ ] Run a live session and check the greeting, the status reports, and a crewmate brief

## What this is

firstmate talks like a pirate. The agent calls the user captain, greets with
ahoy, and describes a unit of work as a voyage. This feature turns that off with
a standing preference in firstmate's own policy file, so the agent writes plain
technical English instead.

The mechanism already exists and needs no new invention. `install.mjs` step 9
writes marked blocks into `~/firstmate/data/captain.md`, firstmate's canonical
gitignored preferences file, through the local `captainBlock(marker, text, label)`
helper. Each block is replaced in place on re-runs and touches nothing else in
the file. Two blocks live there today, `HABLO:BRANCH-POLICY` and
`HABLO:OPENWIKI-POLICY`, sourced from `firstmate/captain-branch-policy.md` and
`firstmate/captain-openwiki-policy.md` and named in `hablo.json` under
`firstmate.captainPolicy` and `firstmate.openwikiPolicy`. This is a third one.

## Decisions

**No form of address.** The agent writes "you" and uses no title at all. Not
"captain", and not a neutral replacement like "lead" either. A title is the
problem, so removing the title is the fix. "I opened the PR against PROJ-123",
never "Aye captain, the PR is opened."

**On by default, `--nautical` opts back in.** A bare `./install.sh` writes the
block. `--nautical` skips it and leaves firstmate's own voice intact.
`--no-tone-policy` does the same thing and matches the existing
`--no-branch-policy` and `--no-openwiki-policy` spelling; keep both, document
`--nautical` as the one people remember.

**Agent prose only.** The policy governs what the agent writes. It does not touch
`pi/extensions/hablo-captain.ts`.

That last one has a consequence worth writing down now, because it will look like
a bug later. `hablo-captain.ts` injects its preamble into the system prompt every
turn, and that preamble opens with "You are the first mate", describes the
session as a voyage, and sets the status line to `⚓ firstmate · <name>`. The
tone policy therefore argues with our own extension on every turn: the system
prompt says first mate, the policy says drop the sea talk. Expect the voice to be
plainer but not clean, and expect the anchor to stay in the status bar. If that
turns out to be too leaky in practice, the fix is a preamble rewrite, which is a
separate change to a separate file.

## What does not change

Technical names stay as they are, the same way `mutex` and `idempotent` stay:

- `firstmate`, `hablo`, `crewmate`, `crew-dispatch.json`, `crew-harness`
- `bin/fm-spawn.sh` and every other `fm-*.sh` script
- `data/captain.md`, `FM_ROOT`, `FM_HOME`, `projects/<name>`
- firstmate's own README, its AGENTS.md, and its command output

The agent must still say "crewmate" and "captain.md" when it means those things,
because renaming them in prose would make its instructions wrong. The policy bans
the voice, not the vocabulary of the tool.

## Draft policy text

Goes in `firstmate/captain-tone-policy.md`, markers included, the same shape as
the other two files:

```markdown
<!-- HABLO:TONE-POLICY:START -->
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
  identifiers and renaming them in prose makes the instructions wrong.
- No emoji unless the user uses one first.

Put this instruction verbatim in each crewmate's task text:
  Write plain technical English in your PR description, your commits, and your
  report. No nautical figures of speech, no title for the user, no greeting.
<!-- HABLO:TONE-POLICY:END -->
```

The propagation line at the end follows the convention the branch and OpenWiki
policies already use ("Put these instructions verbatim in each crewmate's task
text"). Without it the captain writes plainly and every crewmate PR still says
ahoy.

## Installer wiring

Three small edits, each one a copy of an existing line.

`hablo.json`, in the `firstmate` block next to `captainPolicy` and
`openwikiPolicy`:

```json
"tonePolicy": "firstmate/captain-tone-policy.md"
```

`install.mjs` step 9, after the OpenWiki block (around line 400):

```js
// Plain talk: firstmate's nautical voice is naming, not a register. --nautical keeps it.
if (!flag("nautical") && !flag("no-tone-policy"))
  captainBlock("TONE-POLICY", fs.readFileSync(path.join(here, fm.tonePolicy), "utf8").trim() + "\n", "plain talk policy");
```

The usage header at the top of `install.mjs` gets the flag, next to the other
`--no-*-policy` entries.

## Open questions

- Does the policy actually win against the `hablo-captain.ts` preamble? Run a
  session and read ten turns before deciding whether the preamble needs the
  rewrite.
- Does the crewmate propagation line survive into the brief? The captain writes
  the brief, so a captain that ignores the line quietly loses the whole effect
  for every crewmate.
- The `⚓ firstmate · <name>` status line stays under this decision. Leave it as
  a deliberate exception, or fold it into a later change?
- firstmate upstream may put nautical text in its own AGENTS.md, which
  `hablo-captain.ts` injects whole. We do not control that file and we must not
  edit a tracked upstream file. A policy block is the only lever we have.
