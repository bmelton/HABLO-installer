import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const guardDir = path.join(root, "guard");

test("hablo-guard decide denies secret content and allows ordinary edits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-guard-bin-"));
  try {
    const bin = path.join(dir, "hablo-guard");
    execFileSync("go", ["build", "-trimpath", "-o", bin, "."], { cwd: guardDir, stdio: "pipe" });
    const policy = {
      mode: "enforce",
      engine: { timeoutMs: 3000, auditLog: path.join(dir, "log.jsonl"), cacheDir: path.join(dir, "cache") },
      secrets: {
        interactive: false,
        maxScanBytes: 1_000_000,
        paths: ["**/.env"],
        patterns: ["AKIA[0-9A-Z]{16}"],
        exfilCommands: ["curl"],
        exfilHosts: [],
      },
      protectedPaths: [],
      shell: { interactive: true, deny: ["\\\\bsudo\\\\b"] },
      allow: [],
    };
    const policyPath = path.join(dir, "guard.json");
    fs.writeFileSync(policyPath, JSON.stringify(policy));
    const proj = path.join(dir, "proj");
    fs.mkdirSync(proj);

    const run = (req) => {
      const r = spawnSync(bin, ["decide"], {
        input: JSON.stringify(req),
        encoding: "utf8",
        env: { ...process.env, HABLO_GUARD_POLICY: policyPath },
      });
      return { status: r.status, v: JSON.parse((r.stdout || "").trim().split("\n").pop() || "{}") };
    };

    let out = run({
      v: 1, event: "tool_call", agent: "pi", tool: "write",
      input: { path: path.join(proj, "a.go"), content: 'k:="AKIAIOSFODNN7EXAMPLE"' },
      session: { kind: "crewmate", attended: false, project: proj, cwd: proj },
    });
    assert.equal(out.status, 0);
    assert.equal(out.v.verdict, "deny");
    assert.equal(out.v.rule, "secrets.content");

    out = run({
      v: 1, event: "tool_call", agent: "claude-code", tool: "edit",
      input: { path: path.join(proj, "a.go"), content: "package main\n" },
      session: { kind: "captain", attended: true, project: proj, cwd: proj },
    });
    assert.equal(out.v.verdict, "allow");

    const doc = spawnSync(bin, ["doctor"], { encoding: "utf8", env: { ...process.env, HABLO_GUARD_POLICY: policyPath } });
    assert.equal(doc.status, 0);
    assert.match(doc.stdout, /mode=enforce/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude hablo-guard.mjs fails closed on missing engine", () => {
  const hook = path.join(root, "claude", "hooks", "hablo-guard.mjs");
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      session_id: "t1",
    }),
    encoding: "utf8",
    env: { ...process.env, PATH: "/usr/bin:/bin", HABLO_GUARD_BIN: "/nonexistent/hablo-guard" },
  });
  assert.equal(r.status, 0);
  const body = JSON.parse(r.stdout || "{}");
  assert.equal(body.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(body.hookSpecificOutput?.permissionDecisionReason || "", /engine failure|guard:/);
});
