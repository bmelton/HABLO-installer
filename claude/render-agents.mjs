// Render Pi agent profiles into Claude Code subagent Markdown.
// Shared by install.mjs and tests. Zero dependencies.
const TOOL_MAP = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  ls: "Glob",
  edit: "Edit",
  write: "Write",
  bash: "Bash",
};

export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (key === "tools" && value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body: m[2] };
}

export function claudeAgentName(piName) {
  return String(piName || "agent").trim().toLowerCase().replace(/\s+/g, "-");
}

export function mapTools(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const out = [];
  for (const t of list) {
    const mapped = TOOL_MAP[t] || (t[0] === t[0].toUpperCase() ? t : null);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** @param {string} piMarkdown @param {{ exploreModel?: string, executeModel?: string }} models */
export function renderClaudeAgent(piMarkdown, models = {}) {
  const { meta, body } = parseFrontMatter(piMarkdown);
  const name = claudeAgentName(meta.name);
  const description = meta.description || name;
  const tools = mapTools(meta.tools);
  const thinking = String(meta.thinking || "medium");
  const model = thinking === "high"
    ? (models.exploreModel || "opus")
    : (models.executeModel || "sonnet");
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `model: ${model}`,
  ];
  if (tools.length) lines.push(`tools: [${tools.join(", ")}]`);
  lines.push("---", "", body.replace(/^\n+/, ""));
  return { name, markdown: lines.join("\n") };
}

export function renderAllClaudeAgents(files, models) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [filename, text] of Object.entries(files)) {
    const { name, markdown } = renderClaudeAgent(text, models);
    out[`${name}.md`] = markdown;
  }
  return out;
}
