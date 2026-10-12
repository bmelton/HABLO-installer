// Fetch pinned technical-design-doc skill files via `gh api` (enterprise host aware).
import { spawnSync } from "node:child_process";
import { SKILL_FETCH_PATHS, overlaySkillMd } from "./overlay.mjs";

/**
 * @param {{ host: string, repo: string, path: string, sha: string }} pin
 * @param {{ gh?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ ok: true, files: Record<string, string>, sha: string } | { ok: false, error: string }}
 */
export function fetchSkillFiles(pin, opts = {}) {
  const gh = opts.gh ?? "gh";
  const host = pin.host || "github.boozallencsn.com";
  const env = { ...process.env, ...opts.env, GH_HOST: host };
  const files = {};
  for (const rel of SKILL_FETCH_PATHS) {
    const apiPath = `repos/${pin.repo}/contents/${pin.path}/${rel}?ref=${pin.sha}`;
    const r = spawnSync(gh, ["api", "-H", "Accept: application/vnd.github.raw", apiPath], {
      encoding: "utf8",
      env,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || `gh api exit ${r.status}`).trim().split("\n")[0];
      return { ok: false, error: `${rel}: ${err}` };
    }
    let body = r.stdout ?? "";
    if (rel === "SKILL.md") body = overlaySkillMd(body);
    files[rel] = body.endsWith("\n") ? body : body + "\n";
  }
  return { ok: true, files, sha: pin.sha };
}

/**
 * Load skill files from a local fixture directory (tests / offline).
 * Expects raw upstream SKILL.md (overlay applied here).
 */
export function loadSkillFixture(fixtureDir, { readFileSync, existsSync }) {
  const files = {};
  for (const rel of SKILL_FETCH_PATHS) {
    const p = `${fixtureDir}/${rel}`;
    if (!existsSync(p)) return { ok: false, error: `fixture missing ${rel}` };
    let body = readFileSync(p, "utf8");
    if (rel === "SKILL.md") body = overlaySkillMd(body);
    files[rel] = body.endsWith("\n") ? body : body + "\n";
  }
  return { ok: true, files, sha: "fixture" };
}
