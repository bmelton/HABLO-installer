# Claude Code reaches Bedrock through bedrouter

> Status: design settled, two upstream gaps open. Part of
> [CLAUDE-CODE.md](CLAUDE-CODE.md). The gaps are in the `bedrouter` repository,
> not this one, and they block a usable session.

- [ ] `bedrouter`: add `POST /v1/messages/count_tokens`
- [ ] `bedrouter`: pass `cache_control` blocks through to Bedrock, or strip them and say so
- [ ] `bedrouter`: confirm streaming `tool_use` blocks survive the `/v1/messages` path
- [ ] `bedrouter`: return the routed rung in a response header, for the status line
- [ ] `hablo.json`: add `agents.claude.settings.env` with the three variables
- [ ] `install.mjs` step 3: merge the `env` block into `~/.claude/settings.json`, never overwrite
- [ ] `install.mjs` step 4: write `BEDROUTER_API_KEY` into `~/.bedrouter/.env`
- [ ] Plugin: a `SessionStart` hook that starts bedrouter when the port is closed
- [ ] Verify a full tool-using turn end to end against a live Bedrock account
- [ ] Measure the cost of no prompt caching on a real session, and record the number
- [ ] `README.md`: how to point Claude Code somewhere else, and how to undo it

## What this is

Claude Code speaks the Anthropic Messages API and lets an operator redirect it
with `ANTHROPIC_BASE_URL`. bedrouter already serves that API on
`127.0.0.1:20129`. Pointing one at the other gives Claude Code the same per
request model selection, the same escalation ladder, and the same cost record
that Pi gets, without a line of new routing code.

## Why not native Bedrock mode

Claude Code supports `CLAUDE_CODE_USE_BEDROCK=1`, which calls Bedrock directly
with the machine's AWS credentials. It is simpler and it is supported by
Anthropic. It also pins one model for the whole session.

That removes the reason this repository exists. bedrouter classifies each
request as trivial, execute or explore, picks the cheapest rung that can do the
job, holds that choice for the conversation, and escalates on failure. It writes
a decision log that is the cost record for a whole firstmate crew. Native mode
gives up all of it. Keep native mode as a documented manual fallback, not as an
installed path.

## What the installer writes

Three environment variables, in the `env` block of `~/.claude/settings.json`:

| Variable | Value | Why |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:20129` | The port from `bedrouter.port` in the manifest |
| `ANTHROPIC_AUTH_TOKEN` | the value of `BEDROUTER_API_KEY` | bedrouter reads `x-api-key` and `authorization`; the real credential is the AWS profile behind it |
| `ANTHROPIC_MODEL` | the ladder's `autoSelect` alias | `auto` for the `claude` ladder |

**Decision: the variables go in `settings.json`, not in the `hablo` wrapper.**
A firstmate crewmate is launched by `bin/fm-spawn.sh`, which runs `claude`
directly. The wrapper never sees that process. User-scope settings are the only
place that covers a captain and a crewmate with one write.

The write follows step 3's existing rule: merge only, never replace a key the
operator already set, and follow the symlink when `~/.claude` is dotfiles
managed.

**Decision: `BEDROUTER_API_KEY` gets a generated value, stored in
`~/.bedrouter/.env`.** bedrouter accepts any bearer today. A shared secret
between the two local processes costs nothing and stops another local program
from spending the account's Bedrock budget through an open port. The value is a
generated random token, never a placeholder, and it never appears in this
repository or in the manifest.

## Starting the daemon

Under Pi, `pi-bedrouter` starts bedrouter and stops it again according to
`stopOnExit`. Nothing performs that job for Claude Code.

**Decision: a `SessionStart` hook in the HABLO plugin starts it.** The hook
checks whether `127.0.0.1:20129` accepts a connection, and if not, launches
`node <bedrouter>/dist/cli.js` detached with `BEDROUTER_CONFIG` set. Every
Claude Code session fires `SessionStart`, so a captain started by `hablo` and a
crewmate started by `fm-spawn.sh` both get a running router with one mechanism.

**Decision: nothing stops it.** bedrouter holds no lock and costs nothing at
idle. An automatic stop would race two sessions against each other, and the
losing session would fail mid-turn. Stopping is a manual act, and the uninstall
covers it.

The alternative considered and rejected: a launchd agent on macOS and a systemd
user unit on Linux. It is the more correct way to run a daemon, and it is two
platform-specific files to install, reverse and debug for a process that starts
in under a second.

## The two gaps

**No `count_tokens` endpoint.** Claude Code calls
`POST /v1/messages/count_tokens` to track the context window. bedrouter returns
404 for that path today, verified against a running instance. The consequence is
not a crash; it is a session that cannot tell the operator how full the context
is, and cannot decide when to compact. Fix it in bedrouter by forwarding the
call to the rung that would serve the request.

**No prompt caching.** bedrouter's code contains no `cache_control` or
`cachePoint` handling. Claude Code marks large stable prefixes for caching on
nearly every turn. Passing the blocks through unmodified is the goal; silently
dropping them is the current behavior and it means full input price on every
turn of every session. Measure that on a real session before deciding the work
is optional, because on a long captain session it is the dominant cost.

Both gaps are listed at the top of this document because the routing decision
stands on them. Neither is a reason to choose native Bedrock mode: native mode
has no routing at all, which costs more than a missing cache.

## The ladder constraint

`/v1/messages` carries Anthropic rungs. The `oss` ladder routes `auto-oss` to
`openai.gpt-oss-*`, which bedrouter serves over `/v1/chat/completions` in a
different request shape. Claude Code cannot use it.

[CLAUDE-CODE-AGENT-SELECTION.md](CLAUDE-CODE-AGENT-SELECTION.md) holds the rule:
a default `oss` ladder becomes `claude` for the Claude Code side with a log
line, and an explicit `--ladder oss` refuses.

## Verification

A live check against the running instance on this machine confirmed the shape of
the path. `/v1/models` lists every rung with its Bedrock id and per-million
prices. `/v1/messages` returns a correct Anthropic error envelope
(`{"type":"error","error":{...}}`) when credentials are expired, which means the
endpoint exists and speaks the right dialect. What is still unverified is a
successful tool-using turn with streaming, which needs a valid SSO session.

## Undo

Remove the three keys from `env` in `~/.claude/settings.json` and Claude Code
returns to its own authentication with no other change. That is the whole
reversal for this feature, and it is what the uninstall receipt records.

## Open questions

- Claude Code sends a `user-agent` and beta headers bedrouter has never seen.
  Confirm it neither forwards them to Bedrock unchanged nor rejects them.
- The routed rung is invisible to the operator. A response header naming it
  would let the plugin put the rung in the status line, which is the closest
  equivalent of Pi's `/bedrouter status`.
- What happens when bedrouter drops the last rung of a class during the probe
  and Claude Code asks for `auto` anyway? Today the answer is a 400 at request
  time. The probe should refuse to finish in that state.
