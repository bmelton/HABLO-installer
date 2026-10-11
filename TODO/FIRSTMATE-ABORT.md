# Pi `Operation aborted` on firstmate crewmates

> Status: root cause pinned from the 2026-10-09 ORIGINOPS-4295 voyage.
> Companion fixes: `bin/hablo-preflight`, `bin/hablo-fleet-reset`,
> `pi/extensions/hablo-crewmate.ts`, captain model/refusal policy.

## What the symptom looks like

Pi session ends a turn with:

```text
stopReason=aborted
errorMessage=Operation aborted
```

Bedrouter logs the paired line:

```text
"error": "Request aborted"
```

with `latencyMs` often in the 1–16s range and **no** tokens on that request.
Bedrouter's `res.on("close", () => ac.abort())` path fires when the **HTTP
client** closes the socket. Bedrouter is not deciding to kill the turn.

## Who cancels

The cancelling client is **Pi's active-run `AbortController`**
(`@earendil-works/pi-agent-core` `Agent.abort()` → provider stream sees
`signal.aborted` → `stopReason: "aborted"` → errorMessage normalized to
`Operation aborted`).

That controller is aborted when:

1. Interactive Escape / interrupt while streaming (`session.abort()`),
2. An extension calls `ctx.abort()`,
3. Tree/queue UI paths that call `session.abort()` while streaming.

It is **not** the 15s model-catalog refresh timeout in interactive-mode
(that AbortController is local to `refreshModelCatalogs` and does not abort
the agent run).

## Evidence from ORIGINOPS-4295

| Task | Session | Pattern |
| --- | --- | --- |
| Ship ORIGINOPS-4295 | `01a1216d-…` | ~19 min of sonnet/explore tool loops (~74k tokens), then abort; bedrouter latency ~16058 ms |
| Scout FABLE | `01a1219e-…` | Accepted brief, one bash tool, abort; latency ~1094 ms |
| TEST-SIMPLE | (same day) | Completed PR #2940 — path can succeed |

Branch outcomes seq 6/9 already named this: *"Pi harness is consistently
failing… Operation aborted."*

## What to do about it

1. **Log every abort on crewmates** (`hablo-crewmate.ts` →
   `~/.hablo/abort-log.jsonl`) so the next incident has a typed record
   (task id, model, cwd, timestamp) instead of only a pane message.
2. **Treat abort as a typed captain failure** (policy): do not invent
   repairs; `fm-control.sh <id> relaunch` or teardown + respawn with the
   voyage `--model`.
3. **Avoid typing into a streaming pane** when possible (prefer inbox
   steers); Escape / interrupt mid-stream is the most common intentional
   abort path in Pi's TUI.
4. Upstream follow-up (out of HABLO): ask Pi / firstmate whether unattended
   tmux workers should ignore Escape, or whether firstmate doorbells can
   land mid-stream and interrupt.

## Ruled out for this voyage

- Bedrouter trivial misroute (crewmate turns were `execute` / `explore`)
- Turn-end guard / wedge-alarm (triage: dead agent, not a wedge)
- Firstmate watcher logic as the abort trigger (watcher observed turn-ended
  after the abort; last watcher death was a later amplifier)
