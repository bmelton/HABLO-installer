// hablo-tone: add HABLO's plain-language rule to firstmate fleet sessions.
// Installed in ~/.pi/agent/extensions by HABLO-installer. Missing policy means inert.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const fleet = process.env.FM_TASK_ID || process.env.FM_ROOT || process.env.FM_ROOT_OVERRIDE || process.env.HABLO_PROJECT;
  const captain = (process.env.FM_ROOT || process.env.FM_ROOT_OVERRIDE) && process.env.HABLO_PROJECT;
  const override = (process.env.HABLO_TONE || "").toLowerCase();
  if (!fleet || captain || override === "off" || override === "nautical") return;

  const ruleFile = path.join(process.env.HABLO_HOME || path.join(os.homedir(), ".hablo"), "tone.md");
  let cached: { mtimeMs: number; text: string } | undefined;
  const rule = (): string | undefined => {
    try {
      const stat = fs.statSync(ruleFile);
      if (!cached || cached.mtimeMs !== stat.mtimeMs) {
        cached = { mtimeMs: stat.mtimeMs, text: fs.readFileSync(ruleFile, "utf8").trim() };
      }
      return cached.text || undefined;
    } catch {
      return undefined;
    }
  };

  pi.on("before_agent_start", async (event) => {
    const text = rule();
    if (text) return { systemPrompt: `${event.systemPrompt}\n\n${text}` };
  });
}
