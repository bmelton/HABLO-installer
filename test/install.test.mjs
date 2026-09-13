import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function uninstall(f, extra = []) {
  return execFileSync(process.execPath, [path.join(root, "install.mjs"), "uninstall", ...extra], {
    encoding: "utf8",
    env: { ...process.env, HOME: f.home, PI_CODING_AGENT_DIR: f.agentDir, PATH: `${f.fakeBin}:${process.env.PATH}` },
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
      { kind: "pi.cli", name: "@earendil-works/pi-coding-agent", manager: "npm", wasPresent: false }
    ] }] }));
    const allPlan = uninstall(f, ["--all", "--no-backup"]);
    assert.match(allPlan, /uninstall global npm package gh-axi/);
    assert.match(allPlan, /remove Pi package npm:pi-bedrouter/);
    const output = uninstall(f, ["--yes", "--with-globals", "--remove-pi", "--no-backup"]);
    const invoked = fs.readFileSync(calls, "utf8");
    assert.match(invoked, /npm uninstall -g gh-axi/);
    assert.match(invoked, /pi remove npm:pi-bedrouter/);
    assert.match(invoked, /npm uninstall -g @earendil-works\/pi-coding-agent/);
    assert.doesNotMatch(invoked, /quota-axi|user-package/);
    assert.equal(fs.existsSync(path.join(bin, "treehouse")), false);
    assert.match(output, /quota-axi: was present before HABLO; kept/);
    assert.match(output, /npm:user-package: listed before HABLO; kept/);
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
