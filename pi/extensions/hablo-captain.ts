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
    "---",
    "",
    ...(model ? [
      "## Crew model (HABLO, this voyage)",
      "",
      "Spawn every crewmate and scout with exactly:",
      "",
      `    --model ${model}`,
      "",
      "That is the provider and model this captain is running, in Pi's `provider/id` form. `config/crew-dispatch.json` names the harness; this line names the model, and it is authoritative for this voyage. Do not substitute another model, and do not omit the flag: `bin/fm-spawn.sh` passes `--model` through only when you give it, and a crewmate launched without one falls back to Pi's default provider, which may not be this one.",
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
