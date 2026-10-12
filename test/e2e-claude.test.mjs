// Phase 6 E2E: Claude path acceptance without live SSO/Claude Code.
// Live Messages + SSO smoke: bin/hablo-e2e-claude-smoke.sh
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "hablo.json"), "utf8"));

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-e2e-claude-"));
  const home = path.join(dir, "home");
  const agentDir = path.join(home, ".pi", "agent");
  const fakeBin = path.join(dir, "bin");
  const firstmate = path.join(dir, "firstmate");
  const npmModules = path.join(home, ".npm-global", "lib", "node_modules");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(npmModules, { recursive: true });
  fs.mkdirSync(path.join(firstmate, "bin"), { recursive: true });
  fs.writeFileSync(path.join(firstmate, "AGENTS.md"), "# firstmate e2e\n\nUse bin/fm-brief.sh <task> <repo>.\n");
  writeExecutable(path.join(firstmate, "bin", "fm-claude-trust.sh"), "#!/bin/sh\nexit 0\n");
  writeExecutable(path.join(fakeBin, "pi"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && echo 'pi 1.1.0'\nexit 0\n");
  writeExecutable(path.join(fakeBin, "npm"), `#!/bin/sh
case "$*" in
  "root -g") printf '%s\\n' ${JSON.stringify(npmModules)}; exit 0 ;;
  "prefix -g") printf '%s\\n' ${JSON.stringify(path.join(home, ".npm-global"))}; exit 0 ;;
  *"engines"*) printf '%s\\n' '{"node":">=20.0.0"}'; exit 0 ;;
  *"dist-tags"*) printf '%s\\n' '{"latest":"0.85.0"}'; exit 0 ;;
esac
exit 0
`);
  const settings = { packages: manifest.pi.packages, enabledModels: ["openai/test"] };
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  for (const spec of manifest.pi.packages) {
    const [, name, version] = spec.match(/^npm:(.+)@([^@]+)$/);
    const pkgDir = path.join(npmModules, name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, version }));
  }
  const bedrouter = path.join(npmModules, "pi-bedrouter", "node_modules", "bedrouter");
  fs.mkdirSync(path.join(bedrouter, "dist"), { recursive: true });
  fs.writeFileSync(path.join(bedrouter, "dist", "cli.js"), "");
  // Shared bedrouter for Claude-only npm install -g path.
  fs.mkdirSync(path.join(npmModules, "bedrouter", "dist"), { recursive: true });
  fs.writeFileSync(path.join(npmModules, "bedrouter", "dist", "cli.js"), "#!/usr/bin/env node\n");
  fs.writeFileSync(path.join(npmModules, "bedrouter", "package.json"), JSON.stringify({ name: "bedrouter", version: "0.10.0" }));
  return { dir, home, agentDir, fakeBin, firstmate, npmModules };
}

function runInstall(f, extra = []) {
  return execFileSync(process.execPath, [
    path.join(root, "install.mjs"),
    "--profile", "",
    "--skip-aws",
    "--skip-probe",
    "--skip-tools",
    "--no-jira-agent-service",
    "--no-dream-service",
    "--firstmate-dir", f.firstmate,
    "--bin-dir", path.join(f.home, ".local", "bin"),
    ...extra,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: f.home,
      PI_CODING_AGENT_DIR: f.agentDir,
      PATH: `${f.fakeBin}:${process.env.PATH}`,
      HABLO_INTERROGATE_FIXTURE: path.join(root, "interrogate", "testdata", "upstream-skill"),
    },
  });
}

function runHablo(f, { agent = "claude", env = {}, args = [], stubClaude = true } = {}) {
  const project = path.join(f.dir, "project");
  if (!fs.existsSync(path.join(project, ".git"))) {
    fs.mkdirSync(project, { recursive: true });
    execFileSync("git", ["init", "--quiet", project]);
  }
  const calls = path.join(f.dir, `${agent}-call.txt`);
  fs.rmSync(calls, { force: true });
  if (agent === "claude" && stubClaude) {
    writeExecutable(path.join(f.fakeBin, "claude"), `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(calls)}
printf 'PWD=%s\\n' "$(pwd -P)" >> ${JSON.stringify(calls)}
`);
  } else if (agent === "claude" && !stubClaude) {
    fs.rmSync(path.join(f.fakeBin, "claude"), { force: true });
  } else {
    writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh
[ "\${1:-}" = --version ] && { echo 1.1.0; exit 0; }
printf '%s\\n' "$@" > ${JSON.stringify(calls)}
printf 'HABLO_CREW_MODEL=%s\\n' "$HABLO_CREW_MODEL" >> ${JSON.stringify(calls)}
`);
    writeExecutable(path.join(f.fakeBin, "node"), `#!/bin/sh
[ "\${1:-}" = -v ] && { echo v22.19.0; exit 0; }
exec ${JSON.stringify(process.execPath)} "$@"
`);
  }
  // When proving "missing claude", drop the host PATH so a real ~/.local/bin/claude cannot leak in.
  const pathForRun = stubClaude === false && agent === "claude"
    ? `${f.fakeBin}:/usr/bin:/bin`
    : `${f.fakeBin}:${process.env.PATH}`;
  const result = spawnSync(path.join(f.home, ".local", "bin", "hablo"), args, {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: f.home,
      PI_CODING_AGENT_DIR: f.agentDir,
      PATH: pathForRun,
      HABLO_PREFLIGHT: "skip",
      HABLO_HERDR_STAMP: "0",
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    call: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "",
    project,
  };
}

test("E2E: --agent both install wires Pi + Claude; voyage, flip, interrogate, progress, soft-fail", () => {
  const f = fixture();
  try {
    // Operator-owned settings via symlink (dotfiles case).
    const realClaude = path.join(f.dir, "dotfiles", "claude");
    fs.mkdirSync(realClaude, { recursive: true });
    fs.writeFileSync(path.join(realClaude, "settings.json"), "{}\n");
    fs.mkdirSync(path.join(f.home, ".claude"), { recursive: true });
    fs.symlinkSync(path.join(realClaude, "settings.json"), path.join(f.home, ".claude", "settings.json"));

    const out = runInstall(f, ["--agent", "both", "--interrogate"]);
    assert.match(out, /agent=both/);
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "agent"), "utf8").trim(), "pi");

    // Routing env through the symlink.
    const settings = JSON.parse(fs.readFileSync(path.join(realClaude, "settings.json"), "utf8"));
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:20129");
    assert.equal(settings.env.ANTHROPIC_MODEL, "auto");
    assert.ok(settings.env.ANTHROPIC_AUTH_TOKEN);
    assert.equal(settings.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, "1");
    assert.equal(settings.enabledPlugins["hablo@hablo"], true);
    assert.equal(settings.extraKnownMarketplaces.hablo.source.source, "directory");

    // Plugin: agents, openwiki, progress, TDD skill (interrogate on).
    const plugin = path.join(f.home, ".hablo", "claude");
    assert.ok(fs.existsSync(path.join(plugin, "agents", "implementer.md")));
    assert.ok(fs.existsSync(path.join(plugin, "skills", "openwiki", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(plugin, "skills", "technical-design-doc", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(plugin, "hooks", "progress.mjs")));
    assert.match(fs.readFileSync(path.join(plugin, "hooks", "hooks.json"), "utf8"), /SessionStart/);
    assert.match(fs.readFileSync(path.join(plugin, "hooks", "start-bedrouter.mjs"), "utf8"), /20129/);

    // Pi side still present.
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-progress.ts")));
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "pi");
    assert.match(fs.readFileSync(path.join(f.firstmate, "config", "crew-dispatch.json"), "utf8"), /"harness": "pi"/);

    // Captain policies (tone/ticket/interrogate) apply to every harness.
    const captain = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.match(captain, /HABLO:INTERROGATE-POLICY/);
    assert.match(captain, /HABLO:TICKET-POLICY/);

    // TUI / headless flip Pi → Claude swaps harness + dispatch + permission mode.
    const configBin = path.join(f.home, ".local", "bin", "hablo-config");
    assert.ok(fs.existsSync(configBin));
    execFileSync(configBin, ["--set-agent", "claude"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home, PATH: `${f.fakeBin}:${path.dirname(configBin)}:${process.env.PATH}` },
    });
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "agent"), "utf8").trim(), "claude");
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "claude");
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "claude-permission-mode"), "utf8").trim(), "auto");
    assert.match(fs.readFileSync(path.join(f.firstmate, "config", "crew-dispatch.json"), "utf8"), /"harness": "claude"/);
    assert.match(fs.readFileSync(path.join(f.firstmate, "config", "crew-dispatch.json"), "utf8"), /"model": "auto"/);

    // Claude voyage launch: append-system-prompt carries crew model + interrogate + AGENTS.md rewrite.
    const voyage = runHablo(f, { agent: "claude" });
    assert.equal(voyage.status, 0, voyage.stderr);
    assert.match(voyage.stderr, /agent\s+claude/);
    assert.match(voyage.stderr, /captain\s+auto/);
    assert.match(voyage.call, /--append-system-prompt/);
    assert.match(voyage.call, /--model/);
    assert.doesNotMatch(voyage.call, /--provider/);
    assert.match(voyage.call, /Crew model \(HABLO, this voyage\)/);
    assert.match(voyage.call, /--model auto/);
    assert.match(voyage.call, /Interrogate|senior-lead|tdds/i);
    assert.match(voyage.call, new RegExp(`${f.firstmate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/bin/fm-brief`));
    assert.match(voyage.call, /progress hooks/);

    // Missing claude: install-or-exit, never Pi.
    writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh
echo SILENT_PI_FALLBACK >&2
exit 99
`);
    const missing = runHablo(f, { agent: "claude", stubClaude: false });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Claude Code is not on PATH/);
    assert.match(missing.stderr, /Refusing to fall back to Pi/);
    assert.doesNotMatch(missing.stderr, /SILENT_PI_FALLBACK/);

    // Flip back to Pi and launch Pi voyage.
    execFileSync(configBin, ["--set-agent", "pi"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home, PATH: `${f.fakeBin}:${path.dirname(configBin)}:${process.env.PATH}` },
    });
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "pi");
    // Restore pi stub with call capture.
    const piVoyage = runHablo(f, { agent: "pi" });
    assert.equal(piVoyage.status, 0, piVoyage.stderr);
    assert.match(piVoyage.call, /hablo-captain\.ts/);
    assert.match(piVoyage.call, /HABLO_CREW_MODEL=bedrouter\/auto/);

    // Progress hook: commit + PR → hablo-jira; soft-fail when CLI absent.
    const jiraCalls = path.join(f.dir, "jira-calls.txt");
    writeExecutable(path.join(f.fakeBin, "hablo-jira"), `#!/bin/sh
echo "$@" >> ${JSON.stringify(jiraCalls)}
`);
    const hook = path.join(plugin, "hooks", "progress.mjs");
    const runHook = (event) => spawnSync(process.execPath, [hook], {
      input: JSON.stringify(event),
      encoding: "utf8",
      env: { ...process.env, PATH: `${f.fakeBin}:${process.env.PATH}` },
    });
    const waitFor = (re) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const log = fs.existsSync(jiraCalls) ? fs.readFileSync(jiraCalls, "utf8") : "";
        if (re.test(log)) return log;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      return fs.existsSync(jiraCalls) ? fs.readFileSync(jiraCalls, "utf8") : "";
    };
    assert.equal(runHook({
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'HAB-9 e2e'" },
      tool_response: "[main deadbeef] HAB-9 e2e\n 1 file changed",
    }).status, 0);
    assert.match(waitFor(/progress --commit deadbeef/), /progress --commit deadbeef/);
    assert.equal(runHook({
      tool_name: "Bash",
      tool_input: { command: "gh pr create --title t" },
      tool_response: "https://github.com/org/repo/pull/9\n",
    }).status, 0);
    assert.match(waitFor(/pr-opened --pr https:\/\/github.com\/org\/repo\/pull\/9/), /pr-opened/);

    // Soft-fail: remove hablo-jira; hook still exits 0.
    fs.unlinkSync(path.join(f.fakeBin, "hablo-jira"));
    assert.equal(runHook({
      tool_name: "Bash",
      tool_input: { command: "git commit -m 'x'" },
      tool_response: "[main abc1234] x\n",
    }).status, 0);

    // Interrogate off removes Claude TDD skill on re-install; Pi skill soft-kept.
    runInstall(f, ["--agent", "both", "--no-interrogate"]);
    assert.ok(!fs.existsSync(path.join(plugin, "skills", "technical-design-doc")));
    assert.ok(fs.existsSync(path.join(f.agentDir, "skills", "technical-design-doc", "SKILL.md")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "interrogate.json"), "utf8")).enabled, false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("E2E: --agent claude alone skips Pi packages path artifacts but still captains via Claude", () => {
  const f = fixture();
  try {
    const out = runInstall(f, ["--agent", "claude", "--skip-cli"]);
    // skip-cli skips hablo wrapper; re-run without skip-cli for launch.
    assert.match(out, /Claude plugin|register marketplace|enable plugin|crew harness/);
    runInstall(f, ["--agent", "claude"]);
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "agent"), "utf8").trim(), "claude");
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "claude");
    const voyage = runHablo(f, { agent: "claude", env: { HABLO_AGENT: "claude" } });
    assert.equal(voyage.status, 0, voyage.stderr);
    assert.match(voyage.call, /--append-system-prompt/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
