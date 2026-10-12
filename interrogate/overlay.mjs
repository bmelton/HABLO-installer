// HABLO overlay for the pinned technical-design-doc skill.
// Pure helpers so install.mjs and tests can share them without a network.

/** Files fetched from the pinned upstream skill path (relative to skill root). */
export const SKILL_FETCH_PATHS = [
  "SKILL.md",
  "assets/tdd-template.md",
  "references/diagrams.md",
];

/**
 * Apply HABLO edits to upstream SKILL.md: markdown-only TDDs, Pi chat Q&A,
 * no SharePoint/docx/required diagram render toolchain.
 */
export function overlaySkillMd(src) {
  let out = src;

  out = out.replace(
    /5\. \*\*Render the diagrams\*\*[^\n]*\n/,
    "5. **Diagrams stay as fenced mermaid/PlantUML** in the markdown (render to images only if tools are already present; not required).\n",
  );
  out = out.replace(
    /6\. \*\*Self-check\*\*[^\n]*\n/,
    "6. **Self-check** against the \"Review checklist\" before handing it over.\n",
  );
  out = out.replace(
    /7\. \*\*Export to docx[\s\S]*?See "Sharing on SharePoint"\.\n/,
    "7. **Optional ADRs:** when the interview yields a durable config/architecture choice, add `adr-NNN-<slug>.md` in the same TDD folder (see HABLO ADR template). Absence of ADRs is fine — say \"No ADRs\" in the TDD.\n",
  );

  // Drop SharePoint / docx section; keep a short HABLO note.
  out = out.replace(
    /## Sharing on SharePoint\n[\s\S]*?(?=## Interviewing\n)/,
    `## Sharing (HABLO)

Markdown under \`~/tdds/<TICKET>-<slug>/\` is the deliverable. Do **not** produce \`.docx\` or upload to SharePoint from this skill. Diagram image render scripts are optional niceties when already installed; fenced diagrams in the markdown are enough.

`,
  );

  out = out.replace(
    /Use `AskUserQuestion` with 2–4 concrete options\./,
    "Ask in the Pi chat with 2–4 concrete options (batch them; do not use Cursor ask-user UI tools).",
  );

  out = out.replace(
    /For any project under `~\/Projects`, TDDs live outside the repo in `~\/tdds`/,
    "For HABLO voyages, TDDs live outside the repo in `~/tdds`",
  );
  out = out.replace(
    /For projects outside `~\/Projects`, follow the repo's own convention if it has one[\s\S]*?and otherwise ask\.\n/,
    "If the user already has a repo `docs/design/` or `rfcs/` convention, ask before writing outside it; default remains `~/tdds`.\n",
  );

  // Soften make/docx-centric layout listing.
  out = out.replace(
    /├── <TICKET>-<slug>\.docx   generated for SharePoint, once reviewed\n/,
    "├── adr-NNN-<slug>.md optional durable decisions (HABLO)\n",
  );
  out = out.replace(
    /`~\/tdds` is a git repo with a Makefile driving the work\. Prefer it over calling\nthe render script directly:\n[\s\S]*?let `make` rebuild them\.\n/,
    `\`~/tdds\` may be a plain directory or a git repo. A Makefile/render toolchain is optional.
HABLO requires only the markdown \`README.md\` (and optional ADR files). Do not block on \`make\`, \`make docx\`, or diagram image renders.

`,
  );

  if (!out.includes("HABLO overlay")) {
    out = out.replace(
      /(---\n(?:[\s\S]*?\n)---\n)/,
      `$1\n<!-- HABLO overlay: markdown-only TDD + Pi chat interview; no docx/SharePoint. -->\n`,
    );
  }

  return out;
}

/** Write a skill directory from a map of relative path → file contents. */
export function materializeSkill(destDir, files, { mkdirSync, writeFileSync }) {
  for (const [rel, body] of Object.entries(files)) {
    const full = `${destDir}/${rel}`.replace(/\/+/g, "/");
    const parent = full.slice(0, full.lastIndexOf("/"));
    mkdirSync(parent, { recursive: true });
    writeFileSync(full, body);
  }
}
