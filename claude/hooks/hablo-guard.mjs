#!/usr/bin/env node
// HABLO Claude PreToolUse / PostToolUse shim over hablo-guard. Fail closed: every error → explicit deny.
// managed by HABLO-installer. No rule logic here.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL_MAP = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  Bash: "bash",
  NotebookEdit: "write",
};

function binPath() {
  const env = process.env.HABLO_GUARD_BIN;
  if (env && fs.existsSync(env)) return env;
  const local = path.join(os.homedir(), ".local", "bin", "hablo-guard");
  if (fs.existsSync(local)) return local;
  return "hablo-guard";
}

function sessionRecordPath(sessionId) {
  const dir = path.join(os.homedir(), ".hablo", "guard-cache", "sessions");
  return path.join(dir, `${sessionId || "unknown"}.json`);
}

function readSession(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(sessionRecordPath(sessionId), "utf8"));
  } catch {
    return { attended: false, kind: "solo" };
  }
}

function deny(reason) {
  const body = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(body));
  process.exit(0);
}

function allow() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  }));
  process.exit(0);
}

function mapInput(tool, input) {
  const out = { ...(input || {}) };
  if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") {
    if (out.file_path && !out.path) out.path = out.file_path;
    if (out.new_string && !out.content) out.content = out.new_string;
  }
  if (tool === "Read" && out.file_path && !out.path) out.path = out.file_path;
  return out;
}

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { deny("guard: could not read hook stdin"); }
let event;
try { event = JSON.parse(raw || "{}"); } catch { deny("guard: malformed hook JSON"); }

if (process.env.HABLO_GUARD === "off") {
  // Loud allow: SessionStart should have warned; still allow.
  allow();
}

const toolName = String(event.tool_name || event.toolName || "");
const mapped = TOOL_MAP[toolName] || toolName;
const input = mapInput(toolName, event.tool_input || event.toolInput || event.input || {});
const sessionId = String(event.session_id || event.sessionId || "");
const sess = readSession(sessionId);
const kind = process.env.FM_TASK_ID ? "crewmate" : (process.env.HABLO_PROJECT ? "captain" : (sess.kind || "solo"));
const attended = !process.env.FM_TASK_ID && Boolean(sess.attended);

const req = {
  v: 1,
  event: "tool_call",
  agent: "claude-code",
  tool: mapped,
  input,
  session: {
    id: sessionId,
    kind,
    attended,
    project: process.env.HABLO_PROJECT || sess.project || "",
    cwd: process.cwd(),
    taskId: process.env.FM_TASK_ID || "",
  },
};

let out;
try {
  out = execFileSync(binPath(), ["decide"], {
    input: JSON.stringify(req),
    encoding: "utf8",
    timeout: Number(process.env.HABLO_GUARD_TIMEOUT_MS || 2500),
    windowsHide: true,
    env: process.env,
  });
} catch (e) {
  const err = e;
  deny(`guard: engine failure (exit ${err.status ?? "?"}): ${(err.stderr || err.message || "unknown").toString().slice(0, 400)}`);
}

let verdict;
try {
  verdict = JSON.parse(out.trim().split("\n").pop() || "{}");
} catch {
  deny("guard: unparsable engine verdict");
}

if (verdict.verdict === "allow") allow();

const reason = [verdict.reason, verdict.remedy].filter(Boolean).join("\n") || "guard: denied";
if (verdict.verdict === "ask") {
  // Claude PreToolUse "ask" maps to permissionDecision ask when supported; else deny for crewmates.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: attended ? "ask" : "deny",
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

deny(reason);
