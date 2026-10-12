// hablo-progress: after a successful git commit or gh pr create in a Pi bash tool,
// post a soft-fail Jira update via hablo-jira. Installed globally under
// ~/.pi/agent/extensions/ so captains (-e) and crewmates both get it.
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMIT_CMD = /\bgit\b(?:\s+(?:-[^\s]+|\S+=\S+))*\s+commit\b/;
const PR_CREATE_CMD = /\bgh\b(?:\s+[^\n]*?)?\s+pr\s+create\b/;
const COMMIT_LINE = /^\s*\[[^\]]+\s+([0-9a-f]{7,40})\]\s*(.*)$/im;
const PR_URL = /https?:\/\/[^\s]+\/(?:pull|merge_requests)\/\d+/i;

function toolText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("\n");
}

function bashCommand(input: Record<string, unknown>): string {
  const cmd = input.command;
  return typeof cmd === "string" ? cmd : "";
}

function runQuiet(bin: string, args: string[]): void {
  try {
    const child = execFile(bin, args, {
      env: process.env,
      timeout: 30_000,
      windowsHide: true,
    }, () => {
      // soft-fail: network/auth must never block the agent
    });
    child.unref?.();
  } catch {
    /* ignore */
  }
}

function onCommit(output: string, command: string): void {
  const m = output.match(COMMIT_LINE);
  if (!m) return;
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

function onPRCreate(output: string): void {
  const m = output.match(PR_URL);
  if (!m) return;
  runQuiet("hablo-jira", ["pr-opened", "--pr", m[0].replace(/[).,]+$/, ""), "--quiet"]);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.isError) return;
    if (event.toolName !== "bash" && event.toolName !== "powershell") return;
    const command = bashCommand(event.input || {});
    if (!command) return;
    const output = toolText(event.content);
    if (COMMIT_CMD.test(command) && !/\s(?:--help|-h)\b/.test(command)) {
      onCommit(output, command);
      return;
    }
    if (PR_CREATE_CMD.test(command) && !/\s(?:--help|-h)\b/.test(command)) {
      onPRCreate(output);
    }
  });
}
