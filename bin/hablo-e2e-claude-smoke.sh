#!/usr/bin/env bash
# Live Claude + bedrouter smoke (Phase 6). Not run in CI — needs SSO, bedrouter 0.10+, Claude Code.
# managed by HABLO-installer.
#
#   bin/hablo-e2e-claude-smoke.sh
#   BEDROUTER_URL=http://127.0.0.1:20129 bin/hablo-e2e-claude-smoke.sh
#
# Checks:
#   1) bedrouter /health and /v1/models lists auto
#   2) POST /v1/messages with model=auto (non-streaming) returns a message
#   3) optional streaming tool_use round-trip when BEDROUTER_SMOKE_TOOLS=1
#   4) claude on PATH; ~/.claude/settings.json points ANTHROPIC_BASE_URL at bedrouter
#   5) ~/.hablo/agent and crew-harness agree when firstmate is present
set -eu

BASE="${BEDROUTER_URL:-http://127.0.0.1:20129}"
BASE="${BASE%/}"
HABLO_HOME="${HABLO_HOME:-$HOME/.hablo}"
fail=0
note() { echo "smoke: $*" >&2; }
bad() { note "FAIL  $*"; fail=$((fail + 1)); }
ok() { note "ok    $*"; }

note "bedrouter $BASE"

health="$(curl -fsS --max-time 3 "$BASE/health" 2>/dev/null || true)"
if [ -z "$health" ]; then
  bad "bedrouter /health not reachable (start: bedrouter serve)"
else
  ver="$(HEALTH_JSON="$health" node -e 'try{const j=JSON.parse(process.env.HEALTH_JSON);process.stdout.write(j.version||"")}catch{}')"
  routing="$(HEALTH_JSON="$health" node -e 'try{const j=JSON.parse(process.env.HEALTH_JSON);process.stdout.write(String(!!j.routing))}catch{process.stdout.write("?")}')"
  ok "health v${ver:-?} routing=$routing"
  case "$ver" in
    0.10.*|0.1[1-9].*|[1-9].*) ;;
    *) note "WARN  bedrouter $ver on PATH/port; Messages auto needs 0.10+ (HABLO pins bedrouter@0.10.0)" ;;
  esac
fi

models="$(curl -fsS --max-time 5 "$BASE/v1/models" 2>/dev/null || true)"
if [ -z "$models" ]; then
  bad "/v1/models empty"
else
  has_auto="$(MODEL_JSON="$models" node -e '
    const j=JSON.parse(process.env.MODEL_JSON);
    const ids=new Set((j.data||[]).map(m=>String(m.id||"").replace(/^bedrouter\//,"")));
    process.stdout.write(ids.has("auto")?"1":"0");
  ')"
  if [ "$has_auto" = 1 ]; then ok "/v1/models includes auto"; else bad "/v1/models missing auto (need bedrouter 0.10+ Messages auto)"; fi
fi

# Bearer: settings.env token or bedrouter .env
token=""
if [ -f "$HOME/.claude/settings.json" ]; then
  token="$(node -e 'try{const j=require(process.env.HOME+"/.claude/settings.json");process.stdout.write(j.env&&j.env.ANTHROPIC_AUTH_TOKEN||"")}catch{}')"
fi
if [ -z "$token" ] && [ -f "$HOME/.bedrouter/.env" ]; then
  token="$(grep -E '^\s*(export\s+)?BEDROUTER_API_KEY=' "$HOME/.bedrouter/.env" | head -1 | sed -E 's/^[^=]+=//;s/^["'\'']//;s/["'\'']$//')"
fi
auth=()
if [ -n "$token" ]; then auth=(-H "Authorization: Bearer $token"); fi

if [ -n "$models" ] && [ "${has_auto:-0}" = 1 ]; then
  body='{"model":"auto","max_tokens":64,"messages":[{"role":"user","content":"Reply with exactly: pong"}]}'
  resp_file="$(mktemp)"
  code="$(curl -sS --max-time 60 -o "$resp_file" -w '%{http_code}' -X POST "$BASE/v1/messages" \
    -H "content-type: application/json" \
    -H "anthropic-version: 2023-06-01" \
    "${auth[@]+"${auth[@]}"}" \
    -d "$body" 2>/dev/null || echo 000)"
  resp="$(cat "$resp_file" 2>/dev/null || true)"; rm -f "$resp_file"
  if [ "$code" = 200 ] && echo "$resp" | grep -qi 'pong\|assistant\|content'; then
    ok "POST /v1/messages model=auto HTTP $code"
  else
    bad "POST /v1/messages model=auto HTTP ${code:-?} (SSO? entitlement? bedrouter 0.10+?). body=${resp:0:240}"
  fi

  if [ "${BEDROUTER_SMOKE_TOOLS:-0}" = 1 ]; then
    tool_body='{"model":"auto","max_tokens":256,"stream":true,"tools":[{"name":"echo_tool","description":"echo","input_schema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}}],"messages":[{"role":"user","content":"Call echo_tool with text=hi then stop."}]}'
    stream="$(curl -fsS --max-time 90 -N -X POST "$BASE/v1/messages" \
      -H "content-type: application/json" \
      -H "anthropic-version: 2023-06-01" \
      "${auth[@]}" \
      -d "$tool_body" 2>/dev/null || true)"
    if echo "$stream" | grep -q 'tool_use\|input_json'; then
      ok "streaming tool_use blocks present on /v1/messages"
    else
      bad "streaming tool_use smoke did not observe tool_use (set BEDROUTER_SMOKE_TOOLS=1 after SSO)"
    fi
  else
    note "skip streaming tool_use (set BEDROUTER_SMOKE_TOOLS=1 to enable)"
  fi
fi

if command -v claude >/dev/null 2>&1; then
  ok "claude on PATH: $(command -v claude)"
else
  bad "claude not on PATH (install Claude Code for a full voyage smoke)"
fi

if [ -f "$HOME/.claude/settings.json" ]; then
  base_url="$(node -e 'try{const j=require(process.env.HOME+"/.claude/settings.json");process.stdout.write(j.env&&j.env.ANTHROPIC_BASE_URL||"")}catch{}')"
  model="$(node -e 'try{const j=require(process.env.HOME+"/.claude/settings.json");process.stdout.write(j.env&&j.env.ANTHROPIC_MODEL||"")}catch{}')"
  if echo "$base_url" | grep -q 20129; then ok "ANTHROPIC_BASE_URL=$base_url"; else bad "ANTHROPIC_BASE_URL not pointing at bedrouter ($base_url)"; fi
  if [ "$model" = auto ]; then ok "ANTHROPIC_MODEL=auto"; else note "ANTHROPIC_MODEL=$model (expected auto for HABLO)"; fi
  if node -e 'const j=require(process.env.HOME+"/.claude/settings.json");process.exit(j.enabledPlugins&&j.enabledPlugins["hablo@hablo"]?0:1)' 2>/dev/null; then
    ok "plugin hablo@hablo enabled"
  else
    note "plugin hablo@hablo not enabled (re-run install --agent claude|both without --skip-agents)"
  fi
else
  bad "~/.claude/settings.json missing"
fi

agent="pi"
[ -f "$HABLO_HOME/agent" ] && agent="$(tr -d '\n' < "$HABLO_HOME/agent")"
ok "HABLO agent marker=$agent"
if [ -n "${FM_ROOT:-}" ] || [ -d "$HOME/firstmate/config" ]; then
  fm="${FM_ROOT:-$HOME/firstmate}"
  if [ -f "$fm/config/crew-harness" ]; then
    harness="$(tr -d '\n' < "$fm/config/crew-harness")"
    if [ "$agent" = "$harness" ]; then ok "crew-harness=$harness matches marker"; else bad "crew-harness=$harness != marker=$agent (hablo config --set-agent?)"; fi
  fi
fi

note "manual voyage: cd <git-project> && hablo   # with agent=claude"
note "fixture E2E:   node --test test/e2e-claude.test.mjs"

if [ "$fail" != 0 ]; then
  note "FAILED ($fail check(s))"
  exit 1
fi
note "PASSED (live smoke gates green)"
exit 0
