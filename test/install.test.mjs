import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hablo-install-test-"));
  const home = path.join(dir, "home");
  const agentDir = path.join(home, ".pi", "agent");
  const fakeBin = path.join(dir, "bin");
  const firstmate = path.join(dir, "firstmate");
  // Match current Pi: user packages land in npm's global node_modules via `npm install -g`.
  const npmModules = path.join(home, ".npm-global", "lib", "node_modules");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(npmModules, { recursive: true });
  fs.mkdirSync(path.join(firstmate, "bin"), { recursive: true });
  fs.writeFileSync(path.join(firstmate, "AGENTS.md"), "# firstmate test manual\n");
  writeExecutable(path.join(fakeBin, "pi"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && echo 'pi test'\nexit 0\n");
  writeExecutable(path.join(fakeBin, "npm"), `#!/bin/sh
case "$*" in
  "root -g") printf '%s\\n' ${JSON.stringify(npmModules)}; exit 0 ;;
  "prefix -g") printf '%s\\n' ${JSON.stringify(path.join(home, ".npm-global"))}; exit 0 ;;
  # Satisfy the Pi engines preflight without requiring the host Node to be 22.19+.
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
  return { dir, home, agentDir, fakeBin, firstmate, npmModules };
}

function install(f, extra = []) {
  return execFileSync(process.execPath, [
    path.join(root, "install.mjs"),
    "--profile", "",
    "--skip-aws",
    "--skip-probe",
    "--skip-agents",
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
      // Offline pin: do not hit enterprise GitHub from unit tests.
      HABLO_INTERROGATE_FIXTURE: path.join(root, "interrogate", "testdata", "upstream-skill"),
    },
  });
}

function uninstall(f, extra = []) {
  return execFileSync(process.execPath, [path.join(root, "install.mjs"), "uninstall", ...extra], {
    encoding: "utf8",
    env: { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: `${f.fakeBin}:${process.env.PATH}` },
  });
}

function runInstalledHablo(f, args = [], env = {}, opts = {}) {
  const project = path.join(f.dir, "project");
  fs.mkdirSync(project, { recursive: true });
  if (!fs.existsSync(path.join(project, ".git"))) execFileSync("git", ["init", "--quiet", project]);
  const cwd = opts.cwd ?? project;
  const calls = path.join(f.dir, "pi-call.json");
  fs.rmSync(calls, { force: true });
  writeExecutable(
    path.join(f.fakeBin, "pi"),
    `#!/bin/sh
[ "\${1:-}" = --version ] && { echo 1.1.0; exit 0; }
printf '%s\\n' "$HABLO_CREW_MODEL" > ${JSON.stringify(calls)}
printf '%s\\n' "$@" >> ${JSON.stringify(calls)}
printf 'HABLO_PI_EXTENSIONS=%s\\n' "$HABLO_PI_EXTENSIONS" >> ${JSON.stringify(calls)}
printf 'PWD=%s\\n' "$(pwd -P)" >> ${JSON.stringify(calls)}
`,
  );
  // hablo's runtime picker only needs `node -v` / `pi --version` from PATH.
  // Forward other node invocations to the real binary (Herdr stamp / snapshot helpers).
  const realNode = process.execPath;
  writeExecutable(
    path.join(f.fakeBin, "node"),
    `#!/bin/sh
[ "\${1:-}" = -v ] && { echo v22.19.0; exit 0; }
exec ${JSON.stringify(realNode)} "$@"
`,
  );
  const result = spawnSync(path.join(f.home, ".local", "bin", "hablo"), args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: f.home,
      PI_CODING_AGENT_DIR: f.agentDir,
      PATH: `${f.fakeBin}:${process.env.PATH}`,
      HABLO_PREFLIGHT: "skip", // unit tests do not run a live bedrouter/SSO gate
      HABLO_HERDR_STAMP: "0", // do not reload a live Herdr server from unit tests
      ...env,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    call: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "",
  };
}

test("agent selection writes marker, tags receipt, and refuses claude+oss ladder", () => {
  const f = fixture();
  try {
    const out = install(f);
    assert.match(out, /agent=pi \(from defaults\)/);
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "agent"), "utf8").trim(), "pi");
    const receipt = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "receipt.json"), "utf8"));
    const run = receipt.runs.at(-1);
    assert.equal(run.agent, "pi");
    assert.equal(run.activeAgent, "pi");
    assert.ok(run.actions.length > 0);
    assert.ok(run.actions.every((a) => a.agent === "pi"), "every action is tagged with install agent");

    let refused = "";
    try {
      install(f, ["--agent", "claude", "--ladder", "oss"]);
    } catch (e) {
      refused = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    assert.match(refused, /cannot use --ladder oss/);

    const both = install(f, ["--agent", "both"]);
    assert.match(both, /agent=both \(from flag\)/);
    assert.match(both, /Claude Code side uses ladder=claude/);
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "agent"), "utf8").trim(), "pi");
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "pi");
    const bothRun = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "receipt.json"), "utf8")).runs.at(-1);
    assert.equal(bothRun.agent, "both");
    assert.equal(bothRun.activeAgent, "pi");
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Claude routing merges settings.env and API key; strips Phase 2 SessionStart", () => {
  const f = fixture();
  try {
    // Pre-existing operator key must be preserved; Phase 2 HABLO SessionStart must be removed.
    const claudeDir = path.join(f.home, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({
      env: { ANTHROPIC_MODEL: "keep-me" },
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo operator" }] },
          { hooks: [{ type: "command", command: `node ${path.join(f.home, ".hablo", "claude", "hooks", "start-bedrouter.mjs")}` }] },
        ],
      },
    }, null, 2) + "\n");

    // Seed a global bedrouter so Claude-only does not need a real npm install.
    const brPkg = path.join(f.npmModules, "bedrouter", "dist");
    fs.mkdirSync(brPkg, { recursive: true });
    fs.writeFileSync(path.join(brPkg, "cli.js"), "#!/usr/bin/env node\nconsole.log('bedrouter stub');\n");
    fs.writeFileSync(path.join(f.npmModules, "bedrouter", "package.json"), JSON.stringify({ name: "bedrouter", version: "0.10.0" }));
    writeExecutable(path.join(f.fakeBin, "npm"), `#!/bin/sh
if [ "$1" = root ] && [ "$2" = -g ]; then echo ${JSON.stringify(f.npmModules)}; exit 0; fi
exit 0
`);

    const out = install(f, ["--agent", "claude", "--skip-cli", "--skip-firstmate", "--skip-jira", "--skip-dream"]);
    assert.match(out, /\[4b\] Claude Code routing/);
    assert.match(out, /ANTHROPIC_BASE_URL/);
    assert.match(out, /claude settings\.env\.ANTHROPIC_MODEL already set/);
    assert.match(out, /remove Phase 2 HABLO SessionStart/);

    const brEnv = fs.readFileSync(path.join(f.home, ".bedrouter", ".env"), "utf8");
    assert.match(brEnv, /^BEDROUTER_API_KEY=\S+/m);
    const key = brEnv.match(/^BEDROUTER_API_KEY=(\S+)/m)[1];

    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf8"));
    assert.equal(settings.env.ANTHROPIC_MODEL, "keep-me");
    assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:20129");
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, key);
    assert.equal(settings.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, "1");
    assert.equal(settings.hooks.SessionStart.length, 1);
    assert.match(JSON.stringify(settings.hooks.SessionStart), /echo operator/);
    assert.doesNotMatch(JSON.stringify(settings.hooks.SessionStart), /start-bedrouter/);

    // Default install() uses --skip-agents, so the plugin is not copied here.
    assert.ok(!fs.existsSync(path.join(f.home, ".hablo", "claude", "hooks", "start-bedrouter.mjs")));

    install(f, ["--agent", "claude", "--skip-cli", "--skip-firstmate", "--skip-jira", "--skip-dream"]);
    const again = JSON.parse(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf8"));
    assert.equal(again.hooks.SessionStart.length, 1);
    assert.equal(again.env.ANTHROPIC_AUTH_TOKEN, key);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Claude plugin installs agents, marketplace, hooks; TDD skill only when interrogate on", () => {
  const f = fixture();
  try {
    const brPkg = path.join(f.npmModules, "bedrouter", "dist");
    fs.mkdirSync(brPkg, { recursive: true });
    fs.writeFileSync(path.join(brPkg, "cli.js"), "#!/usr/bin/env node\nconsole.log('bedrouter stub');\n");
    fs.writeFileSync(path.join(f.npmModules, "bedrouter", "package.json"), JSON.stringify({ name: "bedrouter", version: "0.10.0" }));
    writeExecutable(path.join(f.fakeBin, "npm"), `#!/bin/sh
if [ "$1" = root ] && [ "$2" = -g ]; then echo ${JSON.stringify(f.npmModules)}; exit 0; fi
exit 0
`);

    const runClaude = (extra) => execFileSync(process.execPath, [
      path.join(root, "install.mjs"),
      "--profile", "",
      "--agent", "claude",
      "--skip-aws",
      "--skip-probe",
      "--skip-tools",
      "--skip-cli",
      "--skip-firstmate",
      "--skip-jira",
      "--skip-dream",
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

    const out = runClaude(["--no-interrogate"]);
    assert.match(out, /\[7\] agent profiles/);
    assert.match(out, /register marketplace hablo/);
    assert.match(out, /enable plugin hablo@hablo/);
    assert.match(out, /Claude TDD skill omitted/);

    const plugin = path.join(f.home, ".hablo", "claude");
    assert.ok(fs.existsSync(path.join(plugin, ".claude-plugin", "plugin.json")));
    assert.ok(fs.existsSync(path.join(plugin, "skills", "openwiki", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(plugin, "commands", "ticket.md")));
    assert.ok(fs.existsSync(path.join(plugin, "agents", "implementer.md")));
    assert.ok(fs.existsSync(path.join(plugin, "agents", "software-architect.md")));
    assert.match(fs.readFileSync(path.join(plugin, "agents", "software-architect.md"), "utf8"), /^model: opus$/m);
    assert.match(fs.readFileSync(path.join(plugin, "agents", "implementer.md"), "utf8"), /^model: sonnet$/m);
    const hook = fs.readFileSync(path.join(plugin, "hooks", "start-bedrouter.mjs"), "utf8");
    assert.match(hook, /20129/);
    assert.doesNotMatch(hook, /__BEDROUTER_PORT__/);
    assert.ok(fs.existsSync(path.join(plugin, "hooks", "progress.mjs")));
    assert.ok(!fs.existsSync(path.join(plugin, "skills", "technical-design-doc")));

    const settings = JSON.parse(fs.readFileSync(path.join(f.home, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings.extraKnownMarketplaces.hablo, { source: { source: "directory", path: plugin } });
    assert.equal(settings.enabledPlugins["hablo@hablo"], true);

    runClaude(["--interrogate"]);
    assert.ok(fs.existsSync(path.join(plugin, "skills", "technical-design-doc", "SKILL.md")));
    assert.match(fs.readFileSync(path.join(plugin, "skills", "technical-design-doc", "SKILL.md"), "utf8"), /HABLO overlay/);

    runClaude(["--no-interrogate"]);
    assert.ok(!fs.existsSync(path.join(plugin, "skills", "technical-design-doc")));
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 0 installs and disables tone policy while appending receipt runs", () => {
  const f = fixture();
  try {
    const installOutput = install(f);
    const captain = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.match(captain, /HABLO:TONE-POLICY:START/);
    assert.match(captain, /HABLO:BRANCH-POLICY:START/);
    assert.match(captain, /HABLO:OPENWIKI-POLICY:START/);
    assert.match(captain, /HABLO:TICKET-POLICY:START/);
    assert.match(captain, /HABLO:MODEL-POLICY:START/);
    assert.doesNotMatch(captain, /HABLO:INTERROGATE-POLICY/);
    assert.match(captain, /no `--project` flag/);
    assert.ok(fs.existsSync(path.join(f.agentDir, "skills", "technical-design-doc", "SKILL.md")), installOutput);
    assert.match(fs.readFileSync(path.join(f.agentDir, "skills", "technical-design-doc", "SKILL.md"), "utf8"), /HABLO overlay/);
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "interrogate", "adr-template.md")));
    const iqRuntime = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "interrogate.json"), "utf8"));
    assert.equal(iqRuntime.enabled, false);
    assert.match(captain, /fm-brief\.sh <task-id> <repo-name>/);
    assert.match(captain, /Jira key is an exact string/);
    assert.match(captain, /not\*\* a Jira project/);
    assert.match(captain, /config\/brief-include\.md/);
    const briefInclude = fs.readFileSync(path.join(f.firstmate, "config", "brief-include.md"), "utf8");
    assert.match(briefInclude, /HABLO:BRIEF-INCLUDE:START/);
    assert.match(briefInclude, /hablo-jira pr-opened --key <JIRA-KEY> --pr/);
    assert.match(briefInclude, /hablo-jira progress --key <JIRA-KEY> --commit/);
    assert.doesNotMatch(briefInclude, /Delivery contract: mode=/);
    assert.match(fs.readFileSync(path.join(f.home, ".hablo", "tone.md"), "utf8"), /HABLO:TONE-RULE:START/);
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-tone.ts")));
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-crewmate.ts")));
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-progress.ts")));
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-preflight")));
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-fleet-reset")));
    const bedrouterShim = fs.readFileSync(path.join(f.home, ".local", "bin", "bedrouter"), "utf8");
    assert.match(bedrouterShim, /HABLO-installer/);
    assert.match(bedrouterShim, /BEDROUTER_CONFIG/);
    assert.match(bedrouterShim, /\.bedrouter/);
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "hablo-preflight")));
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "hablo-captain.ts")));
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "hablo-fleet-status.mjs")));
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-jira")), installOutput);
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-jira-agent")), installOutput);
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-dream")), installOutput);
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-config")), installOutput);
    const configPrint = execFileSync(path.join(f.home, ".local", "bin", "hablo-config"), ["--print"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home, PATH: `${path.join(f.home, ".local", "bin")}:${f.fakeBin}:${process.env.PATH}` },
    });
    assert.match(configPrint, /hablo-config status/);
    assert.match(configPrint, /agent/);
    const habloHelp = execFileSync("bash", [path.join(f.home, ".local", "bin", "hablo"), "--help"], {
      encoding: "utf8",
      env: { ...process.env, HOME: f.home },
    });
    assert.match(habloHelp, /hablo config/);
    const dreamConfig = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "dream", "config.json"), "utf8"));
    assert.equal(dreamConfig.enabled, true);
    assert.equal(dreamConfig.model, "bedrouter/auto");
    assert.equal(dreamConfig.home, path.join(f.home, ".hablo", "dream"));
    const jiraConfig = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "jira", "config.json"), "utf8"));
    assert.equal(jiraConfig.enabled, true);
    assert.equal(jiraConfig.agent.enabled, true);
    assert.equal(fs.statSync(path.join(f.home, ".hablo", "jira", ".env")).mode & 0o777, 0o600);

    const firstReceipt = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "receipt.json"), "utf8"));
    assert.equal(fs.statSync(path.join(f.home, ".hablo", "receipt.json")).mode & 0o777, 0o600);
    assert.equal(firstReceipt.version, 1);
    assert.equal(firstReceipt.runs.length, 1);
    assert.ok(firstReceipt.runs[0].actions.length > 0);
    assert.ok(firstReceipt.runs[0].actions.every((action) => action.kind.includes("package") || action.kind.startsWith("git.") || action.kind.startsWith("symlink.") || action.wasPresent !== undefined || action.sha256));
    assert.ok(firstReceipt.runs[0].actions.some((action) => action.kind === "json.append" && action.key === "enabledModels"));
    assert.ok(firstReceipt.runs[0].actions.some((action) => action.kind === "json.set" && action.key === "theme" && action.prior === null && action.priorPresent === false));
    assert.ok(firstReceipt.runs[0].actions.some((action) => action.kind === "json.set" && action.path === "~/.pi/agent/pi-bedrouter.json" && action.priorPresent === false));
    assert.ok(firstReceipt.runs[0].actions.some((action) => action.kind === "block.insert" && action.marker === "HABLO:TONE-POLICY"));

    execFileSync(process.execPath, [path.join(root, "install.mjs"), "backup", "--to", f.dir], {
      env: { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: `${f.fakeBin}:${process.env.PATH}` },
    });
    const archive = fs.readdirSync(f.dir).find((name) => name.startsWith("hablo-backup-") && name.endsWith(".tgz"));
    assert.ok(archive);
    const archiveEntries = execFileSync("tar", ["-tzf", path.join(f.dir, archive)], { encoding: "utf8" });
    assert.match(archiveEntries, /\.hablo\/tone\.md/);
    assert.match(archiveEntries, /\.pi\/agent\/extensions\/hablo-tone\.ts/);
    assert.match(archiveEntries, /\.hablo\/dream\/config\.json/);
    assert.doesNotMatch(archiveEntries, /\.hablo\/receipt\.json/);

    install(f, ["--nautical"]);
    const plainOff = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.doesNotMatch(plainOff, /HABLO:TONE-POLICY/);
    assert.match(plainOff, /HABLO:BRANCH-POLICY:START/);
    assert.match(plainOff, /HABLO:OPENWIKI-POLICY:START/);
    assert.equal(fs.existsSync(path.join(f.home, ".hablo", "tone.md")), false);
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-tone.ts")), "the inert global extension stays installed");

    const secondReceipt = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "receipt.json"), "utf8"));
    assert.equal(secondReceipt.runs.length, 2);
    assert.ok(secondReceipt.runs[1].actions.some((action) => action.kind === "block.remove" && action.marker === "HABLO:TONE-POLICY"));
    assert.ok(secondReceipt.runs[1].actions.some((action) => action.kind === "file.remove" && action.path === "~/.hablo/tone.md"));
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("interrogate flag installs captain policy and keeps skill pin", () => {
  const f = fixture();
  try {
    install(f, ["--interrogate"]);
    const captain = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.match(captain, /HABLO:INTERROGATE-POLICY:START/);
    assert.match(captain, /skip interrogate/);
    assert.match(captain, /~\/tdds/);
    const iq = JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "interrogate.json"), "utf8"));
    assert.equal(iq.enabled, true);
    assert.ok(fs.existsSync(path.join(f.agentDir, "skills", "technical-design-doc", "SKILL.md")));
    install(f, ["--no-interrogate"]);
    const off = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.doesNotMatch(off, /HABLO:INTERROGATE-POLICY/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.home, ".hablo", "interrogate.json"), "utf8")).enabled, false);
    // Soft-keep: skill remains after toggle off.
    assert.ok(fs.existsSync(path.join(f.agentDir, "skills", "technical-design-doc", "SKILL.md")));
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("dry-run creates no receipt or tone artifacts", () => {
  const f = fixture();
  try {
    install(f, ["--dry-run"]);
    assert.equal(fs.existsSync(path.join(f.home, ".hablo", "receipt.json")), false);
    assert.equal(fs.existsSync(path.join(f.home, ".hablo", "tone.md")), false);
    assert.equal(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-tone.ts")), false);
    assert.equal(fs.existsSync(path.join(f.home, ".hablo", "jira")), false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("migrates ladder config and stale auto-oss settings to the stack", () => {
  const f = fixture();
  try {
    const brHome = path.join(f.home, ".bedrouter");
    fs.mkdirSync(brHome, { recursive: true });
    fs.writeFileSync(path.join(brHome, "bedrouter.json"), JSON.stringify({ families: { openai: [] } }));
    fs.writeFileSync(path.join(f.agentDir, "pi-bedrouter.json"), JSON.stringify({ autoSelect: "auto-oss", home: brHome }));
    const settingsPath = path.join(f.agentDir, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    settings.enabledModels.push("bedrouter/auto-oss");
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    fs.writeFileSync(path.join(f.agentDir, "workflows.json"), JSON.stringify({ models: { "bedrouter/auto-oss": "old", "openai/test": "keep" } }));

    install(f, ["--home", brHome]);

    const migrated = JSON.parse(fs.readFileSync(path.join(brHome, "bedrouter.json"), "utf8"));
    assert.deepEqual(migrated.stack, manifest.bedrouter.stack);
    assert.ok(fs.readdirSync(brHome).some((name) => name.startsWith("bedrouter.json.pre-stack-")));
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(f.agentDir, "pi-bedrouter.json"), "utf8")), "autoSelect"), false);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, "utf8")).enabledModels.includes("bedrouter/auto-oss"), false);
    const notes = JSON.parse(fs.readFileSync(path.join(f.agentDir, "workflows.json"), "utf8")).models;
    assert.equal(Object.hasOwn(notes, "bedrouter/auto-oss"), false);
    assert.equal(notes["openai/test"], "keep");
    assert.match(notes["bedrouter/auto"], /DEFAULT/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Claude firstmate install writes harness, Claude dispatch, permission mode, and captain prompt", () => {
  const f = fixture();
  try {
    const brPkg = path.join(f.npmModules, "bedrouter", "dist");
    fs.mkdirSync(brPkg, { recursive: true });
    fs.writeFileSync(path.join(brPkg, "cli.js"), "#!/usr/bin/env node\n");
    fs.writeFileSync(path.join(f.npmModules, "bedrouter", "package.json"), JSON.stringify({ name: "bedrouter", version: "0.10.0" }));
    writeExecutable(path.join(f.fakeBin, "npm"), `#!/bin/sh
if [ "$1" = root ] && [ "$2" = -g ]; then echo ${JSON.stringify(f.npmModules)}; exit 0; fi
exit 0
`);

    const out = install(f, ["--agent", "claude", "--skip-jira", "--skip-dream", "--skip-tools"]);
    assert.match(out, /crew harness already claude|write .*crew-harness.*= claude/);
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "crew-harness"), "utf8").trim(), "claude");
    assert.equal(fs.readFileSync(path.join(f.firstmate, "config", "claude-permission-mode"), "utf8").trim(), "auto");
    const dispatch = fs.readFileSync(path.join(f.firstmate, "config", "crew-dispatch.json"), "utf8");
    assert.match(dispatch, /"harness": "claude"/);
    assert.match(dispatch, /HABLO-installer/);
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "crew-dispatch-claude.json")));
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "crew-dispatch-pi.json")));
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "hablo-captain-prompt.sh")));
    assert.equal(fs.statSync(path.join(f.home, ".hablo", "hablo-captain-prompt.sh")).mode & 0o111, 0o111);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("hablo Claude branch launches claude with append-system-prompt; missing claude refuses Pi", () => {
  const f = fixture();
  try {
    install(f);
    fs.writeFileSync(path.join(f.home, ".hablo", "agent"), "claude\n");
    fs.writeFileSync(path.join(f.firstmate, "config", "crew-harness"), "claude\n");
    // Ensure prompt script is present (install with default agent=pi still installs it).
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "hablo-captain-prompt.sh")));

    const calls = path.join(f.dir, "claude-call.txt");
    writeExecutable(path.join(f.fakeBin, "claude"), `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(calls)}
printf 'PWD=%s\\n' "$(pwd -P)" >> ${JSON.stringify(calls)}
`);
    // Poison pi so a silent fallback would be visible.
    writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh
echo "pi should not run" >&2
exit 99
`);

    const project = path.join(f.dir, "project");
    fs.mkdirSync(project, { recursive: true });
    execFileSync("git", ["init", "--quiet", project]);
    fs.writeFileSync(path.join(f.firstmate, "AGENTS.md"), "# firstmate\n\nRun bin/fm-brief.sh.\n");

    const ok = spawnSync(path.join(f.home, ".local", "bin", "hablo"), [], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: f.home,
        PATH: `${f.fakeBin}:${process.env.PATH}`,
        HABLO_PREFLIGHT: "skip",
        HABLO_HERDR_STAMP: "0",
      },
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /agent\s+claude/);
    const call = fs.readFileSync(calls, "utf8");
    assert.match(call, /--append-system-prompt/);
    assert.match(call, /--model/);
    assert.doesNotMatch(call, /--provider/);
    assert.match(call, /firstmate captain/);
    assert.match(call, /fm-brief\.sh/);

    fs.unlinkSync(path.join(f.fakeBin, "claude"));
    const missing = spawnSync(path.join(f.home, ".local", "bin", "hablo"), [], {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: f.home,
        // Isolate from a real host Claude install under ~/.local/bin.
        PATH: `${f.fakeBin}:/usr/bin:/bin`,
        HABLO_PREFLIGHT: "skip",
        HABLO_HERDR_STAMP: "0",
      },
    });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Claude Code is not on PATH/);
    assert.match(missing.stderr, /Refusing to fall back to Pi/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("hablo resolves one captain/crew model and refuses an ambiguous bare model", () => {
  const f = fixture();
  try {
    install(f);
    const external = runInstalledHablo(f, ["--provider", "openai-codex", "--model", "gpt-5.3-codex"]);
    assert.equal(external.status, 0);
    assert.match(external.call, /^openai-codex\/gpt-5\.3-codex/m);
    assert.match(external.call, /--provider\nopenai-codex\n--model\ngpt-5\.3-codex/);

    const ambiguous = runInstalledHablo(f, ["--model", "gpt-5.3-codex"]);
    assert.equal(ambiguous.status, 2);
    assert.match(ambiguous.stderr, /has no provider/);
    assert.equal(ambiguous.call, "");

    const full = runInstalledHablo(f, ["--model", "openai-codex/gpt-5.3-codex"]);
    assert.equal(full.status, 0);
    assert.match(full.call, /^openai-codex\/gpt-5\.3-codex/m);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("hablo remembers the project and recovers from a non-git cwd without pinning a repo name", () => {
  const f = fixture();
  try {
    install(f);
    const fromRepo = runInstalledHablo(f);
    assert.equal(fromRepo.status, 0, fromRepo.stderr);
    const project = fs.realpathSync(path.join(f.dir, "project"));
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "last-project"), "utf8").trim(), project);
    assert.match(fromRepo.call, new RegExp(`^PWD=${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));

    const home = f.home;
    const fromHome = runInstalledHablo(f, [], {}, { cwd: home });
    assert.equal(fromHome.status, 0, fromHome.stderr);
    assert.match(fromHome.stderr + fromHome.stdout, /last-project/);
    assert.match(fromHome.call, new RegExp(`^PWD=${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));

    const other = path.join(f.dir, "other-repo");
    fs.mkdirSync(other, { recursive: true });
    execFileSync("git", ["init", "--quiet", other]);
    const viaArg = runInstalledHablo(f, [other], {}, { cwd: home });
    assert.equal(viaArg.status, 0, viaArg.stderr);
    assert.equal(fs.readFileSync(path.join(f.home, ".hablo", "last-project"), "utf8").trim(), fs.realpathSync(other));

    const cfg = path.join(f.home, ".config", "herdr", "config.toml");
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, "onboarding = false\n\n[ui]\nstatus_indicators = \"symbols\"\n");
    writeExecutable(path.join(f.fakeBin, "herdr"), "#!/bin/sh\nexit 0\n");
    const stamped = runInstalledHablo(f, [], { HABLO_HERDR_STAMP: "1", HERDR_CONFIG: cfg }, { cwd: project });
    assert.equal(stamped.status, 0, stamped.stderr);
    const toml = fs.readFileSync(cfg, "utf8");
    assert.match(toml, /\[terminal\]/);
    assert.match(toml, new RegExp(`new_cwd = ${JSON.stringify(project).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(toml, /status_indicators = "symbols"/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

// A captain that cannot see which extensions loaded checks with `ps aux`, gets a guaranteed false negative because
// Pi runs extensions in-process, and then invents a launcher to restart Pi with. HABLO_PI_EXTENSIONS is what
// hablo-captain.ts reads to say so in the preamble, so it must list exactly the files that got an -e flag.
test("hablo reports the supervision extensions it loaded, and stays quiet about ones it did not", () => {
  const f = fixture();
  try {
    install(f);
    const ext = path.join(f.firstmate, ".pi", "extensions");
    fs.mkdirSync(ext, { recursive: true });
    // hablo resolves FM_ROOT with `pwd -P`, and on macOS the temp dir is a symlink into /private.
    const real = path.join(fs.realpathSync(f.firstmate), ".pi", "extensions");
    fs.writeFileSync(path.join(ext, "fm-primary-pi-watch.ts"), "");
    fs.writeFileSync(path.join(ext, "fm-calm.ts"), "");

    const run = runInstalledHablo(f);
    assert.equal(run.status, 0);
    const reported = run.call.match(/^HABLO_PI_EXTENSIONS=(.*)$/m)[1].split(" ").filter(Boolean);
    assert.deepEqual(reported, [path.join(real, "fm-primary-pi-watch.ts"), path.join(real, "fm-calm.ts")]);
    for (const p of reported) assert.match(run.call, new RegExp(`^-e\\n${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
    assert.ok(!run.call.includes("fm-primary-turnend-guard.ts"), run.call);

    // Nothing on disk: the export must be empty, not the string "missing", and hablo must still launch.
    fs.rmSync(ext, { recursive: true, force: true });
    const bare = runInstalledHablo(f);
    assert.equal(bare.status, 0);
    assert.match(bare.call, /^HABLO_PI_EXTENSIONS=$/m);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 plans safely, folds receipt runs, and reverts through a settings symlink", () => {
  const f = fixture();
  try {
    install(f);
    install(f, ["--cli-model", "opus"]);
    fs.writeFileSync(path.join(f.firstmate, ".gitignore"), "config/\ndata/\nprojects/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: f.firstmate });
    execFileSync("git", ["config", "user.name", "Wave 5 Test"], { cwd: f.firstmate });
    execFileSync("git", ["config", "user.email", "wave5@example.invalid"], { cwd: f.firstmate });
    execFileSync("git", ["add", ".gitignore", "AGENTS.md"], { cwd: f.firstmate });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: f.firstmate });
    const receiptPath = path.join(f.home, ".hablo", "receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    receipt.runs.at(-1).actions.push({ kind: "git.clone", path: f.firstmate, repo: "fixture" });
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    const clonePlan = uninstall(f, ["--with-firstmate", "--no-backup"]);
    assert.match(clonePlan, /branch .* has no upstream/);
    const settingsPath = path.join(f.agentDir, "settings.json");
    const dotfiles = path.join(f.home, ".dotfiles", "pi", "settings.json");
    fs.mkdirSync(path.dirname(dotfiles), { recursive: true });
    fs.renameSync(settingsPath, dotfiles);
    fs.symlinkSync(dotfiles, settingsPath);
    fs.appendFileSync(path.join(f.firstmate, "data", "captain.md"), "\nKeep this personal line.\n");

    const wrapper = path.join(f.home, ".local", "bin", "hablo");
    const beforePlan = fs.readFileSync(wrapper, "utf8");
    const plan = uninstall(f, ["--no-backup"]);
    assert.match(plan, /Plan only/);
    assert.equal(fs.readFileSync(wrapper, "utf8"), beforePlan);

    const output = uninstall(f, ["--yes", "--no-backup"]);
    assert.match(output, /Leftovers:/);
    assert.equal(fs.existsSync(wrapper), false, "latest installed hash owns the rewritten wrapper");
    assert.equal(fs.lstatSync(settingsPath).isSymbolicLink(), true, "settings symlink must survive");
    const settings = JSON.parse(fs.readFileSync(dotfiles, "utf8"));
    assert.deepEqual(settings, { packages: manifest.pi.packages, enabledModels: ["openai/test"] });
    const captain = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.doesNotMatch(captain, /HABLO:[A-Z-]+:START/);
    assert.match(captain, /Keep this personal line/);
    assert.ok(fs.existsSync(path.join(f.home, ".hablo", "jira", "config.json")), "state stays outside --with-state");
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 backs up state and preserves a changed credential file", () => {
  const f = fixture();
  try {
    install(f);
    const env = path.join(f.home, ".hablo", "jira", ".env");
    fs.writeFileSync(env, "JIRA_API_TOKEN=personal\n");
    const output = uninstall(f, ["--yes", "--with-state"]);
    assert.match(output, /Backed up to/);
    assert.ok(fs.readdirSync(f.home).some((name) => /^hablo-backup-.*\.tgz$/.test(name)));
    assert.equal(fs.readFileSync(env, "utf8"), "JIRA_API_TOKEN=personal\n");
    assert.equal(fs.existsSync(path.join(f.home, ".hablo", "dream")), false);
    assert.equal(fs.existsSync(path.join(f.home, ".bedrouter")), false);
    assert.match(output, /changed since install; kept/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 inferred uninstall requires both flags and only removes marked files", () => {
  const f = fixture();
  try {
    const bin = path.join(f.home, ".local", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "hablo"), "# managed by HABLO-installer\n");
    assert.throws(() => uninstall(f, ["--yes", "--no-backup"]), /receipt not found/);
    const plan = uninstall(f, ["--infer", "--no-backup"]);
    assert.match(plan, /INFERRED/);
    assert.ok(fs.existsSync(path.join(bin, "hablo")));
    uninstall(f, ["--yes", "--infer", "--no-backup"]);
    assert.equal(fs.existsSync(path.join(bin, "hablo")), false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 compacts old receipt runs without losing baseline actions", () => {
  const f = fixture();
  try {
    const receiptPath = path.join(f.home, ".hablo", "receipt.json");
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    const runs = Array.from({ length: 50 }, (_, i) => ({ at: new Date(2026, 0, i + 1).toISOString(), installer: "fixture", argv: [], actions: [{ kind: "json.set", path: "~/.pi/agent/settings.json", key: `old.${i}`, value: i, prior: null, priorPresent: false }] }));
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs }));
    install(f, ["--skip-jira", "--skip-dream", "--skip-cli", "--skip-firstmate"]);
    const compacted = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    assert.equal(compacted.runs.length, 50);
    assert.match(compacted.runs[0].installer, /compacted uninstall baseline/);
    assert.equal(compacted.runs[0].actions.length, 2);
    assert.equal(compacted.runs[0].actions[0].key, "old.0");
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 service shutdown is idempotent when the unit is not loaded", () => {
  const f = fixture();
  try {
    const plist = path.join(f.home, "Library", "LaunchAgents", "dev.hablo.test.plist");
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    const body = "<!-- managed by HABLO -->\n";
    fs.writeFileSync(plist, body);
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    const receiptPath = path.join(f.home, ".hablo", "receipt.json");
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs: [{ at: new Date().toISOString(), actions: [{ kind: "file.create", path: "~/Library/LaunchAgents/dev.hablo.test.plist", sha256: hash }, { kind: "service.load", name: "dev.hablo.test", path: "~/Library/LaunchAgents/dev.hablo.test.plist" }] }] }));
    writeExecutable(path.join(f.fakeBin, "launchctl"), "#!/bin/sh\nexit 3\n");
    uninstall(f, ["--yes", "--no-backup"]);
    assert.equal(fs.existsSync(plist), false);
    assert.doesNotThrow(() => uninstall(f, ["--yes", "--no-backup"]));
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 never unlinks read-only or dangling settings symlinks", () => {
  for (const mode of ["readonly", "dangling"]) {
    const f = fixture();
    try {
      const settings = path.join(f.agentDir, "settings.json"), target = path.join(f.home, ".dotfiles", "settings.json");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(settings, target);
      fs.symlinkSync(target, settings);
      const installed = JSON.parse(fs.readFileSync(target, "utf8")); installed.theme = "dark"; fs.writeFileSync(target, JSON.stringify(installed, null, 2) + "\n");
      const current = fs.readFileSync(target, "utf8"), hash = crypto.createHash("sha256").update(current).digest("hex");
      const receiptPath = path.join(f.home, ".hablo", "receipt.json");
      fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
      fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs: [{ actions: [{ kind: "file.create", path: "~/.pi/agent/settings.json", sha256: hash }, { kind: "json.set", path: "~/.pi/agent/settings.json", key: "theme", value: "dark", prior: null, priorPresent: false }] }] }));
      if (mode === "readonly") fs.chmodSync(target, 0o444); else fs.unlinkSync(target);
      const output = uninstall(f, ["--yes", "--no-backup"]);
      assert.equal(fs.lstatSync(settings).isSymbolicLink(), true);
      assert.match(output, mode === "readonly" ? /restore JSON.*EACCES|restore JSON.*permission denied/i : /cannot parse JSON/);
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test("Wave 5 prunes only broken hablo runtime symlinks and reports registry entries", () => {
  const f = fixture();
  try {
    const fm = path.join(f.home, "firstmate"), projects = path.join(fm, "projects"), data = path.join(fm, "data"), liveTarget = path.join(f.dir, "live-project");
    fs.mkdirSync(projects, { recursive: true }); fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(liveTarget);
    fs.symlinkSync(path.join(f.dir, "missing-project"), path.join(projects, "broken"));
    fs.symlinkSync(liveTarget, path.join(projects, "live"));
    fs.writeFileSync(path.join(data, "projects.md"), "- live [direct-PR] - /tmp/live (added 2026-09-13, via hablo)\n");
    fs.mkdirSync(path.join(f.home, ".hablo"), { recursive: true });
    fs.writeFileSync(path.join(f.home, ".hablo", "receipt.json"), JSON.stringify({ version: 1, runs: [] }));
    const output = uninstall(f, ["--yes", "--no-backup"]);
    assert.equal(fs.existsSync(path.join(projects, "broken")), false);
    assert.equal(fs.lstatSync(path.join(projects, "live")).isSymbolicLink(), true);
    assert.match(output, /live hablo project symlink; kept/);
    assert.match(output, /registry entry kept/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 global and Pi scopes remove only receipt-owned installations", () => {
  const f = fixture();
  try {
    const calls = path.join(f.dir, "uninstall-calls"), bin = path.join(f.home, ".local", "bin");
    fs.mkdirSync(bin, { recursive: true }); fs.writeFileSync(path.join(bin, "treehouse"), "owned");
    writeExecutable(path.join(f.fakeBin, "npm"), `#!/bin/sh\nprintf 'npm %s\n' "$*" >> ${JSON.stringify(calls)}\n`);
    writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh\nprintf 'pi %s\n' "$*" >> ${JSON.stringify(calls)}\n`);
    const receiptPath = path.join(f.home, ".hablo", "receipt.json"); fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs: [{ actions: [
      { kind: "npm.global", name: "gh-axi", wasPresent: false },
      { kind: "npm.global", name: "quota-axi", wasPresent: true },
      { kind: "script.install", name: "treehouse", wasPresent: false },
      { kind: "pi.package", name: "npm:pi-bedrouter", wasListed: false },
      { kind: "pi.package", name: "npm:user-package", wasListed: true },
      { kind: "pi.cli", name: "@earendil-works/pi-coding-agent", manager: "pi.dev", source: "https://pi.dev/install.sh", wasPresent: false }
    ] }] }));
    const managedRoot = path.join(f.agentDir, "install");
    const launcher = path.join(f.agentDir, "bin", "pi");
    fs.mkdirSync(path.join(managedRoot, "releases"), { recursive: true });
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(path.join(managedRoot, "managed-install.json"), JSON.stringify({
      kind: "pi-managed-install", schemaVersion: 1, layout: "releases-v1",
      entrypoint: { type: "symlink", path: path.join(bin, "pi") },
    }));
    fs.writeFileSync(launcher, "#!/bin/sh\n");
    fs.symlinkSync(launcher, path.join(bin, "pi"));
    const allPlan = uninstall(f, ["--all", "--no-backup"]);
    assert.match(allPlan, /uninstall global npm package gh-axi/);
    assert.match(allPlan, /remove Pi package npm:pi-bedrouter/);
    assert.match(allPlan, /uninstall managed Pi CLI/);
    const output = uninstall(f, ["--yes", "--with-globals", "--remove-pi", "--no-backup"]);
    const invoked = fs.readFileSync(calls, "utf8");
    assert.match(invoked, /npm uninstall -g gh-axi/);
    assert.match(invoked, /pi remove npm:pi-bedrouter/);
    assert.doesNotMatch(invoked, /npm uninstall -g @earendil-works\/pi-coding-agent/);
    assert.doesNotMatch(invoked, /quota-axi|user-package/);
    assert.equal(fs.existsSync(path.join(bin, "treehouse")), false);
    assert.equal(fs.existsSync(managedRoot), false);
    assert.equal(fs.existsSync(launcher), false);
    assert.equal(fs.existsSync(path.join(bin, "pi")), false);
    assert.match(output, /quota-axi: was present before HABLO; kept/);
    assert.match(output, /npm:user-package: listed before HABLO; kept/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 still uninstalls legacy npm-global Pi CLI receipts", () => {
  const f = fixture();
  try {
    const calls = path.join(f.dir, "uninstall-calls");
    writeExecutable(path.join(f.fakeBin, "npm"), `#!/bin/sh\nprintf 'npm %s\n' "$*" >> ${JSON.stringify(calls)}\n`);
    const receiptPath = path.join(f.home, ".hablo", "receipt.json");
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs: [{ actions: [
      { kind: "pi.cli", name: "@earendil-works/pi-coding-agent", manager: "npm", wasPresent: false },
    ] }] }));
    uninstall(f, ["--yes", "--remove-pi", "--no-backup"]);
    assert.match(fs.readFileSync(calls, "utf8"), /npm uninstall -g @earendil-works\/pi-coding-agent/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("Wave 5 accepts a pushed detached firstmate clone and rejects a branch without upstream", () => {
  const f = fixture();
  try {
    const remote = path.join(f.dir, "remote.git"), seed = path.join(f.dir, "seed"), fm = path.join(f.home, "firstmate");
    execFileSync("git", ["init", "--bare", "--quiet", remote]);
    execFileSync("git", ["init", "--quiet", seed]);
    execFileSync("git", ["config", "user.name", "Wave 5 Test"], { cwd: seed }); execFileSync("git", ["config", "user.email", "wave5@example.invalid"], { cwd: seed });
    fs.writeFileSync(path.join(seed, "README.md"), "fixture\n"); execFileSync("git", ["add", "README.md"], { cwd: seed }); execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: seed });
    execFileSync("git", ["branch", "-M", "main"], { cwd: seed }); execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed }); execFileSync("git", ["push", "--quiet", "-u", "origin", "main"], { cwd: seed }); execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remote });
    execFileSync("git", ["clone", "--quiet", remote, fm]); execFileSync("git", ["switch", "--detach", "--quiet"], { cwd: fm });
    const receiptPath = path.join(f.home, ".hablo", "receipt.json"); fs.mkdirSync(path.dirname(receiptPath), { recursive: true }); fs.writeFileSync(receiptPath, JSON.stringify({ version: 1, runs: [{ actions: [{ kind: "git.clone", path: "~/firstmate", repo: remote }] }] }));
    assert.match(uninstall(f, ["--with-firstmate", "--no-backup"]), /remove firstmate clone/);
    execFileSync("git", ["switch", "-c", "local-only", "--quiet"], { cwd: fm });
    assert.match(uninstall(f, ["--with-firstmate", "--no-backup"]), /branch local-only has no upstream/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("team stats stay off until the manifest or a flag names a repository", () => {
  const f = fixture();
  try {
    const brHome = path.join(f.home, ".bedrouter");
    const out = install(f, ["--home", brHome, "--skip-jira", "--skip-dream", "--skip-cli", "--skip-firstmate"]);
    const cfg = JSON.parse(fs.readFileSync(path.join(brHome, "bedrouter.json"), "utf8"));
    assert.equal(Object.hasOwn(cfg, "publish"), false, "no publish block means nothing can leave the machine");
    assert.match(out, /publish: off/);
    // The dashboard baseline is a shared value and travels with the stack.
    assert.equal(Object.hasOwn(cfg.routing, "baselineAlias"), true);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a named stats repository renders the publish block and says what leaves the machine", () => {
  const f = fixture();
  try {
    const brHome = path.join(f.home, ".bedrouter");
    const out = install(f, ["--home", brHome, "--publish-repo", "acme/bedrouter-stats", "--publish-cred", "env",
      "--skip-jira", "--skip-dream", "--skip-cli", "--skip-firstmate"]);
    const cfg = JSON.parse(fs.readFileSync(path.join(brHome, "bedrouter.json"), "utf8"));
    assert.deepEqual(cfg.publish, { enabled: true, repo: "acme/bedrouter-stats", branch: "main", intervalMs: 3600000, credential: "env" });
    // The token is the personal half and must never be rendered into the shared config.
    assert.equal(JSON.stringify(cfg).includes("BEDROUTER_PUBLISH_TOKEN"), false);
    assert.match(out, /data\/<your-github-login>\/<date>\.json/);
    assert.match(out, /turn it off with --skip-publish/);

    // --skip-publish wins over the repository, and the block is removed again on the next run.
    install(f, ["--home", brHome, "--publish-repo", "acme/bedrouter-stats", "--skip-publish",
      "--skip-jira", "--skip-dream", "--skip-cli", "--skip-firstmate"]);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(brHome, "bedrouter.json"), "utf8")), "publish"), false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("an unattended run is never asked about the credential", () => {
  const f = fixture();
  try {
    const brHome = path.join(f.home, ".bedrouter");
    // stdin is not a TTY here, which is exactly the unattended case: it must take the default and continue.
    const out = install(f, ["--home", brHome, "--publish-repo", "acme/bedrouter-stats",
      "--skip-jira", "--skip-dream", "--skip-cli", "--skip-firstmate"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(brHome, "bedrouter.json"), "utf8")).publish.credential, "auto");
    assert.equal(/Use it to publish team stats/.test(out), false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("an installed package off its pin is moved to it, one at its pin is left alone", () => {
  const f = fixture();
  const calls = path.join(f.dir, "pi-calls");
  writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh\n[ "\${1:-}" = --version ] && echo 'pi test'\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`);
  const pkgJson = path.join(f.npmModules, "pi-bedrouter", "package.json");

  install(f);
  assert.ok(!(fs.existsSync(calls) && /^(install|update) /m.test(fs.readFileSync(calls, "utf8"))), "a package at its pin must not be touched");

  const pin = manifest.pi.packages.find((p) => p.startsWith("npm:pi-bedrouter@"));
  fs.writeFileSync(pkgJson, JSON.stringify({ name: "pi-bedrouter", version: "0.6.0" }));
  // The fake pi installs nothing, so the version check after the install must stop the run.
  assert.throws(() => install(f, ["--skip-cli"]), (e) => /pi-bedrouter is 0\.6\.0 after pi install; this release pins/.test(e.stderr));
  assert.match(fs.readFileSync(calls, "utf8"), new RegExp(`^install ${pin.replace(/[.]/g, "\\.")}$`, "m"));
});

test("a required prerequisite stops the install before anything is written", () => {
  const f = fixture();
  writeExecutable(path.join(f.fakeBin, "aws"), "#!/bin/sh\necho 'aws-cli/1.29.0 Python/3.11'\n");
  const env = { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: `${f.fakeBin}:${process.env.PATH}`, NO_COLOR: "1" };
  const check = (...a) => { try { return { status: 0, out: execFileSync(process.execPath, [path.join(root, "install.mjs"), ...a], { encoding: "utf8", env }) }; } catch (e) { return { status: e.status, out: `${e.stdout}${e.stderr}` }; } };

  const r = check("--profile", "bedrouter", "--skip-tools", "--firstmate-dir", f.firstmate);
  assert.equal(r.status, 1);
  assert.match(r.out, /\[ \] AWS CLI v2 \(found v1 at [^)]*\)\s+required/);
  assert.match(r.out, /\d+ required prerequisite\(s\) missing/);
  assert.equal(fs.existsSync(path.join(f.home, ".hablo")), false, "nothing may be written when a required prerequisite is missing");

  // Without the AWS step, v1 is only advisory (fake npm reports engines this Node satisfies).
  assert.equal(check("check", "--profile", "").status, 0);
});

test("update plans the move to the newest release tag and refuses a dirty checkout", () => {
  const f = fixture();
  const g = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const src = path.join(f.dir, "src");
  fs.cpSync(root, src, { recursive: true, filter: (p) => !/\/(\.git|node_modules)(\/|$)/.test(p.slice(root.length)) });
  g(f.dir, "init", "--quiet", src);
  g(src, "add", "-A"); g(src, "commit", "--quiet", "-m", "one"); g(src, "tag", "v0.1.0");
  const manifestPath = path.join(src, "hablo.json");
  fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, "utf8").replace(/"npm:pi-bedrouter@[^"]+"/, '"npm:pi-bedrouter@9.9.9"'));
  g(src, "commit", "--quiet", "-am", "two"); g(src, "tag", "v0.2.0");
  g(f.dir, "clone", "--quiet", "--bare", src, path.join(f.dir, "origin.git"));
  const work = path.join(f.dir, "work");
  g(f.dir, "clone", "--quiet", path.join(f.dir, "origin.git"), work);
  g(work, "checkout", "--quiet", "v0.1.0");

  const update = (...a) => {
    try { return { status: 0, out: execFileSync(process.execPath, [path.join(work, "install.mjs"), "update", ...a], { encoding: "utf8", env: { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir }, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { status: e.status, out: `${e.stdout}${e.stderr}` }; }
  };
  const plan = update("--check");
  assert.equal(plan.status, 0, plan.out);
  assert.match(plan.out, /v0\.1\.0 -> v0\.2\.0/);
  assert.match(plan.out, /pi-bedrouter {2}\S+ -> 9\.9\.9/);
  assert.equal(g(work, "describe", "--tags").trim(), "v0.1.0", "--check must not move the checkout");

  fs.writeFileSync(path.join(work, "stray.txt"), "x");
  assert.match(update("--check").out, /has uncommitted changes/);
  fs.rmSync(path.join(work, "stray.txt"));

  g(work, "checkout", "--quiet", "v0.2.0");
  assert.match(update("--check").out, /up to date: v0\.2\.0/);
});

test("Jira credential check accepts export-prefixed secrets files", () => {
  const f = fixture();
  try {
    const env = {
      ...process.env,
      HOME: f.home,
      PI_CODING_AGENT_DIR: f.agentDir,
      PATH: `${f.fakeBin}:${process.env.PATH}`,
      NO_COLOR: "1",
    };
    const check = () => {
      try { return execFileSync(process.execPath, [path.join(root, "install.mjs"), "check", "--profile", "", "--skip-tools"], { encoding: "utf8", env }); }
      catch (e) { return `${e.stdout}${e.stderr}`; }
    };
    assert.match(check(), /\[ \] Jira credentials \(missing JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN\)/);

    const secrets = path.join(f.home, ".config", "secrets", "JIRA");
    fs.mkdirSync(path.dirname(secrets), { recursive: true });
    fs.writeFileSync(secrets, "export JIRA_URL=https://x.atlassian.net\nexport JIRA_EMAIL=e@example.com\nexport JIRA_API_TOKEN=token\n", { mode: 0o600 });
    assert.match(check(), /\[x\] Jira credentials(?:\s|$)/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("on apt, the fix block batches safe packages and sends AWS CLI and Go elsewhere", () => {
  const f = fixture();
  // Only node and which besides the fakes, so git, curl, tmux and jq are all missing whatever the host has.
  fs.symlinkSync(process.execPath, path.join(f.fakeBin, "node"));
  fs.symlinkSync(execFileSync("/bin/sh", ["-c", "command -v which"], { encoding: "utf8" }).trim(), path.join(f.fakeBin, "which"));
  writeExecutable(path.join(f.fakeBin, "aws"), "#!/bin/sh\necho 'aws-cli/1.22.34 Python/3.10'\n");
  writeExecutable(path.join(f.fakeBin, "go"), "#!/bin/sh\necho 'go version go1.19.8 linux/amd64'\n");
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(root, "install.mjs"), "check", "--profile", "bedrouter", "--skip-tools"], {
      encoding: "utf8",
      env: { HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: f.fakeBin, HABLO_PLATFORM: "linux/apt", NO_COLOR: "1" },
    });
  } catch (e) { out = `${e.stdout}${e.stderr}`; }
  const block = out.slice(out.indexOf("To fix, run these in order"));
  // curl is skipped as a tool here (--skip-tools), so it and unzip arrive only because the AWS CLI fix runs them.
  assert.match(block, /^ {4}sudo apt install -y (?=.*\bgit\b)(?=.*\btmux\b)(?=.*\bjq\b)(?=.*\bcurl\b)(?=.*\bunzip\b).*$/m, "safe packages go in one apt line");
  assert.doesNotMatch(block, /apt install -y .*\b(awscli|golang-go|nodejs)\b/, "apt must never be offered for AWS CLI, Go, or Node");
  assert.match(out, /AWS CLI v2 \(found v1 at .*\)\s+required\n\s+fix: not the apt package \(apt and dnf ship AWS CLI v1/);
  assert.match(block, /awscli-exe-linux-\$\(uname -m\)\.zip/);
  assert.match(out, /Go 1\.22\+ .*\(found 1\.19\.8 at .*\)/);
  assert.match(block, /go\.dev\/doc\/install/);
});
