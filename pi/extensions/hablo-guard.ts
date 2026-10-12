// hablo-guard: Pi shim over the shared Go engine. No rule logic here.
// Installed to ~/.pi/agent/extensions/ by HABLO-installer step 12.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Verdict = {
  v: number;
  verdict: "allow" | "deny" | "ask";
  rule?: string;
  reason?: string;
  remedy?: string;
  terminate?: boolean;
};

function binPath(): string {
  const env = process.env.HABLO_GUARD_BIN;
  if (env && fs.existsSync(env)) return env;
  const home = process.env.HABLO_HOME || path.join(os.homedir(), ".hablo");
  const local = path.join(os.homedir(), ".local", "bin", "hablo-guard");
  if (fs.existsSync(local)) return local;
  const stamped = path.join(home, "hablo-guard");
  if (fs.existsSync(stamped)) return stamped;
  return "hablo-guard";
}

function sessionKind(): { kind: string; attended: boolean } {
  if (process.env.HABLO_GUARD === "off") return { kind: "solo", attended: false };
  const task = process.env.FM_TASK_ID || "";
  if (task) return { kind: "crewmate", attended: false };
  if (process.env.HABLO_PROJECT) return { kind: "captain", attended: true };
  return { kind: "solo", attended: true };
}

function decide(tool: string, input: Record<string, unknown>, attendedUI: boolean): Verdict {
  const { kind, attended: kindAttended } = sessionKind();
  const attended = kindAttended && attendedUI && process.env.HABLO_GUARD !== "off";
  const req = {
    v: 1,
    event: "tool_call",
    agent: "pi",
    tool,
    input: input || {},
    session: {
      id: process.env.HABLO_SESSION_ID || "",
      kind,
      attended,
      project: process.env.HABLO_PROJECT || "",
      cwd: process.cwd(),
      taskId: process.env.FM_TASK_ID || "",
    },
  };
  try {
    const out = execFileSync(binPath(), ["decide"], {
      input: JSON.stringify(req),
      encoding: "utf8",
      timeout: Number(process.env.HABLO_GUARD_TIMEOUT_MS || 3000),
      windowsHide: true,
      env: process.env,
    });
    return JSON.parse(out.trim().split("\n").pop() || "{}") as Verdict;
  } catch (e) {
    const err = e as { status?: number; message?: string; stderr?: string };
    const reason = `guard: engine failure (exit ${err.status ?? "?"}): ${err.stderr || err.message || "unknown"}`;
    throw new Error(reason);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.HABLO_GUARD === "off") {
      ctx.ui?.setStatus?.("hablo-guard", "GUARD OFF");
      ctx.ui?.notify?.("HABLO_GUARD=off: tool calls are unguarded this session", "error");
      return;
    }
    try {
      execFileSync(binPath(), ["version"], { encoding: "utf8", timeout: 2000, windowsHide: true });
    } catch {
      ctx.ui?.setStatus?.("hablo-guard", "GUARD BROKEN");
      ctx.ui?.notify?.("hablo-guard missing; every tool call will deny. Re-run HABLO installer (needs Go).", "error");
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (process.env.HABLO_GUARD === "off") return;
    const tool = String(event.toolName || "");
    const input = (event.input || {}) as Record<string, unknown>;
    let verdict: Verdict;
    try {
      verdict = decide(tool, input, Boolean(ctx?.ui));
    } catch (e) {
      // Fail closed: rethrow so Pi blocks the tool.
      throw e;
    }
    if (verdict.verdict === "allow") return;
    const reason = [verdict.reason, verdict.remedy].filter(Boolean).join("\n");
    if (verdict.verdict === "ask" && ctx?.ui?.confirm) {
      const ok = await ctx.ui.confirm(reason || "hablo-guard asks to allow this tool call", { timeoutMs: 120_000 });
      if (ok) return;
    }
    return { block: true, reason: reason || "guard: denied", terminate: Boolean(verdict.terminate) };
  });
}
