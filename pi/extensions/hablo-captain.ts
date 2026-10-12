// hablo-captain: make this Pi session a firstmate captain for the project it was started in.
// Installed to ~/.hablo/hablo-captain.ts by HABLO-installer and loaded by the `hablo` wrapper with `-e`.
//
// firstmate expects to be launched inside its own checkout so the harness picks up AGENTS.md from the working
// directory. When `hablo` starts Pi in a project directory instead, this extension appends firstmate's AGENTS.md to the
// system prompt every turn, with the relative `bin/fm-*.sh` invocations rewritten to absolute paths under FM_ROOT, and
// tells the captain which project this session is about. Nothing on disk is modified.
//
// Fleet footer: reads FM_HOME/state/home-summary.json plus each child's .status / .busy-state so the Pi status
// line shows who is working, what they last reported, and a STALE hint when the status clock stops moving.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatFleetStatus } from "./hablo-fleet-status.mjs";

type Theme = { fg: (color: string, text: string) => string };
type Ui = { setStatus: (key: string, text: string) => void; theme: Theme; notify?: (msg: string, level?: string) => void };

type HomeChild = {
  id?: string;
  kind?: string;
  state?: string;
  name?: string;
  doing?: string;
  source?: string;
};

type HomeSummary = {
  state?: string;
  generated_epoch?: number;
  counts?: {
    active_children?: number;
    decisions_open?: number;
    holds?: number;
    queued?: number;
  };
  active_children?: HomeChild[];
};

const STALE_SECS = Math.max(60, Number(process.env.HABLO_FLEET_STALE_SECS || 600) || 600);
const STATUS_MS = Math.max(5000, Number(process.env.HABLO_FLEET_STATUS_MS || 15000) || 15000);
const SUMMARY_REFRESH_SECS = Math.max(30, Number(process.env.HABLO_FLEET_SUMMARY_REFRESH_SECS || 120) || 120);

export default function (pi: ExtensionAPI) {
  const root = process.env.FM_ROOT_OVERRIDE || process.env.FM_ROOT;
  const home = process.env.FM_HOME || root;
  const project = process.env.HABLO_PROJECT;
  const name = process.env.HABLO_PROJECT_NAME || (project ? path.basename(project) : "");
  if (!root || !project) return; // launched some other way: stay inert
  const piExtensions = (process.env.HABLO_PI_EXTENSIONS || "").split(/\s+/).filter(Boolean);
  const stateDir = path.join(home!, "state");
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let refreshingSummary = false;
  let lastUi: Ui | undefined;

  const agentsFile = path.join(root, "AGENTS.md");
  const toneFile = path.join(process.env.HABLO_HOME || path.join(os.homedir(), ".hablo"), "tone.md");
  let cached: { mtimeMs: number; text: string } | undefined;
  const agentsMd = (): string | undefined => {
    let st: fs.Stats;
    try { st = fs.statSync(agentsFile); } catch { return undefined; }
    if (!cached || cached.mtimeMs !== st.mtimeMs) {
      const raw = fs.readFileSync(agentsFile, "utf8");
      // `bin/fm-foo.sh` -> `<root>/bin/fm-foo.sh`, but leave already-absolute or `$FM_ROOT/bin/...` forms alone.
      const text = raw.replace(/(^|[\s`'"(=])bin\/fm-/g, `$1${root}/bin/fm-`);
      cached = { mtimeMs: st.mtimeMs, text };
    }
    return cached.text;
  };

  const toneRule = (): string | undefined => {
    const override = (process.env.HABLO_TONE || "").toLowerCase();
    if (override === "off" || override === "nautical") return undefined;
    try { return fs.readFileSync(toneFile, "utf8").trim() || undefined; } catch { return undefined; }
  };

  const crewModel = (ctx: { model?: { provider?: string; id?: string } }): string | undefined => {
    const provider = ctx.model?.provider;
    const id = ctx.model?.id;
    if (provider && id) return id.startsWith(`${provider}/`) ? id : `${provider}/${id}`;
    return process.env.HABLO_CREW_MODEL || undefined;
  };

  const readSummary = (): HomeSummary | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(stateDir, "home-summary.json"), "utf8")) as HomeSummary;
    } catch {
      return null;
    }
  };

  const childDetails = (ids: string[]): Map<string, { lastStatus?: string; busy?: string; statusMtime?: number }> => {
    const out = new Map<string, { lastStatus?: string; busy?: string; statusMtime?: number }>();
    for (const id of ids) {
      const row: { lastStatus?: string; busy?: string; statusMtime?: number } = {};
      try {
        const statusPath = path.join(stateDir, `${id}.status`);
        const st = fs.statSync(statusPath);
        row.statusMtime = Math.floor(st.mtimeMs / 1000);
        const lines = fs.readFileSync(statusPath, "utf8").split("\n").filter((l) => l.trim());
        row.lastStatus = lines[lines.length - 1];
      } catch { /* no status yet */ }
      try {
        row.busy = fs.readFileSync(path.join(stateDir, `${id}.busy-state`), "utf8").trim();
      } catch { /* idle / missing */ }
      out.set(id, row);
    }
    return out;
  };

  const maybeRefreshSummary = (summary: HomeSummary | null, nowSecs: number) => {
    const age = summary?.generated_epoch ? nowSecs - summary.generated_epoch : SUMMARY_REFRESH_SECS + 1;
    if (age < SUMMARY_REFRESH_SECS || refreshingSummary) return;
    const script = path.join(root!, "bin", "fm-home-summary-refresh.sh");
    if (!fs.existsSync(script)) return;
    refreshingSummary = true;
    execFile(script, ["--best-effort"], {
      env: { ...process.env, FM_HOME: home, FM_ROOT_OVERRIDE: root, FM_ROOT: root },
      timeout: 55_000,
    }, () => { refreshingSummary = false; });
  };

  const paintFleet = (ui: Ui) => {
    lastUi = ui;
    const nowSecs = Math.floor(Date.now() / 1000);
    const summary = readSummary();
    maybeRefreshSummary(summary, nowSecs);
    const ids = (summary?.active_children || []).map((c) => c.id).filter((id): id is string => !!id);
    const { text, level } = formatFleetStatus(name, summary, nowSecs, childDetails(ids), STALE_SECS);
    const prefix = toneRule() ? "" : "⚓ ";
    const color = level === "stale" ? "error" : level === "warn" ? "warning" : "accent";
    const painted = typeof ui.theme?.fg === "function" ? ui.theme.fg(color, `${prefix}${text}`) : `${prefix}${text}`;
    ui.setStatus("hablo", painted);
  };

  const preamble = (model?: string) => [
    "# firstmate captain, launched by `hablo` from a project directory",
    "",
    `This session is firstmate's captain session for the project **${name}** at \`${project}\`, which is also your working directory; that project is what this session is about unless the user says otherwise. firstmate's code lives at \`${root}\` (FM_ROOT) and its home (state/, data/, config/, projects/) at \`${home}\` (FM_HOME); both are exported in the environment, and \`${root}/bin\` is on PATH. Every \`bin/fm-*.sh\` command in the manual below is spelled with its absolute path for that reason; run them as written, never relative to the working directory. The project is already registered in \`${home}/data/projects.md\` and \`${home}/projects/${name}\` is a symlink to it, so treat \`projects/${name}\` and \`${project}\` as the same place. Do not clone the project again.`,
    "",
    // The rewrite above reaches AGENTS.md and nothing else. Skills under .agents/skills/ and the session-start nudge
    // also name `bin/fm-*.sh`, and the nudge's wording is a fixed literal that the ahoy skill matches whole, so it
    // cannot be rewritten at all. A relative path from either source runs in the project directory and exits 127,
    // which reads convincingly as a missing file. State the general rule instead of patching each source.
    `Some instructions reach you from outside that manual: firstmate's skills, and the session-start nudge, whose wording is fixed and cannot be rewritten. Those still say \`bin/fm-*.sh\`. **Any \`bin/fm-*.sh\` path, from any source, is relative to \`${root}\`, never to your working directory.** Run \`${root}/bin/fm-<name>.sh\`, or just \`fm-<name>.sh\` since \`${root}/bin\` is on PATH. A \`bin/fm-*.sh\` that exits 127 or reports "No such file or directory" means you ran it from the wrong directory: re-run it with the absolute path. Check \`ls ${root}/bin\` before you conclude anything else: either the script is there and you called it wrong, or the name is one you invented. Neither case is a reason to re-clone or reinstall firstmate.`,
    "",
    // The supervision protocol says to confirm both extensions loaded but never says how, and `hablo` starts Pi
    // outside the checkout where auto-discovery would show it. A captain left to invent a check reaches for
    // `ps aux | grep fm-primary-pi-watch.ts`, which cannot match an in-process extension, reads the guaranteed
    // false negative as a broken install, and invents a launcher (`bin/fm-primary`) to restart Pi with.
    `**Supervision is already wired. Do not rebuild it.** \`hablo\` started this Pi process with ${piExtensions.length ? piExtensions.map((f) => `\`${f}\``).join(", ") : "firstmate's tracked Pi extensions"} on the command line, so they loaded before your first turn. Pi runs an extension inside this process: \`ps aux\` and \`pgrep\` never match an extension file, and a grep that finds nothing proves nothing. To check loading, look for the \`fm_watch_arm_pi\` tool in your own tool list, or run \`${root}/bin/fm-session-start.sh\` and read its \`PI_WATCH_EXTENSION\` line. Repair a watcher with the \`fm_watch_arm_pi\` tool, never through the bash tool.`,
    "",
    `You cannot restart your own session, and you must not try. Never run \`pi -e ...\` yourself: that starts a second Pi without this preamble and without the other extensions. If a restart is genuinely needed, say so and ask the user to quit and run \`hablo\` again.`,
    "",
    // Pi prints "Package updates are available. Run pi update --extensions" at startup, meaning run it in a shell.
    // A user who types that line at the Pi prompt sends it here as a message instead, so nothing updates and the
    // banner returns every session. Say what it is, and keep the swap out of the live process.
    `If the user types \`pi update --extensions\` (or any other \`pi\` subcommand) at the prompt, they are repeating a startup banner that meant "run this in a shell", and it reached you as a message instead. Do not treat it as a request about firstmate or about your own extensions. Tell them it updates Pi's globally installed npm packages and must run outside a live session, because it replaces files this process has already loaded: they should quit, run it in their shell, and start \`hablo\` again.`,
    "",
    `There is no \`bin/fm-primary\`. Before you run any \`fm-*\` command the manual did not name, confirm it exists with \`ls ${root}/bin\`. If it is not there, you invented it: find the real command instead. An invented command that exits 127 is never evidence that firstmate is damaged, and re-cloning or reinstalling firstmate is never your repair for it. The repository is \`kunchenguid/firstmate\`, and it is already cloned at \`${root}\`.`,
    "",
    "---",
    "",
    ...(model ? [
      "## Crew model (HABLO, this voyage)",
      "",
      "Spawn every crewmate and scout with exactly:",
      "",
      `    --model ${model}`,
      "",
      // Absolute, like everything else: this block is hardcoded here and never passes through the AGENTS.md rewrite.
      `That is the provider and model this captain is running, in Pi's \`provider/id\` form. \`${root}/config/crew-dispatch.json\` names the harness; this line names the model, and it is authoritative for this voyage. Do not substitute another model, and do not omit the flag: \`${root}/bin/fm-spawn.sh\` passes \`--model\` through only when you give it, and a crewmate launched without one falls back to Pi's default provider, which may not be this one.`,
      "",
      "On bedrouter, only aliases listed by \`curl -fsS http://127.0.0.1:20129/v1/models\` are spawnable. Disabled stack rungs (for example \`fable\`) are absent from that list and 404 immediately — never pass them to \`fm-spawn.sh\`. Prefer this voyage model; raise \`--effort high\` instead of pinning sonnet/opus.",
      "",
      `\`${root}/bin/fm-brief.sh\` and \`${root}/bin/fm-spawn.sh\` take \`<task-id> <repo-name>\` as positionals. There is no \`--project\` flag on either; a leading \`--project\` becomes the task id and scaffolds \`state/--project.status\`, which the watcher never reads. Example: \`bin/fm-brief.sh originops-4433-ui originops --mode direct-PR --base-branch ORIGINOPS-4433\`. Before spawn, confirm the brief's status path is \`state/<task-id>.status\`.`,
      "",
      "Jira keys are exact. Copy the ticket key from the user or jira-agent brief into `--base-branch`, Captain's intent, commits, and PR titles — never invent `OPENWIKI-…` or any other renamed prefix. OpenWiki is a wiki tool, not a Jira project. Before spawn, the brief's intent key must match `Base branch:`.",
      "",
      "---",
      "",
    ] : []),
  ].join("\n");

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx?.ui) paintFleet(ctx.ui as Ui);
    const manual = agentsMd();
    if (!manual) return;
    const tone = toneRule();
    return { systemPrompt: `${event.systemPrompt}\n\n${preamble(crewModel(ctx))}${manual}${tone ? `\n\n${tone}` : ""}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!agentsMd()) {
      ctx.ui.notify(`hablo: ${agentsFile} not found; this session is NOT a firstmate captain`, "error");
      return;
    }
    paintFleet(ctx.ui as Ui);
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(() => {
      if (lastUi) paintFleet(lastUi);
    }, STATUS_MS);
    // Don't keep the event loop alive solely for the footer if everything else is idle.
    statusTimer.unref?.();
  });
}
