import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(firstmate, "bin"), { recursive: true });
  fs.writeFileSync(path.join(firstmate, "AGENTS.md"), "# firstmate test manual\n");
  writeExecutable(path.join(fakeBin, "pi"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && echo 'pi test'\nexit 0\n");

  const settings = { packages: manifest.pi.packages, enabledModels: ["openai/test"] };
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
  for (const spec of manifest.pi.packages) {
    const name = spec.replace(/^npm:/, "");
    const pkgDir = path.join(agentDir, "npm", "node_modules", name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  const bedrouter = path.join(agentDir, "npm", "node_modules", "bedrouter");
  fs.mkdirSync(path.join(bedrouter, "dist"), { recursive: true });
  fs.writeFileSync(path.join(bedrouter, "dist", "cli.js"), "");
  return { dir, home, agentDir, fakeBin, firstmate };
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
    },
  });
}

function runInstalledHablo(f, args = [], env = {}) {
  const project = path.join(f.dir, "project");
  fs.mkdirSync(project, { recursive: true });
  if (!fs.existsSync(path.join(project, ".git"))) execFileSync("git", ["init", "--quiet", project]);
  const calls = path.join(f.dir, "pi-call.json");
  fs.rmSync(calls, { force: true });
  writeExecutable(path.join(f.fakeBin, "pi"), `#!/bin/sh\nprintf '%s\\n' "$HABLO_CREW_MODEL" > ${JSON.stringify(calls)}\nprintf '%s\\n' "$@" >> ${JSON.stringify(calls)}\n`);
  try {
    const stderr = execFileSync(path.join(f.home, ".local", "bin", "hablo"), args, {
      cwd: project,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: `${f.fakeBin}:${process.env.PATH}`, ...env },
    });
    return { status: 0, stdout: stderr, stderr: "", call: fs.readFileSync(calls, "utf8") };
  } catch (error) {
    return { status: error.status, stdout: error.stdout?.toString() ?? "", stderr: error.stderr?.toString() ?? "", call: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "" };
  }
}

test("Wave 0 installs and disables tone policy while appending receipt runs", () => {
  const f = fixture();
  try {
    const installOutput = install(f);
    const captain = fs.readFileSync(path.join(f.firstmate, "data", "captain.md"), "utf8");
    assert.match(captain, /HABLO:TONE-POLICY:START/);
    assert.match(captain, /HABLO:BRANCH-POLICY:START/);
    assert.match(captain, /HABLO:OPENWIKI-POLICY:START/);
    assert.match(captain, /HABLO:TICKET-POLICY:START/);
    assert.match(fs.readFileSync(path.join(f.home, ".hablo", "tone.md"), "utf8"), /HABLO:TONE-RULE:START/);
    assert.ok(fs.existsSync(path.join(f.agentDir, "extensions", "hablo-tone.ts")));
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-jira")), installOutput);
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-jira-agent")), installOutput);
    assert.ok(fs.existsSync(path.join(f.home, ".local", "bin", "hablo-dream")), installOutput);
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
