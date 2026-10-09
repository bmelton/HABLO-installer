// hablo-captain: make this Pi session a firstmate captain for the project it was started in.
// Installed to ~/.hablo/hablo-captain.ts by HABLO-installer and loaded by the `hablo` wrapper with `-e`.
//
// firstmate expects to be launched inside its own checkout so the harness picks up AGENTS.md from the working
// directory. When `hablo` starts Pi in a project directory instead, this extension appends firstmate's AGENTS.md to the
// system prompt every turn, with the relative `bin/fm-*.sh` invocations rewritten to absolute paths under FM_ROOT, and
// tells the captain which project this session is about. Nothing on disk is modified.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const root = process.env.FM_ROOT_OVERRIDE || process.env.FM_ROOT;
  const home = process.env.FM_HOME || root;
  const project = process.env.HABLO_PROJECT;
  const name = process.env.HABLO_PROJECT_NAME || (project ? path.basename(project) : "");
  if (!root || !project) return; // launched some other way: stay inert
  const piExtensions = (process.env.HABLO_PI_EXTENSIONS || "").split(/\s+/).filter(Boolean);

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
    `If the user types \`pi update --extensions\` (or any other \`pi\` subcommand) at the prompt, they are repeating a startup banner that meant "run this in a shell", and it reached you as a message instead. Do not treat it as a request about firstmate or about your own extensions. Tell them it updates Pi's npm packages under \`~/.pi/agent/npm\` and must run outside a live session, because it replaces files this process has already loaded: they should quit, run it in their shell, and start \`hablo\` again.`,
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
      "---",
      "",
    ] : []),
  ].join("\n");

  pi.on("before_agent_start", async (event, ctx) => {
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
    ctx.ui.setStatus("hablo", ctx.ui.theme.fg("accent", `${toneRule() ? "" : "⚓ "}firstmate · ${name}`));
  });
}
