#!/usr/bin/env node
// HABLO installer: configures Pi + bedrouter + OpenWiki on a machine, idempotently, from hablo.json.
// Zero dependencies. Node 20+ to run; Node 22+ is required for OpenWiki itself (checked, not enforced).
//
//   node install.mjs --profile <aws-profile> [--ladder claude|oss] [--dry-run] [--optional] [--default-model]
//                    [--skip-aws] [--skip-probe] [--skip-agents] [--force-agents] [--home <dir>]
//
// Steps (each prints what it did or would do):
//   1 preflight   node, pi, aws, git; openwiki (advisory)
//   2 packages    pi install npm:<pkg> for anything not yet in settings.json packages
//   3 settings    enabledModels += bedrouter/*; a few UX settings; optional default model
//   4 bedrouter   ~/.pi/agent/pi-bedrouter.json, ~/.bedrouter/.env and bedrouter.json (from the installed example)
//   5 aws         profile present? -> aws sso login; absent -> run `aws configure sso --profile <p>` (interactive)
//   6 probe       bedrouter doctor --probe; swap unentitled rungs for fallbacks from the manifest, drop the rest
//   7 agents      agent profiles + workflows into ~/.pi (never overwrites without --force-agents)
//   8 fit notes   pi-agents model notes into ~/.pi/agent/workflows.json
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

// ---- 1 preflight ---------------------------------------------------------------------------------------------
step(1, "preflight");
const nodeMajor = Number(process.versions.node.split(".")[0]);
note(`node ${process.versions.node}${nodeMajor < manifest.openwiki.minNode ? `  (OpenWiki needs ${manifest.openwiki.minNode}+; pi and bedrouter are fine on 20+)` : ""}`);
const piBin = which("pi");
if (!piBin) fail("pi is not installed. Install it first:  npm install -g @earendil-works/pi-coding-agent");
note(`pi   ${run("pi", ["--version"]).stdout?.trim() || piBin}`);
const awsBin = which("aws");
note(awsBin ? `aws  ${run("aws", ["--version"]).stdout?.trim() || awsBin}` : "aws  MISSING - install the AWS CLI (brew install awscli) before the AWS step");
note(which("git") ? "git  ok" : "git  MISSING (needed by OpenWiki freshness checks)");
const owBin = which("openwiki");
note(owBin ? `openwiki ${owBin}` : `openwiki not installed (optional):  npm install -g ${manifest.openwiki.npmPackage}   (Node ${manifest.openwiki.minNode}+)`);

// ---- 2 packages ------------------------------------------------------------------------------------------------
step(2, "pi packages");
const settingsPath = path.join(agentDir, "settings.json");
let settings = readJson(settingsPath, {});
const wanted = [...manifest.pi.packages, ...(flag("optional") ? manifest.pi.optionalPackages : [])];
const installed = new Set(settings.packages ?? []);
for (const pkg of wanted) {
  const bare = pkg.replace(/^npm:/, "");
  if (installed.has(pkg) || [...installed].some((p) => p.endsWith(`/${bare}`))) { note(`${pkg} already listed`); continue; }
  did(`pi install ${pkg}`);
  if (!DRY) {
    const r = run("pi", ["install", pkg], { inherit: true });
    if (r.status !== 0) fail(`pi install ${pkg} failed (exit ${r.status})`);
  }
}
settings = readJson(settingsPath, settings); // pi install rewrites it

// ---- 3 settings -------------------------------------------------------------------------------------------------
step(3, "pi settings");
const enabled = new Set(settings.enabledModels ?? []);
const before = enabled.size;
for (const m of manifest.pi.enabledModels) enabled.add(m);
if (enabled.size !== before || !settings.enabledModels) { settings.enabledModels = [...enabled]; did(`enabledModels += ${enabled.size - before} bedrouter models`); } else note("enabledModels already include bedrouter/*");
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

// ---- done ---------------------------------------------------------------------------------------------------------------
log(`\nDone${DRY ? " (dry run; nothing written)" : ""}.`);
log(`Next:\n  pi --provider bedrouter --model ${ladder.autoSelect}\n  /bedrouter status      /bedrouter probe      /bedrouter report\n  in a repo with a wiki: /openwiki doctor`);
if (!profile) log(`  (set AWS_PROFILE in ${envPath}, then: aws sso login --profile <name>)`);
