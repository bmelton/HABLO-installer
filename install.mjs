#!/usr/bin/env node
// HABLO installer: configures Pi + bedrouter + OpenWiki on a machine, idempotently, from hablo.json.
// Zero dependencies. Node 20+ to run; Node 22+ is required for OpenWiki itself (checked, not enforced).
//
//   node install.mjs backup [--to <dir>] [--with-history]   archive auth + trust (+ config; + sessions/caches/logs with the flag)
//   node install.mjs uninstall [--yes] [--with-state] [--with-globals] [--with-firstmate]
//                              [--with-services] [--remove-pi] [--all] [--no-backup] [--infer] [--receipt <path>]
//   node install.mjs [--profile <aws-profile>] [--restore <tgz>] [--dry-run] [--optional] [--default-model]
//                    (profile defaults to hablo.json; AWS_PROFILE in the environment also counts)
//                    [--skip-aws] [--skip-probe] [--skip-agents] [--force-agents] [--home <dir>]
//                    [--skip-firstmate] [--firstmate-dir <dir>] [--backend tmux|herdr] [--no-branch-policy] [--base-branch <name>]
//                    [--no-openwiki-policy] [--nautical|--no-tone-policy]
//                    [--skip-cli] [--bin-dir <dir>] [--cli-model <m>]   the `hablo` command (default ~/.local/bin) and its Pi extension
//                    [--skip-tools] [--update-tools]   firstmate's tool dependencies (treehouse, no-mistakes, *-axi)
//                    [--skip-jira|--no-tracker] [--skip-jira-agent] [--jira-agent-interval <s>]
//                    [--jira-agent-label <name>] [--no-jira-agent-service] [--jira-agent-bin-dir <dir>]
//                    [--jira-env <path>]
//                    [--skip-dream] [--dream-at HH:MM] [--no-dream-service]
//                    [--install-pi] [--pi-manager npm|bun|pnpm]   install the Pi CLI itself when it is missing
//
// Steps (each prints what it did or would do):
//   0 restore     with --restore <tgz>: put personal state back (never overwrites an existing file unless --force-restore)
//   1 preflight   node, pi (installed globally with --install-pi when missing), aws, git; openwiki (advisory)
//   2 packages    pi install npm:<pkg> for anything not yet in settings.json packages
//   3 settings    enabledModels += bedrouter/*; a few UX settings; optional default model
//   4 bedrouter   ~/.pi/agent/pi-bedrouter.json, ~/.bedrouter/.env and bedrouter.json (rendered from hablo.json)
//   5 aws         profile present? -> aws sso login; absent -> run `aws configure sso --profile <p>` (interactive)
//   6 probe       probe each rung; try fallbacks, disable unavailable rungs, reconcile discoverable capabilities
//   7 agents      agent profiles + workflows into ~/.pi (never overwrites without --force-agents)
//   8 fit notes   pi-agents model notes into ~/.pi/agent/workflows.json
//   9 firstmate   clone/update kunchenguid/firstmate; crew harness = pi; crew-dispatch.json routing every crewmate
//                 through bedrouter; captain.md branch, OpenWiki, and plain-language policies; optional config/backend
//  10 cli         `hablo`: launch a firstmate captain from any project directory (wrapper + captain/tone extensions)
//  11 tools       firstmate's tool dependencies: npm -g gh-axi chrome-devtools-axi lavish-axi tasks-axi quota-axi;
//                 treehouse and no-mistakes via their install scripts into ~/.local/bin (no sudo)
//  13 jira        build the reporting CLI and dispatch agent, render config, install and start the user scheduler
//  14 dream       build the fleet correction digest, render config, install and start its daily timer
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runUninstall } from "./uninstall.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "hablo.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DRY = flag("dry-run");
const home = os.homedir();
const expand = (p) => p.replace(/^~(?=$|\/)/, home);
const homePath = (p) => p === home ? "~" : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(home, ".pi", "agent");
const piDir = path.dirname(agentDir);
const brHome = expand(opt("home", manifest.bedrouter.home));
const defaults = manifest.defaults ?? {};
const profile = opt("profile", process.env.AWS_PROFILE ?? defaults.profile ?? "");
const toneEnabled = !flag("nautical") && !flag("no-tone-policy");
const stamp = () => new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

const log = (s) => console.log(s);
const step = (n, title) => log(`\n[${n}] ${title}`);
const did = (s) => log(`  ${DRY ? "would " : ""}${s}`);
const note = (s) => log(`  ${s}`);
function fail(msg) { console.error(`\nERROR: ${msg}`); process.exit(1); }
// Non-fatal problems in the AWS/probe steps: later steps (agents, firstmate, hablo) do not depend on them, so keep going.
const warnings = [];
function warn(msg) { warnings.push(msg); note(`WARNING: ${msg}`); }
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const readJsonText = (text, fallback = null) => { try { return JSON.parse(text); } catch { return fallback; } };
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let receipt;
let receiptRun;
const receiptPath = expand(manifest.receipt?.path ?? "~/.hablo/receipt.json");
function flushReceipt() {
  if (DRY || !receipt || !receiptRun) return;
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const tmp = `${receiptPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, receiptPath);
}
function record(action) {
  if (DRY || !receiptRun) return;
  receiptRun.actions.push(action);
  flushReceipt();
}
function recordMany(actions) { for (const action of actions) record(action); }
function fileState(p) {
  try {
    const stat = fs.lstatSync(p);
    const content = stat.isDirectory() ? undefined : fs.readFileSync(p);
    return { exists: true, sha256: content === undefined ? undefined : sha256(content) };
  } catch { return { exists: false }; }
}
function writeText(p, text, options = {}) {
  if (DRY) return;
  const prior = fileState(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  if (options.record !== false) record({
    kind: prior.exists ? "file.update" : "file.create",
    path: homePath(p),
    sha256: sha256(text),
    ...(prior.sha256 ? { priorSha256: prior.sha256 } : {}),
  });
}
function writeJson(p, obj, options) { writeText(p, JSON.stringify(obj, null, 2) + "\n", options); }
const which = (cmd) => { const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim().split("\n")[0] : undefined; };
const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: "utf8", stdio: o.inherit ? "inherit" : "pipe", cwd: o.cwd, env: { ...process.env, ...o.env }, timeout: o.timeout ?? 300_000 });
const semverGte = (v, min) => Number(String(v).replace(/^v/, "").split(".")[0]) >= min;
const versionGte = (v, min) => {
  const parts = (x) => String(x).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
  const a = parts(v), b = parts(min);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
};

if (args[0] === "uninstall") {
  try { runUninstall({ manifest, here, args: args.slice(1), home, agentDir }); }
  catch (error) { fail(error.message); }
  process.exit(0);
}

// ---- backup subcommand ------------------------------------------------------------------------------------------------
if (args[0] === "backup") {
  const to = expand(opt("to", "~"));
  const out = path.join(to, `hablo-backup-${stamp()}.tgz`);
  const sets = [...manifest.backup.essentials, ...manifest.backup.config, ...(flag("with-history") ? manifest.backup.history : [])];
  const rel = sets.filter((p) => fs.existsSync(path.join(home, p)));
  if (!rel.length) fail("nothing to back up under ~/.pi or ~/.bedrouter");
  // -h follows symlinks (settings.json etc. point into dotfiles) so the archive holds real content, not links
  const r = spawnSync("tar", ["-czhf", out, "-C", home, ...rel], { encoding: "utf8" });
  if (r.status !== 0) fail(`tar failed: ${r.stderr}`);
  const size = fs.statSync(out).size;
  log(`backed up ${rel.length} paths (${(size / 1024 / 1024).toFixed(1)} MB) to ${out}`);
  for (const p of rel) log(`  ${p}${fs.lstatSync(path.join(home, p)).isSymbolicLink() ? "  (symlink; archived its content)" : ""}`);
  log(`\nRestore later with:  node install.mjs --profile <p> --restore ${out}`);
  process.exit(0);
}

// ---- 0 restore ---------------------------------------------------------------------------------------------------------
const restoreFrom = opt("restore", "");
if (restoreFrom) {
  step(0, `restore personal state from ${restoreFrom}`);
  const tgz = expand(restoreFrom);
  if (!fs.existsSync(tgz)) fail(`no such archive: ${tgz}`);
  const list = spawnSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  if (list.status !== 0) fail(`cannot read archive: ${list.stderr}`);
  const entries = list.stdout.split("\n").filter(Boolean);
  const tops = new Set(entries.map((e) => e.replace(/\/$/, "")));
  const want = [...manifest.backup.essentials, ...manifest.backup.config, ...manifest.backup.history].filter((p) => tops.has(p) || entries.some((e) => e.startsWith(p + "/")));
  const toRestore = [];
  for (const p of want) {
    const dst = path.join(home, p);
    const exists = fs.existsSync(dst) || (() => { try { fs.lstatSync(dst); return true; } catch { return false; } })();
    if (exists && !flag("force-restore")) { note(`${p} exists here, kept (--force-restore to overwrite)`); continue; }
    toRestore.push(p);
  }
  if (toRestore.length) {
    did(`restore ${toRestore.join(", ")}`);
    if (!DRY) { const r = spawnSync("tar", ["-xzf", tgz, "-C", home, ...toRestore], { encoding: "utf8" }); if (r.status !== 0) fail(`tar extract failed: ${r.stderr}`); }
  } else note("nothing to restore (everything already present)");
}

// Start the receipt after restore: restored files belong to the backup, while everything below is install provenance.
if (!DRY) {
  receipt = readJson(receiptPath, { version: 1, runs: [] });
  if (receipt.version !== 1 || !Array.isArray(receipt.runs)) fail(`invalid receipt at ${receiptPath}`);
  const retainRuns = Math.max(2, Number(manifest.receipt?.retainRuns) || 50);
  if (receipt.runs.length >= retainRuns) {
    const foldCount = receipt.runs.length - (retainRuns - 2);
    const folded = receipt.runs.slice(0, foldCount);
    receipt.runs = [{
      at: folded[0]?.at ?? new Date(0).toISOString(),
      through: folded.at(-1)?.at,
      installer: "HABLO-installer compacted uninstall baseline",
      argv: [],
      actions: folded.flatMap((r) => Array.isArray(r.actions) ? r.actions : []),
    }, ...receipt.runs.slice(foldCount)];
  }
  const rev = run("git", ["-C", here, "rev-parse", "--short", "HEAD"]);
  const dirty = run("git", ["-C", here, "status", "--porcelain"]);
  receiptRun = {
    at: new Date().toISOString(),
    installer: `HABLO-installer@${rev.status === 0 ? rev.stdout.trim() : "unknown"}${dirty.status === 0 && dirty.stdout.trim() ? "+dirty" : ""}`,
    argv: [...args],
    actions: [],
  };
  receipt.runs.push(receiptRun);
  flushReceipt();
}

// ---- 1 preflight ---------------------------------------------------------------------------------------------
step(1, "preflight");
// Dangling symlinks under ~/.pi (a removed dotfiles package leaves settings.json -> nowhere) make Pi load nothing and
// make every write below land in a directory that no longer exists. Remove them first; the steps recreate real files.
{
  const dangling = [];
  const walk = (d, depth = 0) => {
    if (!fs.existsSync(d) || depth > 3) return;
    for (const name of fs.readdirSync(d)) {
      if (name === "npm" || name === "sessions") continue;
      const p = path.join(d, name);
      let st; try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { if (!fs.existsSync(p)) dangling.push(p); }
      else if (st.isDirectory()) walk(p, depth + 1);
    }
  };
  walk(piDir);
  for (const p of dangling) {
    const target = fs.readlinkSync(p);
    did(`remove dangling symlink ${path.relative(home, p)} -> ${target}`);
    if (!DRY) { fs.unlinkSync(p); record({ kind: "symlink.remove", path: homePath(p), target, preexisting: true }); }
  }
  if (dangling.length) note("(these pointed at a dotfiles package that no longer exists; real files are written in their place)");
}
const nodeMajor = Number(process.versions.node.split(".")[0]);
note(`node ${process.versions.node}${nodeMajor < manifest.openwiki.minNode ? `  (OpenWiki needs ${manifest.openwiki.minNode}+; pi and bedrouter are fine on 20+)` : ""}`);
let piBin = which("pi");
const cliPkg = manifest.pi.cliPackage;
if (!piBin && flag("install-pi")) {
  // npm first: on Homebrew/nvm setups its global bin dir is already on PATH. bun/pnpm work too but usually need a PATH line.
  const mgr = opt("pi-manager", ["npm", "bun", "pnpm"].find((m) => which(m)) ?? "npm");
  const cmd = { npm: ["npm", ["install", "-g", cliPkg]], bun: ["bun", ["add", "-g", cliPkg]], pnpm: ["pnpm", ["add", "-g", cliPkg]] }[mgr];
  if (!cmd) fail(`--pi-manager must be npm, bun or pnpm (got ${mgr})`);
  did(`${cmd[0]} ${cmd[1].join(" ")}`);
  if (!DRY) {
    const r = run(cmd[0], cmd[1], { inherit: true, timeout: 600_000 });
    if (r.status !== 0) fail(`${cmd[0]} could not install ${cliPkg} (exit ${r.status}); on EACCES use a user-level global prefix (nvm, or \`npm config set prefix ~/.npm-global\`)`);
    record({ kind: "pi.cli", name: cliPkg, manager: mgr, wasPresent: false });
    piBin = which("pi");
    if (!piBin) {
      // not on PATH yet: ask the manager where its global bin is, use it for this run, and say what to add permanently
      const binDir = mgr === "bun" ? (run("bun", ["pm", "bin", "-g"]).stdout?.trim() || path.join(home, ".bun", "bin"))
        : mgr === "pnpm" ? (run("pnpm", ["bin", "-g"]).stdout?.trim() || "")
        : path.join(run("npm", ["prefix", "-g"]).stdout?.trim() || "", "bin");
      const candidate = binDir && path.join(binDir, "pi");
      if (candidate && fs.existsSync(candidate)) {
        process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
        piBin = candidate;
        note(`pi installed to ${binDir}, which is not on your PATH. Using it for this run; add this to your shell rc:\n         export PATH="${binDir}:$PATH"`);
      } else fail(`${cliPkg} installed but \`pi\` is not on PATH; open a new shell or add your global bin directory to PATH, then re-run`);
    }
  }
}
if (!piBin && !DRY) fail(`pi is not installed. Re-run with --install-pi, or install it yourself:  npm install -g ${cliPkg}`);
note(piBin ? `pi   ${run("pi", ["--version"]).stdout?.trim() || piBin}` : `pi   would be installed (${cliPkg})`);
const awsBin = which("aws");
note(awsBin ? `aws  ${run("aws", ["--version"]).stdout?.trim() || awsBin}` : "aws  MISSING - install the AWS CLI (brew install awscli) before the AWS step");
note(which("git") ? "git  ok" : "git  MISSING (needed by OpenWiki freshness checks)");
const goBin = which("go");
note(goBin ? `go   ${run("go", ["version"]).stdout?.trim() || goBin}` : "go   MISSING (Jira and Dream binaries need Go 1.22+; both steps will be skipped)");
const owBin = which("openwiki");
note(owBin ? `openwiki ${owBin}` : `openwiki not installed (optional):  npm install -g ${manifest.openwiki.npmPackage}   (Node ${manifest.openwiki.minNode}+)`);
for (const [pkg, min] of Object.entries(manifest.pi.minVersions ?? {})) {
  if (pkg.startsWith("$")) continue;
  const pkgPath = path.join(agentDir, "npm", "node_modules", pkg, "package.json");
  const installedVersion = readJson(pkgPath, null)?.version;
  if (!installedVersion) note(`${pkg} not installed yet (needs >= ${min}; step 2 will install it)`);
  else if (versionGte(installedVersion, min)) note(`${pkg} ${installedVersion} (>= ${min})`);
  else note(`${pkg} ${installedVersion} (needs >= ${min} for non-bedrouter voyages; until you update, --provider on any other provider is overridden at session start)`);
}

// ---- 2 packages ------------------------------------------------------------------------------------------------
step(2, "pi packages");
const settingsPath = path.join(agentDir, "settings.json");
let settings = readJson(settingsPath, {});
const installed = new Set(settings.packages ?? []);
// Everything the manifest asks for, plus anything settings.json already lists (packages you added yourself): after a
// reinstall the list survives in settings/dotfiles but the code under ~/.pi/agent/npm does not, so honour the list.
const listedRemote = [...installed].filter((p) => /^(npm|git):/.test(p));
const wanted = [...new Set([...manifest.pi.packages, ...(flag("optional") ? manifest.pi.optionalPackages : []), ...listedRemote])];
const localPaths = [...installed].filter((p) => !/^(npm|git):/.test(p));
for (const p of localPaths) if (!fs.existsSync(path.resolve(agentDir, p))) note(`${p} is listed as a path package but the path does not exist; clone or remove it from settings.json`);
for (const pkg of wanted) {
  const bare = pkg.replace(/^npm:/, "").replace(/@[^@/]+$/, "").replace(/^git:.*\/([^/@]+?)(?:\.git)?(?:@.*)?$/, "$1");
  const listed = installed.has(pkg) || [...installed].some((p) => p.endsWith(`/${bare}`));
  // listed in settings.json but absent on disk (e.g. after a reinstall that restored settings): install anyway
  const onDisk = /^(npm|git):/.test(pkg) ? fs.existsSync(path.join(agentDir, "npm", "node_modules", bare, "package.json")) : true;
  if (listed && onDisk) { note(`${pkg} already installed`); continue; }
  if (listed && !onDisk) note(`${pkg} is listed but missing on disk; reinstalling`);
  did(`pi install ${pkg}`);
  if (!DRY) {
    const r = run("pi", ["install", pkg], { inherit: true });
    if (r.status !== 0) fail(`pi install ${pkg} failed (exit ${r.status})`);
    record({ kind: "pi.package", name: pkg, wasListed: listed, wasOnDisk: onDisk });
  }
}
settings = readJson(settingsPath, settings); // pi install rewrites it

// ---- 3 settings -------------------------------------------------------------------------------------------------
step(3, "pi settings");
const settingsExisted = fs.existsSync(settingsPath);
const settingsActions = [];
// Only extend an allowlist that already exists: creating one would hide every non-bedrouter provider.
if (Array.isArray(settings.enabledModels)) {
  const removedAutoOss = settings.enabledModels.includes("bedrouter/auto-oss");
  settings.enabledModels = settings.enabledModels.filter((m) => m !== "bedrouter/auto-oss");
  const enabled = new Set(settings.enabledModels);
  const before = enabled.size;
  for (const m of manifest.pi.enabledModels) enabled.add(m);
  if (enabled.size !== before || removedAutoOss) {
    const added = [...enabled].filter((m) => !settings.enabledModels.includes(m));
    settings.enabledModels = [...enabled];
    if (added.length) settingsActions.push({ kind: "json.append", path: homePath(settingsPath), key: "enabledModels", added });
    if (removedAutoOss) settingsActions.push({ kind: "json.remove", path: homePath(settingsPath), key: "enabledModels", removed: ["bedrouter/auto-oss"] });
    did(`refresh enabledModels (${added.length} added${removedAutoOss ? ", auto-oss removed" : ""})`);
  } else note("enabledModels already include bedrouter/*");
} else note("no enabledModels allowlist: all providers (bedrouter included) are visible; leaving it that way");
try { if (fs.lstatSync(settingsPath).isSymbolicLink()) note(`settings.json is a symlink (${fs.readlinkSync(settingsPath)}): dotfiles-managed; writing through the link`); } catch { /* no file yet */ }
for (const [k, v] of Object.entries(manifest.pi.settings)) if (settings[k] === undefined) {
  settings[k] = v;
  settingsActions.push({ kind: "json.set", path: homePath(settingsPath), key: k, value: v, prior: null, priorPresent: false });
  did(`settings.${k} = ${JSON.stringify(v)}`);
}
if (flag("default-model")) {
  for (const [key, value] of [["defaultProvider", "bedrouter"], ["defaultModel", "auto"]]) {
    if (settings[key] !== value) {
      settingsActions.push({ kind: "json.set", path: homePath(settingsPath), key, value, prior: settings[key] ?? null, priorPresent: Object.hasOwn(settings, key) });
      settings[key] = value;
    }
  }
  did("default model = bedrouter/auto");
}
if (settingsActions.length) {
  const settingsText = JSON.stringify(settings, null, 2) + "\n";
  for (const action of settingsActions) action.sha256 = sha256(settingsText);
  writeJson(settingsPath, settings, { record: false });
  if (!settingsExisted) record({ kind: "file.create", path: homePath(settingsPath), sha256: sha256(settingsText) });
  recordMany(settingsActions);
}

// ---- 4 bedrouter -------------------------------------------------------------------------------------------------
step(4, "bedrouter");
const pbPath = path.join(agentDir, "pi-bedrouter.json");
const pbExisted = fs.existsSync(pbPath);
const pb = readJson(pbPath, {});
const pbNext = { ...pb, home: opt("home", manifest.bedrouter.home), port: manifest.bedrouter.port, debug: pb.debug ?? false, stopOnExit: pb.stopOnExit ?? "if-started-here" };
delete pbNext.path; // the binary comes from the npm dependency
delete pbNext.autoSelect; // 0.6 has one auto model and no per-family selection setting
if (JSON.stringify(pb) !== JSON.stringify(pbNext)) {
  const pbText = JSON.stringify(pbNext, null, 2) + "\n";
  const actions = [];
  for (const [key, value] of Object.entries(pbNext)) if (pb[key] !== value) actions.push({ kind: "json.set", path: homePath(pbPath), key, value, prior: pb[key] ?? null, priorPresent: Object.hasOwn(pb, key), sha256: sha256(pbText) });
  if (Object.hasOwn(pb, "path")) actions.push({ kind: "json.delete", path: homePath(pbPath), key: "path", prior: pb.path, priorPresent: true, sha256: sha256(pbText) });
  if (Object.hasOwn(pb, "autoSelect")) actions.push({ kind: "json.delete", path: homePath(pbPath), key: "autoSelect", prior: pb.autoSelect, priorPresent: true, sha256: sha256(pbText) });
  writeJson(pbPath, pbNext, { record: false });
  if (!pbExisted) record({ kind: "file.create", path: homePath(pbPath), sha256: sha256(pbText) });
  recordMany(actions);
  did(`write ${pbPath} (home ${pbNext.home}; migrated away autoSelect)`);
} else note(`${pbPath} up to date`);

const brPkg = path.join(agentDir, "npm", "node_modules", "bedrouter");
const brCli = path.join(brPkg, "dist", "cli.js");
if (!fs.existsSync(brCli) && !DRY) fail(`bedrouter binary not found at ${brCli}; did pi install npm:pi-bedrouter succeed?`);
const envPath = path.join(brHome, ".env");
if (!fs.existsSync(envPath)) {
  const lines = [`AWS_REGION=${manifest.bedrouter.region}`];
  if (profile) lines.unshift(`AWS_PROFILE=${profile}`); else lines.unshift("# AWS_PROFILE=<your sso profile>   (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or AWS_BEARER_TOKEN_BEDROCK)");
  writeText(envPath, lines.join("\n") + "\n");
  did(`write ${envPath}${profile ? ` (AWS_PROFILE=${profile})` : "  <- set AWS_PROFILE"}`);
} else {
  const cur = fs.readFileSync(envPath, "utf8");
  if (profile && !new RegExp(`^AWS_PROFILE=${profile}$`, "m").test(cur)) {
    const next = /^AWS_PROFILE=/m.test(cur) ? cur.replace(/^AWS_PROFILE=.*$/m, `AWS_PROFILE=${profile}`) : `AWS_PROFILE=${profile}\n${cur}`;
    writeText(envPath, next, { record: false });
    record({ kind: "env.set", path: homePath(envPath), key: "AWS_PROFILE", value: profile, prior: cur.match(/^AWS_PROFILE=(.*)$/m)?.[1] ?? null, sha256: sha256(next) });
    did(`set AWS_PROFILE=${profile} in ${envPath}`);
  } else note(`${envPath} present`);
}
const cfgPath = path.join(brHome, "bedrouter.json");
let cfg = readJson(cfgPath, null);
if (cfg?.families) {
  const backup = `${cfgPath}.pre-stack-${stamp()}`;
  if (!DRY) {
    fs.copyFileSync(cfgPath, backup);
    record({ kind: "file.create", path: homePath(backup), sha256: sha256(fs.readFileSync(backup)) });
  }
  did(`back up legacy ladder config to ${backup}`);
  cfg = null;
}
const renderedCfg = { stack: structuredClone(manifest.bedrouter.stack), aliases: {}, routing: structuredClone(manifest.bedrouter.routing) };
if (!cfg || JSON.stringify(cfg) !== JSON.stringify(renderedCfg)) {
  cfg = renderedCfg;
  writeJson(cfgPath, cfg);
  did(`render ${cfgPath} from hablo.json (${cfg.stack.length} rungs, classifier ${cfg.routing.classifier.model})`);
} else note(`${cfgPath} present (${cfg.stack.map((r) => r.alias).join(" > ")})`);

// ---- 5 aws ----------------------------------------------------------------------------------------------------------
step(5, "aws credentials");
if (flag("skip-aws")) note("skipped (--skip-aws)");
else if (!awsBin) note("aws CLI missing; skipping. Install it, then: aws configure sso --profile <name>; aws sso login --profile <name>");
else if (!profile) note("no --profile given and AWS_PROFILE unset; skipping. Re-run with --profile <name> once `aws configure sso` has created one.");
else {
  const awsConfig = fs.existsSync(path.join(home, ".aws", "config")) ? fs.readFileSync(path.join(home, ".aws", "config"), "utf8") : "";
  const hasProfile = new RegExp(`^\\[profile ${profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m").test(awsConfig) || (profile === "default" && /^\[default\]/m.test(awsConfig));
  if (!hasProfile) {
    note(`profile "${profile}" is not in ~/.aws/config.`);
    did(`aws configure sso --profile ${profile}   (interactive: SSO start URL, region, account, role)`);
    if (!DRY) { const r = run("aws", ["configure", "sso", "--profile", profile], { inherit: true, timeout: 600_000 }); if (r.status !== 0) warn("aws configure sso did not complete; re-run the installer after `aws configure sso --profile " + profile + "`"); }
  } else note(`profile "${profile}" found in ~/.aws/config`);
  const who = run("aws", ["sts", "get-caller-identity", "--profile", profile]);
  if (who.status === 0) note(`credentials valid: ${JSON.parse(who.stdout).Arn}`);
  else {
    did(`aws sso login --profile ${profile}`);
    if (!DRY) { const r = run("aws", ["sso", "login", "--profile", profile], { inherit: true, timeout: 600_000 }); if (r.status !== 0) warn("aws sso login failed; re-run the installer after `aws sso login --profile " + profile + "`"); }
  }
}

if (!flag("skip-aws") && !DRY && awsBin && profile) {
  const form = run("aws", ["bedrock", "get-use-case-for-model-access", "--profile", profile, "--region", manifest.bedrouter.region, "--output", "json"]);
  if (form.status === 0 && readJsonText(form.stdout)?.formData) note("Anthropic first-time use form is present");
  else if (/ResourceNotFoundException|not found/i.test(`${form.stdout}\n${form.stderr}`)) {
    note("Anthropic first-time use form is missing. Complete it in the Bedrock model catalog, or create anthropic-use-case.json and run:");
    note(`aws bedrock put-use-case-for-model-access --form-data fileb://anthropic-use-case.json --profile ${profile} --region ${manifest.bedrouter.region}`);
  } else note(`Anthropic use-form check unavailable (non-fatal): ${(form.stderr || form.stdout || "unknown error").trim().split("\n")[0]}`);
}

// ---- 6 probe ----------------------------------------------------------------------------------------------------------
step(6, "entitlement probe (which rungs this account can invoke)");
if (flag("skip-probe") || DRY) note(DRY ? "skipped in dry run" : "skipped (--skip-probe)");
else probeStep();
function probeStep() {
  const probe = () => run(process.execPath, [brCli, "doctor", "--probe"], { cwd: brHome, env: { BEDROUTER_CONFIG: cfgPath }, timeout: 180_000 });
  let out = probe();
  if (!/^probe:/m.test(out.stdout ?? "")) { note((out.stdout || out.stderr || "").trim().split("\n").slice(0, 4).join("\n  ")); warn("entitlement probe did not run (no valid AWS credentials?); fix step 5 and re-run, or pass --skip-probe"); return; }
  const denied = () => [...(out.stdout ?? "").matchAll(/^\s+DENIED\s+(\S+)\s+(\S+)/gm)].map((m) => ({ alias: m[1], id: m[2] }));
  let d = denied();
  let changed = false;
  const triedByAlias = new Map();
  for (let round = 0; d.length && round < 4; round++) {
    for (const { alias } of d) {
      const rung = cfg.stack.find((r) => r.alias === alias);
      if (!rung) continue;
      const tried = triedByAlias.get(alias) ?? [rung.bedrockId];
      triedByAlias.set(alias, tried);
      const next = (manifest.bedrouter.fallbacks[tried[0]] ?? []).find((x) => !tried.includes(x));
      if (next) { note(`${alias}: ${rung.bedrockId} not entitled -> trying ${next}`); rung.bedrockId = next; tried.push(next); }
      else {
        note(`${alias}: not entitled and no fallback left -> disabling the rung`);
        rung.enabled = false;
        if (cfg.routing.classifier?.model === alias) cfg.routing.classifier.model = cfg.stack.find((r) => r.enabled && r.serves.includes("trivial"))?.alias;
      }
      changed = true;
    }
    writeJson(cfgPath, cfg);
    out = probe();
    d = denied();
  }
  for (const cls of ["trivial", "execute", "explore"]) if (!cfg.stack.some((r) => r.enabled && r.serves.includes(cls))) fail(`probe disabled the last rung serving ${cls}; enable or replace one in ${cfgPath}`);
  if (awsBin && profile) for (const rung of cfg.stack.filter((r) => r.enabled)) {
    const discoveryId = rung.bedrockId.replace(/^(us|eu|apac|global)\./, "");
    const meta = run("aws", ["bedrock", "get-foundation-model", "--model-identifier", discoveryId, "--region", manifest.bedrouter.region, "--profile", profile, "--output", "json"]);
    if (meta.status !== 0) continue;
    const details = readJsonText(meta.stdout)?.modelDetails;
    if (!details) continue;
    const discovered = { streaming: !!details.responseStreamingSupported, imageInput: (details.inputModalities ?? []).includes("IMAGE") };
    for (const [key, value] of Object.entries(discovered)) {
      if (rung.capabilities[key] !== value) warn(`${rung.alias}: manifest capabilities.${key}=${rung.capabilities[key]} contradicts Bedrock discovery (${value}); using discovered value`);
      rung.capabilities[key] = value;
    }
    changed = true;
  }
  if (changed) writeJson(cfgPath, cfg);
  const okLines = (out.stdout ?? "").split("\n").filter((l) => /^\s+(ok|DENIED)/.test(l));
  note(okLines.join("\n  ") || (out.stdout ?? "").trim());
  if (d.length) note(`still unusable: ${d.map((x) => x.alias).join(", ")} - edit ${cfgPath} by hand`);
  else note(`every enabled rung in ${cfgPath} is entitled on this account`);
}

// ---- 7 agents + workflows -------------------------------------------------------------------------------------------------
step(7, "agent profiles and workflows");
if (flag("skip-agents")) note("skipped (--skip-agents)");
else {
  const copyDir = (src, dst) => {
    if (!fs.existsSync(src)) return;
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name), t = path.join(dst, name);
      const existed = fs.existsSync(t);
      if (existed && !flag("force-agents")) { note(`${path.relative(home, t)} exists, kept (--force-agents to overwrite)`); continue; }
      if (!DRY) writeText(t, fs.readFileSync(s));
      did(`${existed ? "overwrite" : "install"} ${path.relative(home, t)}`);
    }
  };
  copyDir(path.join(here, "pi", "agents"), path.join(agentDir, "agents"));
  copyDir(path.join(here, "pi", "workflows"), path.join(piDir, "workflows"));
}

// ---- 8 fit notes ------------------------------------------------------------------------------------------------------------
step(8, "pi-agents model notes");
const wfPath = path.join(agentDir, "workflows.json");
const wfExisted = fs.existsSync(wfPath);
const wf = readJson(wfPath, {});
const notes = { ...(wf.models ?? {}) };
const noteActions = [];
delete notes["bedrouter/auto-oss"];
if (Object.hasOwn(wf.models ?? {}, "bedrouter/auto-oss")) noteActions.push({ kind: "json.delete", path: homePath(wfPath), key: "models.bedrouter/auto-oss", prior: wf.models["bedrouter/auto-oss"], priorPresent: true });
notes["bedrouter/auto"] = "DEFAULT for every node: bedrouter picks the first eligible model serving the request class and escalates on failure";
for (const r of cfg.stack.filter((r) => r.enabled)) notes[`bedrouter/${r.alias}`] = r.serves.includes("explore") ? "pin only for planning or final review; ordinary work should use bedrouter/auto" : r.serves.includes("execute") ? "pin only when a node must bypass routing; ordinary implementation should use bedrouter/auto" : "pin only for titles, summaries, or extraction";
for (const [key, value] of Object.entries(notes)) if (wf.models?.[key] !== value) noteActions.push({ kind: "json.set", path: homePath(wfPath), key: `models.${key}`, value, prior: wf.models?.[key] ?? null, priorPresent: Object.hasOwn(wf.models ?? {}, key) });
if (noteActions.length) {
  const next = { ...wf, models: notes };
  const nextText = JSON.stringify(next, null, 2) + "\n";
  for (const action of noteActions) action.sha256 = sha256(nextText);
  writeJson(wfPath, next, { record: false });
  if (!wfExisted) record({ kind: "file.create", path: homePath(wfPath), sha256: sha256(nextText) });
  recordMany(noteActions);
  did(`write ${Object.keys(notes).length} model notes to ${wfPath}`);
} else note("model notes up to date");

// ---- 9 firstmate --------------------------------------------------------------------------------------------------------------
step(9, "firstmate (kunchenguid/firstmate)");
const fm = manifest.firstmate;
const fmDir = expand(opt("firstmate-dir", fm.dir));
if (flag("skip-firstmate")) note("skipped (--skip-firstmate)");
else {
  const missing = fm.requires.filter((c) => !which(c));
  if (missing.length) note(`missing: ${missing.join(", ")} (firstmate needs git + gh for its GitHub flows and tmux as the crew runtime; brew install ${missing.join(" ")})`);
  const ghAuth = which("gh") ? run("gh", ["auth", "status"]) : null;
  if (ghAuth && ghAuth.status !== 0) note("gh is not authenticated: run `gh auth login` before the first session");
  if (fs.existsSync(path.join(fmDir, ".git"))) {
    const before = run("git", ["-C", fmDir, "rev-parse", "HEAD"]).stdout?.trim();
    did(`git -C ${fmDir} pull --ff-only`);
    if (!DRY) {
      const r = run("git", ["-C", fmDir, "pull", "--ff-only"]);
      const after = run("git", ["-C", fmDir, "rev-parse", "HEAD"]).stdout?.trim();
      if (r.status === 0 && before && after && before !== after) record({ kind: "git.update", path: homePath(fmDir), from: before, to: after });
      note(r.status === 0 ? (r.stdout.trim().split("\n").pop() ?? "updated") : `pull failed (${(r.stderr || "").trim().split("\n")[0]}); left as is`);
    }
  } else if (fs.existsSync(fmDir)) note(`${fmDir} exists but is not a git checkout; skipping (use --firstmate-dir to pick another location)`);
  else {
    did(`git clone ${fm.repo} ${fmDir}`);
    if (!DRY) {
      const r = run("git", ["clone", "--quiet", fm.repo, fmDir], { inherit: true, timeout: 600_000 });
      if (r.status !== 0) note("clone failed; firstmate step incomplete");
      else record({ kind: "git.clone", path: homePath(fmDir), repo: fm.repo });
    }
  }
  if (fs.existsSync(fmDir) || DRY) {
    // The dispatch names the Pi harness. The captain's per-voyage system-prompt block supplies the exact provider/id
    // string that firstmate passes as --model, so separate voyages never share model state on disk.
    const chPath = path.join(fmDir, "config", "crew-harness");
    const cur = fs.existsSync(chPath) ? fs.readFileSync(chPath, "utf8").trim() : "";
    if (cur !== fm.crewHarness) { writeText(chPath, fm.crewHarness + "\n"); did(`write ${path.relative(home, chPath)} = ${fm.crewHarness}`); } else note(`crew harness already ${cur}`);
    // When this file exists fm-spawn refuses any spawn without a resolved harness, by design.
    const dispatch = fs.readFileSync(path.join(here, fm.crewDispatch), "utf8");
    const dispatchPath = path.join(fmDir, "config", "crew-dispatch.json");
    const curDispatch = fs.existsSync(dispatchPath) ? fs.readFileSync(dispatchPath, "utf8") : "";
    if (curDispatch !== dispatch) {
      if (curDispatch && !/HABLO-installer/.test(curDispatch)) note(`${path.relative(home, dispatchPath)} exists and was not written by this installer; leaving it (delete it to adopt the HABLO one)`);
      else { writeText(dispatchPath, dispatch); did(`write ${path.relative(home, dispatchPath)}: every crewmate inherits the captain's provider/model through its brief`); }
    } else note("crew dispatch already inherits the captain's provider/model");
    if (!which("jq")) note("jq is required by firstmate to validate crew-dispatch.json (brew install jq)");
    // Backend
    const backend = opt("backend", fm.backend);
    if (backend) {
      const bPath = path.join(fmDir, "config", "backend");
      const curB = fs.existsSync(bPath) ? fs.readFileSync(bPath, "utf8").trim() : "";
      if (curB !== backend) { writeText(bPath, backend + "\n"); did(`write ${path.relative(home, bPath)} = ${backend}`); } else note(`backend already ${backend}`);
    }
    // Standing captain preferences (data/captain.md is firstmate's canonical, gitignored policy file): each policy is a
    // marked block, replaced in place on re-runs, never touching anything else in the file.
    const capPath = path.join(fmDir, "data", "captain.md");
    const captainBlock = (marker, text, label) => {
      const cur = fs.existsSync(capPath) ? fs.readFileSync(capPath, "utf8") : "";
      const block = new RegExp(`<!-- HABLO:${marker}:START -->[\\s\\S]*?<!-- HABLO:${marker}:END -->\\n?`);
      const prior = cur.match(block)?.[0] ?? null;
      const next = block.test(cur) ? cur.replace(block, text) : (cur ? cur.replace(/\s*$/, "\n\n") : "# Captain preferences\n\n") + text;
      if (next !== cur) {
        writeText(capPath, next, { record: false });
        record({ kind: prior ? "block.update" : "block.insert", path: homePath(capPath), marker: `HABLO:${marker}`, fileCreated: !cur, sha256: sha256(next), blockSha256: sha256(text), ...(prior ? { priorSha256: sha256(prior) } : {}) });
        did(`${cur ? "update" : "write"} ${path.relative(home, capPath)}: ${label}`);
      } else note(`captain.md ${label} up to date`);
    };
    const removeCaptainBlock = (marker, label) => {
      const cur = fs.existsSync(capPath) ? fs.readFileSync(capPath, "utf8") : "";
      const block = new RegExp(`<!-- HABLO:${marker}:START -->[\\s\\S]*?<!-- HABLO:${marker}:END -->\\n?`);
      const found = cur.match(block)?.[0];
      if (!found) { note(`captain.md ${label} absent`); return; }
      const next = cur.replace(block, "").replace(/\n{3,}/g, "\n\n");
      writeText(capPath, next, { record: false });
      record({ kind: "block.remove", path: homePath(capPath), marker: `HABLO:${marker}`, priorSha256: sha256(found), sha256: sha256(next) });
      did(`remove ${path.relative(home, capPath)}: ${label}`);
    };
    if (!flag("no-branch-policy")) {
      const base = opt("base-branch", fm.baseBranch);
      captainBlock("BRANCH-POLICY", fs.readFileSync(path.join(here, fm.captainPolicy), "utf8").replace(/__BASE__/g, base).trim() + "\n", `branch-per-Jira-ticket policy (integration branch ${base})`);
    }
    // OpenWiki: pi-openwiki-adapter is a global Pi package, so every crewmate has the tools; the policy makes the
    // captain scout with the wiki, put wiki-first instructions in every brief, and keep the wiki updated.
    if (!flag("no-openwiki-policy")) captainBlock("OPENWIKI-POLICY", fs.readFileSync(path.join(here, fm.openwikiPolicy), "utf8").trim() + "\n", "OpenWiki-first policy");
    if (!flag("no-tracker") && !flag("skip-jira")) captainBlock("TICKET-POLICY", fs.readFileSync(path.join(here, fm.ticketPolicy), "utf8").trim() + "\n", "Jira reporting policy");
    else removeCaptainBlock("TICKET-POLICY", "Jira reporting policy");
    if (toneEnabled) captainBlock("TONE-POLICY", fs.readFileSync(path.join(here, fm.tonePolicy), "utf8").trim() + "\n", "plain talk policy");
    else removeCaptainBlock("TONE-POLICY", "plain talk policy");
  }
}

// ---- 10 cli ---------------------------------------------------------------------------------------------------------------
step(10, "hablo command (firstmate from any project directory)");
const cli = manifest.cli;
const binDir = expand(opt("bin-dir", cli.binDir));
const habloHome = expand(cli.home);
if (flag("skip-cli") || flag("skip-firstmate")) note(`skipped (${flag("skip-cli") ? "--skip-cli" : "--skip-firstmate: the wrapper needs the firstmate checkout"})`);
else {
  // Copied, not symlinked: the wrapper must keep working if this installer checkout moves or goes away. The firstmate
  // location is stamped in; FM_ROOT / FM_HOME in the environment still override it.
  const installFile = (src, dst, transform, mode) => {
    const next = transform(fs.readFileSync(src, "utf8"));
    const cur = fs.existsSync(dst) ? fs.readFileSync(dst, "utf8") : null;
    if (cur === next) { note(`${path.relative(home, dst)} up to date`); return; }
    if (cur !== null && !/HABLO-installer/.test(cur)) { note(`${path.relative(home, dst)} exists and was not written by this installer; leaving it`); return; }
    writeText(dst, next);
    if (!DRY) fs.chmodSync(dst, mode);
    did(`${cur === null ? "install" : "update"} ${path.relative(home, dst)}`);
  };
  const cliModel = opt("cli-model", cli.model ?? "auto");
  installFile(path.join(here, "bin", "hablo"), path.join(binDir, "hablo"), (t) => t.replace(/__FM_ROOT__/g, fmDir).replace(/__HABLO_HOME__/g, habloHome).replace(/__PROVIDER__/g, cli.provider).replace(/__MODEL__/g, cliModel), 0o755);
  note(`hablo defaults to --provider ${cli.provider} --model ${cliModel} (HABLO_PROVIDER / HABLO_MODEL or your own flags override)`);
  installFile(path.join(here, "pi", "extensions", "hablo-captain.ts"), path.join(habloHome, "hablo-captain.ts"), (t) => t, 0o644);
  const tonePath = path.join(habloHome, "tone.md");
  if (toneEnabled) {
    const source = fs.readFileSync(path.join(here, fm.tonePolicy), "utf8");
    const inner = source.match(/<!-- HABLO:TONE-RULE:START -->[\s\S]*?<!-- HABLO:TONE-RULE:END -->/)?.[0];
    if (!inner) fail(`tone rule markers missing from ${fm.tonePolicy}`);
    const next = inner.trim() + "\n";
    const existed = fs.existsSync(tonePath);
    if (!existed || fs.readFileSync(tonePath, "utf8") !== next) { writeText(tonePath, next); did(`${existed ? "update" : "install"} ${path.relative(home, tonePath)}`); }
    else note(`${path.relative(home, tonePath)} up to date`);
  } else if (fs.existsSync(tonePath)) {
    const cur = fs.readFileSync(tonePath, "utf8");
    if (/HABLO:TONE-RULE:START/.test(cur)) {
      if (!DRY) { fs.unlinkSync(tonePath); record({ kind: "file.remove", path: homePath(tonePath), priorSha256: sha256(cur) }); }
      did(`remove ${path.relative(home, tonePath)} (${flag("nautical") ? "--nautical" : "--no-tone-policy"})`);
    } else note(`${path.relative(home, tonePath)} was not written by this installer; leaving it`);
  }
  installFile(path.join(here, "pi", "extensions", "hablo-tone.ts"), path.join(agentDir, "extensions", "hablo-tone.ts"), (t) => t, 0o644);
  const onPath = (process.env.PATH ?? "").split(path.delimiter).some((d) => d && path.resolve(expand(d)) === path.resolve(binDir));
  if (!onPath) note(`${binDir} is not on your PATH; add this to your shell rc:\n         export PATH="${binDir.replace(home, "$HOME")}:$PATH"`);
  for (const ext of ["fm-primary-turnend-guard.ts", "fm-primary-pi-watch.ts"]) if (fs.existsSync(fmDir) && !fs.existsSync(path.join(fmDir, ".pi", "extensions", ext))) note(`firstmate has no .pi/extensions/${ext} (upstream layout changed?); hablo skips missing extensions but the captain may lack supervision`);
}

// ---- 11 firstmate tools ----------------------------------------------------------------------------------------------------
step(11, "firstmate tool dependencies (treehouse, no-mistakes, *-axi)");
if (flag("skip-tools") || flag("skip-firstmate")) note(`skipped (${flag("skip-tools") ? "--skip-tools" : "--skip-firstmate"})`);
else {
  const tools = fm.tools;
  const upd = flag("update-tools");
  // Both install scripts pick ~/.local/bin when it exists and is on PATH (treehouse) or when told to (no-mistakes),
  // which keeps them sudo-free; make sure of both for the child processes.
  if (!DRY) fs.mkdirSync(binDir, { recursive: true });
  const childPath = (process.env.PATH ?? "").split(path.delimiter).includes(binDir) ? process.env.PATH : `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
  const ver = (t) => (run(t, ["--version"], { env: { PATH: childPath }, timeout: 20_000 }).stdout ?? "").trim().split("\n")[0];
  const present = (t) => !!spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8", env: { ...process.env, PATH: childPath } }).stdout.trim();
  const npmPresence = Object.fromEntries(tools.npm.map((t) => [t, present(t)]));
  const npmMissing = tools.npm.filter((t) => upd || !npmPresence[t]);
  for (const t of tools.npm.filter((t) => !npmMissing.includes(t))) note(`${t} present (${ver(t) || "version unknown"})`);
  if (npmMissing.length) {
    did(`npm install -g ${npmMissing.join(" ")}`);
    if (!DRY) {
      const r = run("npm", ["install", "-g", ...npmMissing], { inherit: true, timeout: 600_000 });
      if (r.status !== 0) warn(`npm install -g ${npmMissing.join(" ")} failed (exit ${r.status}); firstmate will report them as MISSING`);
      else for (const t of npmMissing) record({ kind: "npm.global", name: t, wasPresent: npmPresence[t] });
    }
  }
  for (const [t, url] of Object.entries(tools.scripts)) {
    if (present(t) && !upd) { note(`${t} present (${ver(t) || "version unknown"})`); continue; }
    if (!which("curl")) { warn(`curl is missing; cannot install ${t} (${url})`); continue; }
    did(`curl -fsSL ${url} | sh      (installs into ${binDir})`);
    if (!DRY) {
      const wasPresent = present(t);
      const env = { PATH: childPath, NO_MISTAKES_LINK_DIR: binDir };
      const r = spawnSync("sh", ["-c", `curl -fsSL "${url}" | sh`], { stdio: "inherit", env: { ...process.env, ...env }, timeout: 600_000 });
      if (r.status !== 0 || !present(t)) warn(`${t} install did not complete (exit ${r.status}); run it by hand:  curl -fsSL ${url} | sh`);
      else record({ kind: "script.install", name: t, source: url, wasPresent });
    }
  }
  note("(the *-axi `setup hooks` step is not run: it installs Claude Code/Codex/OpenCode session hooks, which Pi does not use)");
}

// ---- 13 Jira reporting and dispatch -------------------------------------------------------------------------------------
// launchd and systemd hand a scheduled job a minimal PATH holding none of Homebrew, ~/.local/bin, or a node version
// manager, so the Jira dispatch preflight reports tmux/pi/hablo/gh as missing on a machine whose shell finds all four,
// and Dream silently skips the same tools. Pin the directories they occupy now instead of inheriting the default.
const serviceTools = ["tmux", "pi", "hablo", "git", "gh"];
const missingServiceTools = serviceTools.filter((t) => !which(t));
const servicePath = [...new Set([
  expand(opt("jira-agent-bin-dir", manifest.cli.binDir)), expand(manifest.cli.binDir),
  ...serviceTools.map(which).filter(Boolean).map((p) => path.dirname(p)),
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
])].join(":");

step(13, "Jira reporting and labelled-ticket dispatch");
const jira = structuredClone(manifest.jira ?? {});
const jiraOff = flag("skip-jira") || flag("no-tracker") || jira.enabled === false;
if (jiraOff) note(`skipped (${flag("no-tracker") ? "--no-tracker" : flag("skip-jira") ? "--skip-jira" : "jira.enabled=false"})`);
else if (!goBin || !versionGte((run("go", ["version"]).stdout ?? "").match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? "0", "1.22.0")) warn("Jira step skipped: Go 1.22+ is required (https://go.dev/dl/)");
else {
  const jiraHome = expand(jira.home);
  const jiraBinDir = expand(opt("jira-agent-bin-dir", manifest.cli.binDir));
  const agentSkipped = flag("skip-jira-agent") || jira.agent?.enabled === false;
  if (opt("jira-agent-interval", "")) jira.agent.intervalSeconds = Number(opt("jira-agent-interval", jira.agent.intervalSeconds));
  if (opt("jira-agent-label", "")) jira.agent.labels.ready = opt("jira-agent-label", jira.agent.labels.ready);
  jira.home = jiraHome;
  jira.envFile = expand(jira.envFile);
  jira.envSource = expand(opt("jira-env", jira.envSource ?? ""));
  for (const p of Object.values(jira.projects ?? {})) {
    p.dir = expand(p.dir);
    if (!fs.existsSync(p.dir)) note(`mapped Jira repository is not cloned yet: ${p.dir}`);
  }
  const jiraHomeExisted = fs.existsSync(jiraHome);
  if (!DRY) { fs.mkdirSync(jiraBinDir, { recursive: true }); fs.mkdirSync(path.join(jiraHome, "log"), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(jiraHome, "runs"), { recursive: true, mode: 0o700 }); if (!jiraHomeExisted) record({ kind: "dir.create", path: homePath(jiraHome), wasPresent: false }); }
  const builds = [["hablo-jira", "./cmd/hablo-jira"], ...(!agentSkipped ? [[jira.agent.binName ?? "hablo-jira-agent", "./cmd/hablo-jira-agent"]] : [])];
  for (const [name, pkg] of builds) {
    const dst = path.join(jiraBinDir, name); did(`build ${dst}`);
    if (!DRY) { const prior=fileState(dst); const r = run("go", ["build", "-trimpath", "-o", dst, pkg], { cwd: path.join(here, "jira"), timeout: 600_000 }); if (r.status !== 0) { warn(`could not build ${name}: ${(r.stderr || r.stdout).trim().split("\n")[0]}`); continue; } fs.chmodSync(dst, 0o755); record({ kind: prior.exists ? "file.update" : "file.create", path: homePath(dst), sha256: sha256(fs.readFileSync(dst)), ...(prior.sha256 ? { priorSha256: prior.sha256 } : {}) }); }
  }
  writeJson(path.join(jiraHome, "config.json"), jira);
  did(`render ${path.join(jiraHome, "config.json")}`);
  const templateDst = path.join(jiraHome, "brief.tmpl.md");
  if (!fs.existsSync(templateDst) || /HABLO|Work Jira ticket/.test(fs.readFileSync(templateDst, "utf8"))) { writeText(templateDst, fs.readFileSync(path.join(here, "jira", "brief.tmpl.md"), "utf8")); did(`install ${templateDst}`); }
  else note(`${templateDst} is hand-edited; leaving it`);
  // lstat, not existsSync: a link whose target is gone must count as present, or writeText would follow it and write
  // the stub over the secret store's path.
  const envPresent = (() => { try { fs.lstatSync(jira.envFile); return true; } catch { return false; } })();
  if (envPresent) note(`${jira.envFile} already exists; leaving it`);
  else if (jira.envSource && fs.existsSync(jira.envSource)) {
    const mode = fs.statSync(jira.envSource).mode & 0o077;
    if (mode) warn(`${jira.envSource} is readable beyond your account (mode ${(fs.statSync(jira.envSource).mode & 0o777).toString(8)}); chmod 600 it`);
    // Not recorded in the receipt: uninstall never unlinks a symlink anyway, and a hash of this file would be a hash
    // of the API token.
    did(`link ${jira.envFile} -> ${jira.envSource}`);
    if (!DRY) fs.symlinkSync(jira.envSource, jira.envFile);
  } else {
    if (jira.envSource) note(`${jira.envSource} not found; writing the stub instead`);
    writeText(jira.envFile, fs.readFileSync(path.join(here, "jira", "env.example"), "utf8"));
    if (!DRY) fs.chmodSync(jira.envFile, 0o600);
    did(`create ${jira.envFile} (mode 0600)`);
  }
  if (missingServiceTools.length) warn(`dispatch preflight needs ${missingServiceTools.join(", ")} on PATH; tickets will fail until installed`);
  const agentBin = path.join(jiraBinDir, jira.agent.binName ?? "hablo-jira-agent");
  if (!agentSkipped && !flag("no-jira-agent-service")) {
    if (process.platform === "darwin") {
      const label = jira.agent.service.launchdLabel;
      const plist = path.join(home, "Library", "LaunchAgents", `${label}.plist`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- managed by HABLO -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${agentBin}</string><string>tick</string></array><key>StartInterval</key><integer>${jira.agent.intervalSeconds}</integer><key>RunAtLoad</key><true/><key>EnvironmentVariables</key><dict><key>PATH</key><string>${servicePath}</string></dict><key>StandardOutPath</key><string>${path.join(jiraHome, "log", "launchd.log")}</string><key>StandardErrorPath</key><string>${path.join(jiraHome, "log", "launchd.log")}</string></dict></plist>\n`;
      writeText(plist, xml); did(`install ${plist}`);
      if (!DRY) { run("launchctl", ["bootout", `gui/${process.getuid()}/${label}`]); const r = run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]); if (r.status !== 0) warn(`launchctl bootstrap failed: ${(r.stderr || "").trim()}`); else record({ kind: "service.load", name: label, path: homePath(plist) }); }
    } else if (process.platform === "linux") {
      const unit = jira.agent.service.systemdUnit; const userDir = path.join(home, ".config", "systemd", "user");
      writeText(path.join(userDir, `${unit}.service`), `[Unit]\nDescription=HABLO Jira agent\n[Service]\nType=oneshot\nEnvironment=PATH=${servicePath}\nExecStart=${agentBin} tick\n`);
      writeText(path.join(userDir, `${unit}.timer`), `[Unit]\nDescription=Poll Jira for HABLO work\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=${jira.agent.intervalSeconds}s\nAccuracySec=1s\n[Install]\nWantedBy=timers.target\n`);
      did(`install and enable ${unit}.timer`); if (!DRY) { run("systemctl", ["--user", "daemon-reload"]); const r=run("systemctl", ["--user", "enable", "--now", `${unit}.timer`]); if(r.status!==0)warn(`systemd timer enable failed: ${(r.stderr||"").trim()}`); else record({kind:"service.load",name:`${unit}.timer`,path:homePath(path.join(userDir,`${unit}.timer`))}); }
    }
  } else note(agentSkipped ? "dispatch agent skipped; reporting CLI installed" : "service skipped (--no-jira-agent-service)");
  const envText = fs.existsSync(jira.envFile) ? fs.readFileSync(jira.envFile, "utf8") : "";
  if (jira.envVars.every((k) => new RegExp(`^${k}=.+$`, "m").test(envText))) { if (DRY) note(`${jira.envFile} has all of ${jira.envVars.join(", ")}; would run hablo-jira doctor`); else { const r=run(path.join(jiraBinDir,"hablo-jira"),["doctor"]); note((r.stdout||r.stderr).trim()); } }
  else note("jira: not configured. Add JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN to ~/.hablo/jira/.env; create a token at https://id.atlassian.com/manage-profile/security/api-tokens");
}

// ---- 14 Dream correction digest and proposals -----------------------------------------------------------------------
step(14, "Dream correction digest and rule proposals");
const dream = structuredClone(manifest.dream ?? {});
const dreamOff = flag("skip-dream") || dream.enabled === false;
if (dreamOff) note(`skipped (${flag("skip-dream") ? "--skip-dream" : "dream.enabled=false"})`);
else if (!goBin || !versionGte((run("go", ["version"]).stdout ?? "").match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? "0", "1.22.0")) warn("Dream step skipped: Go 1.22+ is required (https://go.dev/dl/)");
else {
  const dreamHome = expand(dream.home);
  const dreamBin = path.join(binDir, "hablo-dream");
  const at = opt("dream-at", dream.service?.at ?? "03:00");
  const atMatch = /^(\d\d?):(\d\d)$/.exec(at);
  if (!atMatch || Number(atMatch[1]) > 23 || Number(atMatch[2]) > 59) fail(`--dream-at must be HH:MM (got ${at})`);
  dream.home = dreamHome;
  dream.service.at = `${atMatch[1].padStart(2, "0")}:${atMatch[2]}`;
  dream.projects = (dream.projects ?? []).map(expand);
  const existed = fs.existsSync(dreamHome);
  if (!DRY) { fs.mkdirSync(dreamHome, { recursive: true, mode: 0o700 }); fs.mkdirSync(binDir, { recursive: true }); if (!existed) record({ kind: "dir.create", path: homePath(dreamHome), wasPresent: false }); }
  did(`build ${dreamBin}`);
  if (!DRY) {
    const prior = fileState(dreamBin);
    const r = run("go", ["build", "-trimpath", "-o", dreamBin, "./cmd/hablo-dream"], { cwd: path.join(here, "dream"), timeout: 600_000 });
    if (r.status !== 0) warn(`could not build hablo-dream: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
    else { fs.chmodSync(dreamBin, 0o755); record({ kind: prior.exists ? "file.update" : "file.create", path: homePath(dreamBin), sha256: sha256(fs.readFileSync(dreamBin)), ...(prior.sha256 ? { priorSha256: prior.sha256 } : {}) }); }
  }
  writeJson(path.join(dreamHome, "config.json"), dream);
  did(`render ${path.join(dreamHome, "config.json")}`);
  if (!flag("no-dream-service")) {
    const hour = Number(atMatch[1]), minute = Number(atMatch[2]);
    if (process.platform === "darwin") {
      const label = dream.service.launchdLabel;
      const plist = path.join(home, "Library", "LaunchAgents", `${label}.plist`);
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- managed by HABLO -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${dreamBin}</string><string>run</string></array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${servicePath}</string></dict><key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict><key>StandardOutPath</key><string>${path.join(dreamHome, "service.log")}</string><key>StandardErrorPath</key><string>${path.join(dreamHome, "service.log")}</string></dict></plist>\n`;
      writeText(plist, xml); did(`install ${plist}`);
      if (!DRY) { run("launchctl", ["bootout", `gui/${process.getuid()}/${label}`]); const r = run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]); if (r.status !== 0) warn(`Dream launchctl bootstrap failed: ${(r.stderr || "").trim()}`); else record({ kind: "service.load", name: label, path: homePath(plist) }); }
    } else if (process.platform === "linux") {
      const unit = dream.service.systemdUnit, userDir = path.join(home, ".config", "systemd", "user");
      writeText(path.join(userDir, `${unit}.service`), `[Unit]\nDescription=HABLO Dream correction digest\n[Service]\nType=oneshot\nEnvironment=PATH=${servicePath}\nExecStart=${dreamBin} run\n`);
      writeText(path.join(userDir, `${unit}.timer`), `[Unit]\nDescription=Run HABLO Dream daily\n[Timer]\nOnCalendar=*-*-* ${dream.service.at}:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n`);
      did(`install and enable ${unit}.timer`); if (!DRY) { run("systemctl", ["--user", "daemon-reload"]); const r=run("systemctl", ["--user", "enable", "--now", `${unit}.timer`]); if(r.status!==0)warn(`Dream systemd timer enable failed: ${(r.stderr||"").trim()}`); else record({kind:"service.load",name:`${unit}.timer`,path:homePath(path.join(userDir,`${unit}.timer`))}); }
    }
  } else note("Dream service skipped (--no-dream-service)");
}

// ---- done ---------------------------------------------------------------------------------------------------------------
log(`\nDone${DRY ? " (dry run; nothing written)" : ""}${warnings.length ? ` with ${warnings.length} warning(s):\n  - ${warnings.join("\n  - ")}` : ""}.`);
log(`Next:\n  pi --provider bedrouter --model auto\n  /bedrouter status      /bedrouter probe      /bedrouter report\n  in a repo with a wiki: /openwiki doctor${flag("skip-firstmate") ? "" : `\n  firstmate: cd <your project> && hablo       -  or cd ${fmDir} && pi`}`);
if (!profile) log(`  (set AWS_PROFILE in ${envPath}, then: aws sso login --profile <name>)`);
