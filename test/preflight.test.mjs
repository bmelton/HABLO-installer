import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const preflight = path.join(root, "bin", "hablo-preflight");

async function withFakeBedrouter(models, fn) {
  const script = `
const http = require("node:http");
const models = ${JSON.stringify(models)};
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
});
`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("fake bedrouter did not bind")), 5000);
    child.stdout.on("data", (buf) => {
      out += buf.toString();
      if (/^\d+$/.test(out.trim())) {
        clearTimeout(timer);
        resolve(Number(out.trim()));
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`fake bedrouter exited ${code}`)));
  });
  try {
    return await fn(port);
  } finally {
    child.kill("SIGTERM");
  }
}

test("hablo-preflight accepts live aliases and rejects disabled ones", async () => {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-preflight-"));
  try {
    // Succeeding STS stub: this test owns the model allowlist, not cloud auth.
    fs.writeFileSync(path.join(fakeBin, "aws"), "#!/bin/sh\necho ok\nexit 0\n", { mode: 0o755 });
    await withFakeBedrouter(["auto", "sonnet", "haiku"], async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const env = { ...process.env, BEDROUTER_URL: base, PATH: `${fakeBin}:${process.env.PATH}`, AWS_PROFILE: "test" };
      delete env.HABLO_PREFLIGHT;
      const ok = spawnSync("bash", [preflight, "--provider", "bedrouter", "--model", "bedrouter/auto"], { encoding: "utf8", env });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stderr, /model=auto/);
      const bad = spawnSync("bash", [preflight, "--provider", "bedrouter", "--model", "bedrouter/fable"], { encoding: "utf8", env });
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stderr, /fable/);
    });
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("hablo-preflight skip bypasses checks", () => {
  const r = spawnSync("bash", [preflight, "--provider", "bedrouter", "--model", "bedrouter/fable"], {
    encoding: "utf8",
    env: { ...process.env, HABLO_PREFLIGHT: "skip" },
  });
  assert.equal(r.status, 0);
});

test("hablo-crewmate extension source gates on FM_TASK_ID and logs aborts", () => {
  const src = fs.readFileSync(path.join(root, "pi", "extensions", "hablo-crewmate.ts"), "utf8");
  assert.match(src, /FM_TASK_ID/);
  assert.match(src, /HABLO \/ firstmate crewmate trust/);
  assert.match(src, /abort-log\.jsonl/);
  assert.match(src, /stop !== "aborted"/);
  assert.match(src, /operation aborted/i);
});

test("captain policy and hablo-captain warn against fm-brief --project flag misuse", () => {
  const policy = fs.readFileSync(path.join(root, "firstmate", "captain-model-policy.md"), "utf8");
  assert.match(policy, /no `--project` flag/);
  assert.match(policy, /fm-brief\.sh <task-id> <repo-name>/);
  assert.match(policy, /state\/--project\.status/);
  const captain = fs.readFileSync(path.join(root, "pi", "extensions", "hablo-captain.ts"), "utf8");
  // Source escapes backticks inside the template string: \`--project\`
  assert.match(captain, /no \\`--project\\` flag/);
  assert.match(captain, /state\/<task-id>\.status/);
});

test("captain policies keep Jira keys exact and distinct from OpenWiki", () => {
  const branch = fs.readFileSync(path.join(root, "firstmate", "captain-branch-policy.md"), "utf8");
  assert.match(branch, /Jira key is an exact string/);
  assert.match(branch, /intent key matches/);
  const openwiki = fs.readFileSync(path.join(root, "firstmate", "captain-openwiki-policy.md"), "utf8");
  assert.match(openwiki, /not\*\* a Jira project/);
  assert.match(openwiki, /OPENWIKI-/);
  const jiraBrief = fs.readFileSync(path.join(root, "jira", "brief.tmpl.md"), "utf8");
  assert.match(jiraBrief, /Authoritative Jira key/);
  assert.match(jiraBrief, /\{\{\.Key\}\}/);
  const captain = fs.readFileSync(path.join(root, "pi", "extensions", "hablo-captain.ts"), "utf8");
  assert.match(captain, /never invent `OPENWIKI-/);
  assert.match(captain, /intent key must match/);
});

test("brief-include carries crewmate Jira reporting without delivery-contract lines", () => {
  const include = fs.readFileSync(path.join(root, "firstmate", "brief-include.md"), "utf8");
  assert.match(include, /HABLO:BRIEF-INCLUDE:START/);
  assert.match(include, /hablo-jira comment --key <JIRA-KEY> --stage implementation/);
  assert.match(include, /Never transition a ticket to Done/);
  assert.doesNotMatch(include, /Delivery contract: mode=/);
  const ticket = fs.readFileSync(path.join(root, "firstmate", "captain-ticket-policy.md"), "utf8");
  assert.match(ticket, /config\/brief-include\.md/);
});
