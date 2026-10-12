// Pure fleet-footer helpers for hablo-captain. Kept as .mjs so unit tests can
// import them without a TypeScript loader; the captain extension imports this
// file from the same directory (installed next to it under ~/.hablo/).

export function shortTaskId(id) {
  // ORIGINOPS-4496-style task ids: drop the repo/project prefix when the next
  // segment is numeric so the footer stays readable.
  const parts = id.split("-");
  if (parts.length >= 3 && /^\d+$/.test(parts[1] || "")) return parts.slice(1).join("-");
  if (id.length <= 22) return id;
  return `${id.slice(0, 20)}…`;
}

export function formatAge(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

export function parseStatusAt(line) {
  if (!line) return undefined;
  const m = line.match(/\[at=(\d+)\]/);
  return m ? Number(m[1]) : undefined;
}

/**
 * @param {string} projectName
 * @param {object|null} summary home-summary.json document
 * @param {number} nowSecs
 * @param {Map<string,{lastStatus?:string,busy?:string,statusMtime?:number}>} details
 * @param {number} [staleSecs]
 */
export function formatFleetStatus(projectName, summary, nowSecs, details, staleSecs = 600) {
  const counts = summary?.counts || {};
  const active = summary?.active_children || [];
  const holds = counts.holds || 0;
  const decisions = counts.decisions_open || 0;
  const queued = counts.queued || 0;
  const n = counts.active_children ?? active.length;

  if (!summary || n === 0) {
    const extras = [];
    if (queued) extras.push(`${queued} queued`);
    if (holds) extras.push(`${holds} hold`);
    if (decisions) extras.push(`${decisions} decide`);
    const tail = extras.length ? ` · ${extras.join(" · ")}` : "";
    return { text: `firstmate · ${projectName} · idle${tail}`, level: holds || decisions ? "warn" : "ok" };
  }

  let level = holds || decisions ? "warn" : "ok";
  const bits = [];
  for (const child of active.slice(0, 3)) {
    const id = child.id || "?";
    const det = details.get(id) || {};
    const last = det.lastStatus || "";
    const verb = (last.match(/^(\S+)/) || [])[1] || child.state || "working";
    const at = parseStatusAt(last) ?? det.statusMtime;
    const age = at ? Math.max(0, nowSecs - at) : 0;
    const busy = (det.busy || "").includes("state=busy") || /busy/i.test(child.doing || "");
    const stale = age >= staleSecs && (verb === "working" || busy || child.state === "working");
    if (stale) level = "stale";
    const agePart = age ? ` ${formatAge(age)}` : "";
    const flag = stale ? "STALE" : busy && verb === "working" ? "busy" : verb;
    bits.push(`${shortTaskId(id)}:${flag}${agePart}`);
  }
  if (active.length > 3) bits.push(`+${active.length - 3}`);

  const extras = [];
  if (holds) extras.push(`${holds} hold`);
  if (decisions) extras.push(`${decisions} decide`);
  if (queued) extras.push(`${queued} queued`);
  const extra = extras.length ? ` · ${extras.join(" · ")}` : "";
  return { text: `firstmate · ${projectName} · ${n}↑ ${bits.join(" · ")}${extra}`, level };
}
