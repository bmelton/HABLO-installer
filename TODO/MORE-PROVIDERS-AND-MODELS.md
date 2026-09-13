# Route across every enabled model: Anthropic back, plus GLM, Qwen, MiniMax, Kimi, and Nova

> Status: capture, not a finished spec. The design decisions below are settled.
> The rung table is a starting set to edit, not a measured result. This work
> spans three repositories: `bedrouter`, `pi-bedrouter`, and this installer.

- [ ] `bedrouter`: replace `type Family = "anthropic" | "openai"` with a free-form `vendor` string
- [ ] `bedrouter`: add `serves`, `enabled` and a `capabilities` block to `Rung`
- [ ] `bedrouter`: rewrite `Router.route()` to pick the cheapest eligible rung for the class, not a rung in a family
- [ ] `bedrouter`: incumbent-vendor preference and cross-vendor escalation
- [ ] `bedrouter`: add a `capabilities` block per rung; filter candidates on it before ranking
- [ ] `bedrouter`: read each request's requirements (tools, images, streaming, schema, output size, input size)
- [ ] `bedrouter`: strip `cachePoint` blocks for rungs without caching rather than failing
- [ ] `bedrouter`: treat a capability `ValidationException` as ineligibility, not as an escalation
- [ ] `bedrouter`: delete `routing.classes`; `auto:<family>` collapses to one `auto` alias
- [ ] `bedrouter`: serve `auto` over `/v1/chat/completions` only; keep `/v1/messages` for pinned Anthropic rungs
- [ ] `bedrouter`: extend `/v1/models` with the new per-rung fields
- [ ] `pi-bedrouter`: delete the hardcoded `FAMILY` map in `src/models.ts`; read per-rung fields instead
- [ ] `pi-bedrouter`: register one `auto` model, with `api` taken per model
- [ ] `hablo.json`: add the `bedrouter.rungs` table; delete `bedrouter.ladders` and `defaults.ladder`
- [ ] `hablo.json`: update `pi.enabledModels` (one `auto`, new aliases, no `auto-oss`)
- [ ] `install.mjs`: render `~/.bedrouter/bedrouter.json` from `hablo.json` instead of patching the package example
- [ ] `install.mjs`: drop `--ladder`; the entitlement probe must fail loudly when a class loses its last rung
- [ ] `install.mjs`: probe fills the discoverable capability fields and warns when they contradict the manifest
- [ ] `install.mjs`: new non-fatal preflight for the Anthropic first-time-use form
- [ ] `install.mjs`: derive step 8 fit notes from `serves`
- [ ] Migrate an existing `~/.bedrouter/bedrouter.json` and any `enabledModels` allowlist
- [ ] Verify the prices and every `verify` cell in the rung table
- [ ] `README.md`: replace the ladder section

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

## Decision: no ladders

`Router.classify()` produces one of three classes (`trivial`, `execute`,
`explore`) from prompt shape and keywords, with the classifier model consulted
only when the rules are undecided. It never compares two models. The ladder was
the place where "this model is good enough for this class" was recorded, and
`routing.classes[family][class]` was the lookup.

Ladders worked because within one vendor, price order is capability order.
Anthropic prices haiku below sonnet below opus because that is the ranking.
Across vendors the property fails: GLM 5 costs $1.00 per 1M input and is a
planning-grade model, while haiku costs $1.10 and is not. A single price-sorted
list would send architecture work to a summarization model.

So the claim moves onto each rung, and the ladder disappears:

```json
{ "alias": "glm-5", "bedrockId": "zai.glm-5", "vendor": "zai",
  "inputPerM": 1.0, "outputPerM": 3.2, "serves": ["execute", "explore"] }
```

Routing becomes one rule: **for the classified class, pick the cheapest enabled
rung whose `serves` contains that class.** The ordering is derived, so a routing
decision is reproducible from the table alone, and adding a model is one entry.
A capability filter runs before this rule; see "Capabilities filter, `serves`
ranks" below.

A model classifier that picks rungs by name was considered and rejected. The
classifier runs with a 4000-character window and a 4-second timeout, and it has
no grounded knowledge of models released after its own training. It would return
confident guesses that vary between identical requests, and no past decision
could be reconstructed. Task classification stays at three classes.

## The rung table

Proposed starting values for `hablo.json`, sorted by input price. `serves` is a
human judgment and is meant to be edited. Prices are US East on-demand per 1M
tokens; the Anthropic rows carry the 10% cross-region premium already recorded
in `bedrouter.example.json`.

| alias | bedrockId | in | out | ctx | max out | cache | serves |
|---|---|---|---|---|---|---|---|
| nova-micro | `us.amazon.nova-micro-v1:0` | 0.035 | 0.14 | verify | verify | yes | trivial |
| nova-lite | `us.amazon.nova-lite-v1:0` | 0.06 | 0.24 | 300K | 5K | yes | trivial |
| gpt-oss-20b | `openai.gpt-oss-20b-1:0` | 0.07 | 0.20 | 128K | verify | no | trivial |
| glm-4.7-flash | `zai.glm-4.7-flash` | 0.07 | 0.40 | 203K | verify | no | trivial |
| gpt-oss-120b | `openai.gpt-oss-120b-1:0` | 0.15 | 0.60 | 128K | verify | no | execute |
| minimax-m2.5 | `minimax.minimax-m2.5` | 0.30 | 1.20 | 196K | 8K | no | execute |
| qwen3-coder-next | `qwen.qwen3-coder-next` | 0.50 | 1.20 | 256K | 16K | no | execute |
| qwen3-235b | `qwen.qwen3-235b-a22b-2507-v1:0` | 0.53 | 2.66 | 256K | 8K | no | execute |
| kimi-k2.5 | `moonshotai.kimi-k2.5` | 0.60 | 3.00 | 256K | 16K | no | execute |
| glm-4.7 | `zai.glm-4.7` | 0.60 | 2.20 | 203K | 4K | no | *(disabled)* |
| nova-pro | `us.amazon.nova-pro-v1:0` | 0.80 | 3.20 | 300K | 5K | yes | execute |
| glm-5 | `zai.glm-5` | 1.00 | 3.20 | 200K | 128K | no | execute, explore |
| haiku | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | 1.10 | 5.50 | 200K | 64K | yes | trivial, execute |
| sonnet | `us.anthropic.claude-sonnet-5` | 2.20 | 11.00 | 200K | 64K | yes | execute, explore |
| opus | `us.anthropic.claude-opus-5` | 5.50 | 27.50 | 200K | 64K | yes | explore |
| fable | `us.anthropic.claude-fable-5-1` | 11.00 | 55.00 | verify | verify | yes | *(disabled)* |

Notes on the judgments:

- **minimax-m2.5 is the default execute rung**, at $0.30. MiniMax trained it for
  agentic scaffolds rather than for chat, which is the workload here.
- **gpt-oss-20b drops to trivial only.** A 20B open model is a weak choice for
  writing code against tools, and its $0.23 advantage over minimax-m2.5 buys
  failed turns. It stays as a trivial rung because it is nearly free.
- **glm-4.7 ships disabled** for now. Its 4K output cap cannot hold a real diff,
  and glm-4.7-flash covers the same vendor for trivial work at a ninth of the
  price. Once the capability filter lands, enable it and let `maxOutput` decide:
  requests that fit get a cheap rung, requests that do not skip it.
- **glm-5 is the default explore rung**, at $1.00 against opus at $5.50. That
  single line is most of the cost argument for this change.
- **kimi-k2.5 is a second execute rung** and the first candidate to promote to
  explore. Test Kimi K2 Thinking ($0.60 / $2.50) against it before deciding,
  since that variant is the reasoning-tuned one.
- **nova-micro becomes the classifier model**, replacing haiku. The classifier
  runs on nearly every undecided request, so it should be the cheapest rung that
  can return one word.
- **fable ships disabled** on price.
- Nova is the only new vendor with a `us.` geo profile. Confirm whether that
  profile carries a premium over the in-region price, as Anthropic's does.

## Considered and not added

**OpenAI GPT-5.5, GPT-5.4, GPT-5.6, GPT-6 Astra, and Codex.** These are the
strongest coding models on Bedrock and they cannot be reached by the current
design. They do not support the `bedrock-runtime` endpoint at all: no Converse,
no Invoke, no Messages. They live on `bedrock-mantle` at `/openai/v1`, with the
Responses API and Chat Completions only. Adding them means a second upstream
transport in `bedrouter`, including its own authentication path, and only then
does the rung table apply. Price is the other argument for waiting: GPT-5.5 is
$5.50 in and $33.00 out below 272K input tokens, and $11.00 in and $49.50 out
above it, against glm-5 at $1.00 and $3.20. The open-weight `gpt-oss` models are
unaffected and stay on `bedrock-runtime` with Converse.

**Claude Mythos 5.1.** A specialist for cybersecurity defense and life sciences,
not general coding. Access is gated to organizations vetted through Anthropic's
trusted access program, and the model requires opting the account into
`provider_data_share` retention. Both facts disqualify it from a default table.

**DeepSeek V3.2** ($0.62 / $1.85) was offered and declined. Nothing here changes
that; it remains a drop-in if the execute rungs disappoint.

**Mistral Devstral 2 123B** ($0.40 / $2.00) is coding-specific and priced
between minimax-m2.5 and qwen3-coder-next. Worth a look when the table is next
revised. Verify its model ID and output cap first.

**Qwen3 Coder 480B, Nova 2 Lite, Nova Premier, Grok 4.6 and 4.3** are available
and were not priced on the pricing page during this review. None of them fills a
gap the table has now.

## Capabilities filter, `serves` ranks

Nothing in `bedrouter` checks capabilities today. `Rung` carries an alias, a
Bedrock ID, two prices and a family, and that is all. Send a request with tool
definitions to a rung that has no tool use and Bedrock returns a
`ValidationException`; `observe()` sees a 4xx and bumps the conversation one
rung, which is a blind guess. It works when the next rung up happens to support
the feature and wastes a turn when it does not. A model that can never satisfy
the request stays in the rotation and fails again on the next conversation.

So the table carries two kinds of fact, and they must not be mixed:

**Capabilities are objective and filter.** They come from the model card and
they are true or false: tool use, response streaming, image input, structured
outputs, prompt caching, max output tokens, context window, transport.

**`serves` is a judgment and ranks.** Whether GLM 5 is good enough to plan a
refactor is an opinion, and it stays hand-curated.

Requirements are read off each request rather than configured, so the filter
needs no extra client cooperation:

| Signal in the request | Requirement | When the rung fails it |
|---|---|---|
| `tools` present | tool use | drop |
| image content block | image input | drop |
| `stream: true` | response streaming | drop |
| `response_format` with a schema | structured outputs | drop |
| `max_tokens` above the rung's cap | output headroom | drop |
| estimated input above the rung's window | context headroom | drop |
| cache points present | prompt caching | **degrade**: strip and proceed |

The drop-versus-degrade split is the part that earns its keep. Prompt caching is
an optimization, so a rung without it should still run, minus the `cachePoint`
blocks, which also prevents the `ValidationException` that sending them would
cause. Tool use is semantics. A rung that cannot call tools must never be
substituted for one that can, however cheap it is.

Order of operations per request: filter by capability, then keep the rungs whose
`serves` contains the class, then rank by effective price, then apply the
incumbent-vendor preference. When the filter empties the candidate set, fail
with the reason rather than falling back to a rung that cannot do the work.

Failure handling changes too. A `ValidationException` that names an unsupported
feature marks the rung ineligible for that request shape and re-picks inside the
same turn. It no longer counts as "the model was too weak" and does not bump the
class. Log the contradiction: it means the table disagrees with Bedrock.

**Where the facts come from.** `ListFoundationModels` and `GetFoundationModel`
report `inputModalities`, `outputModalities`, `responseStreamingSupported` and
`inferenceTypesSupported`. They do not report tool use, prompt caching, or the
output cap. Step 6 already probes entitlement per rung, so extend it: fill the
discoverable fields from the API, keep the rest in the manifest, and warn when a
discovered value contradicts what the manifest claims.

```json
{
  "alias": "glm-5", "bedrockId": "zai.glm-5", "vendor": "zai",
  "inputPerM": 1.0, "outputPerM": 3.2,
  "serves": ["execute", "explore"],
  "capabilities": {
    "api": "converse", "toolUse": true, "streaming": true,
    "imageInput": false, "structuredOutputs": true, "promptCaching": false,
    "contextWindow": 200000, "maxOutput": 128000
  }
}
```

This also removes the guesswork from two rows in the table above. GLM 4.7 does
not need a hand-written "disabled" note once `maxOutput: 4096` is a fact the
filter reads: any request asking for more output skips it automatically, and it
stays available for the short replies it can actually produce.

## Cross-vendor routing and the caching trap

Sticker price is not the price. `estimateCost` already models cache reads at
0.1x input, and conversations are sticky because of it. A long conversation on
sonnet with a warm cache pays about $0.22 per 1M cached input. The same
conversation on glm-5, which has no prompt caching on Bedrock, pays the full
$1.00 every turn. The cheaper model on paper is four times more expensive in the
loop.

Two rules follow:

1. **Prefer the incumbent vendor.** While the conversation's current vendor has
   an enabled rung serving the needed class, stay there. Cross vendors only on a
   cold conversation, or on an escalation the incumbent rung already failed.
2. **Rank candidates by effective price, not list price.** For a conversation
   past its first turn, a rung with `capabilities.promptCaching: false` is
   scored at its full input rate and a caching rung at a blended rate. Use a flat
   assumed-hit-rate multiplier in config rather than tracking real hit rates.

Escalation keeps its current trigger set (error status, malformed tool JSON,
truncation) and walks the candidate list for the class, then moves up a class.

## One wire shape

`bedrouter` exposes two client paths today. `/v1/messages` passes the Anthropic
body straight through to `InvokeModel` and rejects any non-Anthropic rung with a
400. `/v1/chat/completions` translates OpenAI shape to Converse and works for
any model. `pi-bedrouter` registers `auto` as `anthropic-messages` because the
Anthropic auto alias could only ever resolve to an Anthropic rung.

That stops holding the moment `auto` can resolve to `zai.glm-5`. The client
picks its wire shape before the router picks the rung, so the shape can no
longer depend on the rung.

**Resolution: `auto` is served over `/v1/chat/completions` and translated to
Converse for every vendor, Anthropic included.** Converse supports Anthropic
models, tool use, streaming, and `cachePoint` blocks, so nothing is lost that
matters here. `/v1/messages` stays as-is for clients that pin an Anthropic rung
and want the native betas. `openaiToConverse` already exists and needs no
per-vendor branch.

The per-family constants in `pi-bedrouter/src/models.ts` (`api`, `path`,
`input`, `contextWindow`, `maxTokens`) move into the rung's `capabilities` block
and travel over `/v1/models`, with `maxTokens` renamed `maxOutput` to match the
model cards. They are per-model facts, and the table above shows how wrong the
per-family approximation now is: 4K and 128K output caps inside one vendor.

## The Anthropic usage form

Anthropic models are enabled by default but reject inference until the account
submits a one-time use case form. `GetUseCaseForModelAccess` reports the state;
`PutUseCaseForModelAccess` submits it and needs the
`bedrock:PutUseCaseForModelAccess` permission. Submitting from an Organizations
management account covers member accounts.

**Assumption, since this was not decided: detect and instruct.** A new preflight
calls `GetUseCaseForModelAccess`, and when the form is missing it prints the
console link plus the exact `aws bedrock put-use-case-for-model-access` command,
then continues. The step is non-fatal, matching how AWS login and probe failures
already behave. The installer does not submit an attestation about your company
on your behalf. Say so if you want it automated instead.

Without the form, the entitlement probe drops every Anthropic rung and the table
still routes, which is the desired failure mode.

## What changes in this repository

**`hablo.json`**

- `bedrouter.rungs`: the table above, authoritative for this machine.
- `bedrouter.ladders` and `defaults.ladder`: deleted.
- `bedrouter.routing.classifier.model`: `nova-micro`.
- `bedrouter.fallbacks`: keep, keyed by `bedrockId`. GLM and Qwen entries stay
  empty, since in-region IDs have no profile variants to fall back to.
- `pi.enabledModels`: `bedrouter/auto` plus each enabled alias. `auto-oss` goes.

**`install.mjs`**

- Step 4 renders `~/.bedrouter/bedrouter.json` from `hablo.json` rather than
  copying the package example and patching two keys. The manifest owns the
  table, which is the existing convention for everything else in this installer.
- Step 6 (probe) keeps swapping unentitled rungs for fallbacks and dropping the
  rest, with one addition: if a class ends with no enabled rung, fail loudly.
  Silently losing `explore` would route planning work to a trivial model.
- Step 8 derives fit notes from `serves` instead of `routing.classes`.
- `--ladder` is removed. Enablement lives in the manifest's `enabled` flag.
- New preflight for the Anthropic form, non-fatal.

**Migration.** An existing `~/.bedrouter/bedrouter.json` has the old `families`
shape and will not load against the new types. Detect `families`, back the file
up, and rewrite from the manifest. An existing `enabledModels` allowlist in
`~/.pi/agent/settings.json` still lists `bedrouter/auto-oss`, which stops
existing after this change; drop that entry when the allowlist already exists,
and keep the standing rule about never creating one.

## Open questions

- Is prompt caching the only degradable capability, or should a missing
  `structuredOutputs` also degrade, to a schema instruction in the prompt?
- Is a second upstream transport for `bedrock-mantle` worth building, to reach
  GPT-5.x and Codex? It is the only way to put them in the table.
- Should the installer submit the Anthropic form, rather than print it?
- Does the effective-price rule need a real cache hit rate, or does a flat
  configured multiplier hold?
- Is a `--vendors` filter worth keeping for "Claude only today", or does editing
  `enabled` in the manifest cover it?
- Nova geo profile pricing: premium or parity with in-region?

## Sources

- [Z.AI models on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-zai.html), [GLM 5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-5.html), [GLM 4.7 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-zai-glm-4-7.html)
- [Qwen3 Coder Next card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-coder-next.html), [Qwen3 235B A22B 2507 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-235b-a22b-2507.html)
- [MiniMax M2.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-minimax-minimax-m2-5.html), [Kimi K2.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-moonshot-ai-kimi-k2-5.html)
- [Nova Lite card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html)
- [Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) (every provider and model on Bedrock)
- [GPT-5.5 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-55.html) (`bedrock-mantle` only), [Claude Mythos 5.1 card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-mythos-5-1.html)
- [Automatic enablement of serverless foundation models](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-automatic-enablement-serverless-foundation-models)
- [PutUseCaseForModelAccess](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_PutUseCaseForModelAccess.html), [GetUseCaseForModelAccess](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_GetUseCaseForModelAccess.html)
- [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/), [prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
