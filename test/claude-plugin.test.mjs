import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseFrontMatter, renderClaudeAgent, mapTools, claudeAgentName } from "../claude/render-agents.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("renderClaudeAgent maps Pi front matter to Claude Code subagent shape", () => {
  const pi = `---
name: software architect
description: Turns requirements into a spec
thinking: high
tools: [read, grep, find, ls]
---

You read; you never edit.
`;
  const { name, markdown } = renderClaudeAgent(pi, { exploreModel: "opus", executeModel: "sonnet" });
  assert.equal(name, "software-architect");
  assert.equal(claudeAgentName("software architect"), "software-architect");
  assert.deepEqual(mapTools(["read", "grep", "find", "ls", "edit", "write", "bash"]), ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]);
  const { meta, body } = parseFrontMatter(markdown);
  assert.equal(meta.name, "software-architect");
  assert.equal(meta.model, "opus");
  assert.deepEqual(meta.tools, ["Read", "Grep", "Glob"]);
  assert.match(body, /You read/);
  assert.doesNotMatch(markdown, /thinking:/);
});

test("thinking medium selects execute model", () => {
  const pi = `---
name: implementer
description: Implements
thinking: medium
tools: [read, edit, write, bash]
---

body
`;
  const { markdown } = renderClaudeAgent(pi, { exploreModel: "opus", executeModel: "sonnet" });
  assert.match(markdown, /^model: sonnet$/m);
});

test("progress.mjs soft-fails commit and pr-create via hablo-jira", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-progress-"));
  try {
    const calls = path.join(tmp, "calls.txt");
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "hablo-jira"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(calls)}\n`, { mode: 0o755 });
    const hook = path.join(root, "claude", "hooks", "progress.mjs");

    const run = (event) => spawnSync(process.execPath, [hook], {
      input: JSON.stringify(event),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });

    const waitFor = (re) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const log = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
        if (re.test(log)) return log;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      return fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
    };

    let r = run({
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'PROJ-1 fix'" },
      tool_response: "[main abcdef0] PROJ-1 fix\n 1 file changed",
    });
    assert.equal(r.status, 0);
    assert.match(waitFor(/progress --commit abcdef0/), /progress --commit abcdef0/);

    r = run({
      tool_name: "Bash",
      tool_input: { command: "gh pr create --title t" },
      tool_response: "https://github.com/org/repo/pull/42\n",
    });
    assert.equal(r.status, 0);
    assert.match(waitFor(/pr-opened --pr https:\/\/github.com\/org\/repo\/pull\/42/), /pr-opened/);

    r = run({ tool_name: "Edit", tool_input: { file_path: "x" } });
    assert.equal(r.status, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
