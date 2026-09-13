# Keep the suite when the provider is not bedrouter

> Status: capture, not a finished spec. The decisions are settled. The crew
> mechanism has three candidate implementations and needs one more read of
> firstmate's dispatch before anyone writes code.

- [ ] `pi-bedrouter`: `autoSelect` must not override an explicit provider or model
- [ ] `pi-bedrouter`: do not `autoStart` the server for a session on another provider
- [ ] `bin/hablo`: add `--provider` and `--model`, winning over `HABLO_PROVIDER` / `HABLO_MODEL`
- [ ] `bin/hablo`: print the provider the captain and the crew will use, before launching
- [ ] Rewrite `firstmate/crew-dispatch.json` so the crew follows the captain
- [ ] Decide the crew mechanism (rules text, env allowlist, or per-voyage render)
- [ ] Add `HABLO_PROVIDER` / `HABLO_MODEL` to `config/launch-env-allowlist`
- [ ] `install.mjs`: stop writing a `bedrouter/*` model pin that a non-Bedrock voyage cannot use
- [ ] Decide what step 8's fit notes say when the session is not on bedrouter
- [ ] `HOOKS.md`: record provider neutrality as a design constraint for the guard
- [ ] `README.md`: one section on running the suite on another provider

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
- **The guard in `HOOKS.md`**, which is unbuilt. Provider neutrality is a
  constraint to write into that document now, not a repair.

## What does not survive today

**The session does not stay on the provider you asked for.** `pi-bedrouter`'s
`autoSelect` runs on every interactive `session_start`, and its only guards are
`autoSelect === false`, no UI, or the session already being on bedrouter. A
session on any other provider is "not ours", so the extension calls
`pi.setModel(bedrouter/<auto>)` and notifies you that it did. The installer
writes `autoSelect` into `~/.pi/agent/pi-bedrouter.json`, so this is on by
default. This is a reading of the code and should be confirmed by running it.

**The server starts anyway.** `autoStart` brings bedrouter up on session start
whatever provider the session uses, so a ChatGPT voyage still runs a local
server on port 20129 that it never calls.

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

On a metered day, OpenAI list rates sit above the Bedrock rungs, so cost
routing matters and the right move is to launch the default, which is bedrouter,
and let the crew follow the captain there too.

The rule holds in both cases because the cost decision is made once, at launch,
by the person who knows how today is billed. Nothing has to infer it.

**Therefore `hablo` prints the choice before it launches.** One line naming the
provider and model the captain will use and the provider the crew will inherit.
A subscription-versus-key mistake is cheap to catch at that moment and expensive
to catch after a crew of six has fanned out.

## How the crew actually inherits it

`crew-dispatch.json` is not read by a program that spawns agents. It is read by
the captain, who then passes explicit flags to `bin/fm-spawn.sh`, and
`fm-spawn.sh` refuses to spawn a crewmate at all when the dispatch file exists
and no explicit harness was given. firstmate calls this the consultation
backstop: the rules can never be silently skipped.

That gives three candidate mechanisms, and the choice is the one open question
that blocks implementation:

1. **Rules text.** `crew-dispatch.json` says to use the same provider and model
   the captain is running, and the captain passes `--model` accordingly.
   `fm-spawn.sh` already accepts `--model <name>`. No new machinery, and it fits
   the consultation design firstmate already has. It depends on the captain
   reading the rule correctly, which is exactly what the file is for, and
   exactly the weakness of any instruction to a model.
2. **Environment allowlist.** firstmate has `config/launch-env-allowlist`, one
   environment variable name per line, which controls what reaches a spawned
   agent's launch environment. Adding `HABLO_PROVIDER` and `HABLO_MODEL` makes
   the captain's choice visible to every crewmate. Pi reads flags rather than
   these variables, so something still has to turn them into `--model`, but the
   value arrives deterministically instead of being retyped.
3. **Per-voyage render.** `hablo` writes `config/crew-dispatch.json` at launch
   from the chosen provider. Fully deterministic. Two voyages on different
   providers would race on one shared file, so this needs firstmate's config
   inheritance (`fm-config-inherit-lib.sh`) checked first to see whether a
   per-session config directory exists.

Recommendation: 1 for the rule, 2 alongside it so the value is available to
anything that can use it, and 3 only if the inheritance model turns out to make
it safe.

## What changes in this repository

- `firstmate/crew-dispatch.json`: stop templating `__MODEL__` into a pin.
  The rules describe following the captain, and the `why` text stops asserting
  that everything goes through bedrouter.
- `bin/hablo`: `--provider` and `--model` flags above the existing environment
  variables, and the pre-launch line naming both choices.
- `install.mjs`: step 9 no longer stamps a bedrouter model into the dispatch
  file. Step 8's fit notes need a decision, below.
- `README.md`: a section on running a voyage on another provider, and what is
  given up by doing it.

## Open questions

- Which crew mechanism? See the three above.
- What do the fit notes say on a non-bedrouter session? They are keyed by model
  id, so they are inert rather than wrong. Options: leave them, write a
  provider-neutral set describing behaviour instead of model ids, or write one
  set per provider the machine has logged into.
- Should `hablo` refuse to launch when the captain's provider has no crew
  equivalent, or warn and continue?
- Does anything else in the suite read `settings.json` `defaultModel` and assume
  bedrouter? Step 3 writes it only with `--default-model`, but a machine that
  used that flag once carries it forever.
