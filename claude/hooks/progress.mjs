#!/usr/bin/env node
// HABLO: PostToolUse hook — soft-fail Jira progress after git commit / gh pr create.
// managed by HABLO-installer. Reads Claude Code hook JSON from stdin.
import { execFile } from "node:child_process";
import fs from "node:fs";

const COMMIT_CMD = /\bgit\b(?:\s+(?:-[^\s]+|\S+=\S+))*\s+commit\b/;
const PR_CREATE_CMD = /\bgh\b(?:\s+[^\n]*?)?\s+pr\s+create\b/;
const COMMIT_LINE = /^\s*\[[^\]]+\s+([0-9a-f]{7,40})\]\s*(.*)$/im;
const PR_URL = /https?:\/\/[^\s]+\/(?:pull|merge_requests)\/\d+/i;

function runQuiet(bin, args) {
  try {
    const child = execFile(bin, args, { env: process.env, timeout: 30_000, windowsHide: true }, () => {});
    child.unref?.();
  } catch { /* soft-fail */ }
}

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((p) => (p && typeof p === "object" && typeof p.text === "string" ? p.text : "")).join("\n");
  }
  if (value && typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (typeof value.stdout === "string") return value.stdout;
    try { return JSON.stringify(value); } catch { return ""; }
  }
  return "";
}

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { process.exit(0); }
let event;
try { event = JSON.parse(raw || "{}"); } catch { process.exit(0); }

const tool = String(event.tool_name || event.toolName || "");
if (!/^Bash$/i.test(tool)) process.exit(0);

const input = event.tool_input || event.toolInput || event.input || {};
const command = typeof input.command === "string" ? input.command : "";
if (!command) process.exit(0);

const output = textOf(event.tool_response ?? event.toolResponse ?? event.response ?? event.content ?? "");

if (COMMIT_CMD.test(command) && !/\s(?:--help|-h)\b/.test(command)) {
  const m = output.match(COMMIT_LINE);
  if (m) {
    const sha = m[1];
    let message = (m[2] || "").trim();
    if (!message) {
      const mm = command.match(/(?:^|\s)-m\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
      message = (mm?.[1] || mm?.[2] || mm?.[3] || "").trim();
    }
    const args = ["progress", "--commit", sha, "--quiet"];
    if (message) args.push("--message", message);
    runQuiet("hablo-jira", args);
  }
  process.exit(0);
}

if (PR_CREATE_CMD.test(command) && !/\s(?:--help|-h)\b/.test(command)) {
  const m = output.match(PR_URL);
  if (m) runQuiet("hablo-jira", ["pr-opened", "--pr", m[0].replace(/[).,]+$/, ""), "--quiet"]);
}

process.exit(0);
