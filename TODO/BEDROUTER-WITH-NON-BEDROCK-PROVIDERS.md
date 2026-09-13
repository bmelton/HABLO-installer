# Keep the suite when the provider is not bedrouter

> Status: implemented for the 0.5.0 release boundary; npm publication and the
> remaining live voyage checks are pending. The provider precedence and late
> switch paths are covered by package tests, and the HABLO wrapper is covered by
> installer fixtures.

**pi-bedrouter (github.com/bmelton/pi-bedrouter, separate repo, target 0.5.0)**

- [x] `launchedWithExplicitModel()`: parse `process.argv` for `--provider` / `--model`
- [x] `autoSelect()`: return early on an explicit choice, and on a non-bedrouter `defaultProvider`
- [x] `PI_BEDROUTER_AUTOSELECT=0` as the environment escape hatch
- [x] `session_start`: skip `bringUp` when the session is not intended for bedrouter
- [x] `model_select`: bring the server up when the user switches to bedrouter later
- [x] Keep `registerProvider` unconditional, so `--list-models` and `/model` still show bedrouter
- [x] Tests for the precedence table, and a README note on the new behaviour
- [ ] Release 0.5.0

**HABLO-installer (this repo)**

- [x] `bin/hablo`: parse `--provider` / `--model`, above `HABLO_PROVIDER` / `HABLO_MODEL`
- [x] `bin/hablo`: resolve one `provider/model` string and export `HABLO_CREW_MODEL`
- [x] `bin/hablo`: print the captain line and the crew line before launching
- [x] `bin/hablo`: refuse a bare `--model` with no provider prefix and no `--provider`
- [x] `bin/hablo`: warn, and continue, when the voyage is not on bedrouter
- [x] `pi/extensions/hablo-captain.ts`: inject the crew-model block, from `ctx.model`
- [x] `firstmate/crew-dispatch.json`: drop `__MODEL__`, rewrite the rules and the `why` text
- [x] `install.mjs` step 9: stop substituting `__MODEL__`
- [x] `install.mjs` preflight: report the `pi-bedrouter` version against `pi.minVersions`
- [x] `hablo.json`: add `pi.minVersions`
- [x] `TODO/HOOKS.md`: record provider neutrality as a design constraint for the guard
- [x] `README.md`: one section on running the suite on another provider

## What this is

Launching Pi on another provider, a ChatGPT login for example, should cost you
bedrouter's cost routing and nothing else. Every other capability in the suite
should still be there. This document says which ones are, which ones are not,
and what has to change.

## What already survives

Most of it, because most of it never mentions a model:

- **Agent profiles and workflows.** All 485 lines of `pi/agents/*.md` and
  `pi/workflows/*.md` contain no reference to any model, provider, or vendor.
- **Every global Pi extension**: `pi-web-access`, `pi-vision-handoff`,
  `pi-impeccable`, `pi-openwiki-adapter`, `pi-agents`. They register tools, and
  tools do not care which model calls them.
- **firstmate itself.** `config/crew-harness` names the harness, `pi`, which is
  independent of the provider Pi runs against.
- **Usage meters.** `pi-openai-codex-usage` gets more useful on a ChatGPT login,
  not less: that is exactly the subscription it was written to track.
- **The guard in `TODO/HOOKS.md`**, which is unbuilt. Provider neutrality is a
  constraint to write into that document now, not a repair.

## What does not survive today

**The session does not stay on the provider you asked for.**
`pi-bedrouter/extensions/index.ts`, `autoSelect(ctx)`, guards on exactly three
things: `settings.autoSelect === false`, `!ctx.hasUI`, and `isOurs(ctx)`. A
session on any other provider is none of those, so the extension calls
`pi.setModel(bedrouter/<auto>)` and notifies you that it did. `install.mjs` step
4 writes `autoSelect: <ladder auto>` into `~/.pi/agent/pi-bedrouter.json`, so
this is on by default on every HABLO machine.

**The server starts anyway.** In the `session_start` handler, `bringUp(ctx,
{ install: true, start: true })` runs whenever `settings.autoStart` is true and
the health check fails, before `autoSelect` is ever consulted. A ChatGPT voyage
still installs, builds, and runs a local Bedrock router on port 20129 that it
never calls.

**The crew stays on Bedrock.** `firstmate/crew-dispatch.json` pins
`bedrouter/<auto>` in `default` and in both rules, so a ChatGPT captain
dispatches a Bedrock crew. Its `why` text also tells the captain "Do not pin
other models or harnesses", which becomes false the moment the captain is
somewhere else.

**Three softer couplings.** Step 8 writes fit notes keyed `bedrouter/<alias>`
into `workflows.json`, which go inert. `bin/hablo` passes
`--provider bedrouter --model <auto>` unless the environment overrides it.
`--default-model` writes `defaultProvider: bedrouter` into `settings.json`.

## Decisions

**An explicit choice always wins.** `autoSelect` applies only when the session
named no provider and no model. This is a fix in `pi-bedrouter`, so every
consumer gets it, not only HABLO. Precedence, highest first:

1. `hablo --provider X --model Y`, or Pi's own `--provider` / `--model`
2. `HABLO_PROVIDER` / `HABLO_MODEL` in the environment
3. `settings.json` `defaultProvider` / `defaultModel`
4. `autoSelect` in `pi-bedrouter.json`

**The crew follows the captain.** Crewmates and scouts inherit the captain's
provider and model rather than being pinned to bedrouter.

**The provider is chosen per voyage, not per machine.** Billing differs by day:
sometimes a flat-rate subscription login, sometimes a metered API key. That
single fact decides the rest of the design.

On a subscription day, the crew is the token-heavy part of the system and its
tokens are free at the margin, so pinning it to Bedrock would spend real money
to avoid free capacity. Following the captain is correct.

On a metered day, OpenAI list rates sit above the Bedrock rungs, so cost routing
matters and the right move is to launch the default, which is bedrouter, and let
the crew follow the captain there too.

The rule holds in both cases because the cost decision is made once, at launch,
by the person who knows how today is billed. Nothing has to infer it.

**Therefore `hablo` prints the choice before it launches.** One line naming the
provider and model the captain will use and the provider the crew will inherit.
A subscription-versus-key mistake is cheap to catch at that moment and expensive
to catch after a crew of six has fanned out.

**The captain's system prompt carries the crew model.** See the mechanism
section below. `hablo-captain.ts` already rewrites the system prompt on every
turn, so HABLO owns a per-process channel that firstmate never reads and two
voyages can never share.

**`hablo` warns and continues; it refuses only what cannot work.** A voyage off
bedrouter prints a warning and launches. A launch that is certainly broken, such
as `--model gpt-5.1` with no provider anywhere, exits non-zero. Nothing prompts
for a keypress, because the Jira daemon in `TODO/JIRA-AGENT.md` dispatches
`hablo` with no terminal attached and a prompt would hang the dispatch.

**The fit notes stay exactly as they are.** They are keyed by model id, so on
another provider they never match, and an entry that never matches cannot
mislead a planner. A provider-neutral set was considered and dropped: it would
add a second source of planning guidance to keep in step with the first, in
exchange for advice generic enough that the planner already behaves that way.
Step 8 needs no change.

## The pi-bedrouter change

This lands in the other repository and HABLO depends on it. Nothing in this
repository can work around the hijack: the extension is loaded globally from
`settings.json` packages, it acts on `session_start`, and it calls
`pi.setModel()` directly.

**Detecting an explicit choice.** `SessionStartEvent` carries only a `reason`,
and `ExtensionContext` exposes the resolved `model` with no provenance, so the
extension cannot ask Pi where the choice came from. It reads `process.argv`
instead, which is honest and exact, because the extension runs inside the Pi
process:

```ts
/** True when this process was launched with an explicit provider or model choice. */
export function launchedWithExplicitModel(argv: string[] = process.argv.slice(2)): boolean {
  for (const a of argv) {
    if (a === "--") break;                       // everything after this is a message, not a flag
    if (a === "--provider" || a === "--model") return true;
    if (a.startsWith("--provider=") || a.startsWith("--model=")) return true;
  }
  return false;
}
```

`--models` (the plural cycling flag) must not match, which is why the prefix
tests carry the `=`. Everything after a bare `--` is a positional message and
must not be scanned: a user asking about "--model" in a prompt is not choosing
one.

**The new guard**, in `autoSelect`:

```ts
async function autoSelect(ctx: ExtensionContext) {
  if (settings.autoSelect === false || !ctx.hasUI) return;
  if (isOurs(ctx)) return;
  if (!wantsUs()) return;                        // new
  ...
}
```

where `wantsUs()` implements levels 1 to 3 of the precedence table:

```ts
/** False when the session named a provider or model that is not ours, at any level above autoSelect. */
function wantsUs(): boolean {
  if (process.env.PI_BEDROUTER_AUTOSELECT === "0") return false;
  if (launchedWithExplicitModel()) return false;
  const dp = piSettings().defaultProvider;       // ~/.pi/agent/settings.json
  if (dp && dp !== settings.providerName) return false;
  return true;
}
```

An explicit `--provider bedrouter` returns false from `launchedWithExplicitModel`
in the sense that it stops `autoSelect` from running, which is correct: the user
already named the provider, and Pi has already honoured it. `autoSelect` exists
to pick a model for a session that named none.

**The autoStart gate.** In `session_start`, `bringUp` runs only when the session
is intended for bedrouter:

```ts
if (!h?.ok && settings.autoStart && wantsUs()) { ... }
```

Three things must stay true around that change:

- `registerProvider` stays unconditional at factory time. It is what makes
  `pi --list-models`, `--provider bedrouter`, and the `/model` picker show the
  bedrouter models whether or not the server is running. Only the *start* and
  the *setModel* are gated.
- `/bedrouter start` still works by hand on any session. The gate is on the
  automatic path only.
- `stopOnExit` needs no change: `startedHere` stays false when nothing started,
  so a session that never brought the server up never takes it down.

**The late switch.** A session that starts on ChatGPT and then picks
`bedrouter/auto` from `/model` would find no server, because `autoStart` was
skipped. The `model_select` handler already fires there and already knows the
new model, so it brings the server up when the new model is ours, the server is
down, and `autoStart` is on. This is what makes the gate safe rather than merely
quiet.

**Version.** Release as 0.5.0. HABLO gates on it; see the installer section.

## How the crew inherits it

This was the open question that blocked the document. The answer comes from
reading firstmate's dispatch, and three findings decided it.

**Finding 1: `--model` carries the provider, and there is no `--provider`.**
`model_flag_for_harness` (`bin/fm-spawn.sh:1978`) emits `--model <value>` and
nothing else for the `pi` harness, and the pi launch template
(`bin/fm-spawn.sh:1558`) has no provider slot at all. Pi's own `--model` accepts
a `provider/id` pattern, so one string carries both. **No firstmate change is
needed**, and the crew model must always be written in `provider/id` form.

**Finding 2: `model` is optional in the dispatch schema.**
`crew_dispatch_validate` (`bin/fm-bootstrap.sh:1103`) requires a non-empty
`harness` on every profile and validates `model` only `when present`. A dispatch
file that names the harness and describes the model in prose is valid.

**Finding 3: the environment allowlist is a scrubber, not an injector.**
`bin/fm-spawn.sh:229` and `:415` are explicit: an absent
`config/launch-env-allowlist` means "unchanged ambient inheritance", and a
present one "opts every launch into `/usr/bin/env -i`", keeping only a fixed
operational floor plus the listed names. Creating that file to pass two HABLO
variables would strip `AWS_PROFILE`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
everything else the crew authenticates with, for every launch on the machine.
**Option 2 from the earlier draft is rejected**, and the reason is worth keeping:
the file looks additive and is subtractive.

**The mechanism: the captain's system prompt.** `hablo-captain.ts` runs
`before_agent_start` and returns a rewritten `systemPrompt` on every turn. It
adds one block naming the exact `--model` string for this voyage. Properties
that decided it:

- Per voyage by construction. The block lives in one Pi process's prompt. Two
  voyages on two providers cannot collide, because there is no shared file.
- It reads `ctx.model`, so it states what Pi actually resolved, not what
  `hablo` asked for. A captain who switches model with `/model` mid-voyage gets
  a corrected block on the next turn, with no work.
- No firstmate change, no shadow configuration directory, and nothing new on
  disk.

The per-voyage config render (`FM_CONFIG_OVERRIDE`, which every firstmate script
honours) also works and is fully deterministic. It was dropped because it makes
HABLO the owner of a copy of firstmate's `config/` directory, and any file
firstmate adds there later would silently vanish for `hablo` voyages.

The remaining weakness, shared with any prose rule, is that a model must follow
an instruction. The consultation backstop limits the damage:
`bin/fm-spawn.sh:1170` refuses any crewmate or scout spawn with no explicit
`--harness` while `config/crew-dispatch.json` exists, so the captain cannot skip
reading the rules, and the rules point at the block.

## `bin/hablo`

Today the wrapper detects `--provider` and `--model` in the argument list only
to decide whether to prepend its own defaults. It must parse them, because it
now has to name the choice out loud and export it.

Resolution, in the precedence order above:

1. `--provider X` and `--model Y` on the `hablo` command line.
2. `HABLO_PROVIDER` / `HABLO_MODEL`.
3. The values stamped in at install time.

Then one string is built for the crew: `MODEL` when it already contains a
slash, otherwise `PROVIDER/MODEL`. That string is exported as
`HABLO_CREW_MODEL` and passed through to Pi as the existing flags.

Output on a normal voyage:

```
hablo: captain  bedrouter/auto-oss
hablo: crew     bedrouter/auto-oss (inherited)
```

Off bedrouter:

```
hablo: captain  openai/gpt-5.1
hablo: crew     openai/gpt-5.1 (inherited)
hablo: WARNING  bedrouter is not in this voyage; no cost routing, no rung fallback,
                no /bedrouter usage. Crew tokens bill to this provider.
```

The two refusals, both before anything launches:

- `--model` with no `/` and no `--provider`, on a machine whose
  `settings.json` sets no `defaultProvider`. There is no provider to build a
  crew string from, and a crewmate would silently land on Pi's own default.
  Exit non-zero and say so.
- `--provider` with an empty value, or `--model` with an empty value.

Everything else warns. An unknown provider name is not a refusal: Pi owns the
provider registry, new providers appear without HABLO knowing, and a wrapper
that keeps its own list of legal providers is a list that goes stale.

## `pi/extensions/hablo-captain.ts`

One more block in the injected preamble, built from `ctx.model` with
`HABLO_CREW_MODEL` as the fallback for the case where Pi has resolved no model
yet:

```markdown
## Crew model (HABLO, this voyage)

Spawn every crewmate and scout with exactly:

    --model bedrouter/auto-oss

That is the provider and model this captain is running, in Pi's `provider/id`
form. `config/crew-dispatch.json` names the harness; this line names the model,
and it is authoritative for this voyage. Do not substitute another model, and do
not omit the flag: `bin/fm-spawn.sh` passes `--model` through only when you give
it, and a crewmate launched without one falls back to Pi's default provider,
which is not this one.
```

The handler already returns `{ systemPrompt }` from `before_agent_start`, so
this is one more entry in the `preamble()` array and one read of `ctx.model`.
The block is omitted when no model is resolved, rather than printed empty.

Secondmates are a separate axis: `bin/fm-spawn.sh:1841` falls back to
`fm-harness.sh secondmate-model` when `--model` is absent. This block speaks to
crewmates and scouts. A secondmate on the wrong provider is a smaller problem
and is left alone.

## `firstmate/crew-dispatch.json`

`__MODEL__` disappears, and with it the substitution in `install.mjs` step 9.
`harness` stays, because it is required by the schema and because the
consultation backstop depends on the file existing.

```jsonc
{
  "$comment": "Written by HABLO-installer to <firstmate>/config/crew-dispatch.json. Every crewmate and scout is a Pi session on the captain's own provider and model; the exact --model string is in the captain's system prompt, under 'Crew model (HABLO, this voyage)'.",
  "rules": [
    {
      "when": "Any task: implementation, fixes, refactors, tests, documentation, investigation, review, scouting.",
      "use": { "harness": "pi" },
      "why": "The crew runs whatever the captain runs. Pass --model with the exact provider/id string from the 'Crew model (HABLO, this voyage)' block in your system prompt, and never omit it. On bedrouter that string is an auto alias, so model tiering stays bedrouter's per-request decision rather than the dispatcher's; on any other provider it keeps the crew on the login the captain chose for today's billing."
    },
    {
      "when": "The captain explicitly asks for a specific tier, e.g. 'use the strongest model' or 'cheap pass only'.",
      "use": { "harness": "pi", "effort": "high" },
      "why": "Raise effort rather than pinning a model. On bedrouter, high effort is an explore signal and the router routes up; on other providers it maps to that provider's own reasoning level. Either way the crew stays on the captain's provider."
    }
  ],
  "default": { "harness": "pi" }
}
```

Both profiles keep `harness: "pi"`, which the validator's `verified()` list
accepts, and neither carries a `model` key, which the validator permits.

## `install.mjs`

**Step 9** stops replacing `__MODEL__`. The dispatch file is copied as written.
The `did()` line changes from "every crewmate -> pi + `<model>`" to naming the
inheritance instead, so a re-run says what it now does.

**Preflight** learns one version check. `hablo.json` gains:

```jsonc
{
  "pi": {
    "minVersions": {
      "$comment": "Installed Pi packages whose version HABLO depends on. Reported in preflight, never enforced: an older package still works, on bedrouter only.",
      "pi-bedrouter": "0.5.0"
    }
  }
}
```

The installed version is read from
`~/.pi/agent/npm/node_modules/<pkg>/package.json`. Below the minimum, preflight
prints, and continues:

```
pi-bedrouter 0.4.1 (needs >= 0.5.0 for non-bedrouter voyages; until you update,
             --provider on any other provider is overridden at session start)
```

This is a `note`, not a `warn`. The machine is fully functional on bedrouter,
which is the default, so it does not belong in the closing warning summary.

**Steps 3, 4, and 8 need no change.** Step 4 keeps writing
`autoSelect: <ladder auto>`, which is now exactly right: it applies when nobody
named anything. Step 3 keeps writing `defaultProvider` only under
`--default-model`, and level 3 of the precedence table makes that a deliberate
machine-wide default rather than a trap. Step 8's fit notes stay as they are, per
the decision above.

## What a non-bedrouter voyage gives up

For the README section. On another provider you lose exactly these, and keep
everything else:

- Cost routing per request, the classifier, and rung escalation on failure.
- The rung fallback table in `hablo.json`, and the entitlement probe that fills it.
- `/bedrouter usage`, `/bedrouter report`, the decision log, and the footer's
  routed-model line.
- The `bedrouter/*` fit notes, which stop matching.

You keep the agent profiles, the workflows, every tool extension, firstmate, the
captain policies, the crew, and the usage meters.

## Testing

`pi-bedrouter`, unit tests around the precedence table:

- `launchedWithExplicitModel` against `--model x`, `--model=x`, `--provider x`,
  `--models a,b`, `-- --model x`, and an empty argv.
- `wantsUs` against each of: nothing set, `defaultProvider: bedrouter`,
  `defaultProvider: openai`, `PI_BEDROUTER_AUTOSELECT=0`.
- `session_start` with a stub health check, asserting that `bringUp` is not
  called when `wantsUs` is false, and that `registerProvider` is called either
  way.
- `model_select` to a bedrouter model with the server down, asserting the
  bring-up.

HABLO, by hand, because these are launch behaviours:

1. `hablo` with no flags: captain and crew both `bedrouter/<auto>`, no warning,
   server up.
2. `hablo --provider openai --model gpt-5.1`: both lines name openai, the
   warning prints, port 20129 stays closed, and the session is still on openai
   after `session_start` has run.
3. `hablo --model gpt-5.1` on a machine with no `defaultProvider`: refuses,
   exit non-zero, nothing launched.
4. `HABLO_PROVIDER=openai HABLO_MODEL=gpt-5.1 hablo --provider bedrouter`: the
   flag wins over the environment.
5. In voyage 2, ask the captain to spawn one crewmate, then read the pane's
   command line: it must carry `--model openai/gpt-5.1`.
6. In voyage 1, switch to `openai/gpt-5.1` with `/model` mid-session, then spawn
   a crewmate: the injected block must have followed the switch.

## Verify before you build

- **`--model provider/id` really switches provider in Pi.** The help text says
  `--model <pattern>` "supports `provider/id`", and the whole crew mechanism
  rests on it, because `bin/fm-spawn.sh` has no `--provider` to pass. Confirm
  with a crewmate spawn, not only with a top-level `pi` invocation.
- **The hijack itself.** Run `pi --provider openai --model <id>` on a machine
  with the current extension and confirm that the session is moved to
  `bedrouter/<auto>` and that the server starts. The reading of the code says it
  does; the fix should be written against an observed failure.
- **`ctx.model` inside `before_agent_start`.** Confirm the handler's second
  argument carries the resolved model on the first turn, before any provider
  request. If it does not, the injected block falls back to `HABLO_CREW_MODEL`
  on turn one and corrects itself afterwards.
- **A dispatch profile with no `model` key.** Run `fm-bootstrap.sh` against the
  new `crew-dispatch.json` and confirm it validates clean, and that a spawn with
  an explicit `--harness pi` and an explicit `--model` is accepted.

## Open questions

- Should `hablo` pass `--provider` at all once `--model provider/id` is proven
  to carry it? Passing one string in one place would remove a whole class of
  disagreement between the two flags. It would also change the captain's own
  launch, so it is a separate change from this one.
- Does anything else in the suite read `settings.json` `defaultModel` and assume
  bedrouter? Step 3 writes it only with `--default-model`, but a machine that
  used that flag once carries it forever, and level 3 of the precedence table
  now makes it silently outrank `autoSelect`.
- Should the crew ever be allowed to diverge from the captain on purpose, for
  example a cheap crew under an expensive captain on a metered day? The current
  answer is no, because the one-decision-at-launch rule is what makes this
  design simple. A second knob would need its own reason.
- `pi-openai-codex-usage` tracks a ChatGPT subscription and `quota-axi` tracks
  quotas generally. On a subscription voyage, should the captain be told its
  remaining quota before it fans out a crew of six against it?
