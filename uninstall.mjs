import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: "utf8", stdio: options.inherit ? "inherit" : "pipe", cwd: options.cwd, env: process.env, timeout: options.timeout ?? 300_000 });
const valueAt = (obj, dotted) => dotted.split(".").reduce((v, k) => v && typeof v === "object" ? v[k] : undefined, obj);
const hasAt = (obj, dotted) => { const parts=dotted.split("."); let v=obj; for(const k of parts){if(!v||typeof v!=="object"||!Object.hasOwn(v,k))return false;v=v[k]}return true; };
function setAt(obj, dotted, value, present) { const parts=dotted.split("."); let v=obj; for(const k of parts.slice(0,-1)){if(!v[k]||typeof v[k]!=="object"||Array.isArray(v[k]))v[k]={};v=v[k]} const key=parts.at(-1); if(present)v[key]=value;else delete v[key]; }
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function parse(args, manifest, home) {
  const valued=new Set(["receipt"]), known=new Set(["yes","infer","no-backup","with-state","with-globals","with-firstmate","with-services","remove-pi","all","receipt"]);
  for(let i=0;i<args.length;i++){const raw=args[i];if(!raw.startsWith("--")||!known.has(raw.slice(2)))throw new Error(`unknown uninstall option ${raw}`);if(valued.has(raw.slice(2))){if(!args[i+1]||args[i+1].startsWith("--"))throw new Error(`${raw} requires a value`);i++;}}
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n,d) => { const i=args.indexOf(`--${n}`); return i>=0&&args[i+1]&&!args[i+1].startsWith("--")?args[i+1]:d; };
  const all=flag("all");
  return { yes:flag("yes"), infer:flag("infer"), noBackup:flag("no-backup"), withState:all||flag("with-state"), withGlobals:all||flag("with-globals"), withFirstmate:all||flag("with-firstmate"), withServices:true, removePi:all||flag("remove-pi"), all, receipt:opt("receipt",manifest.receipt?.path??"~/.hablo/receipt.json").replace(/^~(?=$|\/)/,home) };
}

function validateDeleteTarget(p, home, extraRoots=[]) {
  const abs=path.resolve(p), h=path.resolve(home);
  const allowed=abs.startsWith(h+path.sep)||extraRoots.some((root)=>{const r=path.resolve(root);return abs===r||abs.startsWith(r+path.sep)});
  if(abs===h||abs===path.parse(abs).root||!allowed) throw new Error(`refusing unsafe removal target ${p}`);
  return abs;
}

function inferActions(ctx) {
  const {manifest,home,agentDir}=ctx, out=[];
  const expand=(p)=>p.replace(/^~(?=$|\/)/,home);
  const candidates=[
    path.join(expand(manifest.cli.binDir),"hablo"), path.join(expand(manifest.cli.home),"hablo-captain.ts"), path.join(expand(manifest.cli.home),"tone.md"),
    path.join(agentDir,"extensions","hablo-tone.ts"), path.join(agentDir,"extensions","hablo-guard.ts"), path.join(expand(manifest.cli.binDir),"hablo-guard"),
    path.join(expand(manifest.cli.binDir),"hablo-jira"), path.join(expand(manifest.cli.binDir),"hablo-jira-agent"), path.join(expand(manifest.cli.binDir),"hablo-dream"),
    path.join(expand(manifest.jira?.home??"~/.hablo/jira"),"config.json"), path.join(expand(manifest.dream?.home??"~/.hablo/dream"),"config.json")
  ];
  for(const p of candidates){if(!exists(p)||fs.lstatSync(p).isDirectory())continue;let b;try{b=fs.readFileSync(p)}catch{continue}if(b.includes(Buffer.from("HABLO-installer")))out.push({kind:"file.create",path:ctx.homePath(p),sha256:sha256(b),inferred:true});}
  const cap=path.join(expand(manifest.firstmate.dir),"data","captain.md");if(exists(cap)){const text=fs.readFileSync(cap,"utf8");for(const m of text.matchAll(/<!-- (HABLO:[A-Z-]+):START -->/g))out.push({kind:"block.insert",path:ctx.homePath(cap),marker:m[1],inferred:true});}
  return out;
}

function backup(ctx, withHistory) {
  const receiptRel=path.relative(ctx.home,ctx.opts.receipt), receiptEntry=receiptRel!==".."&&!receiptRel.startsWith(`..${path.sep}`)?[receiptRel]:[];
  const sets=[...ctx.manifest.backup.essentials,...ctx.manifest.backup.config,...(withHistory?ctx.manifest.backup.history:[]),...receiptEntry];
  const rel=[...new Set(sets)].filter((p)=>exists(path.join(ctx.home,p)));
  if(!rel.length)return null;
  const stamp=new Date().toISOString().replace(/[:T]/g,"-").slice(0,16), out=path.join(ctx.home,`hablo-backup-${stamp}.tgz`);
  const r=run("tar",["-czhf",out,"-C",ctx.home,...rel]);if(r.status!==0)throw new Error(`backup failed: ${(r.stderr||"").trim()}`);return out;
}

function firstmateSafety(dir) {
  const reasons=[];
  if(!exists(path.join(dir,".git")))return [`${dir}: not a git checkout`];
  const status=run("git",["status","--porcelain","--untracked-files=all"],{cwd:dir});if(status.status!==0)return [`${dir}: git status failed`];
  for(const line of status.stdout.trim().split("\n").filter(Boolean))reasons.push(`${dir}: uncommitted ${line}`);
  const refs=run("git",["for-each-ref","--format=%(refname:short)|%(upstream:short)","refs/heads"],{cwd:dir});
  for(const line of refs.stdout.trim().split("\n").filter(Boolean)){const [branch,upstream]=line.split("|");if(!upstream)reasons.push(`${dir}: branch ${branch} has no upstream`);else{const ahead=run("git",["rev-list","--count",`${upstream}..${branch}`],{cwd:dir});if(ahead.status!==0||Number(ahead.stdout.trim())>0)reasons.push(`${dir}: branch ${branch} has ${ahead.stdout.trim()||"unknown"} unpushed commit(s)`);}}
  const symbolic=run("git",["symbolic-ref","-q","HEAD"],{cwd:dir});if(symbolic.status!==0){const contained=run("git",["branch","-r","--contains","HEAD"],{cwd:dir});if(contained.status!==0||!contained.stdout.trim())reasons.push(`${dir}: detached HEAD is not contained in a remote branch`);}
  const committed=run("git",["show","-s","--format=%ct","HEAD"],{cwd:dir}), cutoff=Number(committed.stdout.trim())*1000, data=path.join(dir,"data");
  const scan=(d)=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,ent.name);if(ent.isDirectory())scan(p);else if(ent.isFile()){try{if(fs.statSync(p).mtimeMs>cutoff)reasons.push(`${dir}: data file newer than HEAD: ${path.relative(dir,p)}`)}catch{}}}};
  if(cutoff&&exists(data))scan(data);
  return [...new Set(reasons)];
}

export function runUninstall({manifest, here, args, home=os.homedir(), agentDir=process.env.PI_CODING_AGENT_DIR??path.join(home,".pi","agent")}) {
  const opts=parse(args,manifest,home), expand=(p)=>p.replace(/^~(?=$|\/)/,home), homePath=(p)=>p===home?"~":p.startsWith(home+path.sep)?`~${p.slice(home.length)}`:p;
  const ctx={manifest,here,args,home,agentDir,opts,expand,homePath};
  let receipt=readJson(opts.receipt), inferred=false;
  if(!receipt){if(!opts.infer)throw new Error(`receipt not found at ${opts.receipt}; pass --infer to build a reduced provenance-based plan`);inferred=true;receipt={version:1,runs:[{actions:inferActions(ctx)}]};}
  if(receipt.version!==1||!Array.isArray(receipt.runs))throw new Error(`invalid receipt at ${opts.receipt}`);
  if(inferred&&opts.yes&&!opts.infer)throw new Error("an inferred uninstall requires --yes --infer together");
  const actions=receipt.runs.flatMap((r)=>Array.isArray(r.actions)?r.actions:[]), operations={services:[],json:[],piPackages:[],files:[],globals:[],clone:[],pi:[]}, leftovers=[], preserved=new Set(), planned=[];
  const receiptCloneDir=expand(actions.find((a)=>a.kind==="git.clone")?.path??manifest.firstmate.dir), allowedRemovalRoots=[expand(manifest.firstmate.dir),receiptCloneDir];
  const add=(phase,label,fn)=>{operations[phase].push({label,fn});planned.push(label)};
  const byPath=new Map();for(const a of actions){if(a.path){const p=expand(a.path);if(!byPath.has(p))byPath.set(p,[]);byPath.get(p).push(a)}}
  const installerOwnedFile=(p)=>byPath.get(p)?.find((a)=>a.kind.startsWith("file."))?.kind==="file.create";

  // Phase 0: stop services recorded as loaded, regardless of whether they are currently loaded.
  const services=new Map();for(const a of actions)if(a.kind==="service.load")services.set(a.name,a);
  for(const [name,a] of services){add("services",`stop service ${name}`,()=>{if(process.platform==="darwin")run("launchctl",["bootout",`gui/${process.getuid()}/${name}`]);else if(process.platform==="linux")run("systemctl",["--user","disable","--now",name.endsWith(".timer")?name:`${name}.timer`]);});}
  const brHome=expand(manifest.bedrouter.home), pidFiles=[path.join(brHome,"bedrouter.pid"),path.join(brHome,"server.pid")];for(const p of pidFiles)if(exists(p)){const pid=Number(fs.readFileSync(p,"utf8").trim()),ps=Number.isInteger(pid)?run("ps",["-p",String(pid),"-o","command="]):null;if(ps?.status===0&&/bedrouter/i.test(ps.stdout))add("services",`stop bedrouter pid ${pid}`,()=>{try{process.kill(pid,"SIGTERM")}catch{}});else leftovers.push(`${p}: pid does not identify a running bedrouter; left alone`);break;}

  // Fold scalar JSON keys across every run: newest expected value, oldest prior value.
  const jsonGroups=new Map();for(const a of actions)if(["json.set","json.delete"].includes(a.kind)){const id=`${expand(a.path)}\0${a.key}`;if(!jsonGroups.has(id))jsonGroups.set(id,[]);jsonGroups.get(id).push(a)}
  for(const [id,group] of jsonGroups){const [p,key]=id.split("\0");if(installerOwnedFile(p)&&exists(p)&&!fs.lstatSync(p).isSymbolicLink())continue;const first=group[0],last=group.at(-1),doc=readJson(p);if(!doc){leftovers.push(`${p}: cannot parse JSON; kept`);preserved.add(p);continue}const expectedPresent=last.kind==="json.set",expected=last.value,currentPresent=hasAt(doc,key),current=valueAt(doc,key);if(currentPresent!==expectedPresent||(expectedPresent&&!same(current,expected))){leftovers.push(`${p} ${key}: current value differs from the receipt; kept`);preserved.add(p);continue}add("json",`restore JSON ${homePath(p)} ${key}`,()=>{const fresh=readJson(p),stillPresent=fresh&&hasAt(fresh,key),stillValue=fresh&&valueAt(fresh,key);if(!fresh||stillPresent!==expectedPresent||(expectedPresent&&!same(stillValue,expected))){preserved.add(p);leftovers.push(`${p} ${key}: changed after planning; kept`);return}setAt(fresh,key,first.prior,first.priorPresent===true);fs.writeFileSync(p,JSON.stringify(fresh,null,2)+"\n")});}
  const arrayGroups=new Map();for(const a of actions)if(["json.append","json.remove"].includes(a.kind)){const id=`${expand(a.path)}\0${a.key}`;if(!arrayGroups.has(id))arrayGroups.set(id,[]);arrayGroups.get(id).push(a)}
  for(const [id,group] of arrayGroups){const [p,key]=id.split("\0"),doc=readJson(p);if(!doc||!Array.isArray(valueAt(doc,key))){leftovers.push(`${p} ${key}: expected an array; kept`);preserved.add(p);continue}const added=new Set(group.flatMap((a)=>a.added??[])),removed=new Set(group.flatMap((a)=>a.removed??[]));add("json",`revert JSON list ${homePath(p)} ${key}`,()=>{const fresh=readJson(p),cur=fresh&&valueAt(fresh,key);if(!Array.isArray(cur)){preserved.add(p);leftovers.push(`${p} ${key}: changed after planning; kept`);return}let next=cur.filter((v)=>!added.has(v));for(const v of removed)if(!next.includes(v))next.push(v);setAt(fresh,key,next,true);fs.writeFileSync(p,JSON.stringify(fresh,null,2)+"\n")});}
  const envGroups=new Map();for(const a of actions)if(a.kind==="env.set"){const id=`${expand(a.path)}\0${a.key}`;if(!envGroups.has(id))envGroups.set(id,[]);envGroups.get(id).push(a)}for(const [id,group] of envGroups){const [p,key]=id.split("\0");if(!opts.withState)continue;const first=group[0],last=group.at(-1),escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),text=exists(p)?fs.readFileSync(p,"utf8"):"",m=text.match(new RegExp(`^${escaped}=(.*)$`,"m"));if(!m||m[1]!==String(last.value)){leftovers.push(`${p} ${key}: current value differs from the receipt; kept`);preserved.add(p);continue}add("json",`restore environment ${homePath(p)} ${key}`,()=>{try{let cur=fs.readFileSync(p,"utf8"),match=cur.match(new RegExp(`^${escaped}=(.*)$`,"m"));if(!match||match[1]!==String(last.value)){preserved.add(p);leftovers.push(`${p} ${key}: changed after planning; kept`);return}const re=new RegExp(`^${escaped}=.*(?:\n|$)`,"m");cur=first.prior===null?cur.replace(re,""):cur.replace(re,`${key}=${first.prior}\n`);fs.writeFileSync(p,cur)}catch(e){preserved.add(p);throw e}});}

  // Marker blocks can be removed without touching the surrounding firstmate data file.
  const blockGroups=new Map();for(const a of actions)if(a.kind.startsWith("block.")){const id=`${expand(a.path)}\0${a.marker}`;if(!blockGroups.has(id))blockGroups.set(id,[]);blockGroups.get(id).push(a)}for(const [id,group] of blockGroups){const [p,marker]=id.split("\0"),last=group.at(-1);if(last.kind==="block.remove"||!exists(p))continue;const escaped=marker.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),re=new RegExp(`<!-- ${escaped}:START -->[\\s\\S]*?<!-- ${escaped}:END -->\\n?`);if(!re.test(fs.readFileSync(p,"utf8")))continue;add("files",`remove ${marker} block from ${homePath(p)}`,()=>{const cur=fs.readFileSync(p,"utf8"),next=cur.replace(re,"").replace(/\n{3,}/g,"\n\n");fs.writeFileSync(p,next)});}

  const latestHash=new Map();for(const a of actions)if(a.path&&a.sha256)latestHash.set(expand(a.path),a.sha256);
  for(const [p,group] of byPath){const created=group.some((a)=>a.kind==="file.create")&&group.find((a)=>a.kind.startsWith("file."))?.kind==="file.create";if(!created||!exists(p)||fs.lstatSync(p).isDirectory())continue;const rel=homePath(p),statePath=p===brHome||p.startsWith(brHome+path.sep)||(p.startsWith(expand(manifest.cli.home)+path.sep)&&!/[\\/]hablo-captain\.ts$/.test(p)&&!/[\\/]tone\.md$/.test(p));const servicePath=/[\\/](LaunchAgents|systemd[\\/]user)[\\/]/.test(p);if(statePath&&!opts.withState)continue;if(servicePath&&!opts.withServices)continue;if(fs.lstatSync(p).isSymbolicLink()){leftovers.push(`${p}: now a symlink; never unlinked`);preserved.add(p);continue}const current=sha256(fs.readFileSync(p)),expected=latestHash.get(p);if(expected&&current!==expected){leftovers.push(`${p}: changed since install; kept`);preserved.add(p);continue}add("files",`remove ${rel}`,()=>{if(!exists(p))return;if(fs.lstatSync(p).isSymbolicLink()){preserved.add(p);leftovers.push(`${p}: became a symlink; kept`);return}if(expected&&sha256(fs.readFileSync(p))!==expected){preserved.add(p);leftovers.push(`${p}: changed after planning; kept`);return}fs.unlinkSync(validateDeleteTarget(p,home,allowedRemovalRoots))});}

  if(opts.withState){for(const root of [brHome,expand(manifest.cli.home)])if(exists(root)){add("files",`remove owned state under ${homePath(root)}`,()=>{const walk=(d)=>{for(const ent of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,ent.name);if(preserved.has(p))continue;if(ent.isDirectory()&&!ent.isSymbolicLink()){walk(p);try{fs.rmdirSync(p)}catch{}}else{fs.unlinkSync(validateDeleteTarget(p,home,allowedRemovalRoots))}}};walk(root);try{fs.rmdirSync(root)}catch{}});}}

  if(opts.withGlobals&&!inferred){const globals=new Map();for(const a of actions)if((a.kind==="npm.global"||a.kind==="script.install")&&!globals.has(`${a.kind}\0${a.name}`))globals.set(`${a.kind}\0${a.name}`,a);for(const a of globals.values())if(a.wasPresent===false){if(a.kind==="npm.global")add("globals",`uninstall global npm package ${a.name}`,()=>{const r=run("npm",["uninstall","-g",a.name],{inherit:true,timeout:600_000});if(r.status!==0)leftovers.push(`${a.name}: npm uninstall failed`)});else{const p=path.join(expand(manifest.cli.binDir),a.name);if(exists(p))add("globals",`remove installed script ${homePath(p)}`,()=>fs.unlinkSync(validateDeleteTarget(p,home)));}}}
  else if(opts.withGlobals&&inferred)leftovers.push("global tools: skipped because inferred provenance cannot establish prior ownership");
  {const globals=new Map();for(const a of actions)if((a.kind==="npm.global"||a.kind==="script.install")&&!globals.has(`${a.kind}\0${a.name}`))globals.set(`${a.kind}\0${a.name}`,a);for(const a of globals.values())if(a.wasPresent===true)leftovers.push(`${a.name}: was present before HABLO; kept`);}

  const cloneAction=actions.find((a)=>a.kind==="git.clone"), fmDir=cloneAction?expand(cloneAction.path):expand(manifest.firstmate.dir), projectsDir=path.join(fmDir,"projects");if(exists(projectsDir))for(const ent of fs.readdirSync(projectsDir,{withFileTypes:true})){const p=path.join(projectsDir,ent.name);if(ent.isSymbolicLink()){let targetExists=true;try{targetExists=fs.existsSync(fs.realpathSync(p))}catch{targetExists=false}if(!targetExists)add("files",`prune broken runtime symlink ${p}`,()=>fs.unlinkSync(validateDeleteTarget(p,home,allowedRemovalRoots)));else leftovers.push(`${p}: live hablo project symlink; kept`);}}
  const registry=path.join(fmDir,"data","projects.md");if(exists(registry))for(const line of fs.readFileSync(registry,"utf8").split("\n").filter((l)=>/\(added .* via hablo\)/.test(l)))leftovers.push(`${registry}: registry entry kept: ${line}`);
  if(opts.withFirstmate&&!inferred&&actions.some((a)=>a.kind==="git.clone"&&expand(a.path)===fmDir)){const unsafe=firstmateSafety(fmDir);if(unsafe.length)leftovers.push(...unsafe);else add("clone",`remove firstmate clone ${fmDir}`,()=>fs.rmSync(validateDeleteTarget(fmDir,home,allowedRemovalRoots),{recursive:true}));}
  else if(opts.withFirstmate&&inferred)leftovers.push(`${fmDir}: clone skipped because inferred provenance cannot prove HABLO created it`);

  if(opts.removePi&&!inferred){const packages=new Map();for(const a of actions)if(a.kind==="pi.package"&&!packages.has(a.name))packages.set(a.name,a);for(const [name,a] of packages){if(a.wasListed)leftovers.push(`${name}: listed before HABLO; kept`);else add("piPackages",`remove Pi package ${name}`,()=>{const r=run("pi",["remove",name],{inherit:true,timeout:600_000});if(r.status!==0)leftovers.push(`${name}: pi remove failed`)});}for(const a of actions)if(a.kind==="pi.cli"&&a.wasPresent===false){const cmd=a.manager==="bun"?["bun",["remove","-g",a.name]]:a.manager==="pnpm"?["pnpm",["remove","-g",a.name]]:["npm",["uninstall","-g",a.name]];add("pi",`uninstall Pi CLI ${a.name} with ${a.manager}`,()=>{const r=run(cmd[0],cmd[1],{inherit:true,timeout:600_000});if(r.status!==0)leftovers.push(`${a.name}: CLI uninstall failed`)})}}
  else if(opts.removePi&&inferred)leftovers.push("Pi packages and CLI: skipped because inferred provenance cannot establish prior ownership");
  const noMistakesPid=path.join(home,".no-mistakes","daemon.pid");if(opts.withGlobals&&exists(noMistakesPid))leftovers.push(`${noMistakesPid}: third-party daemon left running; use no-mistakes' own stop command`);

  console.log(`HABLO uninstall plan${inferred?" (INFERRED)":""}:`);if(!planned.length)console.log("  nothing receipt-owned remains in the selected scopes");for(const p of planned)console.log(`  - ${p}`);console.log(`  - backup first${opts.noBackup?" skipped (--no-backup)":opts.withState?" (with history/state)":""}`);if(!opts.yes){console.log("\nPlan only; re-run with --yes to execute.");printLeftovers(leftovers);return {executed:false,planned,leftovers};}
  if(inferred&&!opts.infer)throw new Error("an inferred uninstall requires --yes --infer together");
  if(!opts.noBackup){const out=backup(ctx,opts.withState);console.log(out?`Backed up to ${out}`:"No configured paths existed to back up.");}
  for(const phase of ["services","json","piPackages","files","globals","clone","pi"])for(const op of operations[phase]){try{op.fn();console.log(`removed: ${op.label}`)}catch(e){leftovers.push(`${op.label}: ${e.message}`)}}
  printLeftovers(leftovers);return {executed:true,planned,leftovers};
}

function printLeftovers(items){console.log("\nLeftovers:");if(!items.length)console.log("  none");else for(const item of [...new Set(items)])console.log(`  - ${item}`);}
