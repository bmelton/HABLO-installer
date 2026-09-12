#!/usr/bin/env node
// HABLO installer: configures Pi + bedrouter + OpenWiki on a machine, idempotently, from hablo.json.
// Zero dependencies. Node 20+ to run; Node 22+ is required for OpenWiki itself (checked, not enforced).
//
//   node install.mjs backup [--to <dir>] [--with-history]   archive auth + trust (+ config; + sessions/caches/logs with the flag)
//   node install.mjs --profile <aws-profile> [--restore <tgz>] [--ladder claude|oss] [--dry-run] [--optional] [--default-model]
//                    [--skip-aws] [--skip-probe] [--skip-agents] [--force-agents] [--home <dir>]
//                    [--skip-firstmate] [--firstmate-dir <dir>] [--backend tmux|herdr] [--no-branch-policy]
//                    [--install-pi] [--pi-manager npm|bun|pnpm]   install the Pi CLI itself when it is missing
//
// Steps (each prints what it did or would do):
//   0 restore     with --restore <tgz>: put personal state back (never overwrites an existing file unless --force-restore)
//   1 preflight   node, pi (installed globally with --install-pi when missing), aws, git; openwiki (advisory)
//   2 packages    pi install npm:<pkg> for anything not yet in settings.json packages
//   3 settings    enabledModels += bedrouter/*; a few UX settings; optional default model
//   4 bedrouter   ~/.pi/agent/pi-bedrouter.json, ~/.bedrouter/.env and bedrouter.json (from the installed example)
//   5 aws         profile present? -> aws sso login; absent -> run `aws configure sso --profile <p>` (interactive)
//   6 probe       bedrouter doctor --probe; swap unentitled rungs for fallbacks from the manifest, drop the rest
//   7 agents      agent profiles + workflows into ~/.pi (never overwrites without --force-agents)
//   8 fit notes   pi-agents model notes into ~/.pi/agent/workflows.json
//   9 firstmate   clone/update kunchenguid/firstmate; crew harness = pi; crew-dispatch.json routing every crewmate
//                 through bedrouter; captain.md branch-per-Jira-ticket policy; optional config/backend (--backend herdr)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "hablo.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const DRY = flag("dry-run");
const home = os.homedir();
const expand = (p) => p.replace(/^~(?=$|\/)/, home);
const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(home, ".pi", "agent");
const piDir = path.dirname(agentDir);
const brHome = expand(opt("home", manifest.bedrouter.home));
const ladderName = opt("ladder", "claude");
const ladder = manifest.bedrouter.ladders[ladderName];
if (!ladder) fail(`unknown --ladder ${ladderName}; choose one of ${Object.keys(manifest.bedrouter.ladders).join(", ")}`);
const profile = opt("profile", process.env.AWS_PROFILE ?? "");
const stamp = () => new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

const log = (s) => console.log(s);
const step = (n, title) => log(`\n[${n}] ${title}`);
const did = (s) => log(`  ${DRY ? "would " : ""}${s}`);
const note = (s) => log(`  ${s}`);
function fail(msg) { console.error(`\nERROR: ${msg}`); process.exit(1); }
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
function writeJson(p, obj) { if (DRY) return; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); }
function writeText(p, text) { if (DRY) return; fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
const which = (cmd) => { const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim().split("\n")[0] : undefined; };
const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: "utf8", stdio: o.inherit ? "inherit" : "pipe", cwd: o.cwd, env: { ...process.env, ...o.env }, timeout: o.timeout ?? 300_000 });
const semverGte = (v, min) => Number(String(v).replace(/^v/, "").split(".")[0]) >= min;

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
  for (const p of dangling) { did(`remove dangling symlink ${path.relative(home, p)} -> ${fs.readlinkSync(p)}`); if (!DRY) fs.unlinkSync(p); }
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
const owBin = which("openwiki");
note(owBin ? `openwiki ${owBin}` : `openwiki not installed (optional):  npm install -g ${manifest.openwiki.npmPackage}   (Node ${manifest.openwiki.minNode}+)`);

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
  }
}
settings = readJson(settingsPath, settings); // pi install rewrites it

// ---- 3 settings -------------------------------------------------------------------------------------------------
step(3, "pi settings");
// Only extend an allowlist that already exists: creating one would hide every non-bedrouter provider.
if (Array.isArray(settings.enabledModels)) {
  const enabled = new Set(settings.enabledModels);
  const before = enabled.size;
  for (const m of manifest.pi.enabledModels) enabled.add(m);
  if (enabled.size !== before) { settings.enabledModels = [...enabled]; did(`enabledModels += ${enabled.size - before} bedrouter models`); } else note("enabledModels already include bedrouter/*");
} else note("no enabledModels allowlist: all providers (bedrouter included) are visible; leaving it that way");
try { if (fs.lstatSync(settingsPath).isSymbolicLink()) note(`settings.json is a symlink (${fs.readlinkSync(settingsPath)}): dotfiles-managed; writing through the link`); } catch { /* no file yet */ }
for (const [k, v] of Object.entries(manifest.pi.settings)) if (settings[k] === undefined) { settings[k] = v; did(`settings.${k} = ${JSON.stringify(v)}`); }
if (flag("default-model")) { settings.defaultProvider = "bedrouter"; settings.defaultModel = ladder.autoSelect; did(`default model = bedrouter/${ladder.autoSelect}`); }
writeJson(settingsPath, settings);

// ---- 4 bedrouter -------------------------------------------------------------------------------------------------
step(4, "bedrouter");
const pbPath = path.join(agentDir, "pi-bedrouter.json");
const pb = readJson(pbPath, {});
const pbNext = { ...pb, home: opt("home", manifest.bedrouter.home), port: manifest.bedrouter.port, autoSelect: ladder.autoSelect, debug: pb.debug ?? false, stopOnExit: pb.stopOnExit ?? "if-started-here" };
delete pbNext.path; // the binary comes from the npm dependency
if (JSON.stringify(pb) !== JSON.stringify(pbNext)) { writeJson(pbPath, pbNext); did(`write ${pbPath} (autoSelect ${ladder.autoSelect}, home ${pbNext.home})`); } else note(`${pbPath} up to date`);

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
    writeText(envPath, next); did(`set AWS_PROFILE=${profile} in ${envPath}`);
  } else note(`${envPath} present`);
}
const cfgPath = path.join(brHome, "bedrouter.json");
let cfg = readJson(cfgPath, null);
if (!cfg) {
  const example = readJson(path.join(brPkg, "bedrouter.example.json"), null) ?? readJson(path.join(here, "bedrouter.example.json"), null);
  if (!example) fail(`no bedrouter.example.json found under ${brPkg}`);
  cfg = example;
  cfg.routing = { ...cfg.routing, ...manifest.bedrouter.routing, classifier: { ...cfg.routing.classifier, ...manifest.bedrouter.routing.classifier } };
  writeJson(cfgPath, cfg);
  did(`write ${cfgPath} from the package example (honorClientModel ${cfg.routing.honorClientModel}, classifier ${cfg.routing.classifier.model})`);
} else note(`${cfgPath} present (${Object.entries(cfg.families).map(([f, r]) => `${f}: ${r.map((x) => x.alias).join(" > ")}`).join("; ")})`);

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
    if (!DRY) { const r = run("aws", ["configure", "sso", "--profile", profile], { inherit: true, timeout: 600_000 }); if (r.status !== 0) fail("aws configure sso did not complete"); }
  } else note(`profile "${profile}" found in ~/.aws/config`);
  const who = run("aws", ["sts", "get-caller-identity", "--profile", profile]);
  if (who.status === 0) note(`credentials valid: ${JSON.parse(who.stdout).Arn}`);
  else {
    did(`aws sso login --profile ${profile}`);
    if (!DRY) { const r = run("aws", ["sso", "login", "--profile", profile], { inherit: true, timeout: 600_000 }); if (r.status !== 0) fail("aws sso login failed"); }
  }
}

// ---- 6 probe ----------------------------------------------------------------------------------------------------------
step(6, "entitlement probe (which rungs this account can invoke)");
if (flag("skip-probe") || DRY) note(DRY ? "skipped in dry run" : "skipped (--skip-probe)");
else {
  const probe = () => run(process.execPath, [brCli, "doctor", "--probe"], { cwd: brHome, env: { BEDROUTER_CONFIG: cfgPath }, timeout: 180_000 });
  let out = probe();
  if (!/^probe:/m.test(out.stdout ?? "")) { note((out.stdout || out.stderr || "").trim().split("\n").slice(0, 4).join("\n  ")); fail("probe did not run; fix credentials (step 5) and re-run"); }
  const denied = () => [...(out.stdout ?? "").matchAll(/^\s+DENIED\s+(\S+)\s+(\S+)/gm)].map((m) => ({ alias: m[1], id: m[2] }));
  let d = denied();
  let changed = false;
  for (let round = 0; d.length && round < 4; round++) {
    for (const { alias, id } of d) {
      const fam = Object.keys(cfg.families).find((f) => cfg.families[f].some((r) => r.alias === alias));
      const rung = cfg.families[fam].find((r) => r.alias === alias);
      const tried = (rung._tried ??= [rung.bedrockId]);
      const next = (manifest.bedrouter.fallbacks[tried[0]] ?? []).find((x) => !tried.includes(x));
      if (next) { note(`${alias}: ${rung.bedrockId} not entitled -> trying ${next}`); rung.bedrockId = next; tried.push(next); }
      else {
        note(`${alias}: not entitled and no fallback left -> dropping the rung`);
        cfg.families[fam] = cfg.families[fam].filter((r) => r.alias !== alias);
        for (const [cls, a] of Object.entries(cfg.routing.classes?.[fam] ?? {})) if (a === alias) {
          const remaining = cfg.families[fam];
          const repl = cls === "explore" ? remaining[remaining.length - 1]?.alias : remaining[0]?.alias;
          if (repl) { cfg.routing.classes[fam][cls] = repl; note(`  routing.classes.${fam}.${cls} -> ${repl}`); } else delete cfg.routing.classes[fam][cls];
        }
        for (const [k, v] of Object.entries(cfg.aliases ?? {})) if (v === alias) delete cfg.aliases[k];
        if (cfg.routing.classifier?.model === alias) cfg.routing.classifier.model = cfg.families[fam][0]?.alias ?? Object.values(cfg.families).flat()[0].alias;
      }
      changed = true;
    }
    for (const r of Object.values(cfg.families).flat()) delete r._tried;
    writeJson(cfgPath, cfg);
    out = probe();
    d = denied();
  }
  for (const r of Object.values(cfg.families).flat()) delete r._tried;
  if (changed) writeJson(cfgPath, cfg);
  const okLines = (out.stdout ?? "").split("\n").filter((l) => /^\s+(ok|DENIED)/.test(l));
  note(okLines.join("\n  ") || (out.stdout ?? "").trim());
  if (d.length) note(`still unusable: ${d.map((x) => x.alias).join(", ")} - edit ${cfgPath} by hand`);
  else note(`every rung in ${cfgPath} is entitled on this account`);
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
      if (!DRY) { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, t); }
      did(`${existed ? "overwrite" : "install"} ${path.relative(home, t)}`);
    }
  };
  copyDir(path.join(here, "pi", "agents"), path.join(agentDir, "agents"));
  copyDir(path.join(here, "pi", "workflows"), path.join(piDir, "workflows"));
}

// ---- 8 fit notes ------------------------------------------------------------------------------------------------------------
step(8, "pi-agents model notes");
const wfPath = path.join(agentDir, "workflows.json");
const wf = readJson(wfPath, {});
const notes = { ...(wf.models ?? {}) };
const fam = ladder.family;
for (const [alias, target] of Object.entries(cfg.aliases ?? {})) if (/^auto:/.test(target)) notes[`bedrouter/${alias}`] = target === `auto:${fam}` ? "DEFAULT for every node: bedrouter picks the cheapest adequate model per request and escalates on failure" : "bedrouter routes within this family; use only when the default family is unavailable";
for (const [f, rungs] of Object.entries(cfg.families)) {
  const classes = cfg.routing.classes?.[f] ?? {};
  for (const r of rungs) {
    const cls = Object.entries(classes).find(([, a]) => a === r.alias)?.[0];
    notes[`bedrouter/${r.alias}`] = cls === "explore" ? "pin only for planning, final review, reduces" : cls === "trivial" ? "pin only for titles, summaries, extraction" : "pinned rung, bypasses routing; prefer bedrouter/auto";
  }
}
if (JSON.stringify(wf.models ?? {}) !== JSON.stringify(notes)) { writeJson(wfPath, { ...wf, models: notes }); did(`write ${Object.keys(notes).length} model notes to ${wfPath}`); } else note("model notes up to date");

// ---- 9 firstmate --------------------------------------------------------------------------------------------------------------
step(9, "firstmate (kunchenguid/firstmate)");
const fm = manifest.firstmate;
const fmDir = expand(opt("firstmate-dir", fm.dir));
if (flag("skip-firstmate")) note("skipped (--skip-firstmate)");
else {
  const missing = fm.requires.filter((c) => !which(c));
  if (missing.length) note(`missing: ${missing.join(", ")} (firstmate needs git + gh for its GitHub flows and tmux as the crew runtime; brew install ${missing.join(" ")})`);
  const ghAuth = which("gh") ? run("gh", ["auth", "status"]) : null;
  if (ghAuth && ghAuth.status !== 0) note("gh is not authenticated: run `gh auth login` before the first voyage");
  if (fs.existsSync(path.join(fmDir, ".git"))) {
    did(`git -C ${fmDir} pull --ff-only`);
    if (!DRY) { const r = run("git", ["-C", fmDir, "pull", "--ff-only"]); note(r.status === 0 ? (r.stdout.trim().split("\n").pop() ?? "updated") : `pull failed (${(r.stderr || "").trim().split("\n")[0]}); left as is`); }
  } else if (fs.existsSync(fmDir)) note(`${fmDir} exists but is not a git checkout; skipping (use --firstmate-dir to pick another location)`);
  else {
    did(`git clone ${fm.repo} ${fmDir}`);
    if (!DRY) { const r = run("git", ["clone", "--quiet", fm.repo, fmDir], { inherit: true, timeout: 600_000 }); if (r.status !== 0) note("clone failed; firstmate step incomplete"); }
  }
  if (fs.existsSync(fmDir) || DRY) {
    // Crewmates inherit Pi's default model (fm-spawn.sh runs `pi -e <ext> "<brief>"` with no model flag): pin the crew
    // harness to pi and, unless --default-model was given, say what that means for routing.
    const chPath = path.join(fmDir, "config", "crew-harness");
    const cur = fs.existsSync(chPath) ? fs.readFileSync(chPath, "utf8").trim() : "";
    if (cur !== fm.crewHarness) { writeText(chPath, fm.crewHarness + "\n"); did(`write ${path.relative(home, chPath)} = ${fm.crewHarness}`); } else note(`crew harness already ${cur}`);
    // Dispatch profiles: every crewmate/scout is `pi --model bedrouter/<auto>`, explicitly, so routing does not depend on
    // Pi's default model. (When this file exists fm-spawn refuses any spawn without a resolved harness, by design.)
    const model = `bedrouter/${ladder.autoSelect}`;
    const dispatch = fs.readFileSync(path.join(here, fm.crewDispatch), "utf8").replace(/__MODEL__/g, model);
    const dispatchPath = path.join(fmDir, "config", "crew-dispatch.json");
    const curDispatch = fs.existsSync(dispatchPath) ? fs.readFileSync(dispatchPath, "utf8") : "";
    if (curDispatch !== dispatch) {
      if (curDispatch && !/HABLO-installer/.test(curDispatch)) note(`${path.relative(home, dispatchPath)} exists and was not written by this installer; leaving it (delete it to adopt the HABLO one)`);
      else { writeText(dispatchPath, dispatch); did(`write ${path.relative(home, dispatchPath)}: every crewmate -> pi + ${model}`); }
    } else note(`crew dispatch already routes every crewmate through ${model}`);
    if (!which("jq")) note("jq is required by firstmate to validate crew-dispatch.json (brew install jq)");
    // Backend
    const backend = opt("backend", fm.backend);
    if (backend) {
      const bPath = path.join(fmDir, "config", "backend");
      const curB = fs.existsSync(bPath) ? fs.readFileSync(bPath, "utf8").trim() : "";
      if (curB !== backend) { writeText(bPath, backend + "\n"); did(`write ${path.relative(home, bPath)} = ${backend}`); } else note(`backend already ${backend}`);
    }
    // Branch policy: a standing captain preference (data/captain.md is firstmate's canonical, gitignored policy file).
    if (!flag("no-branch-policy")) {
      const policy = fs.readFileSync(path.join(here, fm.captainPolicy), "utf8").trim() + "\n";
      const capPath = path.join(fmDir, "data", "captain.md");
      const cur = fs.existsSync(capPath) ? fs.readFileSync(capPath, "utf8") : "";
      const block = /<!-- HABLO:BRANCH-POLICY:START -->[\s\S]*?<!-- HABLO:BRANCH-POLICY:END -->\n?/;
      const next = block.test(cur) ? cur.replace(block, policy) : (cur ? cur.replace(/\s*$/, "\n\n") : "# Captain preferences\n\n") + policy;
      if (next !== cur) { writeText(capPath, next); did(`${cur ? "update" : "write"} ${path.relative(home, capPath)}: branch-per-Jira-ticket policy`); } else note("captain.md branch policy up to date");
    }
  }
}

// ---- done ---------------------------------------------------------------------------------------------------------------
log(`\nDone${DRY ? " (dry run; nothing written)" : ""}.`);
log(`Next:\n  pi --provider bedrouter --model ${ladder.autoSelect}\n  /bedrouter status      /bedrouter probe      /bedrouter report\n  in a repo with a wiki: /openwiki doctor${flag("skip-firstmate") ? "" : `\n  firstmate: cd ${fmDir} && pi --provider bedrouter --model ${ladder.autoSelect}       (then: ahoy!)`}`);
if (!profile) log(`  (set AWS_PROFILE in ${envPath}, then: aws sso login --profile <name>)`);
