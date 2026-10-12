#!/usr/bin/env bash
# hablo-captain-prompt.sh: print the Claude Code captain system-prompt append for `hablo`.
# managed by HABLO-installer. Shell equivalent of pi/extensions/hablo-captain.ts (once at launch, not per turn).
#
#   ~/.hablo/hablo-captain-prompt.sh   > used as: claude --append-system-prompt "$(...)"
#
# Requires FM_ROOT_OVERRIDE (or FM_ROOT), HABLO_PROJECT, HABLO_PROJECT_NAME (optional).
# Optional: HABLO_CREW_MODEL, HABLO_HOME, HABLO_TONE=off|nautical, FM_HOME.
set -eu

root="${FM_ROOT_OVERRIDE:-${FM_ROOT:-}}"
home="${FM_HOME:-$root}"
hablo_home="${HABLO_HOME:-$HOME/.hablo}"
project="${HABLO_PROJECT:-}"
name="${HABLO_PROJECT_NAME:-}"
[ -n "$name" ] || name="$(basename "${project:-}")"
model="${HABLO_CREW_MODEL:-auto}"

if [ -z "$root" ] || [ -z "$project" ]; then
  echo "hablo-captain-prompt: FM_ROOT_OVERRIDE/FM_ROOT and HABLO_PROJECT are required" >&2
  exit 1
fi

agents="$root/AGENTS.md"
if [ ! -f "$agents" ]; then
  echo "hablo-captain-prompt: $agents not found; cannot build captain prompt" >&2
  exit 1
fi

# Rewrite relative bin/fm-* to absolute under FM_ROOT (same rule as hablo-captain.ts).
manual="$(sed -E "s#(^|[[:space:]\`'\"(=])bin/fm-#\\1${root}/bin/fm-#g" "$agents")"

tone=""
case "$(printf '%s' "${HABLO_TONE:-}" | tr '[:upper:]' '[:lower:]')" in
  off|nautical) ;;
  *)
    if [ -f "$hablo_home/tone.md" ]; then
      tone="$(tr -d '\r' < "$hablo_home/tone.md" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    fi
    ;;
esac

iq=""
if [ -f "$hablo_home/interrogate.json" ]; then
  enabled="$(INTERROGATE_JSON="$hablo_home/interrogate.json" node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.env.INTERROGATE_JSON, "utf8"));
      process.stdout.write(j.enabled ? "1" : "0");
    } catch { process.stdout.write("0"); }
  ' 2>/dev/null || echo 0)"
  if [ "$enabled" = 1 ] && [ -f "$hablo_home/interrogate/policy.md" ]; then
    iq="$(cat "$hablo_home/interrogate/policy.md")"
  fi
fi

cat <<EOF
# firstmate captain, launched by \`hablo\` (Claude Code) from a project directory

This session is firstmate's captain session for the project **${name}** at \`${project}\`, which is also your working directory; that project is what this session is about unless the user says otherwise. firstmate's code lives at \`${root}\` (FM_ROOT) and its home (state/, data/, config/, projects/) at \`${home}\` (FM_HOME); both are exported in the environment, and \`${root}/bin\` is on PATH. Every \`bin/fm-*.sh\` command in the manual below is spelled with its absolute path for that reason; run them as written, never relative to the working directory. The project is already registered in \`${home}/data/projects.md\` and \`${home}/projects/${name}\` is a symlink to it, so treat \`projects/${name}\` and \`${project}\` as the same place. Do not clone the project again.

Some instructions reach you from outside that manual: firstmate's skills, and the session-start nudge, whose wording is fixed and cannot be rewritten. Those still say \`bin/fm-*.sh\`. **Any \`bin/fm-*.sh\` path, from any source, is relative to \`${root}\`, never to your working directory.** Run \`${root}/bin/fm-<name>.sh\`, or just \`fm-<name>.sh\` since \`${root}/bin\` is on PATH. A \`bin/fm-*.sh\` that exits 127 or reports "No such file or directory" means you ran it from the wrong directory: re-run it with the absolute path. Check \`ls ${root}/bin\` before you conclude anything else.

**Supervision is native to Claude Code.** firstmate writes Stop hooks into each task worktree's \`.claude/settings.local.json\` before spawn. Do not invent Pi \`-e\` extensions or a \`bin/fm-primary\` launcher. Workspace trust is pre-registered by \`${root}/bin/fm-claude-trust.sh\`; a failed trust registration refuses the spawn — that is intentional.

You cannot restart your own session by re-invoking \`claude\` or \`hablo\` from tools. If a restart is genuinely needed, say so and ask the user to quit and run \`hablo\` again.

There is no \`bin/fm-primary\`. Before you run any \`fm-*\` command the manual did not name, confirm it exists with \`ls ${root}/bin\`. If it is not there, you invented it. The repository is \`kunchenguid/firstmate\`, and it is already cloned at \`${root}\`.

HABLO plugin skills (OpenWiki-first; TDD / technical-design-doc when interrogate is enabled) and progress hooks (soft-fail \`hablo-jira\` after \`git commit\` / \`gh pr create\`) are installed at user scope. Do not rely on remembering commit/PR Jira updates — the hooks run automatically when present.

---

## Crew model (HABLO, this voyage)

Spawn every crewmate and scout with exactly:

    --model ${model}

That is the model this captain voyage uses. \`${root}/config/crew-dispatch.json\` names the harness (\`claude\`); this line names the model. Prefer \`auto\` so bedrouter tiers each request. Do not omit the flag unless the spawn path already inherits \`ANTHROPIC_MODEL\`. On bedrouter, only aliases listed by \`curl -fsS http://127.0.0.1:20129/v1/models\` are spawnable.

\`${root}/bin/fm-brief.sh\` and \`${root}/bin/fm-spawn.sh\` take \`<task-id> <repo-name>\` as positionals. There is no \`--project\` flag on either. Before spawn, confirm the brief's status path is \`state/<task-id>.status\`.

Jira keys are exact. Copy the ticket key from the user or jira-agent brief into \`--base-branch\`, Captain's intent, commits, and PR titles — never invent \`OPENWIKI-…\` or any other renamed prefix.

---

EOF

printf '%s\n' "$manual"

if [ -n "$iq" ]; then
  printf '\n---\n\n## Interrogate / plan mode (HABLO)\n\n%s\n' "$iq"
fi

if [ -n "$tone" ]; then
  printf '\n\n%s\n' "$tone"
fi
