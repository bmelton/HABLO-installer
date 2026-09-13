# Route across one editable stack: Anthropic back, plus GLM, Qwen, MiniMax, Kimi, and Nova

> Status: buildable spec. Every decision below is settled. The rung table is a
> starting set to edit, and every cell marked `verify` must be checked against the
> model card before the table ships. This work spans three repositories:
> `bedrouter`, `pi-bedrouter`, and this installer.

**bedrouter (github.com/bmelton/bedrouter)**

- [ ] Replace `families: Record<Family, Rung[]>` with `stack: Rung[]`, one ordered list
- [ ] Delete `type Family`; add `vendor`, `serves`, `enabled`, and `capabilities` to `Rung`
- [ ] Delete `routing.classes`; the first eligible rung serving a class is that class's start
- [ ] `modelTable()`: one `auto` alias, no `auto:<family>` parsing
- [ ] Conversation state becomes `{ class, alias, vendor }`; delete every rung index
- [ ] `eligible(request)`: capability filter, then `serves`, in stack order
- [ ] `route()`: first eligible rung for the class, with the incumbent-vendor preference
- [ ] `bump()`: walk right to the next eligible rung serving the class; raise the class at the end
- [ ] Strip `cachePoint` blocks for a rung without prompt caching instead of failing
- [ ] Treat a capability `ValidationException` as ineligibility for that request shape, not as an escalation
- [ ] Serve `auto` over `/v1/chat/completions` only; keep `/v1/messages` for pinned Anthropic rungs
- [ ] Extend `/v1/models` with `vendor`, `serves`, `enabled`, and the capability block
- [ ] `bedrouter stack --explain`: print effective prices and the eligible set per class
- [ ] Decision-log fields: `vendor`, `eligibleCount`, `skipped[]`, `degraded[]`

**pi-bedrouter (github.com/bmelton/pi-bedrouter, target 0.5.0)**

- [ ] Delete the hardcoded `FAMILY` map in `src/models.ts`; read the capability block per rung
- [ ] Register one `auto` model, with `api`, `input`, `contextWindow`, and `maxOutput` per rung
- [ ] `fitNotes()`: derive from `serves` instead of `routing.classes`

**this repository**

- [ ] `hablo.json`: add `bedrouter.stack`; delete `bedrouter.ladders` and `defaults.ladder`
- [ ] `hablo.json`: update `pi.enabledModels` (one `auto`, new aliases, no `auto-oss`)
- [ ] Rename `auto-oss` to `auto` at all ten sites in the table below, including `bin/hablo` and `crew-dispatch.json`
- [ ] Migration: re-stamp an installed `bin/hablo` and `crew-dispatch.json`, and drop `autoSelect` from `pi-bedrouter.json`
- [ ] `install.mjs`: render `~/.bedrouter/bedrouter.json` from `hablo.json` instead of patching the package example
- [ ] `install.mjs`: drop `--ladder`; fail loudly when a class loses its last enabled rung
- [ ] `install.mjs`: the probe fills the discoverable capability fields and warns on a contradiction
- [ ] `install.mjs`: non-fatal preflight for the Anthropic use case form
- [ ] `install.mjs`: derive step 8 fit notes from `serves`
- [ ] Migrate an existing `~/.bedrouter/bedrouter.json` and any `enabledModels` allowlist
- [ ] Verify every `verify` cell and every price in the rung table
- [ ] `README.md`: replace the ladder section with the stack

## Why this exists

Anthropic models were dropped from the first release because Bedrock asked for
an approval step. That step is smaller than it looked: since October 2025 every
serverless model is enabled by default, and Anthropic is the one provider that
still wants a one-time usage form per account. It is a single API call. See
"The Anthropic usage form" below.

While Anthropic comes back, four more vendors are worth having. Z.AI GLM 5 is
frontier-class at less than half the price of Sonnet. MiniMax M2.5 is trained
for agentic scaffolds and costs $0.30 per 1M input. Qwen3 Coder Next and Kimi
K2.5 both target agentic coding with a 256K window. Nova Micro is cheaper than
everything else by a factor of two and supports prompt caching.

## Bedrock does not bind a session to a model family

The question that started this: does Bedrock make you commit to a model family
per session? It does not. There is no session object. `modelId` is a per-request
parameter on `Converse` and on `InvokeModel`, and every model chosen here speaks
the Converse shape with client-side tool calling and response streaming. One
process can call `us.anthropic.claude-opus-5` and `zai.glm-5` on consecutive
requests with the same client and the same credentials.

Four Bedrock facts do constrain the design:

1. **Access is automatic, except for Anthropic.** Serverless models are enabled
   by default in all commercial regions. Anthropic models need the one-time form.
2. **Some IDs are in-region only.** `zai.glm-5`, `zai.glm-4.7` and the Qwen IDs
   have no `us.` geo profile. They must be called in a region that carries them.
   `us-east-1` carries every model in the table below, so the existing
   `bedrouter.region` value keeps working.
3. **Prompt caching is not universal, and misuse is a hard error.** A `cachePoint`
   block sent to a model that does not support caching returns a
   `ValidationException`. Anthropic and Nova support it. GLM, Qwen, MiniMax and
   Kimi do not.
4. **Output caps vary by an order of magnitude.** GLM 4.7 caps output at 4K
   tokens, Qwen3 235B at 8K, Nova Lite at 5K, GLM 5 at 128K. A 4K cap makes a
   model unusable for writing a large diff, whatever its benchmark scores.

## The stack replaces the ladders

Today there are two stacks, one per vendor, ordered cheap to expensive, and the
installer picks one with `--ladder`:

```
families.anthropic:  haiku $1.10 -> sonnet $2.20 -> opus $5.50 -> fable $11.00
families.openai:     gpt-oss-20b $0.07 -> gpt-oss-120b $0.15
routing.classes:     trivial=haiku  execute=sonnet  explore=opus
```

A conversation holds an index into one of those arrays, and `bump()` increments
it. That works because within one vendor, price order is capability order.
Anthropic prices haiku below sonnet below opus because that is the ranking.

Across vendors the property fails. GLM 5 costs $1.00 per 1M input and plans a
refactor; haiku costs $1.10 and does not. A single price-sorted list would send
architecture work to a summarization model.

**Decision: one stack, ordered by hand, and each rung declares what it serves.**

```jsonc
// bedrouter.stack, in hablo.json. The order is authoritative, not derived.
[
  { "alias": "nova-micro",   "vendor": "amazon",  "serves": ["trivial"] },
  { "alias": "gpt-oss-20b",  "vendor": "openai",  "serves": ["trivial"] },
  { "alias": "minimax-m2.5", "vendor": "minimax", "serves": ["execute"] },
  { "alias": "kimi-k2.5",    "vendor": "moonshotai", "serves": ["execute"] },
  { "alias": "glm-5",        "vendor": "zai",     "serves": ["execute", "explore"] },
  { "alias": "sonnet",       "vendor": "anthropic", "serves": ["execute", "explore"] },
  { "alias": "opus",         "vendor": "anthropic", "serves": ["explore"] }
]
```

Routing is one rule: **the leftmost rung that is enabled, passes the capability
filter for this request, and whose `serves` contains the class.** There is no
separate `routing.classes` table, because the first rung serving a class is that
class's start. Adding a model is one entry. Changing the routing is reordering a
line.

**The human owns the order; the machine never reorders.** Price is documentation
in the table, not the sort key. That matters because sticker price is not the
real price: `estimateCost` models cache reads at 0.1x, so a long conversation on
sonnet with a warm cache pays about $0.22 per 1M cached input while the same
conversation on glm-5, which has no prompt caching on Bedrock, pays the full
$1.00 every turn. The cheaper model on paper is four times more expensive in the
loop. Rather than bury that in a ranking formula with an assumed hit rate,
`bedrouter stack --explain` prints the effective price per rung at a configured
hit rate and you place the rows accordingly. A computed ranking would move models
without anyone asking; a printed advisory cannot.

A model classifier that picks rungs by name was considered and rejected. The
classifier runs with a 4000-character window and a 4-second timeout, and it has
no grounded knowledge of models released after its own training. It would return
confident guesses that vary between identical requests, and no past decision
could be reconstructed. Task classification stays at three classes.

## Conversation state and escalation

`Entry` today is `{ class, rung: number }`, where `rung` indexes the family
array, and `bump()`, `floor()` and `reclassify()` all do arithmetic on that index.
An index cannot survive this change: the eligible set is computed per request, so
a request carrying tools has a different list than one without, and position 2
would mean two different models on consecutive turns of one conversation.

**Decision: state is `{ class, alias, vendor }`, and escalation walks the stack.**

```
entry = { class: "execute", alias: "minimax-m2.5", vendor: "minimax" }

bump():  from the current alias, walk right to the next rung that is enabled,
         eligible for this request, and serves the class
         no such rung -> raise the class (trivial -> execute -> explore) and
         take the first eligible rung serving the new class to the right
         still none -> fail with the reason, never silently downgrade
```

Skipping is by rung, never by counting, so a rung the capability filter removed
costs nothing and corrupts nothing. Every other router behaviour keeps its
current meaning, expressed as a stack position rather than a family index:

- **The client-model floor.** `honorClientModel` compares stack positions, so a
  request that names a model below the execute start is still the client's
  explicit cheap choice and still runs there unescalated.
- **Trivial below the floor.** `trivialBelowFloor` still lets a trivial verdict
  go under the named model.
- **Stickiness.** A conversation stays on its alias to protect prompt caching. A
  trivial entry that was never escalated is still re-classified every turn.
- **Upgrade on intent, retry detection, and the per-request class header.**
  Unchanged; they set the class, and the class picks the leftmost eligible rung.

**Prefer the incumbent vendor.** While the conversation's current vendor has an
eligible rung serving the needed class, stay with that vendor even when an
earlier rung belongs to another. Cross vendors on a cold conversation, or when
the incumbent has nothing eligible left. This is what keeps a warm prompt cache
from being thrown away for a lower sticker price.

## Capabilities filter, `serves` ranks

Nothing in `bedrouter` checks capabilities today. `Rung` carries an alias, a
Bedrock ID, two prices and a family, and that is all. Send a request with tool
definitions to a rung that has no tool use and Bedrock returns a
`ValidationException`; `observe()` sees a 4xx and bumps the conversation one
rung, which is a blind guess. It works when the next rung up happens to support
the feature and wastes a turn when it does not. A model that can never satisfy
the request stays in the rotation and fails again on the next conversation.

So each rung carries two kinds of fact, and they must not be mixed:

**Capabilities are objective and filter.** They come from the model card and they
are true or false: tool use, response streaming, image input, structured outputs,
prompt caching, max output tokens, context window, transport.

**`serves` is a judgment and ranks.** Whether GLM 5 is good enough to plan a
refactor is an opinion, and it stays hand-curated next to the hand-ordered stack.

Requirements are read off each request rather than configured, so the filter
needs no extra client cooperation:

| Signal in the request | Requirement | When the rung fails it |
|---|---|---|
| `tools` present | tool use | skip |
| image content block | image input | skip |
| `stream: true` | response streaming | skip |
| `response_format` with a schema | structured outputs | skip |
| `max_tokens` above the rung's cap | output headroom | skip |
| estimated input above the rung's window | context headroom | skip |
| cache points present | prompt caching | **degrade**: strip and proceed |

**Decision: prompt caching is the only capability that degrades.** A model
without it still answers correctly and only costs more, and stripping the
`cachePoint` blocks also prevents the `ValidationException` that sending them
would cause. Everything else skips the rung. A structured-output request answered
with prose, or a tool request answered by a model that cannot call tools, is a
wrong answer that looks like a right one, and the caller cannot tell.

Order of operations per request: walk the stack left to right, take the first
rung that is enabled, passes the capability filter, and serves the class, subject
to the incumbent-vendor preference. When nothing is eligible, fail with the
reason rather than falling back to a rung that cannot do the work. The decision
log records `skipped[]` with a reason per rung, so a surprising choice is
explainable after the fact.

Failure handling changes too. A `ValidationException` that names an unsupported
feature marks the rung ineligible for that request shape and re-picks inside the
same turn. It no longer counts as "the model was too weak" and does not raise the
class. Log the contradiction: it means the table disagrees with Bedrock.

**Where the facts come from.** `ListFoundationModels` and `GetFoundationModel`
report `inputModalities`, `outputModalities`, `responseStreamingSupported` and
`inferenceTypesSupported`. They do not report tool use, prompt caching, or the
output cap. Step 6 already probes entitlement per rung, so extend it: fill the
discoverable fields from the API, keep the rest in the manifest, and warn when a
discovered value contradicts what the manifest claims.

```jsonc
{
  "alias": "glm-5", "bedrockId": "zai.glm-5", "vendor": "zai", "enabled": true,
  "inputPerM": 1.0, "outputPerM": 3.2,
  "serves": ["execute", "explore"],
  "capabilities": {
    "transport": "bedrock-runtime", "api": "converse",
    "toolUse": true, "streaming": true, "imageInput": false,
    "structuredOutputs": true, "promptCaching": false,
    "contextWindow": 200000, "maxOutput": 128000
  }
}
```

`transport` is present from the first version even though every rung sets
`bedrock-runtime`. It is what lets the deferred work below arrive as data.

## The rung table

Proposed starting order for `hablo.json`, cheapest first. `serves` is a human
judgment and is meant to be edited. Prices are US East on-demand per 1M tokens;
the Anthropic rows carry the 10% cross-region premium already recorded in
`bedrouter.example.json`.

| alias | bedrockId | in | out | ctx | max out | cache | serves |
|---|---|---|---|---|---|---|---|
| nova-micro | `us.amazon.nova-micro-v1:0` | 0.035 | 0.14 | verify | verify | yes | trivial |
| nova-lite | `us.amazon.nova-lite-v1:0` | 0.06 | 0.24 | 300K | 5K | yes | trivial |
| gpt-oss-20b | `openai.gpt-oss-20b-1:0` | 0.07 | 0.20 | 128K | 16K | no | trivial |
| glm-4.7-flash | `zai.glm-4.7-flash` | 0.07 | 0.40 | 203K | verify | no | trivial |
| gpt-oss-120b | `openai.gpt-oss-120b-1:0` | 0.15 | 0.60 | 128K | verify | no | execute |
| minimax-m2.5 | `minimax.minimax-m2.5` | 0.30 | 1.20 | 196K | 8K | no | execute |
| qwen3-coder-next | `qwen.qwen3-coder-next` | 0.50 | 1.20 | 256K | 16K | no | execute |
| qwen3-235b | `qwen.qwen3-235b-a22b-2507-v1:0` | 0.53 | 2.66 | 256K | 8K | no | execute |
| kimi-k2.5 | `moonshotai.kimi-k2.5` | 0.60 | 3.00 | 256K | 16K | no | execute |
| glm-4.7 | `zai.glm-4.7` | 0.60 | 2.20 | 203K | 4K | no | execute *(short replies only)* |
| nova-pro | `us.amazon.nova-pro-v1:0` | 0.80 | 3.20 | 300K | 5K | yes | execute |
| glm-5 | `zai.glm-5` | 1.00 | 3.20 | 200K | 128K | no | execute, explore |
| haiku | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | 1.10 | 5.50 | 200K | 64K | yes | trivial, execute |
| sonnet | `us.anthropic.claude-sonnet-5` | 2.20 | 11.00 | 200K | 64K | yes | execute, explore |
| opus | `us.anthropic.claude-opus-5` | 5.50 | 27.50 | 200K | 64K | yes | explore |
| fable | `us.anthropic.claude-fable-5-1` | 11.00 | 55.00 | verify | verify | yes | *(enabled: false)* |

`gpt-oss-20b` max output is 16K, confirmed on the model card during this
revision. Every other `verify` cell still needs one.

Notes on the judgments:

- **minimax-m2.5 is the first execute rung**, at $0.30. MiniMax trained it for
  agentic scaffolds rather than for chat, which is the workload here.
- **gpt-oss-20b serves trivial only.** A 20B open model is a weak choice for
  writing code against tools, and its $0.23 advantage over minimax-m2.5 buys
  failed turns. It stays for trivial work because it is nearly free.
- **glm-4.7 no longer needs a "disabled" note.** Its 4K output cap is a fact the
  capability filter reads, so a request asking for more output skips it and a
  short request uses it. This is the clearest example of the filter replacing a
  hand-written exception.
- **glm-5 is the first explore rung**, at $1.00 against opus at $5.50. That
  single line is most of the cost argument for this change.
- **kimi-k2.5 is the first candidate to promote to explore.** Test Kimi K2
  Thinking ($0.60 / $2.50) against it before deciding, since that variant is the
  reasoning-tuned one.
- **nova-micro becomes the classifier model**, replacing haiku. The classifier
  runs on nearly every undecided request, so it should be the cheapest rung that
  can return one word.
- **fable ships `enabled: false`** on price.
- Nova is the only new vendor with a `us.` geo profile. Confirm whether that
  profile carries a premium over the in-region price, as Anthropic's does.

## Considered and not added

**The proprietary OpenAI models: GPT-5.5, GPT-5.4, GPT-5.6, GPT-6 Astra, Codex.**
Verified on the model cards during this revision:

| Model | `bedrock-runtime` | `bedrock-mantle` |
|---|---|---|
| `gpt-oss-20b`, `gpt-oss-120b` | yes: Converse, Invoke, Chat Completions, Responses | yes, base path `/v1` |
| GPT-5.5 and the rest of the 5.x/6 line | **no**, every API unsupported | only, base path `/openai/v1`, Responses and Chat Completions |

So the two open-weight rungs already in the stack are unaffected and keep
speaking Converse on `bedrock-runtime`. Reaching the proprietary line means a
second upstream transport in `bedrouter` with its own base URL, its own auth
path, and no Converse, and only then does the rung table apply.

**Decision: out of scope here, and the capability block carries `transport` so it
arrives later as data rather than as a reshape.** Price is the second argument
for waiting: GPT-5.5 is $5.50 in and $33.00 out below 272K input tokens, and
$11.00 and $49.50 above it, against glm-5 at $1.00 and $3.20. The models it
unlocks do not serve the cost argument that drives this change. It gets its own
document when it is worth having.

**Claude Mythos 5.1.** A specialist for cybersecurity defense and life sciences,
not general coding. Access is gated to organizations vetted through Anthropic's
trusted access program, and the model requires opting the account into
`provider_data_share` retention. Both facts disqualify it from a default table.

**DeepSeek V3.2** ($0.62 / $1.85) was offered and declined. Nothing here changes
that; it remains a drop-in if the execute rungs disappoint.

**Mistral Devstral 2 123B** ($0.40 / $2.00) is coding-specific and priced between
minimax-m2.5 and qwen3-coder-next. Worth a look when the table is next revised.
Verify its model ID and output cap first.

**Service tiers.** Bedrock offers `default`, `priority` and `flex` per request,
where flex trades latency for a lower price. A cost router is the natural place
to use it, and it is a per-request field rather than a per-rung fact, so it does
not belong in this change. Note it and move on.

**Qwen3 Coder 480B, Nova 2 Lite, Nova Premier, Grok 4.6 and 4.3** are available
and were not priced on the pricing page during this review. None of them fills a
gap the table has now.

## One wire shape

`bedrouter` exposes two client paths today. `/v1/messages` passes the Anthropic
body straight through to `InvokeModel` and rejects any non-Anthropic rung with a
400. `/v1/chat/completions` translates OpenAI shape to Converse and works for any
model. `pi-bedrouter` registers `auto` as `anthropic-messages` because the
Anthropic auto alias could only ever resolve to an Anthropic rung.

That stops holding the moment `auto` can resolve to `zai.glm-5`. The client picks
its wire shape before the router picks the rung, so the shape can no longer
depend on the rung.

**Decision: `auto` is served over `/v1/chat/completions` and translated to
Converse for every vendor, Anthropic included.** Converse supports Anthropic
models, tool use, streaming, and `cachePoint` blocks, so nothing is lost that
matters here. `/v1/messages` stays as-is for clients that pin an Anthropic rung
and want the native betas. `openaiToConverse` already exists and needs no
per-vendor branch.

The per-family constants in `pi-bedrouter/src/models.ts` (`api`, `path`, `input`,
`contextWindow`, `maxTokens`) move into each rung's capability block and travel
over `/v1/models`, with `maxTokens` renamed `maxOutput` to match the model cards.
They are per-model facts, and the table above shows how wrong the per-family
approximation now is: 4K and 128K output caps inside one vendor.

## The Anthropic usage form

Anthropic models are enabled by default but reject inference until the account
submits a one-time use case form. `GetUseCaseForModelAccess` reports the state;
`PutUseCaseForModelAccess` submits it and needs the
`bedrock:PutUseCaseForModelAccess` permission. Submitting from an Organizations
management account covers member accounts.

**Decision: detect and instruct.** A new preflight calls
`GetUseCaseForModelAccess`, and when the form is missing it prints the console
link plus the exact `aws bedrock put-use-case-for-model-access` command, then
continues. The step is non-fatal, matching how AWS login and probe failures
already behave. The installer does not submit a statement about your company and
your intended use on your behalf, and it must not do so on a `--yes` run either.

Without the form, the entitlement probe drops every Anthropic rung and the stack
still routes, which is the desired failure mode.

## What changes in this repository

**`hablo.json`**

- `bedrouter.stack`: the table above, in order, authoritative for this machine.
- `bedrouter.ladders` and `defaults.ladder`: deleted.
- `bedrouter.routing.classifier.model`: `nova-micro`.
- `bedrouter.routing.cacheHitRate`: the advisory multiplier `stack --explain`
  uses. It informs the human ordering the stack and never moves a rung.
- `bedrouter.fallbacks`: keep, keyed by `bedrockId`. GLM and Qwen entries stay
  empty, since in-region IDs have no profile variants to fall back to.
- `pi.enabledModels`: `bedrouter/auto` plus each enabled alias. `auto-oss` goes.

**`auto-oss` becomes `auto`, everywhere.** With one stack there is one auto
alias, so the model name every launched session carries changes. `ladder` and
`ladder.autoSelect` disappear from the installer with it. The sites, all in
`install.mjs` unless noted:

| Where | Now | After |
|---|---|---|
| usage header, lines 6 and 7 | `[--ladder claude\|oss]`, "ladder default" | both lines removed |
| line 49 to 51 | `ladderName` / `ladder` lookup, unknown-ladder failure | deleted |
| line 204 | `settings.defaultModel = ladder.autoSelect` | `"auto"` |
| line 211 | `pi-bedrouter.json` gets `autoSelect: ladder.autoSelect` | key no longer written, and removed from an existing file on migration |
| line 330 to 334 | step 8 reads `ladder.family`, `cfg.aliases` `auto:<family>`, `cfg.families`, `cfg.routing.classes` | one note for `auto`, then one per rung derived from `serves` |
| line 367 | `crew-dispatch.json` `__MODEL__` = `bedrouter/${ladder.autoSelect}` | `bedrouter/auto` |
| line 420 | `cliModel = opt("cli-model", cli.model ?? ladder.autoSelect)` | `cli.model ?? "auto"` |
| line 462 | the closing `Next:` line prints the auto alias | `auto` |
| `hablo.json` | `defaults.ladder`, `cli.$comment2` naming `auto / auto-oss` | `defaults.ladder` deleted; the comment says `null` means `auto` |
| `firstmate/crew-dispatch.json` | `$comment` says "`bedrouter/<ladder auto alias>`" | "`bedrouter/auto`" |

`bin/hablo` and `crew-dispatch.json` on an already-installed machine carry
`auto-oss` baked in. Both are rewritten by `installFile`, which replaces a file
whose content differs and which carries the `HABLO-installer` marker, so
re-running the installer fixes them. Say that in the migration note, because a
stale `~/.local/bin/hablo` would otherwise keep passing `--model auto-oss` to a
router that no longer has the alias, and every session would fail at startup
rather than fall back.

`--cli-model` survives, because pinning a specific rung for the `hablo` command
is still meaningful. `--default-model` survives and now writes `auto`.

**`install.mjs`**

- Step 4 renders `~/.bedrouter/bedrouter.json` from `hablo.json` rather than
  copying the package example and patching two keys. The manifest owns the stack,
  which is the existing convention for everything else in this installer.
- Step 6 (probe) keeps swapping unentitled rungs for fallbacks and dropping the
  rest, with one addition: if a class ends with no enabled rung, fail loudly.
  Silently losing `explore` would route planning work to a trivial model.
- Step 8 derives fit notes from `serves` instead of `routing.classes`.
- `--ladder` is removed. What runs is the `enabled` flag on each rung.
- New preflight for the Anthropic form, non-fatal.

A `--vendors` filter was considered for "Claude only today" and dropped:
`enabled` in the manifest already says it, and a second way to disable a rung
means two places to look when one is missing.

**Migration.** An existing `~/.bedrouter/bedrouter.json` has the old `families`
shape and will not load against the new types. Detect `families`, back the file
up next to itself with a timestamp, and rewrite from the manifest. An existing
`enabledModels` allowlist in `~/.pi/agent/settings.json` still lists
`bedrouter/auto-oss`, which stops existing after this change; drop that entry
when the allowlist already exists, and keep the standing rule about never
creating one.

## Verify before you build

1. **Every `verify` cell and every price in the rung table**, from the model card,
   not from this document. Prices move and these were read once.
2. **Nova geo profile pricing**: whether `us.amazon.nova-*` carries a premium
   over the in-region price the way the Anthropic profiles do.
3. **That `us-east-1` carries every enabled rung**, including the in-region-only
   Z.AI and Qwen IDs, before the stack ships with them enabled.
4. **`GetUseCaseForModelAccess` response shape**, so the preflight can tell
   "form missing" from "call failed" and stay non-fatal in both cases.
5. **That stripping `cachePoint` blocks is sufficient** for a non-caching rung,
   rather than the whole request needing a different shape. This is the one
   degrade path, so it has to be exactly right.
6. **The effective-price advisory against a real week of the decision log.**
   `bedrouter report` already sums what routing cost against what the requested
   model would have cost; check the assumed hit rate against what actually
   happened before anyone reorders the stack by it.

## Sources

- [Z.AI models on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-zai.html), [GLM 5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5.html), [GLM 4.7 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-4-7.html)
- [Qwen3 Coder Next card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-coder-next.html), [Qwen3 235B A22B 2507 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-235b-a22b-2507.html)
- [MiniMax M2.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-minimax-minimax-m2-5.html), [Kimi K2.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html)
- [Nova Lite card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html)
- [Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) (every provider and model on Bedrock)
- [gpt-oss-20b card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-20b.html) (both endpoints), [GPT-5.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html) (`bedrock-mantle` only), [Claude Mythos 5.1 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-mythos-5-1.html)
- [Automatic enablement of serverless foundation models](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-automatic-enablement-serverless-foundation-models)
- [PutUseCaseForModelAccess](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_PutUseCaseForModelAccess.html), [GetUseCaseForModelAccess](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetUseCaseForModelAccess.html)
- [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), [prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html), [service tiers](https://docs.aws.amazon.com/bedrock/latest/userguide/service-tiers-inference.html)
